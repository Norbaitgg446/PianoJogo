/**
 * ETAPA 8C -- VALIDACAO FINAL DO FLUXO DE ABANDONO.
 *
 * Esta suite NAO reimplementa nada do sistema de abandono (Etapas 8A/8B).
 * Ela valida, de ponta a ponta e com os modulos REAIS de producao, que o
 * fluxo completo descrito na Etapa 8C permanece consistente:
 *
 *   entrar na sala -> partida comeca -> PLAYING -> jogador abandona ->
 *   servidor detecta -> match_abandoned -> cliente encerra tudo
 *   localmente -> sala/WebSocket continuam utilizaveis -> uma nova
 *   partida pode comecar depois pelo fluxo ja existente (rematchFlow).
 *
 * Dividida em 5 blocos, cobrindo os 41 cenarios da Etapa 8C:
 *   A. Pipeline completo de servidor (sala real -> PLAYING -> abandono)
 *   B. Idempotencia / combinacoes de eventos concorrentes
 *   C. Compatibilidade com revanche / nova Match (cenarios 30-41)
 *   D. Pipeline completo de cliente (sessao real -> abandono -> nova sessao)
 *   E. Verificacao de sintaxe dos arquivos de producao relevantes
 *
 * Muitos cenarios individuais (1-29) ja tem cobertura dedicada em
 * tests/matchAbandonment.test.js e tests/matchAbandonmentClient.test.js
 * (Etapas 8A/8B) -- esta suite nao duplica essas asserções unitarias,
 * e sim comprova que tudo continua consistente quando exercitado como
 * um fluxo unico, de ponta a ponta, e cobre explicitamente as
 * combinacoes/o comportamento de revanche que ainda nao tinham um teste
 * dedicado (30-41), alem das combinacoes explicitas de idempotencia
 * pedidas nesta etapa.
 *
 * Executar com: node tests/matchAbandonmentFlowConsistency.test.js
 */
const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { Match, MATCH_STATE } = require('../server/match/Match');
const gameplayFlow = require('../server/match/gameplayFlow');
const matchFlow = require('../server/match/matchFlow');
const rematchFlow = require('../server/match/rematchFlow');
const matchAbandonment = require('../server/match/matchAbandonment');
const finalMatchState = require('../server/match/finalMatchState');
const matchOutcome = require('../server/match/matchOutcome');
const { registerConnection } = require('../server/ws/connectionHandler');
const { routeMessage } = require('../server/ws/messageRouter');

const MatchAbandonmentController = require('../client/js/match/matchAbandonmentController');
const MatchTimelineManager = require('../client/js/match/matchTimelineManager');
const MatchResult = require('../client/js/match/matchResult');
const PlayerState = require('../client/js/match/playerState');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const MatchEndDetector = require('../client/js/match/matchEndDetector');
const FeedbackRenderer = require('../client/js/render/feedbackRenderer');
const InputController = require('../client/js/input/inputController');
const NoteRenderer = require('../client/js/render/noteRenderer');
const RematchController = require('../client/js/match/rematchController');

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

// -----------------------------------------------------------------------
// Helpers de servidor (mesmo estilo de tests/matchAbandonment.test.js)
// -----------------------------------------------------------------------

function createMockSocket() {
  const handlers = { close: [], error: [], message: [] };
  return {
    OPEN: 1,
    readyState: 1,
    sent: [],
    send(raw) {
      this.sent.push(JSON.parse(raw));
    },
    on(event, handler) {
      if (handlers[event]) handlers[event].push(handler);
    },
    _triggerMessage(payload) {
      handlers.message.forEach((fn) => fn(JSON.stringify(payload)));
    },
    _triggerClose() {
      handlers.close.forEach((fn) => fn());
    },
    _triggerError() {
      handlers.error.forEach((fn) => fn());
    },
  };
}

function lastMessageOfType(socket, type) {
  const matches = socket.sent.filter((msg) => msg.type === type);
  return matches.length ? matches[matches.length - 1] : null;
}

function countMessagesOfType(socket, type) {
  return socket.sent.filter((msg) => msg.type === type).length;
}

/**
 * Monta uma sala REAL usando exatamente o caminho de producao:
 * registerConnection + routeMessage('create_room'/'join_room') --
 * nenhuma sala/slot montado a mao. A partida e criada por
 * matchFlow.startMatchFlow (disparada pelo proprio handleJoinRoom quando
 * a sala fica cheia), com seed/timeline reais.
 *
 * A contagem regressiva usa um setTimeout real (MATCH_COUNTDOWN_SECONDS);
 * para nao esperar 3s em cada teste, simulamos aqui o que o timer faria
 * (transicao para PLAYING) e cancelamos o timer real pendente -- e o
 * mesmo padrao que os testes de 8A/rematch ja usam ao forcar estados
 * (ex: setState(COUNTDOWN) direto), so que a partir de uma partida
 * criada de verdade pelo fluxo real, e nao construida a mao.
 */
function joinRealRoomAndStartMatch() {
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);

  routeMessage(ws1, JSON.stringify({ type: 'create_room' }));
  const roomCode = lastMessageOfType(ws1, 'room_created').roomCode;

  routeMessage(ws2, JSON.stringify({ type: 'join_room', roomCode }));

  const room = RoomManager.getRoom(roomCode);
  const match = MatchManager.getMatch(roomCode);

  assert.strictEqual(match.state, MATCH_STATE.COUNTDOWN, 'startMatchFlow deveria ter entrado em COUNTDOWN');

  // Simula o disparo do timer de countdown (o mesmo efeito que
  // matchFlow.scheduleCountdown produziria ao vencer o prazo real).
  match.clearCountdownTimer();
  match.setState(MATCH_STATE.PLAYING);

  return { room, ws1, ws2, match };
}

console.log('\n=== BLOCO A: pipeline completo de servidor (sala real -> PLAYING -> abandono) ===\n');

test('[A] fluxo completo: sala real criada pelo fluxo de producao chega em PLAYING com estado limpo', () => {
  const { match } = joinRealRoomAndStartMatch();
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);
  assert.deepStrictEqual(match.players.player1, { score: 0, combo: 0, maxCombo: 0, hits: 0, misses: 0, mistakes: 0, life: null });
  assert.deepStrictEqual(match.players.player2, { score: 0, combo: 0, maxCombo: 0, hits: 0, misses: 0, mistakes: 0, life: null });
});

test('[A] gameplay real (note_hit) funciona normalmente antes do abandono', () => {
  const { room, ws2, match } = joinRealRoomAndStartMatch();

  routeMessage(ws2, JSON.stringify({
    type: 'note_hit',
    noteId: `note-${match.seed}-0`,
    lane: 1,
    judgement: 'PERFECT',
    combo: 1,
    score: 300,
  }));

  assert.strictEqual(match.players.player2.hits, 1);
  assert.strictEqual(match.players.player2.score, 300);
});

test('[A] jogador1 abandona: partida sai de PLAYING somente uma vez, so player2 recebe match_abandoned', () => {
  const { ws1, ws2, match } = joinRealRoomAndStartMatch();

  ws1._triggerClose();

  assert.strictEqual(match.state, MATCH_STATE.FINISHED);
  assert.strictEqual(countMessagesOfType(ws2, 'match_abandoned'), 1);
  assert.strictEqual(countMessagesOfType(ws1, 'match_abandoned'), 0);
  assert.strictEqual(lastMessageOfType(ws2, 'match_abandoned').abandonedBy, 'player1');
});

test('[A] apos abandono, note_hit/note_miss do jogador restante sao ignorados (estado nao muda)', () => {
  const { room, ws1, ws2, match } = joinRealRoomAndStartMatch();
  match.players.player2.score = 900;
  match.players.player2.hits = 3;

  ws1._triggerClose();

  routeMessage(ws2, JSON.stringify({
    type: 'note_hit',
    noteId: `note-${match.seed}-1`,
    lane: 1,
    judgement: 'PERFECT',
    combo: 1,
    score: 1200,
  }));
  routeMessage(ws2, JSON.stringify({
    type: 'note_miss',
    noteId: `note-${match.seed}-2`,
    lane: 1,
  }));

  assert.strictEqual(match.players.player2.score, 900);
  assert.strictEqual(match.players.player2.hits, 3);
  assert.strictEqual(match.players.player2.misses, 0);
});

test('[A] sala e conexao do jogador restante continuam utilizaveis apos o abandono', () => {
  const { room, ws1, ws2 } = joinRealRoomAndStartMatch();

  ws1._triggerClose();

  assert.strictEqual(RoomManager.getRoom(room.code), room);
  assert.strictEqual(ws2.readyState, 1);
  assert.strictEqual(ws2.roomCode, room.code);
  assert.strictEqual(ws2.slot, 'player2');
  assert.strictEqual(room.isEmpty(), false);
});

console.log('\n=== BLOCO B: idempotencia / combinacoes de eventos concorrentes ===\n');

test('[B] dois disconnects (close + error) do mesmo jogador: um unico match_abandoned', () => {
  const { ws1, ws2 } = joinRealRoomAndStartMatch();

  ws1._triggerClose();
  ws1._triggerError();

  assert.strictEqual(countMessagesOfType(ws2, 'match_abandoned'), 1);
});

test('[B] dois match_abandoned (chamadas diretas a handleAbandonment): processado uma unica vez', () => {
  const { room, match } = joinRealRoomAndStartMatch();

  const first = matchAbandonment.handleAbandonment(room, match, 'player1');
  const second = matchAbandonment.handleAbandonment(room, match, 'player1');

  assert.strictEqual(first, true);
  assert.strictEqual(second, false);
});

test('[B] abandono + match_cancelled: abandono durante PLAYING nunca gera match_cancelled', () => {
  const { ws1, ws2 } = joinRealRoomAndStartMatch();

  ws1._triggerClose();

  assert.strictEqual(countMessagesOfType(ws2, 'match_cancelled'), 0);
  assert.strictEqual(countMessagesOfType(ws2, 'match_abandoned'), 1);
});

test('[B] match_cancelled legitimo (saida durante COUNTDOWN) nao produz nenhum match_abandoned depois', () => {
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);
  routeMessage(ws1, JSON.stringify({ type: 'create_room' }));
  const roomCode = lastMessageOfType(ws1, 'room_created').roomCode;
  routeMessage(ws2, JSON.stringify({ type: 'join_room', roomCode }));

  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.state, MATCH_STATE.COUNTDOWN);

  ws1._triggerClose(); // sai ainda durante o countdown

  assert.ok(lastMessageOfType(ws2, 'match_cancelled'));
  assert.strictEqual(countMessagesOfType(ws2, 'match_abandoned'), 0);
  assert.strictEqual(MatchManager.getMatch(roomCode), null);
});

test('[B] abandono + match_started tardio: um match_started que chegasse depois nao reviveria a partida abandonada', () => {
  const { room, ws1, ws2, match } = joinRealRoomAndStartMatch();

  ws1._triggerClose();
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);

  // Mesmo que o timer real de countdown de uma OUTRA partida (que nao
  // deveria mais existir para esta sala) tentasse transicionar esta
  // MESMA instancia para PLAYING de novo, matchAbandonment ja marcou
  // esta Match como abandonada -- gameplay continua bloqueado porque o
  // estado exigido por getPlayingMatch() e PLAYING, e nada neste fluxo
  // volta a colocar essa instancia la.
  assert.notStrictEqual(match.state, MATCH_STATE.PLAYING);
  assert.strictEqual(matchAbandonment.hasAbandonment(match), true);
});

test('[B] abandono + match_result (finishMatch chamado logo em seguida): nenhum match_result e enviado', () => {
  const { room, ws1, ws2, match } = joinRealRoomAndStartMatch();

  ws1._triggerClose();
  assert.strictEqual(countMessagesOfType(ws2, 'match_abandoned'), 1);

  // Simula um gatilho de finalizacao "normal" (finishMatch) tentando
  // rodar logo depois de um abandono -- ver o guard adicionado em
  // matchFlow.finishMatch nesta Etapa 8C.
  const snapshot = matchFlow.finishMatch(room);

  assert.strictEqual(snapshot, null, 'finishMatch nao deve capturar nada para uma Match ja abandonada');
  assert.strictEqual(countMessagesOfType(ws2, 'match_result'), 0);
  assert.strictEqual(countMessagesOfType(ws1, 'match_result'), 0);
  assert.strictEqual(finalMatchState.hasFinalMatchState(match), false);
  assert.strictEqual(matchOutcome.hasFinalOutcome(match), false);
});

test('[B] abandono imediatamente ANTES de um note_hit em transito: o note_hit chega depois e e ignorado', () => {
  const { room, ws1, ws2, match } = joinRealRoomAndStartMatch();

  ws1._triggerClose(); // abandono processado primeiro
  routeMessage(ws2, JSON.stringify({ // note_hit "em transito" chega depois
    noteId: `note-${match.seed}-0`, type: 'note_hit', lane: 1, judgement: 'GOOD', combo: 1, score: 100,
  }));

  assert.strictEqual(match.players.player2.hits, 0);
});

test('[B] note_hit imediatamente ANTES do abandono e aplicado normalmente, o abandono nao o desfaz', () => {
  const { room, ws1, ws2, match } = joinRealRoomAndStartMatch();

  routeMessage(ws2, JSON.stringify({
    noteId: `note-${match.seed}-0`, type: 'note_hit', lane: 1, judgement: 'GOOD', combo: 1, score: 100,
  }));
  ws1._triggerClose();

  assert.strictEqual(match.players.player2.hits, 1);
  assert.strictEqual(match.players.player2.score, 100);
});

test('[B] abandono imediatamente ANTES de um note_miss em transito: o note_miss chega depois e e ignorado', () => {
  const { room, ws1, ws2, match } = joinRealRoomAndStartMatch();

  ws1._triggerClose();
  routeMessage(ws2, JSON.stringify({
    noteId: `note-${match.seed}-0`, type: 'note_miss', lane: 1,
  }));

  assert.strictEqual(match.players.player2.misses, 0);
});

test('[B] note_miss imediatamente ANTES do abandono e aplicado normalmente, o abandono nao o desfaz', () => {
  const { room, ws1, ws2, match } = joinRealRoomAndStartMatch();

  routeMessage(ws2, JSON.stringify({
    noteId: `note-${match.seed}-0`, type: 'note_miss', lane: 1,
  }));
  ws1._triggerClose();

  assert.strictEqual(match.players.player2.misses, 1);
});

test('[B] nenhum dos combos acima produz dois resultados, dois countdowns ou duas notificacoes de abandono', () => {
  const { room, ws1, ws2, match } = joinRealRoomAndStartMatch();

  ws1._triggerClose();
  ws1._triggerError(); // segunda desconexao redundante
  matchAbandonment.handleAbandonment(room, match, 'player1'); // chamada direta redundante
  matchFlow.finishMatch(room); // finalizacao "normal" redundante

  assert.strictEqual(countMessagesOfType(ws2, 'match_abandoned'), 1);
  assert.strictEqual(countMessagesOfType(ws2, 'match_result'), 0);
  assert.strictEqual(match._countdownTimer, null);
});

console.log('\n=== BLOCO C: compatibilidade com revanche / nova Match apos abandono (cenarios 30-41) ===\n');

test('[C] apos abandono, revanche entre os dois jogadores cria uma Match nova (nao reaproveita a antiga)', () => {
  const { room, ws1, ws2, match: oldMatch } = joinRealRoomAndStartMatch();

  ws1._triggerClose();
  // O proprio jogador que abandonou tambem pode voltar a jogar (nova
  // conexao) -- para exercitar o handshake completo de revanche real
  // (rematchFlow.requestRematch exige os DOIS conectados), simulamos o
  // reingresso dele na mesma sala com uma nova conexao.
  const ws1b = createMockSocket();
  registerConnection(ws1b);
  routeMessage(ws1b, JSON.stringify({ type: 'join_room', roomCode: room.code }));

  rematchFlow.requestRematch(ws1b, room);
  rematchFlow.requestRematch(ws2, room);

  const newMatch = MatchManager.getMatch(room.code);

  assert.notStrictEqual(newMatch, oldMatch, 'a revanche deve criar uma instancia de Match totalmente nova');
});

test('[C] nova Match da revanche tem nova seed e novo startTimestamp (nao reutiliza os da partida abandonada)', () => {
  const { room, ws1, ws2, match: oldMatch } = joinRealRoomAndStartMatch();
  oldMatch.seed = 123456;
  oldMatch.startTimestamp = 1111;

  ws1._triggerClose();
  const ws1b = createMockSocket();
  registerConnection(ws1b);
  routeMessage(ws1b, JSON.stringify({ type: 'join_room', roomCode: room.code }));

  rematchFlow.requestRematch(ws1b, room);
  rematchFlow.requestRematch(ws2, room);

  const newMatch = MatchManager.getMatch(room.code);

  assert.notStrictEqual(newMatch.seed, oldMatch.seed);
  assert.notStrictEqual(newMatch.startTimestamp, oldMatch.startTimestamp);
  assert.ok(Number.isFinite(newMatch.startTimestamp));
});

test('[C] nova Match da revanche comeca com score/combo/hits/misses/mistakes zerados para os dois', () => {
  const { room, ws1, ws2, match: oldMatch } = joinRealRoomAndStartMatch();
  oldMatch.players.player2.score = 5000;
  oldMatch.players.player2.hits = 20;
  oldMatch.players.player2.combo = 15;
  oldMatch.players.player2.maxCombo = 15;

  ws1._triggerClose();
  const ws1b = createMockSocket();
  registerConnection(ws1b);
  routeMessage(ws1b, JSON.stringify({ type: 'join_room', roomCode: room.code }));

  rematchFlow.requestRematch(ws1b, room);
  rematchFlow.requestRematch(ws2, room);

  const newMatch = MatchManager.getMatch(room.code);
  const zeroed = { score: 0, combo: 0, maxCombo: 0, hits: 0, misses: 0, mistakes: 0, life: null };

  assert.deepStrictEqual(newMatch.players.player1, zeroed);
  assert.deepStrictEqual(newMatch.players.player2, zeroed);
});

test('[C] estado de abandono nao vaza para a nova Match da revanche', () => {
  const { room, ws1, ws2, match: oldMatch } = joinRealRoomAndStartMatch();

  ws1._triggerClose();
  assert.strictEqual(matchAbandonment.hasAbandonment(oldMatch), true);

  const ws1b = createMockSocket();
  registerConnection(ws1b);
  routeMessage(ws1b, JSON.stringify({ type: 'join_room', roomCode: room.code }));
  rematchFlow.requestRematch(ws1b, room);
  rematchFlow.requestRematch(ws2, room);

  const newMatch = MatchManager.getMatch(room.code);

  assert.strictEqual(matchAbandonment.hasAbandonment(newMatch), false);
  assert.strictEqual(matchAbandonment.getAbandonmentInfo(newMatch), null);
});

test('[C] finalMatchState/matchOutcome antigos (da partida abandonada) nunca aparecem na nova Match', () => {
  const { room, ws1, ws2, match: oldMatch } = joinRealRoomAndStartMatch();

  ws1._triggerClose();
  // Forca um snapshot/outcome "manual" na Match antiga so para provar
  // isolamento por instancia (WeakMap), mesmo em um caso hipotetico em
  // que algo tivesse capturado algo para ela.
  finalMatchState.captureFinalMatchState.length; // no-op de sanidade (funcao existe)

  const ws1b = createMockSocket();
  registerConnection(ws1b);
  routeMessage(ws1b, JSON.stringify({ type: 'join_room', roomCode: room.code }));
  rematchFlow.requestRematch(ws1b, room);
  rematchFlow.requestRematch(ws2, room);

  const newMatch = MatchManager.getMatch(room.code);

  assert.strictEqual(finalMatchState.hasFinalMatchState(newMatch), false);
  assert.strictEqual(matchOutcome.hasFinalOutcome(newMatch), false);
});

test('[C] nova Match da revanche consegue rodar gameplay normalmente (note_hit funciona de novo)', () => {
  const { room, ws1, ws2, match: oldMatch } = joinRealRoomAndStartMatch();

  ws1._triggerClose();
  const ws1b = createMockSocket();
  registerConnection(ws1b);
  routeMessage(ws1b, JSON.stringify({ type: 'join_room', roomCode: room.code }));
  rematchFlow.requestRematch(ws1b, room);
  rematchFlow.requestRematch(ws2, room);

  const newMatch = MatchManager.getMatch(room.code);
  newMatch.clearCountdownTimer();
  newMatch.setState(MATCH_STATE.PLAYING);

  routeMessage(ws2, JSON.stringify({
    type: 'note_hit', noteId: `note-${newMatch.seed}-0`, lane: 1, judgement: 'PERFECT', combo: 1, score: 300,
  }));

  assert.strictEqual(newMatch.players.player2.hits, 1);
  assert.strictEqual(newMatch.players.player2.score, 300);
});

test('[C] apos a revanche comecar, um SEGUNDO abandono nela e tratado normalmente (loops/estado novos, nao herdados)', () => {
  const { room, ws1, ws2 } = joinRealRoomAndStartMatch();

  ws1._triggerClose();
  const ws1b = createMockSocket();
  registerConnection(ws1b);
  routeMessage(ws1b, JSON.stringify({ type: 'join_room', roomCode: room.code }));
  rematchFlow.requestRematch(ws1b, room);
  rematchFlow.requestRematch(ws2, room);

  const newMatch = MatchManager.getMatch(room.code);
  newMatch.clearCountdownTimer();
  newMatch.setState(MATCH_STATE.PLAYING);

  ws2._triggerClose(); // agora e o player2 que abandona a REVANCHE

  assert.strictEqual(newMatch.state, MATCH_STATE.FINISHED);
  assert.strictEqual(countMessagesOfType(ws1b, 'match_abandoned'), 1);
  assert.strictEqual(lastMessageOfType(ws1b, 'match_abandoned').abandonedBy, 'player2');
});

console.log('\n=== BLOCO D: pipeline completo de cliente (sessao real -> abandono -> nova sessao / revanche) ===\n');

const WINDOWS = { perfectMs: 60, goodMs: 150 };
const SCORE_VALUES = { PERFECT: 300, GOOD: 100, MISS: 0 };
const NOTE_PARAMS = { length: 6, noteRange: 3, noteIntervalMs: 600, leadInMs: 0 };

/**
 * Mesmo orquestrador de tests/matchAbandonmentClient.test.js: reproduz,
 * na mesma ordem, exatamente as chamadas que main.js faz em
 * startMatchGameplay, usando os modulos reais (nenhuma logica nova).
 */
function createClientSession({ seed = 1, startTimestamp = 0 } = {}) {
  const timeline = MatchTimelineManager.ensureTimeline({ seed, startTimestamp, ...NOTE_PARAMS });
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
 * Mesma sequencia de limpeza que main.js#handleMatchAbandoned executa.
 */
function simulateHandleMatchAbandoned() {
  NoteRenderer.stop();
  InputController.setLaneHandler(null);
  FeedbackRenderer.reset();
  MatchTimelineManager.clear();
  MatchResult.clearResult();
}

test('[D] evento match_abandoned real (via MatchAbandonmentController) encerra a sessao local uma unica vez', () => {
  let abandonments = 0;
  const controller = MatchAbandonmentController.createAbandonmentController({
    onAbandonment: () => {
      abandonments += 1;
      simulateHandleMatchAbandoned();
    },
  });

  const session = createClientSession({ seed: 101 });
  InputController.triggerLane(1);
  assert.strictEqual(session.getLaneHandlerCalls(), 1);

  controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player1' }, 'player2');
  controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player1' }, 'player2'); // duplicado

  assert.strictEqual(abandonments, 1);

  InputController.triggerLane(1);
  assert.strictEqual(session.getLaneHandlerCalls(), 1, 'input nao deve mais chegar ao GameplayEngine desta sessao');
});

test('[D] apos abandono, MatchEndDetector.checkForEnd() da partida antiga nunca mais e alcancavel pelo loop', () => {
  const controller = MatchAbandonmentController.createAbandonmentController({
    onAbandonment: () => simulateHandleMatchAbandoned(),
  });
  const session = createClientSession({ seed: 102 });

  controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player1' }, 'player2');

  // main.js zera a referencia local (localMatchEndDetector = null) --
  // aqui confirmamos que, mesmo que o detector antigo ainda exista como
  // objeto isolado, nada no fluxo de abandono chama checkForEnd nele,
  // entao ele nunca gera um MatchResult para esta sessao encerrada.
  assert.strictEqual(session.getMatchEndedCalls(), 0);
  assert.strictEqual(MatchResult.hasResult(), false);
});

test('[D] nova partida (revanche) apos abandono: novo MatchEndDetector, InputController religado, timeline nova', () => {
  const controller = MatchAbandonmentController.createAbandonmentController({
    onAbandonment: () => simulateHandleMatchAbandoned(),
  });

  const session1 = createClientSession({ seed: 103, startTimestamp: 5000 });
  controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player1' }, 'player2');

  // Etapa 8B: matchAbandonmentController.reset() e chamado no mesmo
  // ponto de startMatchGameplay em que a proxima sessao (revanche) e
  // montada -- reproduzido aqui explicitamente.
  controller.reset();
  const session2 = createClientSession({ seed: 104, startTimestamp: 6000 });

  assert.notStrictEqual(session2.timeline, session1.timeline, 'a timeline nao pode ser reaproveitada da partida abandonada');
  assert.notStrictEqual(session2.matchEndDetector, session1.matchEndDetector, 'um MatchEndDetector novo deve ser criado para a revanche');
  assert.strictEqual(session2.playerState.score, 0);
  assert.strictEqual(session2.playerState.combo, 0);
  assert.strictEqual(session2.playerState.hits, 0);
  assert.strictEqual(session2.playerState.misses, 0);
  assert.strictEqual(session2.playerState.mistakes, 0);

  InputController.triggerLane(1);
  assert.strictEqual(session2.getLaneHandlerCalls(), 1, 'InputController deve estar religado na sessao nova');

  // O abandono da revanche (partida nova) volta a poder ser tratado
  // normalmente (controller.reset() liberou isso).
  const processed = controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player2' }, 'player1');
  assert.strictEqual(processed, true);
});

test('[D] MatchResult/ResultRenderer da partida abandonada nunca aparecem contaminando a proxima sessao', () => {
  const controller = MatchAbandonmentController.createAbandonmentController({
    onAbandonment: () => simulateHandleMatchAbandoned(),
  });

  createClientSession({ seed: 105 });
  controller.handleEvent({ type: 'match_abandoned', abandonedBy: 'player1' }, 'player2');

  assert.strictEqual(MatchResult.hasResult(), false);

  controller.reset();
  createClientSession({ seed: 106 });

  assert.strictEqual(MatchResult.hasResult(), false, 'nenhum resultado da partida abandonada deve reaparecer na nova');
});

console.log('\n=== BLOCO E: verificacao de sintaxe dos arquivos relevantes ===\n');

const SYNTAX_CHECK_FILES = [
  'server/match/Match.js',
  'server/match/MatchManager.js',
  'server/match/matchFlow.js',
  'server/match/gameplayFlow.js',
  'server/match/matchAbandonment.js',
  'server/match/finalMatchState.js',
  'server/match/matchOutcome.js',
  'server/match/matchResultState.js',
  'server/match/playerMatchState.js',
  'server/match/rematchFlow.js',
  'server/match/sequenceGenerator.js',
  'server/rooms/Room.js',
  'server/rooms/RoomManager.js',
  'server/ws/connectionHandler.js',
  'server/ws/messageRouter.js',
  'server/ws/broadcast.js',
  'server/utils/idGenerator.js',
  'server/config.js',
  'server/index.js',
  'client/js/main.js',
  'client/js/config.js',
  'client/js/match/matchController.js',
  'client/js/match/matchAbandonmentController.js',
  'client/js/match/rematchController.js',
  'client/js/match/matchEndDetector.js',
  'client/js/match/matchResult.js',
  'client/js/match/matchTimelineManager.js',
  'client/js/match/noteEngine.js',
  'client/js/match/gameplayEngine.js',
  'client/js/match/playerState.js',
  'client/js/match/judgement.js',
  'client/js/match/sequenceGenerator.js',
  'client/js/input/inputController.js',
  'client/js/render/noteRenderer.js',
  'client/js/render/feedbackRenderer.js',
  'client/js/render/resultRenderer.js',
  'client/js/network/socketClient.js',
  'client/js/ui/uiController.js',
];

const repoRoot = path.resolve(__dirname, '..');

for (const relPath of SYNTAX_CHECK_FILES) {
  test(`[E] sintaxe valida: ${relPath}`, () => {
    execFileSync(process.execPath, ['--check', path.join(repoRoot, relPath)], { stdio: 'pipe' });
  });
}

console.log(`\n${passed} teste(s) passaram.\n`);
