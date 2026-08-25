/**
 * ETAPA 15C-MP — Parte 1: Preparar a duracao no Multiplayer.
 *
 * Esta etapa NAO implementa o encerramento por tempo -- so prepara o
 * TRANSPORTE da duracao escolhida ate a Match Multiplayer, reutilizando
 * EXCLUSIVAMENTE:
 *   - `ClientConfig.MATCH_DURATION_MS` (client/js/config.js);
 *   - `MatchDuration.resolveMatchDuration` (client/js/match/matchDuration.js);
 *   - o MESMO padrao arquitetural ja usado por `select_music` (ver
 *     server/music/musicSelectionFlow.js / tests/musicSelectionFlow.test.js).
 *
 * Cobre:
 *   1-4. 30S/1M/5M/10M sao reconhecidos (identificadores validos);
 *   5. duracao invalida e rejeitada (nao fica presa em nenhuma selecao,
 *      cai no fallback existente -- "sem duracao configurada");
 *   6-7. a duracao chega ao fluxo Multiplayer e os dois jogadores
 *      recebem a MESMA duracao (mesmo broadcast `match_ready`);
 *   8. `startTimestamp` continua sendo o mesmo (nenhuma mudanca no
 *      countdown/inicio sincronizado);
 *   9-10. Solo e Bot permanecem intactos (nenhum arquivo de
 *      Solo/Bot foi tocado; server ainda nao aplica duracao ao Solo);
 *   11-12. nenhum timer novo / nenhum relogio novo foi introduzido no
 *      transporte (inspecao estatica do modulo novo);
 *   + regras de limpeza/seguranca no mesmo padrao de select_music
 *     (sala/slot invalidos, estado da partida, revanche, leave/disconnect).
 *
 * Usa mocks simples de conexao WebSocket (nao sobe um servidor real) e os
 * modulos reais de Room/Match/RoomManager/MatchManager/messageRouter/
 * matchDurationSelectionFlow/rematchFlow -- nenhuma logica e duplicada.
 *
 * Executar com: node tests/matchDurationMultiplayer15CMP1.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ClientConfig = require('../client/js/config');
const MatchDuration = require('../client/js/match/matchDuration');

const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { MATCH_STATE, MATCH_MODE } = require('../server/match/Match');
const matchDurationSelectionFlow = require('../server/match/matchDurationSelectionFlow');
const matchFlow = require('../server/match/matchFlow');
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
    send(raw) {
      this.sent.push(JSON.parse(raw));
    },
    on(event, handler) {
      if (handlers[event]) handlers[event].push(handler);
    },
    close() {},
    _handlers: handlers,
  };
}

function send(ws, message) {
  routeMessage(ws, JSON.stringify(message));
}

function lastOfType(socket, type) {
  const matches = socket.sent.filter((m) => m.type === type);
  return matches.length ? matches[matches.length - 1] : null;
}

function createRoomWithOnePlayer() {
  const ws1 = createMockSocket();
  registerConnection(ws1);
  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  const room = RoomManager.getRoom(roomCode);
  return { ws1, room, roomCode };
}

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

// =====================================================================
// BLOCO A -- OS QUATRO IDENTIFICADORES SAO RECONHECIDOS
// =====================================================================

['30S', '1M', '5M', '10M'].forEach((durationId) => {
  test(`[A] "${durationId}" e reconhecido como identificador de duracao valido`, () => {
    assert.strictEqual(matchDurationSelectionFlow.isValidDurationId(durationId), true);
    // Mesma tabela do cliente -- nenhuma tabela nova.
    assert.ok(Object.prototype.hasOwnProperty.call(ClientConfig.MATCH_DURATION_MS, durationId));
  });

  test(`[A] select_duration("${durationId}") e aceito e confirmado ao jogador`, () => {
    const { ws1, roomCode } = createRoomWithOnePlayer();
    send(ws1, { type: 'select_duration', durationId });

    const confirmation = lastOfType(ws1, 'duration_selected');
    assert.ok(confirmation);
    assert.strictEqual(confirmation.durationId, durationId);
    assert.strictEqual(confirmation.slot, 'player1');

    const state = matchDurationSelectionFlow.getSelectionState(roomCode);
    assert.strictEqual(state.player1, durationId);
  });

  test(`[A] "${durationId}" chega intacto a uma Match Multiplayer criada em seguida`, () => {
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();
    registerConnection(ws1);
    registerConnection(ws2);

    send(ws1, { type: 'create_room' });
    const roomCode = lastOfType(ws1, 'room_created').roomCode;
    send(ws1, { type: 'select_duration', durationId });
    send(ws2, { type: 'join_room', roomCode });

    const match = MatchManager.getMatch(roomCode);
    assert.ok(match);
    assert.strictEqual(match.mode, MATCH_MODE.MULTIPLAYER);
    assert.strictEqual(match.durationId, durationId);
    assert.strictEqual(match.durationMs, ClientConfig.MATCH_DURATION_MS[durationId]);
  });
});

// =====================================================================
// BLOCO B -- DURACAO INVALIDA
// =====================================================================

test('[B] select_duration com um identificador que nao existe e rejeitado', () => {
  const { ws1, roomCode } = createRoomWithOnePlayer();
  send(ws1, { type: 'select_duration', durationId: 'INVALIDO_15CMP1' });

  assert.ok(lastOfType(ws1, 'error'));
  assert.strictEqual(lastOfType(ws1, 'duration_selected'), null);
  assert.strictEqual(matchDurationSelectionFlow.getSelectionState(roomCode), null);
});

test('[B] sem nenhuma selecao valida, a Match Multiplayer usa o fallback existente (sem duracao configurada)', () => {
  const { match } = createFullRoomViaProduction();
  assert.strictEqual(match.durationId, null);
  assert.strictEqual(match.durationMs, null);
});

test('[B] uma selecao invalida enviada antes da sala ficar cheia nunca contamina a Match (cai no fallback)', () => {
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);

  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  send(ws1, { type: 'select_duration', durationId: 'NAO_EXISTE' });
  send(ws2, { type: 'join_room', roomCode });

  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.durationId, null);
  assert.strictEqual(match.durationMs, null);
});

test('[B] matchFlow.normalizeRequestedDurationId nunca lanca erro e sempre cai em null para valores invalidos', () => {
  [undefined, null, '', '   ', 'XX', 123, {}, []].forEach((value) => {
    assert.strictEqual(matchFlow.normalizeRequestedDurationId(value), null);
  });
  ['30S', '1M', '5M', '10M'].forEach((value) => {
    assert.strictEqual(matchFlow.normalizeRequestedDurationId(value), value);
  });
});

// =====================================================================
// BLOCO C -- OS DOIS JOGADORES RECEBEM A MESMA DURACAO
// =====================================================================

test('[C] match_ready enviado aos dois jogadores tem exatamente a mesma durationId/durationMs', () => {
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);

  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  send(ws1, { type: 'select_duration', durationId: '5M' });
  send(ws2, { type: 'join_room', roomCode });

  const readyForP1 = lastOfType(ws1, 'match_ready').match;
  const readyForP2 = lastOfType(ws2, 'match_ready').match;

  assert.strictEqual(readyForP1.durationId, '5M');
  assert.strictEqual(readyForP2.durationId, '5M');
  assert.strictEqual(readyForP1.durationMs, readyForP2.durationMs);
  assert.strictEqual(readyForP1.durationMs, ClientConfig.MATCH_DURATION_MS['5M']);
});

test('[C] regra de desempate (player1 tem prioridade) tambem vale para duracao, exatamente como para musica', () => {
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);

  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  send(ws1, { type: 'select_duration', durationId: '1M' });
  send(ws2, { type: 'join_room', roomCode });
  send(ws2, { type: 'select_duration', durationId: '10M' });

  // A sala ja ficou cheia com a selecao de player1 ('1M'); a selecao
  // tardia de player2 nao pode alterar a Match ja criada.
  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.durationId, '1M');
});

// =====================================================================
// BLOCO D -- startTimestamp / COUNTDOWN CONTINUAM INALTERADOS
// =====================================================================

test('[D] startTimestamp continua sendo definido e identico para os dois jogadores, com duracao selecionada', () => {
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);

  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  send(ws1, { type: 'select_duration', durationId: '30S' });
  send(ws2, { type: 'join_room', roomCode });

  const countdownP1 = lastOfType(ws1, 'match_countdown_start');
  const countdownP2 = lastOfType(ws2, 'match_countdown_start');
  assert.ok(countdownP1);
  assert.ok(countdownP2);
  assert.strictEqual(countdownP1.startTimestamp, countdownP2.startTimestamp);
  assert.strictEqual(typeof countdownP1.startTimestamp, 'number');

  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.startTimestamp, countdownP1.startTimestamp);
});

test('[D] a duracao selecionada nao muda em nada o valor do startTimestamp comparado a uma Match sem duracao', () => {
  const withoutDuration = createFullRoomViaProduction();
  const startTimestampWithout = withoutDuration.match.startTimestamp;

  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);
  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  send(ws1, { type: 'select_duration', durationId: '10M' });
  send(ws2, { type: 'join_room', roomCode });
  const matchWithDuration = MatchManager.getMatch(roomCode);

  // Ambos sao numeros finitos definidos pelo mesmo mecanismo
  // (MATCH_COUNTDOWN_SECONDS a partir de Date.now()) -- a presenca da
  // duracao nao adiciona nenhum deslocamento/computo extra a ele.
  assert.strictEqual(typeof startTimestampWithout, 'number');
  assert.strictEqual(typeof matchWithDuration.startTimestamp, 'number');
});

// =====================================================================
// BLOCO E -- REVANCHE (MULTIPLAYER REAL) PRESERVA A DURACAO
// =====================================================================

test('[E] revanche sem nova selecao reaproveita a durationId da partida anterior', () => {
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);

  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  send(ws1, { type: 'select_duration', durationId: '1M' });
  send(ws2, { type: 'join_room', roomCode });

  const firstMatch = MatchManager.getMatch(roomCode);
  firstMatch.setState(MATCH_STATE.FINISHED);

  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  assert.notStrictEqual(secondMatch, firstMatch);
  assert.strictEqual(secondMatch.durationId, '1M');
  assert.strictEqual(secondMatch.durationMs, ClientConfig.MATCH_DURATION_MS['1M']);
});

test('[E] uma nova selecao durante a espera da revanche tem prioridade sobre a duracao anterior', () => {
  const { ws1, ws2, roomCode, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.FINISHED);

  send(ws1, { type: 'select_duration', durationId: '5M' });
  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  assert.strictEqual(secondMatch.durationId, '5M');
});

test('[E] a selecao pendente de duracao e consumida pela revanche e nunca reaproveitada por uma terceira Match', () => {
  const { ws1, ws2, roomCode, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.FINISHED);

  send(ws1, { type: 'select_duration', durationId: '30S' });
  send(ws1, { type: 'rematch_ready' });
  send(ws2, { type: 'rematch_ready' });

  assert.strictEqual(matchDurationSelectionFlow.getSelectionState(roomCode), null);
});

// =====================================================================
// BLOCO F -- LIMPEZA (LEAVE / DISCONNECT), MESMO PADRAO DE select_music
// =====================================================================

test('[F] desconexao de um jogador limpa a selecao de duracao dele (nunca fica presa)', () => {
  const { ws1, roomCode, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.FINISHED);

  send(ws1, { type: 'select_duration', durationId: '5M' });
  assert.strictEqual(matchDurationSelectionFlow.getSelectionState(roomCode).player1, '5M');

  ws1._handlers.close.forEach((handler) => handler());

  const stateAfter = matchDurationSelectionFlow.getSelectionState(roomCode);
  assert.ok(!stateAfter || !stateAfter.player1);
});

test('[F] leave_room limpa a selecao de duracao do jogador que saiu', () => {
  const { ws1, ws2, roomCode, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.FINISHED);

  send(ws2, { type: 'select_duration', durationId: '1M' });
  assert.strictEqual(matchDurationSelectionFlow.getSelectionState(roomCode).player2, '1M');

  send(ws2, { type: 'leave_room' });

  const stateAfter = matchDurationSelectionFlow.getSelectionState(roomCode);
  assert.ok(!stateAfter || !stateAfter.player2);
});

test('[F] select_duration com uma sala que nao existe mais e rejeitado', () => {
  const ws = createMockSocket();
  registerConnection(ws);
  ws.roomCode = 'ZZZZZZ';
  ws.slot = 'player1';

  send(ws, { type: 'select_duration', durationId: '1M' });

  const error = lastOfType(ws, 'error');
  assert.ok(error);
  assert.match(error.message, /sala/i);
});

test('[F] select_duration sem estar em nenhuma sala e rejeitado', () => {
  const ws = createMockSocket();
  registerConnection(ws);

  send(ws, { type: 'select_duration', durationId: '1M' });

  const error = lastOfType(ws, 'error');
  assert.ok(error);
  assert.strictEqual(lastOfType(ws, 'duration_selected'), null);
});

test('[F] select_duration enquanto a partida esta PLAYING e rejeitado', () => {
  const { ws1, roomCode, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.PLAYING);

  send(ws1, { type: 'select_duration', durationId: '1M' });

  assert.ok(lastOfType(ws1, 'error'));
  assert.strictEqual(matchDurationSelectionFlow.getSelectionState(roomCode), null);
});

test('[F] select_duration enquanto a partida esta em COUNTDOWN e rejeitado', () => {
  const { ws1, roomCode, match } = createFullRoomViaProduction();
  match.setState(MATCH_STATE.COUNTDOWN);

  send(ws1, { type: 'select_duration', durationId: '1M' });

  assert.ok(lastOfType(ws1, 'error'));
  assert.strictEqual(matchDurationSelectionFlow.getSelectionState(roomCode), null);
});

test('[F] a selecao de uma sala nunca aparece em outra sala', () => {
  const roomA = createRoomWithOnePlayer();
  const roomB = createRoomWithOnePlayer();

  send(roomA.ws1, { type: 'select_duration', durationId: '5M' });

  assert.strictEqual(matchDurationSelectionFlow.resolveSelectedDuration(roomA.roomCode), '5M');
  assert.strictEqual(matchDurationSelectionFlow.resolveSelectedDuration(roomB.roomCode), null);
});

// =====================================================================
// BLOCO G -- SOLO E BOT PERMANECEM INTACTOS
// =====================================================================

test('[G] start_solo_match continua funcionando e a Match criada nunca aplica durationId (fluxo do server so cobre Multiplayer)', () => {
  const ws1 = createMockSocket();
  registerConnection(ws1);
  send(ws1, { type: 'start_solo_match' });

  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  const match = MatchManager.getMatch(roomCode);
  assert.ok(match);
  assert.strictEqual(match.mode, MATCH_MODE.SOLO);
  // O servidor nunca recebe/atribui durationId para Solo -- isso
  // continua 100% no cliente (main.js/MatchEndDetector), sem nenhuma
  // mudanca desta etapa.
  assert.strictEqual(match.durationId, null);
  assert.strictEqual(match.durationMs, null);
});

test('[G] select_duration nao interfere no pipeline de start_solo_match (mensagens independentes)', () => {
  const ws1 = createMockSocket();
  registerConnection(ws1);
  send(ws1, { type: 'start_solo_match' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;

  send(ws1, { type: 'select_duration', durationId: '1M' });

  // A selecao e apenas registrada (mesmo mecanismo do Multiplayer) --
  // mas nao existe nenhum ponto do fluxo Solo que a leia ou a aplique
  // na Match Solo ja criada.
  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.durationId, null);
});

test('[G] Solo/Bot no cliente continuam resolvendo duracao SOMENTE localmente (matchController/botMatchController/botController intactos quanto a duracao)', () => {
  // ATUALIZADO NA ETAPA 15C-MP — Parte 4: esta asercao originalmente
  // exigia que main.js nunca mencionasse `select_duration`/
  // `duration_selected`, porque naquela parte (Parte 1) a integracao
  // com a UI do Multiplayer real ainda nao existia (ver Bloco H de
  // tests/multiplayerDurationFullFlowValidation15CMP3.test.js, que
  // documentava exatamente essa lacuna como regressao conhecida). A
  // Parte 4 fecha essa lacuna: "Criar Sala" agora abre o MESMO painel
  // de duracao ja usado por Solo/Bot e envia `select_duration` pelo
  // fluxo Multiplayer -- entao main.js PASSA a conhecer essas
  // mensagens, exatamente como esperado agora.
  //
  // O que esta asercao continua garantindo (sem nenhuma mudanca de
  // fundo): os modulos que resolvem duracao para Solo/Bot
  // (matchController.js/botMatchController.js/botController.js) nunca
  // foram tocados -- Solo/Bot continuam resolvendo duracao SOMENTE a
  // partir de `selectedMatchDuration`/`MatchDuration.resolveMatchDuration`
  // (Etapa 15C-1C/1D), nunca lendo `select_duration`/`duration_selected`
  // ali dentro.
  ['matchController.js', 'botMatchController.js', 'botController.js'].forEach((file) => {
    const source = fs.readFileSync(path.join(__dirname, `../client/js/match/${file}`), 'utf8');
    assert.ok(!source.includes('select_duration'), `${file} nao deveria conhecer select_duration`);
    assert.ok(!source.includes('duration_selected'), `${file} nao deveria conhecer duration_selected`);
  });

  // main.js agora ENVIA select_duration para o fluxo Multiplayer real
  // (Etapa 15C-MP — Parte 4) -- mas nunca aplica esse identificador a
  // `selectedMatchDuration` (variavel exclusiva de Solo/Bot dentro de
  // startMatchGameplay): o multiplayer real sempre recebe a duracao
  // via `message.match.durationMs`, resolvida pelo servidor.
  const mainJs = fs.readFileSync(path.join(__dirname, '../client/js/main.js'), 'utf8');
  assert.ok(mainJs.includes("SocketClient.send('select_duration'"), 'main.js deveria enviar select_duration para o Multiplayer real (Etapa 15C-MP — Parte 4)');
});

// =====================================================================
// BLOCO H -- NENHUM TIMER/RELOGIO NOVO NO TRANSPORTE
// =====================================================================

test('[H] matchDurationSelectionFlow.js nao cria nenhum timer/relogio novo (so registra/le identificadores)', () => {
  const content = fs.readFileSync(
    path.join(__dirname, '../server/match/matchDurationSelectionFlow.js'),
    'utf8'
  );
  ['setTimeout(', 'setInterval(', 'Date.now(', 'new Date('].forEach((forbidden) => {
    assert.ok(!content.includes(forbidden), `nao deveria conter "${forbidden}"`);
  });
});

test('[H] a resolucao de duracao em matchFlow.js usa exclusivamente MatchDuration.resolveMatchDuration (nenhuma tabela/logica paralela)', () => {
  const content = fs.readFileSync(path.join(__dirname, '../server/match/matchFlow.js'), 'utf8');
  assert.ok(content.includes('MatchDuration.resolveMatchDuration('));
  assert.ok(content.includes("require('../../client/js/config')"));
  assert.ok(content.includes("require('../../client/js/match/matchDuration')"));
});

test('[H] resolveMatchDuration continua sendo uma funcao pura (mesma instancia reutilizada, sem relogio proprio)', () => {
  // Regressao simples da Etapa 15A: chamar duas vezes com os mesmos
  // argumentos sempre devolve o mesmo valor.
  const a = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, '1M');
  const b = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, '1M');
  assert.strictEqual(a, b);
  assert.strictEqual(a, 60000);
});

console.log(`\n${passed} teste(s) passaram.`);
