/**
 * Testes automatizados da ETAPA 14C — PARTE 2 (interface e
 * funcionamento visivel do modo "Jogar contra Bot").
 *
 * A Parte 1 (tests/botMode14C.test.js) ja cobre a entrada do modo Bot
 * (botao, isBotMode, BotMatchController criado com a MESMA
 * timeline/relogio, PlayerStates independentes, area visual do
 * player2). Este arquivo cobre o que a Parte 2 acrescenta:
 *
 *   - feedback visual de CADA acerto/erro do Bot (BotMatchController.tick
 *     devolvendo as decisoes executadas na chamada, main.js repassando
 *     para FeedbackRenderer);
 *   - score do Bot exibido na interface (ja conectado por main.js);
 *   - resultado do modo Bot (VOCE VENCEU / BOT VENCEU / EMPATE) e o
 *     bloco "RESULTADO DA PARTIDA" (seu score x score do Bot), via
 *     ResultRenderer.setBotMatchOutcome/showBotMatchResult, calculados
 *     comparando os DOIS resultados ja prontos (MatchResult humano +
 *     BotMatchController/MatchResult do Bot -- nenhuma formula nova);
 *   - "Jogar Novamente" no modo Bot inicia uma NOVA partida contra Bot;
 *   - "Voltar ao Menu" nunca deixa isBotMode/botMatch vazarem;
 *   - Solo / Multiplayer / Modo Teste continuam funcionando.
 *
 * Mesmo estilo dos demais arquivos desta etapa: exercita os modulos
 * REAIS (nunca reimplementa julgamento/pontuacao/resultado) e faz
 * verificacao estatica do codigo-fonte de client/index.html e
 * client/js/main.js onde um teste de integracao real exigiria um
 * navegador de verdade (mesmo padrao ja usado em botMode14C.test.js /
 * resultInterfaceFlow13F.test.js).
 *
 * Executar com: node tests/botModeInterface14C2.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const NoteEngine = require('../client/js/match/noteEngine');
const PlayerState = require('../client/js/match/playerState');
const BotController = require('../client/js/match/botController');
const BotMatchController = require('../client/js/match/botMatchController');
const MatchResult = require('../client/js/match/matchResult');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const ResultRenderer = require('../client/js/render/resultRenderer');
const LocalServerSimulator = require('../client/js/network/localServerSimulator');

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

const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');
const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');
const botMatchControllerContent = fs.readFileSync(botMatchControllerPath, 'utf8');

function stripComments(source) {
  return source.replace(/\/\*[^]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const WINDOWS = { perfectMs: 60, greatMs: 150, goodMs: 300 };
const SCORE_VALUES = { PERFECT: 300, GREAT: 200, GOOD: 100, MISS: 0 };
const COMBO_TIERS = [{ minCombo: 0, multiplier: 1 }, { minCombo: 5, multiplier: 1.5 }];
const PENALTIES = { MISTAKE: -50, MISS: -30 };
const NOTE_PARAMS = { seed: 42, startTimestamp: 1_000_000, length: 6, noteRange: 3, noteIntervalMs: 600, leadInMs: 0 };

function extractBlock(regex, label, source = mainJsContent) {
  const match = regex.exec(source);
  assert.ok(match, `${label}: bloco nao encontrado`);
  return match[0];
}

// =====================================================================
// BLOCO A -- FEEDBACK VISUAL DO BOT (score/combo/julgamento)
// =====================================================================

test('BotMatchController.tick devolve as decisoes executadas NESTA chamada (mesmo padrao de processExpiredNotes)', () => {
  const timeline = NoteEngine.generateNoteTimeline(NOTE_PARAMS);
  const config = BotController.createConfig({ reactionTimeMs: 10 }); // dentro de perfectMs
  const botMatch = BotMatchController.createBotMatch({
    timeline,
    config,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers: COMBO_TIERS,
    penalties: PENALTIES,
  });

  const actionTime0 = BotController.computeActionTime(timeline[0], config);
  const executed = BotMatchController.tick(botMatch, actionTime0);

  assert.strictEqual(executed.length, 1, 'so a decisao da primeira nota deveria ter sido executada');
  assert.strictEqual(executed[0].noteId, timeline[0].id);
  assert.strictEqual(executed[0].outcome, 'PERFECT');
});

test('tick() chamado sem nenhuma decisao nova pronta devolve lista vazia (nunca reaplica/reexibe)', () => {
  const timeline = NoteEngine.generateNoteTimeline(NOTE_PARAMS);
  const config = BotController.createConfig({ reactionTimeMs: 10 });
  const botMatch = BotMatchController.createBotMatch({
    timeline,
    config,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers: COMBO_TIERS,
    penalties: PENALTIES,
  });

  const actionTime0 = BotController.computeActionTime(timeline[0], config);
  BotMatchController.tick(botMatch, actionTime0);
  const secondCall = BotMatchController.tick(botMatch, actionTime0);

  assert.deepStrictEqual(secondCall, [], 'chamar tick() de novo no mesmo horario nao deveria devolver decisoes ja executadas');
});

test('tick() nunca devolve decisoes depois de finalize() (partida do Bot ja encerrada)', () => {
  const timeline = NoteEngine.generateNoteTimeline(NOTE_PARAMS);
  const botMatch = BotMatchController.createBotMatch({
    timeline,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers: COMBO_TIERS,
    penalties: PENALTIES,
  });

  BotMatchController.finalize(botMatch);
  const executed = BotMatchController.tick(botMatch, NOTE_PARAMS.startTimestamp + 999999);

  assert.deepStrictEqual(executed, []);
});

const botMatchControllerCodeOnly = stripComments(botMatchControllerContent);

test('BotMatchController.tick ainda nunca chama Date.now() (so recebe o relogio de fora), mesmo devolvendo as decisoes agora', () => {
  assert.ok(!botMatchControllerCodeOnly.includes('Date.now()'));
});

test('o loop de gameplay repassa cada decisao executada do Bot para FeedbackRenderer (julgamento + flash), sem recalcular nada', () => {
  const loopBlock = extractBlock(/function loop\(\) \{[^]*?\n {4}\}/, 'loop de requestAnimationFrame');
  const loopCodeOnly = stripComments(loopBlock);

  assert.ok(
    /const botExecutedNow = BotMatchController\.tick\(botMatch, getSyncedNow\(\)\)/.test(loopCodeOnly),
    'o loop precisa guardar o retorno de BotMatchController.tick (decisoes executadas nesta chamada)'
  );
  assert.ok(
    /botExecutedNow\.forEach\(\(decision\) => \{[^]*?FeedbackRenderer\.showJudgement\('player2', decision\.outcome\)/.test(loopCodeOnly),
    'cada decisao executada do Bot precisa acionar FeedbackRenderer.showJudgement na area do player2'
  );
  assert.ok(
    loopCodeOnly.includes("FeedbackRenderer.flashNote('player2', decision.noteId, 'HIT')"),
    'acertos do Bot (PERFECT/GREAT/GOOD) precisam acionar um flash de HIT na nota correspondente'
  );
  assert.ok(
    loopCodeOnly.includes("FeedbackRenderer.flashNote('player2', decision.noteId, 'MISS')"),
    'MISS do Bot precisa acionar um flash de MISS na nota correspondente'
  );
});

test('score/combo do Bot continuam sendo exibidos na interface a cada frame (FeedbackRenderer na area do player2)', () => {
  const loopBlock = extractBlock(/function loop\(\) \{[^]*?\n {4}\}/, 'loop de requestAnimationFrame');
  assert.ok(loopBlock.includes("FeedbackRenderer.updateScore('player2', botMatch.playerState.score)"));
  assert.ok(loopBlock.includes("FeedbackRenderer.updateCombo('player2', botMatch.playerState.combo)"));
});

test('area do Bot (player2) e inicializada com o score/combo zerados da NOVA partida ao criar o botMatch', () => {
  const startMatchGameplayBlock = extractBlock(
    /function startMatchGameplay\(message\) \{[^]*?\n {2}\}/,
    'startMatchGameplay'
  );
  assert.ok(startMatchGameplayBlock.includes("FeedbackRenderer.reset('player2')"));
  assert.ok(startMatchGameplayBlock.includes("FeedbackRenderer.updateScore('player2', botMatch.playerState.score)"));
  assert.ok(startMatchGameplayBlock.includes("FeedbackRenderer.updateCombo('player2', botMatch.playerState.combo)"));
});

// =====================================================================
// BLOCO B -- RESULTADO DO MODO BOT (vencedor/perdedor/empate + scores)
// =====================================================================

test('handleLocalMatchEnd finaliza o Bot e compara os DOIS scores ja prontos (nenhuma formula de vencedor nova)', () => {
  const handleLocalMatchEndBlock = extractBlock(
    /function handleLocalMatchEnd\(\) \{[^]*?\n {2}\}/,
    'handleLocalMatchEnd'
  );

  assert.ok(handleLocalMatchEndBlock.includes('BotMatchController.finalize(botMatch)'));
  assert.ok(handleLocalMatchEndBlock.includes('BotMatchController.getResult(botMatch)'));
  assert.ok(
    /if \(result\.score > botResult\.score\) botOutcome = 'win';/.test(handleLocalMatchEndBlock),
    'vitoria do jogador deve comparar result.score (MatchResult humano) com botResult.score (MatchResult do Bot)'
  );
  assert.ok(/else if \(botResult\.score > result\.score\) botOutcome = 'lose';/.test(handleLocalMatchEndBlock));
  assert.ok(/else botOutcome = 'draw';/.test(handleLocalMatchEndBlock));
  assert.ok(handleLocalMatchEndBlock.includes('ResultRenderer.setBotMatchOutcome(botOutcome)'));
  // ETAPA 14D — PARTE 2C: showBotMatchResult agora tambem recebe
  // `difficulty: selectedBotDifficulty` (ver
  // tests/botDifficulty14D2C.test.js para a cobertura dedicada) --
  // aqui so confirmamos que os dois scores continuam sendo repassados
  // exatamente como antes, sem exigir mais a string exata (que mudou
  // de uma linha para varias com a adicao do novo campo).
  assert.ok(handleLocalMatchEndBlock.includes('playerScore: result.score,'));
  assert.ok(handleLocalMatchEndBlock.includes('botScore: botResult.score,'));
  assert.ok(handleLocalMatchEndBlock.includes('ResultRenderer.showBotMatchResult({'));
});

test('a comparacao do resultado do Bot so acontece dentro de "if (isBotMode ...)" (Solo/Multiplayer nunca mostram vencedor/perdedor do Bot)', () => {
  const handleLocalMatchEndBlock = extractBlock(
    /function handleLocalMatchEnd\(\) \{[^]*?\n {2}\}/,
    'handleLocalMatchEnd'
  );
  assert.ok(
    /if \(isBotMode && botMatch\) \{\s*const botResult = BotMatchController\.getResult\(botMatch\);/.test(
      handleLocalMatchEndBlock
    )
  );
});

test('elementos do bloco "RESULTADO DA PARTIDA" (modo Bot) existem em client/index.html, escondidos por padrao', () => {
  assert.ok(/id="result-bot-block"[^>]*class="[^"]*hidden[^"]*"/.test(indexHtmlContent));
  assert.ok(indexHtmlContent.includes('id="result-bot-player-score"'));
  assert.ok(indexHtmlContent.includes('id="result-bot-score"'));
});

test('ResultRenderer.setBotMatchOutcome mostra "VOCE VENCEU"/"BOT VENCEU"/"EMPATE" no MESMO #result-outcome do Multiplayer', () => {
  withFakeResultDocument((doc) => {
    ResultRenderer.setBotMatchOutcome('win');
    assert.strictEqual(doc._elements['result-outcome'].textContent, 'VOCÊ VENCEU');
    assert.ok(doc._elements['result-outcome']._classes.has('result-outcome-win'));

    ResultRenderer.setBotMatchOutcome('lose');
    assert.strictEqual(doc._elements['result-outcome'].textContent, 'BOT VENCEU');
    assert.ok(doc._elements['result-outcome']._classes.has('result-outcome-lose'));
    assert.ok(!doc._elements['result-outcome']._classes.has('result-outcome-win'));

    ResultRenderer.setBotMatchOutcome('draw');
    assert.strictEqual(doc._elements['result-outcome'].textContent, 'EMPATE');
    assert.ok(doc._elements['result-outcome']._classes.has('result-outcome-draw'));

    ResultRenderer.setBotMatchOutcome(null);
    assert.strictEqual(doc._elements['result-outcome'].textContent, '');
    assert.ok(doc._elements['result-outcome']._classes.has('hidden'));
  });
});

test('ResultRenderer.showBotMatchResult exibe os dois scores; hideBotMatchResult (via reset) limpa tudo', () => {
  withFakeResultDocument((doc) => {
    ResultRenderer.showBotMatchResult({ playerScore: 4200, botScore: 3100 });

    assert.ok(!doc._elements['result-bot-block']._classes.has('hidden'));
    assert.strictEqual(doc._elements['result-bot-player-score'].textContent, ResultRenderer._internal.formatScore(4200));
    assert.strictEqual(doc._elements['result-bot-score'].textContent, ResultRenderer._internal.formatScore(3100));

    ResultRenderer.reset();

    assert.ok(doc._elements['result-bot-block']._classes.has('hidden'));
    assert.strictEqual(doc._elements['result-bot-player-score'].textContent, '');
    assert.strictEqual(doc._elements['result-bot-score'].textContent, '');
  });
});

test('resultado do jogador humano (MatchResult) continua correto e independente do resultado do Bot', () => {
  const timeline = NoteEngine.generateNoteTimeline(NOTE_PARAMS);
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
  timeline.slice(0, 2).forEach((note) => engine.handleKeyPress(note.lane, note.time));

  const botMatch = BotMatchController.createBotMatch({
    timeline,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers: COMBO_TIERS,
    penalties: PENALTIES,
  });
  BotMatchController.tick(botMatch, NOTE_PARAMS.startTimestamp + 999999);

  const humanResult = MatchResult.buildResult({ playerState: humanPlayerState, timeline });
  assert.strictEqual(humanResult.hits, 2);
  // O resultado humano nunca inclui nada do PlayerState do Bot.
  assert.notStrictEqual(humanResult.score, BotMatchController.getPlayerState(botMatch).score === humanResult.score);
});

test('resultado do Bot e calculado via MatchResult.buildResult (o MESMO formato do jogador humano, nenhum formato paralelo)', () => {
  const timeline = NoteEngine.generateNoteTimeline(NOTE_PARAMS);
  const botMatch = BotMatchController.createBotMatch({
    timeline,
    config: BotController.createConfig({ reactionTimeMs: 10 }),
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers: COMBO_TIERS,
    penalties: PENALTIES,
  });
  BotMatchController.tick(botMatch, NOTE_PARAMS.startTimestamp + 999999);
  const botResult = BotMatchController.finalize(botMatch);

  assert.ok(Number.isFinite(botResult.score));
  assert.ok('perfectCount' in botResult && 'greatCount' in botResult && 'goodCount' in botResult);
  assert.ok('accuracy' in botResult && 'maxCombo' in botResult && 'maxMultiplier' in botResult);
});

test('jogador vence quando result.score > botResult.score (mesma comparacao usada por main.js)', () => {
  const playerScore = 5000;
  const botScore = 3000;
  const outcome = playerScore > botScore ? 'win' : botScore > playerScore ? 'lose' : 'draw';
  assert.strictEqual(outcome, 'win');
});

test('Bot vence quando botResult.score > result.score', () => {
  const playerScore = 1200;
  const botScore = 3000;
  const outcome = playerScore > botScore ? 'win' : botScore > playerScore ? 'lose' : 'draw';
  assert.strictEqual(outcome, 'lose');
});

test('empate quando os dois scores sao iguais', () => {
  const playerScore = 2000;
  const botScore = 2000;
  const outcome = playerScore > botScore ? 'win' : botScore > playerScore ? 'lose' : 'draw';
  assert.strictEqual(outcome, 'draw');
});

// =====================================================================
// BLOCO C -- "JOGAR NOVAMENTE" / "VOLTAR AO MENU" NO MODO BOT
// =====================================================================

test('"Jogar Novamente" no modo Bot reutiliza o mesmo caminho do Solo (start_solo_match), nunca o handshake de revanche do Multiplayer', () => {
  const onPlayAgainBlock = extractBlock(
    /ResultRenderer\.setOnPlayAgain\(\(\) => \{[^]*?\n {2}\}\);/,
    'ResultRenderer.setOnPlayAgain'
  );
  assert.ok(onPlayAgainBlock.includes('if (isSoloMode)'));
  assert.ok(onPlayAgainBlock.includes("SocketClient.send('start_solo_match')"));
  // isBotMode NUNCA e desligado aqui -- e o que garante que startMatchGameplay
  // (chamado pela proxima match_started) recria um botMatch NOVO.
  assert.ok(!onPlayAgainBlock.includes('isBotMode = false'));
});

test('quando o servidor confirma a nova partida como "solo" (isSoloMode), startMatchGameplay recria o BotMatchController se isBotMode continuar ligado', () => {
  // A propria Etapa 14C Parte 1 ja garante isso (ver botMode14C.test.js,
  // Bloco D) -- aqui so confirmamos que main.js NUNCA reseta isBotMode
  // ao sincronizar match.mode (isso pertenceria so aos botoes/aos
  // resets explicitos de sala/abandono/cancelamento).
  const matchReadyBlock = extractBlock(
    /case 'match_ready':[^]*?\n {8}break;/,
    "case 'match_ready'"
  );
  assert.ok(!matchReadyBlock.includes('isBotMode'));
});

test('"Voltar ao Menu" recarrega a pagina inteira -- nenhum isBotMode/botMatch pode sobreviver a isso', () => {
  const onBackToMenuBlock = extractBlock(
    /ResultRenderer\.setOnBackToMenu\(\(\) => \{[^]*?\n {2}\}\);/,
    'ResultRenderer.setOnBackToMenu'
  );
  assert.ok(onBackToMenuBlock.includes('window.location.reload()'));
});

test('cancelamento/abandono/saida de sala continuam zerando "botMatch = null" (nenhuma instancia orfa do Bot sobrevive)', () => {
  const abandonedBlock = extractBlock(/function handleMatchAbandoned\(isLocalPlayer\) \{[^]*?\n {2}\}/, 'handleMatchAbandoned');
  const leftRoomBlock = extractBlock(/function handleLeftRoom\(\) \{[^]*?\n {2}\}/, 'handleLeftRoom');
  const cancelledBlock = extractBlock(/case 'match_cancelled':[^]*?\n {8}break;/, "case 'match_cancelled'");

  [abandonedBlock, leftRoomBlock, cancelledBlock].forEach((block) => {
    assert.ok(block.includes('botMatch = null'));
  });
});

// =====================================================================
// BLOCO D -- SOLO / MULTIPLAYER / MODO TESTE CONTINUAM FUNCIONANDO
// =====================================================================

test('Solo continua funcionando (GameplayEngine + PlayerState), sem nenhum resultado de Bot misturado', () => {
  const timeline = NoteEngine.generateNoteTimeline(NOTE_PARAMS);
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

  const result = engine.handleKeyPress(timeline[0].lane, timeline[0].time);
  assert.ok(result);
  assert.strictEqual(playerState.hits, 1);
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

test('setMatchOutcome (Multiplayer) e setBotMatchOutcome (Bot) usam rotulos DIFERENTES para "lose", sem interferir um no outro', () => {
  withFakeResultDocument((doc) => {
    ResultRenderer.setMatchOutcome('lose');
    assert.strictEqual(doc._elements['result-outcome'].textContent, 'VOCÊ PERDEU');

    ResultRenderer.setBotMatchOutcome('lose');
    assert.strictEqual(doc._elements['result-outcome'].textContent, 'BOT VENCEU');
  });
});

// ---------------------------------------------------------------------
// DOM falso minimo para ResultRenderer (mesmo padrao de
// tests/resultRenderer.test.js#makeFakeDocument), com os elementos
// novos desta parte (bloco "RESULTADO DA PARTIDA" do modo Bot).
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

console.log(`\n${passed} teste(s) passaram, ${failed} falharam.`);
if (failed > 0) process.exitCode = 1;
