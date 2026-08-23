/**
 * Testes automatizados da dificuldade progressiva (Etapa 13E).
 *
 * Cobre exclusivamente o que esta etapa mudou: o INTERVALO entre notas
 * consecutivas (NoteEngine.generateNoteTimeline / resolveSpeedMultiplier)
 * passando a diminuir progressivamente conforme o INDICE da nota avanca
 * (nunca um timer independente). Nao testa de novo julgamento, combo,
 * pontuacao, sons ou feedback visual -- todos ja cobertos pelas suites
 * anteriores (ver scoringSystem13C.test.js, newArrowMechanic13B.test.js,
 * soundEffectsController.test.js etc.), que continuam passando sem
 * nenhuma alteracao (prova de compatibilidade retroativa: nenhum destes
 * testes anteriores passa `difficultyStages`, entao todos continuam
 * exercitando exatamente a formula antiga).
 *
 * Executar com: node tests/difficultyProgression13E.test.js
 */
const assert = require('assert');
const NoteEngine = require('../client/js/match/noteEngine');
const MatchTimelineManager = require('../client/js/match/matchTimelineManager');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const PlayerState = require('../client/js/match/playerState');
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

const BASE_PARAMS = {
  seed: 123456789,
  startTimestamp: 1_700_000_000_000,
  length: 20,
  noteRange: 3,
  noteIntervalMs: 600,
  leadInMs: 1000,
};

// A progressao "de verdade" usada pelo jogo (a mesma que main.js passa
// para TODOS os modos -- Multiplayer/Solo/Teste -- ver ClientConfig).
const REAL_STAGES = ClientConfig.DIFFICULTY_PROGRESSION.STAGES;
const MAX_MULTIPLIER = ClientConfig.DIFFICULTY_PROGRESSION.MAX_SPEED_MULTIPLIER;

function gapsOf(timeline) {
  const gaps = [];
  for (let i = 1; i < timeline.length; i++) {
    gaps.push(timeline[i].time - timeline[i - 1].time);
  }
  return gaps;
}

// ---------------------------------------------------------------------
// 1) Configuracao centralizada -- nada espalhado pelo codigo.
// ---------------------------------------------------------------------

test('a progressao vive centralizada em ClientConfig.DIFFICULTY_PROGRESSION', () => {
  assert.ok(Array.isArray(REAL_STAGES) && REAL_STAGES.length > 1);
  assert.ok(Number.isFinite(MAX_MULTIPLIER) && MAX_MULTIPLIER > 1);
  // STAGES ordenado por notesPlayed crescente (pre-condicao documentada).
  for (let i = 1; i < REAL_STAGES.length; i++) {
    assert.ok(REAL_STAGES[i].notesPlayed > REAL_STAGES[i - 1].notesPlayed);
  }
  // Nenhum estagio ultrapassa o teto declarado.
  REAL_STAGES.forEach((stage) => assert.ok(stage.speedMultiplier <= MAX_MULTIPLIER));
});

// ---------------------------------------------------------------------
// 2) resolveSpeedMultiplier -- funcao pura, sem AudioContext/DOM/rede.
// ---------------------------------------------------------------------

test('resolveSpeedMultiplier sem estagios (ou vazio) e sempre 1 -- compatibilidade total', () => {
  assert.strictEqual(NoteEngine.resolveSpeedMultiplier(0, undefined), 1);
  assert.strictEqual(NoteEngine.resolveSpeedMultiplier(999, undefined), 1);
  assert.strictEqual(NoteEngine.resolveSpeedMultiplier(50, []), 1);
});

test('dificuldade inicial: nas primeiras notas, o multiplicador e o do primeiro estagio (1x)', () => {
  assert.strictEqual(NoteEngine.resolveSpeedMultiplier(0, REAL_STAGES), 1);
  assert.strictEqual(NoteEngine.resolveSpeedMultiplier(1, REAL_STAGES), 1);
  assert.strictEqual(NoteEngine.resolveSpeedMultiplier(3, REAL_STAGES), 1);
});

test('aumento apos o primeiro estagio: no limiar exato do 2o estagio, o multiplicador sobe', () => {
  const secondStage = REAL_STAGES[1];
  const before = NoteEngine.resolveSpeedMultiplier(secondStage.notesPlayed - 1, REAL_STAGES);
  const at = NoteEngine.resolveSpeedMultiplier(secondStage.notesPlayed, REAL_STAGES);

  assert.strictEqual(before, REAL_STAGES[0].speedMultiplier);
  assert.strictEqual(at, secondStage.speedMultiplier);
  assert.ok(at > before, 'o multiplicador deveria subir assim que o estagio e alcancado');
});

test('aumento gradual: cada estagio sobe so um pouco em relacao ao anterior (nunca um salto absurdo)', () => {
  for (let i = 1; i < REAL_STAGES.length; i++) {
    const jump = REAL_STAGES[i].speedMultiplier - REAL_STAGES[i - 1].speedMultiplier;
    assert.ok(jump > 0, 'cada estagio deveria ser estritamente mais rapido que o anterior');
    // "gradual": nenhum unico salto responde sozinho por mais da metade
    // do aumento total ate o teto -- evita uma unica etapa concentrar
    // todo o aumento de dificuldade.
    const totalRange = MAX_MULTIPLIER - REAL_STAGES[0].speedMultiplier;
    assert.ok(jump <= totalRange / 2, `salto do estagio ${i} parece grande demais para ser "gradual"`);
  }
});

test('limite maximo: multiplicador nunca ultrapassa MAX_SPEED_MULTIPLIER, mesmo muito alem do ultimo estagio', () => {
  const lastStage = REAL_STAGES[REAL_STAGES.length - 1];
  assert.strictEqual(NoteEngine.resolveSpeedMultiplier(lastStage.notesPlayed, REAL_STAGES), MAX_MULTIPLIER);
  assert.strictEqual(NoteEngine.resolveSpeedMultiplier(lastStage.notesPlayed + 500, REAL_STAGES), MAX_MULTIPLIER);
  assert.strictEqual(NoteEngine.resolveSpeedMultiplier(1_000_000, REAL_STAGES), MAX_MULTIPLIER);
});

test('progressao nunca volta para tras: o multiplicador e monotonicamente nao-decrescente com o indice', () => {
  let previous = 0;
  for (let index = 0; index < 200; index++) {
    const current = NoteEngine.resolveSpeedMultiplier(index, REAL_STAGES);
    assert.ok(current >= previous, `multiplicador caiu do indice ${index - 1} (${previous}) para ${index} (${current})`);
    previous = current;
  }
});

// ---------------------------------------------------------------------
// 3) generateNoteTimeline -- integracao com a geracao de timeline real.
// ---------------------------------------------------------------------

test('sem difficultyStages: intervalo continua fixo (formula antiga, index * noteIntervalMs)', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const gaps = gapsOf(timeline);

  gaps.forEach((gap) => assert.strictEqual(gap, BASE_PARAMS.noteIntervalMs));
  assert.strictEqual(timeline[0].time, BASE_PARAMS.startTimestamp + BASE_PARAMS.leadInMs);
  timeline.forEach((note, index) => {
    assert.strictEqual(note.time, BASE_PARAMS.startTimestamp + BASE_PARAMS.leadInMs + index * BASE_PARAMS.noteIntervalMs);
  });
});

test('com difficultyStages: os intervalos diminuem progressivamente ao longo da timeline', () => {
  const timeline = NoteEngine.generateNoteTimeline({ ...BASE_PARAMS, difficultyStages: REAL_STAGES });
  const gaps = gapsOf(timeline);

  // Nao-crescente (cada gap <= o anterior) e estritamente menor em pelo
  // menos um ponto (a dificuldade realmente aumenta em algum momento).
  let strictlyDecreasedAtLeastOnce = false;
  const FLOAT_EPSILON = 1e-2; // tolerancia so para arredondamento de ponto flutuante da soma acumulada
  for (let i = 1; i < gaps.length; i++) {
    assert.ok(gaps[i] <= gaps[i - 1] + FLOAT_EPSILON, `gap ${i} (${gaps[i]}) deveria ser <= gap ${i - 1} (${gaps[i - 1]})`);
    if (gaps[i] < gaps[i - 1] - FLOAT_EPSILON) strictlyDecreasedAtLeastOnce = true;
  }
  assert.ok(strictlyDecreasedAtLeastOnce, 'a dificuldade deveria aumentar em algum ponto da timeline');

  // O primeiro gap (comeco confortavel) e exatamente o intervalo base.
  assert.strictEqual(gaps[0], BASE_PARAMS.noteIntervalMs);

  // Nenhum gap fica menor do que o intervalo base dividido pelo teto
  // maximo de velocidade (nunca ultrapassa o limite configurado).
  const minAllowedGap = BASE_PARAMS.noteIntervalMs / MAX_MULTIPLIER;
  gaps.forEach((gap) => assert.ok(gap >= minAllowedGap - FLOAT_EPSILON));
});

test('seed identica + mesmos stages => timelines identicas (sem divergencia entre jogadores)', () => {
  const timelineA = NoteEngine.generateNoteTimeline({ ...BASE_PARAMS, difficultyStages: REAL_STAGES });
  const timelineB = NoteEngine.generateNoteTimeline({ ...BASE_PARAMS, difficultyStages: REAL_STAGES });

  assert.deepStrictEqual(timelineA, timelineB);
});

test('MatchTimelineManager.ensureTimeline repassa difficultyStages para o NoteEngine sem duplicar geracao', () => {
  MatchTimelineManager.clear();
  const withStages = MatchTimelineManager.ensureTimeline({ ...BASE_PARAMS, difficultyStages: REAL_STAGES });
  const gaps = gapsOf(withStages);

  assert.ok(gaps[gaps.length - 1] < gaps[0], 'o ultimo intervalo deveria ser menor que o primeiro');

  // Mesma chave (seed+startTimestamp) => devolve a MESMA timeline em vez
  // de gerar de novo (ciclo de vida existente, intocado por esta etapa).
  const again = MatchTimelineManager.ensureTimeline({ ...BASE_PARAMS, difficultyStages: REAL_STAGES });
  assert.strictEqual(again, withStages);

  MatchTimelineManager.clear();
});

// ---------------------------------------------------------------------
// 4) A sequencia/mecanica de julgamento continua funcionando normalmente
//    com a timeline progressiva (nenhuma janela nova, nenhum julgamento
//    novo -- so os TEMPOS das notas mudam).
// ---------------------------------------------------------------------

test('sequencia continua funcionando: acertando as notas EM ORDEM (ja com progressao) todas dao PERFECT', () => {
  const timeline = NoteEngine.generateNoteTimeline({ ...BASE_PARAMS, difficultyStages: REAL_STAGES });
  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: {
      perfectMs: ClientConfig.JUDGEMENT_WINDOWS.PERFECT_MS,
      greatMs: ClientConfig.JUDGEMENT_WINDOWS.GREAT_MS,
      goodMs: ClientConfig.JUDGEMENT_WINDOWS.GOOD_MS,
    },
    scoreValues: ClientConfig.SCORE_VALUES,
  });

  // Acerta TODAS as notas, em ordem, exatamente no `note.time` de cada
  // uma -- inclusive as ultimas, ja depois de varios estagios de
  // aumento de velocidade. Continua PERFECT em todas porque a janela de
  // julgamento (PERFECT_MS) nao mudou nesta etapa; so o ESPACAMENTO
  // entre as notas ficou menor.
  timeline.forEach((note, index) => {
    const result = engine.handleKeyPress(note.lane, note.time);
    assert.strictEqual(result.outcome, 'PERFECT', `nota ${index} deveria ser PERFECT`);
  });
  assert.strictEqual(playerState.maxCombo, timeline.length);
});

test('nota perdida (MISS) continua funcionando normalmente mesmo em um estagio mais rapido', () => {
  const timeline = NoteEngine.generateNoteTimeline({ ...BASE_PARAMS, difficultyStages: REAL_STAGES });
  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: {
      perfectMs: ClientConfig.JUDGEMENT_WINDOWS.PERFECT_MS,
      greatMs: ClientConfig.JUDGEMENT_WINDOWS.GREAT_MS,
      goodMs: ClientConfig.JUDGEMENT_WINDOWS.GOOD_MS,
    },
    scoreValues: ClientConfig.SCORE_VALUES,
  });

  // Acerta todas as notas em ordem, MENOS a ultima -- assim so ela
  // permanece pendente/ativa quando o tempo passar do seu `time`.
  for (let index = 0; index < timeline.length - 1; index++) {
    const note = timeline[index];
    const result = engine.handleKeyPress(note.lane, note.time);
    assert.strictEqual(result.outcome, 'PERFECT');
  }

  const lastNote = timeline[timeline.length - 1];
  const missed = engine.processExpiredNotes(lastNote.time + 1, ClientConfig.NOTE_HIT_WINDOW_MS);

  assert.strictEqual(missed.length, 1);
  assert.strictEqual(missed[0].id, lastNote.id);
  assert.strictEqual(missed[0].state, 'missed');
});

console.log(`\n${passed} teste(s) passaram.`);
if (process.exitCode) {
  console.error('Um ou mais testes falharam.');
} else {
  console.log('Todos os testes passaram.');
}
