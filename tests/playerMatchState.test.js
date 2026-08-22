/**
 * Testes automatizados do estado oficial de partida por jogador
 * (Etapa 7A): criacao/reset/atualizacao/snapshot em cima da estrutura
 * ja existente em Match.players -- SEM vencedor/empate/resultado final
 * (isso continua em matchOutcome.js / finalMatchState.js).
 *
 * Executar com: node tests/playerMatchState.test.js
 */
const assert = require('assert');
const { Match } = require('../server/match/Match');
const {
  createInitialPlayerMatchState,
  resetPlayerMatchState,
  resetAllPlayersMatchState,
  updatePlayerMatchState,
  getPlayerMatchState,
} = require('../server/match/playerMatchState');

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

const ZERO_STATE = {
  score: 0,
  combo: 0,
  maxCombo: 0,
  hits: 0,
  misses: 0,
  mistakes: 0,
};

// 1. Match comeca com player1 zerado -----------------------------------------
test('Match comeca com player1 zerado', () => {
  const match = new Match('R1');
  assert.deepStrictEqual(getPlayerMatchState(match, 'player1'), ZERO_STATE);
});

// 2. Match comeca com player2 zerado -----------------------------------------
test('Match comeca com player2 zerado', () => {
  const match = new Match('R2');
  assert.deepStrictEqual(getPlayerMatchState(match, 'player2'), ZERO_STATE);
});

// 3. score e atualizado --------------------------------------------------------
test('score e atualizado via updatePlayerMatchState', () => {
  const match = new Match('R3');
  updatePlayerMatchState(match, 'player1', { score: 1500 });
  assert.strictEqual(match.players.player1.score, 1500);
  assert.strictEqual(getPlayerMatchState(match, 'player1').score, 1500);
});

// 4. combo e atualizado --------------------------------------------------------
test('combo e atualizado via updatePlayerMatchState', () => {
  const match = new Match('R4');
  updatePlayerMatchState(match, 'player1', { combo: 7 });
  assert.strictEqual(match.players.player1.combo, 7);
});

// 5. maxCombo e preservado corretamente ----------------------------------------
test('maxCombo nunca diminui durante a mesma partida', () => {
  const match = new Match('R5');
  updatePlayerMatchState(match, 'player1', { combo: 10 });
  assert.strictEqual(match.players.player1.maxCombo, 10);

  updatePlayerMatchState(match, 'player1', { combo: 3 });
  assert.strictEqual(match.players.player1.combo, 3);
  assert.strictEqual(match.players.player1.maxCombo, 10, 'maxCombo nao deveria diminuir');

  updatePlayerMatchState(match, 'player1', { combo: 15 });
  assert.strictEqual(match.players.player1.maxCombo, 15, 'maxCombo deve subir quando combo ultrapassa o maximo');
});

// 6. hits sao acumulados --------------------------------------------------------
test('hits sao acumulados manualmente pelo chamador (campo aceita incremento)', () => {
  const match = new Match('R6');
  updatePlayerMatchState(match, 'player1', { hits: match.players.player1.hits + 1 });
  updatePlayerMatchState(match, 'player1', { hits: match.players.player1.hits + 1 });
  assert.strictEqual(match.players.player1.hits, 2);
});

// 7. misses sao acumulados -------------------------------------------------------
test('misses sao acumulados manualmente pelo chamador (campo aceita incremento)', () => {
  const match = new Match('R7');
  updatePlayerMatchState(match, 'player1', { misses: match.players.player1.misses + 1 });
  updatePlayerMatchState(match, 'player1', { misses: match.players.player1.misses + 1 });
  updatePlayerMatchState(match, 'player1', { misses: match.players.player1.misses + 1 });
  assert.strictEqual(match.players.player1.misses, 3);
});

// 8. mistakes sao acumulados -------------------------------------------------------
test('mistakes sao acumulados manualmente pelo chamador (campo aceita incremento)', () => {
  const match = new Match('R8');
  updatePlayerMatchState(match, 'player2', { mistakes: match.players.player2.mistakes + 1 });
  assert.strictEqual(match.players.player2.mistakes, 1);
});

// 9. player1 e isolado de player2 -------------------------------------------------
test('atualizar player1 nao afeta player2', () => {
  const match = new Match('R9');
  updatePlayerMatchState(match, 'player1', { score: 999, combo: 5, hits: 5 });
  assert.deepStrictEqual(getPlayerMatchState(match, 'player2'), ZERO_STATE);
});

// 10. player2 e isolado de player1 -------------------------------------------------
test('atualizar player2 nao afeta player1', () => {
  const match = new Match('R10');
  updatePlayerMatchState(match, 'player2', { score: 321, misses: 4, mistakes: 2 });
  assert.deepStrictEqual(getPlayerMatchState(match, 'player1'), ZERO_STATE);
});

// 11. duas Matches possuem estados independentes -----------------------------------
test('duas Matches diferentes possuem estados totalmente independentes', () => {
  const matchA = new Match('R11A');
  const matchB = new Match('R11B');

  updatePlayerMatchState(matchA, 'player1', { score: 5000, combo: 20 });

  assert.strictEqual(matchA.players.player1.score, 5000);
  assert.deepStrictEqual(getPlayerMatchState(matchB, 'player1'), ZERO_STATE);
  assert.deepStrictEqual(getPlayerMatchState(matchB, 'player2'), ZERO_STATE);
});

// 12. nova Match comeca zerada (nenhuma pontuacao antiga sobrevive) ----------------
test('uma nova Match nunca herda estado de uma Match anterior', () => {
  const matchOld = new Match('R12OLD');
  updatePlayerMatchState(matchOld, 'player1', { score: 7777, combo: 40 });
  updatePlayerMatchState(matchOld, 'player2', { misses: 9 });

  const matchNew = new Match('R12NEW');
  assert.deepStrictEqual(getPlayerMatchState(matchNew, 'player1'), ZERO_STATE);
  assert.deepStrictEqual(getPlayerMatchState(matchNew, 'player2'), ZERO_STATE);
});

// 13. snapshot e uma copia segura -----------------------------------------------------
test('getPlayerMatchState devolve uma copia (nao a referencia interna)', () => {
  const match = new Match('R13');
  updatePlayerMatchState(match, 'player1', { score: 42 });

  const snapshot = getPlayerMatchState(match, 'player1');
  assert.deepStrictEqual(snapshot, { ...ZERO_STATE, score: 42 });
  assert.notStrictEqual(snapshot, match.players.player1, 'snapshot nao pode ser a mesma referencia');
});

// 14. alterar snapshot nao altera a Match ------------------------------------------
test('mutar o snapshot devolvido nao altera match.players', () => {
  const match = new Match('R14');
  const state = getPlayerMatchState(match, 'player1');

  state.score = 999999;
  state.combo = 999;

  assert.strictEqual(match.players.player1.score, 0);
  assert.strictEqual(match.players.player1.combo, 0);
});

// 15. slot invalido e tratado com seguranca -------------------------------------------
test('slot invalido nao quebra o servidor', () => {
  const match = new Match('R15');

  assert.strictEqual(getPlayerMatchState(match, 'player3'), null);
  assert.strictEqual(resetPlayerMatchState(match, 'player3'), false);
  assert.strictEqual(updatePlayerMatchState(match, 'player3', { score: 10 }), false);
  assert.strictEqual(getPlayerMatchState(match, undefined), null);
});

// 16. jogador/Match inexistente e tratado com seguranca ---------------------------------
test('Match nula/indefinida nao quebra o servidor', () => {
  assert.strictEqual(getPlayerMatchState(null, 'player1'), null);
  assert.strictEqual(getPlayerMatchState(undefined, 'player1'), null);
  assert.strictEqual(resetPlayerMatchState(null, 'player1'), false);
  assert.strictEqual(updatePlayerMatchState(null, 'player1', { score: 1 }), false);

  const matchSemPlayers = {};
  assert.strictEqual(getPlayerMatchState(matchSemPlayers, 'player1'), null);
});

// 17. revanche (nova Match apos reset explicito) comeca com estado limpo -----------------
test('resetPlayerMatchState/resetAllPlayersMatchState limpam o estado (cenario de revanche)', () => {
  const match = new Match('R17');
  updatePlayerMatchState(match, 'player1', { score: 100, combo: 8, hits: 8 });
  updatePlayerMatchState(match, 'player2', { score: 80, misses: 3, mistakes: 1 });

  resetAllPlayersMatchState(match);

  assert.deepStrictEqual(getPlayerMatchState(match, 'player1'), ZERO_STATE);
  assert.deepStrictEqual(getPlayerMatchState(match, 'player2'), ZERO_STATE);

  // Reset individual tambem funciona isoladamente.
  updatePlayerMatchState(match, 'player1', { score: 55 });
  resetPlayerMatchState(match, 'player1');
  assert.deepStrictEqual(getPlayerMatchState(match, 'player1'), ZERO_STATE);
});

// 18. nenhuma logica de vencedor e executada neste modulo -----------------------------
test('o modulo nao expoe nenhuma funcao de vencedor/empate/resultado final', () => {
  const playerMatchState = require('../server/match/playerMatchState');
  const exportedNames = Object.keys(playerMatchState);

  const forbiddenKeywords = ['winner', 'vencedor', 'draw', 'empate', 'outcome', 'result', 'final'];
  exportedNames.forEach((name) => {
    const lower = name.toLowerCase();
    forbiddenKeywords.forEach((keyword) => {
      assert.ok(
        !lower.includes(keyword),
        `export "${name}" nao deveria existir neste modulo (parece logica de resultado/vencedor)`
      );
    });
  });

  // createInitialPlayerMatchState tambem nao decide nada sobre vencedor,
  // apenas devolve a estrutura zerada oficial.
  assert.deepStrictEqual(createInitialPlayerMatchState(), ZERO_STATE);
});

console.log(`\n${passed} teste(s) passaram.`);
