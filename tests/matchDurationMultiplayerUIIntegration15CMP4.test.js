/**
 * ETAPA 15C-MP — Parte 4: Integrar a selecao de duracao no fluxo REAL do
 * Multiplayer (interface do cliente).
 *
 * As Partes 1-3 ja validaram, isoladamente:
 *   - Parte 1: transporte de `select_duration` ate a Match Multiplayer
 *     (server/match/matchDurationSelectionFlow.js + matchFlow.js);
 *   - Parte 2: composicao client-side que efetivamente encerra a
 *     partida no limite (MatchEndDetector + durationMs + startTimestamp);
 *   - Parte 3: o fluxo ponta a ponta funciona no SERVIDOR mesmo sem
 *     nenhuma UI cliente chamando `select_duration` -- e documentou,
 *     como regressao conhecida (Bloco H daquele arquivo), que
 *     client/js/main.js nunca abria o painel de duracao nem enviava
 *     `select_duration` para o Multiplayer real ("Criar Sala").
 *
 * Esta Parte 4 fecha exatamente essa lacuna, e SOMENTE ela:
 *   - "Criar Sala" continua criando a sala normalmente;
 *   - assim que o servidor confirma a sala (`room_created`), o MESMO
 *     painel "Escolha a duração da partida" ja usado por Solo/Bot
 *     (`UIController.showMatchDurationSelection`/
 *     `hideMatchDurationSelection`) e reutilizado, sem nenhuma tela
 *     nova;
 *   - escolher uma das quatro opcoes envia `select_duration` pelo
 *     fluxo Multiplayer ja preparado (Etapa 15C-MP — Parte 1), em vez
 *     de `start_solo_match` (usado por Solo/Bot);
 *   - quem ENTRA em uma sala nunca escolhe a duracao -- so recebe a
 *     que o criador escolheu, via `match_ready`/`match.durationMs`
 *     (ja implementado desde a Parte 2, sem nenhuma mudanca aqui);
 *   - nenhum sistema de duracao/timer/relogio novo foi criado; nenhum
 *     arquivo de Solo/Bot/servidor foi tocado (ver Blocos F/G/H).
 *
 * Combina os DOIS estilos de verificacao ja usados pelo resto da
 * Etapa 15: (a) analise ESTATICA de client/js/main.js (o mesmo
 * mecanismo do Bloco H de multiplayerDurationFullFlowValidation15CMP3.test.js),
 * para confirmar QUE a interface esta ligada da forma certa; e
 * (b) o mesmo harness de servidor com mocks de WebSocket ja usado por
 * matchDurationMultiplayer15CMP1.test.js/multiplayerDurationFullFlowValidation15CMP3.test.js,
 * para confirmar que a mensagem que essa interface agora envia
 * (`select_duration`) realmente produz o efeito esperado ponta a
 * ponta nos modulos reais do servidor.
 *
 * Executar com: node tests/matchDurationMultiplayerUIIntegration15CMP4.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ClientConfig = require('../client/js/config');

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
// Harness de servidor (mesmo padrao ja usado pelo resto da Etapa 15)
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

/**
 * Reproduz, com os modulos REAIS do servidor, EXATAMENTE a sequencia de
 * mensagens que a interface (Etapa 15C-MP — Parte 4) agora dispara para
 * um jogador que clica "Criar Sala" e escolhe uma duracao antes do
 * oponente entrar: create_room -> select_duration -> join_room.
 */
function createRoomAndChooseDuration(durationId) {
  const wsCreator = createMockSocket();
  const wsOpponent = createMockSocket();
  registerConnection(wsCreator);
  registerConnection(wsOpponent);

  send(wsCreator, { type: 'create_room' });
  const roomCode = lastOfType(wsCreator, 'room_created').roomCode;

  if (durationId) {
    send(wsCreator, { type: 'select_duration', durationId });
  }

  send(wsOpponent, { type: 'join_room', roomCode });

  const room = RoomManager.getRoom(roomCode);
  const match = MatchManager.getMatch(roomCode);
  return { room, wsCreator, wsOpponent, match, roomCode };
}

const mainJsPath = path.join(__dirname, '..', 'client', 'js', 'main.js');
const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');

function extractBlock(regex) {
  const match = regex.exec(mainJsContent);
  assert.ok(match, `bloco nao encontrado em main.js para ${regex}`);
  return match[0];
}

const createRoomBlock = extractBlock(
  /document\.getElementById\('btn-create-room'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/
);
const joinRoomBlock = extractBlock(
  /document\.getElementById\('btn-join-room'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/
);
const roomCreatedCaseBlock = extractBlock(/case 'room_created':[^]*?\n {8}break;/);
const roomJoinedCaseBlock = extractBlock(/case 'room_joined':[^]*?\n {8}break;/);
const durationButtonsBlock = extractBlock(
  /document\.querySelectorAll\('#match-duration-panel \[data-duration\]'\)\.forEach\(\(button\) => \{[^]*?\n {2}\}\);/
);
const durationCancelBlock = extractBlock(
  /document\.getElementById\('btn-match-duration-cancel'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/
);
const handleLeftRoomBlock = extractBlock(/function handleLeftRoom\(\) \{[^]*?\n {2}\}/);

// =====================================================================
// BLOCO A -- "Criar Sala" abre/entra no fluxo de selecao de duracao
// =====================================================================

test('[A] o handler de "Criar sala" continua enviando create_room e zerando qualquer duracao/contexto anterior', () => {
  assert.ok(createRoomBlock.includes("SocketClient.send('create_room')"));
  assert.ok(createRoomBlock.includes('selectedMatchDuration = null'));
  assert.ok(createRoomBlock.includes('matchDurationSelectionContext = null'));
});

test('[A] `room_created` abre o painel de duracao ja existente (showMatchDurationSelection) para Multiplayer real', () => {
  assert.ok(roomCreatedCaseBlock.includes('UIController.showMatchDurationSelection()'));
  assert.ok(roomCreatedCaseBlock.includes("matchDurationSelectionContext = 'multiplayer'"));
});

test('[A] a abertura do painel em `room_created` e condicionada a NAO estar em Solo/Bot (que ja escolheram a duracao ANTES de start_solo_match)', () => {
  assert.ok(/if \(!isSoloMode && !isBotMode\)/.test(roomCreatedCaseBlock));
});

test('[A] nenhuma tela nova foi criada: o painel reutilizado e o MESMO de Solo/Bot (showMatchDurationSelection/hideMatchDurationSelection, sem nenhum outro nome de funcao/elemento)', () => {
  assert.ok(mainJsContent.includes('UIController.showMatchDurationSelection()'));
  assert.ok(mainJsContent.includes('UIController.hideMatchDurationSelection()'));
  // Nenhum identificador de painel/tela alternativo foi introduzido.
  assert.ok(!/showMultiplayerDurationSelection|MultiplayerDurationPanel/.test(mainJsContent));
});

// =====================================================================
// BLOCO B -- as quatro opcoes funcionam / select_duration e enviado
// corretamente / duracao nao e enviada como valor inventado
// =====================================================================

test('[B] o handler das opcoes de duracao SO envia select_duration quando o contexto e multiplayer, e usa exclusivamente o durationId do proprio botao', () => {
  assert.ok(durationButtonsBlock.includes("matchDurationSelectionContext === 'multiplayer'"));
  assert.ok(durationButtonsBlock.includes("SocketClient.send('select_duration', { durationId })"));
  // A validacao continua sendo feita uma UNICA vez, contra a MESMA
  // tabela central (nenhum identificador inventado/duplicado).
  assert.ok(
    durationButtonsBlock.includes(
      "Object.prototype.hasOwnProperty.call(ClientConfig.MATCH_DURATION_MS, durationId)"
    )
  );
});

test('[B] Solo/Bot continuam enviando start_solo_match (nunca select_duration) quando o contexto NAO e multiplayer', () => {
  assert.ok(durationButtonsBlock.includes("SocketClient.send('start_solo_match')"));
});

['30S', '1M', '5M', '10M'].forEach((durationId) => {
  test(`[B] opcao "${durationId}": select_duration chega ao servidor com o durationId correto e a Match Multiplayer e criada com ele`, () => {
    const { match, wsCreator, wsOpponent } = createRoomAndChooseDuration(durationId);

    assert.strictEqual(match.durationId, durationId);
    assert.strictEqual(match.durationMs, ClientConfig.MATCH_DURATION_MS[durationId]);

    // O servidor confirmou a selecao ao proprio jogador que a fez
    // (mesmo padrao de `music_selected`).
    const confirmation = lastOfType(wsCreator, 'duration_selected');
    assert.ok(confirmation);
    assert.strictEqual(confirmation.durationId, durationId);

    // Ambos os jogadores recebem a MESMA duracao no match_ready.
    const readyCreator = lastOfType(wsCreator, 'match_ready').match;
    const readyOpponent = lastOfType(wsOpponent, 'match_ready').match;
    assert.strictEqual(readyCreator.durationId, durationId);
    assert.strictEqual(readyOpponent.durationId, durationId);
    assert.strictEqual(readyCreator.durationMs, readyOpponent.durationMs);
  });
});

test('[B] duracao nao e enviada como valor inventado: um durationId invalido nunca chega a ser tratado como valido pelo servidor', () => {
  const wsCreator = createMockSocket();
  const wsOpponent = createMockSocket();
  registerConnection(wsCreator);
  registerConnection(wsOpponent);

  send(wsCreator, { type: 'create_room' });
  const roomCode = lastOfType(wsCreator, 'room_created').roomCode;

  // Simula uma mensagem que a UI JAMAIS deveria montar (o clique real
  // so dispara para um `data-duration` valido, ver Bloco B acima) --
  // usada aqui so para confirmar que o servidor tambem se protege
  // (defesa em profundidade), nunca inventando um valor de fallback.
  send(wsCreator, { type: 'select_duration', durationId: 'INVALIDO' });
  assert.ok(lastOfType(wsCreator, 'error'));

  send(wsOpponent, { type: 'join_room', roomCode });
  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.durationId, null);
  assert.strictEqual(match.durationMs, null);
});

// =====================================================================
// BLOCO C -- ENTRAR EM SALA: nunca escolhe uma duracao diferente
// =====================================================================

test('[C] "Entrar em sala" nunca abre o painel de duracao nem envia select_duration', () => {
  assert.ok(!joinRoomBlock.includes('showMatchDurationSelection'));
  assert.ok(!joinRoomBlock.includes("send('select_duration'"));
});

test('[C] `room_joined` tambem nunca abre o painel de duracao (so quem CRIA a sala escolhe)', () => {
  assert.ok(!roomJoinedCaseBlock.includes('showMatchDurationSelection'));
});

test('[C] quem entra na sala recebe exatamente a duracao que o criador escolheu, sem criar uma segunda duracao independente', () => {
  const { match, wsOpponent } = createRoomAndChooseDuration('5M');
  const readyOpponent = lastOfType(wsOpponent, 'match_ready').match;
  assert.strictEqual(readyOpponent.durationId, '5M');
  assert.strictEqual(readyOpponent.durationMs, match.durationMs);
});

test('[C] se o criador NAO escolher nenhuma duracao antes do oponente entrar, a Match cai no fallback existente (sem duracao configurada) -- nunca trava a sala nem inventa uma duracao', () => {
  const { match } = createRoomAndChooseDuration(null);
  assert.strictEqual(match.durationId, null);
  assert.strictEqual(match.durationMs, null);
  assert.strictEqual(match.state, MATCH_STATE.COUNTDOWN);
});

// =====================================================================
// BLOCO D -- countdown/inicio sincronizado continuam exatamente como
// ja funcionam; a duracao usa o startTimestamp real da partida
// =====================================================================

test('[D] countdown e startTimestamp continuam identicos para os dois jogadores com a duracao escolhida pela nova UI', () => {
  const { match, wsCreator, wsOpponent } = createRoomAndChooseDuration('1M');

  const countdownCreator = lastOfType(wsCreator, 'match_countdown_start');
  const countdownOpponent = lastOfType(wsOpponent, 'match_countdown_start');
  assert.ok(countdownCreator && countdownOpponent);
  assert.strictEqual(countdownCreator.startTimestamp, countdownOpponent.startTimestamp);
  assert.strictEqual(countdownCreator.countdownSeconds, MATCH_COUNTDOWN_SECONDS);
  assert.strictEqual(match.startTimestamp, countdownCreator.startTimestamp);
  assert.strictEqual(countdownCreator.match.durationMs, ClientConfig.MATCH_DURATION_MS['1M']);
});

test('[D] disparar o countdown real leva a Match a PLAYING normalmente, com a duracao presente em match_started para os dois', () => {
  const { match, wsCreator, wsOpponent } = createRoomAndChooseDuration('30S');

  assert.ok(match._countdownTimer, 'esperava um _countdownTimer real agendado por scheduleCountdown');
  match._countdownTimer._onTimeout();

  assert.strictEqual(match.state, MATCH_STATE.PLAYING);
  const startedCreator = lastOfType(wsCreator, 'match_started');
  const startedOpponent = lastOfType(wsOpponent, 'match_started');
  assert.ok(startedCreator && startedOpponent);
  assert.strictEqual(startedCreator.startTimestamp, startedOpponent.startTimestamp);
  assert.strictEqual(startedCreator.match.durationMs, ClientConfig.MATCH_DURATION_MS['30S']);
});

// =====================================================================
// BLOCO E -- "Jogar Novamente" continua funcionando
// =====================================================================

test('[E] apos escolher a duracao pela nova UI, "Jogar Novamente" (rematch_ready dos dois) continua criando uma nova Match, reaproveitando a MESMA duracao', () => {
  const { match, roomCode, wsCreator, wsOpponent } = createRoomAndChooseDuration('10M');
  match.setState(MATCH_STATE.FINISHED);

  send(wsCreator, { type: 'rematch_ready' });
  send(wsOpponent, { type: 'rematch_ready' });

  const secondMatch = MatchManager.getMatch(roomCode);
  assert.notStrictEqual(secondMatch, match);
  assert.strictEqual(secondMatch.durationId, '10M');
  assert.strictEqual(secondMatch.durationMs, ClientConfig.MATCH_DURATION_MS['10M']);
});

// =====================================================================
// BLOCO F -- LIMPEZA: sair da sala / voltar ao menu / criar outra sala /
// entrar em outra sala nunca deixam uma duracao antiga vazar
// =====================================================================

test('[F] cancelar o painel de duracao no contexto multiplayer sai da sala (leaveRoomController.requestLeave), sem deixar a sala presa', () => {
  assert.ok(durationCancelBlock.includes('leaveRoomController.requestLeave()'));
  assert.ok(durationCancelBlock.includes("matchDurationSelectionContext === 'multiplayer'"));
  assert.ok(durationCancelBlock.includes('matchDurationSelectionContext = null'));
});

test('[F] `handleLeftRoom` (saida confirmada pelo servidor) esconde o painel de duracao e zera o contexto, alem de selectedMatchDuration', () => {
  assert.ok(handleLeftRoomBlock.includes('UIController.hideMatchDurationSelection()'));
  assert.ok(handleLeftRoomBlock.includes('matchDurationSelectionContext = null'));
  assert.ok(handleLeftRoomBlock.includes('selectedMatchDuration = null'));
});

test('[F] sair da sala (leave_room) limpa a selecao de duracao pendente no SERVIDOR -- nunca fica presa para a proxima sala', () => {
  const wsCreator = createMockSocket();
  registerConnection(wsCreator);

  send(wsCreator, { type: 'create_room' });
  const roomCode = lastOfType(wsCreator, 'room_created').roomCode;
  send(wsCreator, { type: 'select_duration', durationId: '1M' });
  assert.ok(matchDurationSelectionFlow.getSelectionState(roomCode));

  send(wsCreator, { type: 'leave_room' });
  assert.strictEqual(matchDurationSelectionFlow.getSelectionState(roomCode), null);
});

test('[F] criar outra sala (mesma conexao) nunca herda a duracao de uma sala anterior', () => {
  const wsCreator = createMockSocket();
  registerConnection(wsCreator);

  send(wsCreator, { type: 'create_room' });
  const firstRoomCode = lastOfType(wsCreator, 'room_created').roomCode;
  send(wsCreator, { type: 'select_duration', durationId: '5M' });
  send(wsCreator, { type: 'leave_room' });

  send(wsCreator, { type: 'create_room' });
  const secondRoomCode = lastOfType(wsCreator, 'room_created').roomCode;
  assert.notStrictEqual(firstRoomCode, secondRoomCode);
  assert.strictEqual(matchDurationSelectionFlow.getSelectionState(secondRoomCode), null);

  const wsOpponent = createMockSocket();
  registerConnection(wsOpponent);
  send(wsOpponent, { type: 'join_room', roomCode: secondRoomCode });

  const match = MatchManager.getMatch(secondRoomCode);
  assert.strictEqual(match.durationId, null);
});

test('[F] entrar em outra sala (mesma conexao) nunca mistura duracao com a selecao de uma sala anterior', () => {
  const { roomCode: firstRoomCode, wsCreator: firstCreator } = createRoomAndChooseDuration('30S');

  const wsWanderer = createMockSocket();
  registerConnection(wsWanderer);
  send(wsWanderer, { type: 'join_room', roomCode: firstRoomCode });
  send(wsWanderer, { type: 'leave_room' });

  const secondCreator = createMockSocket();
  registerConnection(secondCreator);
  send(secondCreator, { type: 'create_room' });
  const secondRoomCode = lastOfType(secondCreator, 'room_created').roomCode;
  send(secondCreator, { type: 'select_duration', durationId: '10M' });

  send(wsWanderer, { type: 'join_room', roomCode: secondRoomCode });

  const secondMatch = MatchManager.getMatch(secondRoomCode);
  assert.strictEqual(secondMatch.durationId, '10M');
  void firstCreator;
});

// =====================================================================
// BLOCO G -- SOLO E BOT PERMANECEM INTACTOS (nenhuma dificuldade do
// Bot e alterada)
// =====================================================================

test('[G] Solo continua funcionando de ponta a ponta (start_solo_match -> READY -> COUNTDOWN -> PLAYING), sem nenhuma duracao vinda do servidor', () => {
  const wsSolo = createMockSocket();
  registerConnection(wsSolo);
  send(wsSolo, { type: 'start_solo_match' });

  const roomCode = lastOfType(wsSolo, 'room_created').roomCode;
  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.mode, MATCH_MODE.SOLO);
  assert.strictEqual(match.durationId, null);
  assert.strictEqual(match.durationMs, null);

  match._countdownTimer._onTimeout();
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);
});

test('[G] Bot reutiliza o MESMO pipeline de start_solo_match (mode "solo") e continua sem receber duracao do servidor', () => {
  // O Bot roda inteiramente no cliente (client/js/match/botMatchController.js) --
  // do lado do servidor, uma partida contra o Bot e indistinguivel de
  // uma partida Solo (mesmo `start_solo_match`, ver
  // server/ws/messageRouter.js#handleStartSoloMatch). Confirma que
  // isso continua verdade e que nenhuma duracao vaza para ela.
  const wsBot = createMockSocket();
  registerConnection(wsBot);
  send(wsBot, { type: 'start_solo_match' });

  const roomCode = lastOfType(wsBot, 'room_created').roomCode;
  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.mode, MATCH_MODE.SOLO);
  assert.strictEqual(match.durationId, null);
});

test('[G] nenhuma dificuldade do Bot foi alterada: os presets EASY/MEDIUM/HARD em ClientConfig.BOT_DIFFICULTY_PRESETS continuam intactos', () => {
  assert.deepStrictEqual(Object.keys(ClientConfig.BOT_DIFFICULTY).sort(), ['EASY', 'HARD', 'MEDIUM'].sort());
  ['EASY', 'MEDIUM', 'HARD'].forEach((difficulty) => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(ClientConfig.BOT_DIFFICULTY_PRESETS, difficulty),
      `preset "${difficulty}" deveria continuar existindo`
    );
  });
});

test('[G] nenhum arquivo de Bot no cliente conhece select_duration/duration_selected (nenhuma logica de duracao nova foi criada la)', () => {
  ['botController.js', 'botMatchController.js'].forEach((file) => {
    const source = fs.readFileSync(path.join(__dirname, `../client/js/match/${file}`), 'utf8');
    assert.ok(!source.includes('select_duration'), `${file} nao deveria conhecer select_duration`);
    assert.ok(!source.includes('duration_selected'), `${file} nao deveria conhecer duration_selected`);
  });
});

// =====================================================================
// BLOCO H -- NENHUM SISTEMA/TIMER/RELOGIO NOVO FOI CRIADO
// =====================================================================

test('[H] main.js nao introduziu nenhum novo timer/relogio para a duracao do Multiplayer (so encaminha mensagens/estado, reutilizando MatchController/MatchEndDetector ja existentes)', () => {
  // A integracao inteira desta Parte 4 e feita dentro dos handlers de
  // clique/mensagem ja existentes -- nenhum setInterval/setTimeout novo
  // relacionado a duracao foi adicionado a main.js por esta etapa
  // (os unicos setTimeout de main.js sao os ja existentes, ex:
  // debounce/hide de UI, nada relacionado ao fim de partida por tempo).
  assert.ok(
    !/setInterval\([^)]*[Dd]uration/.test(mainJsContent),
    'nenhum setInterval novo relacionado a duracao deveria existir em main.js'
  );
});

test('[H] o unico modulo que decide fim de partida por duracao continua sendo MatchEndDetector/MatchDuration (ja existentes) -- main.js so repassa durationMs adiante', () => {
  assert.ok(mainJsContent.includes('MatchDuration.resolveMatchDuration'));
  assert.ok(mainJsContent.includes('resolvedMatchDurationMs'));
});

console.log(`\n${passed} teste(s) passaram.`);
