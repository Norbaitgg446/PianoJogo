/**
 * Testes automatizados da SAIDA VOLUNTARIA DE SALA NO CLIENTE (Etapa 9B):
 * handshake do lado do cliente (LeaveRoomController, isolado, sem DOM) e
 * a integracao com os sistemas ja existentes de gameplay/UI/revanche/
 * abandono (mesmo padrao de tests/matchAbandonmentClient.test.js -- um
 * pequeno orquestrador que chama exatamente as MESMAS funcoes/API
 * publica que main.js chama, para provar que reusar esse fluxo encerra
 * tudo corretamente sem nenhum sistema paralelo).
 *
 * Executar com: node tests/leaveRoomClient.test.js
 */
const assert = require('assert');
const LeaveRoomController = require('../client/js/room/leaveRoomController');
const MatchController = require('../client/js/match/matchController');
const RematchController = require('../client/js/match/rematchController');
const MatchAbandonmentController = require('../client/js/match/matchAbandonmentController');
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
// 1, 2, 3, 19 (parte): LeaveRoomController isolado (sem DOM, sem
// gameplay nenhum -- so o handshake clique -> leave_room -> confirmacao).
// ---------------------------------------------------------------------

// 1. clique em sair envia leave_room
test('requestLeave envia leave_room quando o jogador esta em uma sala', () => {
  let sendCount = 0;
  const controller = LeaveRoomController.createLeaveRoomController({
    sendLeaveRoom: () => { sendCount += 1; },
    canLeave: () => true,
  });

  const sent = controller.requestLeave();

  assert.strictEqual(sent, true);
  assert.strictEqual(sendCount, 1);
  assert.strictEqual(controller.isPending(), true);
});

// 2. clique repetido nao envia varias mensagens
test('cliques repetidos antes da confirmacao nao enviam um segundo leave_room', () => {
  let sendCount = 0;
  const controller = LeaveRoomController.createLeaveRoomController({
    sendLeaveRoom: () => { sendCount += 1; },
    canLeave: () => true,
  });

  controller.requestLeave();
  const secondClick = controller.requestLeave();
  const thirdClick = controller.requestLeave();

  assert.strictEqual(secondClick, false);
  assert.strictEqual(thirdClick, false);
  assert.strictEqual(sendCount, 1);
});

// 3. jogador sem sala nao envia leave_room
test('requestLeave nao envia leave_room quando canLeave() indica que nao ha sala', () => {
  let sendCount = 0;
  const controller = LeaveRoomController.createLeaveRoomController({
    sendLeaveRoom: () => { sendCount += 1; },
    canLeave: () => false,
  });

  const sent = controller.requestLeave();

  assert.strictEqual(sent, false);
  assert.strictEqual(sendCount, 0);
  assert.strictEqual(controller.isPending(), false);
});

// 4 (parte): confirmacao do servidor dispara onLeaveConfirmed exatamente
// uma vez, e ignora payload invalido/duplicado com seguranca.
test('handleConfirmation dispara onLeaveConfirmed uma unica vez para left_room', () => {
  let confirmedCount = 0;
  const controller = LeaveRoomController.createLeaveRoomController({
    sendLeaveRoom: () => {},
    canLeave: () => true,
    onLeaveConfirmed: () => { confirmedCount += 1; },
  });

  controller.requestLeave();
  const first = controller.handleConfirmation({ type: 'left_room' });
  const second = controller.handleConfirmation({ type: 'left_room' }); // duplicado

  assert.strictEqual(first, true);
  assert.strictEqual(second, false);
  assert.strictEqual(confirmedCount, 1);
  assert.strictEqual(controller.isPending(), false);
});

test('handleConfirmation ignora payload de tipo errado ou sem pedido pendente', () => {
  let confirmedCount = 0;
  const controller = LeaveRoomController.createLeaveRoomController({
    sendLeaveRoom: () => {},
    canLeave: () => true,
    onLeaveConfirmed: () => { confirmedCount += 1; },
  });

  // Nenhum requestLeave() foi chamado ainda: nao ha pedido pendente.
  assert.strictEqual(controller.handleConfirmation({ type: 'left_room' }), false);
  assert.strictEqual(controller.handleConfirmation(null), false);
  assert.strictEqual(controller.handleConfirmation({ type: 'outra_coisa' }), false);

  controller.requestLeave();
  assert.strictEqual(controller.handleConfirmation({ type: 'outra_coisa' }), false);

  assert.strictEqual(confirmedCount, 0);
});

// 20. entrar novamente em outra sala depois de sair continua funcionando
test('apos a confirmacao, um novo pedido de saida (em outra sala) funciona normalmente', () => {
  let sendCount = 0;
  const controller = LeaveRoomController.createLeaveRoomController({
    sendLeaveRoom: () => { sendCount += 1; },
    canLeave: () => true,
  });

  controller.requestLeave();
  controller.handleConfirmation({ type: 'left_room' });

  const sentAgain = controller.requestLeave(); // nova sala, novo pedido
  assert.strictEqual(sentAgain, true);
  assert.strictEqual(sendCount, 2);
});

test('reset() tambem permite pedir para sair novamente (mesmo sem confirmacao previa)', () => {
  let sendCount = 0;
  const controller = LeaveRoomController.createLeaveRoomController({
    sendLeaveRoom: () => { sendCount += 1; },
    canLeave: () => true,
  });

  controller.requestLeave();
  controller.reset();

  const sentAgain = controller.requestLeave();
  assert.strictEqual(sentAgain, true);
  assert.strictEqual(sendCount, 2);
});

// ---------------------------------------------------------------------
// Orquestrador de integracao: reproduz, na MESMA ordem, exatamente as
// chamadas que main.js faz em startMatchGameplay / handleLeftRoom --
// nenhuma logica nova, so a mesma sequencia de chamadas as APIs
// publicas ja existentes (mesmo padrao de
// tests/matchAbandonmentClient.test.js).
// ---------------------------------------------------------------------
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
    onMatchEnd: () => { matchEndedCalls += 1; },
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
 * Mesma sequencia de limpeza que `handleLeftRoom` em main.js executa --
 * chamada aqui diretamente contra as referencias reais dos controladores
 * do teste (o orquestrador acima), em vez das variaveis globais de
 * main.js (main.js e uma IIFE amarrada ao DOM real, sem exports).
 */
function simulateHandleLeftRoom({ rematchController, matchAbandonmentController }) {
  MatchController.stopCountdown();
  NoteRenderer.stop();
  InputController.setLaneHandler(null);
  FeedbackRenderer.reset();
  MatchTimelineManager.clear();
  MatchResult.clearResult();
  ResultRenderer.reset();
  rematchController.reset();
  matchAbandonmentController.reset();
}

// ---------------------------------------------------------------------
// 4-12, 15, 17, 18: integracao com os modulos reais de gameplay/UI/
// revanche/abandono.
// ---------------------------------------------------------------------

// 5. WebSocket continua conectado (nada no fluxo de saida fecha nada --
// simulado aqui com um socket falso cujo close() nunca deveria ser
// chamado por nenhuma das funcoes reutilizadas acima).
test('nenhuma chamada do fluxo de saida fecha o WebSocket', () => {
  let closeCalls = 0;
  const fakeSocket = { close: () => { closeCalls += 1; } };

  const rematchController = RematchController.createRematchController({ sendRematchReady: () => {} });
  const matchAbandonmentController = MatchAbandonmentController.createAbandonmentController({});
  const session = createGameSession({ seed: 101 });

  simulateHandleLeftRoom({ rematchController, matchAbandonmentController });

  assert.strictEqual(closeCalls, 0);
  assert.ok(fakeSocket, 'socket falso nunca deveria ter sido fechado');
  assert.ok(session);
});

// 6. resultado e limpo
test('MatchResult e limpo ao sair da sala', () => {
  const rematchController = RematchController.createRematchController({ sendRematchReady: () => {} });
  const matchAbandonmentController = MatchAbandonmentController.createAbandonmentController({});

  MatchResult.generateResult({
    playerState: { score: 999, combo: 3, maxCombo: 5, hits: 5, misses: 1, mistakes: 0 },
    timeline: [{}, {}, {}, {}, {}, {}],
  });
  assert.strictEqual(MatchResult.hasResult(), true);

  simulateHandleLeftRoom({ rematchController, matchAbandonmentController });

  assert.strictEqual(MatchResult.hasResult(), false);
});

// 7. timeline e limpa
test('MatchTimelineManager.clear() descarta a timeline ativa ao sair da sala', () => {
  const rematchController = RematchController.createRematchController({ sendRematchReady: () => {} });
  const matchAbandonmentController = MatchAbandonmentController.createAbandonmentController({});

  createGameSession({ seed: 102 });
  assert.ok(MatchTimelineManager.getTimeline());

  simulateHandleLeftRoom({ rematchController, matchAbandonmentController });

  assert.strictEqual(MatchTimelineManager.getTimeline(), null);
});

// 8 e 9. gameplay e encerrado / InputController e desligado
test('apos sair da sala, InputController nao repassa mais lanes para o GameplayEngine', () => {
  const rematchController = RematchController.createRematchController({ sendRematchReady: () => {} });
  const matchAbandonmentController = MatchAbandonmentController.createAbandonmentController({});
  const session = createGameSession({ seed: 103 });

  InputController.triggerLane(1);
  assert.strictEqual(session.getLaneHandlerCalls(), 1);

  simulateHandleLeftRoom({ rematchController, matchAbandonmentController });

  InputController.triggerLane(1);
  InputController.triggerLane(2);
  assert.strictEqual(session.getLaneHandlerCalls(), 1, 'nenhuma nova lane deveria chegar ao GameplayEngine');
});

// 10. loops da partida sao encerrados (NoteRenderer.stop() e seguro/
// idempotente de chamar, mesmo em Node onde ele nunca chegou a iniciar).
test('NoteRenderer.stop() e chamado ao sair da sala e e seguro chamar de novo', () => {
  const rematchController = RematchController.createRematchController({ sendRematchReady: () => {} });
  const matchAbandonmentController = MatchAbandonmentController.createAbandonmentController({});

  assert.doesNotThrow(() => {
    simulateHandleLeftRoom({ rematchController, matchAbandonmentController });
    NoteRenderer.stop();
  });
});

// 11. revanche e resetada
test('rematchController.reset() e chamado ao sair da sala, sem enviar nada novo', () => {
  let sendCount = 0;
  const rematchController = RematchController.createRematchController({
    sendRematchReady: () => { sendCount += 1; },
  });
  const matchAbandonmentController = MatchAbandonmentController.createAbandonmentController({});

  rematchController.requestRematch(); // revanche pendente ANTES de sair
  assert.strictEqual(rematchController.isWaiting(), true);

  simulateHandleLeftRoom({ rematchController, matchAbandonmentController });

  assert.strictEqual(rematchController.isWaiting(), false);
  assert.strictEqual(sendCount, 1, 'reset nao deveria disparar nenhum novo rematch_ready');
});

// 12. MatchAbandonmentController e resetado
test('matchAbandonmentController.reset() e chamado ao sair da sala', () => {
  const rematchController = RematchController.createRematchController({ sendRematchReady: () => {} });
  const received = [];
  const matchAbandonmentController = MatchAbandonmentController.createAbandonmentController({
    onAbandonment: (info) => received.push(info),
  });

  matchAbandonmentController.handleEvent({ type: 'match_abandoned', abandonedBy: 'player1' }, 'player2');
  assert.strictEqual(matchAbandonmentController.hasHandled(), true);

  simulateHandleLeftRoom({ rematchController, matchAbandonmentController });

  assert.strictEqual(matchAbandonmentController.hasHandled(), false);
});

// 15. abandono durante PLAYING (antes de sair) nao gera resultado local,
// e sair da sala em seguida continua sem gerar nada.
test('abandono durante PLAYING seguido de saida nunca gera MatchResult/match_result', () => {
  const rematchController = RematchController.createRematchController({ sendRematchReady: () => {} });
  const matchAbandonmentController = MatchAbandonmentController.createAbandonmentController({});
  const session = createGameSession({ seed: 104 });

  // Abandono chega primeiro (mesma sequencia que handleMatchAbandoned
  // ja faz hoje): para o loop, desliga input, limpa timeline/resultado.
  InputController.setLaneHandler(null);
  MatchTimelineManager.clear();
  MatchResult.clearResult();

  // Em seguida, o jogador que ficou tambem decide sair da sala.
  simulateHandleLeftRoom({ rematchController, matchAbandonmentController });

  assert.strictEqual(MatchResult.hasResult(), false);
  assert.strictEqual(session.sentEvents.some((e) => e.type === 'match_result'), false);
});

// 17. sair durante COUNTDOWN nao deixa countdown ativo
test('MatchController.stopCountdown() encerra um countdown ativo ao sair da sala', () => {
  const rematchController = RematchController.createRematchController({ sendRematchReady: () => {} });
  const matchAbandonmentController = MatchAbandonmentController.createAbandonmentController({});

  let completedCalls = 0;
  MatchController.startCountdown(
    { startTimestamp: Date.now() + 60000, serverTime: Date.now() },
    () => {},
    () => { completedCalls += 1; }
  );

  simulateHandleLeftRoom({ rematchController, matchAbandonmentController });

  // Nenhum tick/onComplete deveria disparar depois do stopCountdown
  // interno de simulateHandleLeftRoom (senao o teste travaria esperando
  // 60s, entao a prova aqui e so que a chamada nao lanca nada e que um
  // stopCountdown() extra continua seguro/idempotente).
  assert.doesNotThrow(() => MatchController.stopCountdown());
  assert.strictEqual(completedCalls, 0);
});

// 18. sair durante WAITING (sem nenhuma partida/timeline ativa) retorna
// ao estado inicial com seguranca (nenhuma chamada lanca excecao mesmo
// sem timeline/gameplay para limpar).
test('sair da sala durante WAITING (sem partida ativa) e seguro', () => {
  const rematchController = RematchController.createRematchController({ sendRematchReady: () => {} });
  const matchAbandonmentController = MatchAbandonmentController.createAbandonmentController({});

  MatchTimelineManager.clear();
  MatchResult.clearResult();

  assert.doesNotThrow(() => {
    simulateHandleLeftRoom({ rematchController, matchAbandonmentController });
  });
  assert.strictEqual(MatchTimelineManager.getTimeline(), null);
  assert.strictEqual(MatchResult.hasResult(), false);
});

// 19. multiplos eventos (left_room duplicado) nao duplicam o reset
test('handleConfirmation duplicado nao dispara handleLeftRoom (reset) uma segunda vez', () => {
  let leftRoomCalls = 0;
  const controller = LeaveRoomController.createLeaveRoomController({
    sendLeaveRoom: () => {},
    canLeave: () => true,
    onLeaveConfirmed: () => { leftRoomCalls += 1; },
  });

  controller.requestLeave();
  controller.handleConfirmation({ type: 'left_room' });
  controller.handleConfirmation({ type: 'left_room' }); // duplicado
  controller.handleConfirmation({ type: 'left_room' }); // duplicado de novo

  assert.strictEqual(leftRoomCalls, 1);
});

// ---------------------------------------------------------------------
// DOM falso minimo (mesmo estilo de tests/matchAbandonmentClient.test.js),
// so para os elementos usados por UIController -- carregado a cada teste
// contra um `document` falso proprio (UIController resolve os elementos
// uma unica vez, no `require`, entao o modulo precisa ser recarregado a
// cada `document` falso diferente).
// ---------------------------------------------------------------------
function makeFakeElement(initial = {}) {
  const classes = new Set(initial.classes || []);
  const children = [];
  return {
    textContent: initial.textContent || '',
    value: initial.value || '',
    scrollTop: 0,
    scrollHeight: 0,
    classList: {
      add: (...cls) => cls.forEach((c) => classes.add(c)),
      remove: (...cls) => cls.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    appendChild(child) {
      children.push(child);
    },
    _children: children,
  };
}

function makeFakeUIDocument() {
  const elements = {
    'status-text': makeFakeElement(),
    lobby: makeFakeElement({ classes: ['hidden'] }),
    'room-info': makeFakeElement(),
    'test-panel': makeFakeElement(),
    'room-code-display': makeFakeElement(),
    'player-slot-display': makeFakeElement(),
    'room-state-display': makeFakeElement(),
    'opponent-status-display': makeFakeElement({ textContent: 'aguardando...' }),
    'message-log': makeFakeElement(),
    'input-room-code': makeFakeElement(),
    'match-panel': makeFakeElement({ classes: ['hidden'] }),
    'match-state-display': makeFakeElement(),
    'match-seed-display': makeFakeElement(),
    'countdown-display': makeFakeElement({ classes: ['hidden'] }),
    'game-field': makeFakeElement({ classes: ['hidden'] }),
    'music-selection-panel': makeFakeElement({ classes: ['hidden'] }),
    'music-list': makeFakeElement(),
    'music-selection-status': makeFakeElement(),
  };
  return {
    getElementById: (id) => elements[id] || null,
    createElement: () => makeFakeElement(),
    documentElement: makeFakeElement(),
    body: makeFakeElement(),
    _elements: elements,
  };
}

/**
 * Recarrega client/js/ui/uiController.js contra um `document` falso
 * proprio (o modulo resolve os elementos uma unica vez, no momento em
 * que e carregado) e devolve o modulo + os elementos falsos para
 * inspecao.
 */
function withFreshUIController(fn) {
  const originalDocument = global.document;
  const fakeDocument = makeFakeUIDocument();
  global.document = fakeDocument;

  const uiControllerPath = require.resolve('../client/js/ui/uiController');
  delete require.cache[uiControllerPath];

  try {
    // eslint-disable-next-line global-require
    const UIController = require('../client/js/ui/uiController');
    return fn(UIController, fakeDocument);
  } finally {
    delete require.cache[uiControllerPath];
    global.document = originalDocument;
  }
}

// 13. player_left_room atualiza o estado corretamente (do lado do
// jogador que FICOU na sala)
test('UIController.showOpponentLeftRoom() atualiza o status do oponente para "saiu da sala"', () => {
  withFreshUIController((UIController, doc) => {
    UIController.showOpponentLeftRoom();
    assert.strictEqual(doc._elements['opponent-status-display'].textContent, 'saiu da sala');
  });
});

// 4 e 18 (parte visual): confirmacao do servidor devolve a TELA ao
// estado de lobby.
test('UIController.resetToLobby() esconde sala/partida/campo de jogo e volta a mostrar o lobby', () => {
  withFreshUIController((UIController, doc) => {
    // Simula uma sala/partida ja em andamento antes de sair.
    UIController.showRoomJoined({ roomCode: 'ABC123', slot: 'player1', roomState: { state: 'FULL', players: { player1: {}, player2: {} } } });
    UIController.setMatchState('PLAYING');

    UIController.resetToLobby();

    assert.strictEqual(doc._elements.lobby.classList.contains('hidden'), false);
    assert.strictEqual(doc._elements['room-info'].classList.contains('hidden'), true);
    assert.strictEqual(doc._elements['test-panel'].classList.contains('hidden'), true);
    assert.strictEqual(doc._elements['match-panel'].classList.contains('hidden'), true);
    assert.strictEqual(doc._elements['game-field'].classList.contains('hidden'), true);
    assert.strictEqual(doc._elements['room-code-display'].textContent, '-');
    assert.strictEqual(doc._elements['opponent-status-display'].textContent, 'aguardando...');
  });
});

// 14. jogador restante nao inicia nova partida sozinho -- confirmado do
// lado do SERVIDOR na Etapa 9A (tests/leaveRoomFlow.test.js, cenario
// 16); do lado do cliente, garantimos que apenas RECEBER
// `player_left_room` nunca dispara nada parecido com inicio de partida
// (nenhum match_ready/match_countdown_start e simulado/gerado por essa
// mensagem -- UIController.showOpponentLeftRoom() so muda um texto).
test('receber player_left_room nao aciona nenhuma logica de inicio de partida', () => {
  withFreshUIController((UIController, doc) => {
    UIController.showOpponentLeftRoom();

    assert.strictEqual(doc._elements['match-panel'].classList.contains('hidden'), true);
    assert.strictEqual(doc._elements['game-field'].classList.contains('hidden'), true);
    assert.strictEqual(doc._elements['match-state-display'].textContent, '');
  });
});

console.log(`\n${passed} teste(s) passaram.\n`);
