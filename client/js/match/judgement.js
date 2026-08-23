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
    GREAT: 'GREAT', // ETAPA 13C — faixa intermediaria entre PERFECT e GOOD
    GOOD: 'GOOD',
    MISS: 'MISS', // usado apenas para notas que expiraram sem input (ver gameplayEngine)
  };

  /**
   * Classifica uma distancia de tempo (ms, pode ser negativa = cedo demais
   * ou positiva = tarde demais) em PERFECT, GREAT, GOOD, ou null (fora de
   * qualquer janela valida).
   *
   * As janelas ficam totalmente configuraveis via `windows`
   * (ex: ClientConfig.JUDGEMENT_WINDOWS), sem nada fixo no codigo.
   *
   * ETAPA 13C: `windows.greatMs` e OPCIONAL. Quando nao informado (ex:
   * chamadores/testes antigos que so passam perfectMs/goodMs), a faixa
   * GREAT simplesmente nao existe e o comportamento continua
   * IDENTICO ao de antes (PERFECT ou GOOD apenas) -- nenhuma janela
   * antiga muda de tamanho so por causa da faixa nova.
   *
   * @param {number} deltaMs - currentTime - note.time
   * @param {{perfectMs:number, greatMs?:number, goodMs:number}} windows
   * @returns {'PERFECT'|'GREAT'|'GOOD'|null}
   */
  function classify(deltaMs, windows) {
    const abs = Math.abs(deltaMs);
    if (abs <= windows.perfectMs) return JUDGEMENT_RESULT.PERFECT;
    if (Number.isFinite(windows.greatMs) && abs <= windows.greatMs) return JUDGEMENT_RESULT.GREAT;
    if (abs <= windows.goodMs) return JUDGEMENT_RESULT.GOOD;
    return null;
  }

  /**
   * Procura, dentro da lane pressionada, a nota ainda julgavel (nao em
   * estado terminal) MAIS ANTIGA da sequencia (menor `index`), DESDE
   * QUE esteja dentro da janela maxima valida (goodMs) em relacao ao
   * tempo atual.
   *
   * ETAPA 13B — nova mecanica de setas: o jogador pode acertar uma seta
   * a qualquer momento enquanto ela estiver descendo, entao `goodMs`
   * agora cobre o percurso inteiro (ver ClientConfig.JUDGEMENT_WINDOWS /
   * NOTE_TRAVEL_MS) em vez de uma janela estreita. Isso torna possivel
   * mais de uma nota da MESMA lane estar dentro da janela ao mesmo
   * tempo (ex: a seta "->" de duas rodadas seguidas da sequencia, ambas
   * ainda caindo na tela). Por isso a escolha deixou de ser "a mais
   * proxima no tempo" e passou a ser SEMPRE "a mais antiga ainda nao
   * processada" -- e o que garante que a ORDEM ORIGINAL da sequencia
   * continua sendo respeitada (o jogador precisa resolver a seta que
   * apareceu primeiro antes de "pular" para a proxima da mesma lane).
   *
   * Retorna null quando:
   * - nao ha nenhuma nota pendente/active naquela lane dentro da janela
   *   (tecla errada, ou tecla certa mas fora da janela valida, ex: seta
   *   ja fora da tela) -- isso e o que o gameplayEngine trata como
   *   "erro" do jogador.
   *
   * @param {Array} timeline
   * @param {number} lane
   * @param {number} currentTime
   * @param {{perfectMs:number, goodMs:number}} windows
   */
  function findJudgeableNote(timeline, lane, currentTime, windows) {
    let best = null;

    for (const note of timeline) {
      if (note.lane !== lane) continue;
      if (NoteEngineRef.isTerminal(note.state)) continue;

      const absDelta = Math.abs(currentTime - note.time);
      if (absDelta > windows.goodMs) continue;

      if (!best || note.index < best.index) {
        best = note;
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
