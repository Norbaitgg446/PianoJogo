/**
 * Testes automatizados da comparacao final da partida (Etapa 6C):
 * determineOutcome (funcao pura, so score) e a persistencia do outcome
 * associada a Match -- SEM UI, SEM WebSocket (isso e testado
 * separadamente em matchFlowFinish.test.js / matchResultBroadcast.test.js).
 *
 * Executar com: node tests/matchOutcome.test.js
 */
const assert = require('assert');
const { Match, MATCH_STATE } = require('../server/match/Match');
const { getMatchResultState } = require('../server/match/matchResultState');
const {
  determineOutcome,
  captureFinalOutcome,
  getFinalOutcome,
  hasFinalOutcome,
  clearFinalOutcome,
} = require('../server/match/matchOutcome');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`OK   - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function finalState(p1Score, p2Score) {
  return {
    player1: { score: p1Score, combo: 0, maxCombo: 0, hits: 0, misses: 0, mistakes: 0 },
    player2: { score: p2Score, combo: 0, maxCombo: 0, hits: 0, misses: 0, mistakes: 0 },
  };
}

// 1. player1 com score maior -> player1_win --------------------------------------
test('player1 com score maior resulta em player1_win', () => {
  const outcome = determineOutcome(finalState(1000, 800));
  assert.strictEqual(outcome.result, 'player1_win');
});

// 2. player2 com score maior -> player2_win --------------------------------------
test('player2 com score maior resulta em player2_win', () => {
  const outcome = determineOutcome(finalState(500, 900));
  assert.strictEqual(outcome.result, 'player2_win');
});

// 3. scores iguais -> draw -----------------------------------------------------------
test('scores iguais resultam em draw', () => {
  const outcome = determineOutcome(finalState(700, 700));
  assert.strictEqual(outcome.result, 'draw');
});

// 4. winner correto no player1_win -----------------------------------------------
test('winner e "player1" quando player1 vence', () => {
  const outcome = determineOutcome(finalState(1000, 800));
  assert.strictEqual(outcome.winner, 'player1');
});

// 5. winner correto no player2_win -----------------------------------------------
test('winner e "player2" quando player2 vence', () => {
  const outcome = determineOutcome(finalState(500, 900));
  assert.strictEqual(outcome.winner, 'player2');
});

// 6. winner null no draw --------------------------------------------------------------
test('winner e null no empate', () => {
  const outcome = determineOutcome(finalState(700, 700));
  assert.strictEqual(outcome.winner, null);
});

// 7. loser correto no player1_win -------------------------------------------------
test('loser e "player2" quando player1 vence', () => {
  const outcome = determineOutcome(finalState(1000, 800));
  assert.strictEqual(outcome.loser, 'player2');
});

// 8. loser correto no player2_win -------------------------------------------------
test('loser e "player1" quando player2 vence', () => {
  const outcome = determineOutcome(finalState(500, 900));
  assert.strictEqual(outcome.loser, 'player1');
});

// 9. loser null no draw ----------------------------------------------------------------
test('loser e null no empate', () => {
  const outcome = determineOutcome(finalState(700, 700));
  assert.strictEqual(outcome.loser, null);
});

// 20. partida com score 0 x 0 resulta em draw ------------------------------------
test('0 x 0 (partida sem nenhum acerto de ninguem) resulta em draw', () => {
  const outcome = determineOutcome(finalState(0, 0));
  assert.deepStrictEqual(outcome, { result: 'draw', winner: null, loser: null });
});

// Combo/hits/misses/mistakes nunca influenciam o resultado ------------------------
test('combo, maxCombo, hits, misses e mistakes nunca sao usados como desempate', () => {
  const state = {
    player1: { score: 500, combo: 0, maxCombo: 0, hits: 1, misses: 50, mistakes: 50 },
    player2: { score: 500, combo: 99, maxCombo: 99, hits: 200, misses: 0, mistakes: 0 },
  };
  // Mesmo com player2 aparentando ter jogado muito melhor em tudo, o
  // score identico deve obrigatoriamente resultar em empate.
  assert.deepStrictEqual(determineOutcome(state), { result: 'draw', winner: null, loser: null });
});

// determineOutcome com finalState invalido -----------------------------------------
test('determineOutcome devolve null se o finalState nao tiver os dois jogadores', () => {
  assert.strictEqual(determineOutcome(null), null);
  assert.strictEqual(determineOutcome({ player1: { score: 10 }, player2: null }), null);
  assert.strictEqual(determineOutcome({}), null);
});

// 10. Nao calcular outcome enquanto PLAYING ------------------------------------------
test('nao ha outcome enquanto a partida ainda esta em PLAYING (sem finalState disponivel)', () => {
  const match = new Match('ROOM-OUTCOME-PLAYING');
  match.setState(MATCH_STATE.PLAYING);

  // Enquanto PLAYING, nao existe finalState (finalMatchState se recusa a
  // capturar) -- captureFinalOutcome precisa se recusar tambem quando
  // recebe um finalState nulo/ausente.
  const outcome = captureFinalOutcome(match, null);

  assert.strictEqual(outcome, null);
  assert.strictEqual(hasFinalOutcome(match), false);
  assert.strictEqual(getFinalOutcome(match), null);
});

// 12. captureFinalOutcome gera o outcome a partir de um finalState valido ----------
test('captureFinalOutcome gera e guarda o outcome a partir de um finalState valido', () => {
  const match = new Match('ROOM-OUTCOME-VALID');
  match.setState(MATCH_STATE.FINISHED);

  const outcome = captureFinalOutcome(match, finalState(1200, 900));

  assert.deepStrictEqual(outcome, { result: 'player1_win', winner: 'player1', loser: 'player2' });
  assert.strictEqual(hasFinalOutcome(match), true);
  assert.strictEqual(getFinalOutcome(match), outcome);
});

// 13. Segunda tentativa nao substitui/duplica o resultado ---------------------------
test('captureFinalOutcome chamado duas vezes nunca substitui o outcome original', () => {
  const match = new Match('ROOM-OUTCOME-TWICE');
  match.setState(MATCH_STATE.FINISHED);

  const first = captureFinalOutcome(match, finalState(1000, 500));
  // Um segundo finalState completamente diferente nao pode mudar nada.
  const second = captureFinalOutcome(match, finalState(0, 5000));

  assert.strictEqual(first, second);
  assert.strictEqual(second.result, 'player1_win');
});

// Snapshot -> outcome usando exclusivamente o snapshot da 6A/6B --------------------
test('captureFinalOutcome usa o mesmo formato de getMatchResultState (6A), sem copia paralela', () => {
  const match = new Match('ROOM-OUTCOME-FROM-STATE');
  match.players.player1.score = 300;
  match.players.player2.score = 300;
  match.setState(MATCH_STATE.FINISHED);

  const state = getMatchResultState(match);
  const outcome = captureFinalOutcome(match, state);

  assert.deepStrictEqual(outcome, { result: 'draw', winner: null, loser: null });
});

// Outcome e imutavel -------------------------------------------------------------------
test('outcome guardado e congelado (mutar o retorno nao afeta o guardado)', () => {
  const match = new Match('ROOM-OUTCOME-FREEZE');
  match.setState(MATCH_STATE.FINISHED);

  const outcome = captureFinalOutcome(match, finalState(10, 5));
  assert.throws(() => {
    'use strict';
    outcome.winner = 'player2';
  });

  assert.strictEqual(getFinalOutcome(match).winner, 'player1');
});

// 21. Resultado permanece consistente apos ser armazenado --------------------------
test('getFinalOutcome sempre devolve o mesmo outcome, chamado quantas vezes for', () => {
  const match = new Match('ROOM-OUTCOME-CONSISTENT');
  match.setState(MATCH_STATE.FINISHED);

  captureFinalOutcome(match, finalState(42, 10));

  const a = getFinalOutcome(match);
  const b = getFinalOutcome(match);
  const c = getFinalOutcome(match);

  assert.strictEqual(a, b);
  assert.strictEqual(b, c);
  assert.deepStrictEqual(a, { result: 'player1_win', winner: 'player1', loser: 'player2' });
});

// clearFinalOutcome / isolamento entre partidas -------------------------------------
test('clearFinalOutcome descarta o outcome guardado para uma Match', () => {
  const match = new Match('ROOM-OUTCOME-CLEAR');
  match.setState(MATCH_STATE.FINISHED);

  captureFinalOutcome(match, finalState(5, 1));
  assert.strictEqual(hasFinalOutcome(match), true);

  clearFinalOutcome(match);

  assert.strictEqual(hasFinalOutcome(match), false);
  assert.strictEqual(getFinalOutcome(match), null);
});

// 17. Nova partida nunca herda o outcome anterior -----------------------------------
test('uma nova Match (ex: revanche) nunca herda o outcome de uma partida anterior', () => {
  const oldMatch = new Match('ROOM-OUTCOME-OLD');
  oldMatch.setState(MATCH_STATE.FINISHED);
  captureFinalOutcome(oldMatch, finalState(999, 1));
  assert.strictEqual(hasFinalOutcome(oldMatch), true);

  // Mesma sala, mas uma instancia de Match totalmente nova -- exatamente
  // o que rematchFlow.startRematch faz (new Match(room.code)).
  const newMatch = new Match('ROOM-OUTCOME-OLD');

  assert.strictEqual(hasFinalOutcome(newMatch), false);
  assert.strictEqual(getFinalOutcome(newMatch), null);

  // O outcome da partida antiga continua intacto.
  assert.strictEqual(getFinalOutcome(oldMatch).result, 'player1_win');
});

// Funcoes publicas degradam com seguranca -------------------------------------------
test('funcoes publicas degradam com seguranca para match/finalState invalidos', () => {
  assert.strictEqual(captureFinalOutcome(null, finalState(1, 0)), null);
  assert.strictEqual(getFinalOutcome(null), null);
  assert.strictEqual(hasFinalOutcome(null), false);
  assert.doesNotThrow(() => clearFinalOutcome(null));
});

console.log(`\n${passed} teste(s) passaram.`);
