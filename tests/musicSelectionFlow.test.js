/**
 * Testes automatizados da SELECAO DE MUSICA antes da partida (Etapa 10D):
 * catalogo publico enviado ao cliente, validacao do servidor para
 * `select_music` (sala/slot/estado da partida/musica valida), a regra de
 * desempate entre dois jogadores (player1 tem prioridade), integracao com
 * a criacao da Match (startMatchFlow) e com a revanche (rematchFlow), e
 * a limpeza da selecao pendente ao sair/desconectar.
 *
 * Usa mocks simples de conexao WebSocket (nao sobe um servidor real) e os
 * modulos reais de Room/Match/RoomManager/MatchManager/messageRouter/
 * musicSelectionFlow/rematchFlow -- nenhuma logica e duplicada aqui.
 *
 * Executar com: node tests/musicSelectionFlow.test.js
 */
const assert = require('assert');
const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { MATCH_STATE } = require('../server/match/Match');
const musicCatalog = require('../server/music/musicCatalog');
const musicSelectionFlow = require('../server/music/musicSelectionFlow');
const rematchFlow = require('../server/match/rematchFlow');
const { registerConnection } = require('../server/ws/connectionHandler');
const { routeMessage } = require('../server/ws/messageRouter');

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
    close() {},
    _handlers: handlers,
  };
}

function send(ws, message) {
  routeMessage(ws, JSON.stringify(message));
}

function lastOfType(socket, type) {
  const matches = socket.sent.filter((m) => m.type === type);
  return matches.length ? matches[matches.length - 1] : null;
}

function allOfType(socket, type) {
  return socket.sent.filter((m) => m.type === type);
}

/**
 * Cria uma sala com 1 unico jogador (player1), SEM deixar a sala cheia
 * (nunca dispara startMatchFlow) -- a janela real de selecao antes da
 * primeira Match desta sala.
 */
function createRoomWithOnePlayer() {
  const ws1 = createMockSocket();
  registerConnection(ws1);
  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  const room = RoomManager.getRoom(roomCode);
  return { ws1, room, roomCode };
}

/**
 * Cria uma sala cheia (2 jogadores), o que ja dispara a primeira Match
 * via producao (mesmo helper usado por musicCatalog.test.js).
 */
function createFullRoomViaProduction() {
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);

  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  send(ws2, { type: 'join_room', roomCode });

  const room = RoomManager.getRoom(roomCode);
  const match = MatchManager.getMatch(roomCode);
  return { room, ws1, ws2, match, roomCode };
}

// =====================================================================
// 1. catalogo pode ser enviado ao cliente
// =====================================================================
test('[1] create_room entrega music_catalog ao jogador', () => {
  const { ws1 } = createRoomWithOnePlayer();
  const catalogMsg = lastOfType(ws1, 'music_catalog');
  assert.ok(catalogMsg);
  assert.ok(Array.isArray(catalogMsg.musics));
  assert.ok(catalogMsg.musics.length >= 1);
});

// =====================================================================
// 2. catalogo contem somente dados publicos
// =====================================================================
test('[2] music_catalog nunca inclui sequenceId nem nenhum campo interno', () => {
  const { ws1 } = createRoomWithOnePlayer();
  const catalogMsg = lastOfType(ws1, 'music_catalog');
  catalogMsg.musics.forEach((music) => {
    assert.strictEqual(music.sequenceId, undefined);
    const keys = Object.keys(music).sort();
    assert.deepStrictEqual(keys, ['artist', 'bpm', 'difficulty', 'durationMs', 'id', 'title']);
  });
});

// =====================================================================
// 3. jogador pode selecionar musica valida
// =====================================================================
test('[3] jogador pode selecionar uma musica valida do catalogo', () => {
  const { ws1, roomCode } = createRoomWithOnePlayer();
  send(ws1, { type: 'select_music', musicId: 'music-002' });

  const confirmation = lastOfType(ws1, 'music_selected');
  assert.ok(confirmation);
  assert.strictEqual(confirmation.musicId, 'music-002');
  assert.strictEqual(confirmation.slot, 'player1');

  const state = musicSelectionFlow.getSelectionState(roomCode);
  assert.strictEqual(state.player1, 'music-002');
});

// =====================================================================
// 4. selecao invalida e rejeitada
// =====================================================================
test('[4] selecionar um musicId que nao existe e rejeitado', () => {
  const { ws1, roomCode } = createRoomWithOnePlayer();
  send(ws1, { type: 'select_music', musicId: 'music-nao-existe' });

  assert.ok(lastOfType(ws1, 'error'));
  assert.strictEqual(lastOfType(ws1, 'music_selected'), null);
  assert.strictEqual(musicSelectionFlow.getSelectionState(roomCode), null);
});

// =====================================================================
// 5. sala inexistente e rejeitada
// =====================================================================
test('[5] select_music com uma sala que nao existe mais e rejeitado', () => {
  const ws = createMockSocket();
  registerConnection(ws);
  // Forja um estado de conexao que nao corresponde a nenhuma sala real
  // -- mesma tecnica usada por outros testes desta base para simular
  // uma sala removida entre duas acoes.
  ws.roomCode = 'ZZZZZZ';
  ws.slot = 'player1';

  send(ws, { type: 'select_music', musicId: 'music-001' });

  const error = lastOfType(ws, 'error');
  assert.ok(error);
  assert.match(error.message, /sala/i);
});

// =====================================================================
// 6. jogador fora da sala e rejeitado
// =====================================================================
test('[6] select_music sem estar em nenhuma sala e rejeitado', () => {
  const ws = createMockSocket();
  registerConnection(ws);

  send(ws, { type: 'select_music', musicId: 'music-001' });

  const error = lastOfType(ws, 'error');
  assert.ok(error);
  assert.strictEqual(lastOfType(ws, 'music_selected'), null);
});

// =====================================================================
// 7. selecao durante PLAYING e rejeitada
// =====================================================================
test('[7] select_music enquanto a partida esta PLAYING e rejeitado', () => {
  const { ws1, roomCode, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.PLAYING);

  send(ws1, { type: 'select_music', musicId: 'music-002' });

  assert.ok(lastOfType(ws1, 'error'));
  assert.strictEqual(musicSelectionFlow.getSelectionState(roomCode), null);
});

// =====================================================================
// 8. selecao durante COUNTDOWN e rejeitada
// =====================================================================
test('[8] select_music enquanto a partida esta em COUNTDOWN e rejeitado', () => {
  const { ws1, roomCode, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.COUNTDOWN);

  send(ws1, { type: 'select_music', musicId: 'music-002' });

  assert.ok(lastOfType(ws1, 'error'));
  assert.strictEqual(musicSelectionFlow.getSelectionState(roomCode), null);
});

// =====================================================================
// 9. selecao antes da partida funciona
// =====================================================================
test('[9] select_music funciona normalmente antes de qualquer Match existir', () => {
  const { ws1, roomCode } = createRoomWithOnePlayer();
  assert.strictEqual(MatchManager.getMatch(roomCode), null);

  send(ws1, { type: 'select_music', musicId: 'music-001' });

  assert.ok(lastOfType(ws1, 'music_selected'));
});

// =====================================================================
// 10. DEFAULT_MUSIC_ID continua funcionando
// =====================================================================
test('[10] sem nenhuma selecao, a Match nova cai no DEFAULT_MUSIC_ID', () => {
  const { match } = createFullRoomViaProduction();
  const { DEFAULT_MUSIC_ID } = require('../server/config');
  assert.strictEqual(match.musicId, DEFAULT_MUSIC_ID);
});

// =====================================================================
// 11. musica selecionada chega a nova Match
// =====================================================================
test('[11] a musica selecionada antes da sala ficar cheia chega a Match criada', () => {
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);

  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;

  // player1 seleciona ENQUANTO ainda aguarda o oponente.
  send(ws1, { type: 'select_music', musicId: 'music-002' });

  send(ws2, { type: 'join_room', roomCode });

  const match = MatchManager.getMatch(roomCode);
  assert.ok(match);
  assert.strictEqual(match.musicId, 'music-002');
});

// =====================================================================
// 12. sequenceId corresponde a musica selecionada
// =====================================================================
test('[12] match.music.sequenceId corresponde ao sequenceId da musica selecionada', () => {
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);

  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  send(ws1, { type: 'select_music', musicId: 'music-002' });
  send(ws2, { type: 'join_room', roomCode });

  const match = MatchManager.getMatch(roomCode);
  const expected = musicCatalog.getMusicById('music-002');
  assert.strictEqual(match.music.sequenceId, expected.sequenceId);
});

// =====================================================================
// 13. nova Match recebe nova seed
// =====================================================================
test('[13] uma nova Match (revanche) recebe uma seed diferente da anterior', () => {
  const { room, ws1, ws2, roomCode } = createFullRoomViaProduction();
  const firstMatch = MatchManager.getMatch(roomCode);
  const firstSeed = firstMatch.seed;

  firstMatch.setState(MATCH_STATE.FINISHED);
  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  assert.notStrictEqual(secondMatch, firstMatch);
  assert.notStrictEqual(secondMatch.seed, firstSeed);
});

// =====================================================================
// 14. nova Match recebe nova timeline (noteSequence)
// =====================================================================
test('[14] uma nova Match (revanche) recebe uma noteSequence de referencia nova', () => {
  const { ws1, ws2, roomCode } = createFullRoomViaProduction();
  const firstMatch = MatchManager.getMatch(roomCode);
  const firstSequence = firstMatch.noteSequence.slice();

  firstMatch.setState(MATCH_STATE.FINISHED);
  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  assert.ok(secondMatch.noteSequence);
  assert.notDeepStrictEqual(secondMatch.noteSequence, firstSequence);
});

// =====================================================================
// 15. duas salas possuem selecoes independentes
// =====================================================================
test('[15] a selecao de uma sala nunca aparece em outra sala', () => {
  const roomA = createRoomWithOnePlayer();
  const roomB = createRoomWithOnePlayer();

  send(roomA.ws1, { type: 'select_music', musicId: 'music-002' });

  assert.strictEqual(musicSelectionFlow.resolveSelectedMusicId(roomA.roomCode), 'music-002');
  assert.strictEqual(musicSelectionFlow.resolveSelectedMusicId(roomB.roomCode), null);
});

// =====================================================================
// 16. jogador 1 nao altera jogador 2 (e a regra de desempate: player1
// tem prioridade quando os dois escolhem musicas diferentes)
// =====================================================================
test('[16] selecao de player1 nao sobrescreve a selecao de player2, mas vence o desempate', () => {
  const { ws1, ws2, roomCode } = createFullRoomViaProduction();
  const match = MatchManager.getMatch(roomCode);
  match.setState(MATCH_STATE.FINISHED);

  send(ws2, { type: 'select_music', musicId: 'music-001' });
  send(ws1, { type: 'select_music', musicId: 'music-002' });

  const state = musicSelectionFlow.getSelectionState(roomCode);
  // A selecao de player2 continua intacta -- player1 nunca escreve no
  // slot do outro jogador.
  assert.strictEqual(state.player2, 'music-001');
  assert.strictEqual(state.player1, 'music-002');
  // Regra de desempate: player1 tem prioridade.
  assert.strictEqual(musicSelectionFlow.resolveSelectedMusicId(roomCode), 'music-002');
});

// =====================================================================
// 17 / 18. spam de selecao nao cria multiplas partidas / selecao nao
// inicia partida sozinha
// =====================================================================
test('[17][18] enviar select_music varias vezes nunca cria/inicia nenhuma Match sozinho', () => {
  const { ws1, roomCode } = createRoomWithOnePlayer();

  for (let i = 0; i < 10; i++) {
    send(ws1, { type: 'select_music', musicId: i % 2 === 0 ? 'music-001' : 'music-002' });
  }

  assert.strictEqual(MatchManager.getMatch(roomCode), null);
});

// =====================================================================
// 19. partida so utiliza a musica quando realmente criada
// =====================================================================
test('[19] a selecao pendente nao afeta nenhuma Match ate a sala ficar cheia', () => {
  const { ws1, roomCode } = createRoomWithOnePlayer();
  send(ws1, { type: 'select_music', musicId: 'music-002' });

  // Nenhuma Match existe ainda -- a selecao e so uma configuracao para
  // quando ela for criada.
  assert.strictEqual(MatchManager.getMatch(roomCode), null);
  assert.strictEqual(musicSelectionFlow.resolveSelectedMusicId(roomCode), 'music-002');
});

// =====================================================================
// 20. revanche existente continua funcionando (Etapa 10C preservada)
// =====================================================================
test('[20] sem nova selecao, a revanche continua reaproveitando o musicId da partida anterior', () => {
  const { ws1, ws2, roomCode } = createFullRoomViaProduction();
  const firstMatch = MatchManager.getMatch(roomCode);
  const firstMusicId = firstMatch.musicId;
  firstMatch.setState(MATCH_STATE.FINISHED);

  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  assert.strictEqual(secondMatch.musicId, firstMusicId);
});

// =====================================================================
// 21. abandono (desconexao) nao deixa selecao presa
// =====================================================================
test('[21] desconexao de um jogador limpa a selecao dele (nunca fica presa)', () => {
  const { ws1, roomCode, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.FINISHED);

  send(ws1, { type: 'select_music', musicId: 'music-002' });
  assert.strictEqual(musicSelectionFlow.getSelectionState(roomCode).player1, 'music-002');

  // Simula a desconexao de ws1 (fecha a conexao -- mesmo gatilho
  // 'close' que connectionHandler.registerConnection escuta).
  ws1._handlers.close.forEach((handler) => handler());

  const stateAfter = musicSelectionFlow.getSelectionState(roomCode);
  assert.ok(!stateAfter || !stateAfter.player1);
});

// =====================================================================
// 22. saida da sala (leave_room) limpa a selecao
// =====================================================================
test('[22] leave_room limpa a selecao do jogador que saiu', () => {
  const { ws1, ws2, roomCode } = createFullRoomViaProduction();
  const match = MatchManager.getMatch(roomCode);
  match.setState(MATCH_STATE.FINISHED);

  send(ws2, { type: 'select_music', musicId: 'music-002' });
  assert.strictEqual(musicSelectionFlow.getSelectionState(roomCode).player2, 'music-002');

  send(ws2, { type: 'leave_room' });

  const stateAfter = musicSelectionFlow.getSelectionState(roomCode);
  assert.ok(!stateAfter || !stateAfter.player2);
});

// =====================================================================
// 23. cliente nao consegue alterar roomCode
// =====================================================================
test('[23] um roomCode forjado no payload de select_music e ignorado (so ws.roomCode conta)', () => {
  const roomA = createRoomWithOnePlayer();
  const roomB = createRoomWithOnePlayer();

  // ws1 pertence a roomA (ws.roomCode == roomA.roomCode) mas tenta
  // enviar um roomCode diferente dentro do payload -- o servidor NUNCA
  // le message.roomCode para select_music (ver musicSelectionFlow.js:
  // so usa ws.roomCode/ws.slot).
  send(roomA.ws1, { type: 'select_music', musicId: 'music-002', roomCode: roomB.roomCode });

  assert.strictEqual(musicSelectionFlow.resolveSelectedMusicId(roomA.roomCode), 'music-002');
  assert.strictEqual(musicSelectionFlow.resolveSelectedMusicId(roomB.roomCode), null);
});

// =====================================================================
// 24. musica antiga nao contamina nova Match
// =====================================================================
test('[24] a selecao consumida por uma Match nunca e reaproveitada por uma Match seguinte sem novo pedido', () => {
  const { ws1, ws2, roomCode } = createFullRoomViaProduction();
  const firstMatch = MatchManager.getMatch(roomCode);
  assert.strictEqual(musicSelectionFlow.getSelectionState(roomCode), null);

  firstMatch.setState(MATCH_STATE.FINISHED);
  send(ws1, { type: 'select_music', musicId: 'music-002' });

  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  assert.strictEqual(secondMatch.musicId, 'music-002');

  // A selecao ja foi consumida -- nao deve sobrar nada pendente para
  // uma TERCEIRA Match hipotetica sem um novo pedido.
  assert.strictEqual(musicSelectionFlow.getSelectionState(roomCode), null);
});

// =====================================================================
// 25. musica invalida nunca chega ao gameplay
// =====================================================================
test('[25] um musicId invalido nunca e registrado nem chega a nenhuma Match', () => {
  const { ws1, ws2, roomCode } = createFullRoomViaProduction();
  const match = MatchManager.getMatch(roomCode);
  match.setState(MATCH_STATE.FINISHED);

  send(ws1, { type: 'select_music', musicId: 'musica-que-nao-existe' });
  assert.strictEqual(musicSelectionFlow.getSelectionState(roomCode), null);

  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  // Sem selecao valida, cai no comportamento da Etapa 10C (musica da
  // partida anterior) -- nunca a string invalida.
  assert.strictEqual(secondMatch.musicId, match.musicId);
});

console.log(`\n${passed} teste(s) passaram.`);
