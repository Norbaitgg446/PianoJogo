/**
 * ETAPA 15C-1B — Integracao do limite de duracao ao MatchEndDetector.
 *
 * IMPORTANTE: esta etapa SO prepara o MatchEndDetector para reconhecer
 * uma duracao maxima -- ninguem em main.js/matchController.js/
 * botMatchController.js/servidor chama isso ainda para encerrar uma
 * partida de verdade pelo fluxo visual. Isso fica para uma proxima parte
 * da Etapa 15.
 *
 * Este arquivo testa exclusivamente `MatchEndDetector.createMatchEndDetector`
 * e `checkForEnd(currentTime)`:
 *   1. continua funcionando sem durationMs;
 *   2. aceita durationMs (armazenado, consultavel via getDurationMs());
 *   3. antes do limite -> nao considera duracao atingida;
 *   4. exatamente no limite -> considera duracao atingida;
 *   5. depois do limite -> considera duracao atingida;
 *   6. timeline continua podendo encerrar normalmente (sem durationMs);
 *   7. duracao nao interfere na timeline antes do limite (timeline ainda
 *      em andamento + duracao nao atingida -> nao encerra);
 *   8. duracao invalida (durationMs<=0, nao numerico, sem startTime) nao
 *      quebra o detector -- so nunca encerra por duracao;
 *   9. ausencia de duracao preserva o comportamento antigo (checkForEnd()
 *      chamado sem currentTime continua funcionando exatamente como
 *      antes da Etapa 15C-1B);
 *   10. o detector nao usa Date.now()/performance.now() (inspecao
 *       estatica do arquivo-fonte);
 *   11. o detector nao cria timers (setTimeout/setInterval -- inspecao
 *       estatica do arquivo-fonte);
 *   12. hasReachedMatchDuration() continua sendo reutilizada, sem
 *       duplicacao da logica (inspecao estatica: matchEndDetector.js nao
 *       reimplementa "currentTime - startTime >= durationMs").
 *
 * Mesmo estilo dos demais arquivos de teste do projeto (ex:
 * tests/matchDuration15A.test.js): exercita os modulos REAIS, nunca
 * reimplementa a logica aqui.
 *
 * Executar com: node tests/matchEndDetectorDuration15C1B.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const MatchEndDetector = require('../client/js/match/matchEndDetector');
const MatchDuration = require('../client/js/match/matchDuration');
const NoteEngine = require('../client/js/match/noteEngine');

const BASE_PARAMS = {
  seed: 15100,
  startTimestamp: 1_000_000,
  length: 5,
  noteRange: 3,
  noteIntervalMs: 600,
  leadInMs: 0,
};

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

function markAll(timeline, state) {
  timeline.forEach((note) => {
    note.state = state;
  });
}

// =====================================================================
// 1. Continua funcionando sem durationMs
// =====================================================================

test('createMatchEndDetector sem durationMs continua funcionando exatamente como antes', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  let calls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({ timeline, onMatchEnd: () => calls++ });

  assert.strictEqual(detector.checkForEnd(), false);
  assert.strictEqual(calls, 0);

  markAll(timeline, NoteEngine.NOTE_STATE.HIT);
  assert.strictEqual(detector.checkForEnd(), true);
  assert.strictEqual(calls, 1);
});

// =====================================================================
// 2. Aceita durationMs (armazenado)
// =====================================================================

test('createMatchEndDetector aceita durationMs e o expoe via getDurationMs()', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    durationMs: 30000,
    startTime: 1_000_000,
  });

  assert.strictEqual(detector.getDurationMs(), 30000);
});

// =====================================================================
// 3, 4, 5. Antes / exatamente no / depois do limite
// =====================================================================

test('antes do limite de duracao: checkForEnd(currentTime) nao considera a duracao atingida', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS); // timeline ainda toda pending
  let calls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => calls++,
    durationMs: 30000,
    startTime: 1_000_000,
  });

  assert.strictEqual(detector.checkForEnd(1_029_999), false);
  assert.strictEqual(calls, 0);
  assert.strictEqual(detector.hasEnded(), false);
});

test('exatamente no limite de duracao: checkForEnd(currentTime) dispara onMatchEnd', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS); // timeline ainda toda pending
  let calls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => calls++,
    durationMs: 30000,
    startTime: 1_000_000,
  });

  assert.strictEqual(detector.checkForEnd(1_030_000), true);
  assert.strictEqual(calls, 1);
  assert.strictEqual(detector.hasEnded(), true);
});

test('depois do limite de duracao: checkForEnd(currentTime) dispara onMatchEnd', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS); // timeline ainda toda pending
  let calls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => calls++,
    durationMs: 30000,
    startTime: 1_000_000,
  });

  assert.strictEqual(detector.checkForEnd(1_099_999), true);
  assert.strictEqual(calls, 1);
  assert.strictEqual(detector.hasEnded(), true);
});

// =====================================================================
// 6. Timeline continua podendo encerrar normalmente (sem durationMs)
// =====================================================================

test('sem durationMs, timeline concluida ainda encerra a partida normalmente', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  markAll(timeline, NoteEngine.NOTE_STATE.MISSED);

  const detector = MatchEndDetector.createMatchEndDetector({ timeline });
  assert.strictEqual(detector.checkForEnd(), true);
});

// =====================================================================
// 7. Duracao nao interfere na timeline antes do limite
// =====================================================================

test('com durationMs informado, timeline ainda em andamento e duracao nao atingida => nao encerra', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS); // toda pending
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    durationMs: 30000,
    startTime: 1_000_000,
  });

  assert.strictEqual(detector.checkForEnd(1_010_000), false);
  assert.strictEqual(detector.hasEnded(), false);
});

test('com durationMs informado, a timeline continua terminando pela regra de sempre quando concluida antes do limite', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  markAll(timeline, NoteEngine.NOTE_STATE.HIT);

  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    durationMs: 300000, // limite bem distante
    startTime: 1_000_000,
  });

  // Timeline ja concluida, mesmo que a duracao esteja longe de ser atingida.
  assert.strictEqual(detector.checkForEnd(1_010_000), true);
});

// =====================================================================
// 8. Duracao invalida nao quebra o detector
// =====================================================================

test('durationMs invalido (string) nunca encerra por duracao, nunca lanca erro', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    durationMs: 'trinta mil',
    startTime: 1_000_000,
  });

  assert.doesNotThrow(() => detector.checkForEnd(9_999_999));
  assert.strictEqual(detector.checkForEnd(9_999_999), false);
});

test('durationMs <= 0 ("desligado") nunca encerra por duracao', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    durationMs: 0,
    startTime: 1_000_000,
  });

  assert.strictEqual(detector.checkForEnd(9_999_999), false);
});

test('durationMs informado sem startTime nunca encerra por duracao (falta um dos tres ingredientes)', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    durationMs: 30000,
    // startTime omitido de proposito
  });

  assert.strictEqual(detector.checkForEnd(9_999_999), false);
});

test('durationMs e startTime informados mas checkForEnd() chamado sem currentTime nunca encerra por duracao', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    durationMs: 30000,
    startTime: 1_000_000,
  });

  assert.strictEqual(detector.checkForEnd(), false);
});

// =====================================================================
// 9. Ausencia de duracao preserva o comportamento antigo
// =====================================================================

test('checkForEnd() sem nenhum argumento, sem durationMs, se comporta identico a Etapa 5B-4A', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const detector = MatchEndDetector.createMatchEndDetector({ timeline });

  assert.strictEqual(detector.checkForEnd(), false);
  markAll(timeline, NoteEngine.NOTE_STATE.HIT);
  assert.strictEqual(detector.checkForEnd(), true);
});

test('checkForEnd chamado varias vezes apos o termino por duracao so dispara onMatchEnd uma unica vez', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS); // toda pending
  let calls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => calls++,
    durationMs: 30000,
    startTime: 1_000_000,
  });

  const results = [
    detector.checkForEnd(1_030_000),
    detector.checkForEnd(1_040_000),
    detector.checkForEnd(1_050_000),
  ];

  assert.deepStrictEqual(results, [true, false, false]);
  assert.strictEqual(calls, 1);
});

// =====================================================================
// 10 e 11. Sem relogio proprio, sem timers (inspecao estatica)
// =====================================================================

test('client/js/match/matchEndDetector.js nunca referencia Date.now/performance.now/setTimeout/setInterval', () => {
  const filePath = path.join(__dirname, '../client/js/match/matchEndDetector.js');
  const content = fs.readFileSync(filePath, 'utf8');

  ['Date.now(', 'performance.now(', 'setTimeout(', 'setInterval(', 'requestAnimationFrame('].forEach(
    (forbidden) => {
      assert.ok(
        !content.includes(forbidden),
        `matchEndDetector.js nao deveria conter "${forbidden}" (sem relogio/timer proprio)`
      );
    }
  );
});

// =====================================================================
// 12. hasReachedMatchDuration reutilizada, sem duplicacao
// =====================================================================

test('matchEndDetector.js reutiliza MatchDuration.hasReachedMatchDuration (require do modulo) em vez de duplicar a formula', () => {
  const filePath = path.join(__dirname, '../client/js/match/matchEndDetector.js');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(
    content.includes("require('./matchDuration')"),
    'matchEndDetector.js deveria importar o modulo matchDuration.js'
  );
  assert.ok(
    content.includes('hasReachedMatchDuration('),
    'matchEndDetector.js deveria chamar hasReachedMatchDuration'
  );
  assert.ok(
    !content.includes('>= durationMs') && !content.includes('- startTime'),
    'matchEndDetector.js nao deveria reimplementar a formula de duracao (currentTime - startTime >= durationMs)'
  );
});

test('o valor de checkForEnd(currentTime) por duracao bate exatamente com MatchDuration.hasReachedMatchDuration chamada isoladamente', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS); // toda pending
  const startTime = 1_000_000;
  const durationMs = 45000;

  [1_044_999, 1_045_000, 1_045_001].forEach((currentTime) => {
    const detector = MatchEndDetector.createMatchEndDetector({ timeline, durationMs, startTime });
    const viaDetector = detector.checkForEnd(currentTime);
    const viaMatchDuration = MatchDuration.hasReachedMatchDuration(currentTime, startTime, durationMs);
    assert.strictEqual(viaDetector, viaMatchDuration);
  });
});

console.log(`\n${passed} teste(s) passaram.`);
