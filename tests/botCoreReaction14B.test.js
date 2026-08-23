/**
 * ETAPA 14B (parte 1) -- Nucleo de reacao/julgamento do Bot.
 *
 * Testa exclusivamente as novas funcoes de DECISAO adicionadas a
 * client/js/match/botController.js nesta etapa: computeActionTime,
 * rollMistake, decideForNote e decideTimeline. Nao reimplementa
 * julgamento (Judgement.classify, ja testado em gameplayEngine.test.js
 * e scoringSystem13C.test.js) nem geracao de timeline (NoteEngine, ja
 * testado em noteEngine.test.js/matchTimelineManager.test.js) -- so
 * confirma que o Bot usa essas fontes existentes corretamente, sem
 * duplicar valores nem criar um segundo sistema de notas.
 *
 * Confirma tambem que esta etapa NAO integra o Bot a uma partida real:
 * decideForNote/decideTimeline sao funcoes puras (nunca mutam a
 * timeline recebida), e nao tocam PlayerState, GameplayEngine nem
 * update()/estado do Bot (que continua no-op, ver
 * tests/botController14A.test.js, que nao muda nesta etapa).
 *
 * Executar com: node tests/botCoreReaction14B.test.js
 */
const assert = require('assert');
const BotController = require('../client/js/match/botController');
const NoteEngine = require('../client/js/match/noteEngine');
const Judgement = require('../client/js/match/judgement');
const ClientConfig = require('../client/js/config');

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

// Janelas de julgamento pequenas e faceis de raciocinar nos testes
// (mesmo formato de ClientConfig.JUDGEMENT_WINDOWS, so com numeros
// redondos: PERFECT ate 50ms, GREAT ate 150ms, GOOD ate 300ms).
const WINDOWS = { perfectMs: 50, greatMs: 150, goodMs: 300 };

function buildNote(overrides) {
  return {
    id: 'note-test-0',
    index: 0,
    lane: 1,
    time: 5000,
    state: NoteEngine.NOTE_STATE.PENDING,
    ...overrides,
  };
}

// Timeline real (via NoteEngine, a MESMA fonte que o resto do jogo usa)
// para os testes que precisam de varias notas.
function buildTimeline() {
  return NoteEngine.generateNoteTimeline({
    seed: 4242,
    startTimestamp: 1_000_000,
    length: 6,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 1000,
  });
}

// 1. Configuracao padrao / personalizada -------------------------------
test('DEFAULT_CONFIG segue o exemplo do enunciado (reactionTimeMs 120ms, sem offset, sem erro)', () => {
  assert.strictEqual(BotController.DEFAULT_CONFIG.reactionTimeMs, 120);
  assert.strictEqual(BotController.DEFAULT_CONFIG.judgementOffsetMs, 0);
  assert.strictEqual(BotController.DEFAULT_CONFIG.mistakeChance, 0);
});

test('createConfig() sem argumentos devolve os mesmos valores de DEFAULT_CONFIG', () => {
  const config = BotController.createConfig();
  assert.deepStrictEqual(config, BotController.DEFAULT_CONFIG);
});

test('createConfig(overrides) personaliza so os campos informados, mantendo o resto do padrao', () => {
  const config = BotController.createConfig({ reactionTimeMs: 200 });

  assert.strictEqual(config.reactionTimeMs, 200);
  assert.strictEqual(config.judgementOffsetMs, BotController.DEFAULT_CONFIG.judgementOffsetMs);
  assert.strictEqual(config.mistakeChance, BotController.DEFAULT_CONFIG.mistakeChance);
});

test('createConfig() nunca muta DEFAULT_CONFIG (que permanece congelado)', () => {
  BotController.createConfig({ reactionTimeMs: 999, mistakeChance: 1 });
  assert.strictEqual(BotController.DEFAULT_CONFIG.reactionTimeMs, 120);
  assert.strictEqual(BotController.DEFAULT_CONFIG.mistakeChance, 0);
  assert.ok(Object.isFrozen(BotController.DEFAULT_CONFIG));
});

// 2. Tempo de reacao ------------------------------------------------------
test('computeActionTime: nota em 5000ms + reactionTimeMs 120ms = acao em 5120ms (exemplo do enunciado)', () => {
  const note = buildNote({ time: 5000 });
  const config = BotController.createConfig({ reactionTimeMs: 120 });

  assert.strictEqual(BotController.computeActionTime(note, config), 5120);
});

test('reacao ANTES da nota: reactionTimeMs negativo produz actionTime menor que note.time', () => {
  const note = buildNote({ time: 5000 });
  const config = BotController.createConfig({ reactionTimeMs: -40 });

  assert.strictEqual(BotController.computeActionTime(note, config), 4960);
  assert.ok(BotController.computeActionTime(note, config) < note.time);
});

test('reacao exatamente no offset configurado: actionTime - note.time bate com reactionTimeMs + judgementOffsetMs', () => {
  const note = buildNote({ time: 5000 });
  const config = BotController.createConfig({ reactionTimeMs: 80, judgementOffsetMs: 15 });

  const actionTime = BotController.computeActionTime(note, config);
  assert.strictEqual(actionTime - note.time, 95);
});

test('reacao DEPOIS da nota: reactionTimeMs positivo produz actionTime maior que note.time', () => {
  const note = buildNote({ time: 5000 });
  const config = BotController.createConfig({ reactionTimeMs: 250 });

  assert.strictEqual(BotController.computeActionTime(note, config), 5250);
  assert.ok(BotController.computeActionTime(note, config) > note.time);
});

// 3. Calculo deterministico ------------------------------------------------
test('computeActionTime e deterministico: mesma nota + mesma config sempre devolvem o mesmo resultado', () => {
  const note = buildNote({ time: 12345 });
  const config = BotController.createConfig({ reactionTimeMs: 77, judgementOffsetMs: 3 });

  const first = BotController.computeActionTime(note, config);
  const second = BotController.computeActionTime(note, config);
  const third = BotController.computeActionTime({ ...note }, { ...config });

  assert.strictEqual(first, second);
  assert.strictEqual(first, third);
});

// 4. Julgamento: PERFECT / GREAT / GOOD / MISS -----------------------------
test('decideForNote: delta dentro de perfectMs resulta em PERFECT', () => {
  const note = buildNote({ time: 5000 });
  const config = BotController.createConfig({ reactionTimeMs: 30 }); // abs(30) <= 50
  const decision = BotController.decideForNote(note, { config, windows: WINDOWS });

  assert.strictEqual(decision.judgement, 'PERFECT');
  assert.strictEqual(decision.outcome, 'PERFECT');
  assert.strictEqual(decision.mistake, false);
});

test('decideForNote: delta entre perfectMs e greatMs resulta em GREAT', () => {
  const note = buildNote({ time: 5000 });
  const config = BotController.createConfig({ reactionTimeMs: 100 }); // 50 < 100 <= 150
  const decision = BotController.decideForNote(note, { config, windows: WINDOWS });

  assert.strictEqual(decision.judgement, 'GREAT');
  assert.strictEqual(decision.outcome, 'GREAT');
});

test('decideForNote: delta entre greatMs e goodMs resulta em GOOD', () => {
  const note = buildNote({ time: 5000 });
  const config = BotController.createConfig({ reactionTimeMs: 250 }); // 150 < 250 <= 300
  const decision = BotController.decideForNote(note, { config, windows: WINDOWS });

  assert.strictEqual(decision.judgement, 'GOOD');
  assert.strictEqual(decision.outcome, 'GOOD');
});

test('decideForNote: delta alem de goodMs (reacao tardia demais) resulta em MISS', () => {
  const note = buildNote({ time: 5000 });
  const config = BotController.createConfig({ reactionTimeMs: 500 }); // 500 > 300
  const decision = BotController.decideForNote(note, { config, windows: WINDOWS });

  assert.strictEqual(decision.judgement, 'MISS');
  assert.strictEqual(decision.outcome, 'MISS');
  assert.strictEqual(decision.judgement, Judgement.JUDGEMENT_RESULT.MISS, 'deve usar a MESMA constante de judgement.js');
});

test('decideForNote reaproveita Judgement.classify (mesmo resultado para o mesmo deltaMs)', () => {
  const note = buildNote({ time: 5000 });
  const config = BotController.createConfig({ reactionTimeMs: 90 });
  const decision = BotController.decideForNote(note, { config, windows: WINDOWS });

  const expected = Judgement.classify(90, WINDOWS);
  assert.strictEqual(decision.judgement, expected);
});

// 5. mistakeChance / aleatoriedade controlada -------------------------------
test('rollMistake: com mistakeChance 0 (padrao), nunca erra', () => {
  const note = buildNote({ index: 5 });
  const config = BotController.createConfig();

  for (let i = 0; i < 10; i++) {
    assert.strictEqual(BotController.rollMistake({ ...note, index: i }, config), false);
  }
});

test('rollMistake: com mistakeChance 1, sempre erra', () => {
  const config = BotController.createConfig({ mistakeChance: 1 });
  for (let i = 0; i < 10; i++) {
    assert.strictEqual(BotController.rollMistake(buildNote({ index: i }), config), true);
  }
});

test('rollMistake e deterministico: mesma nota + mesma config sempre devolvem o mesmo resultado', () => {
  const note = buildNote({ index: 3 });
  const config = BotController.createConfig({ mistakeChance: 0.5, seed: 777 });

  const first = BotController.rollMistake(note, config);
  const second = BotController.rollMistake({ ...note }, { ...config });
  const third = BotController.rollMistake(note, config);

  assert.strictEqual(first, second);
  assert.strictEqual(first, third);
});

test('rollMistake: seeds diferentes podem produzir decisoes diferentes para a mesma nota (nao e sempre a mesma resposta)', () => {
  const note = buildNote({ index: 3 });
  const resultsBySeed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((seed) =>
    BotController.rollMistake(note, BotController.createConfig({ mistakeChance: 0.5, seed }))
  );

  assert.ok(resultsBySeed.includes(true), 'esperava pelo menos um erro entre varias seeds diferentes');
  assert.ok(resultsBySeed.includes(false), 'esperava pelo menos um acerto entre varias seeds diferentes');
});

test('decideForNote: quando o Bot erra de proposito (mistakeChance 1), devolve mistake=true e outcome MISTAKE, sem judgement/actionTime', () => {
  const note = buildNote({ time: 5000 });
  const config = BotController.createConfig({ mistakeChance: 1 });
  const decision = BotController.decideForNote(note, { config, windows: WINDOWS });

  assert.strictEqual(decision.mistake, true);
  assert.strictEqual(decision.outcome, 'MISTAKE');
  assert.strictEqual(decision.judgement, null);
  assert.strictEqual(decision.actionTime, null);
  assert.strictEqual(decision.deltaMs, null);
});

// 6. decideForNote/decideTimeline nao alteram a timeline original -------
test('decideForNote nunca muta a nota recebida', () => {
  const note = buildNote({ time: 5000, state: NoteEngine.NOTE_STATE.PENDING });
  const before = { ...note };

  BotController.decideForNote(note, { config: BotController.createConfig(), windows: WINDOWS });

  assert.deepStrictEqual(note, before);
});

test('decideTimeline nao altera a timeline original (nenhuma nota, nenhum estado)', () => {
  const timeline = buildTimeline();
  const snapshotBefore = timeline.map((note) => ({ ...note }));

  BotController.decideTimeline(timeline, {
    config: BotController.createConfig({ reactionTimeMs: 50, mistakeChance: 0.3 }),
    windows: ClientConfig.JUDGEMENT_WINDOWS,
  });

  assert.deepStrictEqual(timeline, snapshotBefore);
  timeline.forEach((note) => assert.strictEqual(note.state, NoteEngine.NOTE_STATE.PENDING));
});

test('decideTimeline devolve uma lista NOVA (nao a mesma referencia da timeline recebida)', () => {
  const timeline = buildTimeline();
  const decisions = BotController.decideTimeline(timeline, {
    config: BotController.createConfig(),
    windows: WINDOWS,
  });

  assert.notStrictEqual(decisions, timeline);
  assert.strictEqual(decisions.length, timeline.length);
});

test('decideTimeline produz uma decisao por nota, na mesma ordem, referenciando o noteId/lane corretos', () => {
  const timeline = buildTimeline();
  const decisions = BotController.decideTimeline(timeline, {
    config: BotController.createConfig(),
    windows: ClientConfig.JUDGEMENT_WINDOWS,
  });

  decisions.forEach((decision, i) => {
    assert.strictEqual(decision.noteId, timeline[i].id);
    assert.strictEqual(decision.lane, timeline[i].lane);
    assert.strictEqual(decision.noteIndex, timeline[i].index);
  });
});

test('decideTimeline com timeline invalida devolve lista vazia, sem lancar erro', () => {
  assert.deepStrictEqual(BotController.decideTimeline(null, { windows: WINDOWS }), []);
  assert.deepStrictEqual(BotController.decideTimeline(undefined, { windows: WINDOWS }), []);
  assert.deepStrictEqual(BotController.decideTimeline([], { windows: WINDOWS }), []);
});

// 7. Determinismo fim-a-fim (mesma entrada produz o mesmo resultado) -------
test('decideTimeline e deterministico: mesma timeline + mesma config produzem exatamente as mesmas decisoes', () => {
  const config = BotController.createConfig({ reactionTimeMs: 65, judgementOffsetMs: -5, mistakeChance: 0.4, seed: 99 });

  const decisionsA = BotController.decideTimeline(buildTimeline(), { config, windows: ClientConfig.JUDGEMENT_WINDOWS });
  const decisionsB = BotController.decideTimeline(buildTimeline(), { config, windows: ClientConfig.JUDGEMENT_WINDOWS });

  assert.deepStrictEqual(decisionsA, decisionsB);
});

// 8. windows obrigatorio (reaproveitamento, nunca janela propria) ---------
test('decideForNote exige "windows" explicitamente -- nunca inventa uma janela propria', () => {
  const note = buildNote();
  assert.throws(() => BotController.decideForNote(note, { config: BotController.createConfig() }));
});

// 9. Erro nao "pula" a decisao seguinte (independencia entre notas) --------
test('decideTimeline: um mistake em uma nota nao afeta a decisao das notas seguintes', () => {
  const timeline = buildTimeline();
  const config = BotController.createConfig({ mistakeChance: 1 }); // todas erram
  const decisions = BotController.decideTimeline(timeline, { config, windows: ClientConfig.JUDGEMENT_WINDOWS });

  decisions.forEach((decision) => {
    assert.strictEqual(decision.mistake, true);
    assert.strictEqual(decision.outcome, 'MISTAKE');
  });
});

console.log(`\n${passed} teste(s) passaram.`);
