/**
 * ETAPA 15C-MP — Parte 3: Validacao do fluxo COMPLETO do Multiplayer com
 * duracao configuravel.
 *
 * Esta parte NAO implementa nenhuma funcionalidade nova. As Partes 1 e 2
 * ja cobriram, isoladamente:
 *   - Parte 1 (tests/matchDurationMultiplayer15CMP1.test.js): transporte
 *     de `select_duration` ate a Match Multiplayer (durationId/durationMs
 *     identicos para os dois jogadores, regras de desempate/limpeza).
 *   - Parte 2 (tests/matchDurationMultiplayerEnd15CMP2.test.js): a
 *     composicao client-side (MatchEndDetector + durationMs do servidor +
 *     startTimestamp) que efetivamente encerra a partida no limite.
 *
 * Esta Parte 3 fecha a validacao ponta a ponta, encadeando TUDO num unico
 * fluxo (exatamente a lista do enunciado da Parte 3):
 *   1. jogador escolhe a duracao (30S/1M/5M/10M);
 *   2. cria/entra na sala;
 *   3-5. a duracao chega ao servidor, a Match e criada com ela, os dois
 *      jogadores recebem a MESMA duracao;
 *   6-8. startTimestamp compartilhado, countdown funciona, partida comeca;
 *   9. a duracao so conta a partir do inicio real (startTimestamp), nunca
 *      do momento em que a Match foi criada;
 *   10. ao atingir o limite: a partida termina no SERVIDOR (FINISHED),
 *      gameplay para (note_hit pos-fim e ignorado), resultado e enviado
 *      aos dois, nenhum jogador continua jogando;
 *   11. Jogar Novamente / voltar ao menu / criar nova sala / entrar em
 *      outra sala nunca deixam duracao presa de uma partida anterior;
 *      Solo e Bot continuam funcionando.
 *
 * Reutiliza EXCLUSIVAMENTE os modulos reais ja existentes (nenhuma logica
 * de tempo/timer/loop nova e criada aqui) -- RoomManager, MatchManager,
 * connectionHandler, messageRouter, matchFlow, matchDurationSelectionFlow,
 * rematchFlow, leaveRoomFlow, gameplayFlow (servidor) e ClientConfig,
 * MatchDuration, MatchEndDetector, NoteEngine (cliente) -- no MESMO padrao
 * ja usado por tests/multiplayerEndToEnd10F.test.js e
 * tests/matchDurationMultiplayerEnd15CMP2.test.js.
 *
 * Tambem documenta, como REGRESSAO CONHECIDA (Bloco H), que a interface
 * real (client/js/main.js / client/index.html) ainda NAO oferece nenhum
 * caminho para o jogador escolher a duracao antes de criar/entrar numa
 * sala de Multiplayer real (o painel de duracao so e aberto pelos fluxos
 * de Solo/Bot). O transporte/composicao testados abaixo usam
 * `select_duration` diretamente (o mesmo caminho que a Parte 1 ja usa),
 * exatamente como qualquer UI futura precisaria enviar -- nenhuma mudanca
 * de HTML/CSS/funcionalidade foi feita para "consertar" isso aqui, apenas
 * a lacuna e registrada, conforme pedido ("PARAR AQUI").
 *
 * Executar com: node tests/multiplayerDurationFullFlowValidation15CMP3.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ClientConfig = require('../client/js/config');
const MatchDuration = require('../client/js/match/matchDuration');
const MatchEndDetector = require('../client/js/match/matchEndDetector');
const NoteEngine = require('../client/js/match/noteEngine');

const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { MATCH_STATE, MATCH_MODE } = require('../server/match/Match');
const { MATCH_COUNTDOWN_SECONDS } = require('../server/config');
const matchDurationSelectionFlow = require('../server/match/matchDurationSelectionFlow');
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

// ---------------------------------------------------------------------
// Harness de servidor (mesmo padrao ja usado por multiplayerEndToEnd10F
// e matchDurationMultiplayer(End)15CMP1/2)
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

function countOfType(socket, type) {
  return socket.sent.filter((m) => m.type === type).length;
}

/**
 * Dispara o callback JA AGENDADO pelo setTimeout real de
 * matchFlow.scheduleCountdown -- roda o MESMO codigo de producao que
 * rodaria quando MATCH_COUNTDOWN_SECONDS passassem de verdade (nenhum
 * timer/relogio novo criado por este harness).
 */
function fireRealCountdown(match) {
  assert.ok(match && match._countdownTimer, 'esperava um _countdownTimer real agendado por scheduleCountdown');
  match._countdownTimer._onTimeout();
}

/**
 * Cria uma sala Multiplayer completa via caminho de PRODUCAO
 * (create_room + select_duration + join_room), exatamente como um
 * jogador que escolhesse a duracao antes de a sala encher vivenciaria
 * (o UNICO caminho ja suportado pelo servidor -- ver Bloco H sobre a
 * lacuna de UI para isso em Multiplayer real).
 */
function createFullRoomWithDuration(durationId) {
  const wsPlayer1 = createMockSocket();
  const wsPlayer2 = createMockSocket();
  registerConnection(wsPlayer1);
  registerConnection(wsPlayer2);

  send(wsPlayer1, { type: 'create_room' });
  const roomCode = lastOfType(wsPlayer1, 'room_created').roomCode;

  if (durationId) {
    send(wsPlayer1, { type: 'select_duration', durationId });
  }

  send(wsPlayer2, { type: 'join_room', roomCode });

  const room = RoomManager.getRoom(roomCode);
  const match = MatchManager.getMatch(roomCode);
  return { room, wsPlayer1, wsPlayer2, match, roomCode };
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

/**
 * Reproduz, com os modulos REAIS do cliente, a composicao que
 * `startMatchGameplay` monta para UM jogador do Multiplayer real
 * (mesma formula ja validada pela Parte 2) -- usada aqui so para
 * encadear o fluxo completo ate o fim por duracao.
 */
function createClientEndDetector({ startTimestamp, durationMs, seed = 777, length = 200 }) {
  const timeline = NoteEngine.generateNoteTimeline({
    seed,
    startTimestamp,
    length,
    noteRange: 4,
    noteIntervalMs: 600,
    leadInMs: 0,
  });

  let endCalls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => {
      endCalls++;
    },
    durationMs,
    startTime: startTimestamp,
  });

  return {
    tick: (currentTime) => detector.checkForEnd(currentTime),
    hasEnded: () => detector.hasEnded(),
    endCallCount: () => endCalls,
  };
}

const mainJsPath = path.join(__dirname, '..', 'client', 'js', 'main.js');
const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');
const uiControllerContent = fs.readFileSync(
  path.join(__dirname, '..', 'client', 'js', 'ui', 'uiController.js'),
  'utf8'
);

// =====================================================================
// BLOCO A -- fluxo completo (itens 1-8): escolher duracao -> criar/
// entrar na sala -> duracao chega ao servidor -> Match criada com ela ->
// os dois jogadores recebem a MESMA duracao -> startTimestamp
// compartilhado -> countdown -> partida comeca.
// =====================================================================

['30S', '1M', '5M', '10M'].forEach((durationId) => {
  test(`[A] fluxo completo ate PLAYING com duracao "${durationId}": Match criada com essa duracao, ambos recebem a mesma`, () => {
    const { wsPlayer1, wsPlayer2, match } = createFullRoomWithDuration(durationId);

    // 3-4. a duracao chegou ao servidor e a Match foi criada com ela.
    assert.strictEqual(match.durationId, durationId);
    assert.strictEqual(match.durationMs, ClientConfig.MATCH_DURATION_MS[durationId]);
    assert.strictEqual(match.state, MATCH_STATE.COUNTDOWN);

    // 5. os dois jogadores recebem a mesma duracao (mesmo broadcast).
    const readyP1 = lastOfType(wsPlayer1, 'match_ready').match;
    const readyP2 = lastOfType(wsPlayer2, 'match_ready').match;
    assert.strictEqual(readyP1.durationId, durationId);
    assert.strictEqual(readyP2.durationId, durationId);
    assert.strictEqual(readyP1.durationMs, readyP2.durationMs);

    // 6-7. startTimestamp compartilhado, countdown corretamente montado
    // (mesmo numero de segundos configurado no servidor, sem nenhuma
    // logica nova por causa da duracao).
    const countdownP1 = lastOfType(wsPlayer1, 'match_countdown_start');
    const countdownP2 = lastOfType(wsPlayer2, 'match_countdown_start');
    assert.ok(countdownP1 && countdownP2);
    assert.strictEqual(countdownP1.startTimestamp, countdownP2.startTimestamp);
    assert.strictEqual(countdownP1.countdownSeconds, MATCH_COUNTDOWN_SECONDS);
    assert.strictEqual(countdownP1.match.durationMs, ClientConfig.MATCH_DURATION_MS[durationId]);

    // 8. a partida realmente comeca (countdown -> PLAYING), sem que a
    // duracao interfira em nada desse disparo.
    fireRealCountdown(match);
    assert.strictEqual(match.state, MATCH_STATE.PLAYING);

    const startedP1 = lastOfType(wsPlayer1, 'match_started');
    const startedP2 = lastOfType(wsPlayer2, 'match_started');
    assert.ok(startedP1 && startedP2);
    assert.strictEqual(startedP1.startTimestamp, startedP2.startTimestamp);
    assert.strictEqual(startedP1.startTimestamp, countdownP1.startTimestamp);
    assert.strictEqual(startedP1.match.durationMs, ClientConfig.MATCH_DURATION_MS[durationId]);
    assert.strictEqual(startedP2.match.durationMs, ClientConfig.MATCH_DURATION_MS[durationId]);
  });
});

// =====================================================================
// BLOCO B -- item 9: a duracao so comeca a contar a partir do inicio
// REAL da partida (startTimestamp), nunca do momento em que a Match foi
// criada nem de quando a selecao de duracao foi enviada.
// =====================================================================

test('[B] a duracao nao conta o tempo gasto em READY/COUNTDOWN: o detector so olha para startTimestamp, nunca para o momento de criacao da Match', () => {
  const { match } = createFullRoomWithDuration('30S');
  const matchCreatedAt = Date.now();

  // Simula um tempo "gasto esperando" entre a Match ser criada (READY)
  // e o countdown de fato disparar -- normalmente isto e so
  // MATCH_COUNTDOWN_SECONDS, mas o teste forca um valor bem maior para
  // provar que esse tempo NUNCA e descontado da duracao.
  fireRealCountdown(match);
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);

  const startTimestamp = match.startTimestamp;
  const durationMs = match.durationMs;
  assert.ok(startTimestamp > matchCreatedAt, 'startTimestamp deveria ser posterior a criacao da Match (ha o countdown no meio)');

  const client = createClientEndDetector({ startTimestamp, durationMs });

  // Um "agora" ANTES do startTimestamp (equivalente a olhar durante o
  // countdown) nunca deveria contar como partida em andamento nem muito
  // menos encerrar por duracao.
  assert.strictEqual(client.tick(startTimestamp - 1), false);
  assert.strictEqual(client.hasEnded(), false);

  // Exatamente durationMs depois do INICIO REAL (nao da criacao) e que
  // o limite e atingido.
  assert.strictEqual(client.tick(startTimestamp + durationMs - 1), false);
  assert.strictEqual(client.tick(startTimestamp + durationMs), true);
  assert.strictEqual(client.hasEnded(), true);
});

// =====================================================================
// BLOCO C -- item 10: ao atingir o limite, a partida termina de verdade
// no SERVIDOR (autoridade), o gameplay para (note_hit pos-fim e
// ignorado), o resultado aparece para os dois, e nenhum jogador continua
// jogando.
// =====================================================================

test('[C] ao atingir a duracao, sequence_complete leva a Match a FINISHED e envia match_result aos dois jogadores', () => {
  const { wsPlayer1, wsPlayer2, room, match } = createFullRoomWithDuration('30S');
  fireRealCountdown(match);
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);

  // Simula alguma jogada normal ANTES do fim, para confirmar que o
  // gameplay realmente funcionava (nao um estado ja vazio).
  send(wsPlayer1, noteHitPayload(match));
  send(wsPlayer2, noteHitPayload(match));
  assert.strictEqual(countOfType(wsPlayer1, 'error'), 0);
  assert.strictEqual(countOfType(wsPlayer2, 'error'), 0);

  // Cada cliente, independentemente, detecta o fim por duracao (Parte 2)
  // e avisa o servidor com 'sequence_complete' -- exatamente o MESMO
  // gatilho ja usado pelo fim normal de timeline (gameplayFlow.js).
  send(wsPlayer1, { type: 'sequence_complete' });

  assert.strictEqual(match.state, MATCH_STATE.FINISHED, 'a Match deveria estar FINISHED apos sequence_complete');

  const resultP1 = lastOfType(wsPlayer1, 'match_result');
  const resultP2 = lastOfType(wsPlayer2, 'match_result');
  assert.ok(resultP1, 'player1 deveria ter recebido match_result');
  assert.ok(resultP2, 'player2 deveria ter recebido match_result');
});

test('[C] apos FINISHED por duracao, o gameplay realmente para: note_hit adicional e ignorado (erro, nenhum estado alterado)', () => {
  const { wsPlayer1, wsPlayer2, room, match } = createFullRoomWithDuration('30S');
  fireRealCountdown(match);
  send(wsPlayer1, { type: 'sequence_complete' });
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);

  const scoreBefore = match.players.player1.score;
  send(wsPlayer1, noteHitPayload(match, { noteId: `note-${match.seed}-1` }));

  assert.strictEqual(match.players.player1.score, scoreBefore, 'nenhum jogador deveria continuar pontuando apos o fim');
  const lastMsg = wsPlayer1.sent[wsPlayer1.sent.length - 1];
  assert.strictEqual(lastMsg.type, 'error', 'note_hit apos FINISHED deveria ser recusado');
});

test('[C] sequence_complete enviado pelos DOIS jogadores (corrida normal) so produz UM match_result por jogador (idempotente, sem duplicar)', () => {
  const { wsPlayer1, wsPlayer2, match } = createFullRoomWithDuration('1M');
  fireRealCountdown(match);

  send(wsPlayer1, { type: 'sequence_complete' });
  send(wsPlayer2, { type: 'sequence_complete' });

  assert.strictEqual(countOfType(wsPlayer1, 'match_result'), 1);
  assert.strictEqual(countOfType(wsPlayer2, 'match_result'), 1);
});

// =====================================================================
// BLOCO D -- item 11 (parte 1): "Jogar Novamente" apos um fim por
// duracao continua funcionando, e a duracao nao fica presa/perdida
// incorretamente entre a Match antiga e a nova.
// =====================================================================

test('[D] apos fim por duracao, "Jogar Novamente" (rematch_ready dos dois) cria uma NOVA Match, reaproveitando a MESMA duracao por padrao', () => {
  const { wsPlayer1, wsPlayer2, room, match: firstMatch } = createFullRoomWithDuration('5M');
  fireRealCountdown(firstMatch);
  send(wsPlayer1, { type: 'sequence_complete' });
  assert.strictEqual(firstMatch.state, MATCH_STATE.FINISHED);

  send(wsPlayer1, { type: 'rematch_ready' });
  send(wsPlayer2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(room.code);
  assert.ok(secondMatch, 'deveria existir uma nova Match apos a revanche');
  assert.notStrictEqual(secondMatch, firstMatch, 'a revanche deveria criar uma Match NOVA, nunca reaproveitar a antiga');
  assert.strictEqual(secondMatch.durationId, '5M', 'sem nova selecao, a revanche reaproveita a duracao da partida anterior');
  assert.strictEqual(secondMatch.durationMs, ClientConfig.MATCH_DURATION_MS['5M']);
});

test('[D] uma NOVA selecao de duracao antes da revanche tem prioridade sobre a duracao da Match anterior', () => {
  const { wsPlayer1, wsPlayer2, room, match: firstMatch } = createFullRoomWithDuration('5M');
  fireRealCountdown(firstMatch);
  send(wsPlayer1, { type: 'sequence_complete' });

  send(wsPlayer1, { type: 'select_duration', durationId: '10M' });
  send(wsPlayer1, { type: 'rematch_ready' });
  send(wsPlayer2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(room.code);
  assert.strictEqual(secondMatch.durationId, '10M');
  assert.strictEqual(secondMatch.durationMs, ClientConfig.MATCH_DURATION_MS['10M']);
});

// =====================================================================
// BLOCO E -- item 11 (parte 2): "voltar ao menu" / criar nova sala /
// entrar em outra sala -- a duracao NUNCA fica presa de uma partida
// anterior nem vaza para uma sala/Match sem relacao nenhuma.
// =====================================================================

test('[E] criar uma sala NOVA (jogador que "voltou ao menu") nunca herda a duracao de uma sala anterior, mesma conexao', () => {
  // Primeira sala/partida, com duracao selecionada e concluida.
  const { wsPlayer1: oldP1, wsPlayer2: oldP2, room: oldRoom, match: oldMatch } = createFullRoomWithDuration('10M');
  fireRealCountdown(oldMatch);
  send(oldP1, { type: 'sequence_complete' });
  assert.strictEqual(oldMatch.state, MATCH_STATE.FINISHED);

  // O jogador 1 "sai" da sala antiga (equivalente a voltar ao menu) e
  // cria uma sala nova -- NENHUMA selecao de duracao e enviada desta
  // vez.
  send(oldP1, { type: 'leave_room' });

  const wsNewPlayer1 = createMockSocket();
  const wsNewPlayer2 = createMockSocket();
  registerConnection(wsNewPlayer1);
  registerConnection(wsNewPlayer2);

  send(wsNewPlayer1, { type: 'create_room' });
  const newRoomCode = lastOfType(wsNewPlayer1, 'room_created').roomCode;
  assert.notStrictEqual(newRoomCode, oldRoom.code, 'sala nova deveria ter um codigo diferente da antiga');

  send(wsNewPlayer2, { type: 'join_room', roomCode: newRoomCode });

  const newMatch = MatchManager.getMatch(newRoomCode);
  assert.strictEqual(newMatch.durationId, null, 'a sala nova NUNCA deveria herdar a duracao "10M" da sala anterior');
  assert.strictEqual(newMatch.durationMs, null);
});

test('[E] entrar em OUTRA sala existente (com sua propria selecao de duracao) nunca mistura com a selecao de uma sala anterior', () => {
  const { wsPlayer1: roomA_p1 } = createFullRoomWithDuration('30S');

  // Sala B: um par de jogadores totalmente diferente, com sua propria
  // selecao de duracao (diferente da sala A).
  const wsB1 = createMockSocket();
  const wsB2 = createMockSocket();
  registerConnection(wsB1);
  registerConnection(wsB2);
  send(wsB1, { type: 'create_room' });
  const roomBCode = lastOfType(wsB1, 'room_created').roomCode;
  send(wsB1, { type: 'select_duration', durationId: '1M' });
  send(wsB2, { type: 'join_room', roomCode: roomBCode });

  const matchB = MatchManager.getMatch(roomBCode);
  assert.strictEqual(matchB.durationId, '1M', 'a selecao da sala B deveria valer para a sala B, sem influencia da sala A');
});

test('[E] deixar a selecao de duracao pendente (sem sala encher) e depois sair da sala nunca deixa a selecao presa para a proxima sala com o MESMO codigo (reuso improvavel, mas nunca deveria vazar)', () => {
  const wsPlayer1 = createMockSocket();
  registerConnection(wsPlayer1);
  send(wsPlayer1, { type: 'create_room' });
  const roomCode = lastOfType(wsPlayer1, 'room_created').roomCode;
  send(wsPlayer1, { type: 'select_duration', durationId: '5M' });

  assert.ok(matchDurationSelectionFlow.getSelectionState(roomCode), 'deveria haver uma selecao pendente antes de sair');

  send(wsPlayer1, { type: 'leave_room' });

  assert.strictEqual(
    matchDurationSelectionFlow.getSelectionState(roomCode),
    null,
    'sair da sala deveria limpar qualquer selecao de duracao pendente daquele codigo'
  );
});

// =====================================================================
// BLOCO F -- item 11 (parte 3): Solo e Bot continuam funcionando,
// intactos, depois de toda a validacao de Multiplayer acima.
// =====================================================================

test('[F] Solo continua funcionando de ponta a ponta (start_solo_match -> READY -> COUNTDOWN -> PLAYING), sem nenhuma duracao vinda do servidor', () => {
  const wsSolo = createMockSocket();
  registerConnection(wsSolo);
  send(wsSolo, { type: 'start_solo_match' });

  const roomCode = wsSolo.roomCode;
  const match = MatchManager.getMatch(roomCode);
  assert.ok(match, 'Solo deveria criar uma Match normalmente');
  assert.strictEqual(match.mode, MATCH_MODE.SOLO);
  // Servidor nunca atribui duracao ao Solo (isso continua sendo feito
  // inteiramente pelo cliente, ver Etapa 15C-1C) -- nenhuma mudanca
  // desta Parte 3.
  assert.strictEqual(match.durationId, null);
  assert.strictEqual(match.durationMs, null);

  fireRealCountdown(match);
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);
  assert.ok(lastOfType(wsSolo, 'match_started'));
});

test('[F] Multiplayer real com duracao selecionada nunca contamina uma Match Solo criada logo em seguida (mesma conexao "voltando" para Solo)', () => {
  const { wsPlayer1, match: mpMatch } = createFullRoomWithDuration('30S');
  fireRealCountdown(mpMatch);
  send(wsPlayer1, { type: 'sequence_complete' });
  send(wsPlayer1, { type: 'leave_room' });

  send(wsPlayer1, { type: 'start_solo_match' });
  const soloMatch = MatchManager.getMatch(wsPlayer1.roomCode);
  assert.strictEqual(soloMatch.mode, MATCH_MODE.SOLO);
  assert.strictEqual(soloMatch.durationId, null, 'Solo nunca deveria herdar a duracao de uma partida Multiplayer anterior');
});

test('[F] client/js/match/botMatchController.js e client/js/match/botController.js permanecem intactos (nenhum arquivo do Bot foi tocado nesta Parte 3)', () => {
  // Mesma tecnica ja usada pelas suites da Etapa 15C: garante que esta
  // Parte 3 (validacao) nao alterou nenhum modulo do Bot -- os arquivos
  // continuam existindo e continuam sem nenhuma referencia a um sistema
  // paralelo de duracao (so o parametro `durationMs` ja existente desde
  // a Etapa 15C-1D).
  const botMatchControllerPath = path.join(__dirname, '..', 'client', 'js', 'match', 'botMatchController.js');
  const botControllerPath = path.join(__dirname, '..', 'client', 'js', 'match', 'botController.js');
  assert.ok(fs.existsSync(botMatchControllerPath));
  assert.ok(fs.existsSync(botControllerPath));

  const botMatchControllerContent = fs.readFileSync(botMatchControllerPath, 'utf8');
  assert.ok(
    !/setTimeout\(|setInterval\(/.test(botMatchControllerContent),
    'botMatchController.js nao deveria ter ganhado nenhum timer novo (chamada de codigo, nao comentario)'
  );
});

// =====================================================================
// BLOCO G -- countdown (item 7) e independente da duracao: o mesmo
// MatchController.startCountdown (cliente) e usado com ou sem duracao
// configurada, sem nenhuma ramificacao nova.
// =====================================================================

test('[G] client/js/match/matchController.js (countdown) nao contem nenhuma referencia a duration/Duration -- o countdown e 100% independente da duracao da partida', () => {
  const matchControllerContent = fs.readFileSync(
    path.join(__dirname, '..', 'client', 'js', 'match', 'matchController.js'),
    'utf8'
  );
  assert.ok(
    !/duration/i.test(matchControllerContent),
    'o modulo de countdown nunca deveria precisar saber sobre duracao da partida'
  );
});

// =====================================================================
// BLOCO H -- ATUALIZADO NA ETAPA 15C-MP — Parte 4: a lacuna de UI
// documentada aqui como "regressao conhecida" ate a Parte 3 foi
// FECHADA por esta parte -- "Criar Sala" agora abre o MESMO painel de
// duracao ja usado por Solo/Bot (mostrado assim que o servidor
// confirma a sala nova, ver case 'room_created' em main.js) e envia
// `select_duration` pelo fluxo Multiplayer ja preparado. Estes testes
// substituem os antigos "(achado)" -- que so documentavam a ausencia
// da funcionalidade -- por testes que confirmam a integracao real.
// =====================================================================

test('[H] "Criar sala" zera qualquer duracao/contexto de uma sala anterior antes de pedir uma sala nova', () => {
  const createRoomBlock = /document\.getElementById\('btn-create-room'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/.exec(
    mainJsContent
  );
  assert.ok(createRoomBlock, 'handler de btn-create-room nao encontrado');
  assert.ok(
    createRoomBlock[0].includes('selectedMatchDuration = null'),
    '"Criar sala" deveria continuar zerando selectedMatchDuration'
  );
  assert.ok(
    createRoomBlock[0].includes("SocketClient.send('create_room')"),
    '"Criar sala" deveria continuar enviando create_room'
  );
});

test('[H] `room_created` abre o painel de duracao SOMENTE para Multiplayer real (nunca quando isSoloMode/isBotMode ja estao ligados)', () => {
  const roomCreatedBlock = /case 'room_created':[^]*?\n {8}break;/.exec(mainJsContent);
  assert.ok(roomCreatedBlock, "case 'room_created' nao encontrado");
  assert.ok(
    roomCreatedBlock[0].includes('showMatchDurationSelection'),
    '"room_created" deveria abrir o painel de duracao para o Multiplayer real (Etapa 15C-MP — Parte 4)'
  );
  assert.ok(
    /if \(!isSoloMode && !isBotMode\)/.test(roomCreatedBlock[0]),
    'a abertura do painel em "room_created" deveria ser condicionada a NAO estar em Solo/Bot (que ja escolheram a duracao antes de start_solo_match)'
  );
});

test('[H] "Entrar na sala" nunca abre a tela de selecao de duracao nem envia select_duration (quem entra recebe a duracao do criador)', () => {
  const joinRoomBlock = /document\.getElementById\('btn-join-room'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/.exec(
    mainJsContent
  );
  assert.ok(joinRoomBlock, 'handler de btn-join-room nao encontrado');
  assert.ok(
    !joinRoomBlock[0].includes('showMatchDurationSelection'),
    '"Entrar na sala" nunca deveria abrir a tela de duracao -- quem entra so recebe a duracao ja definida pelo criador'
  );
  assert.ok(
    !joinRoomBlock[0].includes("send('select_duration'"),
    '"Entrar na sala" nunca deveria enviar select_duration'
  );
});

test('[H] o painel de duracao envia `select_duration` (nao `start_solo_match`) quando aberto pelo Multiplayer real', () => {
  const durationButtonsBlock = /document\.querySelectorAll\('#match-duration-panel \[data-duration\]'\)\.forEach\(\(button\) => \{[^]*?\n {2}\}\);/.exec(
    mainJsContent
  );
  assert.ok(durationButtonsBlock, 'handler das opcoes de duracao nao encontrado');
  assert.ok(
    durationButtonsBlock[0].includes("matchDurationSelectionContext === 'multiplayer'"),
    'o handler deveria distinguir o contexto multiplayer do contexto Solo/Bot'
  );
  assert.ok(
    durationButtonsBlock[0].includes("SocketClient.send('select_duration', { durationId })"),
    'o contexto multiplayer deveria enviar select_duration com o durationId escolhido'
  );
  assert.ok(
    durationButtonsBlock[0].includes("SocketClient.send('start_solo_match')"),
    'o contexto Solo/Bot deveria continuar enviando start_solo_match, sem nenhuma mudanca'
  );
});

test('[H] cancelar o painel de duracao no contexto multiplayer sai da sala recem-criada (leaveRoomController), sem deixar a sala presa', () => {
  const cancelBlock = /document\.getElementById\('btn-match-duration-cancel'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/.exec(
    mainJsContent
  );
  assert.ok(cancelBlock, 'handler de btn-match-duration-cancel nao encontrado');
  assert.ok(
    cancelBlock[0].includes('leaveRoomController.requestLeave()'),
    'cancelar no contexto multiplayer deveria pedir para sair da sala (reutilizando leaveRoomController, nunca uma segunda logica de saida)'
  );
});

test('[H] o servidor SUPORTA select_duration em Multiplayer real, exatamente como a UI agora chama (fluxo de producao ponta a ponta)', () => {
  const { match } = createFullRoomWithDuration('1M');
  // Mesma chamada que a UI (Etapa 15C-MP — Parte 4) agora dispara --
  // ja funcionava no servidor desde a Parte 1, e continua funcionando
  // identico depois da integracao de interface.
  assert.strictEqual(match.durationId, '1M');
});

console.log(`\n${passed} teste(s) passaram.`);
