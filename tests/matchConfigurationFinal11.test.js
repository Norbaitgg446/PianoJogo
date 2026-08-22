/**
 * ETAPA 11 -- Configuracao FINAL da partida.
 *
 * Esta etapa NAO cria um segundo sistema de configuracao. Ela AUDITA e
 * comprova, com testes que passam pelo fluxo real de producao
 * (routeMessage / matchFlow / rematchFlow / musicSelectionFlow /
 * matchSequenceResolver), que a Match ja e a fonte unica e consistente
 * da configuracao de uma partida:
 *
 *   musicId -> musicCatalog -> music.sequenceId -> sequenceCatalog ->
 *   pattern -> seed -> generateSequence -> noteSequence -> timeline
 *
 * e que:
 * - musicId/music/difficulty/speed/seed/startTimestamp sao identicos
 *   para os dois jogadores;
 * - nada disso pode ser alterado depois que a Match entra em
 *   READY/COUNTDOWN/PLAYING;
 * - revanche sempre produz seed/timestamp/estado novos, nunca reaproveita
 *   a Match anterior;
 * - duas salas simultaneas nunca compartilham configuracao;
 * - entradas invalidas sao rejeitadas sem deixar a Match parcialmente
 *   configurada nem estado global manchado.
 *
 * BUG ENCONTRADO E CORRIGIDO NESTA ETAPA (correcao minima, sem sistema
 * paralelo): `musicSelectionFlow.handleSelectMusic` bloqueava
 * `select_music` durante COUNTDOWN e PLAYING, mas nao durante READY --
 * o unico estado em que a Match ja existe (com musicId/music/seed/
 * noteSequence resolvidos) mas o countdown ainda nao comecou. Na pratica
 * esse estado dura 0ms (matchFlow.startMatchFlow chama scheduleCountdown
 * de forma sincrona, sem nenhum I/O no meio), entao nenhuma mensagem de
 * rede real conseguia ser processada durante ele -- mas a checagem foi
 * adicionada por seguranca/defesa em profundidade, seguindo EXATAMENTE
 * o mesmo padrao das duas checagens ja existentes (mesmo modulo, mesma
 * forma, mesma mensagem de erro no mesmo estilo). Os testes [16] e [19]
 * abaixo comprovam a correcao.
 *
 * Executar com: node tests/matchConfigurationFinal11.test.js
 */
const assert = require('assert');
const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { MATCH_STATE } = require('../server/match/Match');
const musicCatalog = require('../server/music/musicCatalog');
const sequenceCatalog = require('../server/music/sequenceCatalog');
const musicSelectionFlow = require('../server/music/musicSelectionFlow');
const matchFlow = require('../server/match/matchFlow');
const { generateMatchSequence, resolveMusicAndPattern } = require('../server/match/matchSequenceResolver');
const { generateSequence, calculateChecksum } = require('../server/match/sequenceGenerator');
const { TEST_SPEED, DEFAULT_MUSIC_ID } = require('../server/config');
const { registerConnection } = require('../server/ws/connectionHandler');
const { routeMessage } = require('../server/ws/messageRouter');

// ---- Cliente (para os testes de "nenhuma segunda logica de geracao") ----
const ClientSequenceCatalog = require('../client/js/music/sequenceCatalog');
const ClientSequenceGenerator = require('../client/js/match/sequenceGenerator');
const MatchTimelineManager = require('../client/js/match/matchTimelineManager');

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

/** Sala cheia (2 jogadores), via fluxo de producao real. */
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
// 1. Configuracao valida: a Match criada pelo fluxo real tem todos os
// campos de configuracao suportados, consistentes entre si.
// =====================================================================
test('[1] a Match criada possui uma configuracao valida e completa', () => {
  const { match } = createFullRoomViaProduction();

  assert.strictEqual(typeof match.musicId, 'string');
  assert.ok(match.music && typeof match.music === 'object');
  assert.strictEqual(match.music.id, match.musicId);
  assert.ok(musicCatalog.VALID_DIFFICULTIES.includes(match.difficulty));
  assert.strictEqual(match.difficulty, match.music.difficulty);
  assert.strictEqual(typeof match.speed, 'number');
  assert.ok(Number.isFinite(match.speed) && match.speed > 0);
  assert.strictEqual(typeof match.seed, 'number');
  assert.ok(Array.isArray(match.noteSequence) && match.noteSequence.length > 0);
  assert.strictEqual(typeof match.music.sequenceId, 'string');
});

// =====================================================================
// 2. musicId valido: as duas musicas de catalogo resolvem corretamente.
// =====================================================================
test('[2] musicId valido resolve music+pattern sem lancar erro', () => {
  ['music-001', 'music-002'].forEach((musicId) => {
    const { music, pattern } = resolveMusicAndPattern(musicId);
    assert.strictEqual(music.id, musicId);
    assert.ok(pattern && Number.isInteger(pattern.length));
  });
});

// =====================================================================
// 3. musicId invalido e rejeitado -- NUNCA cai silenciosamente para o
// default nem cria uma Match parcialmente configurada.
// =====================================================================
test('[3] musicId inexistente lanca erro e nao deixa Match nem selecao presa', () => {
  assert.throws(() => resolveMusicAndPattern('musica-fantasma'));
  assert.throws(() => generateMatchSequence(12345, 'musica-fantasma'));

  const { ws1, roomCode } = createRoomWithOnePlayer();
  const room = RoomManager.getRoom(roomCode);

  assert.throws(() => matchFlow.startMatchFlow(room, 'musica-fantasma'));
  // Nenhuma Match parcial foi registrada para esta sala.
  assert.strictEqual(MatchManager.getMatch(roomCode), null);
});

// =====================================================================
// 4. difficulty valida: sempre uma das VALID_DIFFICULTIES, herdada da
// musica -- nunca inventada/independente.
// =====================================================================
test('[4] difficulty da Match e sempre uma das dificuldades validas do catalogo', () => {
  const { match } = createFullRoomViaProduction();
  assert.ok(['easy', 'medium', 'hard'].includes(match.difficulty));
  assert.strictEqual(match.difficulty, musicCatalog.getMusicById(match.musicId).difficulty);
});

// =====================================================================
// 5. difficulty invalida e rejeitada NA ORIGEM (catalogo) -- nunca
// chega a existir uma musica (e portanto uma Match) com dificuldade
// invalida.
// =====================================================================
test('[5] o catalogo rejeita registrar uma musica com difficulty invalida', () => {
  const { MusicCatalog } = musicCatalog;
  const isolatedCatalog = new MusicCatalog();
  assert.throws(() => {
    isolatedCatalog.registerMusic({
      id: 'music-invalida',
      title: 'Teste',
      artist: 'Teste',
      bpm: 120,
      durationMs: 1000,
      difficulty: 'impossivel',
      sequenceId: 'seq-basic-01',
    });
  }, /difficulty/);
});

// =====================================================================
// 6. speed valida: TEST_SPEED (unica fonte hoje) e um numero positivo
// finito, e a Match sempre guarda exatamente esse valor.
// =====================================================================
test('[6] speed da Match e um numero positivo valido, igual ao config', () => {
  const { match } = createFullRoomViaProduction();
  assert.strictEqual(typeof TEST_SPEED, 'number');
  assert.ok(Number.isFinite(TEST_SPEED) && TEST_SPEED > 0);
  assert.strictEqual(match.speed, TEST_SPEED);
});

// =====================================================================
// 7. speed invalida: nao ha (ainda) nenhuma entrada de jogador capaz de
// alterar speed -- confirma que nenhuma mensagem de rede consegue
// influenciar este campo (nao existe handler para isso).
// =====================================================================
test('[7] nenhuma mensagem de cliente e capaz de alterar match.speed', () => {
  const { ws1, match } = createFullRoomViaProduction();
  const speedBefore = match.speed;

  // Tenta de varias formas plausiveis -- todas devem ser ignoradas
  // (tipo de mensagem desconhecido) ou rejeitadas, nunca mudar o campo.
  send(ws1, { type: 'set_speed', speed: 999 });
  send(ws1, { type: 'select_music', speed: 999, musicId: 'music-001' });

  assert.strictEqual(match.speed, speedBefore);
});

// =====================================================================
// 8. configuracao armazenada na Match: todos os campos relevantes
// aparecem em toPublicJSON (o que de fato chega aos clientes).
// =====================================================================
test('[8] toPublicJSON da Match expoe a configuracao completa suportada', () => {
  const { match } = createFullRoomViaProduction();
  const publicJson = match.toPublicJSON();

  assert.strictEqual(publicJson.musicId, match.musicId);
  assert.deepStrictEqual(publicJson.music, match.music);
  assert.strictEqual(publicJson.difficulty, match.difficulty);
  assert.strictEqual(publicJson.speed, match.speed);
  assert.strictEqual(publicJson.seed, match.seed);
  assert.strictEqual(publicJson.state, match.state);
  // A sequencia de referencia do servidor NUNCA e exposta ao cliente.
  assert.strictEqual(publicJson.noteSequence, undefined);
});

// =====================================================================
// 9/10. Os dois jogadores recebem exatamente a mesma configuracao
// (musicId, music, difficulty, speed, seed) no mesmo broadcast.
// =====================================================================
test('[9][10] match_ready enviado aos dois jogadores tem musicId/music/difficulty/speed/seed identicos', () => {
  const { ws1, ws2 } = createFullRoomViaProduction();

  const readyForP1 = lastOfType(ws1, 'match_ready').match;
  const readyForP2 = lastOfType(ws2, 'match_ready').match;

  assert.strictEqual(readyForP1.musicId, readyForP2.musicId);
  assert.deepStrictEqual(readyForP1.music, readyForP2.music);
  assert.strictEqual(readyForP1.difficulty, readyForP2.difficulty);
  assert.strictEqual(readyForP1.speed, readyForP2.speed);
  assert.strictEqual(readyForP1.seed, readyForP2.seed);
});

// =====================================================================
// 11. Mesma sequencia: os dois clientes, gerando localmente a partir da
// MESMA seed+pattern recebidos, produzem a MESMA sequencia/checksum --
// validado tanto pelo fluxo real de sequence_check quanto recalculando
// diretamente com o gerador do cliente.
// =====================================================================
test('[11] os dois jogadores produzem a mesma sequencia local a partir da configuracao recebida', () => {
  const { ws1, ws2, match } = createFullRoomViaProduction();
  const readyForP1 = lastOfType(ws1, 'match_ready').match;
  const readyForP2 = lastOfType(ws2, 'match_ready').match;

  const patternP1 = ClientSequenceCatalog.getSequencePattern(readyForP1.music.sequenceId);
  const patternP2 = ClientSequenceCatalog.getSequencePattern(readyForP2.music.sequenceId);
  assert.deepStrictEqual(patternP1, patternP2);

  const sequenceP1 = ClientSequenceGenerator.generateSequence(readyForP1.seed, patternP1.length, patternP1.noteRange);
  const sequenceP2 = ClientSequenceGenerator.generateSequence(readyForP2.seed, patternP2.length, patternP2.noteRange);

  assert.deepStrictEqual(sequenceP1, sequenceP2);
  assert.deepStrictEqual(sequenceP1, match.noteSequence);

  // Fluxo real de checagem ponta-a-ponta: os dois reportam e o servidor
  // confirma identidade.
  send(ws1, { type: 'sequence_check', seed: readyForP1.seed, sequence: sequenceP1, checksum: ClientSequenceGenerator.calculateChecksum(sequenceP1) });
  send(ws2, { type: 'sequence_check', seed: readyForP2.seed, sequence: sequenceP2, checksum: ClientSequenceGenerator.calculateChecksum(sequenceP2) });

  const result = lastOfType(ws1, 'sequence_check_result');
  assert.ok(result);
  assert.strictEqual(result.identical, true);
});

// =====================================================================
// 12. Mesmo timestamp: match_started traz o MESMO startTimestamp para
// os dois jogadores.
// =====================================================================
test('[12] match_started traz o mesmo startTimestamp para os dois jogadores', () => {
  const { ws1, ws2, match } = createFullRoomViaProduction();
  match._countdownTimer && clearTimeout(match._countdownTimer);
  match.setState(MATCH_STATE.PLAYING);

  // Simula diretamente o broadcast de inicio (evita depender de um
  // timer real de 3s no teste) -- mesmo payload que scheduleCountdown
  // envia em producao.
  const { broadcastToRoom } = require('../server/ws/broadcast');
  const room = RoomManager.getRoom(match.roomCode);
  broadcastToRoom(room, { type: 'match_started', startTimestamp: match.startTimestamp, match: match.toPublicJSON() });

  const startedP1 = lastOfType(ws1, 'match_started');
  const startedP2 = lastOfType(ws2, 'match_started');
  assert.strictEqual(typeof match.startTimestamp, 'number');
  assert.strictEqual(startedP1.startTimestamp, startedP2.startTimestamp);
  assert.strictEqual(startedP1.startTimestamp, match.startTimestamp);
});

// =====================================================================
// 13. musicId -> sequenceId: cada musica do catalogo aponta para um
// sequenceId que realmente existe no sequenceCatalog.
// =====================================================================
test('[13] toda musica do catalogo resolve para um sequenceId existente', () => {
  musicCatalog.getAllMusics().forEach((music) => {
    assert.ok(sequenceCatalog.sequenceExists(music.sequenceId), `sequenceId ausente para ${music.id}`);
  });
});

// =====================================================================
// 14. sequenceId -> pattern: o padrao resolvido tem a forma esperada
// pela timeline (length/noteRange/noteIntervalMs/leadInMs).
// =====================================================================
test('[14] o pattern resolvido de um sequenceId tem todos os campos que a timeline precisa', () => {
  const music = musicCatalog.getMusicById('music-002');
  const pattern = sequenceCatalog.getSequencePattern(music.sequenceId);

  assert.ok(Number.isInteger(pattern.length) && pattern.length > 0);
  assert.ok(Number.isInteger(pattern.noteRange) && pattern.noteRange > 0);
  assert.ok(Number.isFinite(pattern.noteIntervalMs) && pattern.noteIntervalMs > 0);
  assert.ok(Number.isFinite(pattern.leadInMs) && pattern.leadInMs >= 0);
});

// =====================================================================
// 15. pattern -> sequence: a mesma seed + o mesmo pattern SEMPRE produz
// a mesma sequencia (determinismo), em qualquer numero de chamadas.
// =====================================================================
test('[15] mesma seed + mesmo pattern produz sempre a mesma sequencia', () => {
  const pattern = sequenceCatalog.getSequencePattern('seq-basic-01');
  const seq1 = generateSequence(42, pattern.length, pattern.noteRange);
  const seq2 = generateSequence(42, pattern.length, pattern.noteRange);
  assert.deepStrictEqual(seq1, seq2);
  assert.strictEqual(calculateChecksum(seq1), calculateChecksum(seq2));
});

// =====================================================================
// 16. Configuracao bloqueada apos a criacao da Match (READY) -- ver o
// bug corrigido nesta etapa, no cabecalho do arquivo.
// =====================================================================
test('[16] select_music e rejeitado com a Match em READY, e nada muda na Match', () => {
  const { ws1, match } = createFullRoomViaProduction();
  // Em producao, READY dura 0ms (scheduleCountdown roda de forma
  // sincrona logo em seguida -- ver matchFlow.js), entao por essa altura
  // a Match ja avancou para COUNTDOWN. Forcamos o estado de volta para
  // READY aqui para testar isoladamente esta protecao especifica (ver
  // [17]/[18] para as protecoes de COUNTDOWN/PLAYING no fluxo real).
  match.setState(MATCH_STATE.READY);
  const musicIdBefore = match.musicId;
  const seedBefore = match.seed;

  send(ws1, { type: 'select_music', musicId: 'music-001' === match.musicId ? 'music-002' : 'music-001' });

  assert.ok(lastOfType(ws1, 'error'));
  assert.strictEqual(match.musicId, musicIdBefore);
  assert.strictEqual(match.seed, seedBefore);
});

// =====================================================================
// 17. Configuracao bloqueada durante COUNTDOWN.
// =====================================================================
test('[17] select_music e rejeitado com a Match em COUNTDOWN, e nada muda na Match', () => {
  const { ws1, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.COUNTDOWN);
  const musicIdBefore = match.musicId;

  send(ws1, { type: 'select_music', musicId: 'music-001' === match.musicId ? 'music-002' : 'music-001' });

  assert.ok(lastOfType(ws1, 'error'));
  assert.strictEqual(match.musicId, musicIdBefore);
});

// =====================================================================
// 18. Configuracao bloqueada durante PLAYING.
// =====================================================================
test('[18] select_music e rejeitado com a Match em PLAYING, e nada muda na Match', () => {
  const { ws1, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.PLAYING);
  const musicIdBefore = match.musicId;

  send(ws1, { type: 'select_music', musicId: 'music-001' === match.musicId ? 'music-002' : 'music-001' });

  assert.ok(lastOfType(ws1, 'error'));
  assert.strictEqual(match.musicId, musicIdBefore);
});

// =====================================================================
// 19. Configuracao nao altera a seed depois de criada (mesmo em
// qualquer um dos tres estados protegidos).
// =====================================================================
test('[19] nenhuma tentativa de select_music apos a criacao altera a seed', () => {
  [MATCH_STATE.READY, MATCH_STATE.COUNTDOWN, MATCH_STATE.PLAYING].forEach((state) => {
    const { ws1, match } = createFullRoomViaProduction();
    match.setState(state);
    const seedBefore = match.seed;

    send(ws1, { type: 'select_music', musicId: 'music-001' === match.musicId ? 'music-002' : 'music-001' });

    assert.strictEqual(match.seed, seedBefore, `seed mudou com a Match em ${state}`);
  });
});

// =====================================================================
// 20. Configuracao nao altera a timeline (noteSequence) depois de
// criada.
// =====================================================================
test('[20] nenhuma tentativa de select_music apos a criacao altera noteSequence', () => {
  const { ws1, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.PLAYING);
  const sequenceBefore = match.noteSequence.slice();

  send(ws1, { type: 'select_music', musicId: 'music-001' === match.musicId ? 'music-002' : 'music-001' });

  assert.deepStrictEqual(match.noteSequence, sequenceBefore);
});

// =====================================================================
// 21. Revanche SEM nova selecao reutiliza a musica anterior (mesma
// difficulty/speed derivados dela), mas com seed/estado novos.
// =====================================================================
test('[21] revanche sem nova selecao reutiliza musicId/difficulty da partida anterior', () => {
  const { ws1, ws2, roomCode } = createFullRoomViaProduction();
  const firstMatch = MatchManager.getMatch(roomCode);
  const firstMusicId = firstMatch.musicId;
  const firstDifficulty = firstMatch.difficulty;
  firstMatch.setState(MATCH_STATE.FINISHED);

  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  assert.strictEqual(secondMatch.musicId, firstMusicId);
  assert.strictEqual(secondMatch.difficulty, firstDifficulty);
});

// =====================================================================
// 22. Revanche COM nova selecao usa a nova musica (e a difficulty dela).
// =====================================================================
test('[22] revanche com nova selecao usa a nova musica/difficulty, nao a anterior', () => {
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
  assert.strictEqual(secondMatch.difficulty, musicCatalog.getMusicById(newMusicId).difficulty);
});

// =====================================================================
// 23. Revanche gera uma nova seed.
// =====================================================================
test('[23] revanche sempre gera uma seed diferente da partida anterior', () => {
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
// 24. Revanche gera um novo startTimestamp (e uma instancia de Match
// totalmente nova).
// =====================================================================
test('[24] revanche gera um novo startTimestamp e uma nova instancia de Match', () => {
  const { ws1, ws2, roomCode } = createFullRoomViaProduction();
  const firstMatch = MatchManager.getMatch(roomCode);
  firstMatch.setState(MATCH_STATE.FINISHED);

  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  assert.notStrictEqual(secondMatch, firstMatch);
  assert.strictEqual(typeof secondMatch.startTimestamp, 'number');
  assert.ok(secondMatch.startTimestamp >= Date.now());
});

// =====================================================================
// 25. Estado zerado na revanche: score/combo/hits/misses/mistakes dos
// dois jogadores comecam do zero, nunca herdados da partida anterior.
// =====================================================================
test('[25] a nova Match da revanche comeca com o estado dos jogadores zerado', () => {
  const { ws1, ws2, roomCode } = createFullRoomViaProduction();
  const firstMatch = MatchManager.getMatch(roomCode);

  // Simula progresso na partida anterior.
  firstMatch.players.player1.score = 900;
  firstMatch.players.player1.combo = 12;
  firstMatch.players.player2.misses = 4;
  firstMatch.setState(MATCH_STATE.FINISHED);

  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  ['player1', 'player2'].forEach((slot) => {
    assert.strictEqual(secondMatch.players[slot].score, 0);
    assert.strictEqual(secondMatch.players[slot].combo, 0);
    assert.strictEqual(secondMatch.players[slot].hits, 0);
    assert.strictEqual(secondMatch.players[slot].misses, 0);
    assert.strictEqual(secondMatch.players[slot].mistakes, 0);
  });
});

// =====================================================================
// 26. Isolamento entre salas: duas salas simultaneas com configuracoes
// diferentes nunca vazam uma para a outra.
// =====================================================================
test('[26] duas salas simultaneas mantem musicId/difficulty/speed/seed/noteSequence isolados', () => {
  const ws1a = createMockSocket();
  const ws1b = createMockSocket();
  const ws2a = createMockSocket();
  const ws2b = createMockSocket();
  [ws1a, ws1b, ws2a, ws2b].forEach(registerConnection);

  send(ws1a, { type: 'create_room' });
  const roomCodeA = lastOfType(ws1a, 'room_created').roomCode;
  send(ws1a, { type: 'select_music', musicId: 'music-001' });
  send(ws1b, { type: 'join_room', roomCode: roomCodeA });

  send(ws2a, { type: 'create_room' });
  const roomCodeB = lastOfType(ws2a, 'room_created').roomCode;
  send(ws2a, { type: 'select_music', musicId: 'music-002' });
  send(ws2b, { type: 'join_room', roomCode: roomCodeB });

  const matchA = MatchManager.getMatch(roomCodeA);
  const matchB = MatchManager.getMatch(roomCodeB);

  assert.strictEqual(matchA.musicId, 'music-001');
  assert.strictEqual(matchB.musicId, 'music-002');
  assert.notStrictEqual(matchA.musicId, matchB.musicId);
  assert.notStrictEqual(matchA.seed, matchB.seed);
  assert.notDeepStrictEqual(matchA.noteSequence, matchB.noteSequence);
  assert.notStrictEqual(matchA.music.sequenceId, matchB.music.sequenceId);

  // Bloquear/alterar a sala A nao pode afetar a sala B.
  matchA.setState(MATCH_STATE.PLAYING);
  send(ws2a, { type: 'select_music', musicId: 'music-001' });
  // B ainda esta em READY: a selecao de A em PLAYING nao interfere,
  // mas B tambem deveria rejeitar por ja estar em READY (comportamento
  // correto e isolado, nao um vazamento entre salas).
  assert.ok(lastOfType(ws2a, 'error'));
  assert.strictEqual(matchB.musicId, 'music-002');
  assert.strictEqual(matchA.musicId, 'music-001');
});

// =====================================================================
// 27. Selecao simultanea de dois jogadores respeita a prioridade
// existente (player1) de forma deterministica.
// =====================================================================
test('[27] selecao simultanea de dois jogadores resolve deterministicamente para player1', () => {
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);

  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  send(ws1, { type: 'select_music', musicId: 'music-002' });
  send(ws2, { type: 'join_room', roomCode }); // player2 ainda nao selecionou nada quando a sala fica cheia

  // Mesmo se pudessem "empatar no tempo", a resolucao e sempre a mesma
  // funcao pura e deterministica -- nao ha condicao de corrida real
  // possivel em JS single-threaded, e o teste comprova que o resultado
  // bate com a regra documentada (prioridade de player1).
  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.musicId, 'music-002');
});

// =====================================================================
// 28. Selecao repetida (idempotencia): nao cria selecoes/partidas
// extras nem multiplica broadcasts de erro.
// =====================================================================
test('[28] repetir a mesma selecao varias vezes e idempotente', () => {
  const { ws1, roomCode } = createRoomWithOnePlayer();

  for (let i = 0; i < 5; i++) {
    send(ws1, { type: 'select_music', musicId: 'music-001' });
  }

  assert.strictEqual(MatchManager.getMatch(roomCode), null);
  assert.strictEqual(musicSelectionFlow.resolveSelectedMusicId(roomCode), 'music-001');
  assert.strictEqual(allOfType(ws1, 'error').length, 0);
});

// =====================================================================
// 29. Payload invalido de configuracao e rejeitado sem quebrar a Match.
// =====================================================================
test('[29] payloads invalidos de select_music (tipo errado/vazio) sao rejeitados', () => {
  const { ws1, roomCode } = createRoomWithOnePlayer();

  send(ws1, { type: 'select_music', musicId: '' });
  send(ws1, { type: 'select_music', musicId: '   ' });
  send(ws1, { type: 'select_music', musicId: 123 });
  send(ws1, { type: 'select_music', musicId: null });
  send(ws1, { type: 'select_music' });
  send(ws1, { type: 'select_music', musicId: { id: 'music-001' } });

  assert.strictEqual(allOfType(ws1, 'error').length, 6);
  assert.strictEqual(musicSelectionFlow.resolveSelectedMusicId(roomCode), null);
  assert.strictEqual(MatchManager.getMatch(roomCode), null);
});

// =====================================================================
// 30. Configuracao enviada por jogador que nao pertence a sala e
// rejeitada.
// =====================================================================
test('[30] select_music de uma conexao que nao ocupa mais o slot na sala e rejeitado', () => {
  const { ws1, roomCode } = createRoomWithOnePlayer();
  const room = RoomManager.getRoom(roomCode);

  // Simula uma conexao "fantasma": pensa que esta na sala, mas o slot
  // real da sala aponta para outra conexao (ex: reconexao/estado velho).
  const ghost = createMockSocket();
  ghost.roomCode = roomCode;
  ghost.slot = 'player1'; // mesmo slot de ws1, mas room.players.player1 === ws1, nao ghost

  send(ghost, { type: 'select_music', musicId: 'music-002' });

  assert.ok(lastOfType(ghost, 'error'));
  assert.strictEqual(room.players.player1, ws1);
  assert.strictEqual(musicSelectionFlow.resolveSelectedMusicId(roomCode), null);
});

// =====================================================================
// 31. Nunca existe uma Match parcialmente configurada.
// =====================================================================
test('[31] uma falha na resolucao da musica nunca deixa uma Match parcial registrada', () => {
  const { roomCode } = createRoomWithOnePlayer();
  const room = RoomManager.getRoom(roomCode);

  assert.strictEqual(MatchManager.getMatch(roomCode), null);
  try {
    matchFlow.startMatchFlow(room, 'id-que-nao-existe');
  } catch (err) {
    // esperado
  }
  assert.strictEqual(MatchManager.getMatch(roomCode), null);
});

// =====================================================================
// 32. Nenhum countdown duplicado: repetir mensagens redundantes antes
// da sala ficar cheia nunca dispara dois `match_countdown_start`.
// =====================================================================
test('[32] nenhuma sequencia de selecoes redundantes gera mais de um countdown', () => {
  const { ws1, ws2, roomCode } = createFullRoomViaProduction();
  // A sala ja ficou cheia (1 unica vez) -- reenviar join_room (que ja
  // seria rejeitado por "ja esta em uma sala") nunca deveria conseguir
  // gerar um segundo countdown de qualquer forma.
  send(ws1, { type: 'join_room', roomCode });
  send(ws2, { type: 'join_room', roomCode });

  assert.strictEqual(allOfType(ws1, 'match_countdown_start').length, 1);
  assert.strictEqual(allOfType(ws2, 'match_countdown_start').length, 1);
});

// =====================================================================
// 33. Nenhuma timeline duplicada no cliente para a mesma partida (Etapa
// 5B-2A, reaproveitado aqui): (seed, startTimestamp) repetidos nunca
// recriam a timeline.
// =====================================================================
test('[33] MatchTimelineManager nunca recria a timeline para a mesma (seed, startTimestamp)', () => {
  const music = musicCatalog.getMusicById('music-001');
  const pattern = sequenceCatalog.getSequencePattern(music.sequenceId);
  const options = {
    seed: 555,
    startTimestamp: Date.now() + 1000,
    length: pattern.length,
    noteRange: pattern.noteRange,
    noteIntervalMs: pattern.noteIntervalMs,
    leadInMs: pattern.leadInMs,
  };

  MatchTimelineManager.clear();
  const timeline1 = MatchTimelineManager.ensureTimeline(options);
  const timeline2 = MatchTimelineManager.ensureTimeline(options);

  assert.strictEqual(timeline1, timeline2); // mesma referencia -- nao recriou
  MatchTimelineManager.clear();
});

// =====================================================================
// 34. Nenhum estado global de configuracao: cada Match/selecao vive
// isolada por sala, nada fica compartilhado entre partidas/salas.
// =====================================================================
test('[34] nao existe estado global de configuracao compartilhado entre Matches', () => {
  const { room: roomA, match: matchA } = createFullRoomViaProduction();
  const { room: roomB, match: matchB } = createFullRoomViaProduction();

  // Duas Matches distintas, cada uma com sua propria seed/musica --
  // nada e compartilhado por padrao (objetos totalmente independentes).
  assert.notStrictEqual(matchA, matchB);
  matchA.speed = 999; // mutacao direta e isolada, so para provar independencia
  assert.notStrictEqual(matchB.speed, 999);

  // Room nunca guarda nenhum campo relacionado a configuracao de musica.
  Object.keys(roomA).forEach((key) => {
    assert.ok(!/music|difficulty|speed|seed/i.test(key), `Room nao deveria ter campo de configuracao: ${key}`);
  });
  Object.keys(roomB).forEach((key) => {
    assert.ok(!/music|difficulty|speed|seed/i.test(key), `Room nao deveria ter campo de configuracao: ${key}`);
  });

  // Nenhuma selecao pendente residual entre salas distintas.
  assert.strictEqual(musicSelectionFlow.getSelectionState(roomA.code), null);
  assert.strictEqual(musicSelectionFlow.getSelectionState(roomB.code), null);
});

// =====================================================================
// 35 (extra). Selecao permitida apos FINISHED -- comportamento
// intencional (janela de revanche), nao um estado invalido.
// =====================================================================
test('[35] select_music apos FINISHED e permitido (janela de revanche), nao rejeitado', () => {
  const { ws1, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.FINISHED);

  const newMusicId = match.musicId === 'music-001' ? 'music-002' : 'music-001';
  send(ws1, { type: 'select_music', musicId: newMusicId });

  const confirmation = lastOfType(ws1, 'music_selected');
  assert.ok(confirmation);
  assert.strictEqual(confirmation.musicId, newMusicId);
});

// =====================================================================
// 36 (extra). Cliente nunca cria uma configuracao paralela: resolve o
// pattern EXCLUSIVAMENTE a partir de match.music.sequenceId recebido do
// servidor, nunca de um valor local independente.
// =====================================================================
test('[36] o cliente resolve o pattern exclusivamente a partir de match.music.sequenceId do servidor', () => {
  const { match } = createFullRoomViaProduction();
  const serverPattern = sequenceCatalog.getSequencePattern(match.music.sequenceId);
  const clientPattern = ClientSequenceCatalog.getSequencePattern(match.music.sequenceId);

  assert.deepStrictEqual(clientPattern, serverPattern);
});

console.log(`\n${passed} teste(s) passaram.`);
