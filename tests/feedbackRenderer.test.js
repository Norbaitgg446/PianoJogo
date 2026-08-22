/**
 * Testes automatizados do feedback visual dos julgamentos (Etapa 5B-3B).
 *
 * FeedbackRenderer so toca em `document`/DOM dentro das funcoes
 * publicas (nunca no carregamento do modulo), entao da para testar
 * tudo em Node puro com um `document` "falso" minimo (duck-typing de
 * getElementById/classList/textContent), sem jsdom nem navegador de
 * verdade -- mesmo estilo ja usado em tests/inputController.test.js e
 * tests/laneInputIntegration.test.js.
 *
 * Os timers (setTimeout/clearTimeout) usados pelo auto-hide do
 * feedback tambem sao substituidos por uma versao "falsa" e
 * controlada manualmente (flushAll), para os testes ficarem rapidos e
 * deterministicos em vez de esperar o tempo real passar.
 *
 * Executar com: node tests/feedbackRenderer.test.js
 */
const assert = require('assert');
const NoteEngine = require('../client/js/match/noteEngine');
const PlayerState = require('../client/js/match/playerState');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const FeedbackRenderer = require('../client/js/render/feedbackRenderer');

const { formatScore, formatCombo, valueChanged, JUDGEMENT_LABELS, JUDGEMENT_CLASS, NOTE_FLASH_CLASS } =
  FeedbackRenderer._internal;

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

// ---------------------------------------------------------------------
// DOM falso: elemento minimo com classList (Set) + textContent, e um
// `document.getElementById` que devolve os elementos certos por id.
// ---------------------------------------------------------------------
function makeFakeElement() {
  const classes = new Set();
  return {
    textContent: '',
    offsetWidth: 0, // usado no truque de reflow do FeedbackRenderer
    classList: {
      add: (...cls) => cls.forEach((c) => classes.add(c)),
      remove: (...cls) => cls.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    _classes: classes,
  };
}

function makeFakePlayfield(noteElementsById) {
  return {
    querySelector(selector) {
      const match = /\[data-note-id="([^"]+)"\]/.exec(selector);
      if (!match) return null;
      return noteElementsById[match[1]] || null;
    },
  };
}

/**
 * Monta um `document` falso com os elementos de UM slot
 * (`${slot}-score`, `${slot}-combo`, `${slot}-feedback`,
 * `${slot}-playfield`) mais os de outro slot opcional, para testar
 * isolamento entre jogadores.
 */
function makeFakeDocument(slotsConfig) {
  const elements = {};
  Object.entries(slotsConfig).forEach(([slot, { notes = {} } = {}]) => {
    elements[`${slot}-score`] = makeFakeElement();
    elements[`${slot}-combo`] = makeFakeElement();
    elements[`${slot}-feedback`] = makeFakeElement();
    const noteElements = {};
    Object.keys(notes).forEach((noteId) => {
      noteElements[noteId] = makeFakeElement();
    });
    elements[`${slot}-playfield`] = makeFakePlayfield(noteElements);
    elements[`${slot}-playfield`]._noteElements = noteElements;
  });

  return {
    getElementById: (id) => elements[id] || null,
    _elements: elements,
  };
}

/**
 * Substitui setTimeout/clearTimeout globais por uma versao controlada
 * manualmente enquanto `fn` roda, para os testes de auto-hide nao
 * precisarem esperar o tempo real passar.
 */
function withFakeTimers(fn) {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const scheduled = new Map();
  let nextId = 1;

  global.setTimeout = (cb) => {
    const id = nextId++;
    scheduled.set(id, cb);
    return id;
  };
  global.clearTimeout = (id) => {
    scheduled.delete(id);
  };

  const flushAll = () => {
    const callbacks = Array.from(scheduled.values());
    scheduled.clear();
    callbacks.forEach((cb) => cb());
  };

  try {
    return fn({ flushAll, scheduled });
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
}

function withFakeDocument(slotsConfig, fn) {
  const originalDocument = global.document;
  const fakeDocument = makeFakeDocument(slotsConfig);
  global.document = fakeDocument;
  // Descarta qualquer referencia de DOM cacheada de um teste anterior
  // (de um `document` falso diferente) antes de comecar este teste.
  FeedbackRenderer.reset();
  try {
    return fn(fakeDocument);
  } finally {
    global.document = originalDocument;
  }
}

const WINDOWS = { perfectMs: 60, goodMs: 150 };
const SCORE_VALUES = { PERFECT: 300, GOOD: 100, MISS: 0 };
const BASE_PARAMS = {
  seed: 42,
  startTimestamp: 1_000_000,
  length: 8,
  noteRange: 3,
  noteIntervalMs: 600,
  leadInMs: 0,
};

// ---------------------------------------------------------------------
// 1-4. Cada resultado do GameplayEngine gera o feedback correspondente
// ---------------------------------------------------------------------
test('PERFECT (retornado pelo GameplayEngine) gera o feedback "PERFECT" no slot certo', () => {
  withFakeDocument({ player1: {} }, () => {
    withFakeTimers(() => {
      const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
      const playerState = PlayerState.createPlayerState();
      const engine = GameplayEngine.createGameplayEngine({ timeline, playerState, windows: WINDOWS, scoreValues: SCORE_VALUES });
      const note = timeline[0];

      const result = engine.handleKeyPress(note.lane, note.time);
      assert.strictEqual(result.outcome, 'PERFECT'); // pre-condicao

      FeedbackRenderer.showJudgement('player1', result.outcome);

      const el = document.getElementById('player1-feedback');
      assert.strictEqual(el.textContent, JUDGEMENT_LABELS.PERFECT);
      assert.ok(el.classList.contains(JUDGEMENT_CLASS.PERFECT));
      assert.ok(el.classList.contains('is-visible'));
    });
  });
});

test('GOOD (retornado pelo GameplayEngine) gera o feedback "GOOD", visualmente distinto do PERFECT', () => {
  withFakeDocument({ player1: {} }, () => {
    withFakeTimers(() => {
      const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
      const playerState = PlayerState.createPlayerState();
      const engine = GameplayEngine.createGameplayEngine({ timeline, playerState, windows: WINDOWS, scoreValues: SCORE_VALUES });
      const note = timeline[0];

      const result = engine.handleKeyPress(note.lane, note.time + 100); // dentro da janela GOOD
      assert.strictEqual(result.outcome, 'GOOD');

      FeedbackRenderer.showJudgement('player1', result.outcome);

      const el = document.getElementById('player1-feedback');
      assert.strictEqual(el.textContent, JUDGEMENT_LABELS.GOOD);
      assert.ok(el.classList.contains(JUDGEMENT_CLASS.GOOD));
      assert.notStrictEqual(JUDGEMENT_CLASS.GOOD, JUDGEMENT_CLASS.PERFECT, 'GOOD deve ter uma classe/aparencia diferente do PERFECT');
    });
  });
});

test('MISS (retornado por processExpiredNotes) gera o feedback "MISS"', () => {
  withFakeDocument({ player1: {} }, () => {
    withFakeTimers(() => {
      const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
      const playerState = PlayerState.createPlayerState();
      const engine = GameplayEngine.createGameplayEngine({ timeline, playerState, windows: WINDOWS, scoreValues: SCORE_VALUES });
      const note = timeline[0];

      const missed = engine.processExpiredNotes(note.time + 151, 150);
      assert.strictEqual(missed.length, 1); // pre-condicao

      FeedbackRenderer.showJudgement('player1', 'MISS');

      const el = document.getElementById('player1-feedback');
      assert.strictEqual(el.textContent, JUDGEMENT_LABELS.MISS);
      assert.ok(el.classList.contains(JUDGEMENT_CLASS.MISS));
    });
  });
});

test('MISTAKE (tecla errada/fora da janela) gera um feedback correspondente (ERRO)', () => {
  withFakeDocument({ player1: {} }, () => {
    withFakeTimers(() => {
      const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
      const playerState = PlayerState.createPlayerState();
      const engine = GameplayEngine.createGameplayEngine({ timeline, playerState, windows: WINDOWS, scoreValues: SCORE_VALUES });
      const note = timeline[0];

      const result = engine.handleKeyPress(note.lane, note.time + 10_000);
      assert.strictEqual(result.outcome, 'MISTAKE');

      FeedbackRenderer.showJudgement('player1', result.outcome);

      const el = document.getElementById('player1-feedback');
      assert.ok(el.textContent.length > 0, 'deveria mostrar algum texto para MISTAKE');
      assert.ok(el.classList.contains(JUDGEMENT_CLASS.MISTAKE));
    });
  });
});

// ---------------------------------------------------------------------
// 5-6. Score/combo visuais acompanham os valores reais do PlayerState
// ---------------------------------------------------------------------
test('score visual acompanha o score real acumulado pelo PlayerState', () => {
  withFakeDocument({ player1: {} }, () => {
    const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
    const playerState = PlayerState.createPlayerState();
    const engine = GameplayEngine.createGameplayEngine({ timeline, playerState, windows: WINDOWS, scoreValues: SCORE_VALUES });

    engine.handleKeyPress(timeline[0].lane, timeline[0].time);
    FeedbackRenderer.updateScore('player1', playerState.score);
    assert.strictEqual(document.getElementById('player1-score').textContent, formatScore(SCORE_VALUES.PERFECT));

    engine.handleKeyPress(timeline[1].lane, timeline[1].time);
    FeedbackRenderer.updateScore('player1', playerState.score);
    assert.strictEqual(document.getElementById('player1-score').textContent, formatScore(SCORE_VALUES.PERFECT * 2));
  });
});

test('combo visual acompanha o combo real do PlayerState', () => {
  withFakeDocument({ player1: {} }, () => {
    const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
    const playerState = PlayerState.createPlayerState();
    const engine = GameplayEngine.createGameplayEngine({ timeline, playerState, windows: WINDOWS, scoreValues: SCORE_VALUES });

    engine.handleKeyPress(timeline[0].lane, timeline[0].time);
    FeedbackRenderer.updateCombo('player1', playerState.combo);
    assert.strictEqual(document.getElementById('player1-combo').textContent, formatCombo(1));
  });
});

// ---------------------------------------------------------------------
// 7. Combo atualizado quando aumenta -----------------------------------
// ---------------------------------------------------------------------
test('combo visual sobe a cada acerto sucessivo (1, 2, 3...)', () => {
  withFakeDocument({ player1: {} }, () => {
    const combos = [];
    const el = document.getElementById('player1-combo');
    const originalTextSetter = null; // apenas para leitura, ver abaixo

    for (let combo = 1; combo <= 3; combo++) {
      FeedbackRenderer.updateCombo('player1', combo);
      combos.push(el.textContent);
    }

    assert.deepStrictEqual(combos, [formatCombo(1), formatCombo(2), formatCombo(3)]);
  });
});

// ---------------------------------------------------------------------
// 8. Combo volta para 0 quando quebrado ---------------------------------
// ---------------------------------------------------------------------
test('combo quebrado (0) esconde o indicador em vez de mostrar "COMBO 0"', () => {
  withFakeDocument({ player1: {} }, () => {
    const el = document.getElementById('player1-combo');

    FeedbackRenderer.updateCombo('player1', 4);
    assert.ok(!el.classList.contains('hidden'));

    FeedbackRenderer.updateCombo('player1', 0);
    assert.ok(el.classList.contains('hidden'), 'combo 0 deveria esconder o indicador');
  });
});

// ---------------------------------------------------------------------
// 9. Feedback de um jogador nao altera o outro (isolamento) -------------
// ---------------------------------------------------------------------
test('showJudgement/updateScore/updateCombo de player1 nao alteram nada de player2', () => {
  withFakeDocument({ player1: {}, player2: {} }, () => {
    withFakeTimers(() => {
      FeedbackRenderer.showJudgement('player1', 'PERFECT');
      FeedbackRenderer.updateScore('player1', 900);
      FeedbackRenderer.updateCombo('player1', 3);

      const p2Feedback = document.getElementById('player2-feedback');
      const p2Score = document.getElementById('player2-score');
      const p2Combo = document.getElementById('player2-combo');

      assert.strictEqual(p2Feedback.textContent, '');
      assert.ok(!p2Feedback.classList.contains('is-visible'));
      assert.strictEqual(p2Score.textContent, '');
      assert.strictEqual(p2Combo.textContent, '');

      const p1Feedback = document.getElementById('player1-feedback');
      assert.strictEqual(p1Feedback.textContent, 'PERFECT');
    });
  });
});

// ---------------------------------------------------------------------
// 10. Feedback nao fica permanentemente na tela --------------------------
// ---------------------------------------------------------------------
test('o feedback de julgamento desaparece sozinho apos o tempo configurado (auto-hide)', () => {
  withFakeDocument({ player1: {} }, () => {
    withFakeTimers(({ flushAll, scheduled }) => {
      FeedbackRenderer.showJudgement('player1', 'GOOD');
      const el = document.getElementById('player1-feedback');

      assert.ok(el.classList.contains('is-visible'), 'deveria estar visivel logo apos mostrar');
      assert.strictEqual(scheduled.size, 1, 'deveria ter agendado exatamente um timer de auto-hide');

      flushAll(); // simula o tempo passando ate o timer disparar

      assert.ok(!el.classList.contains('is-visible'), 'deveria ter escondido sozinho depois do tempo configurado');
    });
  });
});

// ---------------------------------------------------------------------
// 11. Sem feedbacks/timers duplicados para o mesmo evento -----------------
// ---------------------------------------------------------------------
test('chamadas repetidas de showJudgement antes do auto-hide substituem o timer anterior (nunca acumulam)', () => {
  withFakeDocument({ player1: {} }, () => {
    withFakeTimers(({ scheduled }) => {
      FeedbackRenderer.showJudgement('player1', 'PERFECT');
      assert.strictEqual(scheduled.size, 1);

      FeedbackRenderer.showJudgement('player1', 'PERFECT'); // mesmo evento de novo, rapido
      assert.strictEqual(scheduled.size, 1, 'nao pode acumular um segundo timer para o mesmo slot');

      const el = document.getElementById('player1-feedback');
      assert.strictEqual(el.textContent, 'PERFECT');
    });
  });
});

// ---------------------------------------------------------------------
// 12. Animacoes nao criam loops infinitos ---------------------------------
// ---------------------------------------------------------------------
test('o auto-hide agenda exatamente UM timer por chamada e nao reagenda outro sozinho (sem loop)', () => {
  withFakeDocument({ player1: {} }, () => {
    withFakeTimers(({ flushAll, scheduled }) => {
      FeedbackRenderer.showJudgement('player1', 'MISS');
      assert.strictEqual(scheduled.size, 1);

      flushAll();

      assert.strictEqual(scheduled.size, 0, 'depois do auto-hide disparar, nenhum novo timer deveria ter sido agendado sozinho');
    });
  });
});

test('reset() limpa timers pendentes sem deixar nada agendado (nenhum vazamento entre partidas)', () => {
  withFakeDocument({ player1: {} }, () => {
    withFakeTimers(({ scheduled }) => {
      FeedbackRenderer.showJudgement('player1', 'GOOD');
      assert.strictEqual(scheduled.size, 1);

      FeedbackRenderer.reset('player1');

      assert.strictEqual(scheduled.size, 0, 'reset() deveria cancelar o timer de auto-hide pendente');
      const el = document.getElementById('player1-feedback');
      assert.strictEqual(el.textContent, '');
      assert.ok(!el.classList.contains('is-visible'));
    });
  });
});

// ---------------------------------------------------------------------
// Extra: "so escreve quando muda" (score/combo) --------------------------
// ---------------------------------------------------------------------
test('updateScore/updateCombo nao reescrevem o DOM quando o valor nao muda', () => {
  withFakeDocument({ player1: {} }, () => {
    const scoreEl = document.getElementById('player1-score');
    const comboEl = document.getElementById('player1-combo');
    let scoreWrites = 0;
    let comboWrites = 0;
    let scoreValue = '';
    let comboValue = '';
    Object.defineProperty(scoreEl, 'textContent', {
      get: () => scoreValue,
      set: (v) => { scoreValue = v; scoreWrites++; },
    });
    Object.defineProperty(comboEl, 'textContent', {
      get: () => comboValue,
      set: (v) => { comboValue = v; comboWrites++; },
    });

    FeedbackRenderer.updateScore('player1', 300);
    FeedbackRenderer.updateScore('player1', 300); // mesmo valor de novo
    assert.strictEqual(scoreWrites, 1, 'so deveria escrever no DOM quando o score muda');

    FeedbackRenderer.updateCombo('player1', 2);
    FeedbackRenderer.updateCombo('player1', 2); // mesmo valor de novo
    assert.strictEqual(comboWrites, 1, 'so deveria escrever no DOM quando o combo muda');
  });
});

// ---------------------------------------------------------------------
// Funcoes puras --------------------------------------------------------
// ---------------------------------------------------------------------
test('valueChanged detecta corretamente quando um valor mudou ou nao', () => {
  assert.strictEqual(valueChanged(0, 0), false);
  assert.strictEqual(valueChanged(0, 1), true);
  assert.strictEqual(valueChanged(null, 0), true);
});

test('formatScore/formatCombo produzem o formato esperado', () => {
  assert.strictEqual(formatCombo(7), 'COMBO 7');
  assert.ok(formatScore(1200).startsWith('SCORE'));
  assert.ok(formatScore(1200).includes('1.200') || formatScore(1200).includes('1200'));
});

// ---------------------------------------------------------------------
// Robustez: sem DOM (Node puro) nao lanca erro ----------------------------
// ---------------------------------------------------------------------
test('todas as funcoes publicas degradam com seguranca sem nenhum document (fora do navegador)', () => {
  assert.strictEqual(typeof document, 'undefined');
  assert.doesNotThrow(() => {
    FeedbackRenderer.showJudgement('player1', 'PERFECT');
    FeedbackRenderer.updateScore('player1', 100);
    FeedbackRenderer.updateCombo('player1', 2);
    FeedbackRenderer.flashNote('player1', 'note-1-0', 'HIT');
    FeedbackRenderer.reset('player1');
    FeedbackRenderer.reset();
  });
});

// ---------------------------------------------------------------------
// flashNote (item 8, opcional): efeito leve na propria nota --------------
// ---------------------------------------------------------------------
test('flashNote aplica e remove a classe de destaque no elemento da nota, sem mexer no estado dela', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const note = timeline[0]; // id deterministico: 'note-42-0' (ver buildNoteId)

  withFakeDocument({ player1: { notes: { [note.id]: true } } }, () => {
    withFakeTimers(({ flushAll }) => {
      FeedbackRenderer.flashNote('player1', note.id, 'HIT');

      const noteEl = document.getElementById('player1-playfield').querySelector(`[data-note-id="${note.id}"]`);
      assert.ok(noteEl, 'elemento falso da nota deveria existir no documento de teste');
      assert.ok(noteEl.classList.contains(NOTE_FLASH_CLASS.HIT));

      flushAll();
      assert.ok(!noteEl.classList.contains(NOTE_FLASH_CLASS.HIT));
      assert.strictEqual(note.state, NoteEngine.NOTE_STATE.PENDING, 'flashNote nunca deve alterar note.state');
    });
  });
});

test('flashNote para uma nota que ja saiu da tela (elemento inexistente) nao lanca erro', () => {
  withFakeDocument({ player1: {} }, () => {
    assert.doesNotThrow(() => FeedbackRenderer.flashNote('player1', 'note-inexistente', 'MISS'));
  });
});

console.log(`\n${passed} teste(s) passaram.`);
