/**
 * Comparacao final da partida (Etapa 6C).
 *
 * Responsabilidade unica: a partir do estado final JA CAPTURADO pela
 * Etapa 6B (finalMatchState.getMatchResultState-shaped snapshot, com
 * player1/player2), determinar o resultado da partida -- vitoria de
 * player1, vitoria de player2, ou empate -- usando exclusivamente o
 * SCORE como criterio, e guardar esse resultado associado a Match.
 *
 * Este modulo NAO:
 * - le PlayerState do cliente nem qualquer outra fonte -- so recebe o
 *   snapshot ja produzido por finalMatchState (Etapa 6B), que por sua
 *   vez ja veio de matchResultState (Etapa 6A) -- nunca cria uma copia
 *   nova dos scores, apenas olha para o snapshot que ja existe;
 * - usa combo, maxCombo, hits, misses ou mistakes para desempate -- o
 *   unico criterio e score, e scores iguais SEMPRE resultam em empate;
 * - decide QUANDO a partida terminou nem SE ela pode ser comparada
 *   ainda (isso continua sendo decisao de finalMatchState/matchFlow --
 *   este modulo so calcula a partir do finalState que receber; se
 *   receber `null`, nao ha nada a comparar);
 * - envia nada por WebSocket, nao sabe nada de Room/broadcast -- quem
 *   decide o que fazer com o outcome (ex: enviar `match_result`) e
 *   quem chama este modulo (matchFlow.finishMatch);
 * - implementa UI, animacao, ranking, XP, recompensas ou historico.
 *
 * PERSISTENCIA: assim como finalMatchState (Etapa 6B), o outcome fica
 * associado a INSTANCIA da Match, guardado em uma WeakMap privada deste
 * modulo -- sem alterar Match.js, sem depender de roomCode. Isso garante
 * automaticamente que uma partida nova (toda revanche cria uma
 * `new Match(...)`, ver matchFlow.startMatchFlow/rematchFlow, nenhum dos
 * dois alterado aqui) nunca herda o outcome de uma partida anterior --
 * nao existe entrada nesta WeakMap para uma instancia que acabou de ser
 * criada.
 */
const finalOutcomes = new WeakMap();

/**
 * Calcula o resultado da partida a partir do estado final dos dois
 * jogadores, usando exclusivamente o SCORE como criterio:
 *
 * - player1.score > player2.score -> player1 venceu;
 * - player2.score > player1.score -> player2 venceu;
 * - scores iguais (incluindo 0 x 0) -> empate, sempre.
 *
 * Funcao pura: nao guarda nada, nao muda nada, so calcula. Chamar
 * varias vezes com o mesmo `finalState` sempre devolve o mesmo
 * resultado.
 *
 * @param {{player1: {score:number}|null, player2: {score:number}|null}} finalState
 *   o mesmo formato devolvido por finalMatchState.getFinalMatchState /
 *   matchResultState.getMatchResultState.
 * @returns {{result: 'player1_win'|'player2_win'|'draw', winner: 'player1'|'player2'|null, loser: 'player1'|'player2'|null}|null}
 *   `null` se o finalState nao tiver os dois jogadores (ainda nao ha o
 *   que comparar).
 */
function determineOutcome(finalState) {
  if (!finalState || !finalState.player1 || !finalState.player2) return null;

  const player1Score = finalState.player1.score;
  const player2Score = finalState.player2.score;

  if (player1Score > player2Score) {
    return { result: 'player1_win', winner: 'player1', loser: 'player2' };
  }

  if (player2Score > player1Score) {
    return { result: 'player2_win', winner: 'player2', loser: 'player1' };
  }

  // Scores iguais (inclusive 0 x 0): empate, sem nenhum criterio de
  // desempate adicional.
  return { result: 'draw', winner: null, loser: null };
}

/**
 * Calcula (via determineOutcome) e guarda o outcome final desta Match,
 * a partir de um finalState ja capturado (ver finalMatchState).
 *
 * Regras:
 * - se ja existe um outcome guardado para esta Match, ele NUNCA e
 *   recalculado nem substituido -- chamadas seguintes devolvem sempre o
 *   mesmo objeto ja guardado (idempotente, seguro de chamar mais de uma
 *   vez, ex: finishMatch disparado duas vezes);
 * - se `finalState` for invalido/null (ex: a partida ainda esta
 *   PLAYING e finalMatchState se recusou a capturar), nada e calculado
 *   nem guardado -- devolve `null`.
 *
 * @param {import('./Match').Match} match
 * @param {{player1: object|null, player2: object|null}|null} finalState
 * @returns {{result:string, winner:string|null, loser:string|null}|null}
 */
function captureFinalOutcome(match, finalState) {
  if (!match) return null;

  if (finalOutcomes.has(match)) {
    return finalOutcomes.get(match);
  }

  const outcome = determineOutcome(finalState);
  if (!outcome) return null;

  const frozen = Object.freeze({ ...outcome });
  finalOutcomes.set(match, frozen);
  return frozen;
}

/**
 * Devolve o outcome ja guardado para esta Match, ou `null` se ainda nao
 * houver nenhum.
 *
 * @param {import('./Match').Match} match
 * @returns {{result:string, winner:string|null, loser:string|null}|null}
 */
function getFinalOutcome(match) {
  if (!match) return null;
  return finalOutcomes.get(match) || null;
}

/**
 * Se ja existe um outcome guardado para esta Match.
 *
 * @param {import('./Match').Match} match
 * @returns {boolean}
 */
function hasFinalOutcome(match) {
  return Boolean(match) && finalOutcomes.has(match);
}

/**
 * Descarta o outcome guardado para esta Match, se houver.
 *
 * Nao e necessario no fluxo normal de revanche -- cada nova partida ja
 * e uma instancia de Match nova, que nunca tem entrada nesta WeakMap.
 * Fica disponivel para limpeza explicita (ex: testes, cancelamento).
 *
 * @param {import('./Match').Match} match
 */
function clearFinalOutcome(match) {
  if (!match) return;
  finalOutcomes.delete(match);
}

module.exports = {
  determineOutcome,
  captureFinalOutcome,
  getFinalOutcome,
  hasFinalOutcome,
  clearFinalOutcome,
};
