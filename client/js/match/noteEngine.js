/**
 * Motor de notas (Etapa 4A).
 *
 * Responsavel por transformar a sequencia deterministica ja existente
 * (SequenceGenerator, a partir da seed enviada pelo servidor) em uma
 * "timeline" de objetos de nota, cada um com um tempo absoluto
 * (epoch ms, no mesmo relogio de referencia do servidor usado pelo
 * MatchController) e uma maquina de estados simples.
 *
 * Este modulo NAO sabe nada sobre:
 * - DOM / interface visual do piano;
 * - animacoes ou efeitos;
 * - audio/musica;
 * - pontuacao, combo, ranking, habilidades, vitoria/derrota.
 *
 * Ele apenas produz e gerencia os dados das notas. A camada visual
 * (proxima etapa) vai ler esses dados para desenhar/animar.
 *
 * IMPORTANTE: nao reimplementa nenhuma logica de aleatoriedade. Toda a
 * geracao pseudoaleatoria continua vindo do SequenceGenerator ja
 * existente (client/js/match/sequenceGenerator.js) — a mesma seed usada
 * ali produz aqui exatamente a mesma sequencia, nos dois jogadores.
 */
const NoteEngine = (() => {
  // Em Node (testes automatizados) o SequenceGenerator precisa ser
  // importado via require. No navegador ele ja existe como variavel
  // global, carregada por <script> antes deste arquivo em index.html —
  // por isso a referencia bare `SequenceGenerator` no branch else.
  const SequenceGeneratorRef =
    typeof module !== 'undefined' && module.exports
      ? require('./sequenceGenerator')
      : SequenceGenerator;

  // Estados possiveis de uma nota.
  const NOTE_STATE = {
    PENDING: 'pending', // ainda nao chegou a janela de julgamento
    ACTIVE: 'active', // dentro da janela de julgamento, aguardando input
    HIT: 'hit', // processada com sucesso (estado final)
    MISSED: 'missed', // passou da janela sem ser atingida (estado final)
  };

  // Estados finais: uma vez atingidos, a nota nunca muda de estado de novo.
  // E o que garante que "a mesma nota nao pode ser processada duas vezes".
  const TERMINAL_STATES = new Set([NOTE_STATE.HIT, NOTE_STATE.MISSED]);

  const VALID_STATES = new Set(Object.values(NOTE_STATE));

  /**
   * ID deterministico da nota: mesma seed + mesmo indice => mesmo id,
   * sempre, nos dois clientes.
   */
  function buildNoteId(seed, index) {
    return `note-${seed}-${index}`;
  }

  /**
   * ETAPA 13E — resolve o multiplicador de velocidade vigente para a
   * N-esima nota da timeline (mesmo padrao de "tiers" ja usado em
   * PlayerState.resolveComboMultiplier): `stages` deve estar ordenado
   * por `notesPlayed` crescente; para um `notesPlayed` (o `index` da
   * nota dentro da sequencia) vale o multiplicador do ULTIMO estagio
   * cujo `notesPlayed` seja <= o valor informado.
   *
   * Baseada inteiramente no PROGRESSO da sequencia (o indice, que ja
   * define deterministicamente cada nota via seed) -- nunca em tempo
   * real/relogio, o que a mantem 100% deterministica e identica nos
   * dois jogadores.
   *
   * `stages` ausente/vazio => multiplicador sempre 1 (comportamento
   * IDENTICO ao existente antes da Etapa 13E, usado por todo teste que
   * nao passar este parametro).
   *
   * @param {number} notesPlayed
   * @param {Array<{notesPlayed:number, speedMultiplier:number}>} [stages]
   * @returns {number}
   */
  function resolveSpeedMultiplier(notesPlayed, stages) {
    if (!Array.isArray(stages) || stages.length === 0) return 1;

    let multiplier = 1;
    for (const stage of stages) {
      if (
        stage &&
        Number.isFinite(stage.notesPlayed) &&
        Number.isFinite(stage.speedMultiplier) &&
        stage.speedMultiplier > 0 &&
        notesPlayed >= stage.notesPlayed
      ) {
        multiplier = stage.speedMultiplier;
      }
    }
    return multiplier;
  }

  /**
   * Gera a timeline completa de notas de uma partida.
   *
   * @param {object} options
   * @param {number} options.seed - seed da partida (a mesma dos dois jogadores).
   * @param {number} options.startTimestamp - epoch ms (relogio do servidor)
   *   em que a partida comeca. Deve vir do fluxo de sincronizacao ja
   *   existente (match_started / MatchController), nunca do relogio local.
   * @param {number} options.length - quantidade de notas a gerar.
   * @param {number} options.noteRange - quantidade de lanes/teclas (1..noteRange).
   * @param {number} options.noteIntervalMs - intervalo BASE (ms) entre notas
   *   consecutivas, antes de qualquer progressao de dificuldade (ver
   *   ClientConfig.NOTE_INTERVAL_MS / SequenceCatalog). Continua sendo a
   *   UNICA fonte do intervalo -- `difficultyStages` so o ENCURTA
   *   progressivamente, nunca substitui nem duplica esse valor.
   * @param {number} [options.leadInMs] - atraso extra (ms) antes da primeira
   *   nota, somado ao startTimestamp. Default 0.
   * @param {Array<{notesPlayed:number, speedMultiplier:number}>} [options.difficultyStages] -
   *   ETAPA 13E — progressao de dificuldade (ver
   *   ClientConfig.DIFFICULTY_PROGRESSION.STAGES). Omitido => cada
   *   intervalo entre notas permanece EXATAMENTE `noteIntervalMs`, ou
   *   seja, o mesmo comportamento de antes da Etapa 13E (usado por todo
   *   teste/chamador que ainda nao passa este parametro).
   * @returns {Array<{id:string,index:number,lane:number,time:number,state:string}>}
   */
  function generateNoteTimeline({
    seed,
    startTimestamp,
    length,
    noteRange,
    noteIntervalMs,
    leadInMs = 0,
    difficultyStages,
  }) {
    if (!Number.isFinite(seed)) {
      throw new Error('NoteEngine: seed invalida.');
    }
    if (!Number.isFinite(startTimestamp)) {
      throw new Error('NoteEngine: startTimestamp invalido.');
    }
    if (!Number.isInteger(length) || length <= 0) {
      throw new Error('NoteEngine: length invalido.');
    }
    if (!Number.isInteger(noteRange) || noteRange <= 0) {
      throw new Error('NoteEngine: noteRange invalido.');
    }
    if (!Number.isFinite(noteIntervalMs) || noteIntervalMs <= 0) {
      throw new Error('NoteEngine: noteIntervalMs invalido.');
    }

    // Reutiliza o gerador deterministico ja existente. Nao ha aqui
    // nenhum novo sistema de aleatoriedade.
    const sequence = SequenceGeneratorRef.generateSequence(seed, length, noteRange);

    // ETAPA 13E — cada nota (a partir da segunda) e posicionada
    // ACUMULANDO o intervalo ja percorrido ate ali, em vez do antigo
    // `index * noteIntervalMs` fixo: o intervalo ANTES da nota `index`
    // (distancia ate a nota anterior) e `noteIntervalMs` dividido pelo
    // multiplicador vigente para aquele indice (resolveSpeedMultiplier
    // acima). Sem `difficultyStages`, o multiplicador e sempre 1 e esta
    // soma acumulada e matematicamente IDENTICA a `index * noteIntervalMs`
    // -- nenhuma mudanca de comportamento para quem nao usa a nova
    // progressao.
    let elapsedMs = 0;
    return sequence.map((lane, index) => {
      if (index > 0) {
        const speedMultiplier = resolveSpeedMultiplier(index, difficultyStages);
        elapsedMs += noteIntervalMs / speedMultiplier;
      }

      return {
        id: buildNoteId(seed, index),
        index,
        lane,
        time: startTimestamp + leadInMs + elapsedMs,
        state: NOTE_STATE.PENDING,
      };
    });
  }

  /**
   * ETAPA 16-2A — Preparacao da geracao continua de notas.
   *
   * IMPORTANTE: esta etapa e SOMENTE preparacao. Nenhum modo de jogo
   * (Solo/Bot/Multiplayer) chama estas funcoes ainda -- isso fica para
   * uma proxima etapa (integracao com MatchTimelineManager/main.js).
   *
   * Calcula quantas notas sao necessarias para que a ULTIMA nota da
   * timeline cubra pelo menos `durationMs` (relativo ao startTimestamp
   * da partida), reaproveitando a MESMA formula de acumulo de tempo ja
   * usada por `generateNoteTimeline` acima (leadInMs + soma dos
   * intervalos, cada um encolhido pelo `resolveSpeedMultiplier` vigente
   * -- nenhuma logica de tempo nova ou duplicada com significado
   * diferente).
   *
   * Funcao PURA: nao le relogio nenhum (nunca `Date.now()`), nao usa
   * `setTimeout`/`setInterval`, e sempre devolve o mesmo resultado para
   * a mesma entrada -- e so um calculo matematico determinístico feito
   * inteiramente a partir dos parametros recebidos.
   *
   * NUNCA devolve menos que `length` (o padrao-base nunca e encurtado
   * por esta funcao) -- se `durationMs` nao for informado/invalido, ou
   * se a duracao pedida for menor que o tempo que o proprio padrao-base
   * ja ocupa, o resultado e simplesmente `length` (equivalente a nao
   * estender nada, o comportamento atual).
   *
   * @param {object} options
   * @param {number} options.length - tamanho do padrao-base (ex: 16/24).
   * @param {number} options.noteIntervalMs - intervalo BASE (ms) entre notas.
   * @param {number} [options.leadInMs] - atraso (ms) antes da primeira nota. Default 0.
   * @param {number} [options.durationMs] - duracao (ms) que a timeline deve cobrir.
   *   Omitido/invalido/<=0 => devolve `length` (nenhuma extensao).
   * @param {Array<{notesPlayed:number, speedMultiplier:number}>} [options.difficultyStages] -
   *   MESMA progressao de dificuldade ja usada por generateNoteTimeline
   *   (ver ClientConfig.DIFFICULTY_PROGRESSION.STAGES). Omitido => cada
   *   intervalo permanece EXATAMENTE `noteIntervalMs` (igual a antes).
   * @returns {number} quantidade total de notas necessarias (>= length).
   */
  function computeNoteCountForDuration({ length, noteIntervalMs, leadInMs = 0, durationMs, difficultyStages }) {
    if (!Number.isInteger(length) || length <= 0) {
      throw new Error('NoteEngine: length invalido.');
    }
    if (!Number.isFinite(noteIntervalMs) || noteIntervalMs <= 0) {
      throw new Error('NoteEngine: noteIntervalMs invalido.');
    }

    // Sem duracao valida para cobrir: preserva o comportamento atual
    // (somente o padrao-base, nenhuma extensao).
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return length;
    }

    // Acumula o mesmo jeito que generateNoteTimeline (elapsedMs comeca
    // em 0 para o indice 0; a partir do indice 1, soma noteIntervalMs
    // dividido pelo multiplicador vigente daquele indice). Continua
    // avancando enquanto: (a) a ULTIMA nota contada ainda nao cobre
    // `durationMs`, OU (b) ainda nao atingiu o minimo de `length`
    // notas (o padrao-base nunca pode ficar mais curto por causa desta
    // funcao).
    let elapsedMs = 0;
    let index = 0; // indice da ULTIMA nota ja contada (0-based)

    while (leadInMs + elapsedMs < durationMs || index < length - 1) {
      index += 1;
      const speedMultiplier = resolveSpeedMultiplier(index, difficultyStages);
      elapsedMs += noteIntervalMs / speedMultiplier;
    }

    return index + 1; // total de notas (index e 0-based)
  }

  /**
   * ETAPA 16-2A — Estende/repete deterministicamente um padrao-base de
   * notas ja existente, produzindo uma timeline MAIOR sem introduzir
   * nenhuma nova fonte de aleatoriedade.
   *
   * NAO substitui nem altera `generateNoteTimeline` (que continua
   * sendo, sozinha, a unica forma de gerar a sequencia-base de
   * `length` notas usada pelo checksum/validacao existente -- ver
   * SequenceGenerator.generateSequence/calculateChecksum e
   * server/match/matchSequenceResolver.js). Esta funcao so REUTILIZA
   * essa MESMA sequencia-base (chamando exatamente a mesma
   * `SequenceGeneratorRef.generateSequence(seed, length, noteRange)`)
   * e a REPETE CICLICAMENTE (`baseSequence[index % length]`) para
   * preencher os indices adicionais -- a lane da nota `length` e
   * sempre igual a lane da nota `0`, a nota `length + 1` igual a nota
   * `1`, e assim por diante, sempre na MESMA ordem relativa do
   * padrao-base.
   *
   * GARANTIAS (cobertas pelos testes desta etapa):
   * - Determinismo: mesma entrada (seed/length/noteRange/... e o mesmo
   *   `totalLength`/`durationMs`) sempre produz a MESMA timeline.
   * - Ordem temporal crescente: `time` de cada nota e estritamente
   *   maior que o da anterior (mesma acumulacao de `generateNoteTimeline`).
   * - Intervalo preservado: o espacamento entre notas continua vindo de
   *   `noteIntervalMs` (encolhido pela mesma `resolveSpeedMultiplier`
   *   de sempre) -- nenhum novo calculo de intervalo.
   * - `noteRange`: toda lane devolvida sempre veio originalmente de
   *   `baseSequence` (gerada com aquele `noteRange`), entao nunca sai
   *   do intervalo [1, noteRange].
   * - Estrutura da nota: cada item continua `{id, index, lane, time,
   *   state}`, exatamente como `generateNoteTimeline`.
   * - Nao destroi nem modifica a geracao da sequencia-base: o array
   *   `baseSequence` usado aqui e o RESULTADO da mesma chamada que
   *   `generateNoteTimeline` faria para os primeiros `length` indices
   *   -- os primeiros `length` elementos da timeline devolvida aqui
   *   sao equivalentes (mesma lane, mesmo tempo) aos que
   *   `generateNoteTimeline({ seed, startTimestamp, length, noteRange,
   *   noteIntervalMs, leadInMs, difficultyStages })` devolveria,
   *   preservando a possibilidade de validar o checksum do padrao-base
   *   normalmente.
   *
   * Funcao PURA: sem DOM, sem relogio do sistema, sem
   * `setTimeout`/`setInterval`, sem `Math.random()`.
   *
   * ETAPA 16-2A (item 7 do enunciado): esta funcao NAO e chamada por
   * nenhum modo de jogo ainda -- nem MatchTimelineManager, nem main.js,
   * nem botMatchController.js referenciam `generateExtendedTimeline`.
   * A integracao fica para uma proxima etapa.
   *
   * @param {object} options - mesmos campos base de generateNoteTimeline
   *   (seed, startTimestamp, length, noteRange, noteIntervalMs,
   *   leadInMs, difficultyStages), MAIS um dos dois abaixo:
   * @param {number} [options.totalLength] - quantidade total de notas
   *   desejada (inteiro > 0). Se menor que `length`, e elevado para
   *   `length` (o padrao-base nunca e encurtado).
   * @param {number} [options.durationMs] - duracao (ms) que a timeline
   *   deve cobrir; usado para CALCULAR `totalLength` via
   *   `computeNoteCountForDuration` quando `totalLength` nao for
   *   informado diretamente.
   * @returns {Array<{id:string,index:number,lane:number,time:number,state:string}>}
   */
  function generateExtendedTimeline({
    seed,
    startTimestamp,
    length,
    noteRange,
    noteIntervalMs,
    leadInMs = 0,
    difficultyStages,
    totalLength,
    durationMs,
  }) {
    // Mesmas validacoes de base de generateNoteTimeline, duplicadas de
    // proposito aqui (em vez de reaproveitar o corpo daquela funcao)
    // para nao alterar/tocar em generateNoteTimeline de forma alguma.
    if (!Number.isFinite(seed)) {
      throw new Error('NoteEngine: seed invalida.');
    }
    if (!Number.isFinite(startTimestamp)) {
      throw new Error('NoteEngine: startTimestamp invalido.');
    }
    if (!Number.isInteger(length) || length <= 0) {
      throw new Error('NoteEngine: length invalido.');
    }
    if (!Number.isInteger(noteRange) || noteRange <= 0) {
      throw new Error('NoteEngine: noteRange invalido.');
    }
    if (!Number.isFinite(noteIntervalMs) || noteIntervalMs <= 0) {
      throw new Error('NoteEngine: noteIntervalMs invalido.');
    }

    // Resolve quantas notas o resultado final deve ter: `totalLength`
    // explicito tem prioridade (nunca abaixo de `length`); caso
    // contrario, deriva de `durationMs` (ou cai em `length` se nenhum
    // dos dois for informado -- equivalente a nao estender nada).
    let resolvedTotalLength;
    if (Number.isInteger(totalLength) && totalLength > 0) {
      resolvedTotalLength = Math.max(totalLength, length);
    } else {
      resolvedTotalLength = computeNoteCountForDuration({
        length,
        noteIntervalMs,
        leadInMs,
        durationMs,
        difficultyStages,
      });
    }

    // Sequencia-base: EXATAMENTE a mesma chamada que generateNoteTimeline
    // faria (mesma seed, mesmo length, mesmo noteRange) -- nunca gerada
    // com um length maior. Isso e o que preserva o checksum: quem
    // validar apenas os primeiros `length` indices desta timeline
    // estendida ve a mesma sequencia-base de sempre.
    const baseSequence = SequenceGeneratorRef.generateSequence(seed, length, noteRange);

    let elapsedMs = 0;
    const timeline = [];
    for (let index = 0; index < resolvedTotalLength; index++) {
      if (index > 0) {
        const speedMultiplier = resolveSpeedMultiplier(index, difficultyStages);
        elapsedMs += noteIntervalMs / speedMultiplier;
      }

      // Repeticao ciclica e deterministica do padrao-base -- nenhuma
      // nova fonte de aleatoriedade, nenhuma chamada extra a
      // generateSequence/Math.random().
      const lane = baseSequence[index % length];

      timeline.push({
        id: buildNoteId(seed, index),
        index,
        lane,
        time: startTimestamp + leadInMs + elapsedMs,
        state: NOTE_STATE.PENDING,
      });
    }

    return timeline;
  }

  function getNoteById(timeline, noteId) {
    return timeline.find((note) => note.id === noteId) || null;
  }

  function isTerminal(state) {
    return TERMINAL_STATES.has(state);
  }

  /**
   * Tenta transicionar uma nota especifica para um novo estado.
   *
   * Regras:
   * - Nota inexistente => nao faz nada, retorna false.
   * - Nota ja em estado final (hit/missed) => nao faz nada, retorna false.
   *   Isso e o que impede a mesma nota de ser processada duas vezes.
   * - Estado de destino invalido => nao faz nada, retorna false.
   * - Caso contrario, aplica a mudanca e retorna true.
   *
   * @param {Array} timeline
   * @param {string} noteId
   * @param {string} newState
   * @returns {boolean} se a transicao foi aplicada
   */
  function setNoteState(timeline, noteId, newState) {
    if (!VALID_STATES.has(newState)) return false;

    const note = getNoteById(timeline, noteId);
    if (!note) return false;
    if (isTerminal(note.state)) return false;

    note.state = newState;
    return true;
  }

  /**
   * Atualiza automaticamente os estados "pending -> active" e
   * "(pending|active) -> missed" com base no tempo atual.
   *
   * ETAPA 13B — nova mecanica de setas: o jogador nao precisa mais
   * esperar a seta chegar numa area estreita de julgamento; ele pode
   * acerta-la a qualquer momento enquanto ela estiver descendo. Por
   * isso o significado de `hitWindowMs` mudou:
   *
   * - activatesAt = note.time - hitWindowMs -- o instante em que a seta
   *   NASCE no topo da lane (mesmo instante usado pelo NoteRenderer para
   *   comecar a desenha-la). `hitWindowMs` deve ser o tempo total de
   *   queda (ver ClientConfig.NOTE_TRAVEL_MS/NOTE_HIT_WINDOW_MS), nao
   *   mais uma janela estreita.
   * - expiresAt = note.time -- o instante em que a seta chega ao FINAL
   *   do percurso. A partir dali, se ela ainda nao foi processada (hit),
   *   e considerada perdida IMEDIATAMENTE (sem nenhuma margem extra
   *   depois do final) -- e exatamente a regra pedida: "se a seta
   *   chegar ao final do percurso sem o jogador pressionar a tecla
   *   correta, ela deve ser considerada perdida".
   *
   * `currentTime` deve ser calculado no mesmo relogio de referencia do
   * startTimestamp (ver MatchController.startCountdown / clockOffset),
   * nunca em `Date.now()` puro de cada jogador isoladamente.
   *
   * Notas ja em estado final sao ignoradas (nunca reprocessadas) -- por
   * isso uma nota que ja foi "hit" nunca pode ser sobrescrita para
   * "missed" aqui, mesmo muito tempo depois do note.time.
   *
   * @param {Array} timeline
   * @param {number} currentTime - epoch ms estimado do relogio do servidor
   * @param {number} hitWindowMs - duracao (ms) da queda da seta, do
   *   nascimento (topo) ate o final do percurso (note.time). Ver
   *   ClientConfig.NOTE_HIT_WINDOW_MS / NOTE_TRAVEL_MS.
   * @returns {Array} a propria timeline (mutada in-place), por conveniencia
   */
  function updateTimelineStates(timeline, currentTime, hitWindowMs) {
    for (const note of timeline) {
      if (isTerminal(note.state)) continue;

      const activatesAt = note.time - hitWindowMs;
      const expiresAt = note.time;

      if (currentTime > expiresAt) {
        note.state = NOTE_STATE.MISSED;
      } else if (currentTime >= activatesAt && note.state === NOTE_STATE.PENDING) {
        note.state = NOTE_STATE.ACTIVE;
      }
    }
    return timeline;
  }

  const api = {
    NOTE_STATE,
    buildNoteId,
    generateNoteTimeline,
    getNoteById,
    setNoteState,
    updateTimelineStates,
    isTerminal,
    // ETAPA 13E — exposta para teste automatizado direto (funcao pura).
    resolveSpeedMultiplier,
    // ETAPA 16-2A — preparacao da geracao continua de notas (ainda NAO
    // conectada a nenhum modo de jogo). Expostas para teste automatizado
    // direto, no mesmo espirito de resolveSpeedMultiplier acima.
    computeNoteCountForDuration,
    generateExtendedTimeline,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  return api;
})();
