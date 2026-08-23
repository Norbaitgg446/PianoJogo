/**
 * ETAPA 14D -- PARTE 2A: logica das dificuldades do Bot (EASY/MEDIUM/HARD).
 *
 * IMPORTANTE: esta etapa e SOMENTE logica interna -- nenhuma interface de
 * escolha, botao, tela de menu ou tela de resultado e criada/alterada
 * aqui (isso fica para a proxima parte). O que muda e SOMENTE
 * ClientConfig.BOT_DIFFICULTY_PRESETS (client/js/config.js), que deixou
 * de ter os tres presets identicos -- nenhum sistema novo foi criado:
 * a diferenca inteira vem dos MESMOS quatro campos que
 * BotController.createConfig/decideForNote ja aceitavam desde a
 * Etapa 14B (reactionTimeMs, judgementOffsetMs, mistakeChance, seed),
 * consumidos pelas MESMAS funcoes de sempre
 * (BotController.computeActionTime/rollMistake/decideForNote e
 * Judgement.classify).
 *
 * Este arquivo testa (ver enunciado da Parte 2A, secao 7):
 *   - EASY/MEDIUM/HARD possuem configuracao valida;
 *   - EASY != MEDIUM != HARD (nenhum par de presets e identico);
 *   - HARD reage mais rapido que MEDIUM, que reage mais rapido que EASY;
 *   - EASY erra mais que MEDIUM, que erra mais que HARD;
 *   - mesma dificuldade + mesma seed = comportamento deterministico;
 *   - as configuracoes nao alteram PlayerState nem a timeline;
 *   - o comportamento antigo (sem dificuldade informada) continua
 *     identico ao da Etapa 14B/14C.
 *
 * Mesmo estilo dos demais arquivos de teste do Bot (ver
 * tests/botDifficulty14D1.test.js): exercita os modulos REAIS, nunca
 * reimplementa nada.
 *
 * Executar com: node tests/botDifficulty14D2.test.js
 */
const assert = require('assert');

const ClientConfig = require('../client/js/config');
const BotController = require('../client/js/match/botController');
const BotMatchController = require('../client/js/match/botMatchController');
const Judgement = require('../client/js/match/judgement');
const PlayerState = require('../client/js/match/playerState');
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

const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];
const WINDOWS = ClientConfig.JUDGEMENT_WINDOWS
  ? {
      perfectMs: ClientConfig.JUDGEMENT_WINDOWS.PERFECT_MS,
      greatMs: ClientConfig.JUDGEMENT_WINDOWS.GREAT_MS,
      goodMs: ClientConfig.JUDGEMENT_WINDOWS.GOOD_MS,
    }
  : { perfectMs: 60, greatMs: 200, goodMs: 1800 };

function presetOf(key) {
  return ClientConfig.BOT_DIFFICULTY_PRESETS[key];
}

// Delta total (ms) que BotController.decideForNote calcula para uma nota
// com time=0 usando este preset: reactionTimeMs + judgementOffsetMs
// (mesma soma feita por BotController.computeActionTime).
function totalDeltaOf(key) {
  const preset = presetOf(key);
  return preset.reactionTimeMs + preset.judgementOffsetMs;
}

// =====================================================================
// 1. Cada dificuldade possui configuracao valida
// =====================================================================

DIFFICULTIES.forEach((key) => {
  test(`${key} possui uma configuracao valida em BOT_DIFFICULTY_PRESETS`, () => {
    const preset = presetOf(key);
    assert.ok(preset, `esperava ClientConfig.BOT_DIFFICULTY_PRESETS.${key} definido`);

    assert.strictEqual(typeof preset.reactionTimeMs, 'number');
    assert.ok(Number.isFinite(preset.reactionTimeMs), `${key}: reactionTimeMs precisa ser finito`);

    assert.strictEqual(typeof preset.judgementOffsetMs, 'number');
    assert.ok(Number.isFinite(preset.judgementOffsetMs), `${key}: judgementOffsetMs precisa ser finito`);

    assert.strictEqual(typeof preset.mistakeChance, 'number');
    assert.ok(
      preset.mistakeChance >= 0 && preset.mistakeChance <= 1,
      `${key}: mistakeChance precisa estar entre 0 e 1`
    );

    assert.strictEqual(typeof preset.seed, 'number');
    assert.ok(Number.isFinite(preset.seed), `${key}: seed precisa ser finito`);

    // A config resolvida por createConfigForDifficulty tem que servir
    // sem overrides para BotController.create/decideForNote (mesmo
    // formato de DEFAULT_CONFIG/createConfig, nenhum campo faltando).
    const resolved = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, key);
    assert.deepStrictEqual(Object.keys(resolved).sort(), Object.keys(BotController.DEFAULT_CONFIG).sort());
  });
});

// =====================================================================
// 2. EASY != MEDIUM != HARD
// =====================================================================

test('EASY e MEDIUM tem configuracoes diferentes', () => {
  assert.notDeepStrictEqual(presetOf('EASY'), presetOf('MEDIUM'));
});

test('MEDIUM e HARD tem configuracoes diferentes', () => {
  assert.notDeepStrictEqual(presetOf('MEDIUM'), presetOf('HARD'));
});

test('EASY e HARD tem configuracoes diferentes', () => {
  assert.notDeepStrictEqual(presetOf('EASY'), presetOf('HARD'));
});

// =====================================================================
// 3. Velocidade de reacao: HARD > MEDIUM > EASY
// =====================================================================
//
// "Mais rapido" = reage MAIS PERTO do tempo exato da nota, ou seja, um
// deltaMs total (reactionTimeMs + judgementOffsetMs, calculado pelas
// MESMAS BotController.computeActionTime/decideForNote de sempre) MENOR.

test('HARD e mais rapido (menor reactionTimeMs) que MEDIUM', () => {
  assert.ok(
    presetOf('HARD').reactionTimeMs < presetOf('MEDIUM').reactionTimeMs,
    'esperava HARD.reactionTimeMs < MEDIUM.reactionTimeMs'
  );
});

test('MEDIUM e mais rapido (menor reactionTimeMs) que EASY', () => {
  assert.ok(
    presetOf('MEDIUM').reactionTimeMs < presetOf('EASY').reactionTimeMs,
    'esperava MEDIUM.reactionTimeMs < EASY.reactionTimeMs'
  );
});

test('HARD produz um deltaMs total menor que MEDIUM (BotController.computeActionTime)', () => {
  const note = { time: 10_000 };
  const hardAction = BotController.computeActionTime(note, presetOf('HARD'));
  const mediumAction = BotController.computeActionTime(note, presetOf('MEDIUM'));

  assert.ok(
    Math.abs(hardAction - note.time) < Math.abs(mediumAction - note.time),
    'esperava |HARD.actionTime - note.time| < |MEDIUM.actionTime - note.time|'
  );
});

test('MEDIUM produz um deltaMs total menor que EASY (BotController.computeActionTime)', () => {
  const note = { time: 10_000 };
  const mediumAction = BotController.computeActionTime(note, presetOf('MEDIUM'));
  const easyAction = BotController.computeActionTime(note, presetOf('EASY'));

  assert.ok(
    Math.abs(mediumAction - note.time) < Math.abs(easyAction - note.time),
    'esperava |MEDIUM.actionTime - note.time| < |EASY.actionTime - note.time|'
  );
});

test('a diferenca de reacao se reflete no julgamento via Judgement.classify (mesma fonte do jogador humano)', () => {
  // Nenhuma logica de PERFECT/GREAT/GOOD e reimplementada aqui -- so se
  // confirma que Judgement.classify (chamado por decideForNote) devolve
  // um julgamento igual ou melhor para HARD do que para MEDIUM, e para
  // MEDIUM do que para EASY.
  const RANK = { PERFECT: 3, GREAT: 2, GOOD: 1 };

  const hardJudgement = Judgement.classify(totalDeltaOf('HARD'), WINDOWS);
  const mediumJudgement = Judgement.classify(totalDeltaOf('MEDIUM'), WINDOWS);
  const easyJudgement = Judgement.classify(totalDeltaOf('EASY'), WINDOWS);

  assert.ok(hardJudgement, 'HARD deveria cair dentro de alguma janela valida');
  assert.ok(mediumJudgement, 'MEDIUM deveria cair dentro de alguma janela valida');
  assert.ok(easyJudgement, 'EASY deveria cair dentro de alguma janela valida');

  assert.ok(
    RANK[hardJudgement] >= RANK[mediumJudgement],
    `esperava HARD (${hardJudgement}) >= MEDIUM (${mediumJudgement}) em qualidade de julgamento`
  );
  assert.ok(
    RANK[mediumJudgement] >= RANK[easyJudgement],
    `esperava MEDIUM (${mediumJudgement}) >= EASY (${easyJudgement}) em qualidade de julgamento`
  );
});

// =====================================================================
// 4. Chance de erro: EASY > MEDIUM > HARD
// =====================================================================

test('EASY possui maior chance de erro que MEDIUM', () => {
  assert.ok(
    presetOf('EASY').mistakeChance > presetOf('MEDIUM').mistakeChance,
    'esperava EASY.mistakeChance > MEDIUM.mistakeChance'
  );
});

test('MEDIUM possui maior chance de erro que HARD', () => {
  assert.ok(
    presetOf('MEDIUM').mistakeChance > presetOf('HARD').mistakeChance,
    'esperava MEDIUM.mistakeChance > HARD.mistakeChance'
  );
});

test('sobre muitas notas, EASY erra de proposito (rollMistake) mais vezes que MEDIUM, que erra mais que HARD', () => {
  // BotController.rollMistake nunca usa Math.random() -- e o MESMO
  // gerador deterministico (SequenceGenerator.createSeededRandom) usado
  // pela sequencia de notas do projeto. Aqui so se conta quantas notas
  // (de um lote grande, mesma seed para as tres dificuldades) cada
  // preset marca como MISTAKE.
  const NOTE_COUNT = 500;
  const notes = Array.from({ length: NOTE_COUNT }, (_, index) => ({ index }));

  function countMistakes(key) {
    const config = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, key);
    return notes.filter((note) => BotController.rollMistake(note, config)).length;
  }

  const easyMistakes = countMistakes('EASY');
  const mediumMistakes = countMistakes('MEDIUM');
  const hardMistakes = countMistakes('HARD');

  assert.ok(
    easyMistakes > mediumMistakes,
    `esperava EASY (${easyMistakes} mistakes) > MEDIUM (${mediumMistakes} mistakes)`
  );
  assert.ok(
    mediumMistakes > hardMistakes,
    `esperava MEDIUM (${mediumMistakes} mistakes) > HARD (${hardMistakes} mistakes)`
  );
});

// =====================================================================
// 5. Determinismo: mesma dificuldade + mesma seed + mesma timeline
// =====================================================================

test('mesma dificuldade + mesma seed + mesma timeline produz a MESMA decisao (decideTimeline)', () => {
  MatchTimelineManager.clear();
  const timeline = MatchTimelineManager.ensureTimeline({
    seed: 999,
    startTimestamp: 5_000_000,
    length: 12,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });

  DIFFICULTIES.forEach((key) => {
    const configA = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, key);
    const configB = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, key);

    const decisionsA = BotController.decideTimeline(timeline, { config: configA, windows: WINDOWS });
    const decisionsB = BotController.decideTimeline(timeline, { config: configB, windows: WINDOWS });

    assert.deepStrictEqual(decisionsA, decisionsB, `${key}: mesma seed deveria produzir a mesma decisao`);
  });

  MatchTimelineManager.clear();
});

test('a mesma dificuldade com seeds DIFERENTES pode produzir decisoes de MISTAKE diferentes', () => {
  MatchTimelineManager.clear();
  const timeline = MatchTimelineManager.ensureTimeline({
    seed: 321,
    startTimestamp: 6_000_000,
    length: 40,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });

  const configSeedA = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, 'EASY', {
    seed: 1,
  });
  const configSeedB = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, 'EASY', {
    seed: 2,
  });

  const decisionsA = BotController.decideTimeline(timeline, { config: configSeedA, windows: WINDOWS });
  const decisionsB = BotController.decideTimeline(timeline, { config: configSeedB, windows: WINDOWS });

  const mistakesA = decisionsA.map((d) => d.mistake);
  const mistakesB = decisionsB.map((d) => d.mistake);

  assert.notDeepStrictEqual(mistakesA, mistakesB, 'seeds diferentes deveriam poder produzir padroes de erro diferentes');

  MatchTimelineManager.clear();
});

// =====================================================================
// 6. Configuracoes de dificuldade nao alteram PlayerState nem a timeline
// =====================================================================

test('resolver uma config de dificuldade nao altera o formato de PlayerState.createPlayerState()', () => {
  const before = PlayerState.createPlayerState();

  DIFFICULTIES.forEach((key) => {
    const config = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, key);
    BotController.create({ config });
  });

  const after = PlayerState.createPlayerState();
  assert.deepStrictEqual(before, after);
});

test('criar um BotMatch com qualquer preset de dificuldade nao muta a timeline recebida', () => {
  MatchTimelineManager.clear();
  const timeline = MatchTimelineManager.ensureTimeline({
    seed: 55,
    startTimestamp: 7_000_000,
    length: 10,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });
  const before = timeline.map((note) => ({ ...note }));

  DIFFICULTIES.forEach((key) => {
    const config = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, key);
    BotMatchController.createBotMatch({ timeline, windows: WINDOWS, config });
  });

  assert.deepStrictEqual(
    timeline.map((note) => ({ ...note })),
    before
  );

  MatchTimelineManager.clear();
});

// =====================================================================
// 7. Sem dificuldade informada, comportamento antigo (14B/14C) continua
// =====================================================================

test('BotController.create() sem config continua usando DEFAULT_CONFIG (nenhuma dificuldade aplicada)', () => {
  const bot = BotController.create();
  assert.deepStrictEqual(bot.config, BotController.DEFAULT_CONFIG);
});

test('BotMatchController.createBotMatch() sem config continua identico a Etapa 14B/14C', () => {
  MatchTimelineManager.clear();
  const timeline = MatchTimelineManager.ensureTimeline({
    seed: 88,
    startTimestamp: 8_000_000,
    length: 6,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });

  const botMatch = BotMatchController.createBotMatch({ timeline, windows: WINDOWS });
  assert.deepStrictEqual(botMatch.config, BotController.DEFAULT_CONFIG);

  MatchTimelineManager.clear();
});

test('DEFAULT_CONFIG permanece congelado e com os mesmos valores da Etapa 14B (120/0/0/1)', () => {
  assert.ok(Object.isFrozen(BotController.DEFAULT_CONFIG));
  assert.strictEqual(BotController.DEFAULT_CONFIG.reactionTimeMs, 120);
  assert.strictEqual(BotController.DEFAULT_CONFIG.judgementOffsetMs, 0);
  assert.strictEqual(BotController.DEFAULT_CONFIG.mistakeChance, 0);
  assert.strictEqual(BotController.DEFAULT_CONFIG.seed, 1);
});

console.log(`\n${passed} teste(s) passaram.`);
