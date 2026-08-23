/**
 * Testes automatizados da ETAPA 13F — PARTE 1 (estrutura e dados da
 * tela de resultado).
 *
 * Cobre exatamente o que a Parte 1 pediu, reaproveitando os sistemas
 * ja existentes (PlayerState, GameplayEngine, MatchResult) em vez de
 * criar um segundo sistema de pontuacao/julgamento paralelo:
 *
 * - contagem de PERFECT/GREAT/GOOD (PlayerState.registerHit);
 * - contagem de ERRO/MISS (PlayerState.registerMistake/registerMiss);
 * - maior combo (PlayerState.maxCombo, ja existente antes da 13F);
 * - maior multiplicador atingido (PlayerState.maxMultiplier, novo);
 * - calculo de precisao centralizado (MatchResult.calculateAccuracy);
 * - resultado com score negativo, com zero acertos, e com partida
 *   perfeita (MatchResult.buildResult).
 *
 * Executar com: node tests/resultStats13F.test.js
 */
const assert = require('assert');
const NoteEngine = require('../client/js/match/noteEngine');
const PlayerState = require('../client/js/match/playerState');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const MatchResult = require('../client/js/match/matchResult');

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
  seed: 777,
  startTimestamp: 1_000_000,
  length: 20,
  noteRange: 3,
  noteIntervalMs: 600,
  leadInMs: 0,
};

// Janelas com PERFECT/GREAT/GOOD distintas, para poder gerar os tres
// julgamentos de acerto de proposito nos testes (ETAPA 13C).
const WINDOWS = { perfectMs: 20, greatMs: 60, goodMs: 150 };
const SCORE_VALUES = { PERFECT: 300, GREAT: 200, GOOD: 100, MISS: 0 };
const COMBO_TIERS = [
  { minCombo: 0, multiplier: 1 },
  { minCombo: 3, multiplier: 2 },
  { minCombo: 6, multiplier: 4 },
];
const PENALTIES = { MISTAKE: -50, MISS: -30 };

function makeEngine({ comboMultiplierTiers, penalties, params = BASE_PARAMS } = {}) {
  const timeline = NoteEngine.generateNoteTimeline(params);
  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers,
    penalties,
  });
  return { timeline, playerState, engine };
}

// ---------------------------------------------------------------------
// 1. Contagem de PERFECT
// ---------------------------------------------------------------------
test('registerHit incrementa perfectCount a cada julgamento PERFECT, sem tocar great/good', () => {
  const { timeline, playerState, engine } = makeEngine();

  engine.handleKeyPress(timeline[0].lane, timeline[0].time); // deltaMs 0 -> PERFECT
  engine.handleKeyPress(timeline[1].lane, timeline[1].time); // deltaMs 0 -> PERFECT

  assert.strictEqual(playerState.perfectCount, 2);
  assert.strictEqual(playerState.greatCount, 0);
  assert.strictEqual(playerState.goodCount, 0);
  assert.strictEqual(playerState.hits, 2, 'hits continua sendo o total, exatamente como antes da 13F');
});

// ---------------------------------------------------------------------
// 2. Contagem de GREAT
// ---------------------------------------------------------------------
test('registerHit incrementa greatCount a cada julgamento GREAT, sem tocar perfect/good', () => {
  const { timeline, playerState, engine } = makeEngine();
  const note = timeline[0];

  // deltaMs = 40 -> fora de perfectMs (20), dentro de greatMs (60) -> GREAT
  engine.handleKeyPress(note.lane, note.time + 40);

  assert.strictEqual(playerState.greatCount, 1);
  assert.strictEqual(playerState.perfectCount, 0);
  assert.strictEqual(playerState.goodCount, 0);
  assert.strictEqual(playerState.hits, 1);
});

// ---------------------------------------------------------------------
// 3. Contagem de GOOD
// ---------------------------------------------------------------------
test('registerHit incrementa goodCount a cada julgamento GOOD, sem tocar perfect/great', () => {
  const { timeline, playerState, engine } = makeEngine();
  const note = timeline[0];

  // deltaMs = 100 -> fora de greatMs (60), dentro de goodMs (150) -> GOOD
  engine.handleKeyPress(note.lane, note.time + 100);

  assert.strictEqual(playerState.goodCount, 1);
  assert.strictEqual(playerState.perfectCount, 0);
  assert.strictEqual(playerState.greatCount, 0);
  assert.strictEqual(playerState.hits, 1);
});

// ---------------------------------------------------------------------
// 4. Contagem de ERRO (mistake)
// ---------------------------------------------------------------------
test('registerMistake (tecla errada/fora de janela) incrementa mistakes e zera o combo', () => {
  const { timeline, playerState, engine } = makeEngine();

  engine.handleKeyPress(timeline[0].lane, timeline[0].time); // PERFECT, combo=1
  engine.handleKeyPress(999, Date.now()); // lane invalida -> ERRO

  assert.strictEqual(playerState.mistakes, 1);
  assert.strictEqual(playerState.combo, 0, 'ERRO zera o combo atual');
  assert.strictEqual(playerState.maxCombo, 1, 'maxCombo preserva o pico anterior ao ERRO');
});

// ---------------------------------------------------------------------
// 5. Contagem de MISS
// ---------------------------------------------------------------------
test('processExpiredNotes incrementa misses para cada nota expirada e zera o combo', () => {
  const { timeline, playerState, engine } = makeEngine();
  const note = timeline[0];

  engine.processExpiredNotes(note.time + WINDOWS.goodMs + 1, WINDOWS.goodMs);

  assert.strictEqual(playerState.misses, 1);
  assert.strictEqual(playerState.combo, 0);
});

// ---------------------------------------------------------------------
// 6. Maior combo (ja existia, mas precisa continuar correto com a
// contagem detalhada nova) -- o maior valor ATINGIDO, nao o combo final
// ---------------------------------------------------------------------
test('maxCombo guarda o maior combo atingido, mesmo depois de quebrar', () => {
  const { timeline, playerState, engine } = makeEngine();

  for (let i = 0; i < 5; i++) {
    engine.handleKeyPress(timeline[i].lane, timeline[i].time);
  }
  assert.strictEqual(playerState.combo, 5);
  assert.strictEqual(playerState.maxCombo, 5);

  // Quebra o combo com um ERRO -- combo atual cai para 0, maxCombo NAO.
  engine.handleKeyPress(999, Date.now());
  assert.strictEqual(playerState.combo, 0);
  assert.strictEqual(playerState.maxCombo, 5, 'maxCombo nao pode ser sobrescrito pelo combo atual (0)');

  // Um novo combo menor que o pico anterior nao deve alterar maxCombo.
  engine.handleKeyPress(timeline[5].lane, timeline[5].time);
  engine.handleKeyPress(timeline[6].lane, timeline[6].time);
  assert.strictEqual(playerState.combo, 2);
  assert.strictEqual(playerState.maxCombo, 5, 'combo novo menor que o pico nao rebaixa maxCombo');
});

// ---------------------------------------------------------------------
// 7. Maior multiplicador
// ---------------------------------------------------------------------
test('maxMultiplier comeca em 1 e so sobe quando um multiplicador maior e realmente atingido', () => {
  const { timeline, playerState, engine } = makeEngine({ comboMultiplierTiers: COMBO_TIERS });

  assert.strictEqual(playerState.maxMultiplier, 1, 'valor inicial antes de qualquer acerto');

  // combo 1 e 2 -> multiplicador 1x (tier minCombo:0)
  engine.handleKeyPress(timeline[0].lane, timeline[0].time);
  engine.handleKeyPress(timeline[1].lane, timeline[1].time);
  assert.strictEqual(playerState.maxMultiplier, 1);

  // combo 3 -> multiplicador 2x (tier minCombo:3)
  engine.handleKeyPress(timeline[2].lane, timeline[2].time);
  assert.strictEqual(playerState.combo, 3);
  assert.strictEqual(playerState.maxMultiplier, 2);

  // combo 6 -> multiplicador 4x (tier minCombo:6)
  for (let i = 3; i < 6; i++) {
    engine.handleKeyPress(timeline[i].lane, timeline[i].time);
  }
  assert.strictEqual(playerState.combo, 6);
  assert.strictEqual(playerState.maxMultiplier, 4);
});

test('maxMultiplier NUNCA diminui mesmo depois do combo quebrar e do multiplicador cair', () => {
  const { timeline, playerState, engine } = makeEngine({ comboMultiplierTiers: COMBO_TIERS });

  for (let i = 0; i < 6; i++) {
    engine.handleKeyPress(timeline[i].lane, timeline[i].time);
  }
  assert.strictEqual(playerState.maxMultiplier, 4, 'pico atingido com combo 6');

  // ERRO quebra o combo -> multiplicador atual volta a 1x, mas o pico
  // ja registrado deve permanecer.
  engine.handleKeyPress(999, Date.now());
  assert.strictEqual(playerState.combo, 0);
  assert.strictEqual(playerState.maxMultiplier, 4, 'maxMultiplier preserva o pico mesmo com o combo zerado');

  // Um novo acerto isolado (multiplicador 1x) nao pode rebaixar o pico.
  engine.handleKeyPress(timeline[6].lane, timeline[6].time);
  assert.strictEqual(playerState.maxMultiplier, 4);
});

test('sem comboMultiplierTiers configurado, maxMultiplier permanece 1 (compatibilidade com a 4B/13C)', () => {
  const { timeline, playerState, engine } = makeEngine(); // sem tiers

  for (let i = 0; i < 8; i++) {
    engine.handleKeyPress(timeline[i].lane, timeline[i].time);
  }

  assert.strictEqual(playerState.maxMultiplier, 1);
});

// ---------------------------------------------------------------------
// 8. Calculo de precisao (funcao centralizada, pura e deterministica)
// ---------------------------------------------------------------------
test('calculateAccuracy: partida so com PERFECT resulta em 100%', () => {
  assert.strictEqual(MatchResult.calculateAccuracy({ perfectCount: 10 }), 100);
});

test('calculateAccuracy: mistura de PERFECT/GREAT/GOOD conta tudo como acerto', () => {
  assert.strictEqual(
    MatchResult.calculateAccuracy({ perfectCount: 5, greatCount: 3, goodCount: 2 }),
    100
  );
});

test('calculateAccuracy: MISS reduz a precisao proporcionalmente', () => {
  // 8 acertos, 2 misses -> 8/10 = 80%
  assert.strictEqual(MatchResult.calculateAccuracy({ perfectCount: 8, misses: 2 }), 80);
});

test('calculateAccuracy: ERRO tambem reduz a precisao (nao e ignorado)', () => {
  // 8 acertos, 2 erros -> 8/10 = 80%, igual ao efeito de 2 misses
  assert.strictEqual(MatchResult.calculateAccuracy({ perfectCount: 8, mistakes: 2 }), 80);
});

test('calculateAccuracy: chamada e determinística (mesma entrada sempre produz a mesma saida)', () => {
  const input = { perfectCount: 3, greatCount: 2, goodCount: 1, mistakes: 1, misses: 1 };
  const a = MatchResult.calculateAccuracy(input);
  const b = MatchResult.calculateAccuracy({ ...input });
  assert.strictEqual(a, b);
  assert.strictEqual(a, 75); // 6 acertos / 8 tentativas = 75%
});

test('calculateAccuracy: funcao pura -- nao muta o objeto de contagem recebido', () => {
  const input = { perfectCount: 4, misses: 1 };
  const snapshot = { ...input };
  MatchResult.calculateAccuracy(input);
  assert.deepStrictEqual(input, snapshot);
});

// ---------------------------------------------------------------------
// 9. Resultado com score negativo (penalizacoes de ERRO/MISS, Etapa 13C)
// ---------------------------------------------------------------------
test('buildResult preserva o score negativo sem clamping (varios ERRO/MISS penalizados)', () => {
  const { timeline, playerState, engine } = makeEngine({ penalties: PENALTIES });

  // Nenhum acerto -- so penalizacoes, score deve ficar negativo.
  engine.handleKeyPress(999, Date.now()); // ERRO: -50
  engine.handleKeyPress(998, Date.now()); // ERRO: -50
  engine.processExpiredNotes(timeline[0].time + WINDOWS.goodMs + 1, WINDOWS.goodMs); // MISS: -30

  assert.ok(playerState.score < 0, 'score deveria estar negativo apos as penalizacoes');

  const result = MatchResult.buildResult({ playerState, timeline });

  assert.strictEqual(result.score, playerState.score);
  assert.strictEqual(result.score, -130);
  assert.strictEqual(result.mistakes, 2);
  assert.strictEqual(result.misses, 1);
});

// ---------------------------------------------------------------------
// 10. Resultado com zero acertos
// ---------------------------------------------------------------------
test('buildResult com zero acertos produz todas as contagens de acerto zeradas e accuracy 0', () => {
  const { timeline, playerState, engine } = makeEngine();

  engine.processExpiredNotes(timeline[0].time + WINDOWS.goodMs + 1, WINDOWS.goodMs);
  engine.processExpiredNotes(timeline[1].time + WINDOWS.goodMs + 1, WINDOWS.goodMs);
  engine.handleKeyPress(999, Date.now());

  const result = MatchResult.buildResult({ playerState, timeline });

  assert.strictEqual(result.hits, 0);
  assert.strictEqual(result.perfectCount, 0);
  assert.strictEqual(result.greatCount, 0);
  assert.strictEqual(result.goodCount, 0);
  assert.strictEqual(result.misses, 2);
  assert.strictEqual(result.mistakes, 1);
  assert.strictEqual(result.maxCombo, 0);
  assert.strictEqual(result.maxMultiplier, 1);
  assert.strictEqual(result.accuracy, 0);
});

test('buildResult com PlayerState recem-criado (nenhum evento) nunca divide por zero', () => {
  const playerState = PlayerState.createPlayerState();
  const result = MatchResult.buildResult({ playerState, timeline: [] });

  assert.strictEqual(result.accuracy, 0);
  assert.strictEqual(result.score, 0);
  assert.strictEqual(result.maxMultiplier, 1);
});

// ---------------------------------------------------------------------
// 11. Resultado com partida perfeita (100% PERFECT, sem ERRO/MISS)
// ---------------------------------------------------------------------
test('buildResult com partida perfeita (todas PERFECT, sem erro/miss) produz accuracy 100', () => {
  const params = { ...BASE_PARAMS, length: 12 };
  const { timeline, playerState, engine } = makeEngine({ comboMultiplierTiers: COMBO_TIERS, params });

  timeline.forEach((note) => {
    engine.handleKeyPress(note.lane, note.time); // deltaMs 0 -> sempre PERFECT
  });

  const result = MatchResult.buildResult({ playerState, timeline });

  assert.strictEqual(result.perfectCount, 12);
  assert.strictEqual(result.greatCount, 0);
  assert.strictEqual(result.goodCount, 0);
  assert.strictEqual(result.misses, 0);
  assert.strictEqual(result.mistakes, 0);
  assert.strictEqual(result.hits, 12);
  assert.strictEqual(result.maxCombo, 12, 'combo nunca quebrou -- pico e o total de notas');
  assert.strictEqual(result.maxMultiplier, 4, 'combo alto o suficiente para atingir o maior tier configurado');
  assert.strictEqual(result.accuracy, 100);
});

console.log(`\n${passed} teste(s) passaram.`);
