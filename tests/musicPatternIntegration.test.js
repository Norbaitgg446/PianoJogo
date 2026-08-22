/**
 * ETAPA 10B -- Padroes de notas reais por musica.
 *
 * Cobre a parte que a Etapa 10A ainda nao testava: que padroes
 * DIFERENTES (associados a musicas diferentes) realmente produzem
 * sequencias/timelines diferentes com a MESMA seed, tanto no servidor
 * (server/match/matchSequenceResolver.js, extraido de matchFlow.js
 * nesta etapa) quanto no cliente (client/js/music/sequenceCatalog.js,
 * novo nesta etapa, usado por client/js/main.js para montar a timeline
 * com o padrao correto de cada musica).
 *
 * Nao recria nenhum sistema: reusa musicCatalog, sequenceCatalog (server
 * e cliente), SequenceGenerator (server e cliente), NoteEngine,
 * MatchTimelineManager, Match e matchFlow ja existentes.
 *
 * Executar com: node tests/musicPatternIntegration.test.js
 */
const assert = require('assert');

// ---- Servidor ----
const musicCatalog = require('../server/music/musicCatalog');
const sequenceCatalog = require('../server/music/sequenceCatalog');
const { generateSequence } = require('../server/match/sequenceGenerator');
const { resolveMusicAndPattern, generateMatchSequence } = require('../server/match/matchSequenceResolver');
const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const rematchFlow = require('../server/match/rematchFlow');
const { MATCH_STATE } = require('../server/match/Match');
const { registerConnection } = require('../server/ws/connectionHandler');
const { routeMessage } = require('../server/ws/messageRouter');

// ---- Cliente ----
const ClientSequenceCatalog = require('../client/js/music/sequenceCatalog');
const ClientSequenceGenerator = require('../client/js/match/sequenceGenerator');
const MatchTimelineManager = require('../client/js/match/matchTimelineManager');
const NoteEngine = require('../client/js/match/noteEngine');

let passed = 0;
function test(name, fn) {
  try {
    MatchTimelineManager.clear();
    fn();
    passed++;
    console.log(`OK   - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// ---- Helpers (mesmo padrao ja usado em tests/musicCatalog.test.js) ----
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
  };
}

function lastOfType(socket, type) {
  const matches = socket.sent.filter((m) => m.type === type);
  return matches.length ? matches[matches.length - 1] : null;
}

function send(ws, message) {
  routeMessage(ws, JSON.stringify(message));
}

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
// [1] music-001 resolve seu sequenceId correto
// =====================================================================
test('[1] music-001 resolve seu sequenceId correto', () => {
  const music = musicCatalog.getMusicById('music-001');
  assert.strictEqual(music.sequenceId, 'seq-basic-01');

  const { music: resolvedMusic, pattern } = resolveMusicAndPattern('music-001');
  assert.strictEqual(resolvedMusic.id, 'music-001');
  assert.deepStrictEqual(pattern, sequenceCatalog.getSequencePattern('seq-basic-01'));
});

// =====================================================================
// [2] music-002 resolve seu sequenceId correto
// =====================================================================
test('[2] music-002 resolve seu sequenceId correto', () => {
  const music = musicCatalog.getMusicById('music-002');
  assert.strictEqual(music.sequenceId, 'seq-basic-02');

  const { music: resolvedMusic, pattern } = resolveMusicAndPattern('music-002');
  assert.strictEqual(resolvedMusic.id, 'music-002');
  assert.deepStrictEqual(pattern, sequenceCatalog.getSequencePattern('seq-basic-02'));
});

// =====================================================================
// [3] sequenceId inexistente e rejeitado
// =====================================================================
test('[3] sequenceId inexistente e rejeitado (musica invalida no catalogo de teste rejeita registro; resolver rejeita musicId inexistente)', () => {
  assert.throws(() => resolveMusicAndPattern('music-nao-existe'), /nao encontrada no catalogo/);

  const catalog = new musicCatalog.MusicCatalog();
  assert.throws(
    () =>
      catalog.registerMusic({
        id: 'music-invalida',
        title: 'X',
        artist: 'Y',
        bpm: 120,
        durationMs: 1000,
        difficulty: 'easy',
        sequenceId: 'seq-que-nao-existe',
      }),
    /sequenceId/
  );
});

// =====================================================================
// [4] padroes diferentes produzem configuracoes diferentes
// =====================================================================
test('[4] padroes diferentes (seq-basic-01 vs seq-basic-02) produzem configuracoes diferentes', () => {
  const pattern1 = sequenceCatalog.getSequencePattern('seq-basic-01');
  const pattern2 = sequenceCatalog.getSequencePattern('seq-basic-02');

  assert.notDeepStrictEqual(pattern1, pattern2);
  assert.notStrictEqual(pattern1.length, pattern2.length);
});

// =====================================================================
// [5] mesma seed + mesmo padrao produz sequencia deterministica
// =====================================================================
test('[5] mesma seed + mesmo padrao produz sequencia deterministica', () => {
  const pattern = sequenceCatalog.getSequencePattern('seq-basic-01');
  const seqA = generateSequence(12345, pattern.length, pattern.noteRange);
  const seqB = generateSequence(12345, pattern.length, pattern.noteRange);

  assert.deepStrictEqual(seqA, seqB);
});

// =====================================================================
// [6] mesma seed + padroes diferentes produzem sequencias diferentes
// =====================================================================
test('[6] mesma seed + padroes diferentes (music-001 vs music-002) produzem sequencias diferentes', () => {
  const seed = 777;
  const result1 = generateMatchSequence(seed, 'music-001');
  const result2 = generateMatchSequence(seed, 'music-002');

  assert.notDeepStrictEqual(result1.noteSequence, result2.noteSequence);
  assert.notStrictEqual(result1.noteSequence.length, result2.noteSequence.length);
});

// =====================================================================
// [7] duas Matches com mesma musica e mesma seed produzem sequencia
// equivalente
// =====================================================================
test('[7] duas Matches (server) com mesma musica e mesma seed produzem sequencia equivalente', () => {
  const seed = 42;
  const resultA = generateMatchSequence(seed, 'music-001');
  const resultB = generateMatchSequence(seed, 'music-001');

  assert.deepStrictEqual(resultA.noteSequence, resultB.noteSequence);
  assert.strictEqual(resultA.referenceChecksum, resultB.referenceChecksum);
});

// =====================================================================
// [8] duas Matches com musicas diferentes nao usam automaticamente o
// mesmo padrao
// =====================================================================
test('[8] duas resolucoes com musicas diferentes nao usam o mesmo padrao automaticamente', () => {
  const { pattern: pattern1 } = resolveMusicAndPattern('music-001');
  const { pattern: pattern2 } = resolveMusicAndPattern('music-002');

  assert.notDeepStrictEqual(pattern1, pattern2);
});

// =====================================================================
// [9] sequencia retornada pelo catalogo e protegida contra mutacao
// externa (servidor e cliente)
// =====================================================================
test('[9] getSequencePattern (server e cliente) protege o catalogo interno contra mutacao externa', () => {
  const before = sequenceCatalog.getSequencePattern('seq-basic-01');
  const mutated = sequenceCatalog.getSequencePattern('seq-basic-01');
  mutated.length = 999999;
  const after = sequenceCatalog.getSequencePattern('seq-basic-01');
  assert.strictEqual(after.length, before.length);

  const clientBefore = ClientSequenceCatalog.getSequencePattern('seq-basic-01');
  const clientMutated = ClientSequenceCatalog.getSequencePattern('seq-basic-01');
  clientMutated.noteRange = 999999;
  const clientAfter = ClientSequenceCatalog.getSequencePattern('seq-basic-01');
  assert.strictEqual(clientAfter.noteRange, clientBefore.noteRange);
});

// =====================================================================
// [10] padroes sao isolados (alterar um nao afeta outro)
// =====================================================================
test('[10] padroes sao isolados entre si (mutar a copia de um nao afeta o outro)', () => {
  const pattern1 = sequenceCatalog.getSequencePattern('seq-basic-01');
  pattern1.length = 123456;

  const pattern2 = sequenceCatalog.getSequencePattern('seq-basic-02');
  assert.notStrictEqual(pattern2.length, 123456);

  const freshPattern1 = sequenceCatalog.getSequencePattern('seq-basic-01');
  assert.notStrictEqual(freshPattern1.length, 123456, 'o catalogo interno nao pode ter sido alterado');
});

// =====================================================================
// [11] uma nova Match nao herda a sequencia da Match anterior
// =====================================================================
test('[11] uma nova Match (sala diferente) nao herda noteSequence/musicId/pattern da Match anterior', () => {
  const roomA = createFullRoomViaProduction();
  const roomB = createFullRoomViaProduction();

  assert.notStrictEqual(roomA.match.noteSequence, roomB.match.noteSequence);
  assert.notStrictEqual(roomA.match.seed, roomB.match.seed);

  roomA.match.noteSequence[0] = -999;
  assert.notStrictEqual(roomB.match.noteSequence[0], -999);
});

// =====================================================================
// [12] revanche recebe nova seed
// =====================================================================
test('[12] revanche recebe uma nova seed (nunca reaproveita a da partida anterior)', () => {
  const { room, ws1, ws2, match: firstMatch } = createFullRoomViaProduction();
  firstMatch.setState(MATCH_STATE.FINISHED);

  rematchFlow.requestRematch(ws1, room);
  rematchFlow.requestRematch(ws2, room);

  const secondMatch = MatchManager.getMatch(room.code);
  assert.notStrictEqual(secondMatch.seed, firstMatch.seed);
});

// =====================================================================
// [13] revanche gera nova sequencia/timeline
// =====================================================================
test('[13] revanche gera uma nova noteSequence (nao reaproveita a instancia da partida anterior)', () => {
  const { room, ws1, ws2, match: firstMatch } = createFullRoomViaProduction();
  firstMatch.setState(MATCH_STATE.FINISHED);
  const firstSequence = firstMatch.noteSequence;

  rematchFlow.requestRematch(ws1, room);
  rematchFlow.requestRematch(ws2, room);

  const secondMatch = MatchManager.getMatch(room.code);
  assert.notStrictEqual(secondMatch.noteSequence, firstSequence);
  assert.notStrictEqual(secondMatch, firstMatch);
});

// =====================================================================
// [14] nenhuma timeline antiga e reutilizada (cliente)
// =====================================================================
test('[14] MatchTimelineManager nunca reutiliza a timeline de uma partida anterior (seed/startTimestamp diferentes)', () => {
  const pattern1 = ClientSequenceCatalog.getSequencePattern('seq-basic-01');
  const timelineA = MatchTimelineManager.ensureTimeline({
    seed: 111,
    startTimestamp: 1_000_000,
    ...pattern1,
  });

  const pattern2 = ClientSequenceCatalog.getSequencePattern('seq-basic-02');
  const timelineB = MatchTimelineManager.ensureTimeline({
    seed: 222,
    startTimestamp: 2_000_000,
    ...pattern2,
  });

  assert.notStrictEqual(timelineA, timelineB);
  assert.notStrictEqual(timelineA.length, timelineB.length);
});

// =====================================================================
// [15] servidor e cliente continuam podendo trabalhar com a mesma
// sequencia deterministica (mesma seed + mesmo padrao)
// =====================================================================
test('[15] servidor e cliente geram a MESMA sequencia (mesma seed + mesmo padrao resolvido de cada lado)', () => {
  const seed = 987654;

  const serverPattern = sequenceCatalog.getSequencePattern('seq-basic-02');
  const serverSequence = generateSequence(seed, serverPattern.length, serverPattern.noteRange);

  const clientPattern = ClientSequenceCatalog.getSequencePattern('seq-basic-02');
  const clientSequence = ClientSequenceGenerator.generateSequence(seed, clientPattern.length, clientPattern.noteRange);

  assert.deepStrictEqual(serverPattern, clientPattern);
  assert.deepStrictEqual(serverSequence, clientSequence);
});

test('[15b] integracao completa server->cliente: match_ready real fornece music.sequenceId que o cliente resolve para o padrao correto', () => {
  const { match } = createFullRoomViaProduction();

  const clientPattern = ClientSequenceCatalog.getSequencePattern(match.music.sequenceId);
  assert.ok(clientPattern, 'o cliente precisa conseguir resolver o sequenceId enviado pelo servidor');

  const clientSequence = ClientSequenceGenerator.generateSequence(match.seed, clientPattern.length, clientPattern.noteRange);
  assert.deepStrictEqual(clientSequence, match.noteSequence, 'cliente e servidor devem gerar a mesma sequencia para a mesma seed+padrao');
});

// =====================================================================
// [16] parametros invalidos do padrao sao rejeitados
// =====================================================================
test('[16] parametros invalidos de padrao sao rejeitados (server e cliente)', () => {
  assert.throws(() => sequenceCatalog.registerPattern('seq-invalido-a', { length: 0, noteRange: 3, noteIntervalMs: 500, leadInMs: 0 }), /length/);
  assert.throws(() => sequenceCatalog.registerPattern('seq-invalido-b', { length: 10, noteRange: -1, noteIntervalMs: 500, leadInMs: 0 }), /noteRange/);
  assert.throws(() => sequenceCatalog.registerPattern('seq-invalido-c', { length: 10, noteRange: 3, noteIntervalMs: 0, leadInMs: 0 }), /noteIntervalMs/);
  assert.throws(() => sequenceCatalog.registerPattern('seq-invalido-d', { length: 10, noteRange: 3, noteIntervalMs: 500, leadInMs: -5 }), /leadInMs/);

  assert.throws(() => ClientSequenceCatalog.registerPattern('seq-invalido-cli', { length: 0, noteRange: 3, noteIntervalMs: 500, leadInMs: 0 }), /length/);

  // NoteEngine (cliente) tambem rejeita parametros invalidos ao montar a timeline.
  assert.throws(() => NoteEngine.generateNoteTimeline({ seed: 1, startTimestamp: 1000, length: 0, noteRange: 3, noteIntervalMs: 500 }), /length/);
  assert.throws(() => NoteEngine.generateNoteTimeline({ seed: 1, startTimestamp: 1000, length: 10, noteRange: 0, noteIntervalMs: 500 }), /noteRange/);
});

// =====================================================================
// Extra: isolamento explicito music-001 <-> music-002 (nunca cruzam)
// =====================================================================
test('[extra] music-001 nunca usa acidentalmente o padrao de music-002, e vice-versa', () => {
  const { pattern: pattern1 } = resolveMusicAndPattern('music-001');
  const { pattern: pattern2 } = resolveMusicAndPattern('music-002');

  assert.deepStrictEqual(pattern1, sequenceCatalog.getSequencePattern('seq-basic-01'));
  assert.deepStrictEqual(pattern2, sequenceCatalog.getSequencePattern('seq-basic-02'));
  assert.notDeepStrictEqual(pattern1, sequenceCatalog.getSequencePattern('seq-basic-02'));
});

console.log(`\n${passed} teste(s) passaram.\n`);
