/**
 * Testes automatizados do ponto de integracao matchFlow.finishMatch
 * (Etapa 6B): reaproveita o fluxo de match ja existente para marcar a
 * partida como FINISHED e delegar a captura do snapshot final para
 * finalMatchState (Etapa 6B) -- sem comparar jogadores, sem decidir
 * vencedor/empate.
 *
 * Executar com: node tests/matchFlowFinish.test.js
 */
const assert = require('assert');
const { Room } = require('../server/rooms/Room');
const { Match, MATCH_STATE } = require('../server/match/Match');
const MatchManager = require('../server/match/MatchManager');
const matchFlow = require('../server/match/matchFlow');
const { hasFinalMatchState, getFinalMatchState } = require('../server/match/finalMatchState');

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

let roomCounter = 0;
function setupRoomWithPlayingMatch(scores = {}) {
  roomCounter += 1;
  const room = new Room(`FIN${roomCounter}`);
  room.addPlayer({ send() {} }); // player1
  room.addPlayer({ send() {} }); // player2

  const match = new Match(room.code);
  if (scores.player1) Object.assign(match.players.player1, scores.player1);
  if (scores.player2) Object.assign(match.players.player2, scores.player2);
  match.setState(MATCH_STATE.PLAYING);
  MatchManager.setMatch(room.code, match);

  return { room, match };
}

test('finishMatch transiciona a partida de PLAYING para FINISHED', () => {
  const { room, match } = setupRoomWithPlayingMatch();

  matchFlow.finishMatch(room);

  assert.strictEqual(match.state, MATCH_STATE.FINISHED);
});

test('finishMatch captura o snapshot final dos dois jogadores', () => {
  const { room, match } = setupRoomWithPlayingMatch({
    player1: { score: 1200, hits: 10 },
    player2: { score: 900, hits: 8 },
  });

  const snapshot = matchFlow.finishMatch(room);

  assert.ok(snapshot);
  assert.strictEqual(snapshot.player1.score, 1200);
  assert.strictEqual(snapshot.player2.score, 900);
  assert.strictEqual(hasFinalMatchState(match), true);
});

test('finishMatch chamado duas vezes nao substitui o snapshot original', () => {
  const { room, match } = setupRoomWithPlayingMatch({
    player1: { score: 300 },
  });

  const first = matchFlow.finishMatch(room);

  // Mudanca indevida depois do primeiro finishMatch nao deveria acontecer
  // no fluxo real, mas o comportamento precisa ser resiliente mesmo assim.
  match.players.player1.score = 999999;

  const second = matchFlow.finishMatch(room);

  assert.strictEqual(second.player1.score, 300);
  assert.strictEqual(first, second);
});

test('finishMatch sem partida ativa na sala nao lanca erro e devolve null', () => {
  roomCounter += 1;
  const room = new Room(`FIN${roomCounter}`);
  room.addPlayer({ send() {} });
  room.addPlayer({ send() {} });

  const result = matchFlow.finishMatch(room);

  assert.strictEqual(result, null);
});

test('finishMatch nao altera o snapshot de uma partida diferente (isolamento entre salas)', () => {
  const roomA = setupRoomWithPlayingMatch({ player1: { score: 111 } });
  const roomB = setupRoomWithPlayingMatch({ player1: { score: 222 } });

  matchFlow.finishMatch(roomA.room);

  assert.strictEqual(hasFinalMatchState(roomB.match), false);

  matchFlow.finishMatch(roomB.room);
  const snapshotB = getFinalMatchState(roomB.match);
  assert.strictEqual(snapshotB.player1.score, 222);

  const snapshotA = getFinalMatchState(roomA.match);
  assert.strictEqual(snapshotA.player1.score, 111);
});

console.log(`\n${passed} teste(s) passaram.`);
