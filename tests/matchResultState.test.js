/**
 * Testes automatizados do estado de resultado multiplayer (Etapa 6A):
 * apenas a estrutura de leitura/projecao de player1 e player2 a partir
 * de uma Match -- SEM comparacao, SEM vencedor/empate (isso fica para a
 * proxima etapa).
 *
 * Executar com: node tests/matchResultState.test.js
 */
const assert = require('assert');
const { Match } = require('../server/match/Match');
const {
  RESULT_FIELDS,
  getPlayerResultState,
  getMatchResultState,
} = require('../server/match/matchResultState');

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

// 1. Estrutura valida para player1 -------------------------------------------
test('getPlayerResultState devolve estrutura valida para player1', () => {
  const match = new Match('ROOM1');
  const result = getPlayerResultState(match, 'player1');

  assert.ok(result, 'deveria devolver um objeto para player1');
  RESULT_FIELDS.forEach((field) => {
    assert.ok(Object.prototype.hasOwnProperty.call(result, field), `campo "${field}" ausente`);
  });
  // Nenhum campo extra alem dos esperados.
  assert.deepStrictEqual(Object.keys(result).sort(), [...RESULT_FIELDS].sort());
});

// 2. Estrutura valida para player2 -------------------------------------------
test('getPlayerResultState devolve estrutura valida para player2', () => {
  const match = new Match('ROOM2');
  const result = getPlayerResultState(match, 'player2');

  assert.ok(result, 'deveria devolver um objeto para player2');
  RESULT_FIELDS.forEach((field) => {
    assert.ok(Object.prototype.hasOwnProperty.call(result, field), `campo "${field}" ausente`);
  });
  assert.deepStrictEqual(Object.keys(result).sort(), [...RESULT_FIELDS].sort());
});

// 3. Valores padrao corretos ---------------------------------------------------
test('valores padrao de uma partida nova sao todos zero para os dois jogadores', () => {
  const match = new Match('ROOM3');
  const state = getMatchResultState(match);

  assert.deepStrictEqual(state.player1, {
    score: 0,
    combo: 0,
    maxCombo: 0,
    hits: 0,
    misses: 0,
    mistakes: 0,
  });
  assert.deepStrictEqual(state.player2, {
    score: 0,
    combo: 0,
    maxCombo: 0,
    hits: 0,
    misses: 0,
    mistakes: 0,
  });
});

// 4. Partida com dois jogadores possui os dois estados -------------------------
test('getMatchResultState devolve player1 e player2 ao mesmo tempo', () => {
  const match = new Match('ROOM4');
  const state = getMatchResultState(match);

  assert.ok(state.player1, 'player1 deveria estar presente');
  assert.ok(state.player2, 'player2 deveria estar presente');
});

// 5. Isolamento entre os dois jogadores -----------------------------------------
test('alterar match.players.player1 nao afeta o snapshot de player2', () => {
  const match = new Match('ROOM5');
  match.players.player1.score = 500;
  match.players.player1.hits = 3;
  match.players.player1.combo = 3;
  match.players.player1.maxCombo = 3;

  const state = getMatchResultState(match);

  assert.strictEqual(state.player1.score, 500);
  assert.strictEqual(state.player1.hits, 3);

  assert.strictEqual(state.player2.score, 0, 'player2 nao deveria ter sido alterado');
  assert.strictEqual(state.player2.hits, 0, 'player2 nao deveria ter sido alterado');
});

// 6. Atualizacao de um jogador nao altera o outro (sentido inverso) ------------
test('alterar match.players.player2 nao afeta o snapshot de player1', () => {
  const match = new Match('ROOM6');
  match.players.player2.misses = 4;
  match.players.player2.mistakes = 2;
  match.players.player2.combo = 0;

  const state = getMatchResultState(match);

  assert.strictEqual(state.player2.misses, 4);
  assert.strictEqual(state.player2.mistakes, 2);

  assert.strictEqual(state.player1.misses, 0, 'player1 nao deveria ter sido alterado');
  assert.strictEqual(state.player1.mistakes, 0, 'player1 nao deveria ter sido alterado');
});

// 7. Snapshot e uma copia, nao uma referencia -----------------------------------
test('snapshot devolvido e independente do objeto interno da match (copia por valor)', () => {
  const match = new Match('ROOM7');
  const snapshot = getPlayerResultState(match, 'player1');

  snapshot.score = 9999;

  assert.strictEqual(match.players.player1.score, 0, 'mutar o snapshot nao pode afetar match.players');
});

// 8. Partida nova comeca com estados limpos (sem vazamento entre instancias) ---
test('cada nova Match comeca com estados limpos, independentes de outras partidas', () => {
  const matchA = new Match('ROOM8A');
  matchA.players.player1.score = 1000;
  matchA.players.player1.maxCombo = 50;
  matchA.players.player2.misses = 10;

  const matchB = new Match('ROOM8B');
  const stateB = getMatchResultState(matchB);

  assert.deepStrictEqual(stateB.player1, {
    score: 0,
    combo: 0,
    maxCombo: 0,
    hits: 0,
    misses: 0,
    mistakes: 0,
  });
  assert.deepStrictEqual(stateB.player2, {
    score: 0,
    combo: 0,
    maxCombo: 0,
    hits: 0,
    misses: 0,
    mistakes: 0,
  });

  // Garantia extra: a partida anterior (matchA) continua com seus proprios
  // valores, sem influencia da nova partida (matchB) nem vice-versa.
  const stateA = getMatchResultState(matchA);
  assert.strictEqual(stateA.player1.score, 1000);
  assert.strictEqual(stateA.player1.maxCombo, 50);
  assert.strictEqual(stateA.player2.misses, 10);
});

// 9. Slot invalido / match invalida nao quebra o modulo -------------------------
test('getPlayerResultState devolve null para slot ou match invalidos', () => {
  const match = new Match('ROOM9');
  assert.strictEqual(getPlayerResultState(match, 'player3'), null);
  assert.strictEqual(getPlayerResultState(null, 'player1'), null);
});

console.log(`\n${passed} teste(s) passaram.`);
