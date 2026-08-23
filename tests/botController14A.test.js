/**
 * ETAPA 14A -- Estrutura do Modo Bot.
 *
 * Testa client/js/match/botController.js isoladamente: criacao, estado
 * inicial, reset, atualizacao basica (no-op nesta etapa) e preservacao
 * dos campos exigidos. Alem disso, confirma que carregar/usar o Bot NAO
 * tem nenhum efeito colateral sobre PlayerState, sobre o fluxo Solo
 * (GameplayEngine + MatchTimelineManager, o mesmo caminho real usado
 * por main.js#startMatchGameplay), sobre o Modo Teste
 * (LocalServerSimulator) nem sobre o Multiplayer (protocolo exposto por
 * LocalServerSimulator para create_room/join_room, que so um servidor
 * real deveria atender).
 *
 * Este arquivo NAO reimplementa nenhum sistema existente -- Solo, Modo
 * Teste e Multiplayer continuam cobertos pelos seus proprios testes
 * (soloMode12A.test.js, localServerSimulator13.test.js,
 * multiplayerEndToEnd10F.test.js, playerMatchState.test.js etc), que
 * nao mudam nesta etapa. Aqui so verificamos que a mera existencia do
 * BotController nao interfere neles.
 *
 * Executar com: node tests/botController14A.test.js
 */
const assert = require('assert');
const BotController = require('../client/js/match/botController');
const PlayerState = require('../client/js/match/playerState');
const NoteEngine = require('../client/js/match/noteEngine');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const MatchTimelineManager = require('../client/js/match/matchTimelineManager');
const LocalServerSimulator = require('../client/js/network/localServerSimulator');

const EXPECTED_FIELDS = [
  'active',
  'score',
  'combo',
  'maxCombo',
  'multiplier',
  'maxMultiplier',
  'perfectCount',
  'greatCount',
  'goodCount',
  'mistakes', // ERRO
  'misses', // MISS
];

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

// 1. Criacao ------------------------------------------------------------
test('BotController.create() devolve um Bot com objeto de estado', () => {
  const bot = BotController.create();
  assert.ok(bot);
  assert.ok(bot.state);
  assert.strictEqual(typeof bot.state, 'object');
});

test('BotController.create() sem argumentos comeca inativo (active: false)', () => {
  const bot = BotController.create();
  assert.strictEqual(bot.state.active, false);
});

test('BotController.create({ active: true }) respeita a opcao explicita', () => {
  const bot = BotController.create({ active: true });
  assert.strictEqual(bot.state.active, true);
});

// 2. Estado inicial -------------------------------------------------------
test('estado inicial contem exatamente os campos minimos exigidos', () => {
  const bot = BotController.create();
  EXPECTED_FIELDS.forEach((field) => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(bot.state, field),
      `campo ausente: ${field}`
    );
  });
});

test('estado inicial vem todo zerado (exceto multiplicadores, que comecam em 1x)', () => {
  const bot = BotController.create();
  const state = bot.state;

  assert.strictEqual(state.score, 0);
  assert.strictEqual(state.combo, 0);
  assert.strictEqual(state.maxCombo, 0);
  assert.strictEqual(state.perfectCount, 0);
  assert.strictEqual(state.greatCount, 0);
  assert.strictEqual(state.goodCount, 0);
  assert.strictEqual(state.mistakes, 0);
  assert.strictEqual(state.misses, 0);
  assert.strictEqual(state.multiplier, 1);
  assert.strictEqual(state.maxMultiplier, 1);
});

test('cada chamada a create() devolve uma instancia/estado independente', () => {
  const botA = BotController.create();
  const botB = BotController.create();

  assert.notStrictEqual(botA, botB);
  assert.notStrictEqual(botA.state, botB.state);

  botA.state.score = 999;
  assert.strictEqual(botB.state.score, 0, 'alterar um Bot nao pode afetar o outro');
});

// 3. Reset ------------------------------------------------------------------
test('BotController.reset() volta um Bot alterado ao estado inicial zerado', () => {
  const bot = BotController.create({ active: true });
  bot.state.score = 500;
  bot.state.combo = 7;
  bot.state.maxCombo = 7;
  bot.state.multiplier = 2;
  bot.state.maxMultiplier = 2;
  bot.state.perfectCount = 3;
  bot.state.greatCount = 2;
  bot.state.goodCount = 1;
  bot.state.mistakes = 1;
  bot.state.misses = 1;

  BotController.reset(bot);

  assert.strictEqual(bot.state.active, false);
  assert.strictEqual(bot.state.score, 0);
  assert.strictEqual(bot.state.combo, 0);
  assert.strictEqual(bot.state.maxCombo, 0);
  assert.strictEqual(bot.state.multiplier, 1);
  assert.strictEqual(bot.state.maxMultiplier, 1);
  assert.strictEqual(bot.state.perfectCount, 0);
  assert.strictEqual(bot.state.greatCount, 0);
  assert.strictEqual(bot.state.goodCount, 0);
  assert.strictEqual(bot.state.mistakes, 0);
  assert.strictEqual(bot.state.misses, 0);
});

test('BotController.reset(bot, { active: true }) permite recomecar ja ativo', () => {
  const bot = BotController.create();
  bot.state.score = 42;

  BotController.reset(bot, { active: true });

  assert.strictEqual(bot.state.active, true);
  assert.strictEqual(bot.state.score, 0);
});

test('reset() devolve a MESMA referencia de bot recebida (nao cria um novo objeto Bot)', () => {
  const bot = BotController.create();
  const result = BotController.reset(bot);
  assert.strictEqual(result, bot);
});

// 4. Atualizacao basica -------------------------------------------------
test('BotController.update() nao lanca erro e devolve o mesmo bot', () => {
  const bot = BotController.create();
  const result = BotController.update(bot, 12345);
  assert.strictEqual(result, bot);
});

test('BotController.update() nesta etapa nao altera nenhum campo do estado (ainda sem IA)', () => {
  const bot = BotController.create();
  const before = { ...bot.state };

  BotController.update(bot, 0);
  BotController.update(bot, 999999);

  assert.deepStrictEqual(bot.state, before);
});

test('BotController.update()/reset() com bot invalido nao lancam erro', () => {
  assert.doesNotThrow(() => BotController.update(null));
  assert.doesNotThrow(() => BotController.update(undefined));
  assert.doesNotThrow(() => BotController.reset(null));
});

// 5. getState() / preservacao dos campos --------------------------------
test('BotController.getState() devolve todos os campos minimos exigidos', () => {
  const bot = BotController.create();
  const state = BotController.getState(bot);

  EXPECTED_FIELDS.forEach((field) => {
    assert.ok(Object.prototype.hasOwnProperty.call(state, field), `campo ausente: ${field}`);
  });
});

test('BotController.getState() devolve um retrato (copia), nao a referencia interna', () => {
  const bot = BotController.create();
  const snapshot = BotController.getState(bot);

  snapshot.score = 12345;

  assert.strictEqual(bot.state.score, 0, 'alterar o snapshot nao pode alterar o estado real do Bot');
});

test('BotController.getState() com bot invalido devolve null', () => {
  assert.strictEqual(BotController.getState(null), null);
  assert.strictEqual(BotController.getState(undefined), null);
});

// 6. Nenhum impacto no PlayerState existente -----------------------------
test('usar o BotController nao altera o formato/comportamento de PlayerState.createPlayerState()', () => {
  const freshBefore = PlayerState.createPlayerState();

  BotController.create({ active: true });
  BotController.reset(BotController.create());

  const freshAfter = PlayerState.createPlayerState();

  assert.deepStrictEqual(freshBefore, freshAfter);
  assert.deepStrictEqual(freshAfter, {
    score: 0,
    combo: 0,
    maxCombo: 0,
    hits: 0,
    misses: 0,
    mistakes: 0,
    perfectCount: 0,
    greatCount: 0,
    goodCount: 0,
    maxMultiplier: 1,
  });
});

test('registrar um hit no PlayerState de um jogador real nao afeta o estado de um Bot', () => {
  const playerState = PlayerState.createPlayerState();
  const bot = BotController.create();

  PlayerState.registerHit(playerState, 'PERFECT', { PERFECT: 300 });

  assert.strictEqual(playerState.score, 300);
  assert.strictEqual(bot.state.score, 0, 'PlayerState e Bot nao podem compartilhar estado');
});

// 7. Nenhum impacto no fluxo de Solo (GameplayEngine + MatchTimelineManager) --
test('o fluxo de gameplay local (Solo/Modo Teste) continua funcionando normalmente com o BotController carregado', () => {
  MatchTimelineManager.clear();

  const timeline = MatchTimelineManager.ensureTimeline({
    seed: 4242,
    startTimestamp: 1_000_000,
    length: 8,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 1000,
  });

  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: { perfectMs: 60, goodMs: 150 },
    scoreValues: { PERFECT: 300, GOOD: 100, MISS: 0 },
  });

  const note = timeline[0];
  const result = engine.handleKeyPress(note.lane, note.time);

  assert.strictEqual(result.outcome, 'PERFECT');
  assert.strictEqual(playerState.hits, 1);
  assert.strictEqual(playerState.score, 300);

  MatchTimelineManager.clear();
});

// 8. Nenhum impacto no Modo Teste (LocalServerSimulator) -------------------
test('LocalServerSimulator (Modo Teste) mantem sua API intacta com o BotController carregado', () => {
  assert.strictEqual(typeof LocalServerSimulator.createLocalConnection, 'function');
});

test('LocalServerSimulator ainda reproduz normalmente o fluxo Solo (room_created .. match_started)', () => {
  const messages = [];
  const connection = LocalServerSimulator.createLocalConnection({
    onMessage: (message) => messages.push(message),
    onStatusChange: () => {},
    countdownMs: 0,
  });

  connection.send('start_solo_match');

  const types = messages.map((m) => m.type);
  assert.ok(types.includes('room_created'));
  assert.ok(types.includes('match_ready'));
});

// 9. Nenhum impacto no Multiplayer -----------------------------------------
test('LocalServerSimulator continua recusando create_room/join_room (multiplayer exige servidor real)', () => {
  const messages = [];
  const connection = LocalServerSimulator.createLocalConnection({
    onMessage: (message) => messages.push(message),
    onStatusChange: () => {},
    countdownMs: 0,
  });

  connection.send('create_room');

  const errorMessage = messages.find((m) => m.type === 'error');
  assert.ok(errorMessage, 'multiplayer local deveria responder com error, nunca fingir sucesso');
});

console.log(`\n${passed} teste(s) passaram.`);
