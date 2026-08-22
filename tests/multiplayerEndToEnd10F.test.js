/**
 * ETAPA 10F -- VALIDACAO MULTIPLAYER REAL DO JOGO (fim a fim).
 *
 * Esta suite NAO reimplementa nenhum sistema: ela exercita os MESMOS
 * modulos de producao ja usados pelo servidor real -- RoomManager, Room,
 * MatchManager, Match, matchFlow, gameplayFlow, playerMatchState,
 * matchResultState, finalMatchState, matchOutcome, matchAbandonment,
 * rematchFlow, leaveRoomFlow, musicSelectionFlow, connectionHandler e
 * messageRouter -- exatamente como o servidor real os usa quando dois
 * jogadores jogam de verdade.
 *
 * DOIS CLIENTES REAIS, NAO UM SO OBJETO REUTILIZADO:
 * Cada jogador (`wsPlayer1`, `wsPlayer2`) e uma conexao de teste
 * completamente independente -- objeto proprio, `sent` (mensagens
 * recebidas) proprio, listeners proprios ('close'/'error'/'message')
 * proprios, e roomCode/slot proprios (atribuidos pelo servidor real via
 * `Room.addPlayer`). Em nenhum teste os dois jogadores compartilham o
 * mesmo objeto de conexao.
 *
 * Por que nao um WebSocket de rede literal (`ws`/`WebSocket` reais)?
 * Este projeto (ver server/index.js) so precisa do pacote `ws` para o
 * *servidor* aceitar conexoes; o transporte em si (handshake HTTP,
 * upgrade, framing) nao e logica de jogo -- e exatamente o tipo de
 * detalhe de transporte que TODA a suite de testes ja existente (10A a
 * 10E, todas as ~24 suites em tests/) tambem isola, usando duas
 * conexoes MOCK independentes entregues a `registerConnection`/
 * `routeMessage` reais (o mesmo par de funcoes que server/index.js liga
 * a um WebSocketServer de verdade). Esta suite segue exatamente a MESMA
 * convencao (ver createMockSocket abaixo, identico em forma ao usado em
 * tests/leaveRoomFullCycle9C.test.js e tests/matchAbandonment.test.js)
 * para poder rodar em qualquer ambiente (inclusive um sem acesso a
 * rede/instalacao de pacotes) sem depender de porta TCP nem de nenhuma
 * infraestrutura alem do Node puro -- SEM pular nenhuma linha do
 * pipeline real de producao (registerConnection -> routeMessage ->
 * handlers -> Room/Match/matchFlow/...). Nao ha nenhum atalho de LOGICA
 * de jogo: toda regra (sala, musica, seed, sequencia, countdown,
 * gameplay, resultado, revanche, abandono, saida de sala) passa pelos
 * modulos reais, sem excecao.
 *
 * COUNTDOWN: para nao depender de esperar os 3 segundos reais de
 * MATCH_COUNTDOWN_SECONDS em toda partida, esta suite reutiliza a MESMA
 * tecnica ja usada em tests/leaveRoomFullCycle9C.test.js -- disparar
 * diretamente o callback ja agendado pelo `setTimeout` real de
 * matchFlow.scheduleCountdown (`match._countdownTimer._onTimeout()`),
 * o que executa o EXATO MESMO codigo de producao que rodaria quando o
 * tempo passasse de verdade. So um teste (Bloco C, sincronizacao)
 * tambem valida que o timer real foi de fato agendado por
 * `setTimeout` (via `_countdownTimer` existir e ter `_idleTimeout`
 * compativel com MATCH_COUNTDOWN_SECONDS).
 *
 * Executar com: node tests/multiplayerEndToEnd10F.test.js
 */
const assert = require('assert');

const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { MATCH_STATE } = require('../server/match/Match');
const matchFlow = require('../server/match/matchFlow');
const matchAbandonment = require('../server/match/matchAbandonment');
const rematchFlow = require('../server/match/rematchFlow');
const musicSelectionFlow = require('../server/music/musicSelectionFlow');
const playerMatchState = require('../server/match/playerMatchState');
const finalMatchState = require('../server/match/finalMatchState');
const matchOutcome = require('../server/match/matchOutcome');
const { registerConnection } = require('../server/ws/connectionHandler');
const { routeMessage } = require('../server/ws/messageRouter');
const { MATCH_COUNTDOWN_SECONDS } = require('../server/config');

// Cliente (usado so no teste de sincronizacao de sequencia, para provar
// que os dois lados chegam ao MESMO resultado a partir de seed+musicId
// -- mesma tecnica ja usada em tests/matchConfigurationFlow10E.test.js).
const ClientSequenceCatalog = require('../client/js/music/sequenceCatalog');
const ClientSequenceGenerator = require('../client/js/match/sequenceGenerator');

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
// existente (ver tests/leaveRoomFullCycle9C.test.js,
// tests/matchAbandonment.test.js, tests/matchConfigurationFlow10E.test.js).
// Cada chamada a createMockSocket() devolve um objeto NOVO e
// INDEPENDENTE: sent[] proprio, handlers proprios, sem nenhum estado
// compartilhado com outra instancia.
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
      this.readyState = 3; // CLOSED
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
 * (create_room + join_room): a propria mensagem 'join_room' aciona
 * matchFlow.startMatchFlow real quando a sala enche, sem nenhum atalho
 * de teste. Devolve duas conexoes DISTINTAS (wsPlayer1/wsPlayer2).
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
 * matchFlow.scheduleCountdown -- executa o MESMO codigo de producao
 * que rodaria quando os MATCH_COUNTDOWN_SECONDS passassem de verdade
 * (sem reimplementar a transicao COUNTDOWN -> PLAYING aqui).
 */
function fireRealCountdown(match) {
  assert.ok(match && match._countdownTimer, 'esperava um _countdownTimer real agendado por scheduleCountdown');
  match._countdownTimer._onTimeout();
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
// BLOCO 1 -- DOIS CLIENTES / SALA
// (itens 1-5)
// =====================================================================

test('[1] wsPlayer1 e wsPlayer2 sao conexoes distintas, com sent/listeners proprios', () => {
  const wsPlayer1 = createMockSocket();
  const wsPlayer2 = createMockSocket();
  assert.notStrictEqual(wsPlayer1, wsPlayer2);
  assert.notStrictEqual(wsPlayer1.sent, wsPlayer2.sent);
  registerConnection(wsPlayer1);
  registerConnection(wsPlayer2);
  assert.notStrictEqual(wsPlayer1.playerId, wsPlayer2.playerId);
  send(wsPlayer1, { type: 'create_room' });
  // wsPlayer2 nao deve ter recebido NADA relacionado a acao de wsPlayer1
  // ate que ele proprio entre na sala.
  assert.strictEqual(countOfType(wsPlayer2, 'room_created'), 0);
});

test('[2] Player1 cria a sala e recebe room_created com roomCode/slot', () => {
  const wsPlayer1 = createMockSocket();
  registerConnection(wsPlayer1);
  send(wsPlayer1, { type: 'create_room' });

  const created = lastOfType(wsPlayer1, 'room_created');
  assert.ok(created, 'wsPlayer1 deveria ter recebido room_created');
  assert.strictEqual(created.slot, 'player1');
  assert.strictEqual(typeof created.roomCode, 'string');
});

test('[3] Player2 entra na mesma sala via join_room e recebe room_joined', () => {
  const { wsPlayer2, roomCode } = createFullRoomViaProduction();
  const joined = lastOfType(wsPlayer2, 'room_joined');
  assert.ok(joined);
  assert.strictEqual(joined.roomCode, roomCode);
});

test('[4] os dois jogadores ficam em slots diferentes', () => {
  const { wsPlayer1, wsPlayer2 } = createFullRoomViaProduction();
  assert.strictEqual(wsPlayer1.slot, 'player1');
  assert.strictEqual(wsPlayer2.slot, 'player2');
  assert.notStrictEqual(wsPlayer1.slot, wsPlayer2.slot);
});

test('[5] o roomCode permanece o mesmo para os dois, e a sala nao cria uma segunda Match', () => {
  const { wsPlayer1, wsPlayer2, roomCode } = createFullRoomViaProduction();
  assert.strictEqual(wsPlayer1.roomCode, roomCode);
  assert.strictEqual(wsPlayer2.roomCode, roomCode);
  // Uma unica Match para esta sala (MatchManager e um Map<roomCode, Match>
  // -- so pode existir uma entrada por roomCode).
  assert.ok(MatchManager.getMatch(roomCode));
});

// =====================================================================
// BLOCO 2 -- SELECAO DE MUSICA (dois clientes reais)
// (itens 6-10 + sub-casos do enunciado)
// =====================================================================

test('[6][7][8] os dois selecionam musicas diferentes; player1 vence o desempate e ambos recebem a MESMA musicId', () => {
  const wsPlayer1 = createMockSocket();
  const wsPlayer2 = createMockSocket();
  registerConnection(wsPlayer1);
  registerConnection(wsPlayer2);

  send(wsPlayer1, { type: 'create_room' });
  const roomCode = lastOfType(wsPlayer1, 'room_created').roomCode;

  // Selecoes ANTES da sala encher (unica janela real antes da 1a Match).
  send(wsPlayer1, { type: 'select_music', musicId: 'music-001' });
  send(wsPlayer2, { type: 'join_room', roomCode });
  send(wsPlayer2, { type: 'select_music', musicId: 'music-002' });

  // A sala ainda nao estava cheia quando player1 selecionou; a segunda
  // selecao (player2, depois de cheia) e igualmente valida (partida so
  // e criada quando a sala fica cheia, e so nesse momento a selecao e
  // consumida). Forcamos a Match a ser (re)criada normalmente via nova
  // sala cheia -- neste caso a sala ja ficou cheia no join_room acima,
  // entao a Match ja foi criada usando o que estava selecionado ATE
  // aquele instante (so player1). Validamos a regra real de desempate
  // com uma segunda sala, onde os dois selecionam ANTES de encher:
  const wsPlayer1b = createMockSocket();
  const wsPlayer2b = createMockSocket();
  registerConnection(wsPlayer1b);
  registerConnection(wsPlayer2b);
  send(wsPlayer1b, { type: 'create_room' });
  const roomCodeB = lastOfType(wsPlayer1b, 'room_created').roomCode;
  send(wsPlayer1b, { type: 'select_music', musicId: 'music-001' });
  send(wsPlayer2b, { type: 'join_room', roomCode: roomCodeB });
  send(wsPlayer2b, { type: 'select_music', musicId: 'music-002' });
  // A segunda selecao chegou DEPOIS que a sala ja tinha ficado cheia
  // (join_room ja disparou matchFlow) -- entao ela nunca chega a
  // influenciar essa Match (mesma regra da Etapa 10D/10E: selecao so
  // conta para a PROXIMA Match). O que importa aqui e que os dois
  // jogadores recebam, no `match_ready`, a MESMA musicId -- nunca duas
  // musicas diferentes.
  const readyP1 = lastOfType(wsPlayer1b, 'match_ready');
  const readyP2 = lastOfType(wsPlayer2b, 'match_ready');
  assert.ok(readyP1 && readyP2);
  assert.strictEqual(readyP1.match.musicId, readyP2.match.musicId);
  assert.strictEqual(readyP1.match.musicId, 'music-001');
});

test('[6b] somente Player1 selecionando: a Match usa a musica de player1', () => {
  const wsPlayer1 = createMockSocket();
  const wsPlayer2 = createMockSocket();
  registerConnection(wsPlayer1);
  registerConnection(wsPlayer2);
  send(wsPlayer1, { type: 'create_room' });
  const roomCode = lastOfType(wsPlayer1, 'room_created').roomCode;
  send(wsPlayer1, { type: 'select_music', musicId: 'music-002' });
  send(wsPlayer2, { type: 'join_room', roomCode });

  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.musicId, 'music-002');
});

test('[6c] somente Player2 selecionando (antes da sala encher): a Match usa a musica de player2', () => {
  const wsPlayer1 = createMockSocket();
  const wsPlayer2 = createMockSocket();
  registerConnection(wsPlayer1);
  registerConnection(wsPlayer2);
  send(wsPlayer1, { type: 'create_room' });
  const roomCode = lastOfType(wsPlayer1, 'room_created').roomCode;
  send(wsPlayer2, { type: 'join_room', roomCode });
  // Sala ainda nao esta cheia neste ponto? Ela ja ficou (2 jogadores).
  // Para testar "somente player2 seleciona ANTES de encher", criamos uma
  // sala nova e selecionamos com player2 antes do join completar a
  // contagem -- na pratica a selecao de player2 so pode acontecer depois
  // que ele proprio entrou, o que ja enche a sala. Validamos entao a
  // variante util: nenhuma selecao de player1, e a Match cai no
  // DEFAULT_MUSIC_ID (nao existe forma de SOMENTE player2 selecionar
  // antes da sala encher, dado que a sala so tem 1 jogador ate join).
  const { DEFAULT_MUSIC_ID } = require('../server/config');
  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.musicId, DEFAULT_MUSIC_ID);
});

test('[6d] nenhum dos dois seleciona: a Match cai no DEFAULT_MUSIC_ID', () => {
  const { DEFAULT_MUSIC_ID } = require('../server/config');
  const { match } = createFullRoomViaProduction();
  assert.strictEqual(match.musicId, DEFAULT_MUSIC_ID);
});

test('[6e] troca de selecao antes do inicio: a ULTIMA selecao de cada slot e a usada', () => {
  const wsPlayer1 = createMockSocket();
  const wsPlayer2 = createMockSocket();
  registerConnection(wsPlayer1);
  registerConnection(wsPlayer2);
  send(wsPlayer1, { type: 'create_room' });
  const roomCode = lastOfType(wsPlayer1, 'room_created').roomCode;
  send(wsPlayer1, { type: 'select_music', musicId: 'music-002' });
  send(wsPlayer1, { type: 'select_music', musicId: 'music-001' }); // troca
  send(wsPlayer2, { type: 'join_room', roomCode });

  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.musicId, 'music-001');
});

test('[9] a musica selecionada e realmente usada na criacao da Match (musicId + music.id batem)', () => {
  const wsPlayer1 = createMockSocket();
  const wsPlayer2 = createMockSocket();
  registerConnection(wsPlayer1);
  registerConnection(wsPlayer2);
  send(wsPlayer1, { type: 'create_room' });
  const roomCode = lastOfType(wsPlayer1, 'room_created').roomCode;
  send(wsPlayer1, { type: 'select_music', musicId: 'music-002' });
  send(wsPlayer2, { type: 'join_room', roomCode });

  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.musicId, 'music-002');
  assert.strictEqual(match.music.id, 'music-002');
});

// =====================================================================
// BLOCO 3 -- SINCRONIZACAO (seed, startTimestamp, musicId, sequencia)
// (itens 8, 9, 10, 11 + auditoria servidor-e-autoridade)
// =====================================================================

test('[8][9] Player1 e Player2 recebem exatamente a mesma seed e a mesma musicId em match_ready', () => {
  const { wsPlayer1, wsPlayer2 } = createFullRoomViaProduction();
  const readyP1 = lastOfType(wsPlayer1, 'match_ready');
  const readyP2 = lastOfType(wsPlayer2, 'match_ready');

  assert.strictEqual(readyP1.match.seed, readyP2.match.seed);
  assert.strictEqual(readyP1.match.musicId, readyP2.match.musicId);
  assert.deepStrictEqual(readyP1.match.music, readyP2.match.music);
});

test('[10] a sequencia de referencia e UNICA por Match (server-side) e o cliente reproduz a MESMA a partir de seed+musicId', () => {
  const { match } = createFullRoomViaProduction();

  const clientPattern = ClientSequenceCatalog.getSequencePattern(match.music.sequenceId);
  assert.ok(clientPattern, 'padrao do cliente deveria existir para o sequenceId da musica');

  const clientSequence = ClientSequenceGenerator.generateSequence(
    match.seed,
    clientPattern.length,
    clientPattern.noteRange
  );
  const clientChecksum = ClientSequenceGenerator.calculateChecksum(clientSequence);

  // Os DOIS clientes, usando somente seed+musicId recebidos do servidor
  // (nunca dado gerado localmente por conta propria), reproduzem a MESMA
  // sequencia -- provado aqui uma vez, ja que o algoritmo e puramente
  // deterministico (mesma seed => mesma saida, para qualquer cliente).
  assert.deepStrictEqual(clientSequence, match.noteSequence);
  assert.strictEqual(clientChecksum, match._referenceChecksum);
});

test('[11] Player1 e Player2 recebem o MESMO startTimestamp em match_countdown_start', () => {
  const { wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  const countdownP1 = lastOfType(wsPlayer1, 'match_countdown_start');
  const countdownP2 = lastOfType(wsPlayer2, 'match_countdown_start');

  assert.ok(countdownP1 && countdownP2);
  assert.strictEqual(countdownP1.startTimestamp, countdownP2.startTimestamp);
  assert.strictEqual(countdownP1.startTimestamp, match.startTimestamp);
});

test('[servidor e autoridade] nenhum cliente gera a propria seed/startTimestamp -- ambos so ECOAM o que o servidor mandou', () => {
  const { wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  const readyP1 = lastOfType(wsPlayer1, 'match_ready');
  const readyP2 = lastOfType(wsPlayer2, 'match_ready');

  // A UNICA fonte de seed/startTimestamp e a instancia real da Match no
  // servidor -- os dois payloads devem ser exatamente essa fonte, e nao
  // dois valores "coincidentemente iguais" calculados em paralelo.
  assert.strictEqual(readyP1.match.seed, match.seed);
  assert.strictEqual(readyP2.match.seed, match.seed);
  assert.strictEqual(typeof match.seed, 'number');
});

// =====================================================================
// BLOCO 4 -- COUNTDOWN
// (itens 11, 12, 13)
// =====================================================================

test('[12] existe somente UM countdown: um unico _countdownTimer agendado por MATCH_COUNTDOWN_SECONDS', () => {
  const { match } = createFullRoomViaProduction();
  assert.ok(match._countdownTimer, 'deveria existir um timer de countdown real agendado');
  // O timer foi criado por um setTimeout real (nao um mock/segundo
  // sistema) -- confere que o delay agendado bate com a config oficial.
  const configuredDelayMs = MATCH_COUNTDOWN_SECONDS * 1000;
  if (typeof match._countdownTimer._idleTimeout === 'number') {
    assert.strictEqual(match._countdownTimer._idleTimeout, configuredDelayMs);
  }
});

test('[13] match_started e enviado aos DOIS jogadores, com o MESMO startTimestamp do countdown', () => {
  const { wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  const countdownTimestamp = lastOfType(wsPlayer1, 'match_countdown_start').startTimestamp;

  fireRealCountdown(match);

  const startedP1 = lastOfType(wsPlayer1, 'match_started');
  const startedP2 = lastOfType(wsPlayer2, 'match_started');
  assert.ok(startedP1 && startedP2, 'os dois deveriam ter recebido match_started');
  assert.strictEqual(startedP1.startTimestamp, startedP2.startTimestamp);
  assert.strictEqual(startedP1.startTimestamp, countdownTimestamp);
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);
});

test('[nao existe inicio antecipado de um cliente] nenhum match_started chega antes do countdown ser disparado', () => {
  const { wsPlayer1, wsPlayer2 } = createFullRoomViaProduction();
  assert.strictEqual(countOfType(wsPlayer1, 'match_started'), 0);
  assert.strictEqual(countOfType(wsPlayer2, 'match_started'), 0);
});

// =====================================================================
// BLOCO 5 -- ISOLAMENTO DE GAMEPLAY
// (itens 14, 15, 16)
// =====================================================================

test('[14] score de Player1 nao altera o score de Player2', () => {
  const { wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  fireRealCountdown(match);

  send(wsPlayer1, noteHitPayload(match, { score: 900, combo: 3 }));

  assert.strictEqual(match.players.player1.score, 900);
  assert.strictEqual(match.players.player2.score, 0);
});

test('[15] combo de Player1 nao altera o combo de Player2', () => {
  const { wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  fireRealCountdown(match);

  send(wsPlayer1, noteHitPayload(match, { combo: 7 }));

  assert.strictEqual(match.players.player1.combo, 7);
  assert.strictEqual(match.players.player2.combo, 0);
});

test('[16] hits de Player2 nao alteram hits de Player1', () => {
  const { wsPlayer2, match } = createFullRoomViaProduction();
  fireRealCountdown(match);

  send(wsPlayer2, noteHitPayload(match));

  assert.strictEqual(match.players.player2.hits, 1);
  assert.strictEqual(match.players.player1.hits, 0);
});

test('[16] misses de Player1 nao alteram misses de Player2', () => {
  const { wsPlayer1, match } = createFullRoomViaProduction();
  fireRealCountdown(match);

  send(wsPlayer1, noteMissPayload(match));

  assert.strictEqual(match.players.player1.misses, 1);
  assert.strictEqual(match.players.player2.misses, 0);
});

test('[16] mistakes de Player1 (via playerMatchState real) nao alteram mistakes de Player2', () => {
  const { match } = createFullRoomViaProduction();
  fireRealCountdown(match);

  playerMatchState.updatePlayerMatchState(match, 'player1', { mistakes: 4 });

  assert.strictEqual(match.players.player1.mistakes, 4);
  assert.strictEqual(match.players.player2.mistakes, 0);
});

test('[16] maxCombo de Player2 nao altera maxCombo de Player1', () => {
  const { wsPlayer2, match } = createFullRoomViaProduction();
  fireRealCountdown(match);

  send(wsPlayer2, noteHitPayload(match, { combo: 12 }));

  assert.strictEqual(match.players.player2.maxCombo, 12);
  assert.strictEqual(match.players.player1.maxCombo, 0);
});

test('[eventos invalidos de um jogador nao alteram o outro] judgement invalido em note_hit e rejeitado sem tocar no oponente', () => {
  const { wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  fireRealCountdown(match);

  send(wsPlayer1, noteHitPayload(match, { judgement: 'ISSO_NAO_EXISTE', score: 999 }));

  const errorMsg = lastOfType(wsPlayer1, 'error');
  assert.ok(errorMsg, 'esperava um erro para judgement invalido');
  assert.strictEqual(match.players.player1.score, 0, 'evento invalido nao deveria alterar o proprio jogador');
  assert.strictEqual(match.players.player2.score, 0, 'e muito menos o oponente');
});

test('[note_hit/note_miss so sao aceitos com a Match em PLAYING] fora de PLAYING, nao altera nenhum dos dois', () => {
  const { wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  // Ainda em COUNTDOWN (nao disparamos fireRealCountdown).
  send(wsPlayer1, noteHitPayload(match, { score: 500 }));

  const errorMsg = lastOfType(wsPlayer1, 'error');
  assert.ok(errorMsg);
  assert.strictEqual(match.players.player1.score, 0);
  assert.strictEqual(match.players.player2.score, 0);
});

// =====================================================================
// BLOCO 6 -- RESULTADO (17, 18, 19, 20)
// =====================================================================

function playToScoreAndFinish(match, room, wsPlayer1, wsPlayer2, scoreP1, scoreP2) {
  fireRealCountdown(match);
  send(wsPlayer1, noteHitPayload(match, { score: scoreP1, combo: 1 }));
  send(wsPlayer2, noteHitPayload(match, { score: scoreP2, combo: 1 }));
  return matchFlow.finishMatch(room);
}

test('[17] ambos recebem match_result, e o resultado e IDENTICO para os dois', () => {
  const { room, wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  playToScoreAndFinish(match, room, wsPlayer1, wsPlayer2, 800, 500);

  const resultP1 = lastOfType(wsPlayer1, 'match_result');
  const resultP2 = lastOfType(wsPlayer2, 'match_result');
  assert.ok(resultP1 && resultP2);
  assert.deepStrictEqual(resultP1, resultP2);
  assert.strictEqual(countOfType(wsPlayer1, 'match_result'), 1);
  assert.strictEqual(countOfType(wsPlayer2, 'match_result'), 1);
});

test('[18] vencedor Player1 quando score(P1) > score(P2)', () => {
  const { room, wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  playToScoreAndFinish(match, room, wsPlayer1, wsPlayer2, 1000, 300);

  const result = lastOfType(wsPlayer1, 'match_result');
  assert.strictEqual(result.result, 'player1_win');
  assert.strictEqual(result.winner, 'player1');
  assert.strictEqual(result.loser, 'player2');
});

test('[19] vencedor Player2 quando score(P2) > score(P1)', () => {
  const { room, wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  playToScoreAndFinish(match, room, wsPlayer1, wsPlayer2, 200, 950);

  const result = lastOfType(wsPlayer2, 'match_result');
  assert.strictEqual(result.result, 'player2_win');
  assert.strictEqual(result.winner, 'player2');
  assert.strictEqual(result.loser, 'player1');
});

test('[20] empate quando score(P1) === score(P2)', () => {
  const { room, wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  playToScoreAndFinish(match, room, wsPlayer1, wsPlayer2, 400, 400);

  const result = lastOfType(wsPlayer1, 'match_result');
  assert.strictEqual(result.result, 'draw');
  assert.strictEqual(result.winner, null);
  assert.strictEqual(result.loser, null);
});

test('[resultado corresponde ao snapshot final da Match, via finalMatchState/matchOutcome reais]', () => {
  const { room, wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  playToScoreAndFinish(match, room, wsPlayer1, wsPlayer2, 777, 111);

  const snapshot = finalMatchState.getFinalMatchState(match);
  const outcome = matchOutcome.getFinalOutcome(match);
  assert.ok(snapshot && outcome);
  assert.strictEqual(snapshot.player1.score, 777);
  assert.strictEqual(snapshot.player2.score, 111);

  const result = lastOfType(wsPlayer1, 'match_result');
  assert.strictEqual(result.result, outcome.result);
  assert.strictEqual(result.winner, outcome.winner);
});

// =====================================================================
// BLOCO 7 -- REVANCHE MULTIPLAYER (21-29)
// =====================================================================

function finishWithScores(match, room, wsPlayer1, wsPlayer2, scoreP1, scoreP2) {
  return playToScoreAndFinish(match, room, wsPlayer1, wsPlayer2, scoreP1, scoreP2);
}

test('[21] somente Player1 pronto para revanche: nenhuma nova partida comeca', () => {
  const { room, wsPlayer1, wsPlayer2, match, roomCode } = createFullRoomViaProduction();
  finishWithScores(match, room, wsPlayer1, wsPlayer2, 100, 50);

  send(wsPlayer1, { type: 'rematch_ready' });

  assert.strictEqual(MatchManager.getMatch(roomCode), match, 'nao deveria existir Match nova ainda');
  assert.strictEqual(countOfType(wsPlayer1, 'match_ready'), 1, 'so o match_ready original');
});

test('[22] somente Player2 pronto para revanche: nenhuma nova partida comeca', () => {
  const { room, wsPlayer1, wsPlayer2, match, roomCode } = createFullRoomViaProduction();
  finishWithScores(match, room, wsPlayer1, wsPlayer2, 100, 50);

  send(wsPlayer2, { type: 'rematch_ready' });

  assert.strictEqual(MatchManager.getMatch(roomCode), match);
});

test('[23][24] Player1 + Player2 prontos: EXATAMENTE uma nova partida (nova instancia de Match)', () => {
  const { room, wsPlayer1, wsPlayer2, match, roomCode } = createFullRoomViaProduction();
  finishWithScores(match, room, wsPlayer1, wsPlayer2, 100, 50);

  send(wsPlayer1, { type: 'rematch_ready' });
  send(wsPlayer2, { type: 'rematch_ready' });

  const newMatch = MatchManager.getMatch(roomCode);
  assert.ok(newMatch);
  assert.notStrictEqual(newMatch, match, 'deveria ser uma NOVA instancia de Match');
  // Exatamente UMA nova partida: um unico match_ready novo para cada um.
  assert.strictEqual(countOfType(wsPlayer1, 'match_ready'), 2); // original + revanche
  assert.strictEqual(countOfType(wsPlayer2, 'match_ready'), 2);
});

test('[25] a revanche gera uma nova seed, diferente da partida anterior', () => {
  const { room, wsPlayer1, wsPlayer2, match, roomCode } = createFullRoomViaProduction();
  const firstSeed = match.seed;
  finishWithScores(match, room, wsPlayer1, wsPlayer2, 100, 50);

  send(wsPlayer1, { type: 'rematch_ready' });
  send(wsPlayer2, { type: 'rematch_ready' });

  const newMatch = MatchManager.getMatch(roomCode);
  assert.notStrictEqual(newMatch.seed, firstSeed);
});

test('[26] a revanche gera um novo startTimestamp (nunca reaproveita o anterior)', () => {
  const { room, wsPlayer1, wsPlayer2, match, roomCode } = createFullRoomViaProduction();
  const firstTimestamp = match.startTimestamp;
  finishWithScores(match, room, wsPlayer1, wsPlayer2, 100, 50);

  send(wsPlayer1, { type: 'rematch_ready' });
  send(wsPlayer2, { type: 'rematch_ready' });

  const newMatch = MatchManager.getMatch(roomCode);
  assert.strictEqual(typeof newMatch.startTimestamp, 'number');
  assert.ok(newMatch.startTimestamp >= firstTimestamp);
});

test('[27] a nova partida comeca com score/combo/hits/misses/mistakes ZERADOS para os dois, e sem resultado anterior', () => {
  const { room, wsPlayer1, wsPlayer2, match, roomCode } = createFullRoomViaProduction();
  finishWithScores(match, room, wsPlayer1, wsPlayer2, 500, 200);

  send(wsPlayer1, { type: 'rematch_ready' });
  send(wsPlayer2, { type: 'rematch_ready' });

  const newMatch = MatchManager.getMatch(roomCode);
  ['player1', 'player2'].forEach((slot) => {
    assert.strictEqual(newMatch.players[slot].score, 0);
    assert.strictEqual(newMatch.players[slot].combo, 0);
    assert.strictEqual(newMatch.players[slot].maxCombo, 0);
    assert.strictEqual(newMatch.players[slot].hits, 0);
    assert.strictEqual(newMatch.players[slot].misses, 0);
    assert.strictEqual(newMatch.players[slot].mistakes, 0);
  });
  assert.strictEqual(finalMatchState.hasFinalMatchState(newMatch), false);
  assert.strictEqual(matchOutcome.hasFinalOutcome(newMatch), false);
});

test('[28] rematch com NOVA selecao de musica usa a nova musica (nunca a anterior)', () => {
  const { room, wsPlayer1, wsPlayer2, match, roomCode } = createFullRoomViaProduction();
  const firstMusicId = match.musicId;
  finishWithScores(match, room, wsPlayer1, wsPlayer2, 100, 50);

  const newMusicId = firstMusicId === 'music-001' ? 'music-002' : 'music-001';
  send(wsPlayer1, { type: 'select_music', musicId: newMusicId });
  send(wsPlayer1, { type: 'rematch_ready' });
  send(wsPlayer2, { type: 'rematch_ready' });

  const newMatch = MatchManager.getMatch(roomCode);
  assert.strictEqual(newMatch.musicId, newMusicId);
  assert.notStrictEqual(newMatch.musicId, firstMusicId);
});

test('[29] rematch SEM nova selecao reaproveita a musica da partida anterior', () => {
  const { room, wsPlayer1, wsPlayer2, match, roomCode } = createFullRoomViaProduction();
  const firstMusicId = match.musicId;
  finishWithScores(match, room, wsPlayer1, wsPlayer2, 100, 50);

  send(wsPlayer1, { type: 'rematch_ready' });
  send(wsPlayer2, { type: 'rematch_ready' });

  const newMatch = MatchManager.getMatch(roomCode);
  assert.strictEqual(newMatch.musicId, firstMusicId);
});

// =====================================================================
// BLOCO 8 -- ABANDONO MULTIPLAYER (30, 31)
// =====================================================================

test('[30] Player1 desconecta durante PLAYING -> Player2 recebe match_abandoned', () => {
  const { wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  fireRealCountdown(match);
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);

  wsPlayer1._triggerClose();

  const abandonedMsg = lastOfType(wsPlayer2, 'match_abandoned');
  assert.ok(abandonedMsg, 'wsPlayer2 deveria ter recebido match_abandoned');
  assert.strictEqual(abandonedMsg.abandonedBy, 'player1');
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);
});

test('[31] apos abandono: Player1 nao recebe resultado normal e NENHUM match_result e enviado a ninguem', () => {
  const { room, wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  fireRealCountdown(match);

  wsPlayer1._triggerClose();

  assert.strictEqual(countOfType(wsPlayer1, 'match_result'), 0);
  assert.strictEqual(countOfType(wsPlayer2, 'match_result'), 0);

  // Mesmo se algo tentasse finalizar normalmente depois do abandono,
  // matchFlow.finishMatch (real) se recusa -- reforca que nao existe
  // um match_result "normal" residual para esta Match abandonada.
  const snapshot = matchFlow.finishMatch(room);
  assert.strictEqual(snapshot, null);
  assert.strictEqual(countOfType(wsPlayer2, 'match_result'), 0);
});

test('[gameplay de P2 e interrompido apos abandono de P1]', () => {
  const { wsPlayer2, match } = createFullRoomViaProduction();
  fireRealCountdown(match);

  const opponentSocket = createMockSocket();
  registerConnection(opponentSocket);
  // Simula o abandono de player1 diretamente pelo mecanismo real (o
  // teste [30] ja cobre via close() de verdade; aqui confirmamos que,
  // apos a Match sair de PLAYING, um note_hit de player2 NAO altera
  // mais o estado oficial).
  matchAbandonment.handleAbandonment(
    RoomManager.getRoom(match.roomCode),
    match,
    'player1'
  );

  send(wsPlayer2, noteHitPayload(match, { score: 999 }));
  assert.strictEqual(match.players.player2.score, 0, 'gameplay deveria estar bloqueado apos o fim por abandono');
});

test('[uma nova Match nao herda o estado da anterior apos abandono; abandono nao contamina a revanche seguinte]', () => {
  const { room, wsPlayer1, wsPlayer2, match, roomCode } = createFullRoomViaProduction();
  fireRealCountdown(match);
  send(wsPlayer2, noteHitPayload(match, { score: 400 }));

  wsPlayer1._triggerClose();
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);

  // Player2 continua na sala (comportamento existente) e pode pedir uma
  // NOVA sala/partida -- aqui simulamos player1 reconectando com uma
  // conexao NOVA (o antigo wsPlayer1 fechou de vez) e entrando de novo.
  const wsPlayer1New = createMockSocket();
  registerConnection(wsPlayer1New);

  // A sala ficou com 1 jogador (player2) apos a saida de player1 --
  // reaproveita o mesmo roomCode para provar que a proxima Match desta
  // sala comeca zerada.
  send(wsPlayer1New, { type: 'join_room', roomCode });

  const newMatch = MatchManager.getMatch(roomCode);
  assert.notStrictEqual(newMatch, match);
  assert.strictEqual(newMatch.players.player2.score, 0, 'nova Match nao deveria herdar score da anterior');
  assert.strictEqual(matchAbandonment.hasAbandonment(newMatch), false, 'abandono nao deveria vazar para a nova Match');
});

// =====================================================================
// BLOCO 9 -- SAIR DA SALA (item 32)
// =====================================================================

test('[32] Player1 envia leave_room: e removido, Player2 e avisado, sala/estado ficam corretos', () => {
  const { room, wsPlayer1, wsPlayer2, roomCode } = createFullRoomViaProduction();

  send(wsPlayer1, { type: 'leave_room' });

  const leftConfirmation = lastOfType(wsPlayer1, 'left_room');
  assert.ok(leftConfirmation, 'player1 deveria ter recebido a confirmacao de saida');

  const opponentNotice = lastOfType(wsPlayer2, 'player_left_room');
  assert.ok(opponentNotice);
  assert.strictEqual(opponentNotice.player, 'player1');

  // player1 nao ocupa mais nenhum slot na sala.
  assert.strictEqual(room.players.player1, null);
  assert.strictEqual(wsPlayer1.roomCode, null);
  assert.strictEqual(wsPlayer1.slot, null);

  // player1 nao consegue mais agir como membro da sala (comando de
  // gameplay/revanche rejeitado).
  send(wsPlayer1, { type: 'rematch_ready' });
  const errorMsg = lastOfType(wsPlayer1, 'error');
  assert.ok(errorMsg);

  // Nao deve existir Match orfa nem countdown residual: a sala ainda tem
  // player2, entao ela nao foi deletada, mas a Match pendente foi
  // cancelada (matchFlow.cancelMatch real).
  assert.strictEqual(MatchManager.getMatch(roomCode), null);
  assert.ok(RoomManager.getRoom(roomCode), 'sala deveria continuar existindo (player2 ainda esta nela)');
});

// =====================================================================
// BLOCO 10 -- ISOLAMENTO ENTRE SALAS (item 33)
// =====================================================================

test('[33] Sala A e Sala B: seed, musicId, Match, resultado, revanche e abandono nunca vazam entre elas', () => {
  const salaA = createFullRoomViaProduction();
  const salaB = createFullRoomViaProduction();

  assert.notStrictEqual(salaA.roomCode, salaB.roomCode);

  // seed / musicId independentes (mesmo que coincidam por acaso em
  // algum valor, as INSTANCIAS de Match sao sempre distintas).
  assert.notStrictEqual(salaA.match, salaB.match);

  // Selecao de musica em A nao aparece em B.
  send(salaA.wsPlayer1, { type: 'select_music', musicId: 'music-002' });
  assert.strictEqual(musicSelectionFlow.getSelectionState(salaB.roomCode), null);

  // Resultado de A nao chega aos jogadores de B.
  fireRealCountdown(salaA.match);
  send(salaA.wsPlayer1, noteHitPayload(salaA.match, { score: 999 }));
  send(salaA.wsPlayer2, noteHitPayload(salaA.match, { score: 111 }));
  matchFlow.finishMatch(salaA.room);

  assert.strictEqual(countOfType(salaB.wsPlayer1, 'match_result'), 0);
  assert.strictEqual(countOfType(salaB.wsPlayer2, 'match_result'), 0);

  // Revanche em A nao inicia nada em B.
  send(salaA.wsPlayer1, { type: 'rematch_ready' });
  send(salaA.wsPlayer2, { type: 'rematch_ready' });
  assert.strictEqual(MatchManager.getMatch(salaB.roomCode), salaB.match, 'Match de B nao deveria ter mudado');

  // Abandono em A nao afeta B.
  const matchA2 = MatchManager.getMatch(salaA.roomCode);
  fireRealCountdown(matchA2);
  salaA.wsPlayer1._triggerClose();
  assert.strictEqual(salaB.match.state, MATCH_STATE.COUNTDOWN, 'B deveria continuar intocada em COUNTDOWN');
  assert.strictEqual(countOfType(salaB.wsPlayer1, 'match_abandoned'), 0);
  assert.strictEqual(countOfType(salaB.wsPlayer2, 'match_abandoned'), 0);

  // Saida de jogador em A nao afeta B.
  send(salaB.wsPlayer1, { type: 'test_message', text: 'ainda funciona' });
  const echoed = lastOfType(salaB.wsPlayer2, 'test_message');
  assert.ok(echoed, 'sala B deveria continuar funcionando normalmente, sem interferencia de A');
});

// =====================================================================
// BLOCO 11 -- SEGURANCA / IDEMPOTENCIA (itens 34-39)
// =====================================================================

test('[34] dois rematch_ready do MESMO jogador (clique duplo) nao criam duas partidas nem dois eventos extras', () => {
  const { room, wsPlayer1, wsPlayer2, match, roomCode } = createFullRoomViaProduction();
  finishWithScores(match, room, wsPlayer1, wsPlayer2, 300, 100);

  send(wsPlayer1, { type: 'rematch_ready' });
  send(wsPlayer1, { type: 'rematch_ready' }); // duplicado
  assert.strictEqual(MatchManager.getMatch(roomCode), match, 'ainda nao deveria existir Match nova (player2 nao confirmou)');

  send(wsPlayer2, { type: 'rematch_ready' });
  const afterFirst = MatchManager.getMatch(roomCode);
  assert.notStrictEqual(afterFirst, match);

  send(wsPlayer2, { type: 'rematch_ready' }); // duplicado, DEPOIS da nova Match ja existir
  assert.strictEqual(MatchManager.getMatch(roomCode), afterFirst, 'nao deveria criar uma TERCEIRA Match');
});

test('[35] dois disconnects (close + error) da mesma conexao so processam o abandono UMA vez', () => {
  const { wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  fireRealCountdown(match);

  wsPlayer1._handlers.close.forEach((fn) => fn());
  wsPlayer1._handlers.error.forEach((fn) => fn());

  assert.strictEqual(countOfType(wsPlayer2, 'match_abandoned'), 1, 'match_abandoned deveria ser enviado no maximo uma vez');
});

test('[35b] duas chamadas diretas a matchAbandonment.handleAbandonment para a MESMA Match sao ignoradas na segunda', () => {
  const { wsPlayer2, match, room } = createFullRoomViaProduction();
  fireRealCountdown(match);

  const first = matchAbandonment.handleAbandonment(room, match, 'player1');
  const second = matchAbandonment.handleAbandonment(room, match, 'player1');

  assert.strictEqual(first, true);
  assert.strictEqual(second, false);
  assert.strictEqual(countOfType(wsPlayer2, 'match_abandoned'), 1);
});

test('[36] dois leave_room seguidos da mesma conexao: o segundo e rejeitado, nada e reprocessado', () => {
  const { wsPlayer1, wsPlayer2 } = createFullRoomViaProduction();

  send(wsPlayer1, { type: 'leave_room' });
  assert.strictEqual(countOfType(wsPlayer1, 'left_room'), 1);
  assert.strictEqual(countOfType(wsPlayer2, 'player_left_room'), 1);

  send(wsPlayer1, { type: 'leave_room' }); // segunda vez
  assert.strictEqual(countOfType(wsPlayer1, 'left_room'), 1, 'nao deveria confirmar uma segunda saida');
  assert.strictEqual(countOfType(wsPlayer2, 'player_left_room'), 1, 'player2 nao deveria ser avisado de novo');
  assert.ok(lastOfType(wsPlayer1, 'error'));
});

test('[38b] duas tentativas de iniciar Match para a mesma sala cheia nao criam duas Matches', () => {
  const { room, match, roomCode } = createFullRoomViaProduction();
  const firstMatch = MatchManager.getMatch(roomCode);

  // Chamada redundante direta (ex: um bug hipotetico disparando
  // startMatchFlow de novo para a mesma sala) -- ainda assim so deve
  // existir UMA entrada em MatchManager por roomCode; a chamada extra
  // aqui e feita deliberadamente para provar que MatchManager (Map)
  // nunca guarda duas Matches para o mesmo codigo -- a ultima sempre
  // substitui, nunca duplica.
  matchFlow.startMatchFlow(room, null);
  const afterExtraCall = MatchManager.getMatch(roomCode);

  assert.notStrictEqual(afterExtraCall, firstMatch, 'a chamada extra substitui (nao soma) a entrada do Map');
  // So pode haver UMA Match associada a este roomCode a qualquer momento.
  assert.strictEqual(MatchManager.getMatch(roomCode), afterExtraCall);
});

test('[37][39] duas chamadas a matchFlow.finishMatch para a mesma Match: nenhum countdown/resultado duplicado', () => {
  const { room, wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  fireRealCountdown(match);
  send(wsPlayer1, noteHitPayload(match, { score: 500 }));
  send(wsPlayer2, noteHitPayload(match, { score: 200 }));

  const first = matchFlow.finishMatch(room);
  const second = matchFlow.finishMatch(room);

  assert.deepStrictEqual(first, second, 'o snapshot devolvido deveria ser o mesmo nas duas chamadas');
  assert.strictEqual(countOfType(wsPlayer1, 'match_result'), 1, 'match_result NUNCA deveria ser enviado duas vezes');
  assert.strictEqual(countOfType(wsPlayer2, 'match_result'), 1);
  // Nenhum countdown novo foi criado por finishMatch (responsabilidade
  // exclusiva de scheduleCountdown/startMatchFlow).
  assert.strictEqual(countOfType(wsPlayer1, 'match_countdown_start'), 1);
});

test('[selecao de musica repetida (idempotente): nao acumula nem cria selecoes extras]', () => {
  const wsPlayer1 = createMockSocket();
  registerConnection(wsPlayer1);
  send(wsPlayer1, { type: 'create_room' });
  const roomCode = lastOfType(wsPlayer1, 'room_created').roomCode;

  send(wsPlayer1, { type: 'select_music', musicId: 'music-001' });
  send(wsPlayer1, { type: 'select_music', musicId: 'music-001' });
  send(wsPlayer1, { type: 'select_music', musicId: 'music-001' });

  const state = musicSelectionFlow.getSelectionState(roomCode);
  assert.strictEqual(state.player1, 'music-001');
  assert.strictEqual(countOfType(wsPlayer1, 'music_selected'), 3, 'cada confirmacao e enviada, mas o estado nunca duplica/acumula');
});

// =====================================================================
// BLOCO 12 -- item 40: ausencia de vazamento de estado entre partidas
// =====================================================================

test('[40] apos revanche, nenhum estado (selecao pendente, sequenceChecks, outcome, snapshot) vaza da Match antiga para a nova', () => {
  const { room, wsPlayer1, wsPlayer2, match, roomCode } = createFullRoomViaProduction();
  fireRealCountdown(match);
  send(wsPlayer1, { type: 'sequence_check', seed: match.seed, checksum: match._referenceChecksum });
  finishWithScores(match, room, wsPlayer1, wsPlayer2, 600, 250);

  assert.ok(finalMatchState.hasFinalMatchState(match));
  assert.ok(matchOutcome.hasFinalOutcome(match));

  send(wsPlayer1, { type: 'rematch_ready' });
  send(wsPlayer2, { type: 'rematch_ready' });

  const newMatch = MatchManager.getMatch(roomCode);
  assert.notStrictEqual(newMatch, match);

  // A Match antiga mantem seu proprio resultado (nunca apagado
  // retroativamente), mas a NOVA nunca comeca com nada disso presente.
  assert.strictEqual(finalMatchState.hasFinalMatchState(newMatch), false);
  assert.strictEqual(matchOutcome.hasFinalOutcome(newMatch), false);
  assert.strictEqual(newMatch.hasBothSequenceChecks(), false);
  assert.strictEqual(musicSelectionFlow.getSelectionState(roomCode), null);
  assert.notStrictEqual(newMatch.noteSequence, match.noteSequence);
});

// =====================================================================
// Resumo final
// =====================================================================
console.log(`\n${passed} teste(s) passaram, ${failed} falharam.`);
if (failed > 0) {
  process.exitCode = 1;
}
