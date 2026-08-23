/**
 * Efeitos sonoros do gameplay (Etapa 13D — Parte 2).
 *
 * O projeto ainda NAO possui nenhum sistema de audio (nenhum <audio>,
 * nenhum arquivo de som, nenhum controle de volume, nenhuma musica
 * tocando de verdade -- so o CATALOGO de musicas, que e apenas
 * metadado escolhido antes da partida; ver client/js/music/*). Por
 * isso este modulo NAO reaproveita nada existente (nao ha nada para
 * reaproveitar) e tambem NAO cria nenhum player de musica -- so os
 * efeitos sonoros pontuais pedidos no enunciado (PERFECT/GREAT/GOOD/
 * ERRO/MISS/aumento de combo).
 *
 * Decisao de arquitetura: em vez de exigir arquivos de audio (.mp3/
 * .wav) que nao existem no projeto e precisariam ser adicionados como
 * assets binarios, cada som e SINTETIZADO na hora via Web Audio API
 * (osciladores curtos com um envelope de volume). Isso:
 *   - nao adiciona nenhuma biblioteca externa nem asset binario novo;
 *   - mantem cada efeito curto e leve (poucas dezenas de ms);
 *   - deixa os 6 sons claramente distintos entre si (frequencia/forma
 *     de onda diferentes), como pedido no item 1 do enunciado;
 *   - nunca conflita com uma musica de fundo: cada chamada cria um
 *     no de audio novo e independente, tocado em paralelo (nunca
 *     substitui/pausa/reinicia nada) -- se um sistema de musica real
 *     for adicionado depois, basta ele tambem usar (ou nao) o mesmo
 *     AudioContext; este modulo nunca mexe em play/pause/currentTime
 *     de nenhum elemento de musica.
 *
 * Restricoes de autoplay (item 3 do enunciado): navegadores (em
 * especial no celular) exigem um gesto do usuario antes de deixar
 * qualquer audio tocar. `unlock()` deve ser chamado no primeiro
 * toque/clique/tecla do jogador (feito por main.js) para tentar
 * destravar o AudioContext; enquanto ele continuar suspenso (ou nao
 * existir/for bloqueado por qualquer motivo), TODAS as funcoes de som
 * abaixo simplesmente nao tocam nada -- nunca lancam excecao nem
 * travam o jogo (cada chamada e protegida por try/catch e checagens
 * de suporte).
 *
 * Nada aqui toca em DOM de jogo, score, combo ou timeline -- este
 * modulo so SABE tocar um som quando mandado; quem decide QUANDO
 * chamar (a partir dos mesmos resultados que FeedbackRenderer ja usa)
 * e main.js.
 */
const SoundEffectsController = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;

  function isBrowser() {
    return typeof window !== 'undefined';
  }

  // ---------------------------------------------------------------------
  // Definicao de cada som -- dados PUROS (sem audio nenhum), para poder
  // ser testado em Node puro sem AudioContext.
  //
  // Cada som e um oscilador curto com uma frequencia (ou uma pequena
  // rampa ate `glideTo`, quando presente) e um volume (`gain`) proprio
  // -- valores baixos de proposito para nunca abafar/"disputar" com uma
  // eventual musica de fundo tocando por cima.
  // ---------------------------------------------------------------------
  const SOUND_DEFS = {
    // Julgamento mais alto: tom agudo e limpo (triangle), o mais
    // "premiado" dos quatro julgamentos.
    PERFECT: { type: 'triangle', freq: 1318.5, duration: 0.16, gain: 0.16 },
    // ETAPA 13C — faixa intermediaria: mesma familia de timbre do
    // PERFECT, um degrau abaixo em frequencia, para soar parecido mas
    // claramente menor.
    GREAT: { type: 'triangle', freq: 987.77, duration: 0.14, gain: 0.15 },
    // Julgamento mais baixo dos acertos: onda senoidal, mais suave.
    GOOD: { type: 'sine', freq: 659.25, duration: 0.12, gain: 0.13 },
    // Nota perdida por tempo: tom descendente e mais grave (diferente
    // em FORMA -- nao so em altura -- do MISTAKE abaixo).
    MISS: { type: 'sawtooth', freq: 246, glideTo: 130, duration: 0.2, gain: 0.15 },
    // Erro de tecla: som mais "aspero" (square) e ainda mais grave,
    // para nunca ser confundido com MISS mesmo ouvindo so o som.
    MISTAKE: { type: 'square', freq: 160, glideTo: 90, duration: 0.22, gain: 0.17 },
    // Aumento de combo: blip curtinho e agudo, sobreposto ao som do
    // julgamento (nunca o substitui) -- so marca "combo subiu".
    COMBO_UP: { type: 'sine', freq: 1567.98, duration: 0.07, gain: 0.09 },
  };

  // Mapa outcome (o mesmo texto que GameplayEngine/FeedbackRenderer ja
  // usam) -> definicao de som. Nenhum outcome novo e inventado aqui.
  const OUTCOME_SOUND = {
    PERFECT: 'PERFECT',
    GREAT: 'GREAT',
    GOOD: 'GOOD',
    MISS: 'MISS',
    MISTAKE: 'MISTAKE',
  };

  // Um UNICO AudioContext compartilhado por todos os sons (nunca um por
  // efeito) -- e o proprio ponto 5 do enunciado (nao criar objetos de
  // audio desnecessarios). Criado de forma preguicosa (so na primeira
  // vez que for realmente preciso), nunca no carregamento do modulo.
  let audioCtx = null;
  let masterGain = null;
  // true assim que uma tentativa de criar o AudioContext falhar (API
  // ausente, ou o proprio construtor lancando) -- evita tentar de novo
  // a cada som, o que so geraria mais chamadas inuteis.
  let unsupported = false;

  function getAudioContextConstructor() {
    if (!isBrowser()) return null;
    return window.AudioContext || window.webkitAudioContext || null;
  }

  /**
   * Cria (uma unica vez) o AudioContext + o gain mestre dos efeitos.
   * Nunca lanca: qualquer falha (API ausente, navegador bloqueando,
   * etc.) so marca `unsupported = true` e devolve null -- quem chamar
   * trata null como "nao da para tocar agora".
   */
  function ensureContext() {
    if (audioCtx || unsupported) return audioCtx;

    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) {
      unsupported = true;
      return null;
    }

    try {
      audioCtx = new AudioContextCtor();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(audioCtx.destination);
    } catch (err) {
      audioCtx = null;
      masterGain = null;
      unsupported = true;
    }

    return audioCtx;
  }

  /**
   * Deve ser chamado no primeiro gesto do jogador (toque/clique/tecla),
   * exatamente como pedido no item 3 do enunciado. Tenta criar o
   * AudioContext (se ainda nao existir) e, se ele nasceu/ja estava
   * "suspended" (bloqueio padrao de autoplay), pede pra retomar.
   *
   * Nunca lanca excecao e nunca bloqueia: `resume()` e assincrono e
   * qualquer rejeicao e apenas ignorada (o navegador pode recusar de
   * novo; nesse caso os sons simplesmente continuam nao tocando ate
   * um proximo gesto valido, sem quebrar nada).
   *
   * @returns {boolean} true se um AudioContext existe (mesmo que ainda
   *   suspenso); false se o navegador nao suporta Web Audio.
   */
  function unlock() {
    const ctx = ensureContext();
    if (!ctx) return false;

    try {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        const maybePromise = ctx.resume();
        if (maybePromise && typeof maybePromise.catch === 'function') {
          maybePromise.catch(() => {});
        }
      }
    } catch (err) {
      // Ignorado de proposito -- ver comentario da funcao acima.
    }

    return true;
  }

  /**
   * @returns {boolean} true se o AudioContext existe e esta pronto
   *   para tocar agora mesmo (estado 'running').
   */
  function isReady() {
    return !!audioCtx && audioCtx.state === 'running';
  }

  /**
   * Toca UMA definicao de som (ver SOUND_DEFS). Cria um oscilador +
   * gain novos a cada chamada (sons sao curtos e descartaveis -- nunca
   * reaproveitados entre chamadas, pois um oscilador so pode tocar
   * uma vez), mas garante que ambos sejam desconectados assim que o
   * som terminar (`onended`), para nunca acumular nos de audio "presos"
   * na memoria (item 5 do enunciado).
   *
   * Protegido ponta a ponta por try/catch e checagens de estado: se o
   * navegador bloquear (contexto suspenso, API ausente, qualquer
   * excecao ao criar/agendar os nos), a funcao apenas devolve `false`
   * e NUNCA lanca -- o jogo continua funcionando normalmente mesmo
   * sem som (item 3 do enunciado).
   *
   * @param {keyof SOUND_DEFS} soundKey
   * @returns {boolean} true se o som comecou a tocar agora.
   */
  function playSound(soundKey) {
    const def = SOUND_DEFS[soundKey];
    if (!def) return false;

    const ctx = ensureContext();
    if (!ctx || !masterGain) return false;

    if (ctx.state === 'suspended') {
      // Ainda bloqueado pelo navegador (nenhum gesto valido recebido
      // ainda, ou o navegador suspendeu de novo). Tenta destravar em
      // segundo plano para as PROXIMAS chamadas, mas nao toca nada
      // agora nem trava o jogo esperando essa tentativa.
      if (typeof ctx.resume === 'function') {
        try {
          const maybePromise = ctx.resume();
          if (maybePromise && typeof maybePromise.catch === 'function') {
            maybePromise.catch(() => {});
          }
        } catch (err) {
          // Ignorado -- ver unlock().
        }
      }
      return false;
    }

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = def.type;
      osc.frequency.setValueAtTime(def.freq, now);
      if (typeof def.glideTo === 'number') {
        // exponentialRamp exige valores > 0.
        osc.frequency.exponentialRampToValueAtTime(Math.max(def.glideTo, 1), now + def.duration);
      }

      // Envelope curto (ataque quase instantaneo, decaimento suave) --
      // evita o "clique" de comecar/parar um oscilador em volume cheio.
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.exponentialRampToValueAtTime(def.gain, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + def.duration);

      osc.connect(gainNode);
      gainNode.connect(masterGain);

      osc.onended = () => {
        try {
          osc.disconnect();
          gainNode.disconnect();
        } catch (err) {
          // Nos ja podem ter sido desconectados; nada a fazer.
        }
      };

      osc.start(now);
      osc.stop(now + def.duration + 0.03);
      return true;
    } catch (err) {
      // Qualquer falha ao criar/agendar os nos de audio: nunca propaga.
      return false;
    }
  }

  function playPerfect() {
    return playSound('PERFECT');
  }

  function playGreat() {
    return playSound('GREAT');
  }

  function playGood() {
    return playSound('GOOD');
  }

  function playMiss() {
    return playSound('MISS');
  }

  function playMistake() {
    return playSound('MISTAKE');
  }

  function playComboUp() {
    return playSound('COMBO_UP');
  }

  /**
   * Toca o som correspondente a um `outcome` de julgamento -- o MESMO
   * texto que GameplayEngine.handleKeyPress/processExpiredNotes ja
   * devolvem e que FeedbackRenderer.showJudgement ja recebe. Outcomes
   * desconhecidos nao tocam nada (nem lancam erro).
   *
   * @param {'PERFECT'|'GREAT'|'GOOD'|'MISS'|'MISTAKE'} outcome
   * @returns {boolean}
   */
  function playForOutcome(outcome) {
    const soundKey = OUTCOME_SOUND[outcome];
    if (!soundKey) return false;
    return playSound(soundKey);
  }

  const api = {
    unlock,
    isReady,
    playPerfect,
    playGreat,
    playGood,
    playMiss,
    playMistake,
    playComboUp,
    playForOutcome,
    // Expostos so para teste automatizado (dados/funcoes puras):
    _internal: {
      SOUND_DEFS,
      OUTCOME_SOUND,
      ensureContext,
      getAudioContextConstructor,
    },
  };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
