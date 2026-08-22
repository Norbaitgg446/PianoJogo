/**
 * Testes automatizados da deteccao do fim de partida (Etapa 5B-4A).
 *
 * NoteEngine.isTerminal/updateTimelineStates e GameplayEngine.handleKeyPress/
 * processExpiredNotes ja sao cobertos por seus proprios arquivos de teste --
 * este arquivo testa apenas a camada nova: QUANDO a timeline inteira e
 * considerada concluida e o ciclo de vida em torno disso (dispara uma unica
 * vez, bloqueia input, para loops, preserva resultado, reseta numa partida
 * nova).
 *
 * Executar com: node tests/matchEndDetector.test.js
 */
const assert = require('assert');
const NoteEngine = require('../client/js/match/noteEngine');
const PlayerState = require('../client/js/match/playerState');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const InputController = require('../client/js/input/inputController');
const MatchEndDetector = require('../client/js/match/matchEndDetector');

const BASE_PARAMS = {
  seed: 321,
  startTimestamp: 1_000_000,
  length: 5,
  noteRange: 3,
  noteIntervalMs: 600,
  leadInMs: 0,
};

let passed = 0;
function test(name, fn) {
  try {
    InputController.setLaneHandler(null); // cada teste comeca sem handler vazado do anterior
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

// ---------------------------------------------------------------------
// 1. Timeline com todas as notas processadas -> partida termina
// ---------------------------------------------------------------------
test('timeline com todas as notas hit/missed e considerada concluida (isTimelineFinished)', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  timeline.forEach((note, i) => {
    note.state = i % 2 === 0 ? NoteEngine.NOTE_STATE.HIT : NoteEngine.NOTE_STATE.MISSED;
  });

  assert.strictEqual(MatchEndDetector.isTimelineFinished(timeline), true);
});

test('createMatchEndDetector dispara onMatchEnd quando checkForEnd encontra a timeline inteira concluida', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  markAll(timeline, NoteEngine.NOTE_STATE.HIT);

  let calls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({ timeline, onMatchEnd: () => calls++ });

  const fired = detector.checkForEnd();

  assert.strictEqual(fired, true);
  assert.strictEqual(calls, 1);
  assert.strictEqual(detector.hasEnded(), true);
});

// ---------------------------------------------------------------------
// 2 e 5. Uma unica nota pendente/ativa impede o termino
// ---------------------------------------------------------------------
test('uma unica nota pending impede o termino, mesmo com todas as outras hit/missed', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  markAll(timeline, NoteEngine.NOTE_STATE.HIT);
  timeline[timeline.length - 1].state = NoteEngine.NOTE_STATE.PENDING;

  assert.strictEqual(MatchEndDetector.isTimelineFinished(timeline), false);

  let calls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({ timeline, onMatchEnd: () => calls++ });
  assert.strictEqual(detector.checkForEnd(), false);
  assert.strictEqual(calls, 0);
  assert.strictEqual(detector.hasEnded(), false);
});

test('uma nota active (dentro da janela de julgamento, ainda sem decisao) tambem impede o termino', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  markAll(timeline, NoteEngine.NOTE_STATE.MISSED);
  timeline[0].state = NoteEngine.NOTE_STATE.ACTIVE;

  assert.strictEqual(MatchEndDetector.isTimelineFinished(timeline), false);
});

// ---------------------------------------------------------------------
// 3 e 4. hit e missed sao os dois estados considerados "processados"
// ---------------------------------------------------------------------
test('nota hit conta como processada', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  markAll(timeline, NoteEngine.NOTE_STATE.HIT);

  assert.strictEqual(MatchEndDetector.isTimelineFinished(timeline), true);
});

test('nota missed conta como processada', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  markAll(timeline, NoteEngine.NOTE_STATE.MISSED);

  assert.strictEqual(MatchEndDetector.isTimelineFinished(timeline), true);
});

test('uma mistura de hit e missed (sem nenhuma pending/active) tambem conclui a timeline', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  timeline.forEach((note, i) => {
    note.state = i % 2 === 0 ? NoteEngine.NOTE_STATE.HIT : NoteEngine.NOTE_STATE.MISSED;
  });

  assert.strictEqual(MatchEndDetector.isTimelineFinished(timeline), true);
});

// ---------------------------------------------------------------------
// 6. Partida nao termina duas vezes / nao dispara multiplos eventos
// ---------------------------------------------------------------------
test('checkForEnd chamado varias vezes apos o termino so dispara onMatchEnd uma unica vez', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  markAll(timeline, NoteEngine.NOTE_STATE.HIT);

  let calls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({ timeline, onMatchEnd: () => calls++ });

  const results = [detector.checkForEnd(), detector.checkForEnd(), detector.checkForEnd()];

  assert.deepStrictEqual(results, [true, false, false], 'so a primeira chamada deveria reportar que disparou o fim');
  assert.strictEqual(calls, 1, 'onMatchEnd nao pode ser chamado mais de uma vez');
});

test('checkForEnd chamado repetidamente ANTES do termino nao dispara nada ate a timeline realmente concluir', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  let calls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({ timeline, onMatchEnd: () => calls++ });

  detector.checkForEnd();
  detector.checkForEnd();
  assert.strictEqual(calls, 0);

  markAll(timeline, NoteEngine.NOTE_STATE.MISSED);
  assert.strictEqual(detector.checkForEnd(), true);
  assert.strictEqual(calls, 1);

  // Continua nao disparando de novo depois.
  detector.checkForEnd();
  assert.strictEqual(calls, 1);
});

// ---------------------------------------------------------------------
// 7. Inputs depois do termino sao ignorados (integracao com InputController,
//    reproduzindo o MESMO wiring que main.js usa: onMatchEnd desliga o
//    handler de lane, exatamente como startMatchGameplay/handleLocalMatchEnd)
// ---------------------------------------------------------------------
test('input disparado depois do fim da partida nao chega mais ao GameplayEngine (handler desligado pelo onMatchEnd)', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: { perfectMs: 60, goodMs: 150 },
    scoreValues: { PERFECT: 300, GOOD: 100, MISS: 0 },
  });

  const results = [];
  InputController.setLaneHandler((lane) => {
    results.push(engine.handleKeyPress(lane, Date.now()));
  });

  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    // Mesmo mecanismo usado por main.js/handleLocalMatchEnd: ao terminar,
    // impede novos inputs de alterar a partida desligando o handler.
    onMatchEnd: () => InputController.setLaneHandler(null),
  });

  markAll(timeline, NoteEngine.NOTE_STATE.HIT);
  detector.checkForEnd();

  // Qualquer tentativa de input depois disso nao deve chegar ao engine.
  InputController.triggerLane(1);
  InputController.triggerLane(2);

  assert.strictEqual(results.length, 0, 'nenhum input deveria ter sido processado depois do fim da partida');
});

// ---------------------------------------------------------------------
// 8. Loops sao interrompidos ao terminar (o callback e responsavel por
//    isso; aqui simulamos os "loops" de main.js com contadores/flags)
// ---------------------------------------------------------------------
test('o callback onMatchEnd consegue parar os loops de renderizacao/MISS de forma sincrona e definitiva', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);

  let renderLoopRunning = true;
  let missLoopRunning = true;

  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => {
      renderLoopRunning = false; // equivalente a NoteRenderer.stop()
      missLoopRunning = false; // equivalente a stopExpiredNotesLoop()
    },
  });

  markAll(timeline, NoteEngine.NOTE_STATE.MISSED);
  detector.checkForEnd();

  assert.strictEqual(renderLoopRunning, false);
  assert.strictEqual(missLoopRunning, false);

  // Simula o proprio loop continuando a chamar checkForEnd nos frames
  // seguintes (como main.js faz) -- os loops nao "voltam a rodar".
  detector.checkForEnd();
  detector.checkForEnd();
  assert.strictEqual(renderLoopRunning, false);
  assert.strictEqual(missLoopRunning, false);
});

// ---------------------------------------------------------------------
// 9. Nova partida consegue iniciar normalmente depois de uma anterior
// ---------------------------------------------------------------------
test('uma nova instancia (nova partida) comeca em hasEnded() === false, mesmo apos a partida anterior ter terminado', () => {
  const timelineAntiga = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  markAll(timelineAntiga, NoteEngine.NOTE_STATE.HIT);
  const detectorAntigo = MatchEndDetector.createMatchEndDetector({ timeline: timelineAntiga });
  detectorAntigo.checkForEnd();
  assert.strictEqual(detectorAntigo.hasEnded(), true);

  // Nova partida: nova timeline (fresca, tudo pending) + nova instancia
  // do detector -- exatamente como main.js faz em startMatchGameplay.
  const timelineNova = NoteEngine.generateNoteTimeline({ ...BASE_PARAMS, seed: 654, startTimestamp: 2_000_000 });
  const detectorNovo = MatchEndDetector.createMatchEndDetector({ timeline: timelineNova });

  assert.strictEqual(detectorNovo.hasEnded(), false);
  assert.strictEqual(detectorNovo.checkForEnd(), false, 'a timeline nova ainda esta toda pending, nao pode terminar');
});

test('reset() tambem permite reaproveitar a mesma instancia do detector caso necessario', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  markAll(timeline, NoteEngine.NOTE_STATE.HIT);

  let calls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({ timeline, onMatchEnd: () => calls++ });

  detector.checkForEnd();
  assert.strictEqual(calls, 1);

  detector.reset();
  assert.strictEqual(detector.hasEnded(), false);

  // Ainda a mesma timeline (ja toda hit) -- checkForEnd volta a detectar
  // e disparar de novo, pois o reset zera explicitamente a flag "ended".
  detector.checkForEnd();
  assert.strictEqual(calls, 2);
});

// ---------------------------------------------------------------------
// 10. Jogadores podem ter scores diferentes sem impedir o termino
// ---------------------------------------------------------------------
test('dois jogadores com quantidades diferentes de hits/misses sobre a MESMA timeline terminam juntos, no mesmo instante', () => {
  const timelineP1 = NoteEngine.generateNoteTimeline({ ...BASE_PARAMS, length: 10 });
  const timelineP2 = NoteEngine.generateNoteTimeline({ ...BASE_PARAMS, length: 10 }); // mesma seed/params = mesma timeline

  // Jogador 1: 9 hits + 1 miss. Jogador 2: 6 hits + 4 misses.
  timelineP1.forEach((note, i) => {
    note.state = i < 9 ? NoteEngine.NOTE_STATE.HIT : NoteEngine.NOTE_STATE.MISSED;
  });
  timelineP2.forEach((note, i) => {
    note.state = i < 6 ? NoteEngine.NOTE_STATE.HIT : NoteEngine.NOTE_STATE.MISSED;
  });

  const player1State = PlayerState.createPlayerState();
  player1State.hits = 9;
  player1State.misses = 1;
  player1State.score = 2700;

  const player2State = PlayerState.createPlayerState();
  player2State.hits = 6;
  player2State.misses = 4;
  player2State.score = 1800;

  const detectorP1 = MatchEndDetector.createMatchEndDetector({ timeline: timelineP1 });
  const detectorP2 = MatchEndDetector.createMatchEndDetector({ timeline: timelineP2 });

  assert.strictEqual(detectorP1.checkForEnd(), true);
  assert.strictEqual(detectorP2.checkForEnd(), true);

  // Scores diferentes nao influenciam nem impedem a deteccao -- o
  // detector nunca olha para PlayerState, so para a timeline.
  assert.notStrictEqual(player1State.score, player2State.score);
  assert.notStrictEqual(player1State.hits, player2State.hits);
  assert.strictEqual(detectorP1.hasEnded(), true);
  assert.strictEqual(detectorP2.hasEnded(), true);
});

// ---------------------------------------------------------------------
// 11. Nenhum resultado e apagado ao finalizar
// ---------------------------------------------------------------------
test('finalizar a partida nao apaga score/combo/hits/misses do PlayerState nem muta a timeline', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: { perfectMs: 60, goodMs: 150 },
    scoreValues: { PERFECT: 300, GOOD: 100, MISS: 0 },
  });

  // Acerta a primeira nota de verdade, marca as demais como missed.
  engine.handleKeyPress(timeline[0].lane, timeline[0].time);
  timeline.slice(1).forEach((note) => {
    note.state = NoteEngine.NOTE_STATE.MISSED;
  });

  const scoreAntes = playerState.score;
  const hitsAntes = playerState.hits;
  const missesAntes = playerState.misses;
  const timelineSnapshot = timeline.map((n) => ({ id: n.id, state: n.state }));

  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => {
      // Simula exatamente o que handleLocalMatchEnd faz em main.js:
      // NENHUMA linha aqui mexe em playerState nem na timeline.
    },
  });
  detector.checkForEnd();

  assert.strictEqual(playerState.score, scoreAntes);
  assert.strictEqual(playerState.hits, hitsAntes);
  assert.strictEqual(playerState.misses, missesAntes);
  assert.deepStrictEqual(
    timeline.map((n) => ({ id: n.id, state: n.state })),
    timelineSnapshot,
    'o detector nao pode alterar o estado das notas -- so LE'
  );
});

// ---------------------------------------------------------------------
// Extra: timeline vazia/invalida nunca e considerada concluida
// ---------------------------------------------------------------------
test('timeline vazia ou ausente nunca e considerada concluida', () => {
  assert.strictEqual(MatchEndDetector.isTimelineFinished([]), false);
  assert.strictEqual(MatchEndDetector.isTimelineFinished(null), false);
  assert.strictEqual(MatchEndDetector.isTimelineFinished(undefined), false);
});

console.log(`\n${passed} teste(s) passaram.`);
