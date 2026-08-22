/**
 * Testes automatizados da SAIDA VOLUNTARIA DE SALA (Etapa 9A):
 * `leave_room` -> validacao, remocao do jogador, atualizacao da sala,
 * aviso ao oponente (`player_left_room`), bloqueio de comandos
 * posteriores, integracao com match (WAITING/READY/COUNTDOWN/PLAYING/
 * FINISHED) e revanche, idempotencia, isolamento entre salas e
 * preservacao da conexao WebSocket (nao fecha).
 *
 * Usa mocks simples de conexao WebSocket (nao sobe um servidor real, nao
 * abre porta) e os modulos reais de Room/RoomManager/Match/MatchManager/
 * matchFlow/matchAbandonment/rematchFlow/connectionHandler/messageRouter/
 * leaveRoomFlow.
 *
 * Executar com: node tests/leaveRoomFlow.test.js
 */
const assert = require('assert');
const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { Match, MATCH_STATE } = require('../server/match/Match');
const rematchFlow = require('../server/match/rematchFlow');
const matchAbandonment = require('../server/match/matchAbandonment');
const { registerConnection } = require('../server/ws/connectionHandler');
const { routeMessage } = require('../server/ws/messageRouter');
const leaveRoomFlow = require('../server/room/leaveRoomFlow');

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

/**
 * Mock minimo de conexao WebSocket: guarda tudo que foi enviado (`send`),
 * permite disparar 'close'/'error' manualmente e expoe se foi "fechada"
 * (nenhum codigo deste modulo deveria chamar isso, mas o mock existe
 * para o teste conseguir provar que ninguem chamou).
 */
function createMockSocket() {
  const handlers = { close: [], error: [], message: [] };
  return {
    OPEN: 1,
    readyState: 1,
    sent: [],
    closed: false,
    send(raw) {
      this.sent.push(JSON.parse(raw));
    },
    on(event, handler) {
      if (handlers[event]) handlers[event].push(handler);
    },
    close() {
      this.closed = true;
    },
    _triggerClose() {
      handlers.close.forEach((fn) => fn());
    },
    _triggerError() {
      handlers.error.forEach((fn) => fn());
    },
  };
}

function lastMessageOfType(socket, type) {
  const matches = socket.sent.filter((msg) => msg.type === type);
  return matches.length ? matches[matches.length - 1] : null;
}

function countMessagesOfType(socket, type) {
  return socket.sent.filter((msg) => msg.type === type).length;
}

function sendLeaveRoom(ws) {
  routeMessage(ws, JSON.stringify({ type: 'leave_room' }));
}

/**
 * Monta uma sala real com os dois jogadores conectados (via
 * registerConnection, para os listeners ficarem instalados exatamente
 * como em producao) e, opcionalmente, uma Match num estado especifico.
 */
function setupRoom({ matchState = null, seed = 123 } = {}) {
  const room = RoomManager.createRoom();

  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);

  room.addPlayer(ws1); // player1
  room.addPlayer(ws2); // player2

  let match = null;
  if (matchState) {
    match = new Match(room.code);
    match.seed = seed;
    match.setState(matchState);
    MatchManager.setMatch(room.code, match);
  }

  return { room, ws1, ws2, match };
}

// 1. jogador consegue sair de uma sala
test('jogador consegue sair de uma sala (recebe left_room)', () => {
  const { ws1 } = setupRoom();

  sendLeaveRoom(ws1);

  assert.ok(lastMessageOfType(ws1, 'left_room'));
});

// 2. jogador removido nao permanece no RoomManager (slot da sala)
test('apos sair, o slot do jogador na sala fica vazio', () => {
  const { room, ws1 } = setupRoom();

  sendLeaveRoom(ws1);

  assert.strictEqual(room.players.player1, null);
});

// 3. jogador restante continua na sala
test('jogador restante continua associado a sala apos o outro sair', () => {
  const { room, ws1, ws2 } = setupRoom();

  sendLeaveRoom(ws1);

  assert.strictEqual(room.players.player2, ws2);
  assert.strictEqual(ws2.roomCode, room.code);
  assert.strictEqual(ws2.slot, 'player2');
});

// 4. player_left_room e enviado ao jogador restante
test('player_left_room e enviado ao jogador restante identificando quem saiu', () => {
  const { ws1, ws2 } = setupRoom();

  sendLeaveRoom(ws1);

  const event = lastMessageOfType(ws2, 'player_left_room');
  assert.ok(event, 'player2 deveria ter recebido player_left_room');
  assert.strictEqual(event.player, 'player1');
});

// 5. evento nao e enviado para o jogador que saiu
test('o jogador que saiu nao recebe player_left_room', () => {
  const { ws1 } = setupRoom();

  sendLeaveRoom(ws1);

  assert.strictEqual(countMessagesOfType(ws1, 'player_left_room'), 0);
});

// 6. leave sem sala e rejeitado com seguranca
test('leave_room sem estar em uma sala e rejeitado com erro', () => {
  const ws = createMockSocket();
  registerConnection(ws);

  sendLeaveRoom(ws);

  const error = lastMessageOfType(ws, 'error');
  assert.ok(error, 'deveria receber um erro');
  assert.strictEqual(countMessagesOfType(ws, 'left_room'), 0);
});

// 7. leave duplicado nao quebra o sistema
test('leave_room chamado duas vezes pela mesma conexao e seguro (idempotente)', () => {
  const { ws1, ws2 } = setupRoom();

  sendLeaveRoom(ws1);
  sendLeaveRoom(ws1);

  assert.strictEqual(countMessagesOfType(ws1, 'left_room'), 1);
  assert.strictEqual(countMessagesOfType(ws2, 'player_left_room'), 1);
  const secondError = ws1.sent[ws1.sent.length - 1];
  assert.strictEqual(secondError.type, 'error');
});

// 8. jogador nao pode remover outro jogador
test('uma conexao com slot desatualizado nao consegue remover o outro jogador', () => {
  const { room, ws1, ws2 } = setupRoom();

  // Simula um ws "fantasma" que pensa estar em player1, mas o slot real
  // da sala ja pertence a outra conexao (ex: estado local desatualizado).
  const staleWs = createMockSocket();
  registerConnection(staleWs);
  staleWs.roomCode = room.code;
  staleWs.slot = 'player1';

  sendLeaveRoom(staleWs);

  assert.ok(lastMessageOfType(staleWs, 'error'));
  assert.strictEqual(room.players.player1, ws1, 'player1 real nao deveria ter sido removido');
  assert.strictEqual(room.players.player2, ws2);
  assert.strictEqual(countMessagesOfType(ws2, 'player_left_room'), 0);
});

// 9. WAITING funciona
test('sair durante WAITING_FOR_PLAYER funciona normalmente (sem match)', () => {
  const room = RoomManager.createRoom();
  const ws1 = createMockSocket();
  registerConnection(ws1);
  room.addPlayer(ws1); // sala incompleta, sem Match

  sendLeaveRoom(ws1);

  assert.ok(lastMessageOfType(ws1, 'left_room'));
  assert.strictEqual(RoomManager.getRoom(room.code), null, 'sala vazia deveria ser removida');
});

// 10. READY funciona
test('sair durante READY cancela a partida (match_cancelled) e nao match_abandoned', () => {
  const { ws1, ws2 } = setupRoom({ matchState: MATCH_STATE.READY });

  sendLeaveRoom(ws1);

  assert.ok(lastMessageOfType(ws2, 'match_cancelled'));
  assert.strictEqual(countMessagesOfType(ws2, 'match_abandoned'), 0);
});

// 11. COUNTDOWN funciona
test('sair durante COUNTDOWN cancela a partida e nao deixa timer pendente', () => {
  const { room, ws1, ws2, match } = setupRoom({ matchState: MATCH_STATE.COUNTDOWN });
  match._countdownTimer = setTimeout(() => {}, 60000);

  sendLeaveRoom(ws1);

  assert.ok(lastMessageOfType(ws2, 'match_cancelled'));
  assert.strictEqual(MatchManager.getMatch(room.code), null);
});

// 12. PLAYING reutiliza matchAbandonment
test('sair durante PLAYING reutiliza matchAbandonment (match_abandoned, nao match_cancelled)', () => {
  const { ws1, ws2, match } = setupRoom({ matchState: MATCH_STATE.PLAYING });

  sendLeaveRoom(ws1);

  const event = lastMessageOfType(ws2, 'match_abandoned');
  assert.ok(event, 'deveria reutilizar o fluxo de abandono existente');
  assert.strictEqual(event.abandonedBy, 'player1');
  assert.strictEqual(countMessagesOfType(ws2, 'match_cancelled'), 0);
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);
  assert.strictEqual(matchAbandonment.hasAbandonment(match), true);
});

// 13. FINISHED funciona com seguranca
test('sair com a partida ja FINISHED nao dispara match_cancelled nem match_abandoned', () => {
  const { ws1, ws2 } = setupRoom({ matchState: MATCH_STATE.FINISHED });

  sendLeaveRoom(ws1);

  assert.ok(lastMessageOfType(ws1, 'left_room'));
  assert.strictEqual(countMessagesOfType(ws2, 'match_cancelled'), 0);
  assert.strictEqual(countMessagesOfType(ws2, 'match_abandoned'), 0);
});

// 14. revanche pendente e cancelada
test('sair com revanche pendente cancela o handshake (rematch_cancelled)', () => {
  const { room, ws1, ws2 } = setupRoom({ matchState: MATCH_STATE.FINISHED });
  rematchFlow.requestRematch(ws2, room); // so player2 pediu revanche ate agora

  sendLeaveRoom(ws1);

  assert.ok(lastMessageOfType(ws2, 'rematch_cancelled'));
  assert.strictEqual(rematchFlow.isRematchPending(room.code), false);
});

// 15. ready antigo nao permanece
test('apos revanche cancelada por leave_room, um novo pedido de revanche comeca do zero', () => {
  const { room, ws1, ws2 } = setupRoom({ matchState: MATCH_STATE.FINISHED });
  rematchFlow.requestRematch(ws2, room);

  sendLeaveRoom(ws1);

  // player1 saiu; simula outro jogador entrando no lugar dele.
  const ws3 = createMockSocket();
  registerConnection(ws3);
  room.addPlayer(ws3); // ocupa novamente player1

  rematchFlow.requestRematch(ws3, room);
  const state = rematchFlow.getRematchState(room.code);
  assert.strictEqual(state.player1, true);
  assert.strictEqual(state.player2, false, 'ready antigo de player2 nao deveria ter vazado');
});

// 16. nao inicia partida com um jogador
test('apos sair, a sala com 1 jogador nao inicia partida sozinha', () => {
  const { room, ws1, match } = setupRoom({ matchState: MATCH_STATE.FINISHED });

  sendLeaveRoom(ws1);

  assert.strictEqual(room.isFull(), false);
  // Uma partida ja FINISHED nao e mexida pelo leave_room (nada a
  // cancelar/abandonar); o que importa e que nenhuma partida NOVA
  // comeca com a sala tendo apenas 1 jogador.
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);
});

// 17. WebSocket continua aberto
test('leave_room nao fecha o WebSocket do jogador que saiu', () => {
  const { ws1 } = setupRoom();

  sendLeaveRoom(ws1);

  assert.strictEqual(ws1.closed, false);
  assert.strictEqual(ws1.readyState, ws1.OPEN);
});

// 18. comandos do jogador removido nao afetam a sala
test('comandos de gameplay do jogador removido sao rejeitados apos leave_room', () => {
  const { room, ws1, ws2, match } = setupRoom({ matchState: MATCH_STATE.PLAYING });
  const before = { ...match.players.player1 };

  sendLeaveRoom(ws1);
  routeMessage(ws1, JSON.stringify({
    type: 'note_hit',
    noteId: 'x',
    lane: 1,
    judgement: 'PERFECT',
    combo: 1,
    score: 100,
  }));

  assert.ok(lastMessageOfType(ws1, 'error'));
  assert.deepStrictEqual(match.players.player1, before);
});

// 19. outra sala nao e afetada
test('sair da sala A nao afeta a sala B', () => {
  const a = setupRoom({ matchState: MATCH_STATE.PLAYING, seed: 1 });
  const b = setupRoom({ matchState: MATCH_STATE.PLAYING, seed: 2 });

  sendLeaveRoom(a.ws1);

  assert.strictEqual(b.match.state, MATCH_STATE.PLAYING);
  assert.strictEqual(b.room.players.player1, b.ws1);
  assert.strictEqual(b.room.players.player2, b.ws2);
  assert.strictEqual(countMessagesOfType(b.ws1, 'player_left_room'), 0);
  assert.strictEqual(countMessagesOfType(b.ws2, 'player_left_room'), 0);
});

// 20. estado de uma nova sala nao herda o estado antigo
test('uma sala nova criada depois nao herda estado da sala antiga (ja removida)', () => {
  const { room, ws1, ws2 } = setupRoom();

  sendLeaveRoom(ws1);
  sendLeaveRoom(ws2); // sala fica vazia -> removida

  assert.strictEqual(RoomManager.getRoom(room.code), null);

  const newRoom = RoomManager.createRoom();
  assert.strictEqual(newRoom.isEmpty(), true);
  assert.strictEqual(MatchManager.getMatch(newRoom.code), null);
});

// 21. evento player_left_room e enviado uma unica vez
test('player_left_room e enviado no maximo uma vez por saida', () => {
  const { ws1, ws2 } = setupRoom();

  sendLeaveRoom(ws1);

  assert.strictEqual(countMessagesOfType(ws2, 'player_left_room'), 1);
});

// 22. multiplas chamadas simultaneas nao geram inconsistencia
test('chamadas simultaneas de leave_room (ambos os jogadores) mantem consistencia', () => {
  const { room, ws1, ws2 } = setupRoom({ matchState: MATCH_STATE.PLAYING });

  leaveRoomFlow.handleLeaveRoom(ws1);
  leaveRoomFlow.handleLeaveRoom(ws2);

  assert.strictEqual(RoomManager.getRoom(room.code), null, 'sala deveria ter sido removida (ficou vazia)');
  assert.strictEqual(MatchManager.getMatch(room.code), null);
  assert.strictEqual(countMessagesOfType(ws1, 'left_room'), 1);
  assert.strictEqual(countMessagesOfType(ws2, 'left_room'), 1);
});

console.log(`\n${passed} teste(s) passaram.\n`);
