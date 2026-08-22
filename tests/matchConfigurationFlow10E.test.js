/**
 * ETAPA 10E -- Configuracao de partida / selecao de musica no FLUXO REAL.
 *
 * Esta etapa nao introduz nenhum sistema novo (ver relatorio) -- ela
 * AUDITA que a selecao de musica (Etapa 10D) esta corretamente
 * conectada ao fluxo real de preparacao de partida ja existente:
 * criar/entrar na sala -> selecionar -> sala cheia -> matchFlow cria a
 * Match com a musica resolvida -> match_ready/match_countdown_start/
 * match_started (mesmo fluxo de sempre) -> revanche.
 *
 * Nenhuma logica e reimplementada aqui: todos os testes passam pelas
 * MESMAS entradas de producao (routeMessage, matchFlow, rematchFlow,
 * musicSelectionFlow) ja usadas pelo jogo real.
 *
 * Executar com: node tests/matchConfigurationFlow10E.test.js
 */
const assert = require('assert');
const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { MATCH_STATE } = require('../server/match/Match');
const musicCatalog = require('../server/music/musicCatalog');
const musicSelectionFlow = require('../server/music/musicSelectionFlow');
const { generateMatchSequence } = require('../server/match/matchSequenceResolver');
const { registerConnection } = require('../server/ws/connectionHandler');
const { routeMessage } = require('../server/ws/messageRouter');

// ---- Cliente (para o teste [24] -- "nenhuma segunda logica de geracao") ----
const ClientSequenceCatalog = require('../client/js/music/sequenceCatalog');
const ClientSequenceGenerator = require('../client/js/match/sequenceGenerator');

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

/** Sala com 1 unico jogador -- janela real de selecao antes da 1a Match. */
function createRoomWithOnePlayer() {
  const ws1 = createMockSocket();
  registerConnection(ws1);
  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  return { ws1, roomCode };
}

/** Sala cheia (2 jogadores), via fluxo de producao real (create_room + join_room). */
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
// 1. Jogador seleciona musica valida
// =====================================================================
test('[1] jogador seleciona uma musica valida e recebe a confirmacao', () => {
  const { ws1 } = createRoomWithOnePlayer();
  send(ws1, { type: 'select_music', musicId: 'music-002' });

  const confirmation = lastOfType(ws1, 'music_selected');
  assert.ok(confirmation);
  assert.strictEqual(confirmation.musicId, 'music-002');
});

// =====================================================================
// 2. Selecao invalida e rejeitada
// =====================================================================
test('[2] selecionar um musicId que nao existe no catalogo e rejeitado', () => {
  const { ws1, roomCode } = createRoomWithOnePlayer();
  send(ws1, { type: 'select_music', musicId: 'musica-fantasma' });

  assert.ok(lastOfType(ws1, 'error'));
  assert.strictEqual(musicSelectionFlow.resolveSelectedMusicId(roomCode), null);
});

// =====================================================================
// 3 / 4. Jogador pode trocar sua selecao / a selecao antiga e substituida
// =====================================================================
test('[3][4] trocar a selecao substitui a anterior, sem deixar as duas registradas', () => {
  const { ws1, roomCode } = createRoomWithOnePlayer();

  send(ws1, { type: 'select_music', musicId: 'music-001' });
  assert.strictEqual(musicSelectionFlow.resolveSelectedMusicId(roomCode), 'music-001');

  send(ws1, { type: 'select_music', musicId: 'music-002' });

  const state = musicSelectionFlow.getSelectionState(roomCode);
  // Um unico valor por slot -- a troca SUBSTITUI, nunca acumula.
  assert.strictEqual(state.player1, 'music-002');
  assert.strictEqual(musicSelectionFlow.resolveSelectedMusicId(roomCode), 'music-002');

  // Confirmacoes recebidas ao longo do caminho: a ULTIMA reflete a
  // escolha final -- nenhuma mensagem de erro foi gerada pela troca.
  const confirmations = allOfType(ws1, 'music_selected');
  assert.strictEqual(confirmations.length, 2);
  assert.strictEqual(confirmations[1].musicId, 'music-002');
  assert.strictEqual(allOfType(ws1, 'error').length, 0);
});

// =====================================================================
// 5. Dois jogadores podem selecionar musicas diferentes
// =====================================================================
test('[5] os dois jogadores podem selecionar musicas diferentes ao mesmo tempo', () => {
  const { ws1, ws2, roomCode, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.FINISHED); // libera selecao (nao esta mais em PLAYING/COUNTDOWN)

  send(ws1, { type: 'select_music', musicId: 'music-001' });
  send(ws2, { type: 'select_music', musicId: 'music-002' });

  const state = musicSelectionFlow.getSelectionState(roomCode);
  assert.strictEqual(state.player1, 'music-001');
  assert.strictEqual(state.player2, 'music-002');
});

// =====================================================================
// 6. A regra de prioridade existente (10D) continua sendo respeitada
// =====================================================================
test('[6] com musicas diferentes, a resolucao continua priorizando player1 (regra da 10D)', () => {
  const { ws1, ws2, roomCode, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.FINISHED);

  send(ws2, { type: 'select_music', musicId: 'music-001' });
  send(ws1, { type: 'select_music', musicId: 'music-002' });

  assert.strictEqual(musicSelectionFlow.resolveSelectedMusicId(roomCode), 'music-002');
});

// =====================================================================
// 7 / 8 / 9. A musica resolvida e usada na Match / ambos recebem o mesmo
// musicId / a Match possui a musica correta
// =====================================================================
test('[7][8][9] a musica resolvida chega a Match e e identica para os dois jogadores', () => {
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);

  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  send(ws1, { type: 'select_music', musicId: 'music-002' });
  send(ws2, { type: 'join_room', roomCode });

  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.musicId, 'music-002');
  assert.strictEqual(match.music.id, 'music-002');

  const readyForP1 = lastOfType(ws1, 'match_ready');
  const readyForP2 = lastOfType(ws2, 'match_ready');
  assert.ok(readyForP1);
  assert.ok(readyForP2);
  assert.strictEqual(readyForP1.match.musicId, 'music-002');
  assert.strictEqual(readyForP2.match.musicId, 'music-002');
  assert.strictEqual(readyForP1.match.musicId, readyForP2.match.musicId);
});

// =====================================================================
// 10. A seed continua sendo unica (e a mesma para os dois jogadores)
// =====================================================================
test('[10] a seed e unica por Match e identica para os dois jogadores', () => {
  const { ws1, ws2 } = createFullRoomViaProduction();

  const readyForP1 = lastOfType(ws1, 'match_ready');
  const readyForP2 = lastOfType(ws2, 'match_ready');

  assert.strictEqual(typeof readyForP1.match.seed, 'number');
  assert.strictEqual(readyForP1.match.seed, readyForP2.match.seed);
});

// =====================================================================
// 11. A timeline continua sendo derivada da musica + seed (nenhum novo
// mecanismo de sincronizacao)
// =====================================================================
test('[11] a sequencia da Match e deterministica a partir de seed+musicId (mesma funcao de sempre)', () => {
  const { match } = createFullRoomViaProduction();

  // Recalcula EXATAMENTE com a mesma funcao que matchFlow.js usa
  // (matchSequenceResolver.generateMatchSequence) -- nenhuma logica
  // nova, so confirma que o resultado guardado na Match e reprodutivel
  // a partir de seed+musicId.
  const recomputed = generateMatchSequence(match.seed, match.musicId);
  assert.deepStrictEqual(recomputed.noteSequence, match.noteSequence);
  assert.strictEqual(recomputed.referenceChecksum, match._referenceChecksum);
});

// =====================================================================
// 12. A selecao e consumida apos iniciar a partida
// =====================================================================
test('[12] a selecao pendente e removida assim que a Match e criada', () => {
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);

  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  send(ws1, { type: 'select_music', musicId: 'music-002' });
  send(ws2, { type: 'join_room', roomCode });

  assert.strictEqual(musicSelectionFlow.getSelectionState(roomCode), null);
});

// =====================================================================
// 13. A selecao nao vaza para outra sala
// =====================================================================
test('[13] a selecao de uma sala nao afeta a resolucao de outra sala', () => {
  const roomA = createRoomWithOnePlayer();
  const roomB = createRoomWithOnePlayer();

  send(roomA.ws1, { type: 'select_music', musicId: 'music-001' });

  assert.strictEqual(musicSelectionFlow.resolveSelectedMusicId(roomA.roomCode), 'music-001');
  assert.strictEqual(musicSelectionFlow.resolveSelectedMusicId(roomB.roomCode), null);
});

// =====================================================================
// 14. Clique repetido nao cria multiplas partidas
// =====================================================================
test('[14] selecionar a mesma musica repetidamente nao cria selecoes/partidas extras', () => {
  const { ws1, roomCode } = createRoomWithOnePlayer();

  for (let i = 0; i < 8; i++) {
    send(ws1, { type: 'select_music', musicId: 'music-001' });
  }

  assert.strictEqual(MatchManager.getMatch(roomCode), null);
  assert.strictEqual(musicSelectionFlow.resolveSelectedMusicId(roomCode), 'music-001');
  assert.strictEqual(allOfType(ws1, 'error').length, 0);
});

// =====================================================================
// 15. Selecao durante PLAYING e ignorada/rejeitada
// =====================================================================
test('[15] select_music durante PLAYING e rejeitado e nao altera a Match em andamento', () => {
  const { ws1, roomCode, match } = createFullRoomViaProduction();
  const musicIdBefore = match.musicId;
  const seedBefore = match.seed;
  const noteSequenceBefore = match.noteSequence.slice();
  match.setState(MATCH_STATE.PLAYING);

  send(ws1, { type: 'select_music', musicId: 'music-002' });

  assert.ok(lastOfType(ws1, 'error'));
  assert.strictEqual(match.musicId, musicIdBefore);
  assert.strictEqual(match.seed, seedBefore);
  assert.deepStrictEqual(match.noteSequence, noteSequenceBefore);
});

// =====================================================================
// 16. Mudanca de selecao antes da partida nao cria countdown
// =====================================================================
test('[16] trocar a selecao antes da sala ficar cheia nunca dispara countdown/Match', () => {
  const { ws1, roomCode } = createRoomWithOnePlayer();

  send(ws1, { type: 'select_music', musicId: 'music-001' });
  send(ws1, { type: 'select_music', musicId: 'music-002' });
  send(ws1, { type: 'select_music', musicId: 'music-001' });

  assert.strictEqual(MatchManager.getMatch(roomCode), null);
  assert.strictEqual(lastOfType(ws1, 'match_countdown_start'), null);
  assert.strictEqual(lastOfType(ws1, 'match_ready'), null);
});

// =====================================================================
// 17. Revanche com nova selecao usa a nova musica
// =====================================================================
test('[17] revanche com uma nova selecao valida usa a nova musica, nao a anterior', () => {
  const { ws1, ws2, roomCode } = createFullRoomViaProduction();
  const firstMatch = MatchManager.getMatch(roomCode);
  const firstMusicId = firstMatch.musicId;
  firstMatch.setState(MATCH_STATE.FINISHED);

  const newMusicId = firstMusicId === 'music-001' ? 'music-002' : 'music-001';
  send(ws1, { type: 'select_music', musicId: newMusicId });

  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  assert.strictEqual(secondMatch.musicId, newMusicId);
  assert.notStrictEqual(secondMatch.musicId, firstMusicId);
});

// =====================================================================
// 18. Revanche sem nova selecao reutiliza a musica anterior
// =====================================================================
test('[18] revanche sem nenhuma nova selecao reutiliza o musicId da partida anterior', () => {
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
// 19. Revanche gera nova seed
// =====================================================================
test('[19] revanche gera uma seed diferente da partida anterior', () => {
  const { ws1, ws2, roomCode } = createFullRoomViaProduction();
  const firstMatch = MatchManager.getMatch(roomCode);
  const firstSeed = firstMatch.seed;
  firstMatch.setState(MATCH_STATE.FINISHED);

  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  assert.notStrictEqual(secondMatch.seed, firstSeed);
});

// =====================================================================
// 20. Revanche gera novo startTimestamp
// =====================================================================
test('[20] revanche gera um novo startTimestamp valido (nunca reaproveita o anterior)', () => {
  const { ws1, ws2, roomCode } = createFullRoomViaProduction();
  const firstMatch = MatchManager.getMatch(roomCode);
  assert.strictEqual(typeof firstMatch.startTimestamp, 'number');
  firstMatch.setState(MATCH_STATE.FINISHED);

  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  assert.strictEqual(typeof secondMatch.startTimestamp, 'number');
  assert.ok(secondMatch.startTimestamp >= Date.now());
  // E uma Match totalmente nova -- o campo nao e o mesmo objeto/estado
  // herdado da anterior (a anterior nem existe mais em MatchManager).
  assert.notStrictEqual(secondMatch, firstMatch);
});

// =====================================================================
// 21. Desconexao limpa corretamente a selecao pendente
// =====================================================================
test('[21] desconectar um jogador limpa a selecao pendente dele, usando os fluxos existentes', () => {
  const { ws1, roomCode, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.FINISHED);

  send(ws1, { type: 'select_music', musicId: 'music-002' });
  assert.strictEqual(musicSelectionFlow.getSelectionState(roomCode).player1, 'music-002');

  ws1._handlers.close.forEach((handler) => handler());

  const stateAfter = musicSelectionFlow.getSelectionState(roomCode);
  assert.ok(!stateAfter || !stateAfter.player1);
});

// =====================================================================
// 22. Nova partida nao herda selecao pendente antiga
// =====================================================================
test('[22] depois que uma selecao e consumida por uma Match, ela nao reaparece em uma Match seguinte', () => {
  const { ws1, ws2, roomCode } = createFullRoomViaProduction();
  const firstMatch = MatchManager.getMatch(roomCode);
  // Nenhuma selecao pendente sobrevive a criacao da 1a Match.
  assert.strictEqual(musicSelectionFlow.getSelectionState(roomCode), null);

  firstMatch.setState(MATCH_STATE.FINISHED);
  send(ws1, { type: 'select_music', musicId: 'music-002' });
  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  // A selecao feita para a revanche tambem foi consumida -- nada sobra
  // pendente para uma 3a Match hipotetica.
  assert.strictEqual(musicSelectionFlow.getSelectionState(roomCode), null);
});

// =====================================================================
// 23. Os dois clientes recebem a mesma configuracao (musicId + music +
// seed identicos no mesmo broadcast)
// =====================================================================
test('[23] match_ready enviado aos dois jogadores tem a MESMA configuracao de musica/seed', () => {
  const { ws1, ws2 } = createFullRoomViaProduction();

  const readyForP1 = lastOfType(ws1, 'match_ready');
  const readyForP2 = lastOfType(ws2, 'match_ready');

  assert.deepStrictEqual(readyForP1.match.music, readyForP2.match.music);
  assert.strictEqual(readyForP1.match.musicId, readyForP2.match.musicId);
  assert.strictEqual(readyForP1.match.seed, readyForP2.match.seed);
});

// =====================================================================
// 24. Nenhuma segunda logica de geracao de timeline e criada
// =====================================================================
test('[24] o padrao resolvido no cliente para a musica da Match bate com o do servidor (uma unica fonte)', () => {
  const { match } = createFullRoomViaProduction();

  const clientPattern = ClientSequenceCatalog.getSequencePattern(match.music.sequenceId);
  assert.ok(clientPattern);

  const clientSequence = ClientSequenceGenerator.generateSequence(
    match.seed,
    clientPattern.length,
    clientPattern.noteRange
  );
  const clientChecksum = ClientSequenceGenerator.calculateChecksum(clientSequence);

  // O cliente, usando SOMENTE seed+musicId recebidos do servidor (nunca
  // nenhum dado gerado localmente por conta propria), reproduz
  // exatamente a mesma sequencia/checksum de referencia do servidor.
  assert.deepStrictEqual(clientSequence, match.noteSequence);
  assert.strictEqual(clientChecksum, match._referenceChecksum);
});

// =====================================================================
// 25. Nenhum sistema de selecao paralelo e criado
// =====================================================================
test('[25] a selecao pendente vive exclusivamente em musicSelectionFlow (nenhum estado duplicado em Room/Match)', () => {
  const { room, match } = createFullRoomViaProduction();

  // Room nao guarda nenhum campo relacionado a selecao de musica.
  const roomKeys = Object.keys(room);
  roomKeys.forEach((key) => {
    assert.ok(!/music/i.test(key), `Room nao deveria ter um campo de musica: ${key}`);
  });

  // Match so guarda o RESULTADO ja resolvido (musicId/music/noteSequence),
  // nunca um estado de "selecao pendente" -- isso e exclusividade de
  // musicSelectionFlow.js.
  assert.strictEqual(match._pendingMusicSelection, undefined);
  assert.strictEqual(match.pendingSelection, undefined);
});

console.log(`\n${passed} teste(s) passaram.`);
