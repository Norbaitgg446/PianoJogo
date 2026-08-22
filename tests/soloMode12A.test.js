/**
 * ETAPA 12A -- MODO SOLO / TREINO (Parte 1: implementacao)
 *
 * Esta suite NAO reimplementa nenhum sistema: exercita os modulos REAIS
 * de producao (RoomManager, Room, MatchManager, Match, matchFlow,
 * gameplayFlow, playerMatchState, finalMatchState, messageRouter,
 * connectionHandler) atraves do mesmo caminho real de rede
 * (routeMessage), mesmo padrao/mocks ja usados em
 * tests/gameplayFullFlow12.test.js e tests/multiplayerEndToEnd10F.test.js.
 *
 * Cobre: criacao da partida Solo, uso de apenas player1, pipeline de
 * musica/seed/sequencia/timeline reutilizado, gameplay (note_hit/
 * note_miss) via playerMatchState existente, finalizacao via
 * sequence_complete -> gameplayFlow.applySequenceComplete ->
 * matchFlow.finishMatch (sem matchOutcome/vencedor), revanche Solo
 * (start_solo_match de novo, nunca rematchFlow), e que o multiplayer
 * continua 100% intacto.
 *
 * Executar com: node tests/soloMode12A.test.js
 */
const assert = require('assert');

const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { MATCH_STATE, MATCH_MODE } = require('../server/match/Match');
const matchOutcome = require('../server/match/matchOutcome');
const { registerConnection } = require('../server/ws/connectionHandler');
const { routeMessage } = require('../server/ws/messageRouter');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`OK   - ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------
// Mesmo mock de conexao WebSocket usado em toda a suite existente.
// ---------------------------------------------------------------------
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
    close() {
      this.readyState = 3;
    },
    _handlers: handlers,
    _triggerClose() {
      handlers.close.forEach((fn) => fn());
    },
  };
}

function send(ws, message) {
  routeMessage(ws, JSON.stringify(message));
}

function lastOfType(socket, type) {
  const matches = socket.sent.filter((m) => m.type === type);
  return matches.length ? matches[matches.length - 1] : null;
}

function countOfType(socket, type) {
  return socket.sent.filter((m) => m.type === type).length;
}

/**
 * Dispara o callback JA AGENDADO pelo setTimeout real de
 * matchFlow.scheduleCountdown -- mesmo codigo de producao (ver
 * tests/gameplayFullFlow12.test.js#fireRealCountdown).
 */
function fireRealCountdown(match) {
  assert.ok(match && match._countdownTimer, 'esperava um _countdownTimer real agendado');
  match._countdownTimer._onTimeout();
}

/**
 * Cria uma partida Solo usando o caminho de PRODUCAO
 * (start_solo_match) e a leva ate PLAYING (countdown real).
 */
function createPlayingSoloMatch(extra) {
  const ws = createMockSocket();
  registerConnection(ws);
  send(ws, Object.assign({ type: 'start_solo_match' }, extra || {}));

  const roomCode = lastOfType(ws, 'room_created').roomCode;
  const room = RoomManager.getRoom(roomCode);
  const match = MatchManager.getMatch(roomCode);

  fireRealCountdown(match);
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);

  return { ws, room, roomCode, match };
}

function noteHitPayload(match, extra = {}) {
  return {
    type: 'note_hit',
    noteId: `note-${match.seed}-0`,
    lane: 1,
    judgement: 'PERFECT',
    deltaMs: 10,
    combo: 1,
    score: 300,
    ...extra,
  };
}

function noteMissPayload(match, extra = {}) {
  return {
    type: 'note_miss',
    noteId: `note-${match.seed}-1`,
    lane: 2,
    combo: 0,
    misses: 1,
    ...extra,
  };
}

// =====================================================================
// BLOCO A -- CRIACAO DA PARTIDA SOLO (itens 1-12)
// =====================================================================

test('[1] criacao de partida Solo: room_created + match_ready chegam para o jogador', () => {
  const ws = createMockSocket();
  registerConnection(ws);
  send(ws, { type: 'start_solo_match' });

  assert.ok(lastOfType(ws, 'room_created'));
  assert.ok(lastOfType(ws, 'match_ready'));
});

test('[2] Match recebe mode === "solo"', () => {
  const { match } = createPlayingSoloMatch();
  assert.strictEqual(match.mode, MATCH_MODE.SOLO);
});

test('[3] apenas player1 participa (room.players.player2 nunca preenchido)', () => {
  const { room } = createPlayingSoloMatch();
  assert.ok(room.players.player1);
  assert.strictEqual(room.players.player2, null);
});

test('[4] player2 nao e necessario: a Match Solo comeca sem esperar ninguem', () => {
  const ws = createMockSocket();
  registerConnection(ws);
  send(ws, { type: 'start_solo_match' });
  const roomCode = lastOfType(ws, 'room_created').roomCode;
  const match = MatchManager.getMatch(roomCode);

  // Diferente do multiplayer (que fica em WAITING_FOR_PLAYER ate a sala
  // encher), a Match Solo ja nasce pronta e avanca direto para o
  // countdown, sem esperar player2 -- mesma transicao sincrona
  // READY -> COUNTDOWN de matchFlow.startMatchFlow (ver
  // tests/gameplayFullFlow12.test.js#[3][4], mesmo comportamento).
  assert.strictEqual(match.state, MATCH_STATE.COUNTDOWN);
});

test('[5] Solo entra em READY', () => {
  const ws = createMockSocket();
  registerConnection(ws);
  send(ws, { type: 'start_solo_match' });
  const ready = lastOfType(ws, 'match_ready');
  assert.ok(ready);
  assert.strictEqual(ready.match.state, MATCH_STATE.READY);
  assert.strictEqual(ready.match.mode, MATCH_MODE.SOLO);
});

test('[6] Solo entra em COUNTDOWN', () => {
  const ws = createMockSocket();
  registerConnection(ws);
  send(ws, { type: 'start_solo_match' });
  const roomCode = lastOfType(ws, 'room_created').roomCode;
  const match = MatchManager.getMatch(roomCode);

  assert.strictEqual(match.state, MATCH_STATE.COUNTDOWN);
  const countdown = lastOfType(ws, 'match_countdown_start');
  assert.ok(countdown);
  assert.strictEqual(countdown.match.mode, MATCH_MODE.SOLO);
});

test('[7] Solo entra em PLAYING', () => {
  const { match, ws } = createPlayingSoloMatch();
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);
  assert.strictEqual(countOfType(ws, 'match_started'), 1);
});

test('[8] musicId correto (cai no DEFAULT_MUSIC_ID quando nenhum e pedido, mesma regra do multiplayer)', () => {
  const { match } = createPlayingSoloMatch();
  const { DEFAULT_MUSIC_ID } = require('../server/config');
  assert.strictEqual(match.musicId, DEFAULT_MUSIC_ID);
});

test('[8-b] musicId explicito e respeitado quando informado em start_solo_match', () => {
  const { match } = createPlayingSoloMatch({ musicId: 'music-002' });
  assert.strictEqual(match.musicId, 'music-002');
});

test('[9] sequenceId correto (vem do musicCatalog, mesmo pipeline do multiplayer)', () => {
  const { match } = createPlayingSoloMatch();
  assert.ok(match.music && match.music.sequenceId);
});

test('[10] seed criada', () => {
  const { match } = createPlayingSoloMatch();
  assert.ok(Number.isFinite(match.seed));
});

test('[11] sequence criada (referencia interna do servidor, nunca exposta ao cliente)', () => {
  const { match } = createPlayingSoloMatch();
  assert.ok(Array.isArray(match.noteSequence) && match.noteSequence.length > 0);
  assert.strictEqual(match.toPublicJSON().noteSequence, undefined);
});

test('[12] timeline criada (startTimestamp definido, mesmo mecanismo de sincronizacao do multiplayer)', () => {
  const { match } = createPlayingSoloMatch();
  assert.ok(Number.isFinite(match.startTimestamp));
});

// =====================================================================
// BLOCO B -- SEQUENCE_CHECK / GAMEPLAY (itens 13-18)
// =====================================================================

test('sequence_check Solo: um unico player1 reportando ja completa a verificacao (sem esperar player2)', () => {
  const { ws, match } = createPlayingSoloMatch();
  send(ws, { type: 'sequence_check', seed: match.seed, checksum: match._referenceChecksum, sequence: match.noteSequence });

  const result = lastOfType(ws, 'sequence_check_result');
  assert.ok(result, 'esperava sequence_check_result mesmo sem um player2');
  assert.strictEqual(result.identical, true);
  assert.strictEqual(result.player2Checksum, null);
});

test('[13] note_hit funciona', () => {
  const { ws, match } = createPlayingSoloMatch();
  send(ws, noteHitPayload(match, { combo: 1, score: 300 }));
  assert.strictEqual(match.players.player1.hits, 1);
});

test('[14] note_miss funciona', () => {
  const { ws, match } = createPlayingSoloMatch();
  send(ws, noteMissPayload(match));
  assert.strictEqual(match.players.player1.misses, 1);
});

test('[15] score funciona', () => {
  const { ws, match } = createPlayingSoloMatch();
  send(ws, noteHitPayload(match, { combo: 1, score: 300 }));
  send(ws, noteHitPayload(match, { noteId: `note-${match.seed}-2`, combo: 2, score: 700 }));
  assert.strictEqual(match.players.player1.score, 700);
});

test('[16] combo funciona', () => {
  const { ws, match } = createPlayingSoloMatch();
  send(ws, noteHitPayload(match, { combo: 1, score: 300 }));
  send(ws, noteHitPayload(match, { noteId: `note-${match.seed}-2`, combo: 2, score: 700 }));
  assert.strictEqual(match.players.player1.combo, 2);
  assert.strictEqual(match.players.player1.maxCombo, 2);
});

test('[17] hits funciona', () => {
  const { ws, match } = createPlayingSoloMatch();
  send(ws, noteHitPayload(match));
  send(ws, noteHitPayload(match, { noteId: `note-${match.seed}-2` }));
  assert.strictEqual(match.players.player1.hits, 2);
});

test('[18] misses funciona', () => {
  const { ws, match } = createPlayingSoloMatch();
  send(ws, noteMissPayload(match));
  send(ws, noteMissPayload(match, { noteId: `note-${match.seed}-2` }));
  assert.strictEqual(match.players.player1.misses, 2);
});

// =====================================================================
// BLOCO C -- FIM DA PARTIDA SOLO / RESULTADO (itens 19-23)
// =====================================================================

test('[19] sequence_complete finaliza a partida', () => {
  const { ws, match } = createPlayingSoloMatch();
  send(ws, { type: 'sequence_complete' });
  assert.notStrictEqual(match.state, MATCH_STATE.PLAYING);
});

test('[20] Match chega em FINISHED', () => {
  const { ws, match } = createPlayingSoloMatch();
  send(ws, { type: 'sequence_complete' });
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);
});

test('[21] resultado Solo nao compara contra player2 (matchOutcome nunca e usado)', () => {
  const { ws, match } = createPlayingSoloMatch();
  send(ws, noteHitPayload(match, { combo: 1, score: 300 }));
  send(ws, { type: 'sequence_complete' });

  assert.strictEqual(matchOutcome.hasFinalOutcome(match), false, 'Solo nunca deve gerar um outcome de vencedor/perdedor');

  const result = lastOfType(ws, 'match_result');
  assert.ok(result);
  assert.strictEqual(result.mode, MATCH_MODE.SOLO);
  assert.strictEqual(result.result, undefined);
  assert.strictEqual(result.winner, undefined);
  assert.strictEqual(result.loser, undefined);
});

test('[22] resultado contem estatisticas do player1', () => {
  const { ws, match } = createPlayingSoloMatch();
  send(ws, noteHitPayload(match, { combo: 1, score: 300 }));
  send(ws, noteMissPayload(match, { noteId: `note-${match.seed}-2` }));
  send(ws, { type: 'sequence_complete' });

  const result = lastOfType(ws, 'match_result');
  assert.ok(result.player1);
  assert.strictEqual(result.player1.score, 300);
  assert.strictEqual(result.player1.hits, 1);
  assert.strictEqual(result.player1.misses, 1);
});

test('[23] resultado nao possui vencedor/derrotado incorreto (sem campo player2)', () => {
  const { ws, match } = createPlayingSoloMatch();
  send(ws, { type: 'sequence_complete' });

  const result = lastOfType(ws, 'match_result');
  assert.strictEqual(result.player2, undefined);
});

test('match_result Solo e enviado exatamente uma vez, mesmo com sequence_complete duplicado', () => {
  const { ws, match } = createPlayingSoloMatch();
  send(ws, { type: 'sequence_complete' });
  send(ws, { type: 'sequence_complete' });
  send(ws, { type: 'sequence_complete' });

  assert.strictEqual(countOfType(ws, 'match_result'), 1);
});

test('apos FINISHED, note_hit/note_miss Solo sao rejeitados e nao alteram o estado oficial', () => {
  const { ws, match } = createPlayingSoloMatch();
  send(ws, noteHitPayload(match, { combo: 1, score: 300 }));
  send(ws, { type: 'sequence_complete' });

  const scoreBefore = match.players.player1.score;
  send(ws, noteHitPayload(match, { noteId: `note-${match.seed}-9`, combo: 5, score: 9999 }));
  assert.strictEqual(match.players.player1.score, scoreBefore);
});

// =====================================================================
// BLOCO D -- REVANCHE SOLO (itens 24-30)
// =====================================================================

test('[24] rematch Solo cria nova Match (nao usa rematchFlow/rematch_ready)', () => {
  const { ws, match: firstMatch, roomCode } = createPlayingSoloMatch();
  send(ws, { type: 'sequence_complete' });

  send(ws, { type: 'start_solo_match' });
  const secondMatch = MatchManager.getMatch(roomCode);

  assert.notStrictEqual(secondMatch, firstMatch, 'a revanche Solo precisa ser uma INSTANCIA de Match nova');
  assert.strictEqual(secondMatch.mode, MATCH_MODE.SOLO);
});

test('[25] rematch Solo gera nova seed', () => {
  const { ws, match: firstMatch, roomCode } = createPlayingSoloMatch();
  const firstSeed = firstMatch.seed;
  send(ws, { type: 'sequence_complete' });

  send(ws, { type: 'start_solo_match' });
  const secondMatch = MatchManager.getMatch(roomCode);

  assert.notStrictEqual(secondMatch.seed, firstSeed);
});

test('[26] rematch Solo gera novo timestamp (recalculado por matchFlow.scheduleCountdown, nunca copiado da partida anterior)', () => {
  const { ws, match: firstMatch, roomCode } = createPlayingSoloMatch();
  send(ws, { type: 'sequence_complete' });

  send(ws, { type: 'start_solo_match' });
  const secondMatch = MatchManager.getMatch(roomCode);

  // Mesma convencao do multiplayer (ver
  // tests/gameplayFullFlow12.test.js#[27]): comparar por igualdade
  // estrita ao milissegundo e instavel neste teste sincrono (as duas
  // partidas podem ser criadas no mesmo ms) -- o que importa e que o
  // timestamp seja recalculado (numero futuro valido, coerente com o
  // countdown recem-agendado), nunca copiado da Match anterior.
  assert.ok(Number.isFinite(secondMatch.startTimestamp));
  assert.ok(secondMatch.startTimestamp >= firstMatch.startTimestamp);
  assert.ok(secondMatch._countdownTimer, 'esperava um novo countdown agendado para a revanche Solo');
});

test('[27][28][29][30] rematch Solo reseta score/combo/hits/misses (nunca reaproveita o estado anterior)', () => {
  const { ws, match: firstMatch, roomCode } = createPlayingSoloMatch();
  send(ws, noteHitPayload(firstMatch, { combo: 3, score: 900 }));
  send(ws, noteMissPayload(firstMatch, { noteId: `note-${firstMatch.seed}-2` }));
  assert.strictEqual(firstMatch.players.player1.score, 900);

  send(ws, { type: 'sequence_complete' });
  send(ws, { type: 'start_solo_match' });
  const secondMatch = MatchManager.getMatch(roomCode);

  assert.strictEqual(secondMatch.players.player1.score, 0);
  assert.strictEqual(secondMatch.players.player1.combo, 0);
  assert.strictEqual(secondMatch.players.player1.hits, 0);
  assert.strictEqual(secondMatch.players.player1.misses, 0);
});

test('rematch Solo reaproveita a mesma musica quando nenhuma nova e pedida (mesma regra do rematch multiplayer)', () => {
  const { ws, match: firstMatch, roomCode } = createPlayingSoloMatch({ musicId: 'music-002' });
  send(ws, { type: 'sequence_complete' });

  send(ws, { type: 'start_solo_match' });
  const secondMatch = MatchManager.getMatch(roomCode);

  assert.strictEqual(secondMatch.musicId, firstMatch.musicId);
});

// =====================================================================
// BLOCO E -- MULTIPLAYER NAO PODE QUEBRAR / ISOLAMENTO (itens 31-35)
// =====================================================================

test('[31] multiplayer continua funcionando (mode === "multiplayer", fluxo normal ate FINISHED)', () => {
  const wsPlayer1 = createMockSocket();
  const wsPlayer2 = createMockSocket();
  registerConnection(wsPlayer1);
  registerConnection(wsPlayer2);

  send(wsPlayer1, { type: 'create_room' });
  const roomCode = lastOfType(wsPlayer1, 'room_created').roomCode;
  send(wsPlayer2, { type: 'join_room', roomCode });

  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.mode, MATCH_MODE.MULTIPLAYER);

  fireRealCountdown(match);
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);

  send(wsPlayer1, { type: 'sequence_complete' });
  send(wsPlayer2, { type: 'sequence_complete' });
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);

  const result = lastOfType(wsPlayer1, 'match_result');
  assert.ok(result);
  assert.strictEqual(result.result, 'draw');
  assert.strictEqual(result.mode, undefined, 'match_result multiplayer nao deve ganhar um campo mode novo');
});

test('[32] duas partidas Solo independentes nao compartilham estado', () => {
  const soloA = createPlayingSoloMatch();
  const soloB = createPlayingSoloMatch();

  send(soloA.ws, noteHitPayload(soloA.match, { combo: 1, score: 300 }));

  assert.strictEqual(soloA.match.players.player1.score, 300);
  assert.strictEqual(soloB.match.players.player1.score, 0);
  assert.notStrictEqual(soloA.roomCode, soloB.roomCode);
});

test('[33] Solo nao interfere em uma sala multiplayer', () => {
  const wsPlayer1 = createMockSocket();
  const wsPlayer2 = createMockSocket();
  registerConnection(wsPlayer1);
  registerConnection(wsPlayer2);
  send(wsPlayer1, { type: 'create_room' });
  const mpRoomCode = lastOfType(wsPlayer1, 'room_created').roomCode;
  send(wsPlayer2, { type: 'join_room', roomCode: mpRoomCode });
  const mpMatch = MatchManager.getMatch(mpRoomCode);
  fireRealCountdown(mpMatch);

  const solo = createPlayingSoloMatch();
  send(solo.ws, noteHitPayload(solo.match, { combo: 1, score: 300 }));
  send(solo.ws, { type: 'sequence_complete' });

  assert.strictEqual(mpMatch.state, MATCH_STATE.PLAYING, 'a partida multiplayer nao deveria ser afetada pela Solo');
  assert.strictEqual(mpMatch.mode, MATCH_MODE.MULTIPLAYER);
});

test('[34] musica do Solo nao altera outra partida', () => {
  const soloA = createPlayingSoloMatch({ musicId: 'music-001' });
  const soloB = createPlayingSoloMatch({ musicId: 'music-002' });

  assert.strictEqual(soloA.match.musicId, 'music-001');
  assert.strictEqual(soloB.match.musicId, 'music-002');
});

test('[35] seed do Solo nao altera outra partida', () => {
  const soloA = createPlayingSoloMatch();
  const soloB = createPlayingSoloMatch();

  assert.notStrictEqual(soloA.match.seed, soloB.match.seed);
});

console.log(`\n${passed} teste(s) passaram, ${failed} falharam.`);
if (failed > 0) process.exitCode = 1;
