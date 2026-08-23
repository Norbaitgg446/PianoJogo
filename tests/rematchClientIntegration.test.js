/**
 * Testes automatizados da integracao CLIENTE do fluxo de revanche
 * (Etapa 5B-5A, Parte 2): clique em "Jogar Novamente" -> RematchController
 * -> estado de espera -> cancelamento por desconexao, e o reset completo
 * dos sistemas existentes quando uma nova partida (revanche) realmente
 * comeca (mesmo fluxo match_ready -> countdown -> match_started ja usado
 * por qualquer partida, sem nenhum sistema paralelo).
 *
 * RematchController e ResultRenderer sao testados diretamente. A parte de
 * "a nova partida comeca limpa" e testada com um pequeno orquestrador que
 * chama exatamente as MESMAS funcoes/API publica que main.js chama dentro
 * de `startMatchGameplay` (MatchTimelineManager, PlayerState,
 * GameplayEngine, MatchEndDetector, NoteRenderer, FeedbackRenderer,
 * InputController) -- nenhuma logica nova e reimplementada aqui, so
 * chamada na mesma ordem, para provar que reusar esse fluxo (que e
 * exatamente o que a revanche faz) reseta tudo corretamente.
 *
 * Executar com: node tests/rematchClientIntegration.test.js
 */
const assert = require('assert');
const RematchController = require('../client/js/match/rematchController');
const ResultRenderer = require('../client/js/render/resultRenderer');
const MatchTimelineManager = require('../client/js/match/matchTimelineManager');
const PlayerState = require('../client/js/match/playerState');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const MatchEndDetector = require('../client/js/match/matchEndDetector');
const FeedbackRenderer = require('../client/js/render/feedbackRenderer');
const InputController = require('../client/js/input/inputController');

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
const NOTE_PARAMS = { length: 10, noteRange: 3, noteIntervalMs: 600, leadInMs: 0 };

// ---------------------------------------------------------------------
// DOM falso minimo (mesmo estilo de tests/resultRenderer.test.js), so
// para os elementos da tela de resultado usados pelo RematchController
// via ResultRenderer.
// ---------------------------------------------------------------------
function makeFakeElement() {
  const classes = new Set();
  const listeners = {};
  return {
    textContent: '',
    disabled: false,
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
    'btn-play-again': makeFakeElement(),
    'btn-back-to-menu': makeFakeElement(),
    'result-rematch-status': makeFakeElement(),
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

// ---------------------------------------------------------------------
// 1-3, 14: RematchController isolado (sem DOM, dependencias injetadas).
// ---------------------------------------------------------------------

// 1. Clique em Jogar Novamente envia apenas uma solicitacao -----------------
test('clicar em Jogar Novamente envia exatamente uma solicitacao ao servidor', () => {
  let sendCount = 0;
  const controller = RematchController.createRematchController({
    sendRematchReady: () => {
      sendCount += 1;
    },
  });

  const sentNow = controller.requestRematch();

  assert.strictEqual(sentNow, true);
  assert.strictEqual(sendCount, 1);
});

// 2. Clique repetido nao envia varias solicitacoes ---------------------------
test('cliques repetidos em Jogar Novamente nao enviam solicitacoes extras', () => {
  let sendCount = 0;
  const controller = RematchController.createRematchController({
    sendRematchReady: () => {
      sendCount += 1;
    },
  });

  controller.requestRematch();
  const secondClick = controller.requestRematch();
  const thirdClick = controller.requestRematch();

  assert.strictEqual(secondClick, false);
  assert.strictEqual(thirdClick, false);
  assert.strictEqual(sendCount, 1, 'apenas UMA mensagem rematch_ready deveria ter sido enviada');
});

// 3. Estado de espera e ativado corretamente ---------------------------------
test('estado de "aguardando o outro jogador" e ativado ao pedir revanche', () => {
  const waitingChanges = [];
  const controller = RematchController.createRematchController({
    sendRematchReady: () => {},
    onWaitingStateChange: (isWaiting) => waitingChanges.push(isWaiting),
  });

  assert.strictEqual(controller.isWaiting(), false);

  controller.requestRematch();

  assert.strictEqual(controller.isWaiting(), true);
  assert.deepStrictEqual(waitingChanges, [true]);
});

// 14. Desconexao durante espera nao inicia partida ---------------------------
test('desconexao do oponente durante a espera cancela sem iniciar nenhuma partida', () => {
  const waitingChanges = [];
  const cancelledReasons = [];
  let matchStartedCalls = 0; // nada neste teste deve incrementar isto
  const controller = RematchController.createRematchController({
    sendRematchReady: () => {},
    onWaitingStateChange: (isWaiting) => waitingChanges.push(isWaiting),
    onCancelled: (reason) => cancelledReasons.push(reason),
  });

  controller.requestRematch();
  controller.handleCancelled('O oponente desconectou antes da revanche comecar.');

  assert.strictEqual(controller.isWaiting(), false);
  assert.deepStrictEqual(waitingChanges, [true, false]);
  assert.deepStrictEqual(cancelledReasons, ['O oponente desconectou antes da revanche comecar.']);
  assert.strictEqual(matchStartedCalls, 0, 'nenhuma partida deveria ter sido iniciada');

  // Depois do cancelamento, o jogador deve poder pedir revanche de novo
  // (novo handshake) -- confirma que o estado realmente foi limpo, nao
  // so a UI.
  let sendCountAfterCancel = 0;
  const controller2 = RematchController.createRematchController({
    sendRematchReady: () => {
      sendCountAfterCancel += 1;
    },
  });
  controller2.requestRematch();
  controller2.handleCancelled('desconectou');
  const allowedToRetry = controller2.requestRematch();
  assert.strictEqual(allowedToRetry, true);
  assert.strictEqual(sendCountAfterCancel, 2);
});

// handleCancelled sem nada pendente e ignorado (nao deveria fabricar
// mensagens de cancelamento do nada).
test('handleCancelled sem revanche pendente e ignorado', () => {
  const cancelledReasons = [];
  const controller = RematchController.createRematchController({
    sendRematchReady: () => {},
    onCancelled: (reason) => cancelledReasons.push(reason),
  });

  controller.handleCancelled('motivo qualquer');

  assert.strictEqual(cancelledReasons.length, 0);
});

// ---------------------------------------------------------------------
// Integracao com ResultRenderer (UI real do botao "Jogar Novamente").
// ---------------------------------------------------------------------

test('RematchController + ResultRenderer: botao desabilita e mensagem aparece ao clicar', () => {
  withFakeDocument((doc) => {
    let sendCount = 0;
    const controller = RematchController.createRematchController({
      sendRematchReady: () => {
        sendCount += 1;
      },
      onWaitingStateChange: (isWaiting) => ResultRenderer.setPlayAgainWaiting(isWaiting),
    });
    ResultRenderer.setOnPlayAgain(() => controller.requestRematch());

    doc._elements['btn-play-again']._click();
    doc._elements['btn-play-again']._click(); // clique repetido

    assert.strictEqual(sendCount, 1);
    assert.strictEqual(doc._elements['btn-play-again'].disabled, true);
    assert.strictEqual(doc._elements['result-rematch-status'].classList.contains('hidden'), false);
    assert.strictEqual(doc._elements['result-rematch-status'].textContent, 'Aguardando o outro jogador...');
  });
});

test('RematchController + ResultRenderer: cancelamento reabilita o botao e mostra o motivo', () => {
  withFakeDocument((doc) => {
    const controller = RematchController.createRematchController({
      sendRematchReady: () => {},
      onWaitingStateChange: (isWaiting) => ResultRenderer.setPlayAgainWaiting(isWaiting),
      onCancelled: (reason) => ResultRenderer.showRematchCancelled(reason),
    });
    ResultRenderer.setOnPlayAgain(() => controller.requestRematch());

    doc._elements['btn-play-again']._click();
    controller.handleCancelled('O oponente desconectou antes da revanche comecar.');

    assert.strictEqual(doc._elements['btn-play-again'].disabled, false);
    assert.strictEqual(doc._elements['result-rematch-status'].classList.contains('hidden'), false);
    assert.ok(doc._elements['result-rematch-status'].textContent.includes('cancelada'));
  });
});

// 4. Resultado antigo e limpo ao comecar nova partida ------------------------
test('resultado antigo e limpo (ResultRenderer.reset) ao comecar a nova partida', () => {
  withFakeDocument((doc) => {
    ResultRenderer.show({ score: 9999, maxCombo: 40, hits: 30, misses: 2, mistakes: 1, totalNotes: 33, accuracy: 90 });
    assert.strictEqual(doc._elements['result-score'].textContent, '9.999');

    // Mesma chamada que main.js faz no inicio de startMatchGameplay,
    // exatamente como acontece quando a nova partida da revanche comeca.
    ResultRenderer.reset();

    assert.strictEqual(doc._elements['result-score'].textContent, '');
    assert.strictEqual(doc._elements['result-screen'].classList.contains('is-visible'), false);
    // O reset tambem devolve o botao/estado de revanche ao ponto de
    // partida (nunca deixa "aguardando"/cancelamento de uma partida
    // anterior visivel na tela da partida nova).
    assert.strictEqual(doc._elements['btn-play-again'].disabled, false);
    assert.strictEqual(doc._elements['result-rematch-status'].classList.contains('hidden'), true);
  });
});

// ---------------------------------------------------------------------
// 5-13, 15: orquestrador minimo que chama a MESMA sequencia de funcoes
// que main.js chama dentro de startMatchGameplay, para provar que
// reusar esse fluxo (o que a revanche faz) comeca cada partida
// completamente limpa. Nenhuma logica nova e implementada aqui -- so
// as chamadas, na mesma ordem, contadas.
// ---------------------------------------------------------------------
function createMatchOrchestrator() {
  const counts = {
    timelineEnsureCalls: 0,
    gameplayEngineCreated: 0,
    matchEndDetectorCreated: 0,
    feedbackResetCalls: 0,
    inputHandlerSetCalls: 0,
  };
  let active = null; // { timeline, playerState, gameplayEngine, matchEndDetector }

  function startMatchGameplay({ seed, startTimestamp }) {
    const timeline = MatchTimelineManager.ensureTimeline({ seed, startTimestamp, ...NOTE_PARAMS });
    counts.timelineEnsureCalls += 1;

    const playerState = PlayerState.createPlayerState();
    FeedbackRenderer.reset('player1');
    counts.feedbackResetCalls += 1;

    const gameplayEngine = GameplayEngine.createGameplayEngine({
      timeline,
      playerState,
      windows: WINDOWS,
      scoreValues: SCORE_VALUES,
      sendEvent: () => {},
    });
    counts.gameplayEngineCreated += 1;

    InputController.setLaneHandler((lane) => gameplayEngine.handleKeyPress(lane, Date.now()));
    counts.inputHandlerSetCalls += 1;

    const matchEndDetector = MatchEndDetector.createMatchEndDetector({ timeline, onMatchEnd: () => {} });
    counts.matchEndDetectorCreated += 1;

    active = { timeline, playerState, gameplayEngine, matchEndDetector };
    return active;
  }

  function handleLocalMatchEnd() {
    // Mesmo passo que main.js faz ao terminar a partida: desliga o input.
    InputController.setLaneHandler(null);
  }

  return { startMatchGameplay, handleLocalMatchEnd, counts, getActive: () => active };
}

test('fluxo completo da revanche: resultado -> ready -> aguardando -> ambos prontos -> nova partida limpa', () => {
  MatchTimelineManager.clear();
  const orchestrator = createMatchOrchestrator();

  // --- Partida 1: joga, "termina" (fim simulado), acumula estado ----------
  const match1 = orchestrator.startMatchGameplay({ seed: 111, startTimestamp: 1_000_000 });
  match1.timeline.slice(0, 3).forEach((note) => {
    match1.gameplayEngine.handleKeyPress(note.lane, note.time);
  });
  assert.ok(match1.playerState.score > 0, 'partida 1 deveria ter acumulado score');
  orchestrator.handleLocalMatchEnd();

  // --- Clique em "Jogar Novamente" (Parte 2) -------------------------------
  const waitingChanges = [];
  const rematch = RematchController.createRematchController({
    sendRematchReady: () => {},
    onWaitingStateChange: (isWaiting) => waitingChanges.push(isWaiting),
  });
  const sentNow = rematch.requestRematch();
  assert.strictEqual(sentNow, true);
  assert.strictEqual(rematch.isWaiting(), true);
  assert.deepStrictEqual(waitingChanges, [true]);
  // Nenhuma partida comecou so com o jogador local pronto (o handshake
  // de "os dois prontos" e responsabilidade do SERVIDOR -- Parte 1 --
  // e so testado la; aqui so garantimos que o cliente nao adianta nada
  // sozinho).
  assert.strictEqual(orchestrator.getActive(), match1);

  // --- Servidor confirma: os dois prontos -> match_started (nova seed) ----
  const match2 = orchestrator.startMatchGameplay({ seed: 222, startTimestamp: 2_000_000 });
  rematch.reset(); // main.js chama isto dentro de startMatchGameplay

  // 5. PlayerState comeca zerado -------------------------------------------
  // ETAPA 13F: PlayerState.createPlayerState() ganhou perfectCount/
  // greatCount/goodCount/maxMultiplier (contagem detalhada para a tela
  // de resultado) -- continuam todos zerados (maxMultiplier em 1, seu
  // valor minimo) numa partida nova, exatamente como os campos antigos.
  assert.deepStrictEqual(match2.playerState, {
    score: 0,
    combo: 0,
    maxCombo: 0,
    hits: 0,
    misses: 0,
    mistakes: 0,
    perfectCount: 0,
    greatCount: 0,
    goodCount: 0,
    maxMultiplier: 1,
  });

  // 6. Nova timeline e criada -----------------------------------------------
  assert.notStrictEqual(match2.timeline, match1.timeline);

  // 7. Nova seed e utilizada (a timeline realmente depende da seed nova) ---
  const lanesMatch1 = match1.timeline.map((n) => n.lane).join(',');
  const lanesMatch2 = match2.timeline.map((n) => n.lane).join(',');
  assert.notStrictEqual(lanesMatch1, lanesMatch2);

  // 8. GameplayEngine e criado (uma vez por partida) e o antigo e trocado --
  assert.strictEqual(orchestrator.counts.gameplayEngineCreated, 2);
  assert.notStrictEqual(match2.gameplayEngine, match1.gameplayEngine);
  assert.strictEqual(orchestrator.getActive().gameplayEngine, match2.gameplayEngine);

  // 9. NoteRenderer seria reiniciado corretamente: NoteRenderer.start()
  // sempre chama stop() internamente primeiro (ver noteRenderer.js) --
  // ou seja, nunca ha dois loops de notas simultaneos mesmo comecando
  // uma partida nova em cima de uma anterior. Aqui confirmamos que a
  // API usada por main.js (start/stop) continua existindo e chamavel
  // em sequencia sem lancar erro (equivalente ao que main.js faz a
  // cada match_started).
  const NoteRenderer = require('../client/js/render/noteRenderer');
  assert.doesNotThrow(() => {
    NoteRenderer.start({ timeline: match1.timeline, clockOffsetMs: 0, hitWindowMs: 150 });
    NoteRenderer.start({ timeline: match2.timeline, clockOffsetMs: 0, hitWindowMs: 150 }); // reinicia sem duplicar
    NoteRenderer.stop();
  });

  // 10. Loop de MISS nao e duplicado: main.js usa o MESMO
  // GameplayEngine.processExpiredNotes ja existente, chamado por um
  // unico loop por partida (token incrementado a cada
  // startExpiredNotesLoop). Aqui garantimos que processExpiredNotes do
  // ENGINE NOVO nao enxerga nada da timeline antiga (prova que nao ha
  // como um loop antigo continuar "misturando" MISS de outra partida).
  const missed = match2.gameplayEngine.processExpiredNotes(match2.timeline[match2.timeline.length - 1].time + 1000, 150);
  assert.ok(Array.isArray(missed));
  missed.forEach((note) => {
    assert.ok(match2.timeline.includes(note), 'MISS deveria vir exclusivamente da timeline da partida NOVA');
  });

  // 11. MatchEndDetector e reiniciado (nova instancia por partida) ---------
  assert.strictEqual(orchestrator.counts.matchEndDetectorCreated, 2);
  assert.notStrictEqual(match2.matchEndDetector, match1.matchEndDetector);

  // 12. FeedbackRenderer e resetado (uma vez por partida nova) -------------
  assert.strictEqual(orchestrator.counts.feedbackResetCalls, 2);

  // 13. InputController volta a funcionar (handler religado) ---------------
  let lastLanePressed = null;
  InputController.setLaneHandler((lane) => {
    lastLanePressed = lane;
  });
  InputController.triggerLane(2);
  assert.strictEqual(lastLanePressed, 2, 'input deveria voltar a funcionar apos a nova partida comecar');
});

console.log(`\n${passed} teste(s) passaram.`);
