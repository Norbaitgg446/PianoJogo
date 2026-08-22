/**
 * Testes automatizados do snapshot final da partida (Etapa 6B):
 * captura, imutabilidade e isolamento do resultado final dos dois
 * jogadores -- SEM comparacao, SEM vencedor/empate (proxima etapa).
 *
 * Executar com: node tests/finalMatchState.test.js
 */
const assert = require('assert');
const { Match, MATCH_STATE } = require('../server/match/Match');
const {
  captureFinalMatchState,
  getFinalMatchState,
  hasFinalMatchState,
  clearFinalMatchState,
} = require('../server/match/finalMatchState');

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

function createFinishedMatchWithScores({
  roomCode = 'ROOM',
  player1 = {},
  player2 = {},
} = {}) {
  const match = new Match(roomCode);
  Object.assign(match.players.player1, player1);
  Object.assign(match.players.player2, player2);
  match.setState(MATCH_STATE.FINISHED);
  return match;
}

// 1. Capturar estado de player1 -----------------------------------------------
test('captureFinalMatchState captura o estado de player1', () => {
  const match = createFinishedMatchWithScores({
    player1: { score: 1200, hits: 10 },
  });

  const snapshot = captureFinalMatchState(match);

  assert.ok(snapshot.player1, 'player1 deveria estar presente no snapshot');
  assert.strictEqual(snapshot.player1.score, 1200);
  assert.strictEqual(snapshot.player1.hits, 10);
});

// 2. Capturar estado de player2 -----------------------------------------------
test('captureFinalMatchState captura o estado de player2', () => {
  const match = createFinishedMatchWithScores({
    player2: { score: 800, hits: 7 },
  });

  const snapshot = captureFinalMatchState(match);

  assert.ok(snapshot.player2, 'player2 deveria estar presente no snapshot');
  assert.strictEqual(snapshot.player2.score, 800);
  assert.strictEqual(snapshot.player2.hits, 7);
});

// 3. Capturar os dois jogadores juntos -----------------------------------------
test('captureFinalMatchState captura player1 e player2 na mesma chamada', () => {
  const match = createFinishedMatchWithScores({
    player1: { score: 300 },
    player2: { score: 500 },
  });

  const snapshot = captureFinalMatchState(match);

  assert.ok(snapshot.player1);
  assert.ok(snapshot.player2);
  assert.strictEqual(snapshot.player1.score, 300);
  assert.strictEqual(snapshot.player2.score, 500);
});

// 4-9. Preservar cada campo individualmente ------------------------------------
test('preserva score de ambos os jogadores', () => {
  const match = createFinishedMatchWithScores({
    player1: { score: 1500 },
    player2: { score: 1400 },
  });
  const snapshot = captureFinalMatchState(match);
  assert.strictEqual(snapshot.player1.score, 1500);
  assert.strictEqual(snapshot.player2.score, 1400);
});

test('preserva combo de ambos os jogadores', () => {
  const match = createFinishedMatchWithScores({
    player1: { combo: 5 },
    player2: { combo: 0 },
  });
  const snapshot = captureFinalMatchState(match);
  assert.strictEqual(snapshot.player1.combo, 5);
  assert.strictEqual(snapshot.player2.combo, 0);
});

test('preserva maxCombo de ambos os jogadores', () => {
  const match = createFinishedMatchWithScores({
    player1: { maxCombo: 42 },
    player2: { maxCombo: 37 },
  });
  const snapshot = captureFinalMatchState(match);
  assert.strictEqual(snapshot.player1.maxCombo, 42);
  assert.strictEqual(snapshot.player2.maxCombo, 37);
});

test('preserva hits de ambos os jogadores', () => {
  const match = createFinishedMatchWithScores({
    player1: { hits: 88 },
    player2: { hits: 73 },
  });
  const snapshot = captureFinalMatchState(match);
  assert.strictEqual(snapshot.player1.hits, 88);
  assert.strictEqual(snapshot.player2.hits, 73);
});

test('preserva misses de ambos os jogadores', () => {
  const match = createFinishedMatchWithScores({
    player1: { misses: 2 },
    player2: { misses: 9 },
  });
  const snapshot = captureFinalMatchState(match);
  assert.strictEqual(snapshot.player1.misses, 2);
  assert.strictEqual(snapshot.player2.misses, 9);
});

test('preserva mistakes de ambos os jogadores', () => {
  const match = createFinishedMatchWithScores({
    player1: { mistakes: 1 },
    player2: { mistakes: 4 },
  });
  const snapshot = captureFinalMatchState(match);
  assert.strictEqual(snapshot.player1.mistakes, 1);
  assert.strictEqual(snapshot.player2.mistakes, 4);
});

// 10. Snapshot e uma copia independente ------------------------------------------
test('snapshot devolvido e uma copia independente (mutar o retorno nao afeta o guardado)', () => {
  const match = createFinishedMatchWithScores({ player1: { score: 100 } });

  const snapshot = captureFinalMatchState(match);

  assert.throws(() => {
    'use strict';
    snapshot.player1.score = 999999;
  });

  const again = getFinalMatchState(match);
  assert.strictEqual(again.player1.score, 100, 'snapshot guardado nao pode ter sido alterado');
});

// 11. Alteracoes posteriores na Match nao alteram o snapshot ---------------------
test('alteracoes em match.players depois da captura nao afetam o snapshot ja guardado', () => {
  const match = createFinishedMatchWithScores({ player1: { score: 100, hits: 1 } });

  const snapshot = captureFinalMatchState(match);
  assert.strictEqual(snapshot.player1.score, 100);

  // Mesmo que algo (indevidamente) continue escrevendo em match.players
  // depois do fim, o snapshot ja capturado deve permanecer intacto.
  match.players.player1.score = 999999;
  match.players.player1.hits = 999;

  const stillSameSnapshot = getFinalMatchState(match);
  assert.strictEqual(stillSameSnapshot.player1.score, 100);
  assert.strictEqual(stillSameSnapshot.player1.hits, 1);
});

// 12. Resultado criado apenas uma vez ---------------------------------------------
test('captureFinalMatchState cria o snapshot apenas uma vez por partida', () => {
  const match = createFinishedMatchWithScores({ player1: { score: 50 } });

  assert.strictEqual(hasFinalMatchState(match), false);
  captureFinalMatchState(match);
  assert.strictEqual(hasFinalMatchState(match), true);
});

// 13. Segunda tentativa de captura nao substitui o resultado original -----------
test('segunda chamada de captureFinalMatchState nao substitui o snapshot original', () => {
  const match = createFinishedMatchWithScores({ player1: { score: 50 } });

  const first = captureFinalMatchState(match);

  // Estado muda depois da primeira captura (nao deveria acontecer no fluxo
  // real, mas o modulo precisa ser resiliente mesmo assim).
  match.players.player1.score = 12345;

  const second = captureFinalMatchState(match);

  assert.strictEqual(second.player1.score, 50, 'segunda captura nao pode ter sobrescrito o snapshot');
  assert.strictEqual(first, second, 'segunda chamada deveria devolver exatamente o mesmo snapshot');
});

// 14. Partida PLAYING nao e finalizada incorretamente -----------------------------
test('captureFinalMatchState recusa capturar uma partida ainda em PLAYING', () => {
  const match = new Match('ROOM-PLAYING');
  match.players.player1.score = 500;
  match.setState(MATCH_STATE.PLAYING);

  const snapshot = captureFinalMatchState(match);

  assert.strictEqual(snapshot, null, 'nao deveria capturar nada enquanto a partida esta em PLAYING');
  assert.strictEqual(hasFinalMatchState(match), false);
  assert.strictEqual(getFinalMatchState(match), null);
});

test('depois que a partida sai de PLAYING, a captura passa a funcionar normalmente', () => {
  const match = new Match('ROOM-TRANSITION');
  match.players.player1.score = 500;
  match.setState(MATCH_STATE.PLAYING);

  assert.strictEqual(captureFinalMatchState(match), null);

  match.setState(MATCH_STATE.FINISHED);
  const snapshot = captureFinalMatchState(match);

  assert.ok(snapshot);
  assert.strictEqual(snapshot.player1.score, 500);
});

// 15. Resultado antigo e limpo ao iniciar uma nova partida ------------------------
test('clearFinalMatchState descarta o snapshot guardado para uma Match', () => {
  const match = createFinishedMatchWithScores({ player1: { score: 77 } });

  captureFinalMatchState(match);
  assert.strictEqual(hasFinalMatchState(match), true);

  clearFinalMatchState(match);

  assert.strictEqual(hasFinalMatchState(match), false);
  assert.strictEqual(getFinalMatchState(match), null);
});

// 16. player1 e player2 permanecem completamente independentes -------------------
test('capturar/alterar o snapshot de um jogador nunca afeta o outro', () => {
  const match = createFinishedMatchWithScores({
    player1: { score: 10, hits: 1 },
    player2: { score: 20, hits: 2 },
  });

  const snapshot = captureFinalMatchState(match);

  assert.strictEqual(snapshot.player1.score, 10);
  assert.strictEqual(snapshot.player2.score, 20);
  assert.notStrictEqual(snapshot.player1, snapshot.player2, 'player1 e player2 devem ser objetos distintos');

  // Uma nova partida com valores diferentes nao pode influenciar (nem ser
  // influenciada) por este snapshot ja capturado.
  const otherMatch = createFinishedMatchWithScores({
    player1: { score: 999 },
    player2: { score: 888 },
  });
  const otherSnapshot = captureFinalMatchState(otherMatch);

  assert.strictEqual(snapshot.player1.score, 10, 'snapshot da primeira partida nao pode ter mudado');
  assert.strictEqual(otherSnapshot.player1.score, 999);
});

// 17. Uma Match nova nao herda o resultado anterior ---------------------------------
test('uma nova Match (ex: revanche) nunca herda o snapshot de uma partida anterior', () => {
  const oldMatch = createFinishedMatchWithScores({
    roomCode: 'ROOM-OLD',
    player1: { score: 1000, maxCombo: 20 },
    player2: { score: 900, maxCombo: 18 },
  });
  captureFinalMatchState(oldMatch);
  assert.strictEqual(hasFinalMatchState(oldMatch), true);

  // Mesma sala, mas uma instancia de Match totalmente nova -- exatamente o
  // que rematchFlow.startRematch faz (new Match(room.code)).
  const newMatch = new Match('ROOM-OLD');

  assert.strictEqual(hasFinalMatchState(newMatch), false);
  assert.strictEqual(getFinalMatchState(newMatch), null);

  // A partida antiga continua com o proprio resultado, intacto.
  const oldSnapshot = getFinalMatchState(oldMatch);
  assert.strictEqual(oldSnapshot.player1.score, 1000);
});

// Extra: match invalida/null nao quebra o modulo ------------------------------------
test('funcoes publicas degradam com seguranca para match null/undefined', () => {
  assert.strictEqual(captureFinalMatchState(null), null);
  assert.strictEqual(getFinalMatchState(null), null);
  assert.strictEqual(hasFinalMatchState(null), false);
  assert.doesNotThrow(() => clearFinalMatchState(null));
});

console.log(`\n${passed} teste(s) passaram.`);
