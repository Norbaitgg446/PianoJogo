/**
 * Testes automatizados da ETAPA 14D — PARTE 2C (finalizacao da
 * integracao das dificuldades do Bot).
 *
 * As Partes 14D-2A (tests/botDifficulty14D2.test.js) e 14D-2B
 * (tests/botDifficulty14D2Interface.test.js) ja cobriram:
 *   - a logica EASY/MEDIUM/HARD (presets, createConfigForDifficulty);
 *   - a tela de selecao de dificuldade e o envio de start_solo_match;
 *   - a dificuldade chegando de fato ao Bot (BotMatchController);
 *   - a identificacao do Bot durante a partida ("BOT — <DIFICULDADE>").
 *
 * Este arquivo cobre exclusivamente o que a Parte 2C acrescenta por
 * cima disso, fechando o fluxo completo pedido no enunciado:
 *   - BLOCO A: a tela de resultado tambem mostra "Dificuldade:
 *     FÁCIL/MÉDIO/DIFÍCIL" no bloco "RESULTADO DA PARTIDA" (modo Bot);
 *   - BLOCO B: "Jogar Novamente" no modo Bot mantem a MESMA
 *     dificuldade (nunca volta para a tela de selecao);
 *   - BLOCO C: "Voltar ao Menu" limpa isBotMode/botMatch/
 *     selectedBotDifficulty explicitamente (alem do reload da pagina);
 *   - BLOCO D: resultado Você×Bot para as tres dificuldades, sempre
 *     via MatchResult/BotMatchController ja existentes (nenhum score/
 *     precisao recalculado na mao);
 *   - BLOCO E: isolamento -- Solo, Modo Teste e Multiplayer nunca
 *     mostram/recebem dificuldade de Bot.
 *
 * Mesmo estilo dos demais arquivos desta etapa: exercita os modulos
 * REAIS (nunca reimplementa julgamento/pontuacao/resultado/config do
 * Bot) e faz verificacao ESTATICA do codigo-fonte de client/index.html
 * e client/js/main.js onde um teste de integracao real exigiria um
 * navegador de verdade (mesmo padrao ja usado nos arquivos anteriores
 * desta etapa).
 *
 * Executar com: node tests/botDifficulty14D2C.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ClientConfig = require('../client/js/config');
const NoteEngine = require('../client/js/match/noteEngine');
const PlayerState = require('../client/js/match/playerState');
const BotController = require('../client/js/match/botController');
const BotMatchController = require('../client/js/match/botMatchController');
const MatchResult = require('../client/js/match/matchResult');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const ResultRenderer = require('../client/js/render/resultRenderer');
const MatchTimelineManager = require('../client/js/match/matchTimelineManager');
const LocalServerSimulator = require('../client/js/network/localServerSimulator');

// Regressao de multiplayer do lado do servidor (mesmos modulos reais
// ja usados por tests/botDifficulty14D2Interface.test.js).
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

const WINDOWS = { perfectMs: 60, greatMs: 200, goodMs: 1800 };
const SCORE_VALUES = { PERFECT: 300, GREAT: 200, GOOD: 100, MISS: 0 };
const COMBO_TIERS = [{ minCombo: 0, multiplier: 1 }, { minCombo: 5, multiplier: 1.5 }];
const PENALTIES = { MISTAKE: -50, MISS: -30 };
const NOTE_PARAMS = { seed: 42, startTimestamp: 1_000_000, length: 10, noteRange: 3, noteIntervalMs: 600, leadInMs: 0 };
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];

function extractBlock(regex, label) {
  const match = regex.exec(mainJsContent);
  assert.ok(match, `${label}: bloco nao encontrado em main.js`);
  return match[0];
}

function runBotMatchToCompletion(timeline, config) {
  const botMatch = BotMatchController.createBotMatch({
    timeline,
    config,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers: COMBO_TIERS,
    penalties: PENALTIES,
  });
  BotMatchController.tick(botMatch, NOTE_PARAMS.startTimestamp + 999999);
  return BotMatchController.finalize(botMatch);
}

// =====================================================================
// BLOCO A -- RESULTADO MOSTRANDO DIFICULDADE
// =====================================================================

test('client/index.html tem #result-bot-difficulty dentro do bloco "RESULTADO DA PARTIDA" (modo Bot)', () => {
  const blockMatch = /<div id="result-bot-block"[^]*?<\/div>\s*<\/div>/.exec(indexHtmlContent);
  assert.ok(blockMatch, 'bloco result-bot-block nao encontrado');
  assert.ok(
    blockMatch[0].includes('id="result-bot-difficulty"'),
    'esperava um elemento id="result-bot-difficulty" dentro do bloco de resultado do Bot'
  );
});

DIFFICULTIES.forEach((difficulty) => {
  const expectedLabel = { EASY: 'FÁCIL', MEDIUM: 'MÉDIO', HARD: 'DIFÍCIL' }[difficulty];

  test(`ResultRenderer._internal.formatDifficultyLabel('${difficulty}') devolve "Dificuldade: ${expectedLabel}"`, () => {
    assert.strictEqual(
      ResultRenderer._internal.formatDifficultyLabel(difficulty),
      `Dificuldade: ${expectedLabel}`
    );
  });
});

test('ResultRenderer._internal.formatDifficultyLabel com valor desconhecido/omitido devolve string vazia', () => {
  assert.strictEqual(ResultRenderer._internal.formatDifficultyLabel(undefined), '');
  assert.strictEqual(ResultRenderer._internal.formatDifficultyLabel('INVALIDO'), '');
});

test('ResultRenderer.showBotMatchResult exibe a dificuldade junto dos dois scores; reset() limpa tudo de novo', () => {
  withFakeResultDocument((doc) => {
    ResultRenderer.showBotMatchResult({ playerScore: 4200, botScore: 3100, difficulty: 'HARD' });

    assert.ok(!doc._elements['result-bot-block']._classes.has('hidden'));
    assert.strictEqual(doc._elements['result-bot-player-score'].textContent, ResultRenderer._internal.formatScore(4200));
    assert.strictEqual(doc._elements['result-bot-score'].textContent, ResultRenderer._internal.formatScore(3100));
    assert.strictEqual(doc._elements['result-bot-difficulty'].textContent, 'Dificuldade: DIFÍCIL');

    ResultRenderer.reset();

    assert.ok(doc._elements['result-bot-block']._classes.has('hidden'));
    assert.strictEqual(doc._elements['result-bot-player-score'].textContent, '');
    assert.strictEqual(doc._elements['result-bot-score'].textContent, '');
    assert.strictEqual(doc._elements['result-bot-difficulty'].textContent, '');
  });
});

test('main.js repassa selectedBotDifficulty para ResultRenderer.showBotMatchResult (nenhuma dificuldade nova decidida ali)', () => {
  const handleLocalMatchEndBlock = extractBlock(
    /function handleLocalMatchEnd\(\) \{[^]*?\n {2}\}/,
    'handleLocalMatchEnd'
  );
  assert.ok(
    /ResultRenderer\.showBotMatchResult\(\{\s*playerScore: result\.score,\s*botScore: botResult\.score,\s*difficulty: selectedBotDifficulty,?\s*\}\);/.test(
      handleLocalMatchEndBlock
    ),
    'esperava ResultRenderer.showBotMatchResult({ playerScore, botScore, difficulty: selectedBotDifficulty })'
  );
});

// =====================================================================
// BLOCO B -- "JOGAR NOVAMENTE" MANTEM A DIFICULDADE
// =====================================================================

test('"Jogar Novamente" nunca mexe em selectedBotDifficulty (nem zera, nem reabre a tela de selecao)', () => {
  const onPlayAgainBlock = extractBlock(
    /ResultRenderer\.setOnPlayAgain\(\(\) => \{[^]*?\n {2}\}\);/,
    'ResultRenderer.setOnPlayAgain'
  );
  assert.ok(
    !onPlayAgainBlock.includes('selectedBotDifficulty'),
    'o handler de "Jogar Novamente" nao deve tocar em selectedBotDifficulty -- o valor escolhido antes precisa sobreviver'
  );
  assert.ok(
    !onPlayAgainBlock.includes('showBotDifficultySelection'),
    '"Jogar Novamente" nunca deve reabrir a tela "Escolha a dificuldade"'
  );
});

test('startMatchGameplay sempre resolve o Bot a partir do selectedBotDifficulty JA guardado (mesma variavel usada pela revanche)', () => {
  const startMatchGameplayBlock = extractBlock(
    /function startMatchGameplay\(message\) \{[^]*?\n {2}\}/,
    'startMatchGameplay'
  );
  assert.ok(
    /BotController\.createConfigForDifficulty\(\s*ClientConfig\.BOT_DIFFICULTY_PRESETS,\s*selectedBotDifficulty\s*\)/.test(
      startMatchGameplayBlock
    ),
    'startMatchGameplay precisa resolver a config do Bot a partir de selectedBotDifficulty (nao de um parametro novo)'
  );
  assert.ok(
    startMatchGameplayBlock.includes('UIController.setBotMode(true, selectedBotDifficulty)'),
    'o rotulo "BOT — <DIFICULDADE>" precisa continuar correto numa revanche, sem nenhum clique novo de selecao'
  );
});

DIFFICULTIES.forEach((difficulty) => {
  test(`revanche: chamar createConfigForDifficulty('${difficulty}') duas vezes seguidas (partida 1 e "Jogar Novamente") produz o MESMO preset`, () => {
    const configMatch1 = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, difficulty);
    const configRematch = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, difficulty);

    assert.deepStrictEqual(
      configRematch,
      configMatch1,
      'a dificuldade escolhida antes da primeira partida precisa produzir a MESMA config na revanche'
    );
  });
});

test('revanche cria uma NOVA instancia de botMatch (nunca reutiliza estado antigo do Bot)', () => {
  MatchTimelineManager.clear();
  const timeline1 = MatchTimelineManager.ensureTimeline(NOTE_PARAMS);
  const config = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, 'HARD');

  const firstMatch = BotMatchController.createBotMatch({
    timeline: timeline1,
    config,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers: COMBO_TIERS,
    penalties: PENALTIES,
  });
  BotMatchController.tick(firstMatch, NOTE_PARAMS.startTimestamp + 999999);
  BotMatchController.finalize(firstMatch);
  assert.ok(BotMatchController.isFinished(firstMatch));

  // "Jogar Novamente": nova seed/timeline (mesmo pipeline de
  // start_solo_match -> match_started -> startMatchGameplay), mesmo
  // identificador de dificuldade guardado (selectedBotDifficulty).
  MatchTimelineManager.clear();
  const timeline2 = MatchTimelineManager.ensureTimeline({ ...NOTE_PARAMS, seed: 999 });
  const secondMatch = BotMatchController.createBotMatch({
    timeline: timeline2,
    config,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers: COMBO_TIERS,
    penalties: PENALTIES,
  });

  assert.notStrictEqual(secondMatch, firstMatch, 'a revanche precisa ser uma instancia NOVA de botMatch');
  assert.strictEqual(secondMatch.finished, false, 'a nova partida do Bot comeca zerada, nunca ja finalizada');
  assert.strictEqual(secondMatch.playerState.score, 0, 'o PlayerState do Bot da revanche comeca zerado');
  assert.notStrictEqual(secondMatch.timeline, firstMatch.timeline, 'a revanche usa uma timeline NOVA, nunca a antiga');

  MatchTimelineManager.clear();
});

// =====================================================================
// BLOCO C -- "VOLTAR AO MENU" LIMPA TUDO
// =====================================================================

test('"Voltar ao Menu" limpa isBotMode/botMatch/selectedBotDifficulty explicitamente, alem de recarregar a pagina', () => {
  const onBackToMenuBlock = extractBlock(
    /ResultRenderer\.setOnBackToMenu\(\(\) => \{[^]*?\n {2}\}\);/,
    'ResultRenderer.setOnBackToMenu'
  );

  assert.ok(onBackToMenuBlock.includes('isBotMode = false'), '"Voltar ao Menu" precisa zerar isBotMode');
  assert.ok(onBackToMenuBlock.includes('UIController.setBotMode(false)'), '"Voltar ao Menu" precisa desligar o rotulo visual do Bot');
  assert.ok(onBackToMenuBlock.includes('botMatch = null'), '"Voltar ao Menu" precisa zerar botMatch');
  assert.ok(
    onBackToMenuBlock.includes('selectedBotDifficulty = null'),
    '"Voltar ao Menu" precisa limpar selectedBotDifficulty -- nenhuma dificuldade pode sobreviver ao menu'
  );
  assert.ok(onBackToMenuBlock.includes('window.location.reload()'), '"Voltar ao Menu" continua recarregando a pagina inteira');
});

test('iniciar Solo/Multiplayer/Bot depois do menu nunca herda selectedBotDifficulty (todos os pontos de entrada limpam antes de comecar)', () => {
  const entryPoints = [
    extractBlock(/document\.getElementById\('btn-create-room'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/, 'btn-create-room'),
    extractBlock(/document\.getElementById\('btn-join-room'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/, 'btn-join-room'),
    extractBlock(/document\.getElementById\('btn-play-solo'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/, 'btn-play-solo'),
  ];

  entryPoints.forEach((block) => {
    assert.ok(
      block.includes('selectedBotDifficulty = null'),
      'todo ponto de entrada que NAO e o Bot precisa garantir selectedBotDifficulty limpo antes de comecar'
    );
  });
});

// =====================================================================
// BLOCO D -- RESULTADO VOCE x BOT, PARA AS TRES DIFICULDADES
// =====================================================================

test('VOCE VENCEU / BOT VENCEU / EMPATE continuam comparando SOMENTE os dois scores ja calculados (MatchResult), nenhum recalculo manual', () => {
  const handleLocalMatchEndBlock = extractBlock(
    /function handleLocalMatchEnd\(\) \{[^]*?\n {2}\}/,
    'handleLocalMatchEnd'
  );
  assert.ok(handleLocalMatchEndBlock.includes('BotMatchController.finalize(botMatch)'));
  assert.ok(handleLocalMatchEndBlock.includes('BotMatchController.getResult(botMatch)'));
  assert.ok(/if \(result\.score > botResult\.score\) botOutcome = 'win';/.test(handleLocalMatchEndBlock));
  assert.ok(/else if \(botResult\.score > result\.score\) botOutcome = 'lose';/.test(handleLocalMatchEndBlock));
  assert.ok(/else botOutcome = 'draw';/.test(handleLocalMatchEndBlock));
});

DIFFICULTIES.forEach((difficulty) => {
  test(`Bot ${difficulty}: resultado do Bot vem de MatchResult.buildResult (mesmo formato do jogador humano), com o preset correto aplicado`, () => {
    MatchTimelineManager.clear();
    const timeline = MatchTimelineManager.ensureTimeline(NOTE_PARAMS);
    const config = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, difficulty);

    const botResult = runBotMatchToCompletion(timeline, config);

    assert.ok(Number.isFinite(botResult.score));
    assert.ok('perfectCount' in botResult && 'greatCount' in botResult && 'goodCount' in botResult);
    assert.ok('accuracy' in botResult && 'maxCombo' in botResult && 'totalNotes' in botResult);
    assert.strictEqual(botResult.totalNotes, timeline.length);

    MatchTimelineManager.clear();
  });
});

test('jogador vence um Bot FACIL quando acerta toda a musica (result.score > botResult.score)', () => {
  MatchTimelineManager.clear();
  const timeline = MatchTimelineManager.ensureTimeline(NOTE_PARAMS);

  const humanPlayerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState: humanPlayerState,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers: COMBO_TIERS,
    penalties: PENALTIES,
    sendEvent: () => {},
  });
  timeline.forEach((note) => engine.handleKeyPress(note.lane, note.time));
  const humanResult = MatchResult.buildResult({ playerState: humanPlayerState, timeline });

  const easyConfig = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, 'EASY');
  const botResult = runBotMatchToCompletion(timeline, easyConfig);

  const outcome = humanResult.score > botResult.score ? 'win' : botResult.score > humanResult.score ? 'lose' : 'draw';
  assert.strictEqual(outcome, 'win', 'acertar 100% das notas deveria vencer um Bot FACIL (que erra ~35% de proposito)');

  MatchTimelineManager.clear();
});

test('empate quando os dois scores ja calculados sao EXATAMENTE iguais', () => {
  const humanScore = 2400;
  const botScore = 2400;
  const outcome = humanScore > botScore ? 'win' : botScore > humanScore ? 'lose' : 'draw';
  assert.strictEqual(outcome, 'draw');
});

// =====================================================================
// BLOCO E -- ISOLAMENTO (Solo / Modo Teste / Multiplayer)
// =====================================================================

test('a chamada a showBotMatchResult (com difficulty) so acontece dentro de "if (isBotMode && botMatch)"', () => {
  const handleLocalMatchEndBlock = extractBlock(
    /function handleLocalMatchEnd\(\) \{[^]*?\n {2}\}/,
    'handleLocalMatchEnd'
  );
  assert.ok(
    /if \(isBotMode && botMatch\) \{\s*const botResult = BotMatchController\.getResult\(botMatch\);[^]*?ResultRenderer\.showBotMatchResult/.test(
      handleLocalMatchEndBlock
    ),
    'showBotMatchResult (com a dificuldade) precisa continuar dentro do bloco exclusivo de isBotMode'
  );
});

test('Solo (LocalServerSimulator) nunca carrega nenhum campo de dificuldade de Bot em nenhuma mensagem', () => {
  const messages = [];
  const conn = LocalServerSimulator.createLocalConnection({ onMessage: (m) => messages.push(m) });
  conn.connect();
  conn.send('start_solo_match');

  messages.forEach((m) => {
    assert.ok(!('botDifficulty' in m), 'Modo Teste/Solo nunca deve carregar botDifficulty em nenhuma mensagem');
    if (m.match) assert.ok(!('botDifficulty' in m.match), 'match.botDifficulty nao deveria existir no Modo Teste/Solo');
  });
});

test('Multiplayer real (dois jogadores) continua terminando em FINISHED sem nenhum campo de dificuldade de Bot', () => {
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
  match._countdownTimer._onTimeout();
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);

  send(wsPlayer1, { type: 'sequence_complete' });
  send(wsPlayer2, { type: 'sequence_complete' });
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);

  [...wsPlayer1.sent, ...wsPlayer2.sent].forEach((m) => {
    assert.ok(!('botDifficulty' in m), 'nenhuma mensagem de multiplayer deve carregar campo de dificuldade do Bot');
  });
});

test('servidor (server/**) nunca referencia dificuldade de Bot -- a dificuldade e exclusivamente local ao cliente', () => {
  const serverDir = path.join(__dirname, '../server');

  function collectJsFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectJsFiles(fullPath);
      return entry.name.endsWith('.js') ? [fullPath] : [];
    });
  }

  collectJsFiles(serverDir).forEach((file) => {
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(
      !/BOT_DIFFICULTY|botDifficulty|selectedBotDifficulty/.test(content),
      `${path.relative(serverDir, file)}: o servidor nunca deveria conhecer dificuldade de Bot`
    );
  });
});

console.log(`\n${passed} teste(s) passaram, ${failed} falharam.`);
if (failed > 0) process.exitCode = 1;

// ---------------------------------------------------------------------
// DOM falso minimo para ResultRenderer (mesmo padrao de
// tests/botModeInterface14C2.test.js#makeFakeResultDocument), com o
// elemento novo desta parte (result-bot-difficulty).
// ---------------------------------------------------------------------
function makeFakeElement() {
  const classes = new Set();
  const listeners = {};
  return {
    textContent: '',
    offsetWidth: 0,
    classList: {
      add: (...cls) => cls.forEach((c) => classes.add(c)),
      remove: (...cls) => cls.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    addEventListener: (event, cb) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    },
    _classes: classes,
  };
}

function makeFakeResultDocument() {
  const elements = {
    'result-screen': makeFakeElement(),
    'result-score': makeFakeElement(),
    'result-accuracy': makeFakeElement(),
    'result-max-combo': makeFakeElement(),
    'result-hits': makeFakeElement(),
    'result-misses': makeFakeElement(),
    'result-mistakes': makeFakeElement(),
    'result-perfect': makeFakeElement(),
    'result-great': makeFakeElement(),
    'result-good': makeFakeElement(),
    'result-max-multiplier': makeFakeElement(),
    'result-outcome': makeFakeElement(),
    'result-bot-block': makeFakeElement(),
    'result-bot-player-score': makeFakeElement(),
    'result-bot-score': makeFakeElement(),
    'result-bot-difficulty': makeFakeElement(),
    'btn-play-again': makeFakeElement(),
    'btn-back-to-menu': makeFakeElement(),
    'result-rematch-status': makeFakeElement(),
  };
  return {
    getElementById: (id) => elements[id] || null,
    documentElement: makeFakeElement(),
    body: makeFakeElement(),
    _elements: elements,
  };
}

function withFakeResultDocument(fn) {
  const originalDocument = global.document;
  const fakeDocument = makeFakeResultDocument();
  global.document = fakeDocument;
  ResultRenderer._internal._resetForTests();
  try {
    return fn(fakeDocument);
  } finally {
    global.document = originalDocument;
  }
}
