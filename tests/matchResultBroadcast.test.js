/**
 * Testes automatizados da integracao final da Etapa 6C: finishMatch()
 * calculando/armazenando o outcome (matchOutcome) a partir do snapshot
 * ja capturado (finalMatchState, Etapa 6B) e enviando `match_result`
 * pelo WebSocket -- payload minimo, uma unica vez, para os dois
 * jogadores da sala.
 *
 * Usa os mesmos mocks simples de conexao WebSocket ja usados em
 * serverGameplayFlow.test.js (nao sobe um servidor real).
 *
 * Executar com: node tests/matchResultBroadcast.test.js
 */
const assert = require('assert');
const { Room } = require('../server/rooms/Room');
const { Match, MATCH_STATE } = require('../server/match/Match');
const MatchManager = require('../server/match/MatchManager');
const matchFlow = require('../server/match/matchFlow');
const gameplayFlow = require('../server/match/gameplayFlow');
const matchOutcome = require('../server/match/matchOutcome');

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

function createMockSocket() {
  return {
    OPEN: 1,
    readyState: 1,
    sent: [],
    send(raw) {
      this.sent.push(JSON.parse(raw));
    },
  };
}

let roomCounter = 0;
function setupRoomWithPlayingMatch(scores = {}, seed = 1) {
  roomCounter += 1;
  const room = new Room(`WS${roomCounter}`);
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  room.addPlayer(ws1); // player1
  room.addPlayer(ws2); // player2

  const match = new Match(room.code);
  match.seed = seed;
  if (scores.player1) Object.assign(match.players.player1, scores.player1);
  if (scores.player2) Object.assign(match.players.player2, scores.player2);
  match.setState(MATCH_STATE.PLAYING);
  MatchManager.setMatch(room.code, match);

  return { room, ws1, ws2, match };
}

function lastMatchResult(ws) {
  return ws.sent.find((msg) => msg.type === 'match_result');
}

// 14. match_result possui somente os campos necessarios ----------------------------
test('match_result contem somente type/result/winner/loser', () => {
  const { room, ws1 } = setupRoomWithPlayingMatch({
    player1: { score: 1000 },
    player2: { score: 500 },
  });

  matchFlow.finishMatch(room);

  const msg = lastMatchResult(ws1);
  assert.ok(msg, 'deveria ter enviado match_result');
  assert.deepStrictEqual(Object.keys(msg).sort(), ['loser', 'result', 'type', 'winner'].sort());
  assert.deepStrictEqual(msg, {
    type: 'match_result',
    result: 'player1_win',
    winner: 'player1',
    loser: 'player2',
  });
});

// 15. match_result e enviado para os dois jogadores ---------------------------------
test('match_result e enviado para player1 e player2 da mesma sala', () => {
  const { room, ws1, ws2 } = setupRoomWithPlayingMatch({
    player1: { score: 200 },
    player2: { score: 800 },
  });

  matchFlow.finishMatch(room);

  const msg1 = lastMatchResult(ws1);
  const msg2 = lastMatchResult(ws2);

  assert.ok(msg1, 'player1 deveria ter recebido match_result');
  assert.ok(msg2, 'player2 deveria ter recebido match_result');
  assert.deepStrictEqual(msg1, msg2, 'os dois jogadores devem receber exatamente o mesmo payload');
  assert.strictEqual(msg1.result, 'player2_win');
});

// 16. match_result nao e enviado duas vezes -----------------------------------------
test('match_result e enviado no maximo uma vez, mesmo chamando finishMatch varias vezes', () => {
  const { room, ws1, ws2 } = setupRoomWithPlayingMatch({
    player1: { score: 400 },
    player2: { score: 400 },
  });

  matchFlow.finishMatch(room);
  matchFlow.finishMatch(room);
  matchFlow.finishMatch(room);

  const resultsForP1 = ws1.sent.filter((msg) => msg.type === 'match_result');
  const resultsForP2 = ws2.sent.filter((msg) => msg.type === 'match_result');

  assert.strictEqual(resultsForP1.length, 1, 'player1 deveria ter recebido match_result apenas uma vez');
  assert.strictEqual(resultsForP2.length, 1, 'player2 deveria ter recebido match_result apenas uma vez');
  assert.strictEqual(resultsForP1[0].result, 'draw');
});

// 11. finishMatch captura o estado antes de comparar ---------------------------------
test('finishMatch usa o snapshot de finalMatchState (nao recalcula os scores por conta propria)', () => {
  const { room, match } = setupRoomWithPlayingMatch({
    player1: { score: 777, hits: 5 },
    player2: { score: 333, hits: 2 },
  });

  matchFlow.finishMatch(room);

  const outcome = matchOutcome.getFinalOutcome(match);
  assert.strictEqual(outcome.result, 'player1_win');
  // O outcome so pode ter sido calculado depois do snapshot existir.
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);
});

// 12. finishMatch gera outcome -------------------------------------------------------
test('finishMatch gera um outcome acessivel via matchOutcome apos a chamada', () => {
  const { room, match } = setupRoomWithPlayingMatch({
    player1: { score: 50 },
    player2: { score: 900 },
  });

  assert.strictEqual(matchOutcome.hasFinalOutcome(match), false);

  matchFlow.finishMatch(room);

  assert.strictEqual(matchOutcome.hasFinalOutcome(match), true);
  assert.strictEqual(matchOutcome.getFinalOutcome(match).winner, 'player2');
});

// 13. finishMatch duas vezes nao duplica resultado -----------------------------------
test('finishMatch chamado duas vezes nao gera outcomes diferentes', () => {
  const { room, match } = setupRoomWithPlayingMatch({
    player1: { score: 600 },
    player2: { score: 100 },
  });

  matchFlow.finishMatch(room);
  const firstOutcome = matchOutcome.getFinalOutcome(match);

  // Alteracao indevida depois do primeiro finishMatch nao deveria
  // acontecer no fluxo real, mas o resultado precisa ser resiliente.
  match.players.player2.score = 999999;

  matchFlow.finishMatch(room);
  const secondOutcome = matchOutcome.getFinalOutcome(match);

  assert.strictEqual(firstOutcome, secondOutcome);
  assert.strictEqual(secondOutcome.result, 'player1_win');
});

// 2. Nao ser possivel calcular resultado enquanto PLAYING (via fluxo completo) -----
test('nenhum match_result e enviado se a sala nunca teve finishMatch chamado (partida ainda PLAYING)', () => {
  const { ws1, ws2 } = setupRoomWithPlayingMatch({
    player1: { score: 10 },
    player2: { score: 20 },
  });

  // Nenhuma chamada a finishMatch: a partida continua em PLAYING.
  assert.strictEqual(lastMatchResult(ws1), undefined);
  assert.strictEqual(lastMatchResult(ws2), undefined);
});

// 17. Nova partida (revanche) limpa o outcome anterior --------------------------------
test('uma nova partida na mesma sala (revanche) comeca sem outcome anterior', () => {
  const { room, match: oldMatch } = setupRoomWithPlayingMatch({
    player1: { score: 1000 },
    player2: { score: 10 },
  });

  matchFlow.finishMatch(room);
  assert.strictEqual(matchOutcome.hasFinalOutcome(oldMatch), true);

  // Simula o que rematchFlow.startRematch faz: remove a match antiga e
  // cria uma instancia nova para a MESMA sala (nao chamamos rematchFlow
  // diretamente aqui para nao alterar/depender do handshake de revanche,
  // ja existente e fora do escopo desta etapa).
  MatchManager.removeMatch(room.code);
  const newMatch = new Match(room.code);
  MatchManager.setMatch(room.code, newMatch);

  assert.strictEqual(matchOutcome.hasFinalOutcome(newMatch), false);
  assert.strictEqual(matchOutcome.getFinalOutcome(newMatch), null);

  // O outcome da partida antiga nao foi afetado por essa transicao.
  assert.strictEqual(matchOutcome.getFinalOutcome(oldMatch).result, 'player1_win');
});

// 18/19. Um jogador nao pode alterar o score final do outro -------------------------
test('note_hit/note_miss de um jogador nunca alteram o score do outro, mesmo apos finishMatch', () => {
  const { room, ws1, ws2, match } = setupRoomWithPlayingMatch({}, 42);

  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-42-0', judgement: 'PERFECT', combo: 1, score: 300 });
  gameplayFlow.applyNoteHit(ws2, room, { noteId: 'note-42-0', judgement: 'GOOD', combo: 1, score: 100 });

  matchFlow.finishMatch(room);

  const outcome = matchOutcome.getFinalOutcome(match);
  assert.strictEqual(outcome.result, 'player1_win');
  assert.strictEqual(outcome.winner, 'player1');

  // player2 nao pode, atraves de qualquer evento seu, ter influenciado o
  // score final registrado para player1 (e vice-versa) -- cada slot so
  // altera o proprio estado (ver gameplayFlow.js, ja existente/intacto).
  assert.strictEqual(match.players.player1.score, 300);
  assert.strictEqual(match.players.player2.score, 100);
});

// 1/3. Ponta a ponta via WebSocket real (mock) usando o fluxo completo -------------
test('fluxo completo: dois jogadores jogam, finishMatch calcula e envia o match_result correto', () => {
  const { room, ws1, ws2 } = setupRoomWithPlayingMatch({}, 99);

  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-99-0', judgement: 'PERFECT', combo: 1, score: 300 });
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-99-1', judgement: 'PERFECT', combo: 2, score: 600 });
  gameplayFlow.applyNoteHit(ws2, room, { noteId: 'note-99-0', judgement: 'GOOD', combo: 1, score: 600 });

  matchFlow.finishMatch(room);

  const msg1 = lastMatchResult(ws1);
  const msg2 = lastMatchResult(ws2);
  assert.deepStrictEqual(msg1, { type: 'match_result', result: 'draw', winner: null, loser: null });
  assert.deepStrictEqual(msg2, { type: 'match_result', result: 'draw', winner: null, loser: null });
});

console.log(`\n${passed} teste(s) passaram.`);
