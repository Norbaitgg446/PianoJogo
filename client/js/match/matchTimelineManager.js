/**
 * Ciclo de vida da timeline de notas do cliente (Etapa 5B-2A).
 *
 * Este modulo NAO gera notas por conta propria -- ele apenas decide
 * QUANDO chamar `NoteEngine.generateNoteTimeline()` (a unica fonte de
 * geracao de notas do projeto, ja existente desde a Etapa 4A) e guarda
 * o resultado para o resto do cliente (GameplayEngine) usar durante a
 * partida.
 *
 * Responsabilidade unica: ciclo de vida.
 *   - criar a timeline UMA VEZ quando uma partida comeca;
 *   - manter essa mesma instancia disponivel enquanto a partida dura;
 *   - descartar ao finalizar/cancelar;
 *   - recriar corretamente para a proxima partida.
 *
 * Nao sabe nada sobre WebSocket, DOM, GameplayEngine ou UI -- por isso
 * da para testar o ciclo de vida inteiro em Node puro.
 *
 * DEDUPLICACAO: cada partida e identificada pelo par (seed,
 * startTimestamp) -- os dois valores definidos exclusivamente pelo
 * servidor e ja usados hoje para sincronizar o inicio da partida (ver
 * MatchController) e a sequencia de notas (ver SequenceGenerator). Se
 * `ensureTimeline` for chamada de novo com o MESMO par (ex: uma
 * mensagem `match_started` duplicada chegando da rede), a timeline
 * JA CRIADA e devolvida sem regenerar -- isso e o que impede que duas
 * timelines da mesma partida sejam criadas por acidente, e evita
 * jogar fora o progresso (notas ja hit/missed) por causa de uma
 * mensagem repetida. Um par diferente (nova partida, nova seed do
 * servidor) sempre gera uma timeline nova automaticamente, mesmo que
 * `clear()` nao tenha sido chamado antes.
 */
const MatchTimelineManager = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;
  const NoteEngineRef = isNode ? require('./noteEngine') : NoteEngine;

  let currentTimeline = null;
  let currentMatchKey = null;

  function buildMatchKey(seed, startTimestamp) {
    return `${seed}:${startTimestamp}`;
  }

  /**
   * Garante que existe uma timeline para a partida identificada por
   * (seed, startTimestamp), criando-a apenas se ainda nao existir.
   *
   * @param {object} options - mesmos parametros de NoteEngine.generateNoteTimeline
   * @param {number} options.seed
   * @param {number} options.startTimestamp
   * @param {number} options.length
   * @param {number} options.noteRange
   * @param {number} options.noteIntervalMs
   * @param {number} [options.leadInMs]
   * @returns {Array} a timeline ativa (nova ou ja existente) desta partida
   */
  function ensureTimeline({ seed, startTimestamp, length, noteRange, noteIntervalMs, leadInMs }) {
    const key = buildMatchKey(seed, startTimestamp);

    if (currentTimeline && currentMatchKey === key) {
      // Mesma partida (mesma seed + mesmo startTimestamp) -- nao recria.
      return currentTimeline;
    }

    // Partida diferente da que estava ativa (ou nenhuma ativa ainda):
    // gera exclusivamente via NoteEngine.generateNoteTimeline, sem
    // nenhum gerador ou sistema de timeline alternativo.
    currentTimeline = NoteEngineRef.generateNoteTimeline({
      seed,
      startTimestamp,
      length,
      noteRange,
      noteIntervalMs,
      leadInMs,
    });
    currentMatchKey = key;

    return currentTimeline;
  }

  /**
   * Timeline atualmente ativa (ou null se nenhuma partida em andamento).
   */
  function getTimeline() {
    return currentTimeline;
  }

  /**
   * Descarta a timeline ativa. Chamado quando a partida termina ou e
   * cancelada. Depois disso, `ensureTimeline` sempre gera uma timeline
   * nova na proxima chamada (nao ha mais chave anterior para comparar).
   */
  function clear() {
    currentTimeline = null;
    currentMatchKey = null;
  }

  const api = { ensureTimeline, getTimeline, clear };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
