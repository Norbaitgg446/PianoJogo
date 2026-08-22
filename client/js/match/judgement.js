/**
 * Julgamento de tentativas de acerto (Etapa 4B).
 *
 * Modulo puro: nao muda estado de notas nem de jogador, apenas decide
 * (a) qual nota (se alguma) uma tentativa de input deveria julgar, e
 * (b) qual o resultado (PERFECT/GOOD) para uma dada distancia de tempo.
 *
 * Quem efetivamente aplica o resultado (mudar estado da nota, atualizar
 * o PlayerState, disparar evento de rede) e o gameplayEngine.js.
 */
const Judgement = (() => {
  // Em Node (testes) o NoteEngine precisa ser importado via require.
  // No navegador ele ja existe como variavel global (carregado antes
  // deste arquivo via <script> em index.html).
  const NoteEngineRef =
    typeof module !== 'undefined' && module.exports ? require('./noteEngine') : NoteEngine;

  const JUDGEMENT_RESULT = {
    PERFECT: 'PERFECT',
    GOOD: 'GOOD',
    MISS: 'MISS', // usado apenas para notas que expiraram sem input (ver gameplayEngine)
  };

  /**
   * Classifica uma distancia de tempo (ms, pode ser negativa = cedo demais
   * ou positiva = tarde demais) em PERFECT, GOOD, ou null (fora de
   * qualquer janela valida).
   *
   * As janelas ficam totalmente configuraveis via `windows`
   * (ex: ClientConfig.JUDGEMENT_WINDOWS), sem nada fixo no codigo.
   *
   * @param {number} deltaMs - currentTime - note.time
   * @param {{perfectMs:number, goodMs:number}} windows
   * @returns {'PERFECT'|'GOOD'|null}
   */
  function classify(deltaMs, windows) {
    const abs = Math.abs(deltaMs);
    if (abs <= windows.perfectMs) return JUDGEMENT_RESULT.PERFECT;
    if (abs <= windows.goodMs) return JUDGEMENT_RESULT.GOOD;
    return null;
  }

  /**
   * Procura, dentro da lane pressionada, a nota ainda julgavel
   * (nao em estado terminal) mais proxima do tempo atual, DESDE QUE
   * esteja dentro da janela maxima valida (goodMs).
   *
   * Retorna null quando:
   * - nao ha nenhuma nota pendente/active naquela lane dentro da janela
   *   (tecla errada, ou tecla certa mas fora da janela valida) -- isso
   *   e o que o gameplayEngine trata como "erro" do jogador.
   *
   * @param {Array} timeline
   * @param {number} lane
   * @param {number} currentTime
   * @param {{perfectMs:number, goodMs:number}} windows
   */
  function findJudgeableNote(timeline, lane, currentTime, windows) {
    let best = null;
    let bestAbsDelta = Infinity;

    for (const note of timeline) {
      if (note.lane !== lane) continue;
      if (NoteEngineRef.isTerminal(note.state)) continue;

      const absDelta = Math.abs(currentTime - note.time);
      if (absDelta <= windows.goodMs && absDelta < bestAbsDelta) {
        best = note;
        bestAbsDelta = absDelta;
      }
    }

    return best;
  }

  const api = { JUDGEMENT_RESULT, classify, findJudgeableNote };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  return api;
})();
