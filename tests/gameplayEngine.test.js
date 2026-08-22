/**
 * Testes automatizados da camada de gameplay (Etapa 4B):
 * julgamento (PERFECT/GOOD/erro), MISS por expiracao, combo, maior
 * combo, pontuacao e isolamento entre estados de jogadores diferentes.
 *
 * Executar com: node tests/gameplayEngine.test.js
 */
const assert = require('assert');
const NoteEngine = require('../client/js/match/noteEngine');
const PlayerState = require('../client/js/match/playerState');
const Judgement = require('../client/js/match/judgement');
const GameplayEngine = require('../client/js/match/gameplayEngine');

const WINDOWS = { perfectMs: 60, goodMs: 150 };
const SCORE_VALUES = { PERFECT: 300, GOOD: 100, MISS: 0 };
const HIT_WINDOW_MS = 150; // igual a windows.goodMs, como recomendado no config

const BASE_PARAMS = {
  seed: 42,
  startTimestamp: 1_000_000,
  length: 8,
  noteRange: 3, // 3 lanes: 1=esquerda, 2=cima, 3=direita
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

function makeEngine(events) {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    sendEvent: (type, payload) => events && events.push({ type, payload }),
  });
  return { timeline, playerState, engine };
}

// 1. PERFECT ------------------------------------------------------------
test('acerto exatamente no tempo da nota resulta em PERFECT e pontua o valor configurado', () => {
  const events = [];
  const { timeline, playerState, engine } = makeEngine(events);
  const note = timeline[0];

  const result = engine.handleKeyPress(note.lane, note.time);

  assert.strictEqual(result.outcome, 'PERFECT');
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.HIT);
  assert.strictEqual(playerState.score, SCORE_VALUES.PERFECT);
  assert.strictEqual(playerState.hits, 1);
  assert.strictEqual(playerState.combo, 1);
  assert.strictEqual(playerState.maxCombo, 1);

  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'note_hit');
  assert.strictEqual(events[0].payload.judgement, 'PERFECT');
  assert.strictEqual(events[0].payload.noteId, note.id);
});

// 2. GOOD -----------------------------------------------------------------
test('acerto dentro da janela GOOD (fora da PERFECT) resulta em GOOD e pontua menos', () => {
  const { timeline, playerState, engine } = makeEngine();
  const note = timeline[0];
  // 100ms de atraso: > perfectMs (60) e <= goodMs (150).
  const attemptTime = note.time + 100;

  const result = engine.handleKeyPress(note.lane, attemptTime);

  assert.strictEqual(result.outcome, 'GOOD');
  assert.strictEqual(playerState.score, SCORE_VALUES.GOOD);
  assert.ok(SCORE_VALUES.GOOD < SCORE_VALUES.PERFECT, 'GOOD deve valer menos que PERFECT');
  assert.strictEqual(playerState.hits, 1);
  assert.strictEqual(playerState.combo, 1);
});

// 3. MISS (nota expira sem ser atingida) -----------------------------------
test('nota que passa do tempo maximo sem input vira MISS automaticamente', () => {
  const events = [];
  const { timeline, playerState, engine } = makeEngine(events);
  const note = timeline[0];

  const missed = engine.processExpiredNotes(note.time + HIT_WINDOW_MS + 1, HIT_WINDOW_MS);

  assert.strictEqual(missed.length, 1);
  assert.strictEqual(missed[0].id, note.id);
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.MISSED);
  assert.strictEqual(playerState.misses, 1);
  assert.strictEqual(playerState.score, 0, 'MISS nao deve pontuar');
  assert.strictEqual(playerState.combo, 0);

  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'note_miss');
  assert.strictEqual(events[0].payload.noteId, note.id);
});

// 4. Erro (tecla errada ou fora da janela valida) ---------------------------
test('tecla sem nenhuma nota candidata na janela registra erro (mistake), nao MISS', () => {
  const { timeline, playerState, engine } = makeEngine();
  const note = timeline[0];

  // Muito longe de qualquer nota nessa lane -> nao ha candidato.
  const result = engine.handleKeyPress(note.lane, note.time + 10_000);

  assert.strictEqual(result.outcome, 'MISTAKE');
  assert.strictEqual(result.noteId, null);
  assert.strictEqual(playerState.mistakes, 1);
  assert.strictEqual(playerState.misses, 0, 'erro de tecla nao deve contar como MISS de nota');
  assert.strictEqual(playerState.combo, 0);
  assert.strictEqual(playerState.score, 0);
  // Nenhuma nota deve ter sido alterada por um erro sem nota associada.
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.PENDING);
});

test('pressionar uma lane sem nenhuma nota nela conta como erro', () => {
  const { engine, playerState } = makeEngine();
  // noteRange=3, entao lane 99 nunca existe na sequencia.
  const result = engine.handleKeyPress(99, BASE_PARAMS.startTimestamp);

  assert.strictEqual(result.outcome, 'MISTAKE');
  assert.strictEqual(playerState.mistakes, 1);
});

// 5. Combo e maior combo ----------------------------------------------------
test('combo cresce a cada acerto e zera em erro/miss; maxCombo guarda o pico', () => {
  const { timeline, playerState, engine } = makeEngine();

  // Acerta as 3 primeiras notas em sequencia (todas em suas proprias lanes/tempos).
  for (let i = 0; i < 3; i++) {
    const note = timeline[i];
    const result = engine.handleKeyPress(note.lane, note.time);
    assert.ok(['PERFECT', 'GOOD'].includes(result.outcome));
  }
  assert.strictEqual(playerState.combo, 3);
  assert.strictEqual(playerState.maxCombo, 3);

  // Erro derruba o combo.
  engine.handleKeyPress(timeline[3].lane, timeline[3].time + 10_000);
  assert.strictEqual(playerState.combo, 0);
  assert.strictEqual(playerState.maxCombo, 3, 'maxCombo nao pode diminuir');

  // Acerta mais uma nota: combo volta a subir a partir de 0, maxCombo nao muda ainda.
  const note4 = timeline[4];
  engine.handleKeyPress(note4.lane, note4.time);
  assert.strictEqual(playerState.combo, 1);
  assert.strictEqual(playerState.maxCombo, 3);
});

// 6. Pontuacao configuravel ---------------------------------------------------
test('valores de pontuacao sao lidos da configuracao (scoreValues), nao fixos no codigo', () => {
  const customScoreValues = { PERFECT: 1000, GOOD: 1, MISS: 0 };
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: customScoreValues,
  });

  const note = timeline[0];
  engine.handleKeyPress(note.lane, note.time);

  assert.strictEqual(playerState.score, 1000);
});

// 7. Comunicacao entre os dois jogadores (isolamento de estado local) --------
test('dois jogadores tem estados independentes: acao de um nao muda o do outro', () => {
  const timelineP1 = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const timelineP2 = NoteEngine.generateNoteTimeline(BASE_PARAMS); // mesma seed -> mesma timeline

  const player1State = PlayerState.createPlayerState();
  const player2State = PlayerState.createPlayerState();

  const engineP1 = GameplayEngine.createGameplayEngine({
    timeline: timelineP1,
    playerState: player1State,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
  });
  const engineP2 = GameplayEngine.createGameplayEngine({
    timeline: timelineP2,
    playerState: player2State,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
  });

  const noteP1 = timelineP1[0];
  engineP1.handleKeyPress(noteP1.lane, noteP1.time);

  assert.strictEqual(player1State.hits, 1);
  assert.strictEqual(player1State.score, SCORE_VALUES.PERFECT);

  // Player 2 nao foi tocado: seu estado e sua timeline continuam intactos.
  assert.strictEqual(player2State.hits, 0);
  assert.strictEqual(player2State.score, 0);
  assert.strictEqual(timelineP2[0].state, NoteEngine.NOTE_STATE.PENDING);

  // Player2 age na sua propria timeline/estado.
  const noteP2 = timelineP2[1];
  engineP2.handleKeyPress(noteP2.lane, noteP2.time);
  assert.strictEqual(player2State.hits, 1);
  assert.strictEqual(player1State.hits, 1, 'acao do player2 nao pode alterar o estado do player1');
});

// 8. Mesma nota nao pode ser processada duas vezes ---------------------------
test('a mesma nota nao pode ser processada duas vezes via handleKeyPress', () => {
  const events = [];
  const { timeline, playerState, engine } = makeEngine(events);
  const note = timeline[0];

  const first = engine.handleKeyPress(note.lane, note.time);
  assert.ok(['PERFECT', 'GOOD'].includes(first.outcome));
  assert.strictEqual(playerState.hits, 1);
  assert.strictEqual(playerState.score, SCORE_VALUES.PERFECT);

  // Tenta acertar a MESMA nota de novo (jogador aperta a tecla outra vez
  // no mesmo instante). A nota ja esta "hit" (estado terminal), entao
  // findJudgeableNote nao a encontra mais -> vira erro, sem duplicar hit/score.
  const second = engine.handleKeyPress(note.lane, note.time);

  assert.strictEqual(second.outcome, 'MISTAKE');
  assert.strictEqual(playerState.hits, 1, 'hits nao pode duplicar');
  assert.strictEqual(playerState.score, SCORE_VALUES.PERFECT, 'score nao pode duplicar');
  assert.strictEqual(playerState.mistakes, 1);

  // Confirma tambem no nivel do NoteEngine: setNoteState direto rejeita.
  assert.strictEqual(NoteEngine.setNoteState(timeline, note.id, NoteEngine.NOTE_STATE.HIT), false);
});

test('uma nota ja MISS (expirada) nao pode depois virar HIT', () => {
  const { timeline, playerState, engine } = makeEngine();
  const note = timeline[0];

  engine.processExpiredNotes(note.time + HIT_WINDOW_MS + 1, HIT_WINDOW_MS);
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.MISSED);

  // Jogador tenta acertar mesmo assim, atrasado.
  const attempt = engine.handleKeyPress(note.lane, note.time + HIT_WINDOW_MS + 5);
  assert.strictEqual(attempt.outcome, 'MISTAKE');
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.MISSED, 'nota MISS nao pode virar HIT depois');
  assert.strictEqual(playerState.hits, 0);
});

console.log(`\n${passed} teste(s) passaram.`);
