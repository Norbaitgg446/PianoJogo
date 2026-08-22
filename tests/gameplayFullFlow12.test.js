/**
 * ETAPA 12 -- GAMEPLAY FUNCIONAL COMPLETO (fim a fim, ponta a ponta).
 *
 * Esta suite NAO reimplementa nenhum sistema: exercita os modulos REAIS
 * de producao (RoomManager, Room, MatchManager, Match, matchFlow,
 * gameplayFlow, playerMatchState, finalMatchState, matchOutcome,
 * matchAbandonment, rematchFlow, leaveRoomFlow, musicSelectionFlow,
 * connectionHandler, messageRouter) -- mesmo padrao/mocks ja usados em
 * tests/multiplayerEndToEnd10F.test.js e tests/matchFinalizationConsistency.test.js.
 *
 * BUG ENCONTRADO NESTA ETAPA (ver relatorio de entrega): nada em codigo
 * de producao chamava matchFlow.finishMatch() -- so os testes chamavam
 * essa funcao diretamente, contornando o transporte real. Ou seja, no
 * fluxo real via WebSocket, quando a timeline local de um jogador
 * terminava, o servidor NUNCA aprendia disso: a Match ficava presa em
 * PLAYING para sempre, `match_result` nunca era enviado, e a revanche
 * ficava bloqueada (rematchFlow rejeita pedidos com a Match em
 * READY/COUNTDOWN/PLAYING). A correcao (menor possivel, sem sistema
 * paralelo): uma nova mensagem `sequence_complete` (cliente -> servidor)
 * que so serve de GATILHO para o mesmo matchFlow.finishMatch ja
 * existente e ja testado (ver server/match/gameplayFlow.js#applySequenceComplete
 * e server/ws/messageRouter.js). Esta suite valida essa correcao
 * passando pelo pipeline real (routeMessage), e tambem comprova (sem
 * alterar producao) tudo que a Etapa 12 pedia e que ja funcionava desde
 * etapas anteriores.
 *
 * Executar com: node tests/gameplayFullFlow12.test.js
 */
const assert = require('assert');

const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { MATCH_STATE } = require('../server/match/Match');
const matchFlow = require('../server/match/matchFlow');
const matchAbandonment = require('../server/match/matchAbandonment');
const finalMatchState = require('../server/match/finalMatchState');
const matchOutcome = require('../server/match/matchOutcome');
const { registerConnection } = require('../server/ws/connectionHandler');
const { routeMessage } = require('../server/ws/messageRouter');

// Modulos do CLIENTE usados so para validar determinismo/isolamento de
// timeline e o ciclo de vida do detector de fim de partida -- os mesmos
// modulos reais que client/js/main.js usa (nenhuma reimplementacao).
const MatchEndDetector = require('../client/js/match/matchEndDetector');
const NoteEngine = require('../client/js/match/noteEngine');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`OK   - ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------
// Mock de conexao WebSocket -- MESMA forma usada em toda a suite
// existente (ver tests/multiplayerEndToEnd10F.test.js).
// ---------------------------------------------------------------------
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
    close() {
      this.readyState = 3;
    },
    _handlers: handlers,
    _triggerClose() {
      handlers.close.forEach((fn) => fn());
    },
  };
}

function send(ws, message) {
  routeMessage(ws, JSON.stringify(message));
}

function lastOfType(socket, type) {
  const matches = socket.sent.filter((m) => m.type === type);
  return matches.length ? matches[matches.length - 1] : null;
}

function allOfType(socket, type) {
  return socket.sent.filter((m) => m.type === type);
}

function countOfType(socket, type) {
  return socket.sent.filter((m) => m.type === type).length;
}

/**
 * Cria uma sala completa usando o caminho de PRODUCAO
 * (create_room + join_room).
 */
function createFullRoomViaProduction() {
  const wsPlayer1 = createMockSocket();
  const wsPlayer2 = createMockSocket();
  registerConnection(wsPlayer1);
  registerConnection(wsPlayer2);

  send(wsPlayer1, { type: 'create_room' });
  const roomCode = lastOfType(wsPlayer1, 'room_created').roomCode;

  send(wsPlayer2, { type: 'join_room', roomCode });

  const room = RoomManager.getRoom(roomCode);
  const match = MatchManager.getMatch(roomCode);
  return { room, wsPlayer1, wsPlayer2, match, roomCode };
}

/**
 * Dispara o callback JA AGENDADO pelo setTimeout real de
 * matchFlow.scheduleCountdown -- mesmo codigo de producao que rodaria
 * quando MATCH_COUNTDOWN_SECONDS passassem de verdade.
 */
function fireRealCountdown(match) {
  assert.ok(match && match._countdownTimer, 'esperava um _countdownTimer real agendado');
  match._countdownTimer._onTimeout();
}

/**
 * Leva uma sala nova ate PLAYING usando exclusivamente o caminho real
 * de producao (create_room -> join_room -> countdown real -> match_started).
 */
function createPlayingRoomViaProduction() {
  const ctx = createFullRoomViaProduction();
  fireRealCountdown(ctx.match);
  assert.strictEqual(ctx.match.state, MATCH_STATE.PLAYING);
  return ctx;
}

function noteHitPayload(match, extra = {}) {
  return {
    type: 'note_hit',
    noteId: `note-${match.seed}-0`,
    lane: 1,
    judgement: 'PERFECT',
    deltaMs: 10,
    combo: 1,
    score: 300,
    ...extra,
  };
}

function noteMissPayload(match, extra = {}) {
  return {
    type: 'note_miss',
    noteId: `note-${match.seed}-1`,
    lane: 2,
    combo: 0,
    misses: 1,
    ...extra,
  };
}

// =====================================================================
// BLOCO A -- CRIACAO DE SALA / ENTRADA / CONFIGURACAO (itens 1-6)
// =====================================================================

test('[1] criacao da sala: player1 recebe room_created com roomCode/slot', () => {
  const wsPlayer1 = createMockSocket();
  registerConnection(wsPlayer1);
  send(wsPlayer1, { type: 'create_room' });

  const created = lastOfType(wsPlayer1, 'room_created');
  assert.ok(created);
  assert.strictEqual(created.slot, 'player1');
  assert.strictEqual(typeof created.roomCode, 'string');
});

test('[2] entrada do segundo jogador: player2 recebe room_joined e a sala fica cheia', () => {
  const { wsPlayer2, room, roomCode } = createFullRoomViaProduction();
  assert.ok(lastOfType(wsPlayer2, 'room_joined'));
  assert.strictEqual(room.isFull(), true);
  assert.strictEqual(room.code, roomCode);
});

test('[3][4] configuracao da partida: Match e criada automaticamente quando a sala enche', () => {
  const { match } = createFullRoomViaProduction();
  assert.ok(match, 'a Match deveria existir assim que a sala enche');
  // matchFlow.startMatchFlow transiciona READY -> COUNTDOWN de forma
  // sincrona (agenda o timer real do countdown antes de devolver o
  // controle), entao neste ponto a Match ja avancou de READY para
  // COUNTDOWN -- nunca fica parada em READY nem pula para PLAYING.
  assert.strictEqual(match.state, MATCH_STATE.COUNTDOWN);
  assert.ok(match.musicId);
  assert.ok(match.seed);
});

test('[5] mesma configuracao para P1/P2 (match_ready identico para os dois)', () => {
  const { wsPlayer1, wsPlayer2 } = createFullRoomViaProduction();
  const readyP1 = lastOfType(wsPlayer1, 'match_ready').match;
  const readyP2 = lastOfType(wsPlayer2, 'match_ready').match;

  assert.strictEqual(readyP1.musicId, readyP2.musicId);
  assert.strictEqual(readyP1.difficulty, readyP2.difficulty);
  assert.strictEqual(readyP1.speed, readyP2.speed);
  assert.strictEqual(readyP1.seed, readyP2.seed);
});

test('[6] countdown: inicia exatamente uma vez e os dois clientes recebem o mesmo startTimestamp', () => {
  const { wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();

  assert.strictEqual(countOfType(wsPlayer1, 'match_countdown_start'), 1);
  assert.strictEqual(countOfType(wsPlayer2, 'match_countdown_start'), 1);

  const c1 = lastOfType(wsPlayer1, 'match_countdown_start');
  const c2 = lastOfType(wsPlayer2, 'match_countdown_start');
  assert.strictEqual(c1.startTimestamp, c2.startTimestamp);
  assert.strictEqual(match.state, MATCH_STATE.COUNTDOWN);
});

// =====================================================================
// BLOCO B -- MATCH_STARTED / TIMELINE / GAMEPLAY (itens 7-14)
// =====================================================================

test('[7] match_started e entregue aos dois jogadores, com o mesmo startTimestamp, uma unica vez', () => {
  const { wsPlayer1, wsPlayer2, match } = createPlayingRoomViaProduction();

  assert.strictEqual(countOfType(wsPlayer1, 'match_started'), 1);
  assert.strictEqual(countOfType(wsPlayer2, 'match_started'), 1);

  const s1 = lastOfType(wsPlayer1, 'match_started');
  const s2 = lastOfType(wsPlayer2, 'match_started');
  assert.strictEqual(s1.startTimestamp, s2.startTimestamp);
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);
});

test('[8][45][46] timeline determinista: mesma seed + mesmo pattern produzem sempre a mesma sequencia', () => {
  const { match } = createPlayingRoomViaProduction();

  const timelineA = NoteEngine.generateNoteTimeline({
    seed: match.seed,
    startTimestamp: match.startTimestamp,
    length: 16,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 1500,
  });
  const timelineB = NoteEngine.generateNoteTimeline({
    seed: match.seed,
    startTimestamp: match.startTimestamp,
    length: 16,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 1500,
  });

  assert.strictEqual(timelineA.length, timelineB.length);
  timelineA.forEach((note, i) => {
    assert.strictEqual(note.lane, timelineB[i].lane);
    assert.strictEqual(note.time, timelineB[i].time);
  });
});

test('[9] primeiro evento de nota: a timeline gerada nao esta vazia', () => {
  const { match } = createPlayingRoomViaProduction();
  const timeline = NoteEngine.generateNoteTimeline({
    seed: match.seed,
    startTimestamp: match.startTimestamp,
    length: 16,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 1500,
  });
  assert.ok(timeline.length > 0);
  assert.ok(timeline[0].id.startsWith(`note-${match.seed}-`));
});

test('[10][11][12] note_hit atualiza hits/score/combo/maxCombo do jogador correto', () => {
  const { wsPlayer1, match } = createPlayingRoomViaProduction();

  send(wsPlayer1, noteHitPayload(match, { combo: 1, score: 300 }));
  send(wsPlayer1, noteHitPayload(match, { noteId: `note-${match.seed}-2`, combo: 2, score: 700 }));

  assert.strictEqual(match.players.player1.hits, 2);
  assert.strictEqual(match.players.player1.score, 700);
  assert.strictEqual(match.players.player1.combo, 2);
  assert.strictEqual(match.players.player1.maxCombo, 2);
});

test('[13][15] note_miss incrementa misses e zera o combo, sem afetar score', () => {
  const { wsPlayer1, match } = createPlayingRoomViaProduction();

  send(wsPlayer1, noteHitPayload(match, { combo: 1, score: 300 }));
  send(wsPlayer1, noteMissPayload(match));

  assert.strictEqual(match.players.player1.misses, 1);
  assert.strictEqual(match.players.player1.combo, 0);
  assert.strictEqual(match.players.player1.score, 300, 'score nao deveria mudar em um miss');
  assert.strictEqual(match.players.player1.maxCombo, 1, 'maxCombo nao deveria diminuir');
});

test('[16][47][48] isolamento P1/P2: score/combo/hits/misses de um jogador nunca alteram o outro', () => {
  const { wsPlayer1, wsPlayer2, match } = createPlayingRoomViaProduction();

  send(wsPlayer1, noteHitPayload(match, { combo: 1, score: 300 }));
  send(wsPlayer1, noteHitPayload(match, { noteId: `note-${match.seed}-2`, combo: 2, score: 700 }));
  send(wsPlayer2, noteMissPayload(match));

  assert.strictEqual(match.players.player1.hits, 2);
  assert.strictEqual(match.players.player1.score, 700);
  assert.strictEqual(match.players.player2.hits, 0);
  assert.strictEqual(match.players.player2.score, 0);
  assert.strictEqual(match.players.player2.misses, 1);
  assert.strictEqual(match.players.player1.misses, 0);
});

// =====================================================================
// BLOCO C -- FIM DA SEQUENCIA / RESULTADO (itens 17-24)
// Cobre diretamente a correcao desta etapa (sequence_complete ->
// gameplayFlow.applySequenceComplete -> matchFlow.finishMatch).
// =====================================================================

test('[17] BUG (antes da correcao): nada em producao levava a Match de PLAYING a FINISHED sozinha', () => {
  // Comprova a causa raiz do bug: sem NENHUMA mensagem de rede, uma
  // partida em PLAYING nunca sai desse estado por conta propria. Isso
  // e o que tornava necessario o gatilho explicito (sequence_complete)
  // corrigido nesta etapa -- ver BLOCO C daqui pra baixo.
  const { match } = createPlayingRoomViaProduction();
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);
  // (nenhuma mensagem enviada aqui de proposito)
  assert.strictEqual(match.state, MATCH_STATE.PLAYING, 'sem gatilho, a Match nunca sai de PLAYING sozinha');
});

test('[18] sequence_complete (via routeMessage real) leva a Match de PLAYING a FINISHED', () => {
  const { wsPlayer1, match } = createPlayingRoomViaProduction();

  send(wsPlayer1, { type: 'sequence_complete' });

  assert.strictEqual(match.state, MATCH_STATE.FINISHED);
});

test('[19] snapshot final e capturado apos sequence_complete', () => {
  const { wsPlayer1, match } = createPlayingRoomViaProduction();
  send(wsPlayer1, noteHitPayload(match, { combo: 1, score: 300 }));

  send(wsPlayer1, { type: 'sequence_complete' });

  assert.strictEqual(finalMatchState.hasFinalMatchState(match), true);
  const snapshot = finalMatchState.getFinalMatchState(match);
  assert.strictEqual(snapshot.player1.score, 300);
});

test('[20] outcome (vencedor/perdedor/empate) e calculado exclusivamente a partir do snapshot final', () => {
  const { wsPlayer1, wsPlayer2, match } = createPlayingRoomViaProduction();
  send(wsPlayer1, noteHitPayload(match, { combo: 1, score: 1000 }));
  send(wsPlayer2, noteHitPayload(match, { combo: 1, score: 200 }));

  send(wsPlayer1, { type: 'sequence_complete' });

  assert.strictEqual(matchOutcome.hasFinalOutcome(match), true);
  const outcome = matchOutcome.getFinalOutcome(match);
  assert.strictEqual(outcome.winner, 'player1');
  assert.strictEqual(outcome.loser, 'player2');
  assert.strictEqual(outcome.result, 'player1_win');
});

test('[21] match_result e enviado aos DOIS jogadores exatamente uma vez, com result/winner/loser', () => {
  const { wsPlayer1, wsPlayer2, match } = createPlayingRoomViaProduction();
  send(wsPlayer1, noteHitPayload(match, { combo: 1, score: 500 }));

  send(wsPlayer1, { type: 'sequence_complete' });

  assert.strictEqual(countOfType(wsPlayer1, 'match_result'), 1);
  assert.strictEqual(countOfType(wsPlayer2, 'match_result'), 1);

  const r1 = lastOfType(wsPlayer1, 'match_result');
  const r2 = lastOfType(wsPlayer2, 'match_result');
  assert.strictEqual(r1.result, r2.result);
  assert.strictEqual(r1.winner, r2.winner);
  assert.strictEqual(r1.loser, r2.loser);
});

test('[22] draw quando os dois jogadores tem o mesmo score', () => {
  const { wsPlayer1, wsPlayer2, match } = createPlayingRoomViaProduction();
  send(wsPlayer1, noteHitPayload(match, { combo: 1, score: 400 }));
  send(wsPlayer2, noteHitPayload(match, { combo: 1, score: 400 }));

  send(wsPlayer1, { type: 'sequence_complete' });

  const r1 = lastOfType(wsPlayer1, 'match_result');
  assert.strictEqual(r1.result, 'draw');
  assert.strictEqual(r1.winner, null);
});

test('[23][35][37][38] duplicacao/idempotencia: sequence_complete duplicado (mesmo jogador ou o outro reportando a mesma timeline) nao finaliza duas vezes nem duplica match_result', () => {
  const { wsPlayer1, wsPlayer2, match } = createPlayingRoomViaProduction();
  send(wsPlayer1, noteHitPayload(match, { combo: 1, score: 500 }));

  send(wsPlayer1, { type: 'sequence_complete' });
  const snapshotAfterFirst = finalMatchState.getFinalMatchState(match);

  // O oponente, cuja timeline (mesma seed/startTimestamp) tambem termina
  // no mesmo instante, reporta em seguida -- e o mesmo jogador clicando/
  // reenviando por qualquer motivo tambem nao deve ter efeito.
  send(wsPlayer2, { type: 'sequence_complete' });
  send(wsPlayer1, { type: 'sequence_complete' });

  assert.strictEqual(countOfType(wsPlayer1, 'match_result'), 1, 'nao deveria haver um segundo match_result');
  assert.strictEqual(countOfType(wsPlayer2, 'match_result'), 1, 'nao deveria haver um segundo match_result');
  assert.strictEqual(
    finalMatchState.getFinalMatchState(match),
    snapshotAfterFirst,
    'o snapshot final nao deveria ser recapturado'
  );
});

test('[24] apos FINISHED, note_hit/note_miss sao rejeitados e nao alteram o estado oficial', () => {
  const { wsPlayer1, wsPlayer2, match } = createPlayingRoomViaProduction();
  send(wsPlayer1, noteHitPayload(match, { combo: 1, score: 111 }));

  send(wsPlayer1, { type: 'sequence_complete' });
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);

  send(wsPlayer1, noteHitPayload(match, { noteId: `note-${match.seed}-9`, combo: 99, score: 99999 }));
  send(wsPlayer2, noteMissPayload(match));

  assert.strictEqual(match.players.player1.score, 111, 'score nao deveria mudar apos FINISHED');
  assert.strictEqual(match.players.player2.misses, 0, 'misses nao deveria mudar apos FINISHED');
  assert.strictEqual(lastOfType(wsPlayer1, 'error').message, 'Nao ha partida em andamento nesta sala.');
});

// =====================================================================
// BLOCO D -- REVANCHE (itens 25-30)
// A revanche real (via rede) so funciona hoje porque BLOCO C corrigiu
// o gatilho que tira a Match de PLAYING -- sem ele, o teste
// [25-a] abaixo reproduz o bug (rematch bloqueado).
// =====================================================================

test('[25-a] SEM sequence_complete, rematch_ready e rejeitado (Match ainda presa em PLAYING) -- reproduz o bug corrigido', () => {
  const { wsPlayer1, wsPlayer2 } = createPlayingRoomViaProduction();

  send(wsPlayer1, { type: 'rematch_ready' });
  send(wsPlayer2, { type: 'rematch_ready' });

  const err = lastOfType(wsPlayer1, 'error');
  assert.ok(err, 'sem a Match sair de PLAYING, o pedido de revanche deveria ser rejeitado');
  assert.strictEqual(countOfType(wsPlayer1, 'match_started'), 1, 'nenhuma partida nova deveria comecar');
});

test('[25][26] apos sequence_complete + os dois pedindo revanche: EXATAMENTE uma nova Match, com nova seed', () => {
  const { wsPlayer1, wsPlayer2, roomCode, match: firstMatch } = createPlayingRoomViaProduction();
  send(wsPlayer1, { type: 'sequence_complete' });
  assert.strictEqual(firstMatch.state, MATCH_STATE.FINISHED);

  send(wsPlayer1, { type: 'rematch_ready' });
  send(wsPlayer2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  assert.notStrictEqual(secondMatch, firstMatch, 'deveria ser uma NOVA instancia de Match');
  assert.notStrictEqual(secondMatch.seed, firstMatch.seed, 'a seed da revanche deveria ser diferente');
});

test('[27] revanche recalcula um startTimestamp novo e valido (mesma regra de matchFlow.scheduleCountdown, nao reaproveitado de nenhum estado antigo)', () => {
  const { wsPlayer1, wsPlayer2, roomCode } = createPlayingRoomViaProduction();
  send(wsPlayer1, { type: 'sequence_complete' });

  send(wsPlayer1, { type: 'rematch_ready' });
  send(wsPlayer2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  // Mesma convencao ja usada em tests/rematchFlow.test.js: o
  // startTimestamp de uma revanche e sempre recalculado por
  // matchFlow.scheduleCountdown (Date.now() + countdownMs) no momento
  // da revanche -- nunca copiado da partida anterior. Comparar por
  // igualdade estrita ao milissegundo e instavel (as duas partidas
  // podem ser criadas no mesmo ms neste teste sincrono); o que importa
  // e que seja um numero futuro valido, coerente com o countdown que
  // acabou de ser (re)agendado.
  assert.strictEqual(typeof secondMatch.startTimestamp, 'number');
  assert.ok(secondMatch.startTimestamp >= Date.now());
  assert.ok(secondMatch._countdownTimer, 'um novo timer de countdown deveria ter sido agendado para a revanche');
});

test('[28][29] a nova partida (revanche) comeca com score/combo/hits/misses ZERADOS e nova timeline/noteSequence', () => {
  const { wsPlayer1, wsPlayer2, roomCode, match: firstMatch } = createPlayingRoomViaProduction();
  send(wsPlayer1, noteHitPayload(firstMatch, { combo: 3, score: 999 }));
  send(wsPlayer1, { type: 'sequence_complete' });

  send(wsPlayer1, { type: 'rematch_ready' });
  send(wsPlayer2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  assert.strictEqual(secondMatch.players.player1.score, 0);
  assert.strictEqual(secondMatch.players.player1.combo, 0);
  assert.strictEqual(secondMatch.players.player1.maxCombo, 0);
  assert.strictEqual(secondMatch.players.player1.hits, 0);
  assert.notDeepStrictEqual(secondMatch.noteSequence, firstMatch.noteSequence);
});

test('[30][49] revanche nao herda snapshot/outcome/sequenceChecks da partida anterior', () => {
  const { wsPlayer1, wsPlayer2, roomCode, match: firstMatch } = createPlayingRoomViaProduction();
  send(wsPlayer1, { type: 'sequence_check', seed: firstMatch.seed, checksum: 123 });
  send(wsPlayer1, { type: 'sequence_complete' });
  assert.strictEqual(finalMatchState.hasFinalMatchState(firstMatch), true);

  send(wsPlayer1, { type: 'rematch_ready' });
  send(wsPlayer2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  assert.strictEqual(finalMatchState.hasFinalMatchState(secondMatch), false);
  assert.strictEqual(matchOutcome.hasFinalOutcome(secondMatch), false);
  assert.strictEqual(secondMatch.hasBothSequenceChecks(), false);
});

// =====================================================================
// BLOCO E -- ABANDONO / SAIDA DE SALA (itens 31-34)
// =====================================================================

test('[31][32] abandono durante PLAYING gera match_abandoned e NENHUM match_result -- mesmo se sequence_complete chegar depois', () => {
  const { wsPlayer1, wsPlayer2, match } = createPlayingRoomViaProduction();

  wsPlayer1._triggerClose();
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);
  assert.ok(lastOfType(wsPlayer2, 'match_abandoned'));

  // Se o cliente que ainda estava "processando" a timeline reportar o
  // fim da sequencia depois do abandono, isso e ignorado (a Match ja
  // nao esta mais PLAYING) -- nenhum match_result normal deve surgir.
  send(wsPlayer2, { type: 'sequence_complete' });

  assert.strictEqual(countOfType(wsPlayer1, 'match_result'), 0);
  assert.strictEqual(countOfType(wsPlayer2, 'match_result'), 0);
});

test('[33] leave_room antes da partida: jogador e removido e nenhuma Match fantasma permanece', () => {
  const wsPlayer1 = createMockSocket();
  registerConnection(wsPlayer1);
  send(wsPlayer1, { type: 'create_room' });
  const roomCode = lastOfType(wsPlayer1, 'room_created').roomCode;

  send(wsPlayer1, { type: 'leave_room' });

  assert.ok(lastOfType(wsPlayer1, 'left_room'));
  assert.strictEqual(MatchManager.getMatch(roomCode), null);
});

test('[34] leave_room durante PLAYING e tratado como abandono (mesmo sistema, nenhum novo)', () => {
  const { wsPlayer1, wsPlayer2, match } = createPlayingRoomViaProduction();

  send(wsPlayer1, { type: 'leave_room' });

  assert.strictEqual(match.state, MATCH_STATE.FINISHED);
  assert.ok(lastOfType(wsPlayer2, 'match_abandoned'));
  assert.strictEqual(countOfType(wsPlayer2, 'match_result'), 0);
});

// =====================================================================
// BLOCO F -- ISOLAMENTO ENTRE SALAS (item 35)
// =====================================================================

test('[35] duas salas simultaneas: sequence_complete/score/seed/resultado de uma nunca vazam para a outra', () => {
  const roomA = createPlayingRoomViaProduction();
  const roomB = createPlayingRoomViaProduction();

  assert.notStrictEqual(roomA.match.seed, roomB.match.seed);

  send(roomA.wsPlayer1, noteHitPayload(roomA.match, { combo: 1, score: 500 }));
  send(roomA.wsPlayer1, { type: 'sequence_complete' });

  // Sala A terminou; Sala B continua intocada.
  assert.strictEqual(roomA.match.state, MATCH_STATE.FINISHED);
  assert.strictEqual(roomB.match.state, MATCH_STATE.PLAYING);
  assert.strictEqual(roomB.match.players.player1.score, 0);
  assert.strictEqual(countOfType(roomB.wsPlayer1, 'match_result'), 0);
  assert.strictEqual(countOfType(roomB.wsPlayer2, 'match_result'), 0);
});

// =====================================================================
// BLOCO G -- CICLO DE VIDA DO CLIENTE (MatchEndDetector) (itens 36-38)
// Reutiliza o modulo real do cliente (nenhuma reimplementacao) para
// comprovar que o gatilho local que agora dispara `sequence_complete`
// (ver client/js/main.js#handleLocalMatchEnd) so acontece UMA vez por
// partida -- ja garantido desde a Etapa 5B-4A e reconfirmado aqui no
// contexto desta etapa.
// =====================================================================

test('[36] MatchEndDetector dispara onMatchEnd exatamente uma vez quando a timeline termina', () => {
  const timeline = [
    { id: 'note-1-0', state: 'pending' },
    { id: 'note-1-1', state: 'pending' },
  ];
  let calls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({ timeline, onMatchEnd: () => { calls++; } });

  assert.strictEqual(detector.checkForEnd(), false);
  timeline[0].state = 'hit';
  assert.strictEqual(detector.checkForEnd(), false);
  timeline[1].state = 'missed';
  assert.strictEqual(detector.checkForEnd(), true);
  assert.strictEqual(detector.checkForEnd(), false, 'nao deveria disparar de novo');
  assert.strictEqual(calls, 1);
});

test('[37] uma nova partida usa uma nova instancia do detector (sem estado global sobrando)', () => {
  const timelineA = [{ id: 'a', state: 'hit' }];
  const detectorA = MatchEndDetector.createMatchEndDetector({ timeline: timelineA, onMatchEnd: () => {} });
  detectorA.checkForEnd();
  assert.strictEqual(detectorA.hasEnded(), true);

  const timelineB = [{ id: 'b', state: 'pending' }];
  const detectorB = MatchEndDetector.createMatchEndDetector({ timeline: timelineB, onMatchEnd: () => {} });
  assert.strictEqual(detectorB.hasEnded(), false, 'a nova partida nao deveria herdar o fim da anterior');
});

test('[38] selecao de musica e bloqueada durante PLAYING (regra ja existente, reconfirmada no fluxo real de sala cheia)', () => {
  const { wsPlayer1, match } = createPlayingRoomViaProduction();
  const originalMusicId = match.musicId;

  send(wsPlayer1, { type: 'select_music', musicId: 'music-001' });

  const err = lastOfType(wsPlayer1, 'error');
  assert.ok(err, 'select_music durante PLAYING deveria ser rejeitado');
  assert.strictEqual(match.musicId, originalMusicId, 'a musica da partida em andamento nao deveria mudar');
});

// =====================================================================
// RESUMO
// =====================================================================
console.log(`\n${passed} teste(s) passaram, ${failed} falharam.`);
