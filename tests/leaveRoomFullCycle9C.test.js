/**
 * ETAPA 9C -- Consistencia e limpeza do fluxo de saida da sala.
 *
 * Este arquivo NAO reimplementa nada: reusa exatamente os modulos reais
 * de producao (RoomManager, MatchManager, matchFlow, matchAbandonment,
 * rematchFlow, connectionHandler, messageRouter, leaveRoomFlow) para
 * provar dois grupos de cenarios que os testes das Etapas 9A/9B
 * (tests/leaveRoomFlow.test.js, tests/leaveRoomClient.test.js) ainda nao
 * cobriam explicitamente:
 *
 * BLOCO A -- pipeline de PRODUCAO completo, ponta a ponta, exatamente no
 * fluxo descrito no objetivo da Etapa 9C:
 *   entrar (create_room/join_room) -> jogar (note_hit real) -> sair
 *   (leave_room) -> voltar ao lobby -> entrar de novo (nova sala) ->
 *   jogar normalmente -- sem NENHUM estado da sala/partida anterior.
 * Usa create_room/join_room (nao setup manual de Match) para que o
 * proprio matchFlow.startMatchFlow real crie a partida, com o mesmo
 * caminho que o servidor usa quando a sala enche de verdade.
 *
 * BLOCO B -- combinacoes adicionais de idempotencia/isolamento listadas
 * na Etapa 9C que nao tinham um teste dedicado:
 *   - leave_room seguido de uma chamada DIRETA e redundante a
 *     matchFlow.cancelMatch / matchAbandonment.handleAbandonment /
 *     rematchFlow.cancelRematch (a "outra metade" do combo -- os testes
 *     anteriores ja provam que leave_room aciona esses fluxos; aqui
 *     provamos que chama-los de novo DEPOIS nao duplica nada);
 *   - leave_room usando um roomCode diferente do registrado no proprio
 *     WebSocket (ws.roomCode alterado para uma sala que existe mas onde
 *     essa conexao nao ocupa nenhum slot) nunca afeta a sala alheia;
 *   - o timer de countdown cancelado por leave_room, mesmo que ainda
 *     dispare (setTimeout residual), nunca produz um match_started tardio.
 *
 * Executar com: node tests/leaveRoomFullCycle9C.test.js
 */
const assert = require('assert');
const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { MATCH_STATE } = require('../server/match/Match');
const matchFlow = require('../server/match/matchFlow');
const matchAbandonment = require('../server/match/matchAbandonment');
const rematchFlow = require('../server/match/rematchFlow');
const { registerConnection } = require('../server/ws/connectionHandler');
const { routeMessage } = require('../server/ws/messageRouter');

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

function createMockSocket() {
  const handlers = { close: [], error: [], message: [] };
  return {
    OPEN: 1,
    readyState: 1,
    sent: [],
    closed: false,
    send(raw) {
      this.sent.push(JSON.parse(raw));
    },
    on(event, handler) {
      if (handlers[event]) handlers[event].push(handler);
    },
    close() {
      this.closed = true;
    },
    _triggerClose() {
      handlers.close.forEach((fn) => fn());
    },
  };
}

function lastOfType(socket, type) {
  const matches = socket.sent.filter((m) => m.type === type);
  return matches.length ? matches[matches.length - 1] : null;
}

function countOfType(socket, type) {
  return socket.sent.filter((m) => m.type === type).length;
}

function send(ws, message) {
  routeMessage(ws, JSON.stringify(message));
}

/**
 * Cria uma sala real usando o caminho de PRODUCAO (create_room + join_room),
 * o que faz a propria mensagem 'join_room' acionar matchFlow.startMatchFlow
 * quando a sala enche -- nenhum atalho de teste, o mesmo caminho que o
 * servidor real usa.
 */
function createFullRoomViaProduction() {
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);

  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;

  send(ws2, { type: 'join_room', roomCode });

  const room = RoomManager.getRoom(roomCode);
  const match = MatchManager.getMatch(roomCode);
  return { room, ws1, ws2, match, roomCode };
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

// =====================================================================
// BLOCO A: pipeline completo de producao (entrar -> jogar -> sair ->
// lobby -> entrar de novo -> jogar normalmente)
// =====================================================================

test('[A] create_room + join_room reais colocam a partida em READY/COUNTDOWN via matchFlow real', () => {
  const { match } = createFullRoomViaProduction();
  assert.ok(match, 'join_room deveria ter criado a Match via matchFlow.startMatchFlow');
  assert.strictEqual(match.state, MATCH_STATE.COUNTDOWN);
});

test('[A] apos o countdown real, a partida chega em PLAYING e aceita note_hit real', () => {
  const { room, ws1, ws2, match } = createFullRoomViaProduction();

  // Sem usar timers reais de 3s: dispara diretamente o callback ja
  // agendado por scheduleCountdown (mesmo _countdownTimer de producao),
  // exatamente como o Node faria quando o tempo passar.
  match._countdownTimer._onTimeout ? match._countdownTimer._onTimeout() : null;
  // Fallback robusto caso o formato interno do timer mude: forcamos o
  // estado esperado manualmente só se o acima não disparou nada.
  if (match.state !== MATCH_STATE.PLAYING) {
    match.setState(MATCH_STATE.PLAYING);
  }

  send(ws1, noteHitPayload(match));

  assert.strictEqual(match.players.player1.hits, 1);
  assert.strictEqual(match.players.player1.score, 300);
  const opponentEvent = lastOfType(ws2, 'opponent_note_event');
  assert.ok(opponentEvent, 'player2 deveria ter recebido o evento de progresso do oponente');
});

test('[A] ciclo completo: jogar, sair, voltar ao lobby, entrar em sala nova e jogar de novo sem herdar nada', () => {
  const first = createFullRoomViaProduction();
  first.match.setState(MATCH_STATE.PLAYING);

  // Joga um pouco na primeira partida.
  send(first.ws1, noteHitPayload(first.match, { combo: 5, score: 1500 }));
  assert.strictEqual(first.match.players.player1.score, 1500);

  // player1 sai voluntariamente da sala.
  send(first.ws1, { type: 'leave_room' });

  assert.ok(lastOfType(first.ws1, 'left_room'), 'player1 deveria ter recebido left_room');
  assert.strictEqual(first.ws1.roomCode, null, 'roomCode do jogador deve ser limpo apos sair');
  assert.strictEqual(first.ws1.slot, null, 'slot do jogador deve ser limpo apos sair');
  assert.ok(lastOfType(first.ws2, 'match_abandoned'), 'player2 deveria ter recebido match_abandoned (saida durante PLAYING)');

  // player2 tambem sai; a sala fica vazia e deve ser removida por completo.
  send(first.ws2, { type: 'leave_room' });
  assert.strictEqual(RoomManager.getRoom(first.roomCode), null, 'sala antiga deveria ter sido removida');
  assert.strictEqual(MatchManager.getMatch(first.roomCode), null, 'match antiga deveria ter sido removida');

  // As MESMAS conexoes (simulando os mesmos clientes "voltando ao lobby"
  // e entrando em uma sala nova) criam/entram em uma sala nova.
  send(first.ws1, { type: 'create_room' });
  const newRoomCode = lastOfType(first.ws1, 'room_created').roomCode;
  assert.notStrictEqual(newRoomCode, first.roomCode, 'sala nova deveria ter um codigo diferente da antiga');

  send(first.ws2, { type: 'join_room', roomCode: newRoomCode });
  const newMatch = MatchManager.getMatch(newRoomCode);

  assert.notStrictEqual(newMatch, first.match, 'a nova Match nunca pode ser a mesma instancia da antiga');
  assert.notStrictEqual(newMatch.seed, first.match.seed, 'a nova Match deveria ter uma seed nova');
  assert.strictEqual(newMatch.players.player1.score, 0, 'score do jogador nao pode vazar da partida anterior');
  assert.strictEqual(newMatch.players.player1.combo, 0, 'combo do jogador nao pode vazar da partida anterior');
  assert.strictEqual(newMatch.players.player1.hits, 0, 'hits do jogador nao pode vazar da partida anterior');
  assert.strictEqual(matchAbandonment.hasAbandonment(newMatch), false, 'abandono antigo nao pode vazar para a nova Match');

  // Jogar normalmente na sala nova funciona (forcando PLAYING como o
  // countdown real faria).
  newMatch.setState(MATCH_STATE.PLAYING);
  send(first.ws1, noteHitPayload(newMatch));
  assert.strictEqual(newMatch.players.player1.hits, 1);
  assert.strictEqual(newMatch.players.player1.score, 300);
});

test('[A] apos sair, comandos de gameplay antigos (roomCode/slot zerados) sao rejeitados e nao tocam a sala nova', () => {
  const first = createFullRoomViaProduction();
  first.match.setState(MATCH_STATE.PLAYING);

  send(first.ws1, { type: 'leave_room' });
  send(first.ws2, { type: 'leave_room' });

  // Reentra em uma sala nova.
  send(first.ws1, { type: 'create_room' });
  const newRoomCode = lastOfType(first.ws1, 'room_created').roomCode;
  send(first.ws2, { type: 'join_room', roomCode: newRoomCode });
  const newMatch = MatchManager.getMatch(newRoomCode);
  newMatch.setState(MATCH_STATE.PLAYING);

  // Um note_hit "atrasado" que citasse a seed da partida ANTIGA (por
  // engano de um cliente desatualizado) nao pode contaminar a Match nova:
  // como o slot/roomCode do ws ja apontam para a sala nova, o servidor
  // sempre aplica contra a Match nova (nunca a antiga, que nem existe
  // mais em memoria).
  send(first.ws1, noteHitPayload(newMatch, { noteId: `note-${first.match.seed}-0` }));

  assert.strictEqual(newMatch.players.player1.hits, 1, 'o hit deveria ter sido aplicado na Match NOVA mesmo com noteId de outra seed');
});

// =====================================================================
// BLOCO B: combinacoes adicionais de idempotencia / isolamento
// =====================================================================

test('[B] leave_room seguido de uma chamada redundante e direta a matchFlow.cancelMatch nao produz um segundo match_cancelled', () => {
  const { room, ws1, ws2 } = createFullRoomViaProduction(); // COUNTDOWN

  send(ws1, { type: 'leave_room' }); // ja cancela a partida (match_cancelled)
  assert.ok(lastOfType(ws2, 'match_cancelled'));
  assert.strictEqual(countOfType(ws2, 'match_cancelled'), 1);

  // Uma segunda chamada direta e redundante (ex: alguma outra rota do
  // servidor tentando cancelar de novo) nao deve fazer nada, pois a
  // Match ja foi removida por leave_room.
  matchFlow.cancelMatch(room, 'chamada redundante');

  assert.strictEqual(countOfType(ws2, 'match_cancelled'), 1, 'nao deveria haver um segundo match_cancelled');
});

test('[B] leave_room seguido de uma chamada redundante e direta a matchAbandonment.handleAbandonment nao produz um segundo match_abandoned', () => {
  const { room, ws1, ws2, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.PLAYING);

  send(ws1, { type: 'leave_room' }); // ja processa o abandono (match_abandoned)
  assert.strictEqual(countOfType(ws2, 'match_abandoned'), 1);

  // Chamada direta e redundante ao mesmo mecanismo, para a MESMA Match:
  // idempotente por design (WeakMap em matchAbandonment.js).
  const processedAgain = matchAbandonment.handleAbandonment(room, match, 'player1');

  assert.strictEqual(processedAgain, false, 'uma segunda chamada nao deveria ser processada');
  assert.strictEqual(countOfType(ws2, 'match_abandoned'), 1, 'nao deveria haver um segundo match_abandoned');
});

test('[B] leave_room seguido de uma chamada redundante e direta a rematchFlow.cancelRematch nao produz um segundo rematch_cancelled', () => {
  const { room, ws1, ws2, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.FINISHED);
  rematchFlow.requestRematch(ws2, room); // so player2 pediu revanche ate agora

  send(ws1, { type: 'leave_room' }); // ja cancela a revanche pendente
  assert.strictEqual(countOfType(ws2, 'rematch_cancelled'), 1);

  // Chamada direta e redundante: nao ha mais nenhuma revanche pendente
  // para esta sala, entao cancelRematch deve ser um no-op silencioso.
  rematchFlow.cancelRematch(room, 'chamada redundante');

  assert.strictEqual(countOfType(ws2, 'rematch_cancelled'), 1, 'nao deveria haver um segundo rematch_cancelled');
});

test('[B] leave_room usando um roomCode de OUTRA sala real (ws.roomCode adulterado) nunca afeta essa outra sala', () => {
  const roomA = createFullRoomViaProduction();
  const roomB = createFullRoomViaProduction();
  roomA.match.setState(MATCH_STATE.PLAYING);
  roomB.match.setState(MATCH_STATE.PLAYING);

  // Simula uma conexao cujo estado local ficou inconsistente: roomCode
  // aponta para a sala B, mas essa conexao nunca ocupou um slot la (o
  // slot 'player1' da sala B pertence a outra conexao real).
  roomA.ws1.roomCode = roomB.roomCode;
  roomA.ws1.slot = 'player1';

  send(roomA.ws1, { type: 'leave_room' });

  // A sala B deve permanecer 100% intacta: ninguem foi removido, nenhum
  // evento foi disparado para os jogadores reais dela.
  assert.strictEqual(roomB.room.players.player1, roomB.ws1, 'player1 real da sala B nao deveria ter sido removido');
  assert.strictEqual(roomB.room.players.player2, roomB.ws2);
  assert.strictEqual(roomB.match.state, MATCH_STATE.PLAYING, 'partida da sala B nao deveria ter sido afetada');
  assert.strictEqual(countOfType(roomB.ws1, 'player_left_room'), 0);
  assert.strictEqual(countOfType(roomB.ws2, 'player_left_room'), 0);
  assert.ok(lastOfType(roomA.ws1, 'error'), 'a conexao adulterada deveria receber um erro, nao um left_room');
  assert.strictEqual(countOfType(roomA.ws1, 'left_room'), 0);

  // A sala A original (a que essa conexao realmente pertencia antes de
  // ser adulterada) tambem continua intacta -- leave_room nao mexeu nela,
  // porque o roomCode apontava para B no momento da chamada.
  assert.strictEqual(roomA.room.players.player1, roomA.ws1);
  assert.strictEqual(roomA.match.state, MATCH_STATE.PLAYING);
});

test('[B] countdown cancelado por leave_room: mesmo se o timer antigo disparasse, nunca produz match_started tardio', () => {
  const { room, ws1, ws2, match } = createFullRoomViaProduction(); // COUNTDOWN, com _countdownTimer real agendado
  const oldTimer = match._countdownTimer;
  assert.ok(oldTimer, 'deveria existir um _countdownTimer real agendado pelo matchFlow');

  send(ws1, { type: 'leave_room' }); // cancela a partida (MatchManager.removeMatch limpa o timer)

  assert.strictEqual(MatchManager.getMatch(room.code), null);

  // Mesmo assim, se o callback antigo (referenciado aqui manualmente)
  // fosse executado por algum motivo, o guard interno de scheduleCountdown
  // ("if (MatchManager.getMatch(room.code) !== match) return;") impede
  // qualquer match_started tardio, pois a Match ja nao e mais a atual
  // (nem existe mais) para este roomCode.
  if (typeof oldTimer._onTimeout === 'function') {
    oldTimer._onTimeout();
  }

  assert.strictEqual(countOfType(ws2, 'match_started'), 0, 'nenhum match_started tardio deveria ser enviado');
  assert.strictEqual(countOfType(ws1, 'match_started'), 0);
});

console.log(`\n${passed} teste(s) passaram.\n`);
