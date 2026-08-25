/**
 * ETAPA 15C-MP — Parte 2: Integrar o encerramento por duracao no
 * Multiplayer.
 *
 * A Parte 1 (tests/matchDurationMultiplayer15CMP1.test.js) ja validou o
 * TRANSPORTE da duracao ate a Match Multiplayer no SERVIDOR (os dois
 * jogadores recebem o mesmo `durationId`/`durationMs` em `toPublicJSON`).
 * Esta Parte 2 NAO adiciona nenhuma logica nova de tempo -- ela liga o
 * valor ja transportado ao MESMO `MatchEndDetector` que Solo/Bot ja usam
 * (Etapa 15C-1B/1C/1D), no cliente, reaproveitando:
 *
 *   - MatchDuration.hasReachedMatchDuration() (Etapa 15C-1A);
 *   - MatchEndDetector.createMatchEndDetector()/checkForEnd() (Etapa 15C-1B);
 *   - o MESMO `startTimestamp` que ja sincroniza os dois jogadores
 *     (Etapa 5B-2B/5B-3A) -- nunca um segundo relogio;
 *   - o loop de `requestAnimationFrame` que main.js ja possui
 *     (`startExpiredNotesLoop`) -- nenhum `setTimeout`/`setInterval`/
 *     novo `requestAnimationFrame` e introduzido.
 *
 * Estrategia desta suite (mesma ja usada por
 * botMatchDurationFullFlow15C1D3.test.js):
 *
 *   (a) INTEGRACAO DE SERVIDOR: cria uma Match Multiplayer real (dois
 *       sockets mockados, RoomManager/MatchManager/messageRouter
 *       reais) com uma duracao selecionada, e confirma que os DOIS
 *       jogadores recebem, em `match_ready`/`match_countdown_start`, o
 *       mesmo `durationId`/`durationMs`/`startTimestamp` -- exatamente
 *       o que `startMatchGameplay` (main.js) vai consumir quando
 *       `match_started` chegar;
 *
 *   (b) COMPOSICAO REAL client-side: usa os MODULOS REAIS
 *       (MatchDuration, MatchEndDetector, NoteEngine) montados
 *       EXATAMENTE como `startMatchGameplay` faz para o Multiplayer
 *       (durationMs do servidor + startTime = startTimestamp), para
 *       provar que dois detectores INDEPENDENTES (um por "cliente",
 *       simulando os dois navegadores) encerram no MESMO instante;
 *
 *   (c) INSPECAO ESTATICA de client/js/main.js -- confirma que a
 *       formula introduzida nesta parte usa somente os modulos
 *       existentes, nao le nenhum relogio novo e nao cria nenhum
 *       timer/intervalo/loop novo.
 *
 * Executar com: node tests/matchDurationMultiplayerEnd15CMP2.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ClientConfig = require('../client/js/config');
const MatchEndDetector = require('../client/js/match/matchEndDetector');
const NoteEngine = require('../client/js/match/noteEngine');

const MatchManager = require('../server/match/MatchManager');
const { MATCH_MODE } = require('../server/match/Match');
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
// Harness de servidor (mesmo padrao de matchDurationMultiplayer15CMP1.test.js)
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
    close() {},
    _handlers: handlers,
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
 * Simula, com os modulos REAIS do cliente, exatamente o que
 * `startMatchGameplay` monta para UM jogador do Multiplayer real: uma
 * timeline propria (mesma seed/mesmo startTimestamp que o servidor
 * mandou) e um MatchEndDetector alimentado por `durationMs`
 * (vindo de `message.match.durationMs`) e `startTime`
 * (vindo de `message.startTimestamp`) -- a MESMA formula introduzida em
 * main.js nesta Parte 2 (aqui reproduzida em isolamento, nunca
 * duplicando a logica de tempo em si, so a composicao das pecas).
 */
function createClientEndDetectorForMultiplayer({ startTimestamp, durationMs, seed = 555, length = 200 }) {
  const timeline = NoteEngine.generateNoteTimeline({
    seed,
    startTimestamp,
    length,
    noteRange: 4,
    noteIntervalMs: 600,
    leadInMs: 0,
  });

  let endedAtTime = null;
  let endCalls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => {
      endCalls++;
    },
    durationMs,
    startTime: startTimestamp,
  });

  function tick(currentTime) {
    const justEnded = detector.checkForEnd(currentTime);
    if (justEnded) endedAtTime = currentTime;
    return justEnded;
  }

  return {
    timeline,
    detector,
    tick,
    hasEnded: () => detector.hasEnded(),
    endCallCount: () => endCalls,
    endedAtTime: () => endedAtTime,
  };
}

// =====================================================================
// BLOCO A -- 30S / 1M / 5M / 10M encerram a Match Multiplayer
// =====================================================================

['30S', '1M', '5M', '10M'].forEach((durationId) => {
  test(`[A] MatchEndDetector encerra a partida de "${durationId}" exatamente no limite (currentTime - startTime === durationMs)`, () => {
    const durationMs = ClientConfig.MATCH_DURATION_MS[durationId];
    const startTimestamp = 2_000_000;
    const client = createClientEndDetectorForMultiplayer({ startTimestamp, durationMs });

    // Um instante antes do limite: NAO termina.
    assert.strictEqual(client.tick(startTimestamp + durationMs - 1), false);
    assert.strictEqual(client.hasEnded(), false);

    // Exatamente no limite: termina.
    assert.strictEqual(client.tick(startTimestamp + durationMs), true);
    assert.strictEqual(client.hasEnded(), true);
    assert.strictEqual(client.endCallCount(), 1);
  });

  test(`[A] "${durationId}" chega a uma Match Multiplayer real com o mesmo durationMs para os dois jogadores`, () => {
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();
    registerConnection(ws1);
    registerConnection(ws2);

    send(ws1, { type: 'create_room' });
    const roomCode = lastOfType(ws1, 'room_created').roomCode;
    send(ws1, { type: 'select_duration', durationId });
    send(ws2, { type: 'join_room', roomCode });

    const readyForP1 = lastOfType(ws1, 'match_ready').match;
    const readyForP2 = lastOfType(ws2, 'match_ready').match;
    assert.strictEqual(readyForP1.durationMs, ClientConfig.MATCH_DURATION_MS[durationId]);
    assert.strictEqual(readyForP1.durationMs, readyForP2.durationMs);
  });
});

// =====================================================================
// BLOCO B -- antes / exatamente / depois do limite
// =====================================================================

test('[B] antes do limite: MatchEndDetector nao encerra a partida', () => {
  const durationMs = ClientConfig.MATCH_DURATION_MS['1M'];
  const startTimestamp = 10_000;
  const client = createClientEndDetectorForMultiplayer({ startTimestamp, durationMs });

  assert.strictEqual(client.tick(startTimestamp), false);
  assert.strictEqual(client.tick(startTimestamp + durationMs / 2), false);
  assert.strictEqual(client.tick(startTimestamp + durationMs - 1), false);
  assert.strictEqual(client.hasEnded(), false);
});

test('[B] exatamente no limite: MatchEndDetector encerra a partida (currentTime - startTime === durationMs)', () => {
  const durationMs = ClientConfig.MATCH_DURATION_MS['30S'];
  const startTimestamp = 50_000;
  const client = createClientEndDetectorForMultiplayer({ startTimestamp, durationMs });

  const justEnded = client.tick(startTimestamp + durationMs);
  assert.strictEqual(justEnded, true);
  assert.strictEqual(client.hasEnded(), true);
});

test('[B] depois do limite: MatchEndDetector tambem encerra a partida (currentTime - startTime > durationMs)', () => {
  const durationMs = ClientConfig.MATCH_DURATION_MS['30S'];
  const startTimestamp = 50_000;
  const client = createClientEndDetectorForMultiplayer({ startTimestamp, durationMs });

  const justEnded = client.tick(startTimestamp + durationMs + 5000);
  assert.strictEqual(justEnded, true);
  assert.strictEqual(client.hasEnded(), true);
});

test('[B] uma vez encerrada, chamadas seguintes de checkForEnd nao re-emitem o fim (nenhum segundo match_end)', () => {
  const durationMs = ClientConfig.MATCH_DURATION_MS['30S'];
  const startTimestamp = 50_000;
  const client = createClientEndDetectorForMultiplayer({ startTimestamp, durationMs });

  client.tick(startTimestamp + durationMs);
  client.tick(startTimestamp + durationMs + 1000);
  client.tick(startTimestamp + durationMs + 2000);

  assert.strictEqual(client.endCallCount(), 1);
});

// =====================================================================
// BLOCO C -- a timeline continua sendo uma condicao valida de encerramento
// =====================================================================

test('[C] se a timeline terminar ANTES da duracao maxima, a partida encerra pela timeline (comportamento antigo preservado)', () => {
  const durationMs = ClientConfig.MATCH_DURATION_MS['10M']; // bem maior que a timeline
  const startTimestamp = 100_000;
  const client = createClientEndDetectorForMultiplayer({
    startTimestamp,
    durationMs,
    length: 3,
    seed: 999,
  });

  // Marca manualmente todas as notas como terminadas (mesmo mecanismo
  // ja usado pelo GameplayEngine/NoteEngine -- nenhuma logica nova).
  client.timeline.forEach((note) => {
    NoteEngine.setNoteState(client.timeline, note.id, NoteEngine.NOTE_STATE.HIT);
  });

  // currentTime ainda MUITO longe de atingir a duracao maxima.
  const justEnded = client.tick(startTimestamp + 1000);
  assert.strictEqual(justEnded, true);
  assert.strictEqual(client.hasEnded(), true);
});

test('[C] sem duracao configurada (durationMs null/ausente), a partida so encerra pela timeline, exatamente como antes desta etapa', () => {
  const startTimestamp = 100_000;
  const client = createClientEndDetectorForMultiplayer({
    startTimestamp,
    durationMs: null,
    length: 2,
    seed: 4242,
  });

  // Um currentTime enorme nao encerra nada sozinho, porque nao ha
  // duracao configurada.
  assert.strictEqual(client.tick(startTimestamp + 999_999_999), false);

  client.timeline.forEach((note) => {
    NoteEngine.setNoteState(client.timeline, note.id, NoteEngine.NOTE_STATE.MISSED);
  });
  assert.strictEqual(client.tick(startTimestamp + 1_000_000_000), true);
});

// =====================================================================
// BLOCO D -- mesmo startTimestamp / mesma duracao / encerramento sincronizado
// =====================================================================

test('[D] dois jogadores (dois detectores independentes) com o MESMO startTimestamp/durationMs encerram no MESMO currentTime', () => {
  const durationMs = ClientConfig.MATCH_DURATION_MS['5M'];
  const startTimestamp = 777_000;

  // Duas instancias completamente independentes, como dois clientes
  // (browsers) diferentes -- nenhum estado compartilhado entre elas.
  const player1 = createClientEndDetectorForMultiplayer({ startTimestamp, durationMs, seed: 1 });
  const player2 = createClientEndDetectorForMultiplayer({ startTimestamp, durationMs, seed: 1 });

  const beforeLimit = startTimestamp + durationMs - 500;
  const atLimit = startTimestamp + durationMs;

  assert.strictEqual(player1.tick(beforeLimit), false);
  assert.strictEqual(player2.tick(beforeLimit), false);

  const p1Ended = player1.tick(atLimit);
  const p2Ended = player2.tick(atLimit);

  assert.strictEqual(p1Ended, true);
  assert.strictEqual(p2Ended, true);
  assert.strictEqual(player1.hasEnded(), true);
  assert.strictEqual(player2.hasEnded(), true);
});

test('[D] os dois jogadores de uma Match Multiplayer real recebem o mesmo durationId/durationMs/startTimestamp (transporte da Parte 1, agora consumido pela Parte 2)', () => {
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  registerConnection(ws1);
  registerConnection(ws2);

  send(ws1, { type: 'create_room' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  send(ws1, { type: 'select_duration', durationId: '1M' });
  send(ws2, { type: 'join_room', roomCode });

  const readyForP1 = lastOfType(ws1, 'match_ready');
  const readyForP2 = lastOfType(ws2, 'match_ready');
  assert.strictEqual(readyForP1.match.durationId, '1M');
  assert.strictEqual(readyForP2.match.durationId, '1M');
  assert.strictEqual(readyForP1.match.durationMs, readyForP2.match.durationMs);

  const countdownP1 = lastOfType(ws1, 'match_countdown_start');
  const countdownP2 = lastOfType(ws2, 'match_countdown_start');
  assert.strictEqual(countdownP1.startTimestamp, countdownP2.startTimestamp);

  // Simula, com os valores REAIS recebidos pelos dois "clientes", o
  // encerramento local de cada um -- devem terminar juntos.
  const durationMs = readyForP1.match.durationMs;
  const startTimestamp = countdownP1.startTimestamp;
  const player1 = createClientEndDetectorForMultiplayer({ startTimestamp, durationMs, seed: 42 });
  const player2 = createClientEndDetectorForMultiplayer({ startTimestamp, durationMs, seed: 42 });

  const atLimit = startTimestamp + durationMs;
  assert.strictEqual(player1.tick(atLimit), true);
  assert.strictEqual(player2.tick(atLimit), true);
});

// =====================================================================
// BLOCO E -- nenhum timer/relogio novo
// =====================================================================

test('[E] a formula introduzida em main.js (resolvedMatchDurationMs para Multiplayer) nao le nenhum relogio novo', () => {
  const mainJs = fs.readFileSync(path.join(__dirname, '../client/js/main.js'), 'utf8');
  const marker = 'ETAPA 15C-MP — Parte 2';
  const idx = mainJs.indexOf(marker);
  assert.ok(idx !== -1, 'marcador da Parte 2 nao encontrado em main.js');

  // Pega o trecho ao redor do marcador (comentario + formula) e garante
  // que nenhum relogio/temporizador novo aparece ali.
  const snippet = mainJs.slice(idx, idx + 2000);
  ['setTimeout(', 'setInterval(', 'performance.now(', 'new Date('].forEach((forbidden) => {
    assert.ok(!snippet.includes(forbidden), `nao deveria conter "${forbidden}" perto da Parte 2`);
  });
  // A UNICA leitura de "agora" continua sendo Date.now() dentro de
  // getSyncedNow() (Etapa 5B-2B, muito antes desta etapa) -- este
  // trecho da Parte 2 em si NUNCA chama Date.now() diretamente.
  assert.ok(!snippet.includes('Date.now('), 'a formula da Parte 2 nao deveria chamar Date.now() diretamente');
});

test('[E] main.js continua usando um UNICO loop (startExpiredNotesLoop) e um UNICO localMatchEndDetector para qualquer modo', () => {
  const mainJs = fs.readFileSync(path.join(__dirname, '../client/js/main.js'), 'utf8');
  // So existe UMA definicao de cada -- nenhum loop/detector paralelo
  // foi criado especificamente para o Multiplayer nesta etapa.
  const startLoopDeclarations = (mainJs.match(/function startExpiredNotesLoop/g) || []).length;
  const createDetectorCalls = (mainJs.match(/MatchEndDetector\.createMatchEndDetector\(/g) || []).length;
  assert.strictEqual(startLoopDeclarations, 1);
  assert.strictEqual(createDetectorCalls, 1);
});

test('[E] matchEndDetector.js e matchDuration.js continuam sem relogio proprio (nenhum Date.now/performance.now/setTimeout/setInterval)', () => {
  ['../client/js/match/matchEndDetector.js', '../client/js/match/matchDuration.js'].forEach((relPath) => {
    const content = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
    ['Date.now(', 'performance.now(', 'setTimeout(', 'setInterval(', 'requestAnimationFrame('].forEach((forbidden) => {
      assert.ok(!content.includes(forbidden), `${relPath} nao deveria conter "${forbidden}"`);
    });
  });
});

// =====================================================================
// BLOCO F -- Solo e Bot continuam funcionando (nao regrediram)
// =====================================================================

test('[F] Solo: a Match nunca recebe durationMs do servidor (server nunca atribui duracao a Solo)', () => {
  const ws1 = createMockSocket();
  registerConnection(ws1);
  send(ws1, { type: 'start_solo_match' });

  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.mode, MATCH_MODE.SOLO);
  // Confirma a premissa usada pela formula da Parte 2 em main.js: o
  // servidor NUNCA preenche durationMs para Solo, entao o `??` da
  // formula sempre cai para o lado esquerdo (selectedMatchDuration,
  // exclusivo do cliente) para este modo -- nenhuma mudanca de
  // comportamento para Solo.
  assert.strictEqual(match.durationMs, null);
});

test('[F] Bot: mesma premissa do Solo -- a Match do Bot tambem nunca recebe durationMs do servidor', () => {
  // O Bot reutiliza o MESMO pipeline de start_solo_match (Etapa 14A) --
  // nao existe uma mensagem separada de "start_bot_match" no servidor.
  const ws1 = createMockSocket();
  registerConnection(ws1);
  send(ws1, { type: 'start_solo_match' });
  const roomCode = lastOfType(ws1, 'room_created').roomCode;
  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.durationMs, null);
});

test('[F] a composicao real do Bot (BotMatchController + MatchEndDetector) continua encerrando por duracao exatamente como na Etapa 15C-1D, sem nenhuma interferencia desta parte', () => {
  const BotController = require('../client/js/match/botController');
  const BotMatchController = require('../client/js/match/botMatchController');

  const startTimestamp = 300_000;
  const durationMs = ClientConfig.MATCH_DURATION_MS['30S'];
  const timeline = NoteEngine.generateNoteTimeline({
    seed: 321,
    startTimestamp,
    length: 200,
    noteRange: 4,
    noteIntervalMs: 600,
    leadInMs: 0,
  });

  const botConfig = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, 'MEDIUM');
  const botMatch = BotMatchController.createBotMatch({
    timeline,
    config: botConfig,
    windows: {
      perfectMs: ClientConfig.JUDGEMENT_WINDOWS.PERFECT_MS,
      greatMs: ClientConfig.JUDGEMENT_WINDOWS.GREAT_MS,
      goodMs: ClientConfig.JUDGEMENT_WINDOWS.GOOD_MS,
    },
    scoreValues: ClientConfig.SCORE_VALUES,
    comboMultiplierTiers: ClientConfig.COMBO_MULTIPLIER.TIERS,
    penalties: ClientConfig.PENALTIES,
    durationMs,
  });

  let ended = false;
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => {
      ended = true;
      BotMatchController.finalize(botMatch);
    },
    durationMs,
    startTime: startTimestamp,
  });

  assert.strictEqual(detector.checkForEnd(startTimestamp + durationMs - 1), false);
  assert.strictEqual(ended, false);
  assert.strictEqual(detector.checkForEnd(startTimestamp + durationMs), true);
  assert.strictEqual(ended, true);
  assert.ok(BotMatchController.getResult(botMatch));
});

console.log(`\n${passed} teste(s) passaram.`);
