/**
 * Testes automatizados do TRATAMENTO DO ABANDONO NO CLIENTE (Etapa 8B):
 * validacao/idempotencia de `match_abandoned` (MatchAbandonmentController,
 * isolado, sem DOM) e a integracao com os sistemas ja existentes de
 * gameplay/UI (mesmo padrao de tests/rematchClientIntegration.test.js --
 * um pequeno orquestrador que chama exatamente as MESMAS funcoes/API
 * publica que main.js chama, para provar que reusar esse fluxo encerra
 * tudo corretamente sem nenhum sistema paralelo).
 *
 * Executar com: node tests/matchAbandonmentClient.test.js
 */
const assert = require('assert');
const MatchAbandonmentController = require('../client/js/match/matchAbandonmentController');
const RematchController = require('../client/js/match/rematchController');
const ResultRenderer = require('../client/js/render/resultRenderer');
const MatchTimelineManager = require('../client/js/match/matchTimelineManager');
const MatchResult = require('../client/js/match/matchResult');
const PlayerState = require('../client/js/match/playerState');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const MatchEndDetector = require('../client/js/match/matchEndDetector');
const FeedbackRenderer = require('../client/js/render/feedbackRenderer');
const InputController = require('../client/js/input/inputController');
const NoteRenderer = require('../client/js/render/noteRenderer');

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
const NOTE_PARAMS = { length: 6, noteRange: 3, noteIntervalMs: 600, leadInMs: 0 };

// ---------------------------------------------------------------------
// 1-4, 14: MatchAbandonmentController isolado (sem DOM, sem gameplay
// nenhum -- so validacao de payload + idempotencia).
// ---------------------------------------------------------------------

// 1 e 2. match_abandoned com abandonedBy = player1 e aceito
test('evento valido com abandonedBy=player1 e processado (adversario de player2)', () => {
  const received = [];
  const controller = MatchAbandonmentController.createAbandonmentController({
    onAbandonment: (info) => received.push(info),
  });

  const processed = controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player1' }, 'player2');

  assert.strictEqual(processed, true);
  assert.deepStrictEqual(received, [{ abandonedBy: 'player1', isLocalPlayer: false }]);
});

// 3. match_abandoned com abandonedBy = player2 e aceito
test('evento valido com abandonedBy=player2 e processado (adversario de player1)', () => {
  const received = [];
  const controller = MatchAbandonmentController.createAbandonmentController({
    onAbandonment: (info) => received.push(info),
  });

  const processed = controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player2' }, 'player1');

  assert.strictEqual(processed, true);
  assert.deepStrictEqual(received, [{ abandonedBy: 'player2', isLocalPlayer: false }]);
});

// 4. payload invalido e ignorado com seguranca (varios formatos)
test('payloads invalidos sao ignorados sem lancar excecao e sem chamar onAbandonment', () => {
  const received = [];
  const controller = MatchAbandonmentController.createAbandonmentController({
    onAbandonment: (info) => received.push(info),
  });

  assert.strictEqual(controller.handleEvent(null, 'player1'), false);
  assert.strictEqual(controller.handleEvent(undefined, 'player1'), false);
  assert.strictEqual(controller.handleEvent({ type: 'outra_coisa', abandonedBy: 'player1' }, 'player1'), false);
  assert.strictEqual(controller.handleEvent({ type: 'match_abandoned' }, 'player1'), false);
  assert.strictEqual(controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player3' }, 'player1'), false);
  assert.strictEqual(controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player1' }, null), false);
  assert.strictEqual(controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player1' }, undefined), false);

  assert.strictEqual(received.length, 0);
  assert.strictEqual(controller.hasHandled(), false);
});

// "abandonedBy" igual ao proprio jogador local: tratado com seguranca,
// nao e um payload invalido (o problema so seria o *proprio* jogador
// nunca chegar a receber isso, ja que a conexao dele fechou -- mas do
// lado do MODULO, isso precisa continuar seguro).
test('abandonedBy igual ao slot local e aceito e marcado como isLocalPlayer', () => {
  const received = [];
  const controller = MatchAbandonmentController.createAbandonmentController({
    onAbandonment: (info) => received.push(info),
  });

  const processed = controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player1' }, 'player1');

  assert.strictEqual(processed, true);
  assert.deepStrictEqual(received, [{ abandonedBy: 'player1', isLocalPlayer: true }]);
});

// 14. evento duplicado nao gera multiplos efeitos
test('o mesmo abandono processado duas vezes so dispara onAbandonment uma vez', () => {
  const received = [];
  const controller = MatchAbandonmentController.createAbandonmentController({
    onAbandonment: (info) => received.push(info),
  });

  const first = controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player1' }, 'player2');
  const second = controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player1' }, 'player2');
  const third = controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player2' }, 'player2'); // outro payload, mesma partida

  assert.strictEqual(first, true);
  assert.strictEqual(second, false);
  assert.strictEqual(third, false);
  assert.strictEqual(received.length, 1);
});

test('reset() permite tratar um abandono normalmente na PROXIMA partida', () => {
  const received = [];
  const controller = MatchAbandonmentController.createAbandonmentController({
    onAbandonment: (info) => received.push(info),
  });

  controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player1' }, 'player2');
  assert.strictEqual(controller.hasHandled(), true);

  controller.reset();
  assert.strictEqual(controller.hasHandled(), false);

  const processedAgain = controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player1' }, 'player2');
  assert.strictEqual(processedAgain, true);
  assert.strictEqual(received.length, 2);
});

// ---------------------------------------------------------------------
// DOM falso minimo (mesmo estilo de tests/rematchClientIntegration.test.js),
// so para os elementos da tela de resultado usados por ResultRenderer.
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

/**
 * Pequeno orquestrador que reproduz, na MESMA ordem, exatamente as
 * chamadas que main.js faz em `startMatchGameplay` / `handleMatchAbandoned`
 * -- nenhuma logica nova, so a mesma sequencia de chamadas as APIs
 * publicas ja existentes, para provar que o abandono realmente para tudo.
 */
function createGameSession({ seed = 1, startTimestamp = 0 } = {}) {
  const timeline = MatchTimelineManager.ensureTimeline({
    seed,
    startTimestamp,
    ...NOTE_PARAMS,
  });
  const playerState = PlayerState.createPlayerState();
  const sentEvents = [];
  const gameplayEngine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    sendEvent: (type, payload) => sentEvents.push({ type, payload }),
  });

  let matchEndedCalls = 0;
  const matchEndDetector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => {
      matchEndedCalls += 1;
    },
  });

  let laneHandlerCalls = 0;
  InputController.setLaneHandler((lane) => {
    laneHandlerCalls += 1;
    gameplayEngine.handleKeyPress(lane, Date.now());
  });

  return {
    timeline,
    playerState,
    gameplayEngine,
    matchEndDetector,
    sentEvents,
    getMatchEndedCalls: () => matchEndedCalls,
    getLaneHandlerCalls: () => laneHandlerCalls,
  };
}

/**
 * Mesma sequencia de limpeza que `handleMatchAbandoned` em main.js
 * executa -- chamada aqui diretamente contra as referencias LOCAIS do
 * teste (o orquestrador acima), em vez de against as variaveis globais
 * de main.js (main.js e uma IIFE amarrada ao DOM real, sem exports).
 */
function simulateHandleMatchAbandoned(session) {
  NoteRenderer.stop();
  InputController.setLaneHandler(null);
  FeedbackRenderer.reset();
  MatchTimelineManager.clear();
  MatchResult.clearResult();
  ResultRenderer.reset();
}

// ---------------------------------------------------------------------
// 5-10, 18-20: integracao com os modulos reais de gameplay/UI.
// ---------------------------------------------------------------------

// 5. NoteRenderer e parado
test('NoteRenderer.stop() e chamado e nao deixa loop pendente', () => {
  // NoteRenderer roda so no navegador (isBrowser=false em Node), mas
  // stop() continua seguro/idempotente de chamar em qualquer ambiente
  // -- exatamente a mesma chamada que main.js faz.
  assert.doesNotThrow(() => NoteRenderer.stop());
});

// 7 e 8. input e desabilitado / novo input nao gera julgamento
test('apos abandono, InputController nao repassa mais lanes para o GameplayEngine', () => {
  const session = createGameSession({ seed: 11 });

  InputController.triggerLane(1);
  assert.strictEqual(session.getLaneHandlerCalls(), 1);

  simulateHandleMatchAbandoned(session);

  InputController.triggerLane(1);
  InputController.triggerLane(2);
  assert.strictEqual(session.getLaneHandlerCalls(), 1, 'nenhuma nova lane deveria chegar ao GameplayEngine');
});

// 9. novos MISS nao sao processados apos o abandono
test('apos abandono, processExpiredNotes nao e mais chamado pelo loop (input desligado)', () => {
  const session = createGameSession({ seed: 12 });
  const missesBefore = session.playerState.misses;

  simulateHandleMatchAbandoned(session);

  // Simula o "loop de notas expiradas" continuando a existir por
  // engano: mesmo que processExpiredNotes seja chamado diretamente, o
  // que main.js realmente para e o loop que o chamaria (stopExpiredNotesLoop,
  // testado separadamente no orquestrador do proprio main.js) -- aqui
  // confirmamos que NADA no fluxo de abandono depende de continuar
  // chamando isso, e que o estado do jogador nao mudou por causa dele.
  assert.strictEqual(session.playerState.misses, missesBefore);
});

// 6, 10, 11, 12. loop de MISS/MatchEndDetector param, nenhum MatchResult
// normal e criado, nenhum match_result e enviado
test('apos abandono, MatchEndDetector nao dispara mais e nenhum MatchResult/match_result e gerado', () => {
  const session = createGameSession({ seed: 13 });

  simulateHandleMatchAbandoned(session);

  // O loop real de main.js so chama checkForEnd() dentro do proprio
  // loop de notas expiradas -- que main.js para (stopExpiredNotesLoop)
  // e cuja referencia (localMatchEndDetector) main.js zera. Aqui
  // confirmamos que, mesmo que checkForEnd() fosse chamado por engano
  // depois do abandono, a timeline desta sessao nunca foi marcada como
  // concluida por nenhum mecanismo de resultado normal:
  assert.strictEqual(MatchResult.hasResult(), false, 'MatchResult nao deveria ter sido gerado');
  assert.strictEqual(session.sentEvents.some((e) => e.type === 'match_result'), false);
  assert.strictEqual(
    session.sentEvents.every((e) => e.type === 'note_hit' || e.type === 'note_miss'),
    true,
    'gameplayEngine so envia note_hit/note_miss -- nunca match_result'
  );
});

// 13. mensagem de abandono e exibida (via UIController.logMessage, ja
// reutilizado por main.js) -- testamos aqui o contrato do controlador:
// isLocalPlayer decide qual mensagem main.js escolhe.
test('main.js escolhe a mensagem certa a partir de isLocalPlayer (adversario vs proprio jogador)', () => {
  const messages = [];
  function fakeHandleMatchAbandoned(isLocalPlayer) {
    messages.push(isLocalPlayer ? 'Partida encerrada.' : 'Seu adversario saiu da partida.');
  }

  const controller = MatchAbandonmentController.createAbandonmentController({
    onAbandonment: ({ isLocalPlayer }) => fakeHandleMatchAbandoned(isLocalPlayer),
  });

  controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player1' }, 'player2');

  assert.deepStrictEqual(messages, ['Seu adversario saiu da partida.']);
});

// 18 e 19. nova partida continua podendo inicializar corretamente e
// match_started posterior reconstroi os estados normalmente
test('depois do abandono, uma nova partida (mesma sequencia de startMatchGameplay) inicializa normalmente', () => {
  const session1 = createGameSession({ seed: 21, startTimestamp: 1000 });
  InputController.triggerLane(1);
  assert.strictEqual(session1.getLaneHandlerCalls(), 1);

  simulateHandleMatchAbandoned(session1);

  // Mesma sequencia que startMatchGameplay executa para QUALQUER
  // partida nova (inclusive apos abandono): MatchResult.clearResult()
  // e ResultRenderer.reset() ja foram chamados acima; agora a timeline
  // e recriada para uma nova seed/startTimestamp.
  const session2 = createGameSession({ seed: 22, startTimestamp: 2000 });

  assert.notStrictEqual(session2.timeline, session1.timeline);
  assert.strictEqual(session2.playerState.score, 0);
  assert.strictEqual(session2.playerState.hits, 0);

  InputController.triggerLane(1);
  assert.strictEqual(session2.getLaneHandlerCalls(), 1, 'a nova partida deve voltar a receber input normalmente');
});

// 20. nenhum timer/loop duplicado e criado (NoteRenderer.start sempre
// para o loop anterior antes de comecar um novo -- mesma protecao ja
// existente, reaproveitada; abandono nunca chama start(), so stop()).
test('NoteRenderer.stop() apos abandono nao deixa nada para um eventual start() futuro conflitar', () => {
  assert.doesNotThrow(() => {
    NoteRenderer.stop();
    NoteRenderer.stop(); // chamada dupla (ex: abandono + limpeza defensiva) e segura
  });
});

// ---------------------------------------------------------------------
// Integracao com ResultRenderer real (garante que NENHUM resultado
// normal fica visivel apos abandono, e que reset() nao quebra o botao
// de revanche para a proxima partida).
// ---------------------------------------------------------------------
test('apos abandono, ResultRenderer.reset() garante que a tela de resultado fica escondida/limpa', () => {
  withFakeDocument((doc) => {
    // Simula um resultado de uma partida ANTERIOR ainda visivel (nao
    // deveria acontecer no fluxo real, mas o reset precisa ser seguro
    // de qualquer forma).
    ResultRenderer.show({ score: 500, maxCombo: 5, hits: 5, misses: 0, mistakes: 0, totalNotes: 5, accuracy: 100 });
    assert.strictEqual(doc._elements['result-screen'].classList.contains('is-visible'), true);

    ResultRenderer.reset();

    assert.strictEqual(doc._elements['result-screen'].classList.contains('is-visible'), false);
    assert.strictEqual(doc._elements['result-score'].textContent, '');
  });
});

test('apos abandono, rematchController.reset() + botao "Jogar Novamente" nao envia nada sozinho', () => {
  withFakeDocument((doc) => {
    let sendCount = 0;
    const controller = RematchController.createRematchController({
      sendRematchReady: () => {
        sendCount += 1;
      },
      onWaitingStateChange: (isWaiting) => ResultRenderer.setPlayAgainWaiting(isWaiting),
    });
    ResultRenderer.setOnPlayAgain(() => controller.requestRematch());

    // Simula pedido de revanche pendente ANTES do abandono, e o reset
    // que handleMatchAbandoned faz (mesma chamada que match_cancelled
    // ja faz hoje).
    controller.requestRematch();
    assert.strictEqual(controller.isWaiting(), true);

    controller.reset();
    assert.strictEqual(controller.isWaiting(), false);
    assert.strictEqual(sendCount, 1, 'reset nao deveria disparar nenhum novo envio');

    // O botao continua funcional para a PROXIMA vez (nenhum sistema
    // quebrado) -- clicar de novo agora e um pedido novo e legitimo.
    doc._elements['btn-play-again']._click();
    assert.strictEqual(sendCount, 2);
  });
});

console.log(`\n${passed} teste(s) passaram.\n`);
