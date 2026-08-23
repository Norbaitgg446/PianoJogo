/**
 * Testes automatizados da ETAPA 14D — PARTE 2B (interface de selecao
 * de dificuldade do Bot).
 *
 * A Parte 2A (tests/botDifficulty14D2.test.js) ja cobriu a LOGICA
 * interna das tres dificuldades (BOT_DIFFICULTY_PRESETS,
 * createConfigForDifficulty). Este arquivo cobre exclusivamente a
 * INTERFACE criada por cima dela:
 *
 *   - "Jogar contra Bot" abre a tela "Escolha a dificuldade" em vez
 *     de iniciar a partida direto;
 *   - Facil/Medio/Dificil selecionam exatamente "EASY"/"MEDIUM"/"HARD"
 *     (ClientConfig.BOT_DIFFICULTY) e so ENTAO iniciam a partida;
 *   - "Cancelar" nunca inicia partida, e devolve isBotMode/botMatch/
 *     selectedBotDifficulty ao estado inicial;
 *   - a dificuldade escolhida chega de fato ao Bot ja existente
 *     (BotController/BotMatchController, Partes 1 e 2A) sem nenhum
 *     sistema paralelo;
 *   - Solo, Multiplayer e Modo Teste continuam funcionando exatamente
 *     como antes, sem nenhuma influencia da selecao de dificuldade;
 *   - a area do player2 mostra "BOT — <DIFICULDADE>" corretamente.
 *
 * Mesmo estilo dos demais arquivos desta etapa: exercita os modulos
 * REAIS (nunca reimplementa julgamento/pontuacao/config do Bot) e faz
 * verificacao ESTATICA do codigo-fonte de client/index.html e
 * client/js/main.js onde um teste de integracao real exigiria um
 * navegador de verdade (mesmo padrao ja usado em
 * tests/botMode14C.test.js / tests/botModeInterface14C2.test.js).
 *
 * Executar com: node tests/botDifficulty14D2Interface.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ClientConfig = require('../client/js/config');
const BotController = require('../client/js/match/botController');
const BotMatchController = require('../client/js/match/botMatchController');
const MatchTimelineManager = require('../client/js/match/matchTimelineManager');
const LocalServerSimulator = require('../client/js/network/localServerSimulator');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const PlayerState = require('../client/js/match/playerState');

// Regressao de multiplayer do lado do servidor (mesmos modulos reais
// ja usados por tests/botMode14C.test.js).
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

const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');
const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');

const WINDOWS = { perfectMs: 60, greatMs: 150, goodMs: 1800 };
const SCORE_VALUES = { PERFECT: 300, GREAT: 200, GOOD: 100, MISS: 0 };
const COMBO_TIERS = [{ minCombo: 0, multiplier: 1 }, { minCombo: 5, multiplier: 1.5 }];
const PENALTIES = { MISTAKE: -50, MISS: -30 };
const NOTE_PARAMS = { seed: 42, startTimestamp: 1_000_000, length: 8, noteRange: 3, noteIntervalMs: 600, leadInMs: 0 };
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];

function extractBlock(regex, label) {
  const match = regex.exec(mainJsContent);
  assert.ok(match, `${label}: bloco nao encontrado em main.js`);
  return match[0];
}

// =====================================================================
// BLOCO A -- BOTAO ABRE A SELECAO (NAO INICIA A PARTIDA DIRETO)
// =====================================================================

test('painel "Escolha a dificuldade" existe em client/index.html, escondido por padrao', () => {
  assert.ok(
    /<section[^>]*id="bot-difficulty-panel"[^>]*class="panel hidden"/.test(indexHtmlContent),
    'esperava <section id="bot-difficulty-panel" class="panel hidden"> (mesmo padrao de painel/hidden ja usado no resto do lobby)'
  );
});

test('painel de dificuldade tem as tres opcoes (EASY/MEDIUM/HARD) e um botao Cancelar', () => {
  const panelMatch = /<section[^>]*id="bot-difficulty-panel"[^]*?<\/section>/.exec(indexHtmlContent);
  assert.ok(panelMatch, 'bloco do bot-difficulty-panel nao encontrado');
  const panel = panelMatch[0];

  assert.ok(/data-difficulty="EASY"/.test(panel), 'esperava um botao com data-difficulty="EASY"');
  assert.ok(/data-difficulty="MEDIUM"/.test(panel), 'esperava um botao com data-difficulty="MEDIUM"');
  assert.ok(/data-difficulty="HARD"/.test(panel), 'esperava um botao com data-difficulty="HARD"');
  assert.ok(/id="btn-bot-difficulty-cancel"/.test(panel), 'esperava um botao de cancelar');

  // As tres opcoes precisam ser botoes DIFERENTES (clicaveis
  // independentemente), nunca o mesmo elemento reaproveitado.
  const easyIndex = panel.indexOf('data-difficulty="EASY"');
  const mediumIndex = panel.indexOf('data-difficulty="MEDIUM"');
  const hardIndex = panel.indexOf('data-difficulty="HARD"');
  assert.ok(
    easyIndex !== -1 && mediumIndex !== -1 && hardIndex !== -1 && new Set([easyIndex, mediumIndex, hardIndex]).size === 3,
    'as tres opcoes de dificuldade precisam ser elementos distintos'
  );
});

test('clicar em "Jogar contra Bot" abre a selecao de dificuldade, sem ligar isBotMode nem iniciar a partida', () => {
  const botHandlerBlock = extractBlock(
    /document\.getElementById\('btn-play-bot'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-play-bot'
  );

  assert.ok(
    botHandlerBlock.includes('UIController.showBotDifficultySelection()'),
    'o clique precisa abrir a tela "Escolha a dificuldade"'
  );
  assert.ok(!botHandlerBlock.includes('isBotMode = true'), 'o clique NAO deve ligar isBotMode diretamente');
  assert.ok(
    !botHandlerBlock.includes("SocketClient.send('start_solo_match')"),
    'o clique NAO deve iniciar a partida diretamente'
  );
});

// =====================================================================
// BLOCO B -- FACIL/MEDIO/DIFICIL SELECIONAM EASY/MEDIUM/HARD
// =====================================================================

test('o handler das opcoes de dificuldade usa o proprio data-difficulty do botao clicado como identificador', () => {
  const optionsBlock = extractBlock(
    /document\.querySelectorAll\('#bot-difficulty-panel \[data-difficulty\]'\)\.forEach\(\(button\) => \{[^]*?\n {2}\}\);/,
    'handler das opcoes de dificuldade'
  );

  assert.ok(
    /const difficulty = button\.dataset\.difficulty;/.test(optionsBlock),
    'o identificador precisa vir diretamente de button.dataset.difficulty -- nenhuma conversao para outro valor'
  );
  assert.ok(optionsBlock.includes('isBotMode = true'), 'escolher uma dificuldade precisa ligar isBotMode');
  assert.ok(
    optionsBlock.includes('selectedBotDifficulty = difficulty'),
    'escolher uma dificuldade precisa guardar o identificador em selectedBotDifficulty'
  );
  assert.ok(
    optionsBlock.includes('UIController.setBotMode(true, difficulty)'),
    'escolher uma dificuldade precisa atualizar a UI do Bot com a dificuldade escolhida'
  );
  assert.ok(
    optionsBlock.includes('UIController.hideBotDifficultySelection()'),
    'escolher uma dificuldade precisa fechar a tela de selecao'
  );
  assert.ok(
    optionsBlock.includes("SocketClient.send('start_solo_match')"),
    'escolher uma dificuldade precisa, so ENTAO, iniciar a partida (mesmo pipeline ja existente)'
  );
});

test('index.html liga cada rotulo em portugues ao identificador correto (Facil->EASY, Medio->MEDIUM, Dificil->HARD)', () => {
  assert.ok(
    /data-difficulty="EASY"[^>]*>[^<]*Fácil/.test(indexHtmlContent),
    'esperava o botao "Fácil" com data-difficulty="EASY"'
  );
  assert.ok(
    /data-difficulty="MEDIUM"[^>]*>[^<]*Médio/.test(indexHtmlContent),
    'esperava o botao "Médio" com data-difficulty="MEDIUM"'
  );
  assert.ok(
    /data-difficulty="HARD"[^>]*>[^<]*Difícil/.test(indexHtmlContent),
    'esperava o botao "Difícil" com data-difficulty="HARD"'
  );
});

// =====================================================================
// BLOCO C -- CANCELAR NUNCA INICIA PARTIDA
// =====================================================================

test('"Cancelar" fecha o painel sem iniciar partida, mantendo isBotMode falso, botMatch nulo e selectedBotDifficulty limpo', () => {
  const cancelBlock = extractBlock(
    /document\.getElementById\('btn-bot-difficulty-cancel'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-bot-difficulty-cancel'
  );

  assert.ok(
    cancelBlock.includes('UIController.hideBotDifficultySelection()'),
    'cancelar precisa fechar a tela de selecao'
  );
  assert.ok(cancelBlock.includes('isBotMode = false'), 'cancelar precisa manter/devolver isBotMode a falso');
  assert.ok(cancelBlock.includes('botMatch = null'), 'cancelar precisa manter/devolver botMatch a nulo');
  assert.ok(
    cancelBlock.includes('selectedBotDifficulty = null'),
    'cancelar precisa limpar selectedBotDifficulty'
  );
  assert.ok(
    !cancelBlock.includes('SocketClient.send'),
    'cancelar NUNCA deve enviar nenhuma mensagem de rede/iniciar partida'
  );
});

// =====================================================================
// BLOCO D -- A DIFICULDADE ESCOLHIDA CHEGA DE FATO AO BOT
// =====================================================================

test('startMatchGameplay resolve a config do Bot a partir de selectedBotDifficulty via createConfigForDifficulty (Etapa 14D-2A), sem sistema paralelo', () => {
  const startMatchGameplayBlock = extractBlock(
    /function startMatchGameplay\(message\) \{[^]*?\n {2}\}/,
    'startMatchGameplay'
  );

  assert.ok(
    /BotController\.createConfigForDifficulty\(\s*ClientConfig\.BOT_DIFFICULTY_PRESETS,\s*selectedBotDifficulty\s*\)/.test(
      startMatchGameplayBlock
    ),
    'esperava BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, selectedBotDifficulty)'
  );
  assert.ok(
    /BotMatchController\.createBotMatch\(\{[^]*?config: botConfig,/.test(startMatchGameplayBlock),
    'a config resolvida precisa ser repassada para BotMatchController.createBotMatch (config: botConfig)'
  );
});

DIFFICULTIES.forEach((difficulty) => {
  test(`selecionar ${difficulty} produz um Bot com o preset EXATO de ClientConfig.BOT_DIFFICULTY_PRESETS.${difficulty} (mesmo caminho de startMatchGameplay)`, () => {
    MatchTimelineManager.clear();
    const timeline = MatchTimelineManager.ensureTimeline(NOTE_PARAMS);

    // Reproduz exatamente o que startMatchGameplay faz para o Bot,
    // usando o identificador que a tela de selecao produziria
    // (ClientConfig.BOT_DIFFICULTY.EASY/MEDIUM/HARD -- nunca uma
    // string solta inventada aqui).
    const selectedBotDifficulty = ClientConfig.BOT_DIFFICULTY[difficulty];
    assert.strictEqual(selectedBotDifficulty, difficulty, 'identificador estavel precisa bater com a chave do preset');

    const botConfig = BotController.createConfigForDifficulty(
      ClientConfig.BOT_DIFFICULTY_PRESETS,
      selectedBotDifficulty
    );

    assert.deepStrictEqual(
      botConfig,
      { ...ClientConfig.BOT_DIFFICULTY_PRESETS[difficulty] },
      `a config resolvida para ${difficulty} precisa ser EXATAMENTE o preset correspondente`
    );

    const botMatch = BotMatchController.createBotMatch({
      timeline,
      config: botConfig,
      windows: WINDOWS,
      scoreValues: SCORE_VALUES,
      comboMultiplierTiers: COMBO_TIERS,
      penalties: PENALTIES,
    });

    assert.strictEqual(botMatch.config.reactionTimeMs, ClientConfig.BOT_DIFFICULTY_PRESETS[difficulty].reactionTimeMs);
    assert.strictEqual(botMatch.config.mistakeChance, ClientConfig.BOT_DIFFICULTY_PRESETS[difficulty].mistakeChance);

    MatchTimelineManager.clear();
  });
});

test('dificuldades diferentes produzem Bots com comportamento diferente (nenhuma delas cai no DEFAULT_CONFIG por engano)', () => {
  MatchTimelineManager.clear();
  const timeline = MatchTimelineManager.ensureTimeline(NOTE_PARAMS);

  const configs = DIFFICULTIES.map((difficulty) =>
    BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, difficulty)
  );

  // Nenhum dos tres deve bater com o DEFAULT_CONFIG (reactionTimeMs
  // 120 / judgementOffsetMs 0 / mistakeChance 0) -- garante que a
  // tela de selecao realmente influencia o Bot, em vez de sempre
  // usar o comportamento padrao antigo.
  const DEFAULT_LIKE = { reactionTimeMs: 120, judgementOffsetMs: 0, mistakeChance: 0 };
  configs.forEach((config, index) => {
    assert.ok(
      config.reactionTimeMs !== DEFAULT_LIKE.reactionTimeMs || config.mistakeChance !== DEFAULT_LIKE.mistakeChance,
      `${DIFFICULTIES[index]}: nao deveria coincidir com DEFAULT_CONFIG`
    );
  });

  MatchTimelineManager.clear();
});

// =====================================================================
// BLOCO E -- IDENTIFICACAO DO BOT NA PARTIDA ("BOT — <DIFICULDADE>")
// =====================================================================

test('UIController.setBotMode(true, difficulty) mostra "BOT — FÁCIL" / "BOT — MÉDIO" / "BOT — DIFÍCIL" na area do player2', () => {
  withFreshUIController((UIController, doc) => {
    UIController.setBotMode(true, 'EASY');
    assert.strictEqual(doc._elements['player2-name'].textContent, 'BOT — FÁCIL');

    UIController.setBotMode(true, 'MEDIUM');
    assert.strictEqual(doc._elements['player2-name'].textContent, 'BOT — MÉDIO');

    UIController.setBotMode(true, 'HARD');
    assert.strictEqual(doc._elements['player2-name'].textContent, 'BOT — DIFÍCIL');
  });
});

test('UIController.setBotMode(false) devolve o rotulo original do player2, mesmo depois de uma dificuldade ter sido exibida', () => {
  withFreshUIController((UIController, doc) => {
    const original = doc._elements['player2-name'].textContent;
    UIController.setBotMode(true, 'HARD');
    assert.strictEqual(doc._elements['player2-name'].textContent, 'BOT — DIFÍCIL');

    UIController.setBotMode(false);
    assert.strictEqual(doc._elements['player2-name'].textContent, original);
  });
});

test('UIController.setBotMode(true) sem difficulty (compatibilidade) continua mostrando so "BOT"', () => {
  withFreshUIController((UIController, doc) => {
    UIController.setBotMode(true);
    assert.strictEqual(doc._elements['player2-name'].textContent, 'BOT');
  });
});

// =====================================================================
// BLOCO F -- NAO AFETA SOLO / MULTIPLAYER / MODO TESTE
// =====================================================================

test('"Jogar Sozinho" nunca abre a tela de dificuldade do Bot (so garante o reset de selectedBotDifficulty, igual a isBotMode/botMatch)', () => {
  const soloHandlerBlock = extractBlock(
    /document\.getElementById\('btn-play-solo'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-play-solo'
  );

  assert.ok(
    !soloHandlerBlock.includes('showBotDifficultySelection'),
    'Solo nunca deve abrir a tela de selecao de dificuldade do Bot'
  );
  assert.ok(
    soloHandlerBlock.includes('selectedBotDifficulty = null'),
    'Solo precisa garantir que nenhuma dificuldade de Bot escolhida antes sobrevive (mesmo padrao de isBotMode/botMatch)'
  );
  assert.ok(soloHandlerBlock.includes('isSoloMode = true'), 'Solo precisa continuar ligando isSoloMode normalmente');
});

test('"Criar sala" / "Entrar na sala" (multiplayer) limpam selectedBotDifficulty, nunca o utilizam para a partida', () => {
  const createRoomBlock = extractBlock(
    /document\.getElementById\('btn-create-room'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-create-room'
  );
  const joinRoomBlock = extractBlock(
    /document\.getElementById\('btn-join-room'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-join-room'
  );

  [createRoomBlock, joinRoomBlock].forEach((block) => {
    assert.ok(
      block.includes('selectedBotDifficulty = null'),
      'multiplayer precisa garantir que nenhuma dificuldade de Bot escolhida antes sobrevive'
    );
  });
});

test('Multiplayer real (dois jogadores reais) continua funcionando de ponta a ponta, sem nenhuma influencia da dificuldade do Bot', () => {
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

  [...wsPlayer1.sent, ...wsPlayer2.sent].forEach((m) => {
    assert.ok(!('botDifficulty' in m), 'nenhuma mensagem de multiplayer deve carregar campo de dificuldade do Bot');
  });
});

test('Modo Teste (LocalServerSimulator) continua reproduzindo normalmente o fluxo Solo, sem nenhum campo de dificuldade de Bot', () => {
  const messages = [];
  const conn = LocalServerSimulator.createLocalConnection({ onMessage: (m) => messages.push(m) });
  conn.connect();
  conn.send('start_solo_match');

  const matchReady = messages.find((m) => m.type === 'match_ready');
  assert.ok(matchReady, 'Modo Teste precisa continuar completando o fluxo ate match_ready');
  assert.ok(!('botDifficulty' in matchReady.match), 'match_ready do Modo Teste nao deve carregar dificuldade de Bot');
});

test('Solo (GameplayEngine + PlayerState) continua funcionando normalmente, com a tela de dificuldade do Bot carregada', () => {
  MatchTimelineManager.clear();
  const timeline = MatchTimelineManager.ensureTimeline(NOTE_PARAMS);
  const playerState = PlayerState.createPlayerState();

  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers: COMBO_TIERS,
    penalties: PENALTIES,
    sendEvent: () => {},
  });

  const firstNote = timeline[0];
  engine.handleKeyPress(firstNote.lane, firstNote.time);

  assert.ok(playerState.score > 0, 'Solo precisa continuar pontuando normalmente');
  MatchTimelineManager.clear();
});

console.log(`\n${passed} teste(s) passaram, ${failed} falharam.`);

// =====================================================================
// DOM falso minimo para UIController (mesmo padrao de
// tests/botMode14C.test.js#makeFakeUIDocument), com o elemento novo
// desta parte (bot-difficulty-panel).
// =====================================================================
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
    querySelectorAll: () => [],
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
    'bot-difficulty-panel': makeFakeElement({ classes: ['hidden'] }),
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
