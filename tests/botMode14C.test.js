/**
 * Testes automatizados da ETAPA 14C — PARTE 1 (entrada visual e fluxo
 * basico do modo "Jogar contra Bot").
 *
 * NAO reimplementa nenhum sistema: exercita os modulos REAIS ja
 * existentes (BotController/BotMatchController da Etapa 14A/14B,
 * PlayerState, NoteEngine, UIController) e faz verificacao ESTATICA do
 * codigo-fonte de client/index.html e client/js/main.js -- mesmo tipo
 * de teste ja usado em tests/resultInterfaceFlow13F.test.js (regex
 * sobre o proprio codigo) para confirmar que o roteamento/integracao
 * existe sem reimplementar main.js inteiro (que depende de um
 * navegador de verdade).
 *
 * Executar com: node tests/botMode14C.test.js
 *
 * NOTA (ETAPA 14D — PARTE 2B): o teste do BLOCO C abaixo foi
 * atualizado para refletir que "Jogar contra Bot" agora abre a tela
 * "Escolha a dificuldade" em vez de iniciar a partida diretamente --
 * ver tests/botDifficulty14D2Interface.test.js para a cobertura
 * completa da tela de selecao.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PlayerState = require('../client/js/match/playerState');
const NoteEngine = require('../client/js/match/noteEngine');
const BotController = require('../client/js/match/botController');
const BotMatchController = require('../client/js/match/botMatchController');
const LocalServerSimulator = require('../client/js/network/localServerSimulator');

// Regressao de multiplayer/solo do lado do servidor (mesmos modulos
// reais ja usados por tests/soloMode12A.test.js).
const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { MATCH_STATE, MATCH_MODE } = require('../server/match/Match');
const { registerConnection } = require('../server/ws/connectionHandler');
const { routeMessage } = require('../server/ws/messageRouter');

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

const indexHtmlPath = path.join(__dirname, '../client/index.html');
const mainJsPath = path.join(__dirname, '../client/js/main.js');
const botMatchControllerPath = path.join(__dirname, '../client/js/match/botMatchController.js');
const styleCssPath = path.join(__dirname, '../client/css/style.css');

const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');
const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');
const botMatchControllerContent = fs.readFileSync(botMatchControllerPath, 'utf8');
const styleCssContent = fs.readFileSync(styleCssPath, 'utf8');

const WINDOWS = { perfectMs: 60, greatMs: 150, goodMs: 1800 };
const SCORE_VALUES = { PERFECT: 300, GREAT: 200, GOOD: 100, MISS: 0 };
const COMBO_TIERS = [{ minCombo: 0, multiplier: 1 }, { minCombo: 5, multiplier: 1.5 }];
const PENALTIES = { MISTAKE: -50, MISS: -30 };
const NOTE_PARAMS = { seed: 42, startTimestamp: 1_000_000, length: 8, noteRange: 3, noteIntervalMs: 600, leadInMs: 0 };

function extractBlock(regex, label) {
  const match = regex.exec(mainJsContent);
  assert.ok(match, `${label}: bloco nao encontrado em main.js`);
  return match[0];
}

// =====================================================================
// BLOCO A -- INTERFACE (botoes)
// =====================================================================

test('botao "Jogar contra Bot" existe em client/index.html', () => {
  assert.ok(
    /<button[^>]*id="btn-play-bot"[^>]*>\s*Jogar contra Bot\s*<\/button>/.test(indexHtmlContent),
    'esperava um <button id="btn-play-bot"> com o texto "Jogar contra Bot"'
  );
});

test('botao "Jogar Sozinho" continua existindo, separado do botao do Bot', () => {
  assert.ok(
    /<button[^>]*id="btn-play-solo"[^>]*>\s*Jogar Sozinho\s*<\/button>/.test(indexHtmlContent),
    'esperava que o <button id="btn-play-solo"> continuasse existindo, inalterado'
  );

  const botButtonIndex = indexHtmlContent.indexOf('id="btn-play-bot"');
  const soloButtonIndex = indexHtmlContent.indexOf('id="btn-play-solo"');
  assert.ok(botButtonIndex !== -1 && soloButtonIndex !== -1, 'os dois botoes precisam existir');
  assert.notStrictEqual(botButtonIndex, soloButtonIndex, 'os dois botoes precisam ser elementos DIFERENTES');
});

// =====================================================================
// BLOCO B -- ESTADO PROPRIO (isBotMode independente de isSoloMode)
// =====================================================================

test('main.js declara "isBotMode" como um estado PROPRIO (nao reaproveita isSoloMode)', () => {
  assert.ok(/let isBotMode = false;/.test(mainJsContent), 'esperava "let isBotMode = false;" declarado separadamente');
  assert.ok(/let isSoloMode = false;/.test(mainJsContent), 'isSoloMode precisa continuar existindo, inalterado');
});

test('clique em "Jogar Sozinho" nunca liga isBotMode (continua funcionando exatamente como antes)', () => {
  const soloHandlerBlock = extractBlock(
    /document\.getElementById\('btn-play-solo'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-play-solo'
  );
  assert.ok(soloHandlerBlock.includes("isSoloMode = true"), 'Solo precisa continuar ligando isSoloMode');
  assert.ok(soloHandlerBlock.includes("SocketClient.send('start_solo_match')"), 'Solo precisa continuar chamando start_solo_match');
  assert.ok(
    soloHandlerBlock.includes('isBotMode = false'),
    'o clique em "Jogar Sozinho" deve garantir isBotMode desligado (nunca liga-lo)'
  );
});

test('clique em "Criar sala" / "Entrar na sala" (multiplayer) desliga isBotMode, nunca liga', () => {
  const createRoomBlock = extractBlock(
    /document\.getElementById\('btn-create-room'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-create-room'
  );
  const joinRoomBlock = extractBlock(
    /document\.getElementById\('btn-join-room'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-join-room'
  );

  [createRoomBlock, joinRoomBlock].forEach((block) => {
    assert.ok(block.includes('isBotMode = false'), 'multiplayer precisa garantir isBotMode desligado');
    assert.ok(!/isBotMode = true/.test(block), 'multiplayer nunca deve ligar isBotMode');
  });
});

// =====================================================================
// BLOCO C -- CLICAR NO BOTAO INICIA O FLUXO BOT
// =====================================================================

test('clicar em "Jogar contra Bot" abre a selecao de dificuldade (ETAPA 14D-2B), sem iniciar a partida diretamente', () => {
  const botHandlerBlock = extractBlock(
    /document\.getElementById\('btn-play-bot'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-play-bot'
  );

  assert.ok(
    botHandlerBlock.includes('UIController.showBotDifficultySelection()'),
    'o clique precisa abrir a tela "Escolha a dificuldade" (ETAPA 14D-2B)'
  );
  assert.ok(
    !botHandlerBlock.includes('isBotMode = true'),
    'o clique em "Jogar contra Bot" NAO deve mais ligar isBotMode diretamente -- isso agora acontece so ao escolher uma dificuldade'
  );
  assert.ok(
    !botHandlerBlock.includes("SocketClient.send('start_solo_match')"),
    'o clique em "Jogar contra Bot" NAO deve mais iniciar a partida diretamente -- isso agora acontece so ao escolher uma dificuldade'
  );
});


// =====================================================================
// BLOCO D -- BOTMATCHCONTROLLER E CRIADO / MESMA TIMELINE / MESMO RELOGIO
// =====================================================================

test('startMatchGameplay cria o BotMatchController somente quando isBotMode, reutilizando a MESMA timeline', () => {
  const startMatchGameplayBlock = extractBlock(
    /function startMatchGameplay\(message\) \{[^]*?\n {2}\}/,
    'startMatchGameplay'
  );

  assert.ok(
    /if \(isBotMode\) \{[^]*?BotMatchController\.createBotMatch\(\{[^]*?timeline,/.test(startMatchGameplayBlock),
    'BotMatchController.createBotMatch precisa ser chamado dentro de "if (isBotMode)", recebendo a variavel "timeline"'
  );

  // A MESMA variavel "timeline" (nao uma copia/segunda geracao) precisa
  // alimentar tanto o GameplayEngine do jogador humano quanto o Bot.
  const gameplayEngineUsesTimeline = /GameplayEngine\.createGameplayEngine\(\{\s*timeline,/.test(startMatchGameplayBlock);
  const botUsesTimeline = /BotMatchController\.createBotMatch\(\{\s*timeline,/.test(startMatchGameplayBlock);
  assert.ok(gameplayEngineUsesTimeline, 'GameplayEngine precisa continuar recebendo "timeline"');
  assert.ok(botUsesTimeline, 'BotMatchController precisa receber a MESMA variavel "timeline"');
});

test('Bot e avancado pelo MESMO relogio sincronizado ja usado pelo jogador humano (getSyncedNow), dentro do mesmo loop', () => {
  const loopBlock = extractBlock(/function loop\(\) \{[^]*?\n {4}\}/, 'loop de requestAnimationFrame');
  // Remove comentarios de linha (// ...) antes de checar ausencia de
  // Date.now()/setTimeout/setInterval -- os proprios comentarios deste
  // trecho MENCIONAM "Date.now()" (para explicar que nao e usado), o
  // que faria uma busca ingenua por substring encontrar o comentario.
  const loopCodeOnly = loopBlock
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

  assert.ok(
    loopBlock.includes('BotMatchController.tick(botMatch, getSyncedNow())'),
    'BotMatchController.tick precisa ser chamado com getSyncedNow() dentro do MESMO loop do jogador humano'
  );
  assert.ok(!loopCodeOnly.includes('Date.now()'), 'o CODIGO do loop nao deve chamar Date.now() diretamente para o Bot');

  // Nenhum setTimeout/setInterval novo por nota: o UNICO agendamento
  // deste loop continua sendo o proprio requestAnimationFrame.
  assert.ok(!loopCodeOnly.includes('setTimeout'), 'nao deveria haver setTimeout dentro do loop de gameplay');
  assert.ok(!loopCodeOnly.includes('setInterval'), 'nao deveria haver setInterval dentro do loop de gameplay');
});

// Remove comentarios de bloco (/* ... */) antes de procurar por
// chamadas de verdade no CODIGO -- os proprios comentarios deste
// arquivo MENCIONAM "Date.now()"/"setNoteState" (em backticks, dentro
// do JSDoc) exatamente para explicar que NUNCA sao chamados, entao uma
// busca ingenua por essas substrings encontraria o comentario, nao uma
// chamada real.
function stripBlockComments(source) {
  return source.replace(/\/\*[^]*?\*\//g, '');
}

const botMatchControllerCodeOnly = stripBlockComments(botMatchControllerContent);

test('BotMatchController.tick nunca usa Date.now() internamente (recebe sempre o relogio de fora)', () => {
  assert.ok(
    !botMatchControllerCodeOnly.includes('Date.now()'),
    'botMatchController.js (fora de comentarios) nao deveria chamar Date.now() em nenhum lugar'
  );
});

test('Bot nunca marca notas da timeline como hit/missed (nunca chama NoteEngine.setNoteState)', () => {
  assert.ok(
    !botMatchControllerCodeOnly.includes('setNoteState'),
    'botMatchController.js (fora de comentarios) nao deveria chamar NoteEngine.setNoteState -- a timeline e exclusivamente do jogador humano'
  );
});

// =====================================================================
// BLOCO E -- PLAYERSTATE HUMANO E DO BOT SAO INDEPENDENTES
// =====================================================================

test('PlayerState humano e PlayerState do Bot sao instancias DIFERENTES, mesmo compartilhando a timeline', () => {
  const timeline = NoteEngine.generateNoteTimeline(NOTE_PARAMS);

  const humanPlayerState = PlayerState.createPlayerState();
  const botMatch = BotMatchController.createBotMatch({
    timeline,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers: COMBO_TIERS,
    penalties: PENALTIES,
  });

  assert.notStrictEqual(BotMatchController.getPlayerState(botMatch), humanPlayerState);
});

test('alterar o PlayerState humano nunca altera o PlayerState do Bot, e vice-versa', () => {
  const timeline = NoteEngine.generateNoteTimeline(NOTE_PARAMS);

  const humanPlayerState = PlayerState.createPlayerState();
  const botMatch = BotMatchController.createBotMatch({
    timeline,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers: COMBO_TIERS,
    penalties: PENALTIES,
  });

  PlayerState.registerHit(humanPlayerState, 'PERFECT', SCORE_VALUES, COMBO_TIERS);
  assert.strictEqual(humanPlayerState.score, 300);
  assert.strictEqual(BotMatchController.getPlayerState(botMatch).score, 0);

  // Avanca o Bot ate o fim da timeline (bem no futuro).
  BotMatchController.tick(botMatch, NOTE_PARAMS.startTimestamp + 999999);
  assert.strictEqual(humanPlayerState.score, 300, 'a pontuacao do jogador humano nao pode mudar por causa do Bot');
});

test('Bot nao altera a timeline do jogador (nenhuma nota muda de estado por causa do Bot)', () => {
  const timeline = NoteEngine.generateNoteTimeline(NOTE_PARAMS);
  const statesBefore = timeline.map((note) => note.state);

  const botMatch = BotMatchController.createBotMatch({
    timeline,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers: COMBO_TIERS,
    penalties: PENALTIES,
  });
  BotMatchController.tick(botMatch, NOTE_PARAMS.startTimestamp + 999999);

  const statesAfter = timeline.map((note) => note.state);
  assert.deepStrictEqual(statesAfter, statesBefore, 'nenhuma nota deveria ter seu "state" alterado pelo Bot');
});

// =====================================================================
// BLOCO F -- INTERFACE DO OPONENTE (area do Bot)
// =====================================================================

test('UIController.setBotMode existe e liga a classe "bot-mode" + o rotulo "BOT" na area do player2', () => {
  withFreshUIController((UIController, doc) => {
    UIController.setBotMode(true);
    assert.ok(doc.documentElement._classes.has('bot-mode'), 'esperava a classe "bot-mode" em <html>');
    assert.ok(doc.body._classes.has('bot-mode'), 'esperava a classe "bot-mode" em <body>');
    assert.strictEqual(doc._elements['player2-name'].textContent, 'BOT');

    UIController.setBotMode(false);
    assert.ok(!doc.documentElement._classes.has('bot-mode'));
    assert.ok(!doc.body._classes.has('bot-mode'));
    assert.strictEqual(doc._elements['player2-name'].textContent, 'Jogador 2');
  });
});

test('CSS reexibe a area do player2 (#player-area-2/.field-divider) quando body.bot-mode esta presente', () => {
  assert.ok(
    /body\.bot-mode #player-area-2\s*\{[^}]*display:\s*flex\s*!important;?[^}]*\}/.test(styleCssContent),
    'esperava uma regra CSS reexibindo #player-area-2 quando body.bot-mode'
  );
  assert.ok(
    /body\.bot-mode \.field-divider\s*\{[^}]*display:\s*block\s*!important;?[^}]*\}/.test(styleCssContent),
    'esperava uma regra CSS reexibindo .field-divider quando body.bot-mode'
  );
});

// =====================================================================
// BLOCO G -- SOLO / MULTIPLAYER / MODO TESTE CONTINUAM FUNCIONANDO
// =====================================================================

test('Solo continua funcionando: GameplayEngine + MatchTimelineManager + PlayerState, com BotMatchController carregado', () => {
  const timeline = NoteEngine.generateNoteTimeline(NOTE_PARAMS);
  const playerState = PlayerState.createPlayerState();
  const GameplayEngine = require('../client/js/match/gameplayEngine');

  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers: COMBO_TIERS,
    penalties: PENALTIES,
    sendEvent: () => {},
  });

  const result = engine.handleKeyPress(timeline[0].lane, timeline[0].time);
  assert.ok(result, 'GameplayEngine.handleKeyPress deveria continuar funcionando normalmente');
  assert.strictEqual(playerState.hits, 1);
});

test('Multiplayer real continua funcionando de ponta a ponta (mode === "multiplayer", ate FINISHED)', () => {
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
    };
  }
  function send(ws, message) {
    routeMessage(ws, JSON.stringify(message));
  }
  function lastOfType(socket, type) {
    const matches = socket.sent.filter((m) => m.type === type);
    return matches.length ? matches[matches.length - 1] : null;
  }

  const wsPlayer1 = createMockSocket();
  const wsPlayer2 = createMockSocket();
  registerConnection(wsPlayer1);
  registerConnection(wsPlayer2);

  send(wsPlayer1, { type: 'create_room' });
  const roomCode = lastOfType(wsPlayer1, 'room_created').roomCode;
  send(wsPlayer2, { type: 'join_room', roomCode });

  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.mode, MATCH_MODE.MULTIPLAYER);

  assert.ok(match._countdownTimer, 'esperava um countdown real agendado');
  match._countdownTimer._onTimeout();
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);

  send(wsPlayer1, { type: 'sequence_complete' });
  send(wsPlayer2, { type: 'sequence_complete' });
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);
});

test('Modo Teste (LocalServerSimulator) continua reproduzindo normalmente o fluxo Solo', () => {
  const messages = [];
  const conn = LocalServerSimulator.createLocalConnection({
    onMessage: (m) => messages.push(m),
    countdownMs: 0,
  });
  conn.connect();
  conn.send('start_solo_match');

  assert.ok(messages.some((m) => m.type === 'room_created'));
  assert.ok(messages.some((m) => m.type === 'match_ready' && m.match.mode === 'solo'));
});

test('Modo Teste continua recusando create_room/join_room (multiplayer exige servidor real)', () => {
  const messages = [];
  const conn = LocalServerSimulator.createLocalConnection({ onMessage: (m) => messages.push(m) });
  conn.connect();
  conn.send('create_room');

  const errorMessage = messages.find((m) => m.type === 'error');
  assert.ok(errorMessage);
  assert.strictEqual(errorMessage.message, LocalServerSimulator.MULTIPLAYER_UNAVAILABLE_MESSAGE);
});

// ---------------------------------------------------------------------
// DOM falso minimo para UIController (mesmo padrao de
// tests/leaveRoomClient.test.js#makeFakeUIDocument), com o elemento
// novo desta etapa (player2-name).
// ---------------------------------------------------------------------
function makeFakeElement(initial = {}) {
  const classes = new Set(initial.classes || []);
  return {
    textContent: initial.textContent || '',
    value: initial.value || '',
    scrollTop: 0,
    scrollHeight: 0,
    classList: {
      add: (...cls) => cls.forEach((c) => classes.add(c)),
      remove: (...cls) => cls.forEach((c) => classes.delete(c)),
      toggle: (c, force) => {
        const shouldHave = force === undefined ? !classes.has(c) : Boolean(force);
        if (shouldHave) classes.add(c);
        else classes.delete(c);
      },
      contains: (c) => classes.has(c),
    },
    appendChild() {},
    _classes: classes,
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
    'player2-name': makeFakeElement({ textContent: 'Jogador 2' }),
  };
  return {
    getElementById: (id) => elements[id] || null,
    createElement: () => makeFakeElement(),
    documentElement: makeFakeElement(),
    body: makeFakeElement(),
    _elements: elements,
  };
}

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

console.log(`\n${passed} teste(s) passaram, ${failed} falharam.`);
if (failed > 0) process.exitCode = 1;
