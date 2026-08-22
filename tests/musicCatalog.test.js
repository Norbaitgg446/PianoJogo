/**
 * ETAPA 10A -- Sistema base de musicas.
 *
 * Testa, em Node puro (sem servidor real, sem WebSocket):
 * - o catalogo de musicas (server/music/musicCatalog.js): iniciacao,
 *   busca por ID, validacao de campos obrigatorios, rejeicao de ID
 *   duplicado, isolamento (copias independentes);
 * - o catalogo de padroes de sequencia (server/music/sequenceCatalog.js):
 *   associacao musica -> sequenceId -> padrao;
 * - a integracao minima com server/match/matchFlow.js e
 *   server/match/Match.js: uma Match nova sabe qual musica esta sendo
 *   jogada (match.musicId/match.music), nunca herda a musica de uma
 *   Match anterior, e a seed continua sendo o unico mecanismo de
 *   sincronizacao (nao foi substituida por nada).
 *
 * Executar com: node tests/musicCatalog.test.js
 */
const assert = require('assert');
const musicCatalog = require('../server/music/musicCatalog');
const sequenceCatalog = require('../server/music/sequenceCatalog');
const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { MATCH_STATE } = require('../server/match/Match');
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

function validMusicDefinition(overrides = {}) {
  return {
    id: 'music-test-001',
    title: 'Faixa de Teste',
    artist: 'Artista de Teste',
    bpm: 128,
    durationMs: 60000,
    difficulty: 'easy',
    sequenceId: 'seq-basic-01',
    ...overrides,
  };
}

// =====================================================================
// 1. catalogo inicia corretamente
// =====================================================================
test('[1] catalogo padrao inicia com pelo menos uma musica', () => {
  const all = musicCatalog.getAllMusics();
  assert.ok(Array.isArray(all));
  assert.ok(all.length >= 1);
});

// =====================================================================
// 2. musicas possuem IDs unicos
// =====================================================================
test('[2] todas as musicas do catalogo padrao possuem IDs unicos', () => {
  const all = musicCatalog.getAllMusics();
  const ids = all.map((m) => m.id);
  const uniqueIds = new Set(ids);
  assert.strictEqual(uniqueIds.size, ids.length);
});

// =====================================================================
// 3. buscar musica existente funciona
// =====================================================================
test('[3] getMusicById encontra uma musica existente do catalogo padrao', () => {
  const music = musicCatalog.getMusicById('music-001');
  assert.ok(music);
  assert.strictEqual(music.id, 'music-001');
  assert.ok(typeof music.title === 'string' && music.title.length > 0);
});

// =====================================================================
// 4. buscar musica inexistente retorna null (mesmo padrao de
// RoomManager.getRoom/MatchManager.getMatch -- nunca lanca excecao)
// =====================================================================
test('[4] getMusicById devolve null para um ID inexistente', () => {
  assert.strictEqual(musicCatalog.getMusicById('music-nao-existe'), null);
});

test('[4b] musicExists reflete corretamente presenca/ausencia de uma musica', () => {
  assert.strictEqual(musicCatalog.musicExists('music-001'), true);
  assert.strictEqual(musicCatalog.musicExists('music-nao-existe'), false);
});

// =====================================================================
// 5. metadados sao validos
// =====================================================================
test('[5] getMusicMetadata devolve metadados com todos os campos minimos exigidos', () => {
  const metadata = musicCatalog.getMusicMetadata('music-001');
  assert.ok(metadata);
  assert.strictEqual(typeof metadata.id, 'string');
  assert.strictEqual(typeof metadata.title, 'string');
  assert.strictEqual(typeof metadata.artist, 'string');
  assert.strictEqual(typeof metadata.bpm, 'number');
  assert.strictEqual(typeof metadata.durationMs, 'number');
  assert.ok(musicCatalog.VALID_DIFFICULTIES.includes(metadata.difficulty));
  assert.strictEqual(typeof metadata.sequenceId, 'string');
  assert.ok(sequenceCatalog.sequenceExists(metadata.sequenceId));
});

// =====================================================================
// 6. BPM invalido e rejeitado
// =====================================================================
test('[6] registerMusic rejeita BPM invalido (zero, negativo, NaN ou ausente)', () => {
  const catalog = new musicCatalog.MusicCatalog();
  assert.throws(() => catalog.registerMusic(validMusicDefinition({ bpm: 0 })), /bpm/);
  assert.throws(() => catalog.registerMusic(validMusicDefinition({ bpm: -10 })), /bpm/);
  assert.throws(() => catalog.registerMusic(validMusicDefinition({ bpm: NaN })), /bpm/);
  assert.throws(() => catalog.registerMusic(validMusicDefinition({ bpm: undefined })), /bpm/);
  assert.strictEqual(catalog.getAllMusics().length, 0, 'nenhuma musica invalida deveria ter sido registrada');
});

// =====================================================================
// 7. duracao invalida e rejeitada
// =====================================================================
test('[7] registerMusic rejeita durationMs invalido (zero, negativo ou ausente)', () => {
  const catalog = new musicCatalog.MusicCatalog();
  assert.throws(() => catalog.registerMusic(validMusicDefinition({ durationMs: 0 })), /durationMs/);
  assert.throws(() => catalog.registerMusic(validMusicDefinition({ durationMs: -1000 })), /durationMs/);
  assert.throws(() => catalog.registerMusic(validMusicDefinition({ durationMs: undefined })), /durationMs/);
});

// =====================================================================
// 8. dificuldade invalida e rejeitada
// =====================================================================
test('[8] registerMusic rejeita difficulty fora do conjunto valido', () => {
  const catalog = new musicCatalog.MusicCatalog();
  assert.throws(() => catalog.registerMusic(validMusicDefinition({ difficulty: 'impossivel' })), /difficulty/);
  assert.throws(() => catalog.registerMusic(validMusicDefinition({ difficulty: '' })), /difficulty/);
  assert.throws(() => catalog.registerMusic(validMusicDefinition({ difficulty: undefined })), /difficulty/);
});

// =====================================================================
// 9. sequenceId invalido e rejeitado
// =====================================================================
test('[9] registerMusic rejeita sequenceId vazio ou inexistente no sequenceCatalog', () => {
  const catalog = new musicCatalog.MusicCatalog();
  assert.throws(() => catalog.registerMusic(validMusicDefinition({ sequenceId: '' })), /sequenceId/);
  assert.throws(() => catalog.registerMusic(validMusicDefinition({ sequenceId: 'seq-que-nao-existe' })), /sequenceId/);
});

test('[9b] registerMusic tambem rejeita id vazio/ausente e title/artist vazios', () => {
  const catalog = new musicCatalog.MusicCatalog();
  assert.throws(() => catalog.registerMusic(validMusicDefinition({ id: '' })), /id/);
  assert.throws(() => catalog.registerMusic(validMusicDefinition({ id: undefined })), /id/);
  assert.throws(() => catalog.registerMusic(validMusicDefinition({ title: '' })), /title/);
  assert.throws(() => catalog.registerMusic(validMusicDefinition({ artist: '' })), /artist/);
});

// =====================================================================
// 10. IDs duplicados sao rejeitados
// =====================================================================
test('[10] registerMusic rejeita um id ja registrado no mesmo catalogo', () => {
  const catalog = new musicCatalog.MusicCatalog();
  catalog.registerMusic(validMusicDefinition({ id: 'music-dup' }));

  assert.throws(
    () => catalog.registerMusic(validMusicDefinition({ id: 'music-dup', title: 'Outro titulo' })),
    /duplicad/
  );
  assert.strictEqual(catalog.getAllMusics().length, 1, 'a segunda tentativa nao deveria ter sido registrada');
});

// =====================================================================
// 11. catalogo nao pode ser alterado externamente
// =====================================================================
test('[11] alterar o objeto devolvido por getAllMusics/getMusicById nao afeta o catalogo interno', () => {
  const before = musicCatalog.getMusicById('music-001');

  const fromGetAll = musicCatalog.getAllMusics().find((m) => m.id === 'music-001');
  fromGetAll.title = 'TITULO ADULTERADO';
  fromGetAll.bpm = 99999;

  const fromGetById = musicCatalog.getMusicById('music-001');
  fromGetById.artist = 'ARTISTA ADULTERADO';

  const after = musicCatalog.getMusicById('music-001');
  assert.strictEqual(after.title, before.title);
  assert.strictEqual(after.bpm, before.bpm);
  assert.strictEqual(after.artist, before.artist);
});

test('[11b] alterar um padrao de sequencia devolvido por getSequencePattern nao afeta o catalogo interno', () => {
  const before = sequenceCatalog.getSequencePattern('seq-basic-01');

  const mutated = sequenceCatalog.getSequencePattern('seq-basic-01');
  mutated.length = 9999;
  mutated.noteRange = 9999;

  const after = sequenceCatalog.getSequencePattern('seq-basic-01');
  assert.strictEqual(after.length, before.length);
  assert.strictEqual(after.noteRange, before.noteRange);
});

// =====================================================================
// 12. musicas sao independentes
// =====================================================================
test('[12] mutar uma musica devolvida nunca afeta outra musica do catalogo', () => {
  const music1 = musicCatalog.getMusicById('music-001');
  const music2Before = musicCatalog.getMusicById('music-002');

  music1.title = 'MUTACAO SO NA COPIA LOCAL';
  music1.bpm = 1;

  const music2After = musicCatalog.getMusicById('music-002');
  assert.strictEqual(music2After.title, music2Before.title);
  assert.strictEqual(music2After.bpm, music2Before.bpm);
  assert.notStrictEqual(music2After.id, music1.id);
});

// =====================================================================
// 13. sequencia e associada a musica correta
// =====================================================================
test('[13] cada musica aponta para o sequenceId correto, e o padrao resolvido bate com o esperado', () => {
  const music1 = musicCatalog.getMusicById('music-001');
  const music2 = musicCatalog.getMusicById('music-002');

  assert.notStrictEqual(music1.sequenceId, music2.sequenceId, 'as duas musicas de teste usam sequenceIds diferentes nesta etapa');

  const pattern1 = sequenceCatalog.getSequencePattern(music1.sequenceId);
  const pattern2 = sequenceCatalog.getSequencePattern(music2.sequenceId);

  assert.ok(pattern1);
  assert.ok(pattern2);
  assert.notDeepStrictEqual(pattern1, pattern2, 'padroes de sequencias diferentes nao deveriam ser identicos');
});

// =====================================================================
// 14. musica pode ser identificada pelo ID
// =====================================================================
test('[14] musicExists identifica corretamente uma musica pelo ID em um catalogo isolado', () => {
  const catalog = new musicCatalog.MusicCatalog();
  assert.strictEqual(catalog.musicExists('music-test-001'), false);

  catalog.registerMusic(validMusicDefinition());

  assert.strictEqual(catalog.musicExists('music-test-001'), true);
  assert.strictEqual(catalog.musicExists('outro-id-qualquer'), false);
});

// =====================================================================
// 15. nova Match nao herda estado de musica anterior
// =====================================================================
test('[15] uma Match nova (sala diferente) nunca compartilha a instancia/estado de musica de outra Match', () => {
  const roomA = createFullRoomViaProduction();
  const roomB = createFullRoomViaProduction();

  assert.ok(roomA.match.music);
  assert.ok(roomB.match.music);
  assert.notStrictEqual(roomA.match.music, roomB.match.music, 'as duas Matches nao podem compartilhar a mesma referencia de objeto `music`');

  // Mutar o objeto `music` de uma Match nunca pode vazar para a outra,
  // nem para o catalogo (ja provado em [11]/[12], reforcado aqui no
  // nivel da propria Match).
  roomA.match.music.title = 'MUTACAO SO NA MATCH A';
  assert.notStrictEqual(roomB.match.music.title, 'MUTACAO SO NA MATCH A');

  // musicId identico (mesma musica padrao, Etapa 10A ainda sem selecao)
  // e esperado, mas o OBJETO music continua sendo uma copia propria de
  // cada Match.
  assert.strictEqual(roomA.match.musicId, roomB.match.musicId);
});

test('[15b] uma Match nova criada apos a Match anterior ser removida (revanche) recebe musica/seed novas, nunca herdadas', () => {
  const { room, ws1, ws2, match: firstMatch } = createFullRoomViaProduction();
  firstMatch.setState(MATCH_STATE.FINISHED);
  firstMatch.music.title = 'MUTACAO NA PARTIDA ANTERIOR';

  const rematchFlow = require('../server/match/rematchFlow');
  rematchFlow.requestRematch(ws1, room);
  rematchFlow.requestRematch(ws2, room); // os dois prontos -> nova Match via matchFlow.startMatchFlow

  const secondMatch = MatchManager.getMatch(room.code);

  assert.notStrictEqual(secondMatch, firstMatch, 'a revanche precisa criar uma Match nova, nunca reaproveitar a antiga');
  assert.notStrictEqual(secondMatch.seed, firstMatch.seed, 'a nova Match deveria ter uma seed nova (mecanismo de sincronizacao intacto)');
  assert.ok(secondMatch.music, 'a nova Match precisa ter uma musica definida (nao null)');
  assert.notStrictEqual(secondMatch.music.title, 'MUTACAO NA PARTIDA ANTERIOR', 'a musica da nova Match nao pode herdar a mutacao da Match anterior');
  assert.notStrictEqual(secondMatch.music, firstMatch.music, 'objeto music precisa ser uma copia nova, nao a mesma referencia');
});

// =====================================================================
// Integracao adicional: matchFlow/Match usando o catalogo
// =====================================================================
test('[integracao] matchFlow.startMatchFlow preenche musicId/music/difficulty a partir do catalogo, e o campo continua exposto em toPublicJSON', () => {
  const { match } = createFullRoomViaProduction();

  assert.strictEqual(match.musicId, 'music-001');
  assert.ok(match.music);
  assert.strictEqual(match.music.id, 'music-001');
  assert.strictEqual(match.difficulty, match.music.difficulty);

  const publicJSON = match.toPublicJSON();
  assert.strictEqual(publicJSON.musicId, 'music-001');
  assert.ok(publicJSON.music);
  assert.strictEqual(publicJSON.seed, match.seed, 'seed continua sendo enviada normalmente, sem ser substituida pela musica');
});

test('[integracao] a sequencia de referencia gerada pelo servidor usa o padrao (length/noteRange) do sequenceId da musica', () => {
  const { match } = createFullRoomViaProduction();

  const expectedPattern = sequenceCatalog.getSequencePattern(match.music.sequenceId);
  assert.strictEqual(match.noteSequence.length, expectedPattern.length);
  assert.ok(match.noteSequence.every((note) => note >= 1 && note <= expectedPattern.noteRange));
});

test('[integracao] a musica de uma Match nao depende de nenhum estado global de sala/partida (mesma musica padrao para salas diferentes e independentes)', () => {
  const roomA = createFullRoomViaProduction();
  const roomB = createFullRoomViaProduction();

  assert.strictEqual(roomA.match.musicId, roomB.match.musicId);
  assert.notStrictEqual(roomA.roomCode, roomB.roomCode);
  // A musica veio do catalogo (dados estaticos), nao de nada guardado
  // na Room/RoomManager -- confirmado pelo catalogo devolver o mesmo
  // conteudo independente da sala consultante.
  assert.deepStrictEqual(musicCatalog.getMusicById(roomA.match.musicId), musicCatalog.getMusicById(roomB.match.musicId));
});

console.log(`\n${passed} teste(s) passaram.\n`);
