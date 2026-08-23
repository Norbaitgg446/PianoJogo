/**
 * Resultado final da partida (Etapa 5B-4B).
 *
 * Responsabilidade unica: a partir do PlayerState de UM jogador (ja
 * mantido e atualizado por GameplayEngine/PlayerState durante toda a
 * partida) e do tamanho real da timeline (MatchTimelineManager/NoteEngine),
 * montar um objeto simples com o resultado final desse jogador.
 *
 * Este modulo NAO:
 * - conta hits/misses/mistakes por conta propria -- le exclusivamente
 *   os campos ja mantidos por PlayerState (score, maxCombo, hits,
 *   misses, mistakes), nunca reprocessando a timeline nota a nota;
 * - decide vencedor/perdedor nem compara dois jogadores entre si --
 *   cada chamada produz o resultado de UM jogador, isolado; comparar
 *   os dois fica para uma etapa futura;
 * - sabe nada sobre DOM, WebSocket, tela de resultado, animacoes, etc.
 *
 * MOMENTO DE GERACAO: quem usa este modulo (main.js) so deve chamar
 * `generateResult` uma unica vez, dentro do callback `onMatchEnd` do
 * MatchEndDetector (Etapa 5B-4A) -- nunca a cada frame. Este modulo em
 * si nao se conecta a nenhum loop/timer/evento; ele so calcula quando
 * mandarem calcular.
 *
 * ETAPA 13F — PARTE 1: a tela de resultado (Solo e Multiplayer, que
 * SEMPRE mostram o resultado do jogador LOCAL a partir do PlayerState
 * dele -- ver client/js/main.js#handleLocalMatchEnd, chamado
 * identicamente nos dois modos) precisa, alem dos campos ja existentes,
 * de: contagem de PERFECT/GREAT/GOOD (que juntas ja compunham `hits`),
 * maior multiplicador de combo atingido, e uma precisao (%) que tambem
 * considere ERRO (mistakes) e MISS -- nao so os acertos sobre o total de
 * notas da musica. Nenhum campo antigo foi removido; `hits`, `misses`,
 * `mistakes`, `maxCombo`, `score` e `totalNotes` continuam com o EXATO
 * mesmo significado de antes. O Modo Teste (localServerSimulator) nao
 * precisa de nenhuma mudanca aqui: ele tambem so mostra o resultado via
 * este mesmo caminho (PlayerState local + timeline local), nunca via
 * server/match/* (ver server/match/matchResultState.js, que continua
 * inalterado -- essa e a fonte de verdade so do FLUXO multiplayer de
 * vencedor/perdedor por score, nunca da tela de resultado em si).
 *
 * CICLO DE VIDA: assim como MatchTimelineManager, este modulo guarda
 * o resultado ATIVO (do jogador local deste cliente) internamente, para
 * que qualquer parte do cliente possa perguntar "ja existe resultado?"
 * / "qual foi o resultado?" sem precisar recalcular nem repassar o
 * objeto manualmente. `clearResult()` descarta esse resultado guardado
 * -- deve ser chamado ao cancelar uma partida (sem gerar resultado
 * nenhum) e no inicio de toda partida nova (para que o resultado
 * antigo nunca vaze para a partida seguinte).
 */
const MatchResult = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;

  // Casas decimais usadas para arredondar a precisao -- evita numeros
  // como 82.66666666666667% e mantem o arredondamento sempre consistente
  // em qualquer lugar que este modulo seja usado.
  const ACCURACY_DECIMAL_PLACES = 2;

  let currentResult = null;

  /**
   * ETAPA 13F — funcao PURA e deterministica, unico lugar do projeto
   * onde a formula de precisao (%) e calculada. Considera exatamente os
   * cinco julgamentos que ja existem no sistema (nenhum julgamento novo
   * inventado):
   *
   *   precisao = (PERFECT + GREAT + GOOD) / (PERFECT + GREAT + GOOD + ERRO + MISS) * 100
   *
   * ou seja, acertos (qualquer um dos tres julgamentos de hit) sobre o
   * total de "tentativas julgadas" da partida -- um acerto conta
   * inteiro, um ERRO (tecla errada/fora de janela) ou um MISS (nota
   * expirada) conta contra a precisao, exatamente como cada um deles ja
   * conta contra o combo (ambos zeram o combo em PlayerState). Nenhum
   * julgamento tem peso parcial -- mantem a formula simples e coerente
   * com o restante do sistema (que tambem nao pondera hits por
   * julgamento na hora de somar `hits`).
   *
   * Quando o total de tentativas e 0 (partida sem nenhum evento
   * julgavel, ex: 0 notas), devolve 0 em vez de dividir por zero.
   * Arredondada para ACCURACY_DECIMAL_PLACES casas decimais.
   *
   * @param {{perfectCount?:number, greatCount?:number, goodCount?:number,
   *   mistakes?:number, misses?:number}} counts
   * @returns {number}
   */
  function calculateAccuracy(counts) {
    const perfectCount = (counts && counts.perfectCount) || 0;
    const greatCount = (counts && counts.greatCount) || 0;
    const goodCount = (counts && counts.goodCount) || 0;
    const erroCount = (counts && counts.mistakes) || 0;
    const missCount = (counts && counts.misses) || 0;

    const hits = perfectCount + greatCount + goodCount;
    const total = hits + erroCount + missCount;

    if (!Number.isFinite(total) || total <= 0) return 0;

    const raw = (hits / total) * 100;
    const factor = 10 ** ACCURACY_DECIMAL_PLACES;
    return Math.round(raw * factor) / factor;
  }

  /**
   * Monta (sem guardar internamente) o objeto de resultado de UM
   * jogador, a partir do PlayerState dele e da timeline da partida.
   *
   * Todos os campos sao copiados por VALOR (numeros primitivos) do
   * PlayerState no exato instante da chamada -- o objeto devolvido e um
   * retrato (snapshot) independente: mudancas futuras no PlayerState
   * (nao deveria haver nenhuma depois do fim da partida, ja que o
   * MatchEndDetector bloqueia novos inputs, mas mesmo que houvesse) nao
   * afetam mais este resultado ja gerado.
   *
   * ETAPA 13F — alem dos campos ja existentes, o resultado agora tambem
   * traz a contagem separada de PERFECT/GREAT/GOOD (`perfectCount`/
   * `greatCount`/`goodCount`, que juntas ja somavam `hits` antes desta
   * etapa e continuam somando) e o maior multiplicador de combo
   * atingido (`maxMultiplier`) -- ambos lidos diretamente de
   * PlayerState, exatamente como os campos antigos, sem reprocessar a
   * timeline nem inventar uma segunda contagem. `accuracy` passa a ser
   * calculada pela formula centralizada (ver calculateAccuracy acima),
   * que agora tambem considera ERRO/MISS, nao so hits/totalNotes.
   *
   * @param {object} options
   * @param {object} options.playerState - PlayerState.createPlayerState() do jogador (ja existente)
   * @param {Array} options.timeline - timeline da partida (ja existente); usada
   *   apenas para saber `totalNotes` (timeline.length), nunca reprocessada nota a nota
   * @returns {{score:number,maxCombo:number,maxMultiplier:number,hits:number,
   *   perfectCount:number,greatCount:number,goodCount:number,misses:number,
   *   mistakes:number,totalNotes:number,accuracy:number}}
   */
  function buildResult({ playerState, timeline }) {
    const totalNotes = Array.isArray(timeline) ? timeline.length : 0;
    const hits = (playerState && playerState.hits) || 0;
    const misses = (playerState && playerState.misses) || 0;
    const mistakes = (playerState && playerState.mistakes) || 0;
    const score = (playerState && playerState.score) || 0;
    const maxCombo = (playerState && playerState.maxCombo) || 0;
    const perfectCount = (playerState && playerState.perfectCount) || 0;
    const greatCount = (playerState && playerState.greatCount) || 0;
    const goodCount = (playerState && playerState.goodCount) || 0;
    const maxMultiplier =
      playerState && Number.isFinite(playerState.maxMultiplier) ? playerState.maxMultiplier : 1;

    return {
      score,
      maxCombo,
      maxMultiplier,
      hits,
      perfectCount,
      greatCount,
      goodCount,
      misses,
      mistakes,
      totalNotes,
      accuracy: calculateAccuracy({ perfectCount, greatCount, goodCount, mistakes, misses }),
    };
  }

  /**
   * Gera o resultado final do jogador LOCAL e o guarda como resultado
   * ativo (substitui qualquer resultado anterior). Deve ser chamado uma
   * unica vez, no callback de fim de partida (MatchEndDetector.onMatchEnd).
   *
   * @param {object} options - mesmos parametros de buildResult
   * @returns {object} o resultado recem-gerado (mesma referencia que getResult() passa a devolver)
   */
  function generateResult({ playerState, timeline }) {
    currentResult = buildResult({ playerState, timeline });
    return currentResult;
  }

  /**
   * Resultado ativo no momento (do jogador local desta partida), ou
   * `null` se a partida atual ainda nao terminou / foi cancelada / nao
   * ha nenhuma partida em andamento.
   */
  function getResult() {
    return currentResult;
  }

  /**
   * Se ja existe um resultado gerado para a partida atual.
   */
  function hasResult() {
    return currentResult !== null;
  }

  /**
   * Descarta o resultado ativo. Chamado ao cancelar uma partida (nenhum
   * resultado deve ter sido gerado nesse caso, mas garante que nao
   * sobra nada de uma tentativa anterior) e no inicio de toda partida
   * nova, para impedir que o resultado da partida anterior "vaze" para
   * a proxima.
   */
  function clearResult() {
    currentResult = null;
  }

  const api = {
    calculateAccuracy,
    buildResult,
    generateResult,
    getResult,
    hasResult,
    clearResult,
  };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
