/**
 * ETAPA 10C -- Integracao da musica com o ciclo de vida da partida.
 *
 * Cobre a regra principal desta etapa: a musica de uma Match e definida
 * NO MOMENTO DA CRIACAO dela (matchFlow.startMatchFlow), nunca depois --
 * incluindo o caso da revanche, que precisa criar uma INSTANCIA nova
 * (nova seed, nova timeline, estado zerado) mas pode reaproveitar o
 * musicId da partida anterior (ainda sem selecao de musica na
 * interface).
 *
 * Nao recria nenhum sistema: reusa musicCatalog, sequenceCatalog,
 * matchSequenceResolver, Match, matchFlow, rematchFlow e o fluxo real
 * de sala/WebSocket ja existentes (create_room/join_room/rematch_ready
 * via messageRouter, exatamente como o jogo real dispara).
 *
 * Executar com: node tests/matchMusicLifecycle.test.js
 */
const assert = require('assert');

const musicCatalog = require('../server/music/musicCatalog');
const sequenceCatalog = require('../server/music/sequenceCatalog');
const matchFlow = require('../server/match/matchFlow');
const rematchFlow = require('../server/match/rematchFlow');
const { MATCH_STATE } = require('../server/match/Match');
const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { DEFAULT_MUSIC_ID } = require('../server/config');
const { registerConnection } = require('../server/ws/connectionHandler');
const { routeMessage } = require('../server/ws/messageRouter');

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

// ---- Helpers (mesmo padrao ja usado nos testes das etapas anteriores) ----
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

// Cria uma sala + partida real via WebSocket simulado (create_room +
// join_room), exatamente o fluxo de producao -- nunca instancia Match
// manualmente.
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

// Uma "Room" minima e isolada (sem WebSocket real), usada apenas para
// testar matchFlow.startMatchFlow diretamente com musicId explicito --
// reutiliza a mesma API publica de Room (roomCode via toPublicJSON nao
// e necessaria aqui) que RoomManager.createRoom ja produz.
function createIsolatedRoom() {
  return RoomManager.createRoom();
}

// =====================================================================
// [1] partida sem musicId usa DEFAULT_MUSIC_ID
// =====================================================================
test('[1] startMatchFlow sem musicId usa DEFAULT_MUSIC_ID', () => {
  const room = createIsolatedRoom();
  matchFlow.startMatchFlow(room);

  const match = MatchManager.getMatch(room.code);
  assert.strictEqual(match.musicId, DEFAULT_MUSIC_ID);
});

// =====================================================================
// [2] partida com musicId valido utiliza a musica solicitada
// =====================================================================
test('[2] startMatchFlow com musicId explicito ("music-002") utiliza exatamente essa musica', () => {
  const room = createIsolatedRoom();
  matchFlow.startMatchFlow(room, 'music-002');

  const match = MatchManager.getMatch(room.code);
  assert.strictEqual(match.musicId, 'music-002');
  assert.strictEqual(match.music.id, 'music-002');
});

// =====================================================================
// [3] musicId inexistente e rejeitado
// =====================================================================
test('[3] startMatchFlow com musicId inexistente lanca Error e nao registra Match nenhuma', () => {
  const room = createIsolatedRoom();

  assert.throws(() => matchFlow.startMatchFlow(room, 'music-que-nao-existe'), /nao encontrada no catalogo/);
  assert.strictEqual(MatchManager.getMatch(room.code), null, 'nenhuma Match invalida deveria ter sido registrada');
});

// =====================================================================
// [4] musicId vazio e tratado corretamente (equivale a "nao
// especificado" -> cai no DEFAULT_MUSIC_ID, sem lancar erro)
// =====================================================================
test('[4] musicId vazio (ou so espacos) e tratado como "nao especificado" -> DEFAULT_MUSIC_ID', () => {
  assert.strictEqual(matchFlow.normalizeRequestedMusicId(''), null);
  assert.strictEqual(matchFlow.normalizeRequestedMusicId('   '), null);
  assert.strictEqual(matchFlow.normalizeRequestedMusicId(undefined), null);
  assert.strictEqual(matchFlow.normalizeRequestedMusicId(null), null);
  assert.strictEqual(matchFlow.normalizeRequestedMusicId('music-002'), 'music-002');
  assert.strictEqual(matchFlow.normalizeRequestedMusicId('  music-002  '), 'music-002');

  const room = createIsolatedRoom();
  matchFlow.startMatchFlow(room, '');
  const match = MatchManager.getMatch(room.code);
  assert.strictEqual(match.musicId, DEFAULT_MUSIC_ID);
});

// =====================================================================
// [5] musica escolhida fica registrada na Match
// =====================================================================
test('[5] a musica escolhida fica registrada em match.musicId e match.music durante toda a partida', () => {
  const room = createIsolatedRoom();
  matchFlow.startMatchFlow(room, 'music-002');
  const match = MatchManager.getMatch(room.code);

  assert.strictEqual(match.musicId, 'music-002');
  assert.ok(match.music);
  assert.strictEqual(match.music.id, 'music-002');

  // Permanece disponivel apos transicoes de estado (countdown/playing),
  // nunca e limpo/reatribuido por nenhuma outra parte do fluxo.
  match.setState(MATCH_STATE.COUNTDOWN);
  assert.strictEqual(match.musicId, 'music-002');
  match.setState(MATCH_STATE.PLAYING);
  assert.strictEqual(match.musicId, 'music-002');
});

// =====================================================================
// [6] toPublicJSON() envia a musica correta
// =====================================================================
test('[6] toPublicJSON() expoe musicId e music corretos', () => {
  const room = createIsolatedRoom();
  matchFlow.startMatchFlow(room, 'music-002');
  const match = MatchManager.getMatch(room.code);

  const publicJSON = match.toPublicJSON();
  assert.strictEqual(publicJSON.musicId, 'music-002');
  assert.ok(publicJSON.music);
  assert.strictEqual(publicJSON.music.id, 'music-002');
  assert.strictEqual(publicJSON.music.sequenceId, 'seq-basic-02');
});

// =====================================================================
// [7] cliente recebe a musica correta (via mensagem real match_ready)
// =====================================================================
test('[7] o cliente recebe match.music correto na mensagem match_ready real', () => {
  const { ws1 } = createFullRoomViaProduction();

  const matchReady = lastOfType(ws1, 'match_ready');
  assert.ok(matchReady);
  assert.strictEqual(matchReady.match.musicId, DEFAULT_MUSIC_ID);
  assert.ok(matchReady.match.music);
  assert.strictEqual(matchReady.match.music.id, DEFAULT_MUSIC_ID);
});

// =====================================================================
// [8] cliente nao substitui a musica recebida por outra
// =====================================================================
test('[8] a musica recebida pelo cliente permanece identica em match_ready e match_countdown_start (nunca e trocada no meio da partida)', () => {
  const { ws1 } = createFullRoomViaProduction();

  const matchReady = lastOfType(ws1, 'match_ready');
  const countdownStart = lastOfType(ws1, 'match_countdown_start');

  assert.ok(countdownStart, 'o countdown deveria ter sido agendado automaticamente');
  assert.strictEqual(countdownStart.match.musicId, matchReady.match.musicId);
  assert.deepStrictEqual(countdownStart.match.music, matchReady.match.music);
});

// =====================================================================
// [9] sequenceId corresponde a musica
// =====================================================================
test('[9] o sequenceId da musica resolvida corresponde ao sequenceId cadastrado no musicCatalog', () => {
  const room = createIsolatedRoom();
  matchFlow.startMatchFlow(room, 'music-002');
  const match = MatchManager.getMatch(room.code);

  const expectedSequenceId = musicCatalog.getMusicById('music-002').sequenceId;
  assert.strictEqual(match.music.sequenceId, expectedSequenceId);
});

// =====================================================================
// [10] sequencia corresponde ao sequenceId
// =====================================================================
test('[10] a noteSequence da Match corresponde ao padrao (length/noteRange) do sequenceId resolvido', () => {
  const room = createIsolatedRoom();
  matchFlow.startMatchFlow(room, 'music-002');
  const match = MatchManager.getMatch(room.code);

  const pattern = sequenceCatalog.getSequencePattern(match.music.sequenceId);
  assert.strictEqual(match.noteSequence.length, pattern.length);
  assert.ok(match.noteSequence.every((note) => note >= 1 && note <= pattern.noteRange));
});

// =====================================================================
// [11] mesma musica + mesma seed gera mesma sequencia
// =====================================================================
test('[11] mesma musica + mesma seed produz a mesma sequencia (server e cliente)', () => {
  const roomA = createIsolatedRoom();
  const roomB = createIsolatedRoom();
  matchFlow.startMatchFlow(roomA, 'music-002');
  matchFlow.startMatchFlow(roomB, 'music-002');

  const matchA = MatchManager.getMatch(roomA.code);
  const matchB = MatchManager.getMatch(roomB.code);

  // Forca a mesma seed nos dois para isolar exatamente a variavel
  // "mesma musica + mesma seed" (a seed real de cada Match ja e unica
  // por design -- aqui comprovamos que o RESULTADO seria identico se
  // a seed fosse igual, sem reimplementar geracao nenhuma).
  const pattern = sequenceCatalog.getSequencePattern(matchA.music.sequenceId);
  const { generateSequence } = require('../server/match/sequenceGenerator');
  const seqA = generateSequence(999, pattern.length, pattern.noteRange);
  const seqB = generateSequence(999, pattern.length, pattern.noteRange);
  assert.deepStrictEqual(seqA, seqB);

  const clientPattern = ClientSequenceCatalog.getSequencePattern(matchA.music.sequenceId);
  const clientSeq = ClientSequenceGenerator.generateSequence(999, clientPattern.length, clientPattern.noteRange);
  assert.deepStrictEqual(clientSeq, seqA);
});

// =====================================================================
// [12] musica diferente pode gerar sequencia diferente
// =====================================================================
test('[12] musicas diferentes ("music-001" vs "music-002") geram sequencias diferentes para a mesma seed', () => {
  const roomA = createIsolatedRoom();
  const roomB = createIsolatedRoom();
  matchFlow.startMatchFlow(roomA, 'music-001');
  matchFlow.startMatchFlow(roomB, 'music-002');

  const matchA = MatchManager.getMatch(roomA.code);
  const matchB = MatchManager.getMatch(roomB.code);

  const { generateSequence } = require('../server/match/sequenceGenerator');
  const patternA = sequenceCatalog.getSequencePattern(matchA.music.sequenceId);
  const patternB = sequenceCatalog.getSequencePattern(matchB.music.sequenceId);

  const seqA = generateSequence(555, patternA.length, patternA.noteRange);
  const seqB = generateSequence(555, patternB.length, patternB.noteRange);
  assert.notDeepStrictEqual(seqA, seqB);
});

// =====================================================================
// [13] nova Match nao herda estado da Match anterior
// =====================================================================
test('[13] uma nova Match (sala diferente) nunca herda musicId/music/noteSequence/seed de outra Match', () => {
  const roomA = createIsolatedRoom();
  const roomB = createIsolatedRoom();
  matchFlow.startMatchFlow(roomA, 'music-002');
  matchFlow.startMatchFlow(roomB); // sem musicId -> DEFAULT_MUSIC_ID

  const matchA = MatchManager.getMatch(roomA.code);
  const matchB = MatchManager.getMatch(roomB.code);

  assert.notStrictEqual(matchA.musicId, matchB.musicId);
  assert.notStrictEqual(matchA.seed, matchB.seed);
  assert.notStrictEqual(matchA.music, matchB.music);
  assert.notStrictEqual(matchA.noteSequence, matchB.noteSequence);
});

// =====================================================================
// [14] revanche cria nova Match
// =====================================================================
test('[14] revanche (fluxo real) cria uma Match nova, nunca reaproveita a instancia anterior', () => {
  const { room, ws1, ws2, match: firstMatch } = createFullRoomViaProduction();
  firstMatch.setState(MATCH_STATE.FINISHED);

  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(room.code);
  assert.notStrictEqual(secondMatch, firstMatch);
});

// =====================================================================
// [15] revanche gera nova seed
// =====================================================================
test('[15] revanche gera uma nova seed', () => {
  const { room, ws1, ws2, match: firstMatch } = createFullRoomViaProduction();
  firstMatch.setState(MATCH_STATE.FINISHED);
  const previousSeed = firstMatch.seed;

  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(room.code);
  assert.notStrictEqual(secondMatch.seed, previousSeed);
});

// =====================================================================
// [16] revanche gera nova timeline (nova noteSequence de referencia,
// nunca a mesma array/instancia da partida anterior)
// =====================================================================
test('[16] revanche gera uma nova noteSequence de referencia, nunca a mesma instancia/conteudo da anterior', () => {
  const { room, ws1, ws2, match: firstMatch } = createFullRoomViaProduction();
  firstMatch.setState(MATCH_STATE.FINISHED);
  const previousSequence = firstMatch.noteSequence;

  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(room.code);
  assert.notStrictEqual(secondMatch.noteSequence, previousSequence);
  assert.notDeepStrictEqual(secondMatch.noteSequence, previousSequence, 'seeds diferentes devem produzir sequencias diferentes');
});

// =====================================================================
// [17] revanche mantem a musica valida quando nenhuma nova musica foi
// escolhida ("mesma musica" != "mesma Match")
// =====================================================================
test('[17] revanche mantem a MESMA musica (musicId) da partida anterior, mas em uma Match totalmente nova', () => {
  const { room, ws1, ws2, match: firstMatch } = createFullRoomViaProduction();
  firstMatch.setState(MATCH_STATE.FINISHED);
  const previousMusicId = firstMatch.musicId;

  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(room.code);
  assert.strictEqual(secondMatch.musicId, previousMusicId, '"mesma musica" deveria ser preservada');
  assert.notStrictEqual(secondMatch, firstMatch, 'mas nunca a mesma Match');
  assert.notStrictEqual(secondMatch.music, firstMatch.music, 'nem o mesmo objeto music (copia nova)');
  assert.notStrictEqual(secondMatch.seed, firstMatch.seed);
});

// =====================================================================
// [18] resultado anterior nao afeta a musica da nova Match
// =====================================================================
test('[18] o resultado/outcome da partida anterior nunca afeta musicId/music da nova Match da revanche', () => {
  const { room, ws1, ws2, match: firstMatch } = createFullRoomViaProduction();
  firstMatch.setState(MATCH_STATE.FINISHED);
  matchFlow.finishMatch(room);

  const finalMatchState = require('../server/match/finalMatchState');
  const matchOutcome = require('../server/match/matchOutcome');
  assert.ok(finalMatchState.captureFinalMatchState(firstMatch), 'a partida anterior precisa ter um snapshot final');
  assert.ok(matchOutcome.hasFinalOutcome(firstMatch), 'a partida anterior precisa ter um outcome');

  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(room.code);
  assert.ok(secondMatch.music, 'a nova Match precisa ter uma musica definida');
  assert.strictEqual(secondMatch.musicId, firstMatch.musicId);
  assert.strictEqual(matchOutcome.hasFinalOutcome(secondMatch), false, 'a nova Match nao pode nascer com outcome herdado');
});

// =====================================================================
// [19] abandono nao altera o catalogo
// =====================================================================
test('[19] abandonar uma partida nao altera musicCatalog/sequenceCatalog', () => {
  const before = musicCatalog.getAllMusics();

  const { room, ws1 } = createFullRoomViaProduction();
  const matchAbandonment = require('../server/match/matchAbandonment');
  matchAbandonment.handleAbandonment(room, 'player1');

  const after = musicCatalog.getAllMusics();
  assert.deepStrictEqual(after, before);
});

// =====================================================================
// [20] saida da sala nao altera o catalogo
// =====================================================================
test('[20] sair da sala (leave_room real) nao altera musicCatalog/sequenceCatalog', () => {
  const beforeMusic = musicCatalog.getAllMusics();
  const beforeSeq01 = sequenceCatalog.getSequencePattern('seq-basic-01');
  const beforeSeq02 = sequenceCatalog.getSequencePattern('seq-basic-02');

  const { ws1 } = createFullRoomViaProduction();
  send(ws1, { type: 'leave_room' });

  assert.deepStrictEqual(musicCatalog.getAllMusics(), beforeMusic);
  assert.deepStrictEqual(sequenceCatalog.getSequencePattern('seq-basic-01'), beforeSeq01);
  assert.deepStrictEqual(sequenceCatalog.getSequencePattern('seq-basic-02'), beforeSeq02);
});

// =====================================================================
// [21] catalogo continua imutavel externamente
// =====================================================================
test('[21] mutar a Match/music devolvida por uma partida real nunca afeta o musicCatalog interno', () => {
  const { match } = createFullRoomViaProduction();

  match.music.title = 'TITULO ADULTERADO NA MATCH';
  match.musicId = 'id-adulterado';

  const freshFromCatalog = musicCatalog.getMusicById(DEFAULT_MUSIC_ID);
  assert.notStrictEqual(freshFromCatalog.title, 'TITULO ADULTERADO NA MATCH');
});

// =====================================================================
// [22] musica invalida nunca inicia uma partida
// =====================================================================
test('[22] uma musica invalida nunca chega a colocar a Match em READY/PLAYING nem a ser registrada em MatchManager', () => {
  const room = createIsolatedRoom();

  assert.throws(() => matchFlow.startMatchFlow(room, 'music-totalmente-invalida'));
  assert.strictEqual(MatchManager.getMatch(room.code), null);
});

console.log(`\n${passed} teste(s) passaram.\n`);
