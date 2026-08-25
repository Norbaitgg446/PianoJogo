/**
 * ETAPA 16-2B — Integracao da timeline estendida (Solo/Bot/Multiplayer).
 *
 * A Etapa 16-2A criou `NoteEngine.generateExtendedTimeline()` e
 * `NoteEngine.computeNoteCountForDuration()` como PREPARACAO, sem
 * nenhum modo de jogo chama-las ainda (ver tests/noteEngineExtendedTimeline16_2A.test.js,
 * que continua cobrindo essas duas funcoes isoladamente e nao e
 * duplicado aqui). Esta suite cobre exclusivamente a INTEGRACAO feita
 * nesta etapa: `MatchTimelineManager.ensureTimeline` passa a aceitar
 * `durationMs` opcional e repassa-lo para `generateExtendedTimeline`, e
 * `main.js` passa a reutilizar o MESMO `resolvedMatchDurationMs` ja
 * calculado (nenhuma segunda resolucao de duracao, nenhum timer/loop
 * novo).
 *
 * Mesma estrategia dupla ja usada por tests/soloMatchDuration15C1C.test.js
 * e tests/botMatchDuration15C1D.test.js (main.js e um script de
 * navegador, nao da para `require`):
 *
 *   (a) INSPECAO ESTATICA do corpo de `startMatchGameplay` -- confirma
 *       que `resolvedMatchDurationMs` e calculado uma UNICA vez e
 *       repassado a `MatchTimelineManager.ensureTimeline` (ANTES da
 *       secao do Bot/MatchEndDetector, ou seja, sem nenhuma segunda
 *       resolucao), e que nenhum timer/loop/generateNoteTimeline extra
 *       foi criado.
 *
 *   (b) TESTES DE COMPORTAMENTO usando os MODULOS REAIS
 *       (MatchTimelineManager, NoteEngine, MatchDuration, ClientConfig,
 *       MatchEndDetector, BotController, BotMatchController) com os
 *       MESMOS argumentos que main.js passa para Solo/Bot/Multiplayer,
 *       sem reimplementar nenhuma logica de timeline/duracao aqui.
 *
 * Executar com: node tests/timelineDurationIntegration16_2B.test.js
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
const MatchTimelineManager = require('../client/js/match/matchTimelineManager');

let passed = 0;
function test(name, fn) {
  try {
    MatchTimelineManager.clear(); // cada teste comeca sem partida ativa
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
// (a) Inspecao estatica de client/js/main.js e matchTimelineManager.js
// =====================================================================

const mainJsPath = path.join(__dirname, '../client/js/main.js');
const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');

const timelineManagerPath = path.join(__dirname, '../client/js/match/matchTimelineManager.js');
const timelineManagerContent = fs.readFileSync(timelineManagerPath, 'utf8');

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

test('startMatchGameplay resolve resolvedMatchDurationMs UMA UNICA vez (nenhuma segunda resolucao de duracao)', () => {
  const resolveCalls = (startMatchGameplayBody.match(/MatchDuration\.resolveMatchDuration\(/g) || []).length;
  assert.strictEqual(
    resolveCalls,
    1,
    'MatchDuration.resolveMatchDuration deveria continuar sendo chamado uma UNICA vez dentro de startMatchGameplay'
  );
});

test('resolvedMatchDurationMs e calculado ANTES da chamada a MatchTimelineManager.ensureTimeline', () => {
  const resolveIdx = startMatchGameplayBody.indexOf('const resolvedMatchDurationMs =');
  const ensureTimelineIdx = startMatchGameplayBody.indexOf('MatchTimelineManager.ensureTimeline(');

  assert.ok(resolveIdx !== -1, 'resolvedMatchDurationMs deveria ser declarado em startMatchGameplay');
  assert.ok(ensureTimelineIdx !== -1, 'MatchTimelineManager.ensureTimeline deveria ser chamado em startMatchGameplay');
  assert.ok(
    resolveIdx < ensureTimelineIdx,
    'resolvedMatchDurationMs precisa existir ANTES de ser passado para ensureTimeline'
  );
});

test('a chamada a MatchTimelineManager.ensureTimeline repassa durationMs: resolvedMatchDurationMs (o MESMO valor usado pelo MatchEndDetector)', () => {
  const ensureTimelineIdx = startMatchGameplayBody.indexOf('MatchTimelineManager.ensureTimeline(');
  const detectorIdx = startMatchGameplayBody.indexOf('MatchEndDetector.createMatchEndDetector(');

  const ensureTimelineSnippet = startMatchGameplayBody.slice(ensureTimelineIdx, ensureTimelineIdx + 1400);
  const detectorSnippet = startMatchGameplayBody.slice(detectorIdx, detectorIdx + 400);

  assert.ok(
    /durationMs:\s*resolvedMatchDurationMs/.test(ensureTimelineSnippet),
    'ensureTimeline deveria receber durationMs: resolvedMatchDurationMs'
  );
  assert.ok(
    /durationMs:\s*resolvedMatchDurationMs/.test(detectorSnippet),
    'MatchEndDetector deveria continuar recebendo o MESMO resolvedMatchDurationMs'
  );
});

test('startMatchGameplay continua sem chamar NoteEngine.generateNoteTimeline/generateExtendedTimeline diretamente (sempre via MatchTimelineManager.ensureTimeline)', () => {
  assert.strictEqual(
    (startMatchGameplayBody.match(/generateNoteTimeline\(/g) || []).length,
    0,
    'startMatchGameplay nao deveria chamar NoteEngine.generateNoteTimeline diretamente'
  );
  assert.strictEqual(
    (startMatchGameplayBody.match(/generateExtendedTimeline\(/g) || []).length,
    0,
    'startMatchGameplay nao deveria chamar NoteEngine.generateExtendedTimeline diretamente'
  );
});

test('nenhum timer/loop NOVO foi criado: main.js continua com exatamente os mesmos 2 requestAnimationFrame e zero setTimeout/setInterval de antes desta etapa', () => {
  const rafCount = (mainJsContent.match(/requestAnimationFrame\(/g) || []).length;
  const timeoutCount = (mainJsContent.match(/setTimeout\(/g) || []).length;
  const intervalCount = (mainJsContent.match(/setInterval\(/g) || []).length;

  assert.strictEqual(rafCount, 2, `esperava exatamente 2 requestAnimationFrame(, encontrou ${rafCount}`);
  assert.strictEqual(timeoutCount, 0, 'main.js nao deveria conter setTimeout(');
  assert.strictEqual(intervalCount, 0, 'main.js nao deveria conter setInterval(');
});

test('MatchTimelineManager continua sem Date.now/setTimeout/setInterval/requestAnimationFrame/Math.random proprios', () => {
  ['Date.now(', 'setTimeout(', 'setInterval(', 'requestAnimationFrame(', 'Math.random('].forEach((forbidden) => {
    assert.ok(
      !timelineManagerContent.includes(forbidden),
      `matchTimelineManager.js nao deveria conter "${forbidden}"`
    );
  });
});

// =====================================================================
// (b) Comportamento real: MatchTimelineManager.ensureTimeline({ ..., durationMs })
// =====================================================================

const BASE_PARAMS = {
  seed: 16_2001,
  startTimestamp: 5_000_000,
  length: 8,
  noteRange: 3,
  noteIntervalMs: 500,
  leadInMs: 1000,
};

// --- 1. Sem durationMs -> comportamento antigo -----------------------------

test('sem durationMs, ensureTimeline preserva exatamente o comportamento antigo (identico a generateNoteTimeline)', () => {
  const viaManager = MatchTimelineManager.ensureTimeline(BASE_PARAMS);
  const viaNoteEngineDireto = NoteEngine.generateNoteTimeline(BASE_PARAMS);

  assert.strictEqual(viaManager.length, BASE_PARAMS.length);
  assert.deepStrictEqual(
    viaManager.map((n) => ({ id: n.id, lane: n.lane, time: n.time })),
    viaNoteEngineDireto.map((n) => ({ id: n.id, lane: n.lane, time: n.time }))
  );
});

test('durationMs invalido (null/0/negativo/NaN) tambem preserva o comportamento antigo', () => {
  [null, undefined, 0, -1000, NaN].forEach((invalidDuration) => {
    MatchTimelineManager.clear();
    const timeline = MatchTimelineManager.ensureTimeline({ ...BASE_PARAMS, durationMs: invalidDuration });
    assert.strictEqual(
      timeline.length,
      BASE_PARAMS.length,
      `durationMs=${invalidDuration} deveria manter a timeline-base normal`
    );
  });
});

// --- 2-5. "30S"/"1M"/"5M"/"10M" -> timeline estendida -----------------------

['30S', '1M', '5M', '10M'].forEach((durationId) => {
  test(`"${durationId}" resolvido via ClientConfig.MATCH_DURATION_MS produz uma timeline estendida (mais notas que o padrao-base)`, () => {
    const durationMs = ClientConfig.MATCH_DURATION_MS[durationId];
    const timeline = MatchTimelineManager.ensureTimeline({ ...BASE_PARAMS, durationMs });

    assert.ok(
      timeline.length > BASE_PARAMS.length,
      `"${durationId}" (${durationMs}ms) deveria gerar mais que as ${BASE_PARAMS.length} notas do padrao-base`
    );
    assert.deepStrictEqual(
      timeline,
      NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, durationMs }),
      'ensureTimeline deveria repassar durationMs diretamente a generateExtendedTimeline, sem transformar o resultado'
    );
  });
});

// --- 6. A timeline realmente possui notas suficientes para cobrir a duracao -

test('a ULTIMA nota da timeline estendida cobre pelo menos a durationMs pedida', () => {
  const durationMs = ClientConfig.MATCH_DURATION_MS['1M'];
  const timeline = MatchTimelineManager.ensureTimeline({ ...BASE_PARAMS, durationMs });

  const lastNote = timeline[timeline.length - 1];
  const coveredMs = lastNote.time - BASE_PARAMS.startTimestamp;

  assert.ok(
    coveredMs >= durationMs,
    `a ultima nota deveria cobrir >= ${durationMs}ms, cobriu ${coveredMs}ms`
  );
});

// --- 7. A primeira sequencia-base permanece igual ---------------------------

test('os primeiros `length` indices da timeline estendida sao identicos a timeline-base normal (checksum preservado)', () => {
  const durationMs = ClientConfig.MATCH_DURATION_MS['5M'];
  const extended = MatchTimelineManager.ensureTimeline({ ...BASE_PARAMS, durationMs });
  const base = NoteEngine.generateNoteTimeline(BASE_PARAMS);

  assert.deepStrictEqual(
    extended.slice(0, BASE_PARAMS.length).map((n) => ({ id: n.id, lane: n.lane, time: n.time })),
    base.map((n) => ({ id: n.id, lane: n.lane, time: n.time })),
    'a sequencia-base usada pela validacao/checksum precisa continuar identica'
  );
});

// --- 8. Os tempos continuam crescentes --------------------------------------

test('os tempos (time) da timeline estendida sao estritamente crescentes', () => {
  const durationMs = ClientConfig.MATCH_DURATION_MS['10M'];
  const timeline = MatchTimelineManager.ensureTimeline({ ...BASE_PARAMS, durationMs });

  for (let i = 1; i < timeline.length; i++) {
    assert.ok(
      timeline[i].time > timeline[i - 1].time,
      `note[${i}].time deveria ser maior que note[${i - 1}].time`
    );
  }
});

// --- 9. Os intervalos continuam respeitando o padrao/dificuldade -----------

test('com difficultyStages, o intervalo entre notas da timeline estendida continua encolhendo pelo mesmo multiplicador vigente', () => {
  const difficultyStages = [
    { notesPlayed: 0, speedMultiplier: 1 },
    { notesPlayed: 6, speedMultiplier: 2 },
  ];
  const durationMs = ClientConfig.MATCH_DURATION_MS['1M'];
  const timeline = MatchTimelineManager.ensureTimeline({
    ...BASE_PARAMS,
    difficultyStages,
    durationMs,
  });

  // Antes do estagio (indice 5): intervalo continua noteIntervalMs.
  assert.strictEqual(timeline[5].time - timeline[4].time, BASE_PARAMS.noteIntervalMs);
  // A partir do estagio (indice 6): intervalo encolhe pela metade.
  assert.strictEqual(timeline[6].time - timeline[5].time, BASE_PARAMS.noteIntervalMs / 2);
  assert.strictEqual(timeline[7].time - timeline[6].time, BASE_PARAMS.noteIntervalMs / 2);
});

// --- 10. A geracao continua deterministica ----------------------------------

test('a mesma seed/startTimestamp/duracao produz sempre a mesma timeline estendida (deterministico)', () => {
  const durationMs = ClientConfig.MATCH_DURATION_MS['1M'];

  const timelineA = MatchTimelineManager.ensureTimeline({ ...BASE_PARAMS, durationMs });
  MatchTimelineManager.clear();
  const timelineB = MatchTimelineManager.ensureTimeline({ ...BASE_PARAMS, durationMs });

  assert.deepStrictEqual(
    timelineA.map((n) => ({ lane: n.lane, time: n.time })),
    timelineB.map((n) => ({ lane: n.lane, time: n.time }))
  );
});

// --- 11-13. Solo/Bot/Multiplayer usam a duracao escolhida -------------------

/**
 * Reproduz, com os modulos REAIS, exatamente a composicao que
 * startMatchGameplay agora faz para qualquer modo:
 *   selectedMatchDuration (Solo/Bot) OU message.match.durationMs (Multiplayer)
 *   -> resolvedMatchDurationMs
 *   -> MatchTimelineManager.ensureTimeline({ ..., durationMs: resolvedMatchDurationMs })
 */
function resolveDurationLikeMain({ selectedMatchDuration, matchDurationMsFromServer }) {
  return (
    MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, selectedMatchDuration) ??
    (typeof matchDurationMsFromServer === 'number' ? matchDurationMsFromServer : null)
  );
}

test('Solo: a timeline usa a MESMA duracao escolhida pelo jogador (selectedMatchDuration)', () => {
  const resolvedMatchDurationMs = resolveDurationLikeMain({ selectedMatchDuration: '1M' });
  assert.strictEqual(resolvedMatchDurationMs, 60000);

  const timeline = MatchTimelineManager.ensureTimeline({ ...BASE_PARAMS, durationMs: resolvedMatchDurationMs });
  assert.ok(timeline.length > BASE_PARAMS.length, 'Solo deveria receber a timeline estendida para 1M');
});

test('Bot: MatchTimelineManager.ensureTimeline e BotMatchController.createBotMatch recebem o MESMO resolvedMatchDurationMs do Solo', () => {
  const selectedMatchDuration = '5M';
  const resolvedMatchDurationMs = resolveDurationLikeMain({ selectedMatchDuration });

  const timeline = MatchTimelineManager.ensureTimeline({ ...BASE_PARAMS, durationMs: resolvedMatchDurationMs });

  const botConfig = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, 'MEDIUM');
  const botMatch = BotMatchController.createBotMatch({
    timeline, // MESMA instancia, nunca uma segunda geracao
    config: botConfig,
    windows: { perfectMs: 60, greatMs: 100, goodMs: 150 },
    scoreValues: { PERFECT: 300, GREAT: 200, GOOD: 100, MISS: 0 },
    comboMultiplierTiers: [],
    penalties: { MISTAKE: 0, MISS: 0 },
    durationMs: resolvedMatchDurationMs,
  });

  assert.ok(timeline.length > BASE_PARAMS.length, 'Bot deveria jogar sobre a MESMA timeline estendida para 5M');
  assert.strictEqual(botMatch.playerState.score, 0, 'BotMatchController criou normalmente sobre a timeline estendida');
});

test('Multiplayer: a timeline usa o MESMO resolvedMatchDurationMs vindo do servidor (message.match.durationMs), sem selectedMatchDuration local', () => {
  // Multiplayer real nunca define selectedMatchDuration (fica null) -- a
  // duracao vem exclusivamente de message.match.durationMs, ja resolvido
  // pelo servidor (ver matchFlow.js).
  const resolvedMatchDurationMs = resolveDurationLikeMain({
    selectedMatchDuration: null,
    matchDurationMsFromServer: ClientConfig.MATCH_DURATION_MS['30S'],
  });
  assert.strictEqual(resolvedMatchDurationMs, 30000);

  const timeline = MatchTimelineManager.ensureTimeline({ ...BASE_PARAMS, durationMs: resolvedMatchDurationMs });
  assert.ok(timeline.length > BASE_PARAMS.length, 'Multiplayer deveria receber a timeline estendida para 30S');
});

// --- 14. Nenhum dos tres modos perde notas prematuramente por causa da timeline -

test('nenhum modo perde notas prematuramente: a timeline estendida sempre cobre pelo menos ate a duracao escolhida, para os tres modos', () => {
  ['30S', '1M', '5M', '10M'].forEach((durationId) => {
    MatchTimelineManager.clear();
    const durationMs = ClientConfig.MATCH_DURATION_MS[durationId];
    const timeline = MatchTimelineManager.ensureTimeline({ ...BASE_PARAMS, durationMs });
    const lastNote = timeline[timeline.length - 1];
    const coveredMs = lastNote.time - BASE_PARAMS.startTimestamp;

    assert.ok(
      coveredMs >= durationMs,
      `"${durationId}": a timeline (usada por Solo/Bot/Multiplayer da mesma forma) deveria cobrir >= ${durationMs}ms`
    );
  });
});

// --- 15. MatchEndDetector continua sendo o responsavel pelo encerramento ---

test('MatchEndDetector continua encerrando a partida pela duracao, independente do tamanho da timeline estendida', () => {
  const durationMs = ClientConfig.MATCH_DURATION_MS['30S'];
  const startTimestamp = BASE_PARAMS.startTimestamp;
  const timeline = MatchTimelineManager.ensureTimeline({ ...BASE_PARAMS, startTimestamp, durationMs });

  // Mesmo com uma timeline bem maior que o padrao-base (varias notas
  // ainda pendentes), o detector encerra exatamente quando a duracao e
  // atingida -- a timeline extendida NAO cria seu proprio encerramento.
  let calls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => calls++,
    durationMs,
    startTime: startTimestamp,
  });

  assert.strictEqual(detector.checkForEnd(startTimestamp + durationMs - 1), false);
  assert.strictEqual(calls, 0);
  assert.strictEqual(detector.checkForEnd(startTimestamp + durationMs), true);
  assert.strictEqual(calls, 1);

  const pendingNotesRemaining = timeline.some((note) => note.state === NoteEngine.NOTE_STATE.PENDING);
  assert.ok(pendingNotesRemaining, 'a timeline estendida deveria ainda ter notas pendentes quando a duracao encerrou a partida');
});

// --- 16. Nenhum timer/loop novo foi criado (reforco via NoteEngine tambem) -
// (generateExtendedTimeline/computeNoteCountForDuration em si -- pureza,
// determinismo, ausencia de Math.random/relogio/timers -- ja e coberta
// isoladamente por tests/noteEngineExtendedTimeline16_2A.test.js; aqui o
// foco e so a integracao, ja reforcada acima nos testes estaticos de
// main.js/matchTimelineManager.js.)

console.log(`\n${passed} teste(s) passaram.`);
