/**
 * ETAPA 13 -- Modo de Teste Local (file://).
 *
 * Testa client/js/network/localServerSimulator.js isoladamente: o
 * protocolo de mensagens que ele produz para o fluxo Solo (mesmos tipos
 * e campos que server/ws/messageRouter.js + server/match/matchFlow.js
 * produzem de verdade), e que ele NUNCA finge sucesso para operacoes de
 * multiplayer (que exigem um servidor real).
 *
 * Este arquivo NAO reimplementa nada do jogo: so verifica o "servidor
 * de mentira" em si, isolado de main.js/GameplayEngine/etc (esses
 * continuam cobertos pelos testes ja existentes, ex: noteEngine.test.js,
 * gameplayEngine.test.js, matchTimelineManager.test.js -- nenhum deles
 * muda nesta etapa).
 *
 * Executar com: node tests/localServerSimulator13.test.js
 */
const assert = require('assert');
const LocalServerSimulator = require('../client/js/network/localServerSimulator');

let passed = 0;
let failed = 0;
// `fn` pode ser sincrono ou async (varios testes abaixo precisam
// aguardar o setTimeout interno do LocalServerSimulator, mesmo com
// countdownMs: 0) -- por isso `test` sempre aguarda o retorno antes de
// contabilizar passou/falhou, e `run()` mais abaixo aguarda cada
// chamada de `test` em sequencia.
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`OK   - ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

/**
 * Cria uma conexao local com o countdown zerado (nao ha motivo para um
 * teste automatizado esperar 3 segundos de verdade) e coleta toda
 * mensagem recebida, em ordem, em `messages`.
 */
function createConnection(overrides = {}) {
  const messages = [];
  const statuses = [];
  const connection = LocalServerSimulator.createLocalConnection({
    onMessage: (message) => messages.push(message),
    onStatusChange: (status) => statuses.push(status),
    countdownMs: 0,
    ...overrides,
  });
  return { connection, messages, statuses };
}

function lastOfType(messages, type) {
  const matches = messages.filter((m) => m.type === type);
  return matches.length ? matches[matches.length - 1] : null;
}

function countOfType(messages, type) {
  return messages.filter((m) => m.type === type).length;
}

// Como o countdown roda via setTimeout (mesmo com 0ms), os testes que
// dependem de match_started/match_result precisam aguardar a fila de
// tarefas do Node esvaziar.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

async function run() {
  await test('connect() reporta "connected" imediatamente, sem nenhum socket', () => {
    const { connection, statuses } = createConnection();
    connection.connect();
    assert.deepStrictEqual(statuses, ['connected']);
  });

  await test('start_solo_match (primeira vez): room_created -> music_catalog -> match_ready', () => {
    const { connection, messages } = createConnection();
    connection.connect();
    connection.send('start_solo_match');

    assert.strictEqual(messages[0].type, 'room_created');
    assert.strictEqual(messages[0].slot, 'player1');
    assert.strictEqual(messages[1].type, 'music_catalog');
    assert.ok(Array.isArray(messages[1].musics) && messages[1].musics.length > 0);
    assert.strictEqual(messages[2].type, 'match_ready');
    assert.strictEqual(messages[2].match.mode, 'solo');
    assert.strictEqual(messages[2].match.state, 'READY');
    assert.strictEqual(typeof messages[2].match.seed, 'number');
  });

  await test('start_solo_match: match_countdown_start e match_started chegam com o mesmo startTimestamp', async () => {
    const { connection, messages } = createConnection();
    connection.connect();
    connection.send('start_solo_match');
    await flush();

    const countdown = lastOfType(messages, 'match_countdown_start');
    const started = lastOfType(messages, 'match_started');
    assert.ok(countdown, 'match_countdown_start deveria ter sido emitido');
    assert.ok(started, 'match_started deveria ter sido emitido');
    assert.strictEqual(countdown.match.state, 'COUNTDOWN');
    assert.strictEqual(started.match.state, 'PLAYING');
    assert.strictEqual(countdown.startTimestamp, started.startTimestamp);
    assert.strictEqual(typeof countdown.serverTime, 'number');
    assert.strictEqual(countdown.countdownSeconds, 3);
  });

  await test('start_solo_match: musicId sempre cai no padrao (mesma regra do servidor real)', async () => {
    const { connection, messages } = createConnection();
    connection.connect();
    connection.send('start_solo_match');
    await flush();

    const ready = lastOfType(messages, 'match_ready');
    assert.strictEqual(ready.match.musicId, LocalServerSimulator.DEFAULT_MUSIC_ID);
    assert.strictEqual(ready.match.music.sequenceId, 'seq-basic-01');
  });

  await test('start_solo_match repetido ("Jogar Novamente"): nao reenvia room_created/music_catalog', async () => {
    const { connection, messages } = createConnection();
    connection.connect();
    connection.send('start_solo_match');
    await flush();
    connection.send('start_solo_match');
    await flush();

    assert.strictEqual(countOfType(messages, 'room_created'), 1);
    assert.strictEqual(countOfType(messages, 'music_catalog'), 1);
    assert.strictEqual(countOfType(messages, 'match_ready'), 2);
  });

  await test('start_solo_match repetido gera uma seed NOVA a cada partida', async () => {
    const { connection, messages } = createConnection();
    connection.connect();
    connection.send('start_solo_match');
    await flush();
    const firstSeed = lastOfType(messages, 'match_ready').match.seed;

    connection.send('start_solo_match');
    await flush();
    const secondSeed = lastOfType(messages, 'match_ready').match.seed;

    assert.notStrictEqual(firstSeed, secondSeed);
  });

  await test('note_hit / note_miss: nunca geram nenhuma mensagem de resposta (fire-and-forget)', () => {
    const { connection, messages } = createConnection();
    connection.connect();
    connection.send('start_solo_match');
    const before = messages.length;

    connection.send('note_hit', { noteId: 'n1', lane: 1, judgement: 'PERFECT', combo: 1, score: 300 });
    connection.send('note_miss', { noteId: 'n2', lane: 2, combo: 0, misses: 1 });

    assert.strictEqual(messages.length, before);
  });

  await test('sequence_complete: responde com match_result (mode "solo")', () => {
    const { connection, messages } = createConnection();
    connection.connect();
    connection.send('start_solo_match');
    connection.send('sequence_complete');

    const result = lastOfType(messages, 'match_result');
    assert.ok(result);
    assert.strictEqual(result.mode, 'solo');
    assert.ok(result.player1, 'match_result Solo deve trazer estatisticas de player1');
  });

  await test('sequence_check: sempre "identico" (so ha um jogador local)', () => {
    const { connection, messages } = createConnection();
    connection.connect();
    connection.send('start_solo_match');
    connection.send('sequence_check', { seed: 123, checksum: 456, sequence: [1, 2, 3] });

    const result = lastOfType(messages, 'sequence_check_result');
    assert.ok(result);
    assert.strictEqual(result.identical, true);
    assert.strictEqual(result.player1Checksum, 456);
  });

  await test('create_room no modo local: NUNCA finge sucesso -- responde error claro', () => {
    const { connection, messages } = createConnection();
    connection.connect();
    connection.send('create_room');

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].type, 'error');
    assert.strictEqual(messages[0].message, LocalServerSimulator.MULTIPLAYER_UNAVAILABLE_MESSAGE);
  });

  await test('join_room no modo local: mesma mensagem de erro clara do create_room', () => {
    const { connection, messages } = createConnection();
    connection.connect();
    connection.send('join_room', { roomCode: 'ABC123' });

    assert.strictEqual(messages[0].type, 'error');
    assert.strictEqual(messages[0].message, LocalServerSimulator.MULTIPLAYER_UNAVAILABLE_MESSAGE);
  });

  await test('create_room/join_room no modo local: nenhuma "sala" e criada de verdade', () => {
    const { connection, messages } = createConnection();
    connection.connect();
    connection.send('create_room');
    connection.send('start_solo_match');

    // start_solo_match ainda deve se comportar como PRIMEIRA partida
    // (room_created/music_catalog), provando que create_room nao deixou
    // nenhum estado de sala para tras.
    assert.strictEqual(countOfType(messages, 'room_created'), 1);
  });

  await test('leave_room: confirma left_room e reresulta em nova room_created na proxima partida', async () => {
    const { connection, messages } = createConnection();
    connection.connect();
    connection.send('start_solo_match');
    await flush();

    connection.send('leave_room');
    assert.strictEqual(lastOfType(messages, 'left_room') !== null, true);

    connection.send('start_solo_match');
    assert.strictEqual(countOfType(messages, 'room_created'), 2);
  });

  await test('select_music: confirma a selecao (music_selected), sem quebrar nada', () => {
    const { connection, messages } = createConnection();
    connection.connect();
    connection.send('start_solo_match');
    connection.send('select_music', { musicId: 'music-002' });

    const confirmation = lastOfType(messages, 'music_selected');
    assert.ok(confirmation);
    assert.strictEqual(confirmation.slot, 'player1');
    assert.strictEqual(confirmation.musicId, 'music-002');
  });

  await test('select_music com musicId invalido: responde error, nao quebra', () => {
    const { connection, messages } = createConnection();
    connection.connect();
    connection.send('select_music', { musicId: 'nao-existe' });

    assert.strictEqual(lastOfType(messages, 'error').type, 'error');
  });

  await test('rematch_ready / test_message: recusados com mensagem clara (exigem oponente real)', () => {
    const { connection, messages } = createConnection();
    connection.connect();
    connection.send('rematch_ready');
    connection.send('test_message', { text: 'oi' });

    assert.strictEqual(countOfType(messages, 'error'), 2);
  });

  await test('tipo de mensagem desconhecido: nunca lanca excecao, responde error', () => {
    const { connection, messages } = createConnection();
    connection.connect();
    assert.doesNotThrow(() => connection.send('algo_que_nao_existe'));
    assert.strictEqual(lastOfType(messages, 'error').type, 'error');
  });

  await test('isLocalFileMode(): false quando "window" nao existe (ambiente Node/teste)', () => {
    assert.strictEqual(LocalServerSimulator.isLocalFileMode(), false);
  });

  await test('isLocalFileMode(): true somente quando window.location.protocol === "file:"', () => {
    global.window = { location: { protocol: 'file:' } };
    assert.strictEqual(LocalServerSimulator.isLocalFileMode(), true);

    global.window = { location: { protocol: 'https:' } };
    assert.strictEqual(LocalServerSimulator.isLocalFileMode(), false);

    global.window = { location: { protocol: 'http:' } };
    assert.strictEqual(LocalServerSimulator.isLocalFileMode(), false);

    delete global.window;
  });

  console.log(`\n${passed} teste(s) passaram, ${failed} falharam.`);
}

run();
