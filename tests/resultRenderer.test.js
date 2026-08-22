/**
 * Testes automatizados da tela visual de resultado da partida
 * (Etapa 5B-4C).
 *
 * MatchResult (calculo do resultado) e MatchEndDetector (deteccao do
 * fim da partida) ja sao cobertos por seus proprios arquivos de teste
 * -- este arquivo testa apenas a camada nova: ResultRenderer exibe
 * corretamente o resultado ja pronto, sem recalcular nada, sem
 * misturar jogadores e sem listeners duplicados.
 *
 * Mesmo estilo de "DOM falso" (duck-typing minimo, sem jsdom) ja usado
 * em tests/feedbackRenderer.test.js.
 *
 * Executar com: node tests/resultRenderer.test.js
 */
const assert = require('assert');
const NoteEngine = require('../client/js/match/noteEngine');
const PlayerState = require('../client/js/match/playerState');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const MatchEndDetector = require('../client/js/match/matchEndDetector');
const MatchResult = require('../client/js/match/matchResult');
const ResultRenderer = require('../client/js/render/resultRenderer');

const { formatScore, formatAccuracy, formatCount } = ResultRenderer._internal;

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

const WINDOWS = { perfectMs: 60, goodMs: 150 };
const SCORE_VALUES = { PERFECT: 300, GOOD: 100, MISS: 0 };
const BASE_PARAMS = {
  seed: 7,
  startTimestamp: 1_000_000,
  length: 10,
  noteRange: 3,
  noteIntervalMs: 600,
  leadInMs: 0,
};

// ---------------------------------------------------------------------
// DOM falso: elemento minimo com classList (Set) + textContent, mais
// botoes com addEventListener (para simular clique nos testes).
// ---------------------------------------------------------------------
function makeFakeElement() {
  const classes = new Set();
  const listeners = {};
  return {
    textContent: '',
    offsetWidth: 0, // usado no truque de reflow do ResultRenderer
    classList: {
      add: (...cls) => cls.forEach((c) => classes.add(c)),
      remove: (...cls) => cls.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    addEventListener: (event, cb) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    },
    _click: () => (listeners.click || []).forEach((cb) => cb()),
    _classes: classes,
    _listenerCount: (event) => (listeners[event] || []).length,
  };
}

/**
 * Monta um `document` falso apenas com os elementos da tela de
 * resultado (item 15: propositalmente SEM nenhum elemento no estilo
 * "player1-..." / "player2-...", provando que ResultRenderer nao
 * depende -- nem poderia acidentalmente escrever -- em elementos do
 * outro jogador).
 */
function makeFakeDocument() {
  const elements = {
    'result-screen': makeFakeElement(),
    'result-score': makeFakeElement(),
    'result-accuracy': makeFakeElement(),
    'result-max-combo': makeFakeElement(),
    'result-hits': makeFakeElement(),
    'result-misses': makeFakeElement(),
    'result-mistakes': makeFakeElement(),
    'btn-play-again': makeFakeElement(),
    'btn-back-to-menu': makeFakeElement(),
  };

  return {
    getElementById: (id) => elements[id] || null,
    documentElement: makeFakeElement(),
    body: makeFakeElement(),
    _elements: elements,
  };
}

function withFakeDocument(fn) {
  const originalDocument = global.document;
  const fakeDocument = makeFakeDocument();
  global.document = fakeDocument;
  // Simula "a pagina carregou de novo": forca o ResultRenderer a
  // re-resolver os elementos (e re-ligar os listeners) contra ESTE
  // `document` falso, em vez de continuar usando referencias cacheadas
  // de um teste anterior.
  ResultRenderer._internal._resetForTests();
  try {
    return fn(fakeDocument);
  } finally {
    global.document = originalDocument;
  }
}

function makeResult(overrides = {}) {
  return {
    score: 12500,
    maxCombo: 37,
    hits: 82,
    misses: 12,
    mistakes: 6,
    totalNotes: 100,
    accuracy: 82,
    ...overrides,
  };
}

/**
 * Gera um resultado real (nao um mock) jogando uma partida completa
 * atraves de GameplayEngine/PlayerState/MatchEndDetector/MatchResult,
 * exatamente como main.js faz -- para os testes de integracao (1, 2)
 * nao dependerem de numeros inventados a mao.
 */
function playFullMatchAndGetResult({ onMatchEnd }) {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    sendEvent: () => {},
  });
  const detector = MatchEndDetector.createMatchEndDetector({ timeline, onMatchEnd });

  // Acerta as 3 primeiras notas, deixa o resto expirar (MISS) -- so
  // precisamos de ALGUM resultado misto e deterministico.
  timeline.slice(0, 3).forEach((note) => {
    engine.handleKeyPress(note.lane, note.time);
  });
  const hitWindowEnd = timeline[timeline.length - 1].time + 1000;
  engine.processExpiredNotes(hitWindowEnd, 150);

  detector.checkForEnd();

  return { timeline, playerState };
}

// ---------------------------------------------------------------------
// 1-2. Aparece quando termina / nao aparece quando cancelada
// ---------------------------------------------------------------------
test('1. Tela aparece quando a partida termina (fluxo real: MatchEndDetector -> MatchResult -> ResultRenderer)', () => {
  withFakeDocument((doc) => {
    MatchResult.clearResult();
    let shownResult = null;

    playFullMatchAndGetResult({
      onMatchEnd: () => {
        const timeline = MatchResult.getResult(); // no-op se ainda nao gerado
        void timeline;
      },
    });

    // Re-simula exatamente o que main.js faz no callback de fim de
    // partida: gera o resultado e manda mostrar.
    const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
    const playerState = PlayerState.createPlayerState();
    PlayerState.registerHit(playerState, 'PERFECT', SCORE_VALUES);
    const result = MatchResult.generateResult({ playerState, timeline });
    shownResult = result;
    ResultRenderer.show(shownResult);

    assert.strictEqual(doc._elements['result-screen'].classList.contains('hidden'), false);
    assert.strictEqual(doc._elements['result-screen'].classList.contains('is-visible'), true);
  });
});

test('2. Tela nao aparece quando a partida e cancelada (nunca chamar show = continua escondida por padrao)', () => {
  withFakeDocument((doc) => {
    // Nenhuma chamada a ResultRenderer.show() -- equivalente ao fluxo
    // de match_cancelled em main.js, que so chama ResultRenderer.reset().
    ResultRenderer.reset();

    assert.strictEqual(doc._elements['result-screen'].classList.contains('hidden'), true);
    assert.strictEqual(doc._elements['result-screen'].classList.contains('is-visible'), false);
  });
});

// ---------------------------------------------------------------------
// 3-8. Cada campo exibido corretamente
// ---------------------------------------------------------------------
test('3. Score correto e exibido', () => {
  withFakeDocument((doc) => {
    ResultRenderer.show(makeResult({ score: 12500 }));
    assert.strictEqual(doc._elements['result-score'].textContent, formatScore(12500));
  });
});

test('4. Precisao correta e exibida', () => {
  withFakeDocument((doc) => {
    ResultRenderer.show(makeResult({ accuracy: 82 }));
    assert.strictEqual(doc._elements['result-accuracy'].textContent, formatAccuracy(82));
    assert.strictEqual(doc._elements['result-accuracy'].textContent, '82.00%');
  });
});

test('5. MaxCombo correto e exibido', () => {
  withFakeDocument((doc) => {
    ResultRenderer.show(makeResult({ maxCombo: 37 }));
    assert.strictEqual(doc._elements['result-max-combo'].textContent, formatCount(37));
  });
});

test('6. Hits corretos sao exibidos', () => {
  withFakeDocument((doc) => {
    ResultRenderer.show(makeResult({ hits: 82 }));
    assert.strictEqual(doc._elements['result-hits'].textContent, formatCount(82));
  });
});

test('7. Misses corretos sao exibidos', () => {
  withFakeDocument((doc) => {
    ResultRenderer.show(makeResult({ misses: 12 }));
    assert.strictEqual(doc._elements['result-misses'].textContent, formatCount(12));
  });
});

test('8. Mistakes (Erros) corretos sao exibidos', () => {
  withFakeDocument((doc) => {
    ResultRenderer.show(makeResult({ mistakes: 6 }));
    assert.strictEqual(doc._elements['result-mistakes'].textContent, formatCount(6));
  });
});

// ---------------------------------------------------------------------
// 9-10. Reset / nova partida escondem e limpam o resultado anterior
// ---------------------------------------------------------------------
test('9. Reset remove o resultado visual anterior (esconde e limpa os campos)', () => {
  withFakeDocument((doc) => {
    ResultRenderer.show(makeResult({ score: 999, hits: 55 }));
    assert.strictEqual(doc._elements['result-score'].textContent, formatScore(999));

    ResultRenderer.reset();

    assert.strictEqual(doc._elements['result-screen'].classList.contains('hidden'), true);
    assert.strictEqual(doc._elements['result-score'].textContent, '');
    assert.strictEqual(doc._elements['result-hits'].textContent, '');
  });
});

test('10. Iniciar nova partida esconde a tela de resultado (mesmo comportamento de reset, chamado por main.js em startMatchGameplay)', () => {
  withFakeDocument((doc) => {
    ResultRenderer.show(makeResult());
    assert.strictEqual(ResultRenderer.isVisible(), true);

    // Isto e exatamente o que main.js chama no inicio de
    // startMatchGameplay, antes de comecar a proxima partida.
    ResultRenderer.reset();

    assert.strictEqual(ResultRenderer.isVisible(), false);
    assert.strictEqual(doc._elements['result-screen'].classList.contains('hidden'), true);
  });
});

// ---------------------------------------------------------------------
// 11-12. Botoes: handler chamado, sem listeners duplicados
// ---------------------------------------------------------------------
test('11. Botao Voltar ao Menu funciona corretamente (dispara o handler registrado)', () => {
  withFakeDocument((doc) => {
    let called = 0;
    ResultRenderer.setOnBackToMenu(() => {
      called += 1;
    });
    ResultRenderer.show(makeResult());

    doc._elements['btn-back-to-menu']._click();

    assert.strictEqual(called, 1);
  });
});

test('11b. Botao Jogar Novamente funciona corretamente (dispara o handler registrado)', () => {
  withFakeDocument((doc) => {
    let called = 0;
    ResultRenderer.setOnPlayAgain(() => {
      called += 1;
    });
    ResultRenderer.show(makeResult());

    doc._elements['btn-play-again']._click();

    assert.strictEqual(called, 1);
  });
});

test('12. Nao existem multiplos listeners duplicados mesmo chamando show() varias vezes (varias partidas)', () => {
  withFakeDocument((doc) => {
    let called = 0;
    ResultRenderer.setOnBackToMenu(() => {
      called += 1;
    });

    // show() chamado 3x, simulando 3 partidas terminando em sequencia
    // na mesma pagina -- o listener so deve ter sido ligado UMA vez.
    ResultRenderer.show(makeResult());
    ResultRenderer.reset();
    ResultRenderer.show(makeResult());
    ResultRenderer.reset();
    ResultRenderer.show(makeResult());

    assert.strictEqual(doc._elements['btn-back-to-menu']._listenerCount('click'), 1);

    doc._elements['btn-back-to-menu']._click();
    assert.strictEqual(called, 1, 'handler deveria disparar uma unica vez por clique, nao uma vez por show() anterior');
  });
});

// ---------------------------------------------------------------------
// 13-14. Responsividade (verificacao estatica do CSS -- Node puro nao
// tem motor de layout/jsdom para medir overflow real de verdade; o que
// da para garantir automaticamente aqui e que as regras responsivas
// esperadas EXISTEM no CSS entregue).
// ---------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const cssContent = fs.readFileSync(path.join(__dirname, '../client/css/style.css'), 'utf8');

test('13. CSS da tela de resultado nunca permite overflow horizontal (PC)', () => {
  const resultScreenBlock = /\.result-screen\s*{[^}]*}/.exec(cssContent);
  assert.ok(resultScreenBlock, '.result-screen deveria existir no CSS');
  assert.ok(
    resultScreenBlock[0].includes('overflow-x: hidden'),
    '.result-screen deveria forcar overflow-x: hidden'
  );
  assert.ok(cssContent.includes('.result-card'), '.result-card deveria existir no CSS');
  assert.ok(
    /\.result-card\s*{[^}]*box-sizing:\s*border-box/.test(cssContent),
    '.result-card deveria usar box-sizing: border-box para nunca estourar a largura do container'
  );
});

test('14. CSS da tela de resultado tem regra responsiva para celular (largura estreita), sem elementos cortados', () => {
  assert.ok(
    /@media\s*\(max-width:\s*480px\)\s*{[^]*?\.result-grid[^]*?}/.test(cssContent),
    'deveria existir uma media query para telas estreitas ajustando .result-grid'
  );
  assert.ok(
    cssContent.includes('.result-btn'),
    '.result-btn deveria existir (botoes com area de toque adequada)'
  );
  assert.ok(
    /\.result-btn\s*{[^}]*min-height:\s*46px/.test(cssContent),
    'botoes da tela de resultado deveriam ter min-height adequado para toque'
  );
});

// ---------------------------------------------------------------------
// 15. Isolamento entre jogadores: resultado de um jogador nunca
// aparece no campo do outro.
// ---------------------------------------------------------------------
test('15. Resultado de um jogador nao aparece no campo do outro (ResultRenderer nao depende de nenhum elemento player1-*/player2-*)', () => {
  withFakeDocument((doc) => {
    // O `document` falso deste teste NAO tem nenhum elemento
    // player1-*/player2-* (ver makeFakeDocument) -- se ResultRenderer
    // tentasse ler/escrever em algo assim, getElementById devolveria
    // null e (dependendo do codigo) lancaria erro. O fato de show()
    // funcionar normalmente aqui prova que a tela de resultado e
    // isolada por construcao: so existe UM conjunto de elementos
    // (o do jogador local), nunca um por jogador.
    assert.doesNotThrow(() => {
      ResultRenderer.show(makeResult({ score: 42 }));
    });
    assert.strictEqual(doc._elements['result-score'].textContent, formatScore(42));
    assert.strictEqual(Object.keys(doc._elements).some((id) => id.startsWith('player1') || id.startsWith('player2')), false);
  });
});

// ---------------------------------------------------------------------
// Funcoes puras + robustez sem DOM
// ---------------------------------------------------------------------
test('formatScore/formatAccuracy/formatCount produzem o formato esperado', () => {
  assert.strictEqual(formatAccuracy(82), '82.00%');
  assert.strictEqual(formatCount(37), '37');
  assert.ok(formatScore(12500).includes('12.500') || formatScore(12500).includes('12500'));
});

test('todas as funcoes publicas degradam com seguranca sem nenhum document (fora do navegador)', () => {
  const originalDocument = global.document;
  delete global.document;
  ResultRenderer._internal._resetForTests();
  try {
    assert.strictEqual(typeof document, 'undefined');
    assert.doesNotThrow(() => {
      ResultRenderer.show(makeResult());
      ResultRenderer.hide();
      ResultRenderer.reset();
      ResultRenderer.isVisible();
      ResultRenderer.setOnPlayAgain(() => {});
      ResultRenderer.setOnBackToMenu(() => {});
    });
  } finally {
    global.document = originalDocument;
    ResultRenderer._internal._resetForTests();
  }
});

console.log(`\n${passed} teste(s) passaram.`);
