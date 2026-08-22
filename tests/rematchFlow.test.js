/**
 * Testes automatizados do fluxo de REVANCHE no SERVIDOR (Etapa 5B-5A, Parte 1):
 * handshake de prontidao (ready/ready) entre os dois jogadores, criacao da
 * nova partida (nova seed, novo startTimestamp) reutilizando matchFlow,
 * protecoes contra ready duplicado / ready durante PLAYING / revanches
 * simultaneas, e cancelamento por desconexao durante a espera.
 *
 * Usa mocks simples de conexao WebSocket (nao sobe um servidor real) e os
 * modulos reais de Room/Match/MatchManager/matchFlow/rematchFlow.
 *
 * Executar com: node tests/rematchFlow.test.js
 */
const assert = require('assert');
const { Room } = require('../server/rooms/Room');
const { Match, MATCH_STATE } = require('../server/match/Match');
const MatchManager = require('../server/match/MatchManager');
const rematchFlow = require('../server/match/rematchFlow');

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
/**
 * Monta uma sala com os dois jogadores conectados e uma partida ANTERIOR
 * ja finalizada (fora de PLAYING), simulando o estado de "tela de
 * resultado" em que o botao "Jogar Novamente" fica disponivel.
 */
function setupRoomAfterMatch(previousSeed = 111) {
  roomCounter += 1;
  const room = new Room(`ROOM${roomCounter}`);
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  room.addPlayer(ws1); // player1
  room.addPlayer(ws2); // player2
  ws1.slot = 'player1';
  ws2.slot = 'player2';

  const previousMatch = new Match(room.code);
  previousMatch.seed = previousSeed;
  previousMatch.setState(MATCH_STATE.FINISHED);
  MatchManager.setMatch(room.code, previousMatch);

  return { room, ws1, ws2, previousMatch };
}

function lastMessageOfType(ws, type) {
  return [...ws.sent].reverse().find((m) => m.type === type);
}

// 1. Jogador 1 pode ficar ready -----------------------------------------
test('jogador 1 pode ficar ready para revanche', () => {
  const { room, ws1 } = setupRoomAfterMatch();

  rematchFlow.requestRematch(ws1, room);

  const state = rematchFlow.getRematchState(room.code);
  assert.strictEqual(state.player1, true);
  assert.strictEqual(state.player2, false);
});

// 2. Jogador 2 pode ficar ready -------------------------------------------
test('jogador 2 pode ficar ready para revanche', () => {
  const { room, ws2 } = setupRoomAfterMatch();

  rematchFlow.requestRematch(ws2, room);

  const state = rematchFlow.getRematchState(room.code);
  assert.strictEqual(state.player1, false);
  assert.strictEqual(state.player2, true);
});

// 3. Um jogador ready sozinho nao inicia partida ---------------------------
test('apenas um jogador ready nao inicia uma nova partida', () => {
  const { room, ws1, previousMatch } = setupRoomAfterMatch();

  rematchFlow.requestRematch(ws1, room);

  // A "partida anterior" continua a mesma (nenhuma nova foi criada).
  assert.strictEqual(MatchManager.getMatch(room.code), previousMatch);
});

// 4. Dois jogadores ready iniciam a revanche -------------------------------
test('quando os dois ficam ready, uma nova partida e iniciada', () => {
  const { room, ws1, ws2, previousMatch } = setupRoomAfterMatch();

  rematchFlow.requestRematch(ws1, room);
  rematchFlow.requestRematch(ws2, room);

  const newMatch = MatchManager.getMatch(room.code);
  assert.notStrictEqual(newMatch, previousMatch, 'deveria existir uma partida NOVA');
  assert.strictEqual(newMatch.state, MATCH_STATE.COUNTDOWN);
});

// 5. Nova partida recebe nova seed ------------------------------------------
test('a nova partida usa uma seed diferente da anterior', () => {
  const { room, ws1, ws2, previousMatch } = setupRoomAfterMatch(999);

  rematchFlow.requestRematch(ws1, room);
  rematchFlow.requestRematch(ws2, room);

  const newMatch = MatchManager.getMatch(room.code);
  assert.notStrictEqual(newMatch.seed, previousMatch.seed);
  assert.strictEqual(typeof newMatch.seed, 'number');
});

// 6. Novo startTimestamp e criado -------------------------------------------
test('a nova partida recebe um novo startTimestamp', () => {
  const { room, ws1, ws2 } = setupRoomAfterMatch();

  rematchFlow.requestRematch(ws1, room);
  rematchFlow.requestRematch(ws2, room);

  const newMatch = MatchManager.getMatch(room.code);
  assert.strictEqual(typeof newMatch.startTimestamp, 'number');
  assert.ok(newMatch.startTimestamp >= Date.now());
});

// 7. Ready duplicado e ignorado ----------------------------------------------
test('pedido de ready duplicado do mesmo jogador e ignorado', () => {
  const { room, ws1, previousMatch } = setupRoomAfterMatch();

  rematchFlow.requestRematch(ws1, room);
  rematchFlow.requestRematch(ws1, room); // duplicado
  rematchFlow.requestRematch(ws1, room); // duplicado de novo

  const state = rematchFlow.getRematchState(room.code);
  assert.strictEqual(state.player1, true);
  assert.strictEqual(state.player2, false);
  // Nenhuma partida nova foi criada so com player1 "ready" varias vezes.
  assert.strictEqual(MatchManager.getMatch(room.code), previousMatch);
});

// 8. Ready durante PLAYING e ignorado ----------------------------------------
test('pedido de ready durante uma partida em PLAYING e ignorado', () => {
  const { room, ws1, previousMatch } = setupRoomAfterMatch();
  previousMatch.setState(MATCH_STATE.PLAYING);

  rematchFlow.requestRematch(ws1, room);

  const state = rematchFlow.getRematchState(room.code);
  assert.strictEqual(state, null, 'nao deveria ter registrado nenhum ready');
  assert.strictEqual(lastMessageOfType(ws1, 'error').type, 'error');
});

// 9. Duas revanches nao podem iniciar simultaneamente ------------------------
test('duas revanches nao iniciam simultaneamente para a mesma sala', () => {
  const { room, ws1, ws2 } = setupRoomAfterMatch();

  rematchFlow.requestRematch(ws1, room);
  rematchFlow.requestRematch(ws2, room); // dispara a revanche 1x

  const matchAfterFirstStart = MatchManager.getMatch(room.code);

  // Mensagens redundantes chegando depois (ex: duplo-clique no cliente)
  // nao devem criar uma SEGUNDA partida nova nem um segundo handshake.
  rematchFlow.requestRematch(ws1, room);
  rematchFlow.requestRematch(ws2, room);

  const matchAfterExtraCalls = MatchManager.getMatch(room.code);
  assert.strictEqual(matchAfterExtraCalls, matchAfterFirstStart);
});

// 10. Desconexao durante espera cancela a revanche ----------------------------
test('desconexao de um jogador durante a espera cancela a revanche', () => {
  const { room, ws1, ws2, previousMatch } = setupRoomAfterMatch();

  rematchFlow.requestRematch(ws1, room); // so player1 ficou ready

  // Simula a desconexao do player1 (mesmo trecho de responsabilidade que
  // server/ws/connectionHandler.js chama no 'close').
  room.removePlayer('player1');
  rematchFlow.cancelRematch(room, 'O oponente desconectou antes da revanche comecar.');

  assert.strictEqual(rematchFlow.isRematchPending(room.code), false);
  assert.strictEqual(MatchManager.getMatch(room.code), previousMatch, 'nenhuma partida nova deveria ter sido criada');

  const cancelMsg = lastMessageOfType(ws2, 'rematch_cancelled');
  assert.ok(cancelMsg, 'jogador restante deveria ser avisado do cancelamento');
});

// 11. Nenhuma partida comeca com apenas um jogador ----------------------------
test('pedido de revanche sem oponente conectado nao inicia nada', () => {
  const { room, ws1, previousMatch } = setupRoomAfterMatch();

  room.removePlayer('player2'); // oponente ja nao esta mais na sala

  rematchFlow.requestRematch(ws1, room);

  assert.strictEqual(MatchManager.getMatch(room.code), previousMatch);
  assert.strictEqual(rematchFlow.isRematchPending(room.code), false);
  assert.strictEqual(lastMessageOfType(ws1, 'error').type, 'error');
});

// 12. O mesmo startTimestamp e enviado aos dois jogadores ---------------------
test('o mesmo startTimestamp da revanche e enviado aos dois jogadores', () => {
  const { room, ws1, ws2 } = setupRoomAfterMatch();

  rematchFlow.requestRematch(ws1, room);
  rematchFlow.requestRematch(ws2, room);

  const countdown1 = lastMessageOfType(ws1, 'match_countdown_start');
  const countdown2 = lastMessageOfType(ws2, 'match_countdown_start');

  assert.ok(countdown1 && countdown2);
  assert.strictEqual(countdown1.startTimestamp, countdown2.startTimestamp);

  const newMatch = MatchManager.getMatch(room.code);
  assert.strictEqual(countdown1.startTimestamp, newMatch.startTimestamp);
});

console.log(`\n${passed} teste(s) passaram.`);
