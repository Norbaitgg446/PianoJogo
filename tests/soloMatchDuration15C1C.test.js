/**
 * ETAPA 15C-1C — Conectar a duracao ao gameplay do Solo.
 *
 * `client/js/main.js` e um script de navegador (usa `document`/`window`,
 * roda dentro de uma IIFE sem `module.exports`) -- nao da para
 * `require('../client/js/main.js')` em Node. Por isso, no MESMO
 * espirito de tests/matchStartSequence15.test.js, esta suite usa duas
 * estrategias complementares:
 *
 *   (a) INSPECAO ESTATICA do codigo-fonte de main.js (extraindo o corpo
 *       de `startMatchGameplay` e do `loop` interno de
 *       `startExpiredNotesLoop`) para confirmar QUE main.js liga a
 *       duracao exatamente do jeito pedido: resolve `selectedMatchDuration`
 *       via `MatchDuration.resolveMatchDuration` + `ClientConfig.MATCH_DURATION_MS`,
 *       passa `durationMs`/`startTime` para `MatchEndDetector.createMatchEndDetector`,
 *       chama `checkForEnd(getSyncedNow())` dentro do MESMO loop de
 *       sempre, nunca cria um segundo requestAnimationFrame/timer, e
 *       mantem o Bot de fora desta etapa;
 *
 *   (b) TESTES DE COMPORTAMENTO usando os MESMOS modulos reais que
 *       main.js chama (ClientConfig, MatchDuration, MatchEndDetector,
 *       NoteEngine) com os MESMOS argumentos que main.js passa, para
 *       confirmar que a composicao resultante (selecao -> ms -> detector
 *       -> fim de partida) funciona exatamente como especificado --
 *       sem reimplementar nenhuma logica de duracao/timeline aqui (essa
 *       logica ja e testada isoladamente em matchDuration15A.test.js e
 *       matchEndDetectorDuration15C1B.test.js).
 *
 * Executar com: node tests/soloMatchDuration15C1C.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ClientConfig = require('../client/js/config');
const MatchDuration = require('../client/js/match/matchDuration');
const MatchEndDetector = require('../client/js/match/matchEndDetector');
const NoteEngine = require('../client/js/match/noteEngine');

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
const loopBody = extractFunctionBody(mainJsContent, /function loop\(\) \{/);

test('startMatchGameplay resolve selectedMatchDuration via MatchDuration.resolveMatchDuration + ClientConfig.MATCH_DURATION_MS (nenhuma tabela nova)', () => {
  assert.ok(
    /MatchDuration\.resolveMatchDuration\(\s*ClientConfig\.MATCH_DURATION_MS,\s*selectedMatchDuration\s*\)/.test(
      startMatchGameplayBody
    ),
    'startMatchGameplay deveria resolver selectedMatchDuration usando MatchDuration.resolveMatchDuration + ClientConfig.MATCH_DURATION_MS'
  );
});

test('startMatchGameplay passa durationMs e startTime (message.startTimestamp) para MatchEndDetector.createMatchEndDetector', () => {
  const detectorCallIdx = startMatchGameplayBody.indexOf('MatchEndDetector.createMatchEndDetector(');
  assert.ok(detectorCallIdx !== -1, 'createMatchEndDetector deveria ser chamado dentro de startMatchGameplay');

  const detectorCallSnippet = startMatchGameplayBody.slice(detectorCallIdx, detectorCallIdx + 400);
  assert.ok(detectorCallSnippet.includes('durationMs:'), 'a chamada deveria passar durationMs');
  assert.ok(
    detectorCallSnippet.includes('startTime: message.startTimestamp'),
    'a chamada deveria passar startTime: message.startTimestamp (o MESMO timestamp usado pela timeline, nenhum segundo relogio)'
  );
});

// NOTA: ate a Etapa 15C-1C (inclusive), este teste verificava que
// `soloDurationMs` era explicitamente zerado quando `isBotMode`
// ("Bot ainda nao integrado nesta etapa"). A partir da Etapa 15C-1D,
// o Bot TAMBEM usa a duracao resolvida (mesmo valor do Solo, repassado
// a BotMatchController.createBotMatch) -- essa integracao e coberta em
// detalhe por tests/botMatchDuration15C1D.test.js. Aqui confirmamos
// apenas que a resolucao continua sendo feita UMA UNICA vez (nenhuma
// segunda tabela/segunda chamada de resolveMatchDuration para o Bot).
test('a duracao e resolvida uma UNICA vez em startMatchGameplay (mesmo valor reutilizado pelo Bot, nenhuma segunda resolucao)', () => {
  const resolveCalls = (startMatchGameplayBody.match(/MatchDuration\.resolveMatchDuration\(/g) || []).length;
  assert.strictEqual(
    resolveCalls,
    1,
    'MatchDuration.resolveMatchDuration deveria ser chamado uma UNICA vez dentro de startMatchGameplay'
  );
});

test('startMatchGameplay nunca cria segunda timeline nem segundo relogio para a duracao (sem NoteEngine.generateNoteTimeline extra, sem Date.now direto)', () => {
  const generateTimelineOccurrences = (startMatchGameplayBody.match(/generateNoteTimeline\(/g) || []).length;
  // startMatchGameplay chama isso indiretamente via MatchTimelineManager.ensureTimeline,
  // nunca diretamente -- entao o esperado aqui e zero chamadas diretas.
  assert.strictEqual(
    generateTimelineOccurrences,
    0,
    'startMatchGameplay nao deveria chamar NoteEngine.generateNoteTimeline diretamente (a timeline e SEMPRE MatchTimelineManager.ensureTimeline)'
  );
  assert.ok(
    !startMatchGameplayBody.includes('Date.now('),
    'startMatchGameplay nao deveria ler Date.now() diretamente para a duracao'
  );
});

test('o loop existente (startExpiredNotesLoop) chama checkForEnd(getSyncedNow()), reaproveitando o MESMO relogio sincronizado', () => {
  assert.ok(
    loopBody.includes('localMatchEndDetector.checkForEnd(getSyncedNow())'),
    'o loop deveria chamar checkForEnd(getSyncedNow())'
  );
});

test('nao existe nenhum requestAnimationFrame/timer NOVO: main.js continua com exatamente os mesmos 2 requestAnimationFrame e zero setTimeout/setInterval de antes desta etapa', () => {
  const rafCount = (mainJsContent.match(/requestAnimationFrame\(/g) || []).length;
  const timeoutCount = (mainJsContent.match(/setTimeout\(/g) || []).length;
  const intervalCount = (mainJsContent.match(/setInterval\(/g) || []).length;

  // startExpiredNotesLoop tem exatamente 2 ocorrencias de requestAnimationFrame(
  // (o start inicial + a re-agenda dentro do proprio loop) -- o mesmo
  // numero de antes da Etapa 15C-1C. Nenhum setTimeout/setInterval em
  // lugar nenhum do arquivo.
  assert.strictEqual(rafCount, 2, `esperava exatamente 2 requestAnimationFrame(, encontrou ${rafCount}`);
  assert.strictEqual(timeoutCount, 0, 'main.js nao deveria conter setTimeout(');
  assert.strictEqual(intervalCount, 0, 'main.js nao deveria conter setInterval(');
});

test('o painel de duracao continua sendo o UNICO lugar que atribui selectedMatchDuration = <algo> (Multiplayer real e Modo Teste nunca passam por ele)', () => {
  const assignmentOccurrences = (mainJsContent.match(/selectedMatchDuration\s*=\s*durationId/g) || []).length;
  assert.strictEqual(
    assignmentOccurrences,
    1,
    'selectedMatchDuration so deveria ser definido a partir de um durationId escolhido em um unico lugar (o painel de selecao de duracao)'
  );
});

// =====================================================================
// (b) Comportamento real: mesma composicao que startMatchGameplay usa
// =====================================================================

/**
 * Reproduz, com os modulos REAIS, exatamente a composicao que
 * startMatchGameplay + o loop de startExpiredNotesLoop fazem:
 *   selectedMatchDuration -> MatchDuration.resolveMatchDuration -> durationMs
 *   -> MatchEndDetector.createMatchEndDetector({ timeline, durationMs, startTime })
 *   -> checkForEnd(currentTime) a cada frame (aqui, chamado manualmente).
 */
function createSoloDetector({ selectedMatchDuration, startTimestamp = 1_000_000 }) {
  const timeline = NoteEngine.generateNoteTimeline({
    seed: 15103,
    startTimestamp,
    length: 5,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });

  const soloDurationMs = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, selectedMatchDuration);

  let calls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => calls++,
    durationMs: soloDurationMs,
    startTime: startTimestamp,
  });

  return { timeline, detector, soloDurationMs, getCalls: () => calls };
}

// --- 1-8: cada identificador resolve para o ms correto (mesma tabela) ---

test('Solo recebe "30S" e resolve para 30000ms', () => {
  const { soloDurationMs } = createSoloDetector({ selectedMatchDuration: '30S' });
  assert.strictEqual(soloDurationMs, 30000);
});

test('Solo recebe "1M" e resolve para 60000ms', () => {
  const { soloDurationMs } = createSoloDetector({ selectedMatchDuration: '1M' });
  assert.strictEqual(soloDurationMs, 60000);
});

test('Solo recebe "5M" e resolve para 300000ms', () => {
  const { soloDurationMs } = createSoloDetector({ selectedMatchDuration: '5M' });
  assert.strictEqual(soloDurationMs, 300000);
});

test('Solo recebe "10M" e resolve para 600000ms', () => {
  const { soloDurationMs } = createSoloDetector({ selectedMatchDuration: '10M' });
  assert.strictEqual(soloDurationMs, 600000);
});

// --- 9-11: nao termina antes / termina exatamente no / termina depois ---

test('a partida Solo NAO termina antes do limite de duracao', () => {
  const { detector, getCalls } = createSoloDetector({ selectedMatchDuration: '30S', startTimestamp: 1_000_000 });
  assert.strictEqual(detector.checkForEnd(1_029_999), false);
  assert.strictEqual(getCalls(), 0);
});

test('a partida Solo termina exatamente ao atingir o limite de duracao', () => {
  const { detector, getCalls } = createSoloDetector({ selectedMatchDuration: '30S', startTimestamp: 1_000_000 });
  assert.strictEqual(detector.checkForEnd(1_030_000), true);
  assert.strictEqual(getCalls(), 1);
});

test('a partida Solo termina depois do limite de duracao (primeiro frame em que currentTime - startTime >= durationMs)', () => {
  const { detector, getCalls } = createSoloDetector({ selectedMatchDuration: '30S', startTimestamp: 1_000_000 });
  const frames = [1_010_000, 1_020_000, 1_029_000, 1_031_500, 1_040_000];
  const results = frames.map((currentTime) => detector.checkForEnd(currentTime));
  assert.deepStrictEqual(results, [false, false, false, true, false]);
  assert.strictEqual(getCalls(), 1);
});

// --- 12: timeline continua podendo finalizar normalmente ---

test('a timeline ainda pode finalizar a partida Solo normalmente, mesmo com durationMs configurado e longe de ser atingido', () => {
  const { timeline, detector, getCalls } = createSoloDetector({
    selectedMatchDuration: '10M', // limite bem distante (600000ms)
    startTimestamp: 1_000_000,
  });

  timeline.forEach((note) => {
    note.state = NoteEngine.NOTE_STATE.HIT;
  });

  assert.strictEqual(detector.checkForEnd(1_010_000), true);
  assert.strictEqual(getCalls(), 1);
});

// --- 13: ausencia de duracao mantem o comportamento antigo ---

test('sem selectedMatchDuration (null), o comportamento antigo e mantido: so a timeline encerra a partida Solo', () => {
  const { timeline, detector, soloDurationMs, getCalls } = createSoloDetector({
    selectedMatchDuration: null,
    startTimestamp: 1_000_000,
  });

  assert.strictEqual(soloDurationMs, null);

  // Mesmo bem depois do que seria qualquer limite razoavel, sem timeline
  // concluida a partida continua rodando.
  assert.strictEqual(detector.checkForEnd(1_999_999_999), false);
  assert.strictEqual(getCalls(), 0);

  timeline.forEach((note) => {
    note.state = NoteEngine.NOTE_STATE.MISSED;
  });
  assert.strictEqual(detector.checkForEnd(1_999_999_999), true);
  assert.strictEqual(getCalls(), 1);
});

test('selectedMatchDuration invalido (nao presente em ClientConfig.MATCH_DURATION_MS) tambem preserva o comportamento antigo', () => {
  const { soloDurationMs, detector } = createSoloDetector({
    selectedMatchDuration: 'ALGO_INVALIDO',
    startTimestamp: 1_000_000,
  });
  assert.strictEqual(soloDurationMs, null);
  assert.strictEqual(detector.checkForEnd(9_999_999), false);
});

// --- 14-15: nenhum timer/loop adicional (ja cobertos estaticamente acima,
// reforcados aqui verificando que o proprio modulo MatchEndDetector
// tambem no nunca cria nada disso, ver Etapa 15C-1B) ---

test('MatchEndDetector (usado pelo Solo) continua sem Date.now/performance.now/setTimeout/setInterval proprios', () => {
  const detectorPath = path.join(__dirname, '../client/js/match/matchEndDetector.js');
  const detectorContent = fs.readFileSync(detectorPath, 'utf8');
  ['Date.now(', 'performance.now(', 'setTimeout(', 'setInterval(', 'requestAnimationFrame('].forEach((forbidden) => {
    assert.ok(!detectorContent.includes(forbidden), `matchEndDetector.js nao deveria conter "${forbidden}"`);
  });
});

test('nao existe um segundo requestAnimationFrame dedicado a duracao: startExpiredNotesLoop continua sendo o UNICO loop que chama checkForEnd', () => {
  const checkForEndCallers = (mainJsContent.match(/\.checkForEnd\(/g) || []).length;
  assert.strictEqual(checkForEndCallers, 1, 'checkForEnd deveria ser chamado a partir de um UNICO lugar em main.js');
});

// --- 16: Multiplayer nao utiliza selectedMatchDuration ---

test('"Criar sala" e "Entrar em sala" (Multiplayer real) zeram selectedMatchDuration antes de pedir a sala ao servidor', () => {
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
      'o clique deveria zerar selectedMatchDuration antes de iniciar uma sala de Multiplayer real'
    );
  });
});

// --- 17: a partir da Etapa 15C-1D, o Bot TAMBEM usa a duracao ---
// (ver tests/botMatchDuration15C1D.test.js para a cobertura completa;
// o item "Bot ainda nao integrado" era valido ate a Etapa 15C-1C).

// --- 18: Modo Teste ainda nao integrado nesta etapa ---

test('Modo Teste nunca define selectedMatchDuration (permanece null, preservando o comportamento antigo)', () => {
  // Modo Teste reutiliza o MESMO pipeline de partida do Solo
  // (start_solo_match) sem passar pelo painel de selecao de duracao --
  // ou seja, sem NENHUM data-duration clicado, resolveMatchDuration
  // sempre cai no fallback (null), exatamente como demonstrado no teste
  // "sem selectedMatchDuration" acima. Aqui confirmamos que o UNICO
  // ponto de atribuicao de selectedMatchDuration = <durationId> (ja
  // verificado estaticamente acima) esta dentro do listener dos botoes
  // do painel de duracao -- nunca em nenhum outro fluxo/handler de
  // 'test_message'/Modo Teste.
  const testMessageHandlerIdx = mainJsContent.indexOf("btn-send-test");
  const testMessageHandlerBody = mainJsContent.slice(testMessageHandlerIdx, testMessageHandlerIdx + 300);
  assert.ok(
    !testMessageHandlerBody.includes('selectedMatchDuration'),
    'o fluxo de teste manual (btn-send-test) nao deveria mexer em selectedMatchDuration'
  );
});

console.log(`\n${passed} teste(s) passaram.`);
