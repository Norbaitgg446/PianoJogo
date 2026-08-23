/**
 * Testes automatizados da ETAPA 13F — PARTE 2 (interface e fluxo da
 * tela de resultado).
 *
 * NAO recalcula nenhuma estatistica -- reaproveita exatamente o
 * MESMO objeto de resultado que a Parte 1 ja produz (MatchResult,
 * coberto por tests/resultStats13F.test.js) e cobre apenas a camada
 * nova desta parte:
 *
 * - exibicao de PERFECT/GREAT/GOOD/ERRO/MISS e do maior multiplicador
 *   (campos que MatchResult.buildResult ja calculava desde a Parte 1,
 *   agora tambem exibidos por ResultRenderer);
 * - bloco de vencedor/perdedor/empate (Multiplayer), via
 *   ResultRenderer.setMatchOutcome/clearMatchOutcome -- nenhuma logica
 *   NOVA de decisao de vencedor, so exibicao do que ja chega pronto;
 * - Solo e Modo Teste NUNCA mostram vencedor/perdedor (o bloco so e
 *   preenchido quando algo explicitamente chama setMatchOutcome, o que
 *   nunca acontece nesses dois modos -- ver client/js/main.js);
 * - reset() tambem limpa o bloco de outcome, para uma partida nova
 *   nunca comecar com o vencedor/perdedor de uma partida anterior
 *   ainda visivel;
 * - "Jogar Novamente"/"Voltar ao Menu" continuam funcionando (ja
 *   cobertos em detalhe por tests/resultRenderer.test.js -- aqui so
 *   confirma que o roteamento em main.js para Multiplayer/Solo/Modo
 *   Teste esta correto, lendo o proprio codigo-fonte de main.js).
 *
 * Executar com: node tests/resultInterfaceFlow13F.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ResultRenderer = require('../client/js/render/resultRenderer');

const { formatMultiplier, formatCount } = ResultRenderer._internal;

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
// DOM falso -- mesmo padrao de tests/resultRenderer.test.js, agora com
// os elementos novos desta parte (perfect/great/good/max-multiplier/
// outcome), alem dos ja existentes.
// ---------------------------------------------------------------------
function makeFakeElement() {
  const classes = new Set();
  const listeners = {};
  return {
    textContent: '',
    offsetWidth: 0,
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

function makeFakeDocument() {
  const elements = {
    'result-screen': makeFakeElement(),
    'result-score': makeFakeElement(),
    'result-accuracy': makeFakeElement(),
    'result-max-combo': makeFakeElement(),
    'result-hits': makeFakeElement(),
    'result-misses': makeFakeElement(),
    'result-mistakes': makeFakeElement(),
    'result-perfect': makeFakeElement(),
    'result-great': makeFakeElement(),
    'result-good': makeFakeElement(),
    'result-max-multiplier': makeFakeElement(),
    'result-outcome': makeFakeElement(),
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
  ResultRenderer._internal._resetForTests();
  try {
    return fn(fakeDocument);
  } finally {
    global.document = originalDocument;
  }
}

function makeResult(overrides = {}) {
  return {
    score: 8450,
    maxCombo: 15,
    maxMultiplier: 2,
    hits: 25,
    perfectCount: 18,
    greatCount: 7,
    goodCount: 3,
    misses: 1,
    mistakes: 2,
    totalNotes: 29,
    accuracy: 94.2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// 1-4. Contagem detalhada PERFECT/GREAT/GOOD e maior multiplicador
// ---------------------------------------------------------------------
test('1. PERFECT exibido corretamente (mesmo campo que MatchResult ja calcula)', () => {
  withFakeDocument((doc) => {
    ResultRenderer.show(makeResult({ perfectCount: 18 }));
    assert.strictEqual(doc._elements['result-perfect'].textContent, formatCount(18));
  });
});

test('2. GREAT exibido corretamente', () => {
  withFakeDocument((doc) => {
    ResultRenderer.show(makeResult({ greatCount: 7 }));
    assert.strictEqual(doc._elements['result-great'].textContent, formatCount(7));
  });
});

test('3. GOOD exibido corretamente', () => {
  withFakeDocument((doc) => {
    ResultRenderer.show(makeResult({ goodCount: 3 }));
    assert.strictEqual(doc._elements['result-good'].textContent, formatCount(3));
  });
});

test('4. Maior multiplicador exibido corretamente, formatado com "×"', () => {
  withFakeDocument((doc) => {
    ResultRenderer.show(makeResult({ maxMultiplier: 2 }));
    assert.strictEqual(doc._elements['result-max-multiplier'].textContent, formatMultiplier(2));
    assert.strictEqual(doc._elements['result-max-multiplier'].textContent, '2×');
  });
});

test('ERRO (mistakes) e MISS (misses) continuam exibidos (campos ja existentes, so relabelados na tela)', () => {
  withFakeDocument((doc) => {
    ResultRenderer.show(makeResult({ mistakes: 2, misses: 1 }));
    assert.strictEqual(doc._elements['result-mistakes'].textContent, formatCount(2));
    assert.strictEqual(doc._elements['result-misses'].textContent, formatCount(1));
  });
});

// ---------------------------------------------------------------------
// 5-9. Bloco de vencedor/perdedor/empate (Multiplayer)
// ---------------------------------------------------------------------
test('5. setMatchOutcome("win") mostra o bloco com a classe/label de vitoria', () => {
  withFakeDocument((doc) => {
    ResultRenderer.setMatchOutcome('win');
    const el = doc._elements['result-outcome'];
    assert.strictEqual(el.classList.contains('hidden'), false);
    assert.strictEqual(el.classList.contains('result-outcome-win'), true);
    assert.ok(el.textContent.length > 0);
  });
});

test('6. setMatchOutcome("lose") mostra o bloco com a classe/label de derrota', () => {
  withFakeDocument((doc) => {
    ResultRenderer.setMatchOutcome('lose');
    const el = doc._elements['result-outcome'];
    assert.strictEqual(el.classList.contains('hidden'), false);
    assert.strictEqual(el.classList.contains('result-outcome-lose'), true);
  });
});

test('7. setMatchOutcome("draw") mostra o bloco com a classe/label de empate', () => {
  withFakeDocument((doc) => {
    ResultRenderer.setMatchOutcome('draw');
    const el = doc._elements['result-outcome'];
    assert.strictEqual(el.classList.contains('hidden'), false);
    assert.strictEqual(el.classList.contains('result-outcome-draw'), true);
  });
});

test('8. clearMatchOutcome() esconde o bloco de novo (equivalente a setMatchOutcome(null))', () => {
  withFakeDocument((doc) => {
    ResultRenderer.setMatchOutcome('win');
    ResultRenderer.clearMatchOutcome();
    const el = doc._elements['result-outcome'];
    assert.strictEqual(el.classList.contains('hidden'), true);
    assert.strictEqual(el.classList.contains('result-outcome-win'), false);
    assert.strictEqual(el.textContent, '');
  });
});

test('9. reset() tambem limpa o bloco de outcome -- partida nova nunca comeca com vencedor/perdedor de uma partida anterior', () => {
  withFakeDocument((doc) => {
    ResultRenderer.setMatchOutcome('lose');
    ResultRenderer.reset();
    const el = doc._elements['result-outcome'];
    assert.strictEqual(el.classList.contains('hidden'), true);
    assert.strictEqual(el.classList.contains('result-outcome-lose'), false);
  });
});

// ---------------------------------------------------------------------
// 10-11. Solo e Modo Teste: bloco de outcome NUNCA aparece (ninguem
// chama setMatchOutcome nesses modos -- ver main.js, case 'match_result',
// so entra no ramo de outcome quando message.mode !== 'solo').
// ---------------------------------------------------------------------
test('10. Solo/Modo Teste: exibir o resultado (show) sem nunca chamar setMatchOutcome mantem o bloco escondido', () => {
  withFakeDocument((doc) => {
    // Mesmo estado inicial real (index.html ja comeca com a classe
    // `hidden` no #result-outcome) -- reset() e o que main.js sempre
    // chama antes de toda partida nova (startMatchGameplay).
    ResultRenderer.reset();

    // Simula exatamente o fluxo Solo/Teste: so ResultRenderer.show() e
    // chamado (handleLocalMatchEnd) -- setMatchOutcome nunca e chamado,
    // porque em main.js isso so acontece dentro do ramo que NAO e
    // 'solo' do case 'match_result', e tanto o Solo hospedado quanto o
    // Modo Teste local sempre mandam mode: 'solo' (ver
    // server/match/matchFlow.js e client/js/network/localServerSimulator.js).
    ResultRenderer.show(makeResult());
    const el = doc._elements['result-outcome'];
    assert.strictEqual(el.classList.contains('hidden'), true);
    assert.strictEqual(el.textContent, '');
  });
});

test('11. Um valor invalido/desconhecido em setMatchOutcome esconde o bloco com seguranca (mesmo efeito de null)', () => {
  withFakeDocument((doc) => {
    ResultRenderer.setMatchOutcome('empate'); // valor errado de proposito (deveria ser 'draw')
    const el = doc._elements['result-outcome'];
    assert.strictEqual(el.classList.contains('hidden'), true);
  });
});

// ---------------------------------------------------------------------
// 12. Troca de outcome entre partidas nunca acumula classes antigas
// ---------------------------------------------------------------------
test('12. Trocar de "win" para "lose" numa partida seguinte nunca deixa as duas classes juntas', () => {
  withFakeDocument((doc) => {
    ResultRenderer.setMatchOutcome('win');
    ResultRenderer.setMatchOutcome('lose');
    const el = doc._elements['result-outcome'];
    assert.strictEqual(el.classList.contains('result-outcome-win'), false);
    assert.strictEqual(el.classList.contains('result-outcome-lose'), true);
  });
});

// ---------------------------------------------------------------------
// 13. Robustez sem DOM (mesmo padrao do resultRenderer.test.js)
// ---------------------------------------------------------------------
test('13. setMatchOutcome/clearMatchOutcome degradam com seguranca sem nenhum document (fora do navegador)', () => {
  const originalDocument = global.document;
  delete global.document;
  ResultRenderer._internal._resetForTests();
  try {
    assert.doesNotThrow(() => {
      ResultRenderer.setMatchOutcome('win');
      ResultRenderer.clearMatchOutcome();
    });
  } finally {
    global.document = originalDocument;
    ResultRenderer._internal._resetForTests();
  }
});

// ---------------------------------------------------------------------
// 14-16. Fluxo de "Jogar Novamente" / "Voltar ao Menu" por modo --
// verificacao estatica do codigo-fonte de main.js (mesmo tipo de teste
// estatico ja usado em resultRenderer.test.js para o CSS), garantindo
// que o roteamento continua existindo e nao foi substituido por um
// sistema paralelo.
// ---------------------------------------------------------------------
const mainJsContent = fs.readFileSync(path.join(__dirname, '../client/js/main.js'), 'utf8');

test('14. Multiplayer: "Jogar Novamente" usa o RematchController existente (nenhum sistema paralelo)', () => {
  const setOnPlayAgainBlock = /ResultRenderer\.setOnPlayAgain\(\(\) => \{[^]*?\n {2}\}\);/.exec(mainJsContent);
  assert.ok(setOnPlayAgainBlock, 'handler de "Jogar Novamente" deveria existir em main.js');
  assert.ok(
    setOnPlayAgainBlock[0].includes('rematchController.requestRematch()'),
    'Multiplayer deveria continuar usando rematchController.requestRematch()'
  );
});

test('15. Solo e Modo Teste: "Jogar Novamente" reinicia via start_solo_match (mesmo pipeline, sem handshake de revanche)', () => {
  const setOnPlayAgainBlock = /ResultRenderer\.setOnPlayAgain\(\(\) => \{[^]*?\n {2}\}\);/.exec(mainJsContent);
  assert.ok(setOnPlayAgainBlock, 'handler de "Jogar Novamente" deveria existir em main.js');
  assert.ok(
    setOnPlayAgainBlock[0].includes('isSoloMode') &&
      setOnPlayAgainBlock[0].includes("SocketClient.send('start_solo_match')"),
    '"Jogar Novamente" deveria reiniciar Solo/Modo Teste com start_solo_match quando isSoloMode'
  );
});

test('16. "Voltar ao Menu" continua retornando a tela inicial existente (sem sistema paralelo de sala)', () => {
  const setOnBackToMenuBlock = /ResultRenderer\.setOnBackToMenu\(\(\) => \{[^]*?\n {2}\}\);/.exec(mainJsContent);
  assert.ok(setOnBackToMenuBlock, 'handler de "Voltar ao Menu" deveria existir em main.js');
  assert.ok(
    setOnBackToMenuBlock[0].includes('window.location.reload()'),
    '"Voltar ao Menu" deveria devolver o jogador a tela inicial (Menu Principal ja existente)'
  );
});

test('17. match_result: bloco de outcome so e preenchido fora do modo Solo (Multiplayer), nunca dentro dele', () => {
  const matchResultCase = /case 'match_result':[^]*?\n {8}break;/.exec(mainJsContent);
  assert.ok(matchResultCase, "case 'match_result' deveria existir em main.js");
  assert.ok(
    matchResultCase[0].includes("message.mode === 'solo'") &&
      matchResultCase[0].includes('ResultRenderer.setMatchOutcome'),
    'setMatchOutcome deveria ser chamado apenas no ramo que nao e Solo'
  );
});

console.log(`\n${passed} teste(s) passaram.`);
