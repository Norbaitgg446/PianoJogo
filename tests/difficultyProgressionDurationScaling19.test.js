/**
 * ETAPA 19 — Escalar a curva de dificuldade (ClientConfig.
 * DIFFICULTY_PROGRESSION.STAGES) pela duracao REAL da partida.
 *
 * CONTEXTO DO BUG: a curva original foi desenhada quando as partidas
 * nao tinham duracao selecionavel e sempre terminavam junto com o
 * padrao-base mais curto do catalogo (16 notas, ~10-15s -- ver
 * sequenceCatalog.js). Depois que a Etapa 15/16 trouxe a selecao de
 * duracao (30s/1m/5m/10m, com a timeline se repetindo ciclicamente
 * para cobrir a duracao -- ver generateExtendedTimeline), a curva
 * continuou fixa: o teto de velocidade (MAX_SPEED_MULTIPLIER) sempre
 * era atingido dentro das primeiras ~16 notas e ficava PARADO nesse
 * teto pelo resto da partida, nao importa se ela durava 30 segundos ou
 * 10 minutos -- fazendo a maior parte de uma partida longa parecer
 * "sempre devagar" (nunca mais acelerando de fato) e uma partida curta
 * de 30s continuar identica a uma partida sem duracao nenhuma.
 *
 * Esta suite cobre:
 *   (a) `NoteEngine.buildScaledDifficultyStages` isoladamente (funcao
 *       pura: mesma entrada -> mesma saida, nunca muta os stages
 *       recebidos, fallback seguro em entrada invalida);
 *   (b) o fluxo completo (estimar notas para a duracao ->  escalar a
 *       curva -> gerar a timeline estendida) confirmando que o TETO de
 *       velocidade so e atingido perto do FIM da partida, para
 *       diferentes duracoes -- nunca sempre nas primeiras ~16 notas.
 *
 * Executar com: node tests/difficultyProgressionDurationScaling19.test.js
 */
const assert = require('assert');
const NoteEngine = require('../client/js/match/noteEngine');
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

const BASE_STAGES = ClientConfig.DIFFICULTY_PROGRESSION.STAGES;

// =====================================================================
// (a) NoteEngine.buildScaledDifficultyStages isolada
// =====================================================================

test('buildScaledDifficultyStages e uma funcao pura: nunca muta o array/objetos recebidos', () => {
  const before = JSON.parse(JSON.stringify(BASE_STAGES));
  NoteEngine.buildScaledDifficultyStages(BASE_STAGES, 998);
  assert.deepStrictEqual(BASE_STAGES, before, 'baseStages nao deveria ser alterado');
});

test('buildScaledDifficultyStages com totalNotes == referencia devolve a MESMA curva (fator 1)', () => {
  const referenceNotes = BASE_STAGES[BASE_STAGES.length - 1].notesPlayed; // 16
  const scaled = NoteEngine.buildScaledDifficultyStages(BASE_STAGES, referenceNotes);
  assert.deepStrictEqual(scaled, BASE_STAGES);
});

test('buildScaledDifficultyStages preserva os MESMOS speedMultiplier (nenhuma curva/teto novo)', () => {
  const scaled = NoteEngine.buildScaledDifficultyStages(BASE_STAGES, 998);
  assert.deepStrictEqual(
    scaled.map((s) => s.speedMultiplier),
    BASE_STAGES.map((s) => s.speedMultiplier)
  );
});

test('buildScaledDifficultyStages estica os limiares proporcionalmente para uma partida mais longa', () => {
  const scaled = NoteEngine.buildScaledDifficultyStages(BASE_STAGES, 160); // 10x a referencia (16)
  assert.deepStrictEqual(
    scaled.map((s) => s.notesPlayed),
    [0, 40, 80, 120, 160]
  );
});

test('buildScaledDifficultyStages sempre mantem o primeiro estagio em notesPlayed:0', () => {
  const scaled = NoteEngine.buildScaledDifficultyStages(BASE_STAGES, 48);
  assert.strictEqual(scaled[0].notesPlayed, 0);
});

test('buildScaledDifficultyStages com totalNotes invalido/ausente devolve baseStages sem alteracao', () => {
  assert.strictEqual(NoteEngine.buildScaledDifficultyStages(BASE_STAGES, null), BASE_STAGES);
  assert.strictEqual(NoteEngine.buildScaledDifficultyStages(BASE_STAGES, 0), BASE_STAGES);
  assert.strictEqual(NoteEngine.buildScaledDifficultyStages(BASE_STAGES, -5), BASE_STAGES);
  assert.strictEqual(NoteEngine.buildScaledDifficultyStages(BASE_STAGES, NaN), BASE_STAGES);
});

test('buildScaledDifficultyStages com baseStages invalido/vazio devolve o proprio valor recebido', () => {
  assert.strictEqual(NoteEngine.buildScaledDifficultyStages([], 100).length, 0);
  assert.strictEqual(NoteEngine.buildScaledDifficultyStages(null, 100), null);
});

// =====================================================================
// (b) Fluxo completo: estimar notas -> escalar curva -> gerar timeline
// =====================================================================

/**
 * Reproduz exatamente o que main.js faz a partir da Etapa 19: estima o
 * total de notas necessario para cobrir `durationMs` (SEM estagios,
 * mesma logica de main.js) e escala a curva com esse total.
 */
function scaledStagesForDuration({ length, noteIntervalMs, leadInMs, durationMs }) {
  const estimatedTotalNotes = NoteEngine.computeNoteCountForDuration({
    length,
    noteIntervalMs,
    leadInMs,
    durationMs,
  });
  return NoteEngine.buildScaledDifficultyStages(BASE_STAGES, estimatedTotalNotes);
}

const PATTERN = { length: 16, noteRange: 3, noteIntervalMs: 600, leadInMs: 1000 };
const SEED = 42;
const START = 1_700_000_000_000;

[
  ['30S', ClientConfig.MATCH_DURATION_MS['30S']],
  ['1M', ClientConfig.MATCH_DURATION_MS['1M']],
  ['5M', ClientConfig.MATCH_DURATION_MS['5M']],
  ['10M', ClientConfig.MATCH_DURATION_MS['10M']],
].forEach(([label, durationMs]) => {
  test(`duracao ${label}: o teto de velocidade so e atingido perto do FIM da partida (nunca nas primeiras ~16 notas)`, () => {
    const difficultyStages = scaledStagesForDuration({ ...PATTERN, durationMs });

    const timeline = NoteEngine.generateExtendedTimeline({
      seed: SEED,
      startTimestamp: START,
      ...PATTERN,
      durationMs,
      difficultyStages,
    });

    // Indice (0-based) da PRIMEIRA nota que ja esta no multiplicador maximo.
    const maxMultiplier = ClientConfig.DIFFICULTY_PROGRESSION.MAX_SPEED_MULTIPLIER;
    const firstMaxIndex = difficultyStages.find((s) => s.speedMultiplier === maxMultiplier).notesPlayed;

    // Para qualquer duracao >= 30s (bem maior que os ~16-24 notas do
    // padrao-base), o teto so deveria chegar depois de uma boa fatia da
    // partida -- nunca ainda dentro do padrao-base original (16 notas).
    assert.ok(
      firstMaxIndex > 16,
      `o teto de velocidade (${label}) deveria ser atingido depois da nota 16, mas foi na nota ${firstMaxIndex}`
    );

    // E deveria ficar proximo do FIM da timeline gerada (ultimos 30%),
    // nunca logo no comeco -- e isso que "a velocidade continua
    // aumentando ao longo de toda a partida" significa na pratica.
    assert.ok(
      firstMaxIndex >= timeline.length * 0.6,
      `o teto de velocidade (${label}) deveria ficar perto do fim da timeline (${timeline.length} notas), mas foi na nota ${firstMaxIndex}`
    );
  });
});

test('sem duracao configurada (Modo Teste/Multiplayer/Solo/Bot sem selecao): curva permanece EXATAMENTE a original', () => {
  // Mesmo caminho que main.js usa quando resolvedMatchDurationMs e null:
  // ClientConfig.DIFFICULTY_PROGRESSION.STAGES e usado sem escalar.
  const timeline = NoteEngine.generateNoteTimeline({
    seed: SEED,
    startTimestamp: START,
    ...PATTERN,
    difficultyStages: BASE_STAGES,
  });
  assert.strictEqual(timeline.length, PATTERN.length);
});

console.log(`\n${passed} teste(s) passaram.`);
