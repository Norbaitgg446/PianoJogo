/**
 * Testes automatizados do ciclo de vida da timeline de notas do
 * cliente (Etapa 5B-2A).
 *
 * NoteEngine.generateNoteTimeline em si (determinismo por seed, lanes
 * sempre entre 1 e 3, tempos derivados do startTimestamp do servidor)
 * ja e coberto por tests/noteEngine.test.js -- este arquivo testa
 * apenas a camada nova: QUANDO uma timeline e criada, reaproveitada
 * ou descartada, e se o resultado realmente serve para o
 * GameplayEngine ja existente.
 *
 * Executar com: node tests/matchTimelineManager.test.js
 */
const assert = require('assert');
const NoteEngine = require('../client/js/match/noteEngine');
const PlayerState = require('../client/js/match/playerState');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const MatchTimelineManager = require('../client/js/match/matchTimelineManager');

const BASE_PARAMS = {
  seed: 555,
  startTimestamp: 2_000_000,
  length: 8,
  noteRange: 3,
  noteIntervalMs: 600,
  leadInMs: 1000,
};

let passed = 0;
function test(name, fn) {
  try {
    MatchTimelineManager.clear(); // cada teste comeca sem partida ativa
    fn();
    passed++;
    console.log(`OK   - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// 1. Mesma seed + mesmo startTimestamp = mesma timeline ---------------------
test('mesma seed + mesmo startTimestamp produzem a mesma timeline (mesmas lanes e tempos)', () => {
  const timelineA = MatchTimelineManager.ensureTimeline(BASE_PARAMS);
  MatchTimelineManager.clear();
  const timelineB = MatchTimelineManager.ensureTimeline(BASE_PARAMS);

  assert.deepStrictEqual(
    timelineA.map((n) => n.lane),
    timelineB.map((n) => n.lane)
  );
  assert.deepStrictEqual(
    timelineA.map((n) => n.time),
    timelineB.map((n) => n.time)
  );
});

// 2. Servidor e cliente continuam gerando a mesma sequencia (via NoteEngine) -
test('a timeline do manager e identica a gerada diretamente por NoteEngine.generateNoteTimeline', () => {
  const viaManager = MatchTimelineManager.ensureTimeline(BASE_PARAMS);
  const viaNoteEngineDireto = NoteEngine.generateNoteTimeline(BASE_PARAMS);

  assert.deepStrictEqual(
    viaManager.map((n) => ({ lane: n.lane, time: n.time, id: n.id })),
    viaNoteEngineDireto.map((n) => ({ lane: n.lane, time: n.time, id: n.id })),
    'MatchTimelineManager nao pode ter nenhum gerador de notas proprio -- so repassa para NoteEngine'
  );
});

// 3 e 4. Todas as lanes entre 1 e 3, nenhuma lane 4 --------------------------
test('todas as lanes da timeline gerada estao entre 1 e 3 (nenhuma lane 4)', () => {
  const timeline = MatchTimelineManager.ensureTimeline(BASE_PARAMS);
  const lanes = timeline.map((n) => n.lane);

  assert.ok(lanes.length > 0);
  assert.ok(lanes.every((lane) => lane >= 1 && lane <= 3));
  assert.ok(lanes.every((lane) => lane !== 4));
});

// 5. A timeline e criada apenas uma vez por partida --------------------------
test('chamar ensureTimeline duas vezes para a MESMA partida nao recria a timeline', () => {
  const first = MatchTimelineManager.ensureTimeline(BASE_PARAMS);

  // Simula uma mensagem match_started duplicada chegando da rede, ou
  // um segundo ponto do codigo pedindo a timeline de novo.
  const second = MatchTimelineManager.ensureTimeline(BASE_PARAMS);

  assert.strictEqual(first, second, 'a segunda chamada deveria devolver a MESMA instancia, nao gerar outra');
});

test('progresso (notas ja hit) nao e perdido se ensureTimeline for chamada de novo para a mesma partida', () => {
  const timeline = MatchTimelineManager.ensureTimeline(BASE_PARAMS);
  NoteEngine.setNoteState(timeline, timeline[0].id, NoteEngine.NOTE_STATE.HIT);

  const timelineDeNovo = MatchTimelineManager.ensureTimeline(BASE_PARAMS);

  assert.strictEqual(timelineDeNovo[0].state, NoteEngine.NOTE_STATE.HIT, 'nao deveria ter voltado a pending');
});

// 6. A timeline e limpa ao finalizar/cancelar --------------------------------
test('clear() descarta a timeline ativa (getTimeline volta a null)', () => {
  MatchTimelineManager.ensureTimeline(BASE_PARAMS);
  assert.ok(MatchTimelineManager.getTimeline() !== null);

  MatchTimelineManager.clear();

  assert.strictEqual(MatchTimelineManager.getTimeline(), null);
});

// ...e e recriada corretamente numa nova partida -----------------------------
test('depois de clear(), uma nova partida (seed/startTimestamp diferentes) gera uma timeline nova', () => {
  const primeiraPartida = MatchTimelineManager.ensureTimeline(BASE_PARAMS);
  MatchTimelineManager.clear();

  const segundaPartida = MatchTimelineManager.ensureTimeline({
    ...BASE_PARAMS,
    seed: 777,
    startTimestamp: 3_000_000,
  });

  assert.notStrictEqual(primeiraPartida, segundaPartida);
  assert.notDeepStrictEqual(
    primeiraPartida.map((n) => n.lane),
    segundaPartida.map((n) => n.lane)
  );
});

test('uma nova partida com seed/startTimestamp diferentes substitui a timeline mesmo sem clear() explicito', () => {
  MatchTimelineManager.ensureTimeline(BASE_PARAMS);

  const novaPartida = MatchTimelineManager.ensureTimeline({
    ...BASE_PARAMS,
    seed: 999,
    startTimestamp: 4_000_000,
  });

  assert.strictEqual(MatchTimelineManager.getTimeline(), novaPartida);
});

// 7. O GameplayEngine consegue receber/utilizar essa timeline ---------------
test('a timeline do MatchTimelineManager funciona normalmente dentro do GameplayEngine ja existente', () => {
  const timeline = MatchTimelineManager.ensureTimeline(BASE_PARAMS);
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
  // Confirma que e a MESMA timeline (mutada pelo GameplayEngine, como
  // ja acontecia antes desta etapa) e nao uma copia.
  assert.strictEqual(MatchTimelineManager.getTimeline()[0].state, NoteEngine.NOTE_STATE.HIT);
});

console.log(`\n${passed} teste(s) passaram.`);
