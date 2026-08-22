/**
 * Testes automatizados de ABANDONO / DESCONEXAO DURANTE A PARTIDA
 * (Etapa 8A): deteccao de desconexao enquanto a Match esta em PLAYING,
 * encerramento seguro daquela partida, aviso ao jogador que permaneceu
 * conectado (`match_abandoned`), bloqueio de gameplay posterior,
 * idempotencia, isolamento entre salas e nao-interferencia com os
 * fluxos ja existentes (WAITING/READY/COUNTDOWN, revanche, uma segunda
 * Match nova).
 *
 * Usa mocks simples de conexao WebSocket (nao sobe um servidor real, nao
 * abre porta) e os modulos reais de Room/RoomManager/Match/MatchManager/
 * gameplayFlow/rematchFlow/matchAbandonment/connectionHandler.
 *
 * Executar com: node tests/matchAbandonment.test.js
 */
const assert = require('assert');
const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { Match, MATCH_STATE } = require('../server/match/Match');
const gameplayFlow = require('../server/match/gameplayFlow');
const rematchFlow = require('../server/match/rematchFlow');
const matchAbandonment = require('../server/match/matchAbandonment');
const { registerConnection } = require('../server/ws/connectionHandler');

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
 * Mock minimo de conexao WebSocket: guarda tudo que foi enviado
 * (`send`) e permite disparar 'close'/'error' manualmente (`.on`),
 * simulando exatamente os dois eventos que connectionHandler.js escuta.
 */
function createMockSocket() {
  const handlers = { close: [], error: [], message: [] };
  return {
    OPEN: 1,
    readyState: 1,
    sent: [],
    send(raw) {
      this.sent.push(JSON.parse(raw));
    },
    on(event, handler) {
      if (handlers[event]) handlers[event].push(handler);
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

/**
 * Monta uma sala real (via RoomManager) com os dois jogadores conectados
 * (via registerConnection, para os listeners de close/error ficarem
 * instalados exatamente como em producao) e uma Match em PLAYING
 * associada a ela (via MatchManager) -- o mesmo caminho que
 * connectionHandler.handleDisconnect usa para encontrar sala e partida
 * a partir de ws.roomCode/ws.slot.
 */
function setupRoomWithPlayingMatch(seed = 777) {
  const room = RoomManager.createRoom();

  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);

  room.addPlayer(ws1); // player1
  room.addPlayer(ws2); // player2

  const match = new Match(room.code);
  match.seed = seed;
  match.setState(MATCH_STATE.PLAYING);
  MatchManager.setMatch(room.code, match);

  return { room, ws1, ws2, match };
}

// 1. desconexao durante PLAYING e detectada + 2. partida deixa de estar em PLAYING
test('desconexao de player1 durante PLAYING encerra a partida (sai de PLAYING)', () => {
  const { ws1, match } = setupRoomWithPlayingMatch();

  ws1._triggerClose();

  assert.notStrictEqual(match.state, MATCH_STATE.PLAYING);
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);
});

// 3. jogador restante recebe o evento de abandono + 4. payload identifica quem abandonou
test('player2 (que ficou) recebe match_abandoned identificando player1 como quem saiu', () => {
  const { ws1, ws2 } = setupRoomWithPlayingMatch();

  ws1._triggerClose();

  const event = lastMessageOfType(ws2, 'match_abandoned');
  assert.ok(event, 'player2 deveria ter recebido match_abandoned');
  assert.strictEqual(event.abandonedBy, 'player1');
});

// 5. note_hit depois do abandono nao altera o estado
test('note_hit apos abandono nao altera hits/score/combo oficiais', () => {
  const { room, ws1, ws2, match } = setupRoomWithPlayingMatch();

  const before = { ...match.players.player2 };
  ws1._triggerClose();

  gameplayFlow.applyNoteHit(ws2, room, {
    noteId: `note-${match.seed}-0`,
    lane: 1,
    judgement: 'PERFECT',
    combo: 1,
    score: 100,
  });

  assert.deepStrictEqual(match.players.player2, before);
});

// 6. note_miss depois do abandono nao altera o estado
test('note_miss apos abandono nao altera misses/combo oficiais', () => {
  const { room, ws1, ws2, match } = setupRoomWithPlayingMatch();

  const before = { ...match.players.player2 };
  ws1._triggerClose();

  gameplayFlow.applyNoteMiss(ws2, room, {
    noteId: `note-${match.seed}-0`,
    lane: 1,
  });

  assert.deepStrictEqual(match.players.player2, before);
});

// 7. a partida nao e finalizada duas vezes + 8. duas chamadas de disconnect
//    nao geram dois eventos
test('disconnect chamado duas vezes (close + error) so processa o abandono uma vez', () => {
  const { ws1, ws2 } = setupRoomWithPlayingMatch();

  ws1._triggerClose();
  ws1._triggerError();

  assert.strictEqual(countMessagesOfType(ws2, 'match_abandoned'), 1);
});

test('chamar matchAbandonment.handleAbandonment diretamente duas vezes e idempotente', () => {
  const { room, match } = setupRoomWithPlayingMatch();

  const first = matchAbandonment.handleAbandonment(room, match, 'player1');
  const second = matchAbandonment.handleAbandonment(room, match, 'player1');

  assert.strictEqual(first, true);
  assert.strictEqual(second, false);
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);
});

// 9. abandono em uma sala nao afeta outra
test('abandono na sala A nao finaliza nem afeta a partida da sala B', () => {
  const a = setupRoomWithPlayingMatch(1);
  const b = setupRoomWithPlayingMatch(2);

  a.ws1._triggerClose();

  assert.strictEqual(a.match.state, MATCH_STATE.FINISHED);
  assert.strictEqual(b.match.state, MATCH_STATE.PLAYING);
  assert.strictEqual(countMessagesOfType(b.ws2, 'match_abandoned'), 0);
  assert.strictEqual(countMessagesOfType(b.ws1, 'match_abandoned'), 0);
});

// 10. desconexao durante WAITING mantem o comportamento existente
test('desconexao durante WAITING_FOR_PLAYER nao envia match_abandoned', () => {
  const room = RoomManager.createRoom();
  const ws1 = createMockSocket();
  registerConnection(ws1);
  room.addPlayer(ws1); // player1, sala ainda incompleta -> nao ha Match

  ws1._triggerClose();

  assert.strictEqual(countMessagesOfType(ws1, 'match_abandoned'), 0);
});

// 11. desconexao durante COUNTDOWN nao deixa a partida invalida continuar
test('desconexao durante COUNTDOWN cancela a partida (match_cancelled), nao match_abandoned', () => {
  const room = RoomManager.createRoom();
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);
  room.addPlayer(ws1);
  room.addPlayer(ws2);

  const match = new Match(room.code);
  match.setState(MATCH_STATE.COUNTDOWN);
  MatchManager.setMatch(room.code, match);

  ws1._triggerClose();

  assert.strictEqual(MatchManager.getMatch(room.code), null);
  assert.ok(lastMessageOfType(ws2, 'match_cancelled'));
  assert.strictEqual(countMessagesOfType(ws2, 'match_abandoned'), 0);
});

// 12. abandono depois de FINISHED nao cria uma nova finalizacao
test('desconexao com a partida ja FINISHED nao dispara um novo match_abandoned', () => {
  const { ws1, ws2, match } = setupRoomWithPlayingMatch();
  match.setState(MATCH_STATE.FINISHED); // partida ja tinha terminado normalmente

  ws1._triggerClose();

  assert.strictEqual(countMessagesOfType(ws2, 'match_abandoned'), 0);
  assert.strictEqual(matchAbandonment.hasAbandonment(match), false);
});

// 13. os estados dos jogadores da partida correta sao preservados corretamente
test('abandono preserva o score/estado ja registrado do jogador que ficou', () => {
  const { ws1, match } = setupRoomWithPlayingMatch();
  match.players.player2.score = 4200;
  match.players.player2.hits = 10;

  ws1._triggerClose();

  assert.strictEqual(match.players.player2.score, 4200);
  assert.strictEqual(match.players.player2.hits, 10);
});

// 14. uma nova Match nao herda o estado de abandono da anterior
test('uma Match nova (ex: revanche) nao vem marcada como abandonada', () => {
  const { room, ws1, match } = setupRoomWithPlayingMatch();
  ws1._triggerClose();
  assert.strictEqual(matchAbandonment.hasAbandonment(match), true);

  const freshMatch = new Match(room.code);
  assert.strictEqual(matchAbandonment.hasAbandonment(freshMatch), false);
  assert.strictEqual(matchAbandonment.getAbandonmentInfo(freshMatch), null);
});

// 15. o fluxo de revanche nao e quebrado
test('apos abandono, pedido de revanche do jogador restante e recusado (sem oponente)', () => {
  const { room, ws1, ws2 } = setupRoomWithPlayingMatch();

  ws1._triggerClose();
  rematchFlow.requestRematch(ws2, room);

  const errorMsg = lastMessageOfType(ws2, 'error');
  assert.ok(errorMsg, 'deveria recusar revanche sem oponente conectado');
  assert.strictEqual(rematchFlow.isRematchPending(room.code), false);
});

// 16. a conexao restante continua ligada a sala corretamente
test('apos abandono, a conexao do jogador restante continua associada a sala', () => {
  const { room, ws1, ws2 } = setupRoomWithPlayingMatch();

  ws1._triggerClose();

  assert.strictEqual(ws2.roomCode, room.code);
  assert.strictEqual(ws2.slot, 'player2');
  assert.strictEqual(RoomManager.getRoom(room.code), room);
  assert.strictEqual(room.players.player2, ws2);
});

// 17. nenhum timer/countdown duplicado e criado
test('abandono durante PLAYING nao deixa nenhum timer de countdown pendente', () => {
  const { ws1, match } = setupRoomWithPlayingMatch();
  match._countdownTimer = setTimeout(() => {}, 60000); // simula timer residual

  ws1._triggerClose();

  assert.strictEqual(match._countdownTimer, null);
});

// 18. nenhum segundo sistema de finalizacao e criado / payload minimo
test('match_abandoned so contem type e abandonedBy (payload minimo)', () => {
  const { ws1, ws2 } = setupRoomWithPlayingMatch();

  ws1._triggerClose();

  const event = lastMessageOfType(ws2, 'match_abandoned');
  assert.deepStrictEqual(Object.keys(event).sort(), ['abandonedBy', 'type']);
});

console.log(`\n${passed} teste(s) passaram.\n`);
