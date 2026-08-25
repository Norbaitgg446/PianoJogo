/**
 * ETAPA 15C-1D — Integrar duracao ao Bot.
 *
 * Mesma estrategia de tests/soloMatchDuration15C1C.test.js (que ja
 * cobriu o Solo): como `client/js/main.js` e um script de navegador
 * (nao da para `require`), esta suite combina:
 *
 *   (a) INSPECAO ESTATICA do corpo de `startMatchGameplay` -- confirma
 *       que `resolvedMatchDurationMs` (resolvido uma UNICA vez, mesmo
 *       valor do Solo) e repassado a `BotMatchController.createBotMatch`
 *       como `durationMs`, e que nenhuma segunda tabela/segunda formula
 *       de duracao foi criada para o Bot;
 *
 *   (b) TESTES DE COMPORTAMENTO usando os MESMOS modulos reais
 *       (ClientConfig, MatchDuration, MatchEndDetector, BotController,
 *       BotMatchController, NoteEngine) com os MESMOS argumentos que
 *       `startMatchGameplay` passa quando `isBotMode` e verdadeiro, para
 *       confirmar que a composicao completa (selecao -> ms ->
 *       BotMatchController.createBotMatch -> MatchEndDetector -> fim de
 *       partida) funciona como especificado -- sem reimplementar
 *       nenhuma logica de duracao/Bot aqui (ja testada isoladamente em
 *       matchDuration15A.test.js, matchEndDetectorDuration15C1B.test.js,
 *       botController14A.test.js e botMatchController*.test.js).
 *
 * Executar com: node tests/botMatchDuration15C1D.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ClientConfig = require('../client/js/config');
const MatchDuration = require('../client/js/match/matchDuration');
const MatchEndDetector = require('../client/js/match/matchEndDetector');
const NoteEngine = require('../client/js/match/noteEngine');
const BotController = require('../client/js/match/botController');
const BotMatchController = require('../client/js/match/botMatchController');

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

// =====================================================================
// (a) Inspecao estatica de client/js/main.js
// =====================================================================

const mainJsPath = path.join(__dirname, '../client/js/main.js');
const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');

function extractFunctionBody(source, functionSignatureRegex) {
  const match = functionSignatureRegex.exec(source);
  assert.ok(match, 'funcao nao encontrada em main.js');
  const startIdx = match.index;
  let depth = 0;
  let i = startIdx;
  let bodyStarted = false;
  for (; i < source.length; i++) {
    if (source[i] === '{') {
      depth++;
      bodyStarted = true;
    } else if (source[i] === '}') {
      depth--;
    }
    if (bodyStarted && depth === 0) break;
  }
  return source.slice(startIdx, i + 1);
}

const startMatchGameplayBody = extractFunctionBody(mainJsContent, /function startMatchGameplay\(message\) \{/);

test('startMatchGameplay repassa o durationMs resolvido para BotMatchController.createBotMatch', () => {
  const createBotMatchIdx = startMatchGameplayBody.indexOf('BotMatchController.createBotMatch(');
  assert.ok(createBotMatchIdx !== -1, 'BotMatchController.createBotMatch deveria ser chamado dentro de startMatchGameplay');

  const createBotMatchIdxEnd = startMatchGameplayBody.indexOf('});', createBotMatchIdx);
  const createBotMatchSnippet = startMatchGameplayBody.slice(createBotMatchIdx, createBotMatchIdxEnd);

  assert.ok(
    /durationMs:\s*resolvedMatchDurationMs/.test(createBotMatchSnippet),
    'a chamada a BotMatchController.createBotMatch deveria passar durationMs: resolvedMatchDurationMs'
  );
});

test('o MESMO resolvedMatchDurationMs (nao um segundo calculo) e usado no Bot, no MatchEndDetector e (desde a Etapa 16-2B) na timeline', () => {
  const resolveCalls = (startMatchGameplayBody.match(/MatchDuration\.resolveMatchDuration\(/g) || []).length;
  assert.strictEqual(resolveCalls, 1, 'MatchDuration.resolveMatchDuration deveria ser chamado uma UNICA vez');

  // ETAPA 16-2B: MatchTimelineManager.ensureTimeline passou a receber o
  // MESMO resolvedMatchDurationMs (ver tests/timelineDurationIntegration16_2B.test.js),
  // entao a contagem esperada aqui subiu de 2 para 3 usos -- continua
  // sendo o MESMO valor unico resolvido acima, nunca um segundo calculo.
  const botDurationUsages = (startMatchGameplayBody.match(/durationMs:\s*resolvedMatchDurationMs/g) || []).length;
  assert.strictEqual(
    botDurationUsages,
    3,
    'resolvedMatchDurationMs deveria ser passado exatamente tres vezes: para a timeline (ensureTimeline), para o Bot (createBotMatch) e para o MatchEndDetector'
  );
});

test('a config de dificuldade do Bot (createConfigForDifficulty) continua intocada pela integracao de duracao', () => {
  assert.ok(
    startMatchGameplayBody.includes(
      'BotController.createConfigForDifficulty(\n        ClientConfig.BOT_DIFFICULTY_PRESETS,\n        selectedBotDifficulty\n      )'
    ) || /BotController\.createConfigForDifficulty\(\s*ClientConfig\.BOT_DIFFICULTY_PRESETS,\s*selectedBotDifficulty\s*\)/.test(startMatchGameplayBody),
    'a resolucao de dificuldade do Bot deveria continuar chamando BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, selectedBotDifficulty), sem nenhum parametro de duracao misturado'
  );
});

test('nenhum requestAnimationFrame/timer NOVO foi introduzido: main.js continua com exatamente 2 requestAnimationFrame e zero setTimeout/setInterval', () => {
  const rafCount = (mainJsContent.match(/requestAnimationFrame\(/g) || []).length;
  const timeoutCount = (mainJsContent.match(/setTimeout\(/g) || []).length;
  const intervalCount = (mainJsContent.match(/setInterval\(/g) || []).length;

  assert.strictEqual(rafCount, 2, `esperava exatamente 2 requestAnimationFrame(, encontrou ${rafCount}`);
  assert.strictEqual(timeoutCount, 0, 'main.js nao deveria conter setTimeout(');
  assert.strictEqual(intervalCount, 0, 'main.js nao deveria conter setInterval(');
});

test('BotMatchController.tick continua sendo chamado com getSyncedNow() (o MESMO relogio sincronizado do jogador humano)', () => {
  assert.ok(
    mainJsContent.includes('BotMatchController.tick(botMatch, getSyncedNow())'),
    'BotMatchController.tick deveria continuar recebendo getSyncedNow()'
  );
});

test('checkForEnd continua sendo chamado a partir de um UNICO lugar (nenhuma segunda rotina de finalizacao criada para o Bot)', () => {
  const checkForEndCallers = (mainJsContent.match(/\.checkForEnd\(/g) || []).length;
  assert.strictEqual(checkForEndCallers, 1, 'checkForEnd deveria ser chamado a partir de um UNICO lugar em main.js');
});

// =====================================================================
// (b) Comportamento real: mesma composicao que startMatchGameplay usa
//     quando isBotMode === true
// =====================================================================

const WINDOWS = {
  perfectMs: ClientConfig.JUDGEMENT_WINDOWS.PERFECT_MS,
  greatMs: ClientConfig.JUDGEMENT_WINDOWS.GREAT_MS,
  goodMs: ClientConfig.JUDGEMENT_WINDOWS.GOOD_MS,
};

/**
 * Reproduz, com os modulos REAIS, exatamente a composicao que
 * startMatchGameplay faz quando isBotMode === true:
 *   selectedMatchDuration -> MatchDuration.resolveMatchDuration -> resolvedMatchDurationMs
 *   -> BotMatchController.createBotMatch({ timeline, config, windows, ..., durationMs: resolvedMatchDurationMs })
 *   -> MatchEndDetector.createMatchEndDetector({ timeline, durationMs: resolvedMatchDurationMs, startTime })
 *   -> a cada frame: BotMatchController.tick(botMatch, currentTime) e detector.checkForEnd(currentTime).
 */
function createBotMatchSetup({ selectedMatchDuration, difficulty = 'MEDIUM', startTimestamp = 1_000_000 }) {
  const timeline = NoteEngine.generateNoteTimeline({
    seed: 15104,
    startTimestamp,
    length: 6,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });

  const resolvedMatchDurationMs = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, selectedMatchDuration);

  const botConfig = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, difficulty);

  const botMatch = BotMatchController.createBotMatch({
    timeline,
    config: botConfig,
    windows: WINDOWS,
    scoreValues: ClientConfig.SCORE_VALUES,
    comboMultiplierTiers: ClientConfig.COMBO_MULTIPLIER.TIERS,
    penalties: ClientConfig.PENALTIES,
    durationMs: resolvedMatchDurationMs,
  });

  let matchEndCalls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => matchEndCalls++,
    durationMs: resolvedMatchDurationMs,
    startTime: startTimestamp,
  });

  return {
    timeline,
    botConfig,
    botMatch,
    detector,
    resolvedMatchDurationMs,
    getMatchEndCalls: () => matchEndCalls,
  };
}

// --- 1-4: cada identificador resolve para o ms correto e chega ao Bot ---

test('Bot com "30S" resolve para 30000ms', () => {
  const { resolvedMatchDurationMs } = createBotMatchSetup({ selectedMatchDuration: '30S' });
  assert.strictEqual(resolvedMatchDurationMs, 30000);
});

test('Bot com "1M" resolve para 60000ms', () => {
  const { resolvedMatchDurationMs } = createBotMatchSetup({ selectedMatchDuration: '1M' });
  assert.strictEqual(resolvedMatchDurationMs, 60000);
});

test('Bot com "5M" resolve para 300000ms', () => {
  const { resolvedMatchDurationMs } = createBotMatchSetup({ selectedMatchDuration: '5M' });
  assert.strictEqual(resolvedMatchDurationMs, 300000);
});

test('Bot com "10M" resolve para 600000ms', () => {
  const { resolvedMatchDurationMs } = createBotMatchSetup({ selectedMatchDuration: '10M' });
  assert.strictEqual(resolvedMatchDurationMs, 600000);
});

// --- 5: durationMs correto chegando ao BotMatchController ---

test('o durationMs resolvido chega intacto ao botMatch (botMatch.durationMs) armazenado por BotMatchController', () => {
  const { botMatch, resolvedMatchDurationMs } = createBotMatchSetup({ selectedMatchDuration: '5M' });
  assert.strictEqual(botMatch.durationMs, 300000);
  assert.strictEqual(botMatch.durationMs, resolvedMatchDurationMs);
});

// --- 6-7: termina ao atingir o limite / nao termina antes ---

test('a partida de Bot NAO termina antes do limite de duracao', () => {
  const { detector, getMatchEndCalls } = createBotMatchSetup({ selectedMatchDuration: '30S', startTimestamp: 1_000_000 });
  assert.strictEqual(detector.checkForEnd(1_029_999), false);
  assert.strictEqual(getMatchEndCalls(), 0);
});

test('a partida de Bot termina exatamente ao atingir o limite de duracao (mesmo fluxo de handleLocalMatchEnd, via onMatchEnd)', () => {
  const { detector, getMatchEndCalls } = createBotMatchSetup({ selectedMatchDuration: '30S', startTimestamp: 1_000_000 });
  assert.strictEqual(detector.checkForEnd(1_030_000), true);
  assert.strictEqual(getMatchEndCalls(), 1);
});

test('a partida de Bot termina depois do limite de duracao tambem', () => {
  const { detector, getMatchEndCalls } = createBotMatchSetup({ selectedMatchDuration: '30S', startTimestamp: 1_000_000 });
  assert.strictEqual(detector.checkForEnd(1_045_000), true);
  assert.strictEqual(getMatchEndCalls(), 1);
});

// --- 8: Bot usa o mesmo relogio sincronizado (mesmo currentTime do detector) ---

test('o Bot e o MatchEndDetector avancam sob o MESMO currentTime (mesmo relogio sincronizado, nenhum segundo relogio)', () => {
  const { botMatch, detector } = createBotMatchSetup({ selectedMatchDuration: '10M', startTimestamp: 1_000_000 });

  // Mesmo currentTime passado para os dois (como main.js faz: getSyncedNow()
  // chamado uma vez por frame e reaproveitado para tick() e checkForEnd()).
  const frame1 = 1_000_600;
  BotMatchController.tick(botMatch, frame1);
  detector.checkForEnd(frame1);

  const executedSoFar = botMatch.entries.filter((entry) => entry.executed).length;
  assert.ok(executedSoFar >= 1, 'o Bot deveria ter executado pelo menos uma decisao ate este currentTime');
});

// --- 9: Bot nao cria timer proprio (ja coberto estaticamente, reforcado aqui) ---

test('botMatchController.js (usado pelo Bot) nao contem setTimeout/setInterval/requestAnimationFrame, e so menciona Date.now/performance.now em comentarios (nunca como chamada de codigo)', () => {
  const botMatchControllerPath = path.join(__dirname, '../client/js/match/botMatchController.js');
  const content = fs.readFileSync(botMatchControllerPath, 'utf8');

  ['setTimeout(', 'setInterval(', 'requestAnimationFrame('].forEach((forbidden) => {
    assert.ok(!content.includes(forbidden), `botMatchController.js nao deveria conter "${forbidden}"`);
  });

  // Date.now()/performance.now() podem aparecer em COMENTARIOS
  // explicando a regra ("nenhum Date.now() e chamado aqui"), mas nunca
  // como chamada de codigo de verdade -- por isso removemos as linhas
  // de comentario (/** ... */ e // ...) antes de checar.
  const codeOnly = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

  assert.ok(!codeOnly.includes('Date.now('), 'botMatchController.js nao deveria chamar Date.now() no CODIGO (fora de comentarios)');
  assert.ok(!codeOnly.includes('performance.now('), 'botMatchController.js nao deveria chamar performance.now() no CODIGO (fora de comentarios)');
});

// --- 10: EASY/MEDIUM/HARD continuam funcionando (seed/reactionTime/mistakeChance intactos) ---

['EASY', 'MEDIUM', 'HARD'].forEach((difficulty) => {
  test(`a dificuldade ${difficulty} continua com o MESMO preset (seed/reactionTime/mistakeChance) mesmo com durationMs configurado`, () => {
    const { botConfig } = createBotMatchSetup({ selectedMatchDuration: '1M', difficulty });
    const expectedPreset = ClientConfig.BOT_DIFFICULTY_PRESETS[difficulty];

    assert.strictEqual(botConfig.reactionTimeMs, expectedPreset.reactionTimeMs);
    assert.strictEqual(botConfig.judgementOffsetMs, expectedPreset.judgementOffsetMs);
    assert.strictEqual(botConfig.mistakeChance, expectedPreset.mistakeChance);
    assert.strictEqual(botConfig.seed, expectedPreset.seed);
  });
});

test('a MESMA dificuldade + a MESMA seed continuam produzindo as MESMAS decisoes do Bot, com ou sem durationMs', () => {
  const semDuracao = createBotMatchSetup({ selectedMatchDuration: null, difficulty: 'HARD', startTimestamp: 1_000_000 });
  const comDuracao = createBotMatchSetup({ selectedMatchDuration: '1M', difficulty: 'HARD', startTimestamp: 1_000_000 });

  const decisoesSemDuracao = semDuracao.botMatch.entries.map((e) => e.decision);
  const decisoesComDuracao = comDuracao.botMatch.entries.map((e) => e.decision);

  assert.deepStrictEqual(decisoesComDuracao, decisoesSemDuracao);
});

// --- 11: PlayerState do Bot continua independente ---

test('o PlayerState do Bot continua sendo criado do zero e independente (nunca reaproveita o do jogador humano)', () => {
  const { botMatch } = createBotMatchSetup({ selectedMatchDuration: '30S' });
  assert.strictEqual(botMatch.playerState.score, 0);
  assert.strictEqual(botMatch.playerState.combo, 0);

  const outroBotMatch = createBotMatchSetup({ selectedMatchDuration: '30S' }).botMatch;
  assert.notStrictEqual(botMatch.playerState, outroBotMatch.playerState);
});

test('avancar o Bot (tick) nunca escreve na timeline nem em nenhum PlayerState alheio', () => {
  const { timeline, botMatch } = createBotMatchSetup({ selectedMatchDuration: '30S', startTimestamp: 1_000_000 });
  const estadosOriginais = timeline.map((note) => note.state);

  BotMatchController.tick(botMatch, 1_010_000);

  const estadosDepois = timeline.map((note) => note.state);
  assert.deepStrictEqual(estadosDepois, estadosOriginais, 'nenhuma nota da timeline deveria mudar de estado por causa do Bot');
});

// --- 12: Solo continua funcionando ---

test('Solo (selectedMatchDuration resolvido sem nenhum config de Bot) continua funcionando exatamente como na Etapa 15C-1C', () => {
  const timeline = NoteEngine.generateNoteTimeline({
    seed: 15105,
    startTimestamp: 1_000_000,
    length: 5,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });
  const resolvedMatchDurationMs = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, '30S');
  let calls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => calls++,
    durationMs: resolvedMatchDurationMs,
    startTime: 1_000_000,
  });

  assert.strictEqual(detector.checkForEnd(1_029_999), false);
  assert.strictEqual(detector.checkForEnd(1_030_000), true);
  assert.strictEqual(calls, 1);
});

// --- 13: Multiplayer nao foi alterado nesta etapa ---

test('"Criar sala" / "Entrar em sala" (Multiplayer real) continuam zerando selectedMatchDuration -- nenhuma mudanca nesta etapa', () => {
  const createRoomBody = extractFunctionBody(
    mainJsContent,
    /document\.getElementById\('btn-create-room'\)\.addEventListener\('click', \(\) => \{/
  );
  const joinRoomBody = extractFunctionBody(
    mainJsContent,
    /document\.getElementById\('btn-join-room'\)\.addEventListener\('click', \(\) => \{/
  );

  [createRoomBody, joinRoomBody].forEach((body) => {
    assert.ok(
      body.includes('selectedMatchDuration = null'),
      'o clique deveria continuar zerando selectedMatchDuration antes de iniciar uma sala de Multiplayer real'
    );
    assert.ok(!body.includes('BotMatchController'), 'Multiplayer real nao deveria chamar BotMatchController');
  });
});

test('nenhum arquivo do servidor (server/) foi tocado pela integracao de duracao ao Bot', () => {
  const serverDir = path.join(__dirname, '../server');
  function walk(dir) {
    let matches = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        matches = matches.concat(walk(fullPath));
      } else if (entry.name.endsWith('.js')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('selectedMatchDuration') || content.includes('resolvedMatchDurationMs')) {
          matches.push(fullPath);
        }
      }
    }
    return matches;
  }
  assert.deepStrictEqual(walk(serverDir), [], 'nenhum arquivo do servidor deveria conhecer selectedMatchDuration/resolvedMatchDurationMs');
});

// --- 14: Modo Teste nao foi alterado nesta etapa ---

test('Modo Teste continua nunca definindo selectedMatchDuration (permanece null, preservando o comportamento antigo)', () => {
  const testMessageHandlerIdx = mainJsContent.indexOf('btn-send-test');
  const testMessageHandlerBody = mainJsContent.slice(testMessageHandlerIdx, testMessageHandlerIdx + 300);
  assert.ok(
    !testMessageHandlerBody.includes('selectedMatchDuration'),
    'o fluxo de teste manual (btn-send-test) nao deveria mexer em selectedMatchDuration'
  );
});

console.log(`\n${passed} teste(s) passaram.`);
