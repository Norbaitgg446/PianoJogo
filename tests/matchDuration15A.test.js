/**
 * ETAPA 15A (PARTE 1): preparacao da arquitetura de duracao das partidas.
 *
 * IMPORTANTE: esta etapa e SOMENTE arquitetura -- nenhuma partida termina
 * mais cedo por causa disto ainda. Nenhuma tela/botao/timer visual e
 * criado. A duracao real das partidas fica para uma proxima parte da
 * Etapa 15.
 *
 * Este arquivo testa:
 *   - os quatro identificadores de duracao existem (ClientConfig.MATCH_DURATION_IDS);
 *   - cada identificador resolve para o numero de ms esperado
 *     (MatchDuration.resolveMatchDuration + ClientConfig.MATCH_DURATION_MS);
 *   - identificador invalido cai no fallback seguro;
 *   - nenhuma duracao informada preserva o comportamento antigo (fallback);
 *   - resolveMatchDuration e pura (mesma entrada -> mesma saida, nunca
 *     muta a tabela recebida);
 *   - nem resolveMatchDuration nem o modulo matchDuration.js usam
 *     Date.now()/setTimeout/setInterval/DOM (nenhuma funcao inicia timer);
 *   - Bot (BotMatchController/BotController) continua aceitando sua
 *     configuracao normalmente, agora tambem aceitando durationMs sem
 *     mudar de comportamento;
 *   - MatchEndDetector continua decidindo o fim EXCLUSIVAMENTE pela
 *     timeline, mesmo quando um durationMs e informado;
 *   - Solo/Modo Teste/Multiplayer continuam funcionando;
 *   - a timeline nao e alterada nesta etapa.
 *
 * Mesmo estilo dos demais arquivos de teste do projeto (ex:
 * tests/botDifficulty14D1.test.js): exercita os modulos REAIS, nunca
 * reimplementa nada.
 *
 * Executar com: node tests/matchDuration15A.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ClientConfig = require('../client/js/config');
const MatchDuration = require('../client/js/match/matchDuration');
const MatchTimelineManager = require('../client/js/match/matchTimelineManager');
const MatchEndDetector = require('../client/js/match/matchEndDetector');
const NoteEngine = require('../client/js/match/noteEngine');
const BotController = require('../client/js/match/botController');
const BotMatchController = require('../client/js/match/botMatchController');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const PlayerState = require('../client/js/match/playerState');
const LocalServerSimulator = require('../client/js/network/localServerSimulator');

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

const WINDOWS = { perfectMs: 60, greatMs: 200, goodMs: 1800 };

// =====================================================================
// 1. Identificadores de duracao
// =====================================================================

test('ClientConfig.MATCH_DURATION_IDS existe e define os quatro identificadores esperados', () => {
  assert.ok(ClientConfig.MATCH_DURATION_IDS, 'esperava ClientConfig.MATCH_DURATION_IDS definido');
  assert.strictEqual(ClientConfig.MATCH_DURATION_IDS.THIRTY_SECONDS, '30S');
  assert.strictEqual(ClientConfig.MATCH_DURATION_IDS.ONE_MINUTE, '1M');
  assert.strictEqual(ClientConfig.MATCH_DURATION_IDS.FIVE_MINUTES, '5M');
  assert.strictEqual(ClientConfig.MATCH_DURATION_IDS.TEN_MINUTES, '10M');
});

test('ClientConfig.MATCH_DURATION_MS possui uma entrada para cada identificador', () => {
  Object.values(ClientConfig.MATCH_DURATION_IDS).forEach((id) => {
    assert.ok(
      Number.isFinite(ClientConfig.MATCH_DURATION_MS[id]),
      `esperava ClientConfig.MATCH_DURATION_MS['${id}'] definido e finito`
    );
  });
});

// =====================================================================
// 2. resolveMatchDuration -- cada identificador -> ms esperado
// =====================================================================

test('30 segundos resolve para 30000ms', () => {
  const ms = MatchDuration.resolveMatchDuration(
    ClientConfig.MATCH_DURATION_MS,
    ClientConfig.MATCH_DURATION_IDS.THIRTY_SECONDS
  );
  assert.strictEqual(ms, 30000);
});

test('1 minuto resolve para 60000ms', () => {
  const ms = MatchDuration.resolveMatchDuration(
    ClientConfig.MATCH_DURATION_MS,
    ClientConfig.MATCH_DURATION_IDS.ONE_MINUTE
  );
  assert.strictEqual(ms, 60000);
});

test('5 minutos resolve para 300000ms', () => {
  const ms = MatchDuration.resolveMatchDuration(
    ClientConfig.MATCH_DURATION_MS,
    ClientConfig.MATCH_DURATION_IDS.FIVE_MINUTES
  );
  assert.strictEqual(ms, 300000);
});

test('10 minutos resolve para 600000ms', () => {
  const ms = MatchDuration.resolveMatchDuration(
    ClientConfig.MATCH_DURATION_MS,
    ClientConfig.MATCH_DURATION_IDS.TEN_MINUTES
  );
  assert.strictEqual(ms, 600000);
});

// =====================================================================
// 3. Fallback seguro
// =====================================================================

test('identificador invalido cai no fallback informado', () => {
  const ms = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, 'LENDARIO', 'FALLBACK');
  assert.strictEqual(ms, 'FALLBACK');
});

test('identificador invalido sem fallback explicito cai em null (fallback padrao)', () => {
  const ms = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, 'LENDARIO');
  assert.strictEqual(ms, null);
});

test('duracao nao informada (undefined) preserva o comportamento antigo (fallback null por padrao)', () => {
  const ms = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, undefined);
  assert.strictEqual(ms, null);
});

test('chamar resolveMatchDuration() sem nenhum argumento nunca lanca erro e cai no fallback padrao', () => {
  assert.strictEqual(MatchDuration.resolveMatchDuration(), null);
});

test('tabela de duracoes ausente (undefined) tambem cai no fallback informado', () => {
  const ms = MatchDuration.resolveMatchDuration(undefined, '1M', -1);
  assert.strictEqual(ms, -1);
});

// =====================================================================
// 4. Funcao pura
// =====================================================================

test('resolveMatchDuration e pura: mesma entrada sempre devolve a mesma saida', () => {
  const a = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, '5M');
  const b = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, '5M');
  assert.strictEqual(a, b);
});

test('resolveMatchDuration nunca muta a tabela de duracoes recebida', () => {
  const table = { ...ClientConfig.MATCH_DURATION_MS };
  const before = { ...table };

  MatchDuration.resolveMatchDuration(table, '1M');
  MatchDuration.resolveMatchDuration(table, 'INEXISTENTE', 12345);

  assert.deepStrictEqual(table, before);
});

test('resolveMatchDuration nunca muta ClientConfig.MATCH_DURATION_MS original', () => {
  const before = { ...ClientConfig.MATCH_DURATION_MS };
  MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, '10M');
  assert.deepStrictEqual(ClientConfig.MATCH_DURATION_MS, before);
});

// =====================================================================
// 5. Nenhuma funcao acessa relogio/DOM nem inicia timer
// =====================================================================

test('client/js/match/matchDuration.js nunca referencia Date.now/setTimeout/setInterval/document', () => {
  const filePath = path.join(__dirname, '../client/js/match/matchDuration.js');
  const content = fs.readFileSync(filePath, 'utf8');

  ['Date.now(', 'setTimeout(', 'setInterval(', 'document.'].forEach((forbidden) => {
    assert.ok(
      !content.includes(forbidden),
      `matchDuration.js nao deveria conter "${forbidden}" (funcao precisa ser pura, sem relogio/timer/DOM)`
    );
  });
});

// =====================================================================
// 6. Bot continua aceitando sua configuracao normalmente (agora com durationMs)
// =====================================================================

test('BotMatchController.createBotMatch() sem durationMs continua identico a antes (durationMs undefined)', () => {
  MatchTimelineManager.clear();
  const timeline = MatchTimelineManager.ensureTimeline({
    seed: 15001,
    startTimestamp: 1_000_000,
    length: 6,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });

  const botMatch = BotMatchController.createBotMatch({ timeline, windows: WINDOWS });

  assert.strictEqual(botMatch.durationMs, undefined);
  assert.deepStrictEqual(botMatch.config, BotController.DEFAULT_CONFIG);
  assert.strictEqual(botMatch.entries.length, timeline.length);

  MatchTimelineManager.clear();
});

test('BotMatchController.createBotMatch({ durationMs }) guarda o valor recebido sem alterar o comportamento do Bot', () => {
  MatchTimelineManager.clear();
  const timeline = MatchTimelineManager.ensureTimeline({
    seed: 15002,
    startTimestamp: 1_000_000,
    length: 6,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });

  const durationMs = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, '1M');
  const botMatch = BotMatchController.createBotMatch({ timeline, windows: WINDOWS, durationMs });

  assert.strictEqual(botMatch.durationMs, 60000);
  // O Bot decide TODAS as notas da timeline normalmente, independente
  // de durationMs -- nenhum encerramento antecipado.
  assert.strictEqual(botMatch.entries.length, timeline.length);
  assert.strictEqual(botMatch.finished, false);

  MatchTimelineManager.clear();
});

test('BotMatchController.reset() preserva durationMs anterior quando nenhum novo e informado', () => {
  MatchTimelineManager.clear();
  const timeline = MatchTimelineManager.ensureTimeline({
    seed: 15003,
    startTimestamp: 1_000_000,
    length: 4,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });

  const botMatch = BotMatchController.createBotMatch({ timeline, windows: WINDOWS, durationMs: 300000 });
  BotMatchController.reset(botMatch, {});

  assert.strictEqual(botMatch.durationMs, 300000);

  MatchTimelineManager.clear();
});

// =====================================================================
// 7. MatchEndDetector continua decidindo o fim EXCLUSIVAMENTE pela timeline
// =====================================================================

test('MatchEndDetector.createMatchEndDetector() sem durationMs continua identico a antes', () => {
  const timeline = NoteEngine.generateNoteTimeline({
    seed: 15004,
    startTimestamp: 1_000_000,
    length: 3,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });

  const detector = MatchEndDetector.createMatchEndDetector({ timeline, onMatchEnd: () => {} });
  assert.strictEqual(detector.getDurationMs(), undefined);
  assert.strictEqual(detector.hasEnded(), false);
});

test('MatchEndDetector com durationMs informado ainda so termina quando a timeline termina (nenhum encerramento antecipado)', () => {
  const timeline = NoteEngine.generateNoteTimeline({
    seed: 15005,
    startTimestamp: 1_000_000,
    length: 3,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });

  let endedCount = 0;
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => {
      endedCount += 1;
    },
    durationMs: 30000,
  });

  assert.strictEqual(detector.getDurationMs(), 30000);

  // Timeline ainda em andamento (nenhuma nota terminal) -- nao deveria
  // terminar so porque um durationMs foi informado.
  assert.strictEqual(detector.checkForEnd(), false);
  assert.strictEqual(endedCount, 0);

  // So termina quando a timeline de fato termina, exatamente como antes.
  timeline.forEach((note) => {
    note.state = NoteEngine.NOTE_STATE.HIT;
  });
  assert.strictEqual(detector.checkForEnd(), true);
  assert.strictEqual(endedCount, 1);
});

// =====================================================================
// 8. Timeline nao e alterada nesta etapa
// =====================================================================

test('resolver uma duracao e criar um BotMatch com durationMs nao muta a timeline recebida', () => {
  MatchTimelineManager.clear();
  const timeline = MatchTimelineManager.ensureTimeline({
    seed: 15006,
    startTimestamp: 1_000_000,
    length: 5,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });
  const before = timeline.map((note) => ({ ...note }));

  const durationMs = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, '30S');
  BotMatchController.createBotMatch({ timeline, windows: WINDOWS, durationMs });

  assert.deepStrictEqual(
    timeline.map((note) => ({ ...note })),
    before
  );

  MatchTimelineManager.clear();
});

// =====================================================================
// 9. Solo continua funcionando
// =====================================================================

test('Solo (GameplayEngine + MatchTimelineManager) continua funcionando normalmente com a preparacao de duracao carregada', () => {
  MatchTimelineManager.clear();
  const timeline = MatchTimelineManager.ensureTimeline({
    seed: 15007,
    startTimestamp: 1_000_000,
    length: 4,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 1000,
  });

  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: { perfectMs: 60, goodMs: 150 },
    scoreValues: { PERFECT: 300, GOOD: 100, MISS: 0 },
  });

  const note = timeline[0];
  const result = engine.handleKeyPress(note.lane, note.time);

  assert.strictEqual(result.outcome, 'PERFECT');
  assert.strictEqual(playerState.hits, 1);
  assert.strictEqual(playerState.score, 300);

  MatchTimelineManager.clear();
});

// =====================================================================
// 10. Modo Teste e Multiplayer continuam intactos
// =====================================================================

test('LocalServerSimulator (Modo Teste) mantem sua API intacta com a preparacao de duracao carregada', () => {
  assert.strictEqual(typeof LocalServerSimulator.createLocalConnection, 'function');
});

test('LocalServerSimulator ainda reproduz normalmente o fluxo Solo (room_created .. match_ready)', () => {
  const messages = [];
  const connection = LocalServerSimulator.createLocalConnection({
    onMessage: (message) => messages.push(message),
    onStatusChange: () => {},
    countdownMs: 0,
  });

  connection.send('start_solo_match');

  const types = messages.map((m) => m.type);
  assert.ok(types.includes('room_created'));
  assert.ok(types.includes('match_ready'));
});

test('LocalServerSimulator continua recusando create_room/join_room (multiplayer exige servidor real)', () => {
  const messages = [];
  const connection = LocalServerSimulator.createLocalConnection({
    onMessage: (message) => messages.push(message),
    onStatusChange: () => {},
    countdownMs: 0,
  });

  connection.send('create_room');

  const errorMessage = messages.find((m) => m.type === 'error');
  assert.ok(errorMessage, 'multiplayer local deveria responder com error, nunca fingir sucesso');
});

test('a preparacao de duracao (Etapa 15A) nao vazou para nenhum arquivo do servidor ALEM dos que a ETAPA 15C-MP — Parte 1 introduziu explicitamente para o Multiplayer', () => {
  // ATE a Etapa 15C-1D (inclusive), esta asssercao exigia a lista vazia:
  // nenhum arquivo do servidor conhecia MATCH_DURATION, porque Solo/Bot
  // resolviam/aplicavam a duracao inteiramente no cliente. A Etapa
  // 15C-MP — Parte 1 (ver tests/matchDurationMultiplayer15CMP1.test.js)
  // muda esse cenario DE PROPOSITO, mas SOMENTE para o MULTIPLAYER: o
  // servidor passou a ser a autoridade sobre qual duracao os dois
  // jogadores usam (mesmo padrao ja usado para musica em
  // server/music/musicSelectionFlow.js), reutilizando EXCLUSIVAMENTE
  // ClientConfig.MATCH_DURATION_MS/MatchDuration.resolveMatchDuration --
  // nenhuma tabela nova. Esta lista e a whitelist FECHADA dos unicos
  // arquivos que deveriam ter mudado por causa disso; qualquer outro
  // arquivo do servidor (gameplayFlow.js, matchOutcome.js,
  // matchAbandonment.js, finalMatchState.js, etc.) continua sem
  // nenhum conhecimento de duracao, exatamente como antes -- o
  // encerramento por tempo em si AINDA NAO existe em nenhum lugar.
  const ALLOWED_FILES = [
    path.join(__dirname, '../server/match/Match.js'),
    path.join(__dirname, '../server/match/matchFlow.js'),
    path.join(__dirname, '../server/match/matchDurationSelectionFlow.js'),
    path.join(__dirname, '../server/match/rematchFlow.js'),
    path.join(__dirname, '../server/ws/messageRouter.js'),
    path.join(__dirname, '../server/room/leaveRoomFlow.js'),
    path.join(__dirname, '../server/ws/connectionHandler.js'),
  ];

  const serverDir = path.join(__dirname, '../server');

  function walk(dir) {
    let matches = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        matches = matches.concat(walk(fullPath));
      } else if (entry.name.endsWith('.js')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        // NOTA: "durationMs" sozinho NAO e usado aqui como sinal -- o
        // catalogo de musicas (server/music/musicCatalog.js) ja usa
        // esse mesmo nome de campo para a duracao da MUSICA (nada a
        // ver com duracao de PARTIDA), desde muito antes desta etapa.
        // "MATCH_DURATION"/"durationId" sao inequivocos: so aparecem
        // no contexto de duracao de partida.
        if (content.includes('MATCH_DURATION') || content.includes('durationId')) {
          matches.push(fullPath);
        }
      }
    }
    return matches;
  }

  const touched = walk(serverDir);
  const unexpected = touched.filter((file) => !ALLOWED_FILES.includes(file));
  assert.deepStrictEqual(
    unexpected,
    [],
    'nenhum arquivo do servidor ALEM da whitelist da Etapa 15C-MP — Parte 1 deveria conhecer duracao'
  );
});

console.log(`\n${passed} teste(s) passaram.`);
