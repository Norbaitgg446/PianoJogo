/**
 * ETAPA 15 — Inicio de partida mais claro (3 -> 2 -> 1 -> VAI!) e
 * primeira nota nascendo na posicao correta (topo da lane), em vez de
 * ja aparecer no meio da tela.
 *
 * Reaproveita 100% dos sistemas ja existentes:
 *   - contagem regressiva: client/js/match/matchController.js (ja existia)
 *   - relogio sincronizado: mesmo mecanismo de clockOffset ja usado por
 *     MatchController e NoteRenderer
 *   - posicionamento/timeline das notas: client/js/match/noteEngine.js +
 *     client/js/render/noteRenderer.js (ja existiam)
 *   - gate de gameplay: startMatchGameplay em client/js/main.js, unico
 *     ponto de entrada ja usado por Solo/Modo Teste/Multiplayer/Bot
 *
 * Nao ha nenhum sistema novo -- so foi ajustado o valor de
 * NOTE_LEAD_IN_MS/leadInMs (para >= NOTE_TRAVEL_MS) e o texto/timer
 * cosmetico da contagem regressiva concluida.
 *
 * Executar com: node tests/matchStartSequence15.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ClientConfig = require('../client/js/config');
const NoteEngine = require('../client/js/match/noteEngine');
const NoteRenderer = require('../client/js/render/noteRenderer');
const MatchController = require('../client/js/match/matchController');
const BotController = require('../client/js/match/botController');
const ClientSequenceCatalog = require('../client/js/music/sequenceCatalog');
const ServerSequenceCatalog = require('../server/music/sequenceCatalog');
const LocalServerSimulator = require('../client/js/network/localServerSimulator');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`OK   - ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function flush(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const { computeProgress, computeTopPercent, NOTE_TRAVEL_MS } = NoteRenderer._internal;

const mainJsPath = path.join(__dirname, '../client/js/main.js');
const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');
const uiControllerPath = path.join(__dirname, '../client/js/ui/uiController.js');
const uiControllerContent = fs.readFileSync(uiControllerPath, 'utf8');

async function run() {
  // ==== BLOCO A — Invariantes de configuracao ==============================

  await test('A1: NOTE_LEAD_IN_MS (config default) e >= NOTE_TRAVEL_MS', () => {
    assert.ok(
      ClientConfig.NOTE_LEAD_IN_MS >= ClientConfig.NOTE_TRAVEL_MS,
      `NOTE_LEAD_IN_MS (${ClientConfig.NOTE_LEAD_IN_MS}) deveria ser >= NOTE_TRAVEL_MS (${ClientConfig.NOTE_TRAVEL_MS})`
    );
  });

  await test('A2: todo padrao registrado no catalogo do CLIENTE tem leadInMs >= NOTE_TRAVEL_MS', () => {
    for (const id of ClientSequenceCatalog.getAllSequenceIds()) {
      const pattern = ClientSequenceCatalog.getSequencePattern(id);
      assert.ok(
        pattern.leadInMs >= ClientConfig.NOTE_TRAVEL_MS,
        `padrao "${id}": leadInMs (${pattern.leadInMs}) deveria ser >= NOTE_TRAVEL_MS (${ClientConfig.NOTE_TRAVEL_MS})`
      );
    }
  });

  await test('A3: todo padrao registrado no catalogo do SERVIDOR tem leadInMs >= NOTE_TRAVEL_MS', () => {
    for (const id of ServerSequenceCatalog.getAllSequenceIds()) {
      const pattern = ServerSequenceCatalog.getSequencePattern(id);
      assert.ok(
        pattern.leadInMs >= ClientConfig.NOTE_TRAVEL_MS,
        `padrao "${id}": leadInMs (${pattern.leadInMs}) deveria ser >= NOTE_TRAVEL_MS (${ClientConfig.NOTE_TRAVEL_MS})`
      );
    }
  });

  await test('A4: catalogos de cliente e servidor permanecem identicos (seq-basic-01/02)', () => {
    for (const id of ['seq-basic-01', 'seq-basic-02']) {
      assert.deepStrictEqual(
        ClientSequenceCatalog.getSequencePattern(id),
        ServerSequenceCatalog.getSequencePattern(id),
        `padrao "${id}" divergiu entre client e server`
      );
    }
  });

  // ==== BLOCO B — Timeline: primeira nota nunca nasce antes do inicio ======

  const START_TS = 1_800_000_000_000;

  function firstNoteSpawnTime(leadInMs) {
    const timeline = NoteEngine.generateNoteTimeline({
      seed: 42,
      startTimestamp: START_TS,
      length: 8,
      noteRange: 3,
      noteIntervalMs: 600,
      leadInMs,
    });
    const firstNote = timeline[0];
    return { firstNote, spawnTime: firstNote.time - NOTE_TRAVEL_MS };
  }

  await test('B1: com NOTE_LEAD_IN_MS atual (config), a 1a nota "nasce" em/depois do startTimestamp', () => {
    const { spawnTime } = firstNoteSpawnTime(ClientConfig.NOTE_LEAD_IN_MS);
    assert.ok(
      spawnTime >= START_TS,
      `spawnTime (${spawnTime}) deveria ser >= startTimestamp (${START_TS})`
    );
  });

  await test('B2: com o leadInMs de CADA padrao do catalogo, a 1a nota nasce em/depois do startTimestamp', () => {
    for (const id of ClientSequenceCatalog.getAllSequenceIds()) {
      const pattern = ClientSequenceCatalog.getSequencePattern(id);
      const { spawnTime } = firstNoteSpawnTime(pattern.leadInMs);
      assert.ok(spawnTime >= START_TS, `padrao "${id}": spawnTime (${spawnTime}) < startTimestamp (${START_TS})`);
    }
  });

  await test('B3 (reproducao do bug): o valor ANTIGO (leadInMs=1000) provava a falha — mantido como trava de regressao', () => {
    const OLD_BUGGY_LEAD_IN_MS = 1000; // valor antigo, antes da ETAPA 15
    const { spawnTime } = firstNoteSpawnTime(OLD_BUGGY_LEAD_IN_MS);
    // Este e o comportamento ANTIGO (o bug relatado): a nota "nascia"
    // 800ms antes do inicio da partida. Este teste documenta o bug e
    // serve de contraste com B1/B2 acima, que provam que o valor ATUAL
    // (1800) nao sofre mais disso.
    assert.strictEqual(spawnTime, START_TS - 800);
    assert.ok(spawnTime < START_TS, 'com o valor antigo, a nota nasceria antes do inicio (o bug relatado)');
  });

  // ==== BLOCO C — Posicao visual: nota comeca no TOPO, nunca no meio =======

  await test('C1: no instante exato do match_started, a 1a nota esta no TOPO da lane (progress <= 0)', () => {
    const { firstNote } = firstNoteSpawnTime(ClientConfig.NOTE_LEAD_IN_MS);
    const progress = computeProgress(firstNote, START_TS, NOTE_TRAVEL_MS);
    const topPercent = computeTopPercent(firstNote, START_TS, NOTE_TRAVEL_MS, 96);
    assert.ok(progress <= 0, `progress deveria ser <= 0 no inicio da partida, veio ${progress}`);
    assert.strictEqual(topPercent, 0, 'a nota deveria estar em 0% (topo), nunca ja descida');
  });

  await test('C2 (reproducao do bug): com o valor ANTIGO, a nota ja nascia ~44% descida na tela', () => {
    const { firstNote } = firstNoteSpawnTime(1000); // valor antigo
    const progress = computeProgress(firstNote, START_TS, NOTE_TRAVEL_MS);
    // 800ms / 1800ms ~= 0.444 -- exatamente o "aparece do nada no meio
    // da tela" relatado.
    assert.ok(progress > 0.4 && progress < 0.5, `esperava progress ~0.44, veio ${progress}`);
  });

  // ==== BLOCO D — Gameplay so comeca depois do "VAI!" (gate estrutural) ====

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

  await test('D1: startMatchGameplay e o UNICO lugar que cria NoteRenderer.start/GameplayEngine/BotMatchController', () => {
    assert.ok(startMatchGameplayBody.includes('NoteRenderer.start('), 'NoteRenderer.start deveria estar dentro de startMatchGameplay');
    assert.ok(
      startMatchGameplayBody.includes('GameplayEngine.createGameplayEngine('),
      'GameplayEngine.createGameplayEngine deveria estar dentro de startMatchGameplay'
    );
    assert.ok(
      startMatchGameplayBody.includes('BotMatchController.createBotMatch('),
      'BotMatchController.createBotMatch deveria estar dentro de startMatchGameplay'
    );
    assert.ok(
      startMatchGameplayBody.includes('InputController.setLaneHandler(handleLanePressed)'),
      'input do jogador so deveria ser ligado dentro de startMatchGameplay'
    );

    // Fora desta funcao, main.js nunca deveria CHAMAR estes mesmos
    // pontos de entrada de novo (o que criaria um segundo caminho de
    // inicio de gameplay). So procura pela CHAMADA real (com o `(` de
    // invocacao logo em seguida), nao por mencoes em comentarios/doc.
    const outsideBody = mainJsContent.replace(startMatchGameplayBody, '');
    assert.ok(!outsideBody.includes('NoteRenderer.start({'), 'NoteRenderer.start nao deveria ser chamado fora de startMatchGameplay');
    assert.ok(
      !outsideBody.includes('= GameplayEngine.createGameplayEngine({'),
      'GameplayEngine.createGameplayEngine nao deveria ser chamado fora de startMatchGameplay'
    );
  });

  await test('D2: o case "match_countdown_start" NUNCA chama startMatchGameplay', () => {
    const caseMatch = /case 'match_countdown_start':([\s\S]*?)break;/.exec(mainJsContent);
    assert.ok(caseMatch, 'case match_countdown_start nao encontrado');
    assert.ok(!caseMatch[1].includes('startMatchGameplay'), 'match_countdown_start nao deveria iniciar o gameplay');
    assert.ok(caseMatch[1].includes('MatchController.startCountdown'), 'match_countdown_start deveria disparar a contagem regressiva');
  });

  await test('D3: o case "match_started" chama startMatchGameplay(message)', () => {
    const caseMatch = /case 'match_started':([\s\S]*?)break;/.exec(mainJsContent);
    assert.ok(caseMatch, 'case match_started nao encontrado');
    assert.ok(caseMatch[1].includes('startMatchGameplay(message)'), 'match_started deveria chamar startMatchGameplay(message)');
  });

  // ==== BLOCO E — Contagem regressiva (3 -> 2 -> 1 -> onComplete) ==========

  await test('E1 (matematica pura): computeRemainingMs/computeSecondsRemaining seguem a mesma formula de sempre', () => {
    const { computeEstimatedServerNow, computeRemainingMs, computeSecondsRemaining } = MatchController._internal;
    assert.strictEqual(computeEstimatedServerNow(1000, 500), 1500);
    assert.strictEqual(computeRemainingMs(10_000, 7_000), 3000);
    assert.strictEqual(computeSecondsRemaining(2001), 3);
    assert.strictEqual(computeSecondsRemaining(2000), 2);
    assert.strictEqual(computeSecondsRemaining(1), 1);
  });

  await test('E2 (integracao com timers reais): emite 3, 2, 1 em ordem e onComplete uma unica vez', async () => {
    const ticks = [];
    let completedCount = 0;
    // Longe o suficiente do "agora" para atravessar 3 -> 2 -> 1 de
    // verdade (o primeiro tick sincrono usa Math.ceil(remainingMs/1000),
    // entao precisamos comecar pouco acima de 3000ms restantes).
    const startTimestamp = Date.now() + 2600;
    const serverTime = Date.now();

    MatchController.startCountdown(
      { startTimestamp, serverTime },
      (secondsRemaining) => ticks.push(secondsRemaining),
      () => {
        completedCount++;
      }
    );

    await flush(2900);

    assert.deepStrictEqual(ticks, [...ticks].sort((a, b) => b - a), 'os ticks deveriam vir em ordem decrescente');
    assert.strictEqual(ticks[0], 3, `primeiro tick esperado 3, veio ${ticks[0]}`);
    assert.strictEqual(ticks[ticks.length - 1], 1, 'o ultimo tick antes do fim deveria ser 1');
    assert.deepStrictEqual(ticks, [3, 2, 1], 'sequencia completa deveria ser exatamente [3, 2, 1]');
    assert.strictEqual(completedCount, 1, 'onComplete deveria disparar exatamente uma vez');

    MatchController.stopCountdown();
  });

  // ==== BLOCO F — UI: texto "VAI!" e some sozinho, sem tocar o gameplay ====

  await test('F1: showCountdownFinished usa "VAI!" (nao mais "INICIAR")', () => {
    assert.ok(uiControllerContent.includes("'VAI!'"), 'uiController.js deveria exibir "VAI!" ao final da contagem');
    assert.ok(!uiControllerContent.includes('INICIAR'), 'o texto antigo "INICIAR" nao deveria mais existir');
  });

  await test('F2: showCountdownFinished agenda o proprio hideCountdown via setTimeout (cosmetico)', () => {
    const fnMatch = /function showCountdownFinished\(\) \{([\s\S]*?)\n  \}/.exec(uiControllerContent);
    assert.ok(fnMatch, 'showCountdownFinished nao encontrada');
    assert.ok(fnMatch[1].includes('setTimeout'), 'deveria agendar um setTimeout para esconder o "VAI!"');
    assert.ok(fnMatch[1].includes('hideCountdown'), 'o setTimeout deveria chamar hideCountdown');
  });

  await test('F3: showCountdownTick limpa qualquer timer pendente de esconder o "VAI!" anterior', () => {
    const fnMatch = /function showCountdownTick\(secondsRemaining\) \{([\s\S]*?)\n  \}/.exec(uiControllerContent);
    assert.ok(fnMatch, 'showCountdownTick nao encontrada');
    assert.ok(
      fnMatch[1].includes('clearCountdownHideTimeout'),
      'uma nova contagem regressiva deveria cancelar o timer da anterior (ex: revanche rapida)'
    );
  });

  // ==== BLOCO G — Bot sempre sincronizado (nunca age antes do inicio) ======

  await test('G1: BotController.computeActionTime nunca produz um horario ANTERIOR a note.time', () => {
    const configs = [
      undefined, // DEFAULT_CONFIG
      ClientConfig.BOT_DIFFICULTY_PRESETS.EASY,
      ClientConfig.BOT_DIFFICULTY_PRESETS.MEDIUM,
      ClientConfig.BOT_DIFFICULTY_PRESETS.HARD,
    ];
    const note = { time: START_TS + 1800 };
    for (const config of configs) {
      const actionTime = BotController.computeActionTime(note, config);
      assert.ok(actionTime >= note.time, `actionTime (${actionTime}) deveria ser >= note.time (${note.time})`);
    }
  });

  await test('G2: combinando com a 1a nota corrigida, o Bot nunca age antes do startTimestamp', () => {
    const { firstNote } = firstNoteSpawnTime(ClientConfig.NOTE_LEAD_IN_MS);
    for (const difficulty of ['EASY', 'MEDIUM', 'HARD']) {
      const config = ClientConfig.BOT_DIFFICULTY_PRESETS[difficulty];
      const actionTime = BotController.computeActionTime(firstNote, config);
      assert.ok(
        actionTime >= START_TS,
        `dificuldade ${difficulty}: actionTime (${actionTime}) deveria ser >= startTimestamp (${START_TS})`
      );
    }
  });

  // ==== BLOCO H — Regressao: nada de julgamento/pontuacao/combo/duracao mudou

  await test('H1: janelas de julgamento (PERFECT/GREAT/GOOD) permanecem exatamente as mesmas', () => {
    assert.deepStrictEqual(ClientConfig.JUDGEMENT_WINDOWS, { PERFECT_MS: 60, GREAT_MS: 200, GOOD_MS: 1800 });
  });

  await test('H2: pontuacao, combo e penalidades permanecem exatamente os mesmos', () => {
    assert.deepStrictEqual(ClientConfig.SCORE_VALUES, { PERFECT: 300, GREAT: 200, GOOD: 100, MISS: 0 });
    assert.deepStrictEqual(ClientConfig.PENALTIES, { MISTAKE: -50, MISS: -30 });
    assert.strictEqual(ClientConfig.COMBO_MULTIPLIER.TIERS.length, 4);
  });

  await test('H3: progressao de dificuldade permanece exatamente a mesma', () => {
    assert.strictEqual(ClientConfig.DIFFICULTY_PROGRESSION.MAX_SPEED_MULTIPLIER, 1.3);
    assert.strictEqual(ClientConfig.DIFFICULTY_PROGRESSION.STAGES.length, 5);
  });

  await test('H4: duracao da partida (length/noteIntervalMs de cada musica) permanece intocada — so leadInMs mudou', () => {
    const expected = {
      'seq-basic-01': { length: 16, noteRange: 3, noteIntervalMs: 600 },
      'seq-basic-02': { length: 24, noteRange: 3, noteIntervalMs: 500 },
    };
    for (const [id, expectedFields] of Object.entries(expected)) {
      const pattern = ClientSequenceCatalog.getSequencePattern(id);
      assert.strictEqual(pattern.length, expectedFields.length, `${id}: length nao deveria mudar`);
      assert.strictEqual(pattern.noteRange, expectedFields.noteRange, `${id}: noteRange nao deveria mudar`);
      assert.strictEqual(pattern.noteIntervalMs, expectedFields.noteIntervalMs, `${id}: noteIntervalMs nao deveria mudar`);
    }
  });

  await test('H5: NOTE_TRAVEL_MS/NOTE_HIT_WINDOW_MS/NOTE_INTERVAL_MS permanecem exatamente os mesmos', () => {
    assert.strictEqual(ClientConfig.NOTE_TRAVEL_MS, 1800);
    assert.strictEqual(ClientConfig.NOTE_HIT_WINDOW_MS, 1800);
    assert.strictEqual(ClientConfig.NOTE_INTERVAL_MS, 600);
  });

  // ==== BLOCO I — Fim a fim: Solo/Modo Teste continuam funcionando =========

  await test('I1 (Solo, end-to-end real via LocalServerSimulator): match_ready -> match_countdown_start -> match_started, e a timeline resultante respeita o fix', async () => {
    const messages = [];
    const connection = LocalServerSimulator.createLocalConnection({
      onMessage: (message) => messages.push(message),
      onStatusChange: () => {},
      countdownMs: 0,
    });
    connection.connect();
    connection.send('start_solo_match');
    await flush(30);

    const types = messages.map((m) => m.type);
    assert.ok(types.includes('match_ready'), 'deveria emitir match_ready');
    assert.ok(types.includes('match_countdown_start'), 'deveria emitir match_countdown_start');
    assert.ok(types.includes('match_started'), 'deveria emitir match_started');
    assert.ok(
      types.indexOf('match_ready') < types.indexOf('match_countdown_start'),
      'match_ready deveria vir antes de match_countdown_start'
    );
    assert.ok(
      types.indexOf('match_countdown_start') < types.indexOf('match_started'),
      'match_countdown_start deveria vir antes de match_started'
    );

    const started = messages.find((m) => m.type === 'match_started');
    const sequenceId = started.match.music.sequenceId;
    const pattern = ClientSequenceCatalog.getSequencePattern(sequenceId);

    const timeline = NoteEngine.generateNoteTimeline({
      seed: started.match.seed,
      startTimestamp: started.startTimestamp,
      length: pattern.length,
      noteRange: pattern.noteRange,
      noteIntervalMs: pattern.noteIntervalMs,
      leadInMs: pattern.leadInMs,
    });

    const spawnTime = timeline[0].time - NOTE_TRAVEL_MS;
    assert.ok(
      spawnTime >= started.startTimestamp,
      `Solo: a 1a nota (spawnTime=${spawnTime}) nao deveria nascer antes do startTimestamp (${started.startTimestamp})`
    );
  });

  console.log(`\n${passed} passaram, ${failed} falharam.`);
}

run();
