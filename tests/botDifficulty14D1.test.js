/**
 * ETAPA 14D -- PARTE 1: preparacao da arquitetura de dificuldade do Bot.
 *
 * IMPORTANTE: esta etapa e SOMENTE arquitetura -- nenhuma dificuldade
 * (FACIL/MEDIO/DIFICIL) tem comportamento diferente ainda. Os tres
 * presets em ClientConfig.BOT_DIFFICULTY_PRESETS sao propositalmente
 * IDENTICOS entre si e identicos a BotController.DEFAULT_CONFIG --
 * afinar cada dificuldade fica para a proxima etapa.
 *
 * Este arquivo testa:
 *   - os tres identificadores de dificuldade existem (ClientConfig.BOT_DIFFICULTY);
 *   - cada dificuldade possui uma configuracao valida (ClientConfig.BOT_DIFFICULTY_PRESETS);
 *   - a configuracao e independente entre instancias (nenhuma referencia
 *     compartilhada entre dificuldades, nem entre chamadas);
 *   - o Bot aceita receber uma configuracao (BotController.create/
 *     BotMatchController.createBotMatch, via BotController.createConfigForDifficulty);
 *   - a configuracao padrao (sem dificuldade informada) mantem
 *     EXATAMENTE o comportamento da Etapa 14B/14C;
 *   - nenhuma configuracao de dificuldade altera PlayerState;
 *   - nenhuma configuracao de dificuldade altera a timeline;
 *   - Solo, Multiplayer e Modo Teste continuam intactos.
 *
 * Mesmo estilo dos demais arquivos de teste do Bot (tests/botController14A.test.js,
 * tests/botCoreReaction14B.test.js, tests/botMatchController14B.test.js):
 * exercita os modulos REAIS, nunca reimplementa nada.
 *
 * Executar com: node tests/botDifficulty14D1.test.js
 */
const assert = require('assert');
const path = require('path');

const ClientConfig = require('../client/js/config');
const BotController = require('../client/js/match/botController');
const BotMatchController = require('../client/js/match/botMatchController');
const PlayerState = require('../client/js/match/playerState');
const NoteEngine = require('../client/js/match/noteEngine');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const MatchTimelineManager = require('../client/js/match/matchTimelineManager');
const LocalServerSimulator = require('../client/js/network/localServerSimulator');

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

const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];
const WINDOWS = { perfectMs: 60, greatMs: 200, goodMs: 1800 };

// =====================================================================
// 1. Identificadores de dificuldade
// =====================================================================

test('ClientConfig.BOT_DIFFICULTY existe e define EASY/MEDIUM/HARD', () => {
  assert.ok(ClientConfig.BOT_DIFFICULTY, 'esperava ClientConfig.BOT_DIFFICULTY definido');
  DIFFICULTIES.forEach((key) => {
    assert.strictEqual(
      ClientConfig.BOT_DIFFICULTY[key],
      key,
      `esperava ClientConfig.BOT_DIFFICULTY.${key} === '${key}'`
    );
  });
});

test('ClientConfig.BOT_DIFFICULTY nao define nenhum identificador alem dos tres esperados', () => {
  const keys = Object.keys(ClientConfig.BOT_DIFFICULTY).sort();
  assert.deepStrictEqual(keys, [...DIFFICULTIES].sort());
});

// =====================================================================
// 2. Cada dificuldade possui uma configuracao valida
// =====================================================================

test('ClientConfig.BOT_DIFFICULTY_PRESETS possui uma entrada para cada dificuldade', () => {
  DIFFICULTIES.forEach((key) => {
    assert.ok(
      ClientConfig.BOT_DIFFICULTY_PRESETS[key],
      `esperava ClientConfig.BOT_DIFFICULTY_PRESETS.${key} definido`
    );
  });
});

test('cada preset de dificuldade produz uma config valida via BotController', () => {
  DIFFICULTIES.forEach((key) => {
    const config = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, key);

    assert.strictEqual(typeof config.reactionTimeMs, 'number');
    assert.ok(Number.isFinite(config.reactionTimeMs), `${key}: reactionTimeMs precisa ser finito`);

    assert.strictEqual(typeof config.judgementOffsetMs, 'number');
    assert.ok(Number.isFinite(config.judgementOffsetMs), `${key}: judgementOffsetMs precisa ser finito`);

    assert.strictEqual(typeof config.mistakeChance, 'number');
    assert.ok(
      config.mistakeChance >= 0 && config.mistakeChance <= 1,
      `${key}: mistakeChance precisa estar entre 0 e 1`
    );

    assert.strictEqual(typeof config.seed, 'number');
    assert.ok(Number.isFinite(config.seed), `${key}: seed precisa ser finito`);
  });
});

// NOTA (Etapa 14D -- Parte 2A): na Parte 1 este teste verificava que os
// tres presets eram IDENTICOS a DEFAULT_CONFIG (nenhuma dificuldade
// tinha comportamento proprio ainda). A Parte 2A e exatamente a etapa
// que da valores diferentes a cada preset -- essa comparacao ficou
// obsoleta de proposito e foi substituida pelos testes de diferenca em
// tests/botDifficulty14D2.test.js (EASY != MEDIUM != HARD, etc). O que
// continua garantido aqui e que resolver uma config de dificuldade
// nunca muda o FORMATO esperado por createConfig/DEFAULT_CONFIG (ver
// teste de campos validos, secao 2 acima) e que sem dificuldade
// informada o comportamento padrao continua sendo DEFAULT_CONFIG (ver
// secao 5, mais abaixo).

// =====================================================================
// 3. Independencia entre instancias
// =====================================================================

test('BOT_DIFFICULTY_PRESETS guarda um objeto DIFERENTE para cada dificuldade (nenhuma referencia compartilhada)', () => {
  assert.notStrictEqual(
    ClientConfig.BOT_DIFFICULTY_PRESETS.EASY,
    ClientConfig.BOT_DIFFICULTY_PRESETS.MEDIUM
  );
  assert.notStrictEqual(
    ClientConfig.BOT_DIFFICULTY_PRESETS.MEDIUM,
    ClientConfig.BOT_DIFFICULTY_PRESETS.HARD
  );
  assert.notStrictEqual(
    ClientConfig.BOT_DIFFICULTY_PRESETS.EASY,
    ClientConfig.BOT_DIFFICULTY_PRESETS.HARD
  );
});

test('createConfigForDifficulty() nunca devolve a mesma referencia do preset nem do DEFAULT_CONFIG', () => {
  const configA = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, 'EASY');
  assert.notStrictEqual(configA, ClientConfig.BOT_DIFFICULTY_PRESETS.EASY);
  assert.notStrictEqual(configA, BotController.DEFAULT_CONFIG);
});

test('duas chamadas a createConfigForDifficulty() devolvem objetos independentes (mutar uma nao afeta a outra)', () => {
  const configA = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, 'HARD');
  const configB = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, 'HARD');

  assert.notStrictEqual(configA, configB);
  configA.reactionTimeMs = 99999;
  assert.notStrictEqual(configB.reactionTimeMs, 99999, 'mutar uma config nao pode afetar a outra');
});

test('mutar a config devolvida por createConfigForDifficulty() nao altera o preset original', () => {
  const before = { ...ClientConfig.BOT_DIFFICULTY_PRESETS.MEDIUM };
  const config = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, 'MEDIUM');

  config.mistakeChance = 1;

  assert.deepStrictEqual(ClientConfig.BOT_DIFFICULTY_PRESETS.MEDIUM, before);
});

test('dois Bots criados com dificuldades diferentes tem estado e config independentes', () => {
  const easyConfig = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, 'EASY');
  const hardConfig = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, 'HARD');

  const botEasy = BotController.create({ config: easyConfig });
  const botHard = BotController.create({ config: hardConfig });

  assert.notStrictEqual(botEasy, botHard);
  assert.notStrictEqual(botEasy.state, botHard.state);
  assert.notStrictEqual(botEasy.config, botHard.config);

  botEasy.state.score = 500;
  assert.strictEqual(botHard.state.score, 0, 'alterar um Bot nao pode afetar o outro');
});

// =====================================================================
// 4. O Bot aceita receber uma configuracao (BotController + BotMatchController)
// =====================================================================

test('BotController.create({ config }) guarda a config recebida, derivada de uma dificuldade', () => {
  const config = BotController.createConfigForDifficulty(
    ClientConfig.BOT_DIFFICULTY_PRESETS,
    ClientConfig.BOT_DIFFICULTY.EASY,
    { reactionTimeMs: 55 }
  );
  const bot = BotController.create({ config });

  assert.strictEqual(bot.config.reactionTimeMs, 55);
});

test('BotMatchController.createBotMatch({ config }) aceita uma config derivada de dificuldade sem criar um segundo sistema', () => {
  MatchTimelineManager.clear();
  const timeline = MatchTimelineManager.ensureTimeline({
    seed: 777,
    startTimestamp: 1_000_000,
    length: 6,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });

  const config = BotController.createConfigForDifficulty(
    ClientConfig.BOT_DIFFICULTY_PRESETS,
    ClientConfig.BOT_DIFFICULTY.HARD,
    { mistakeChance: 0 }
  );

  const botMatch = BotMatchController.createBotMatch({ timeline, windows: WINDOWS, config });

  assert.strictEqual(botMatch.config.reactionTimeMs, config.reactionTimeMs);
  assert.strictEqual(botMatch.config.mistakeChance, config.mistakeChance);
  assert.strictEqual(botMatch.entries.length, timeline.length);

  MatchTimelineManager.clear();
});

// =====================================================================
// 5. Configuracao padrao (sem dificuldade) mantem o comportamento atual
// =====================================================================

test('createConfigForDifficulty() sem presets/dificuldade cai no DEFAULT_CONFIG (mesmo de sempre)', () => {
  const config = BotController.createConfigForDifficulty(undefined, undefined);
  assert.deepStrictEqual(config, BotController.DEFAULT_CONFIG);
});

test('createConfigForDifficulty() com uma dificuldade desconhecida tambem cai no DEFAULT_CONFIG', () => {
  const config = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, 'LENDARIO');
  assert.deepStrictEqual(config, BotController.DEFAULT_CONFIG);
});

test('BotController.create() sem config (nenhuma dificuldade informada) continua usando DEFAULT_CONFIG', () => {
  const bot = BotController.create();
  assert.deepStrictEqual(bot.config, BotController.DEFAULT_CONFIG);
});

test('BotMatchController.createBotMatch() sem config (nenhuma dificuldade informada) continua identico a Etapa 14B/14C', () => {
  MatchTimelineManager.clear();
  const timeline = MatchTimelineManager.ensureTimeline({
    seed: 42,
    startTimestamp: 1_000_000,
    length: 8,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });

  const botMatch = BotMatchController.createBotMatch({ timeline, windows: WINDOWS });

  assert.deepStrictEqual(botMatch.config, BotController.DEFAULT_CONFIG);

  MatchTimelineManager.clear();
});

// =====================================================================
// 6. Nenhuma configuracao de dificuldade altera PlayerState
// =====================================================================

test('resolver/usar uma config de dificuldade nao altera o formato de PlayerState.createPlayerState()', () => {
  const freshBefore = PlayerState.createPlayerState();

  DIFFICULTIES.forEach((key) => {
    const config = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, key);
    BotController.create({ config });
  });

  const freshAfter = PlayerState.createPlayerState();
  assert.deepStrictEqual(freshBefore, freshAfter);
});

test('um Bot criado com config de dificuldade nunca compartilha estado com o PlayerState de um jogador real', () => {
  const playerState = PlayerState.createPlayerState();
  const config = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, 'EASY');
  const bot = BotController.create({ config });

  PlayerState.registerHit(playerState, 'PERFECT', { PERFECT: 300 });

  assert.strictEqual(playerState.score, 300);
  assert.strictEqual(bot.state.score, 0, 'PlayerState do jogador e o Bot nao podem compartilhar estado');
});

// =====================================================================
// 7. Nenhuma configuracao de dificuldade altera a timeline
// =====================================================================

test('criar um BotMatch com config de dificuldade nao muta a timeline recebida', () => {
  MatchTimelineManager.clear();
  const timeline = MatchTimelineManager.ensureTimeline({
    seed: 123,
    startTimestamp: 1_000_000,
    length: 8,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });
  const before = timeline.map((note) => ({ ...note }));

  const config = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, 'MEDIUM');
  BotMatchController.createBotMatch({ timeline, windows: WINDOWS, config });

  assert.deepStrictEqual(
    timeline.map((note) => ({ ...note })),
    before
  );

  MatchTimelineManager.clear();
});

test('BotController.decideTimeline() com config de dificuldade nunca muta as notas originais', () => {
  MatchTimelineManager.clear();
  const timeline = MatchTimelineManager.ensureTimeline({
    seed: 55,
    startTimestamp: 2_000_000,
    length: 6,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });
  const before = timeline.map((note) => ({ ...note }));

  const config = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, 'HARD');
  BotController.decideTimeline(timeline, { config, windows: WINDOWS });

  assert.deepStrictEqual(
    timeline.map((note) => ({ ...note })),
    before
  );

  MatchTimelineManager.clear();
});

// =====================================================================
// 8. Solo continua intacto
// =====================================================================

test('Solo (GameplayEngine + MatchTimelineManager) continua funcionando normalmente com a preparacao de dificuldade carregada', () => {
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

// =====================================================================
// 9. Modo Teste continua intacto
// =====================================================================

test('LocalServerSimulator (Modo Teste) mantem sua API intacta com a preparacao de dificuldade carregada', () => {
  assert.strictEqual(typeof LocalServerSimulator.createLocalConnection, 'function');
});

test('LocalServerSimulator ainda reproduz normalmente o fluxo Solo (room_created .. match_ready)', () => {
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

// =====================================================================
// 10. Multiplayer continua intacto
// =====================================================================

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

test('a preparacao de dificuldade do Bot nao toca em nenhum arquivo do servidor (server/)', () => {
  const fs = require('fs');
  const serverDir = path.join(__dirname, '../server');

  function walk(dir) {
    let matches = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        matches = matches.concat(walk(fullPath));
      } else if (entry.name.endsWith('.js')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('BOT_DIFFICULTY')) {
          matches.push(fullPath);
        }
      }
    }
    return matches;
  }

  const touched = walk(serverDir);
  assert.deepStrictEqual(touched, [], 'nenhum arquivo do servidor deveria conhecer BOT_DIFFICULTY nesta etapa');
});

console.log(`\n${passed} teste(s) passaram.`);
