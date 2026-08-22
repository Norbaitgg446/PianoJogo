/**
 * Testes automatizados de integracao da Etapa 5B-3A:
 *
 *   SETINHA -> LANE -> NOTA -> JULGAMENTO -> SCORE/COMBO -> EVENTO DE REDE
 *
 * Diferente de tests/gameplayEngine.test.js (que testa GameplayEngine
 * isoladamente, chamando handleKeyPress diretamente), este arquivo
 * testa o CAMINHO REAL usado pelo jogador: InputController (o MESMO
 * modulo/mapeamento de teclas usado em main.js) -> GameplayEngine ->
 * Judgement -> NoteEngine, exatamente como main.js liga os dois com
 * `InputController.setLaneHandler`.
 *
 * Nao recria nenhuma logica de julgamento/pontuacao/combo: so conecta
 * os modulos existentes, do mesmo jeito que main.js faz, e verifica o
 * resultado.
 *
 * Executar com: node tests/laneInputIntegration.test.js
 */
const assert = require('assert');
const InputController = require('../client/js/input/inputController');
const NoteEngine = require('../client/js/match/noteEngine');
const PlayerState = require('../client/js/match/playerState');
const GameplayEngine = require('../client/js/match/gameplayEngine');

const WINDOWS = { perfectMs: 60, goodMs: 150 };
const SCORE_VALUES = { PERFECT: 300, GOOD: 100, MISS: 0 };

const BASE_PARAMS = {
  seed: 42,
  startTimestamp: 1_000_000,
  length: 8,
  noteRange: 3, // 3 lanes: 1=esquerda(<-), 2=cima(^), 3=direita(->)
  noteIntervalMs: 600,
  leadInMs: 0,
};
// Com esta seed/params a timeline tem pelo menos uma nota em cada lane
// (ver comentario em cada teste abaixo com o indice usado).

let passed = 0;
function test(name, fn) {
  try {
    InputController.setLaneHandler(null); // cada teste comeca sem handler "vazado" do anterior
    fn();
    passed++;
    console.log(`OK   - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

/**
 * Monta timeline + PlayerState + GameplayEngine (identico ao que
 * startMatchGameplay monta em main.js) e liga o resultado ao
 * InputController via setLaneHandler -- exatamente como
 * `handleLanePressed` faz em main.js.
 */
function wireLocalPlayer({ getCurrentTime = () => Date.now(), events } = {}) {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const playerState = PlayerState.createPlayerState();
  const results = [];

  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    sendEvent: (type, payload) => events && events.push({ type, payload }),
  });

  InputController.setLaneHandler((lane) => {
    results.push(engine.handleKeyPress(lane, getCurrentTime()));
  });

  return { timeline, playerState, engine, results };
}

/**
 * Simula um keydown de teclado real passando pelo MESMO KEY_TO_LANE de
 * InputController.bindKeyboard -- sem duplicar o mapeamento aqui. Cria
 * um `document` minimo (duck-typing de addEventListener), liga o
 * listener real uma vez, e dispara o evento.
 */
function makeFakeDocument() {
  const listeners = {};
  return {
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    _dispatch(type, event) {
      if (listeners[type]) listeners[type](event);
    },
  };
}

function pressArrowKey(fakeDocument, key) {
  fakeDocument._dispatch('keydown', {
    key,
    repeat: false,
    target: {},
    preventDefault() {},
  });
}

// ---------------------------------------------------------------------
// 1-3. Mapeamento real de tecla -> lane -> nota (via InputController.bindKeyboard)
// ---------------------------------------------------------------------
test('ArrowLeft (ligado via InputController.bindKeyboard) aciona a lane 1 e acerta somente notas da lane 1', () => {
  const originalDocument = global.document;
  const fakeDocument = makeFakeDocument();
  global.document = fakeDocument;

  try {
    const { timeline, results } = wireLocalPlayer({ getCurrentTime: () => timelineNoteTime(timeline, 1) });
    InputController.bindKeyboard();

    pressArrowKey(fakeDocument, 'ArrowLeft');

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].lane, 1);
    assert.strictEqual(results[0].outcome, 'PERFECT');
    const laneOneNote = timeline.find((n) => n.lane === 1 && n.state === NoteEngine.NOTE_STATE.HIT);
    assert.ok(laneOneNote, 'uma nota da lane 1 deveria ter sido marcada como HIT');
  } finally {
    global.document = originalDocument;
  }
});

test('ArrowUp (ligado via InputController.bindKeyboard) aciona a lane 2 e acerta somente notas da lane 2', () => {
  const originalDocument = global.document;
  const fakeDocument = makeFakeDocument();
  global.document = fakeDocument;

  try {
    const { timeline, results } = wireLocalPlayer({ getCurrentTime: () => timelineNoteTime(timeline, 2) });
    InputController.bindKeyboard();

    pressArrowKey(fakeDocument, 'ArrowUp');

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].lane, 2);
    assert.strictEqual(results[0].outcome, 'PERFECT');
  } finally {
    global.document = originalDocument;
  }
});

test('ArrowRight (ligado via InputController.bindKeyboard) aciona a lane 3 e acerta somente notas da lane 3', () => {
  const originalDocument = global.document;
  const fakeDocument = makeFakeDocument();
  global.document = fakeDocument;

  try {
    const { timeline, results } = wireLocalPlayer({ getCurrentTime: () => timelineNoteTime(timeline, 3) });
    InputController.bindKeyboard();

    pressArrowKey(fakeDocument, 'ArrowRight');

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].lane, 3);
    assert.strictEqual(results[0].outcome, 'PERFECT');
  } finally {
    global.document = originalDocument;
  }
});

test('ArrowLeft NAO acerta uma nota que esta na lane 2 ou 3 mesmo pressionada exatamente no tempo delas', () => {
  const originalDocument = global.document;
  const fakeDocument = makeFakeDocument();
  global.document = fakeDocument;

  try {
    const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
    const laneTwoNote = timeline.find((n) => n.lane === 2);
    const { results } = wireLocalPlayer({ getCurrentTime: () => laneTwoNote.time });
    InputController.bindKeyboard();

    pressArrowKey(fakeDocument, 'ArrowLeft'); // lane 1, mas so ha nota de lane 2 nesse instante

    assert.strictEqual(results[0].outcome, 'MISTAKE');
    assert.strictEqual(laneTwoNote.state, NoteEngine.NOTE_STATE.PENDING, 'a nota da lane 2 nao pode ter sido afetada por um input de lane 1');
  } finally {
    global.document = originalDocument;
  }
});

function timelineNoteTime(timeline, lane) {
  const note = timeline.find((n) => n.lane === lane);
  if (!note) throw new Error(`timeline de teste sem nenhuma nota na lane ${lane}`);
  return note.time;
}

// ---------------------------------------------------------------------
// 4. PERFECT via input real -------------------------------------------
// ---------------------------------------------------------------------
test('input exatamente no tempo da nota (via triggerLane) gera PERFECT', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const note = timeline.find((n) => n.lane === 1); // note-42-4, time 1002400
  const { results, playerState } = wireLocalPlayer({ getCurrentTime: () => note.time });

  InputController.triggerLane(note.lane);

  assert.strictEqual(results[0].outcome, 'PERFECT');
  assert.strictEqual(playerState.score, SCORE_VALUES.PERFECT);
});

// ---------------------------------------------------------------------
// 5. GOOD via input real -------------------------------------------------
// ---------------------------------------------------------------------
test('input com atraso dentro da janela GOOD (fora da PERFECT) gera GOOD', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const note = timeline.find((n) => n.lane === 1);
  // 100ms de atraso: > perfectMs (60) e <= goodMs (150), mesmas janelas
  // ja configuradas (WINDOWS), nenhuma janela nova criada aqui.
  const { results, playerState } = wireLocalPlayer({ getCurrentTime: () => note.time + 100 });

  InputController.triggerLane(note.lane);

  assert.strictEqual(results[0].outcome, 'GOOD');
  assert.strictEqual(playerState.score, SCORE_VALUES.GOOD);
});

// ---------------------------------------------------------------------
// 6. Tecla errada -> MISTAKE ----------------------------------------------
// ---------------------------------------------------------------------
test('lane sem nenhuma nota candidata gera MISTAKE (nao MISS) e zera combo', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const note = timeline.find((n) => n.lane === 1);
  const { results, playerState } = wireLocalPlayer({ getCurrentTime: () => note.time + 10_000 });

  InputController.triggerLane(note.lane);

  assert.strictEqual(results[0].outcome, 'MISTAKE');
  assert.strictEqual(playerState.mistakes, 1);
  assert.strictEqual(playerState.misses, 0);
  assert.strictEqual(playerState.combo, 0);
});

// ---------------------------------------------------------------------
// 7. Fora da janela, mesmo na lane certa -> nao acerta -------------------
// ---------------------------------------------------------------------
test('input na lane certa porem fora da janela goodMs nao acerta a nota (MISTAKE)', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const note = timeline.find((n) => n.lane === 1);
  const { results, playerState } = wireLocalPlayer({ getCurrentTime: () => note.time + WINDOWS.goodMs + 1 });

  InputController.triggerLane(note.lane);

  assert.strictEqual(results[0].outcome, 'MISTAKE');
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.PENDING);
});

// ---------------------------------------------------------------------
// 8. Nota ja acertada nao pode ser acertada de novo -----------------------
// ---------------------------------------------------------------------
test('pressionar a mesma lane duas vezes no mesmo instante so acerta a nota uma vez', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const note = timeline.find((n) => n.lane === 1);
  const { results, playerState } = wireLocalPlayer({ getCurrentTime: () => note.time });

  InputController.triggerLane(note.lane);
  InputController.triggerLane(note.lane); // segunda tentativa, mesma nota ja terminal

  assert.strictEqual(results[0].outcome, 'PERFECT');
  assert.strictEqual(results[1].outcome, 'MISTAKE');
  assert.strictEqual(playerState.hits, 1, 'hits nao pode duplicar');
  assert.strictEqual(playerState.score, SCORE_VALUES.PERFECT, 'score nao pode duplicar');
});

// ---------------------------------------------------------------------
// 9-10. Score e combo atualizados corretamente com varios acertos --------
// ---------------------------------------------------------------------
test('score e combo acumulam corretamente ao longo de varios acertos via input real', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  let currentTime = timeline[0].time;
  const { results, playerState } = wireLocalPlayer({ getCurrentTime: () => currentTime });

  // Acerta as 3 primeiras notas da timeline em sequencia (lanes 2,2,3 -- ver seed 42).
  for (let i = 0; i < 3; i++) {
    currentTime = timeline[i].time;
    InputController.triggerLane(timeline[i].lane);
  }

  assert.strictEqual(results.length, 3);
  assert.ok(results.every((r) => ['PERFECT', 'GOOD'].includes(r.outcome)));
  assert.strictEqual(playerState.hits, 3);
  assert.strictEqual(playerState.combo, 3);
  assert.strictEqual(playerState.maxCombo, 3);
  assert.strictEqual(playerState.score, SCORE_VALUES.PERFECT * 3);

  // Um erro em seguida zera o combo mas nao o score/hits ja ganhos.
  currentTime = timeline[3].time + 10_000;
  InputController.triggerLane(timeline[3].lane);

  assert.strictEqual(playerState.combo, 0);
  assert.strictEqual(playerState.maxCombo, 3);
  assert.strictEqual(playerState.hits, 3);
  assert.strictEqual(playerState.score, SCORE_VALUES.PERFECT * 3);
});

// ---------------------------------------------------------------------
// 11. note_hit enviado somente uma vez por nota ---------------------------
// ---------------------------------------------------------------------
test('evento note_hit e enviado exatamente uma vez por nota acertada, mesmo com tentativas repetidas', () => {
  const events = [];
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const note = timeline.find((n) => n.lane === 1);
  const { results } = wireLocalPlayer({ getCurrentTime: () => note.time, events });

  InputController.triggerLane(note.lane);
  InputController.triggerLane(note.lane);
  InputController.triggerLane(note.lane);

  const noteHitEvents = events.filter((e) => e.type === 'note_hit' && e.payload.noteId === note.id);
  assert.strictEqual(noteHitEvents.length, 1, 'note_hit so pode ser enviado uma vez para a mesma nota');
  assert.strictEqual(results[0].outcome, 'PERFECT');
  assert.strictEqual(results[1].outcome, 'MISTAKE');
  assert.strictEqual(results[2].outcome, 'MISTAKE');
});

test('MISTAKE (tecla errada/fora da janela) nunca gera evento note_hit', () => {
  const events = [];
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const note = timeline.find((n) => n.lane === 1);
  wireLocalPlayer({ getCurrentTime: () => note.time + 10_000, events });

  InputController.triggerLane(note.lane);

  assert.strictEqual(events.length, 0);
});

// ---------------------------------------------------------------------
// 12. Dois jogadores continuam com estados independentes ------------------
// ---------------------------------------------------------------------
test('dois jogadores (duas timelines/engines) tem estados independentes mesmo revezando o mesmo InputController', () => {
  const timelineP1 = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const timelineP2 = NoteEngine.generateNoteTimeline(BASE_PARAMS); // mesma seed -> mesma timeline, como nos dois clientes reais

  const player1State = PlayerState.createPlayerState();
  const player2State = PlayerState.createPlayerState();
  const eventsP1 = [];
  const eventsP2 = [];

  const engineP1 = GameplayEngine.createGameplayEngine({
    timeline: timelineP1,
    playerState: player1State,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    sendEvent: (type, payload) => eventsP1.push({ type, payload }),
  });
  const engineP2 = GameplayEngine.createGameplayEngine({
    timeline: timelineP2,
    playerState: player2State,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    sendEvent: (type, payload) => eventsP2.push({ type, payload }),
  });

  const noteP1 = timelineP1.find((n) => n.lane === 1);
  // Simula o InputController deste NAVEGADOR (o do player1) mandando a lane pro engine local dele.
  InputController.setLaneHandler((lane) => engineP1.handleKeyPress(lane, noteP1.time));
  InputController.triggerLane(noteP1.lane);

  assert.strictEqual(player1State.hits, 1);
  assert.strictEqual(player1State.score, SCORE_VALUES.PERFECT);
  assert.strictEqual(eventsP1.length, 1);

  // O jogador 2 nao foi tocado (nenhuma segunda instancia de GameplayEngine
  // local existe no mesmo cliente -- exatamente a garantia de main.js).
  assert.strictEqual(player2State.hits, 0);
  assert.strictEqual(player2State.score, 0);
  assert.strictEqual(eventsP2.length, 0);
  assert.strictEqual(timelineP2.find((n) => n.id === noteP1.id).state, NoteEngine.NOTE_STATE.PENDING);

  // Troca o handler para simular o InputController do OUTRO navegador
  // (o do player2) -- outra instancia de cliente, nunca o mesmo estado.
  const noteP2 = timelineP2.find((n) => n.lane === 2);
  InputController.setLaneHandler((lane) => engineP2.handleKeyPress(lane, noteP2.time));
  InputController.triggerLane(noteP2.lane);

  assert.strictEqual(player2State.hits, 1);
  assert.strictEqual(player1State.hits, 1, 'acao do player2 nao pode alterar o estado do player1');
});

// ---------------------------------------------------------------------
// 13. Julgamento usa o relogio sincronizado, nao o horario bruto de chegada
// ---------------------------------------------------------------------
test('julgamento usa o tempo sincronizado (offset aplicado), nao Date.now() puro do navegador', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const note = timeline.find((n) => n.lane === 1);

  // Relogio local (sem sincronizar) esta adiantado 5s em relacao ao
  // servidor -- se o julgamento usasse Date.now() puro, o input pareceria
  // ter chegado 5s tarde demais (MISTAKE). O clockOffset (mesma formula
  // usada por MatchController/NoteRenderer: serverTime - Date.now())
  // corrige isso para o relogio sincronizado da partida.
  const localNow = note.time + 5000;
  const clockOffsetMs = -5000; // relogio local 5s "na frente" do servidor
  const getSyncedNow = () => localNow + clockOffsetMs;

  assert.strictEqual(getSyncedNow(), note.time, 'pre-condicao: o tempo sincronizado deve cair exatamente no tempo da nota');

  const { results } = wireLocalPlayer({ getCurrentTime: getSyncedNow });
  InputController.triggerLane(note.lane);

  assert.strictEqual(results[0].outcome, 'PERFECT', 'com o offset aplicado o julgamento deveria ser PERFECT');

  // Sem aplicar o offset (usando o relogio bruto local), o mesmo input
  // teria sido julgado MISTAKE -- prova de que o offset faz diferenca real.
  const timelineSemOffset = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const noteSemOffset = timelineSemOffset.find((n) => n.lane === 1);
  const { results: resultsSemOffset } = wireLocalPlayer({ getCurrentTime: () => noteSemOffset.time + 5000 });
  InputController.triggerLane(noteSemOffset.lane);
  assert.strictEqual(resultsSemOffset[0].outcome, 'MISTAKE');
});

console.log(`\n${passed} teste(s) passaram.`);
