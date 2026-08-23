/**
 * Testes automatizados da nova mecanica de setas (Etapa 13B).
 *
 * Nao recria nenhum modulo novo: so exercita a MESMA arquitetura ja
 * existente (NoteEngine + Judgement + GameplayEngine + InputController +
 * NoteRenderer + ClientConfig), com os valores de configuracao desta
 * etapa (janela de julgamento cobrindo o percurso inteiro da seta), para
 * provar que:
 *
 *   seta aparece -> desce -> pode ser acertada durante TODO o percurso ->
 *   tecla correta conclui -> tecla errada/perda registra erro ->
 *   proxima seta continua -- exatamente como pedido no enunciado.
 *
 * Executar com: node tests/newArrowMechanic13B.test.js
 */
const assert = require('assert');
const ClientConfig = require('../client/js/config');
const NoteEngine = require('../client/js/match/noteEngine');
const PlayerState = require('../client/js/match/playerState');
const Judgement = require('../client/js/match/judgement');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const InputController = require('../client/js/input/inputController');
const NoteRenderer = require('../client/js/render/noteRenderer');

// Usa exatamente os MESMOS valores que main.js le de ClientConfig para
// ligar NoteRenderer/GameplayEngine numa partida real -- garante que o
// teste reflete o comportamento de producao, nao um cenario artificial.
const WINDOWS = {
  perfectMs: ClientConfig.JUDGEMENT_WINDOWS.PERFECT_MS,
  goodMs: ClientConfig.JUDGEMENT_WINDOWS.GOOD_MS,
};
const SCORE_VALUES = ClientConfig.SCORE_VALUES;
const HIT_WINDOW_MS = ClientConfig.NOTE_HIT_WINDOW_MS;

const BASE_PARAMS = {
  seed: 13024,
  startTimestamp: 2_000_000,
  length: 8,
  noteRange: 3, // 1=esquerda, 2=cima, 3=direita
  noteIntervalMs: 600,
  leadInMs: 0,
};

let passed = 0;
function test(name, fn) {
  try {
    InputController.setLaneHandler(null);
    fn();
    passed++;
    console.log(`OK   - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function makeEngine() {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const playerState = PlayerState.createPlayerState();
  const events = [];
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    sendEvent: (type, payload) => events.push({ type, payload }),
  });
  return { timeline, playerState, engine, events };
}

function spawnTimeOf(note) {
  return note.time - ClientConfig.NOTE_TRAVEL_MS;
}

// ---------------------------------------------------------------------
// 1. A seta "aparece": NoteRenderer sabe que deve criar o elemento assim
//    que o instante de nascimento chega (mesmo instante usado pelo
//    NoteEngine para comecar a janela de julgamento -- os dois usam
//    ClientConfig.NOTE_TRAVEL_MS/NOTE_HIT_WINDOW_MS, o MESMO valor).
// ---------------------------------------------------------------------
test('a seta aparece (spawn) exatamente quando comeca a poder ser julgada', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const note = timeline[0];
  const spawnTime = spawnTimeOf(note);

  assert.strictEqual(
    ClientConfig.NOTE_TRAVEL_MS,
    ClientConfig.NOTE_HIT_WINDOW_MS,
    'travel visual e janela logica precisam ser o MESMO numero, senao a seta pareceria acertavel so numa parte da queda'
  );

  assert.strictEqual(
    NoteRenderer._internal.shouldSpawnNote(note, spawnTime, ClientConfig.NOTE_TRAVEL_MS, 0),
    true
  );

  NoteEngine.updateTimelineStates(timeline, spawnTime, HIT_WINDOW_MS);
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.ACTIVE, 'a seta ja deve estar active assim que nasce');
});

// ---------------------------------------------------------------------
// 2. A seta "se move": a posicao visual cresce de 0% a HIT_LINE_PERCENT%
//    conforme o tempo avanca do spawn ate note.time (velocidade/duracao
//    preservada: NOTE_TRAVEL_MS continua o mesmo valor de antes).
// ---------------------------------------------------------------------
test('a seta se move (progresso/posicao crescem de forma continua durante a queda)', () => {
  const note = { id: 'x', index: 0, lane: 1, time: 20_000, state: NoteEngine.NOTE_STATE.PENDING };
  const travelMs = ClientConfig.NOTE_TRAVEL_MS;
  const spawnTime = note.time - travelMs;
  const midTime = spawnTime + travelMs / 2;

  const progressAtSpawn = NoteRenderer._internal.computeProgress(note, spawnTime, travelMs);
  const progressAtMid = NoteRenderer._internal.computeProgress(note, midTime, travelMs);
  const progressAtEnd = NoteRenderer._internal.computeProgress(note, note.time, travelMs);

  assert.strictEqual(progressAtSpawn, 0);
  assert.ok(Math.abs(progressAtMid - 0.5) < 0.0001);
  assert.strictEqual(progressAtEnd, 1);
  assert.ok(progressAtSpawn < progressAtMid && progressAtMid < progressAtEnd, 'a posicao deve avancar de forma monotonica');
});

// ---------------------------------------------------------------------
// 3. Tecla correta acerta em QUALQUER momento da queda -- inicio, meio
//    e quase no final -- sem precisar esperar uma "area de acerto".
// ---------------------------------------------------------------------
['inicio', 'meio', 'quase no final'].forEach((momento, i) => {
  test(`tecla correta acerta a seta pressionada no ${momento} do percurso (sem esperar chegar numa area)`, () => {
    const { timeline, engine, playerState } = makeEngine();
    const note = timeline[0];
    const spawnTime = spawnTimeOf(note);

    const attemptTime =
      i === 0
        ? spawnTime + 20 // logo apos nascer
        : i === 1
        ? spawnTime + ClientConfig.NOTE_TRAVEL_MS / 2 // no meio da queda
        : note.time - 20; // quase chegando ao final

    const result = engine.handleKeyPress(note.lane, attemptTime);

    assert.ok(['PERFECT', 'GOOD'].includes(result.outcome), `deveria acertar no ${momento}, recebeu ${result.outcome}`);
    assert.strictEqual(note.state, NoteEngine.NOTE_STATE.HIT);
    assert.strictEqual(playerState.hits, 1);
  });
});

// ---------------------------------------------------------------------
// 4. Tecla errada (lane diferente da esperada) nunca acerta -- mesma
//    estrutura de erro que ja existia (registerMistake), sem pontuacao
//    nova nesta etapa.
// ---------------------------------------------------------------------
test('tecla errada (lane sem nenhuma seta candidata) e tratada como erro (MISTAKE), nunca acerta', () => {
  const { timeline, engine, playerState } = makeEngine();
  const expected = timeline[0]; // primeira seta da sequencia
  // noteRange=3 nesta timeline (lanes 1..3): lane 99 nunca existe,
  // entao nunca ha candidato -- garante um erro "puro", sem depender
  // de outra seta legitima estar ativa nessa lane no mesmo instante.
  const result = engine.handleKeyPress(99, expected.time - 100);

  assert.strictEqual(result.outcome, 'MISTAKE');
  assert.strictEqual(playerState.mistakes, 1);
  assert.strictEqual(playerState.misses, 0, 'tecla errada e MISTAKE, nao MISS de seta');
});

test('pressionar a lane errada nunca marca a seta esperada de outra lane como acertada', () => {
  const { timeline, engine } = makeEngine();
  const expected = timeline[0]; // primeira seta da sequencia
  const wrongLane = [1, 2, 3].find((lane) => lane !== expected.lane);

  engine.handleKeyPress(wrongLane, expected.time - 100);

  // Seja qual for o resultado do input na lane errada (pode ate acertar
  // OUTRA seta legitima que esteja ativa nessa lane ao mesmo tempo), a
  // seta ESPERADA (de outra lane) nunca pode ter sido tocada por ele --
  // cada lane so e afetada pela sua propria tecla.
  assert.notStrictEqual(expected.state, NoteEngine.NOTE_STATE.HIT);
});

// ---------------------------------------------------------------------
// 5. Seta perdida: chega ao final do percurso sem input -> vira missed,
//    e removida (isTerminal), sem penalizar pontuacao nesta etapa.
// ---------------------------------------------------------------------
test('seta perdida (chega ao final sem input) e registrada como perdida e some da tela', () => {
  const { timeline, engine, playerState } = makeEngine();
  const note = timeline[0];

  const missed = engine.processExpiredNotes(note.time + 1, HIT_WINDOW_MS);

  assert.strictEqual(missed.length, 1);
  assert.strictEqual(missed[0].id, note.id);
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.MISSED);
  assert.strictEqual(playerState.misses, 1);
  assert.strictEqual(playerState.score, 0, 'sem pontuacao nova nesta etapa');

  // NoteRenderer sabe que pode remover o elemento assim que o estado
  // vira terminal (missed), sem esperar mais nada.
  assert.strictEqual(
    NoteRenderer._internal.shouldRemoveNote(note, note.time + 1, HIT_WINDOW_MS, ClientConfig.NOTE_TRAVEL_MS, NoteEngine.isTerminal),
    true
  );
});

test('a seta NAO e considerada perdida antes de chegar ao final do percurso, mesmo perto do fim', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const note = timeline[0];

  NoteEngine.updateTimelineStates(timeline, note.time - 1, HIT_WINDOW_MS);
  assert.notStrictEqual(note.state, NoteEngine.NOTE_STATE.MISSED, 'um instante antes do final ainda deve poder ser acertada');
});

// ---------------------------------------------------------------------
// 6. Depois do acerto a seta e removida (estado terminal HIT) e nao
//    pode ser processada de novo.
// ---------------------------------------------------------------------
test('seta e concluida/removida (estado terminal) apos o acerto, e nao pode ser reprocessada', () => {
  const { timeline, engine } = makeEngine();
  const note = timeline[0];

  const first = engine.handleKeyPress(note.lane, note.time - 500);
  assert.ok(['PERFECT', 'GOOD'].includes(first.outcome));
  assert.strictEqual(NoteEngine.isTerminal(note.state), true);

  const second = engine.handleKeyPress(note.lane, note.time - 400);
  assert.strictEqual(second.outcome, 'MISTAKE', 'a mesma seta ja concluida nao pode ser acertada de novo');
});

// ---------------------------------------------------------------------
// 7. A sequencia/ordem continua sendo respeitada: com a nova janela
//    larga, se a MESMA lane tiver duas setas em voo ao mesmo tempo, o
//    jogador sempre resolve a mais ANTIGA primeiro (ordem original da
//    sequencia preservada -- item 2 do enunciado).
// ---------------------------------------------------------------------
test('com duas setas da MESMA lane em voo ao mesmo tempo, o acerto resolve sempre a mais antiga primeiro', () => {
  // noteIntervalMs=600, NOTE_TRAVEL_MS=1800 -> ate 3 setas em voo ao
  // mesmo tempo. Monta timeline sintetica com a MESMA lane em index 0 e
  // index 2 (1200ms de distancia, ambas ainda dentro da janela).
  const timeline = [
    { id: 'note-a', index: 0, lane: 1, time: 20_000, state: NoteEngine.NOTE_STATE.PENDING },
    { id: 'note-b', index: 1, lane: 2, time: 20_600, state: NoteEngine.NOTE_STATE.PENDING },
    { id: 'note-c', index: 2, lane: 1, time: 21_200, state: NoteEngine.NOTE_STATE.PENDING },
  ];

  // No instante 20_700, as duas setas da lane 1 (note-a e note-c) ja
  // nasceram e ainda nao expiraram -> ambas sao candidatas validas.
  const currentTime = 20_700;
  const candidate = Judgement.findJudgeableNote(timeline, 1, currentTime, WINDOWS);

  assert.ok(candidate, 'deveria encontrar uma nota candidata na lane 1');
  assert.strictEqual(candidate.id, 'note-a', 'a seta mais antiga (index menor) deve ser resolvida primeiro, respeitando a ordem original');
});

test('depois de resolver a seta mais antiga, a proxima da mesma lane passa a ser a candidata', () => {
  const { timeline, engine } = makeEngine();
  // Procura duas setas da mesma lane na timeline gerada (se existirem).
  const lanesSeen = {};
  timeline.forEach((n) => {
    lanesSeen[n.lane] = lanesSeen[n.lane] || [];
    lanesSeen[n.lane].push(n);
  });
  const laneWithTwo = Object.values(lanesSeen).find((arr) => arr.length >= 2);
  if (!laneWithTwo) return; // seed nao produziu repeticao de lane; nada a validar aqui

  const [first, second] = laneWithTwo;
  engine.handleKeyPress(first.lane, first.time - 100);
  assert.strictEqual(first.state, NoteEngine.NOTE_STATE.HIT);

  const result = engine.handleKeyPress(second.lane, second.time - 100);
  assert.ok(['PERFECT', 'GOOD'].includes(result.outcome));
  assert.strictEqual(result.noteId, second.id, 'apos a primeira ser resolvida, a proxima da sequencia passa a ser julgada');
});

// ---------------------------------------------------------------------
// 8. A sequencia continua normalmente apos acerto/erro (proxima seta
//    de OUTRA lane nao e afetada).
// ---------------------------------------------------------------------
test('a sequencia continua apos acerto/erro: outras setas/lanes nao sao afetadas', () => {
  const { timeline, engine, playerState } = makeEngine();
  const note0 = timeline[0];
  const note1 = timeline[1];

  engine.handleKeyPress(note0.lane, note0.time - 200);
  assert.strictEqual(playerState.hits, 1);

  // um erro proposital (lane errada) nao deve afetar note1.
  const wrongLane = [1, 2, 3].find((lane) => lane !== note1.lane);
  engine.handleKeyPress(wrongLane, note1.time - 200);

  assert.notStrictEqual(note1.state, NoteEngine.NOTE_STATE.HIT);
  assert.notStrictEqual(note1.state, NoteEngine.NOTE_STATE.MISSED);

  // note1 continua podendo ser acertada normalmente depois.
  const result = engine.handleKeyPress(note1.lane, note1.time - 100);
  assert.ok(['PERFECT', 'GOOD'].includes(result.outcome));
  assert.strictEqual(note1.state, NoteEngine.NOTE_STATE.HIT);
});

// ---------------------------------------------------------------------
// 9. Controles existentes (teclado real via InputController) continuam
//    funcionando exatamente como antes -- so a JANELA de julgamento
//    mudou, o caminho de entrada e o mesmo.
// ---------------------------------------------------------------------
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

test('controles de teclado existentes (InputController.bindKeyboard) continuam acertando setas cedo, no meio, ou perto do final', () => {
  const originalDocument = global.document;
  const fakeDocument = makeFakeDocument();
  global.document = fakeDocument;

  try {
    const { timeline, engine } = makeEngine();
    const note = timeline.find((n) => n.lane === 1) || timeline[0];
    const keyForLane = { 1: 'ArrowLeft', 2: 'ArrowUp', 3: 'ArrowRight' }[note.lane];

    InputController.setLaneHandler((lane) => engine.handleKeyPress(lane, spawnTimeOf(note) + 50));
    InputController.bindKeyboard();

    fakeDocument._dispatch('keydown', { key: keyForLane, repeat: false, target: {}, preventDefault() {} });

    assert.strictEqual(note.state, NoteEngine.NOTE_STATE.HIT, 'pressionar bem no inicio da queda (via teclado real) deveria acertar');
  } finally {
    global.document = originalDocument;
  }
});

test('controles de toque existentes (InputController.triggerLane, usado pelos botoes mobile) continuam funcionando', () => {
  const { timeline, engine } = makeEngine();
  const note = timeline[0];

  InputController.setLaneHandler((lane) => engine.handleKeyPress(lane, note.time - 300));
  InputController.triggerLane(note.lane);

  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.HIT, 'toque (mesmo caminho logico do teclado) deveria acertar a seta durante a queda');
});

console.log(`\n${passed} teste(s) passaram.`);
