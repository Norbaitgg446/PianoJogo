/**
 * Testes automatizados da camada visual das notas (Etapa 5B-2B).
 *
 * Este arquivo roda em Node puro, sem DOM: por isso testa apenas as
 * funcoes PURAS expostas em `NoteRenderer._internal` (calculo de
 * posicao/tempo e decisao de remocao) -- exatamente a parte que precisa
 * ser identica nos dois clientes para a mesma nota aparecer na mesma
 * posicao no mesmo instante. As partes que mexem em DOM (start/stop,
 * criacao/remocao de elementos) so existem no navegador e sao cobertas
 * pela lista de testes manuais do enunciado da etapa.
 *
 * Executar com: node tests/noteRenderer.test.js
 */
const assert = require('assert');
const NoteEngine = require('../client/js/match/noteEngine');
const NoteRenderer = require('../client/js/render/noteRenderer');

const { estimateSyncedNow, computeProgress, computeTopPercent, shouldRemoveNote, shouldSpawnNote, NOTE_TRAVEL_MS, HIT_LINE_PERCENT, REMOVE_BUFFER_MS } =
  NoteRenderer._internal;

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

const HIT_WINDOW_MS = 150;

function makeNote(overrides) {
  return { id: 'note-1-0', index: 0, lane: 1, time: 10_000, state: NoteEngine.NOTE_STATE.PENDING, ...overrides };
}

// 1. Offset de relogio -------------------------------------------------------
test('estimateSyncedNow soma o offset ao relogio local (mesma formula do MatchController)', () => {
  assert.strictEqual(estimateSyncedNow(1000, 500), 1500);
  assert.strictEqual(estimateSyncedNow(1000, -200), 800);
  assert.strictEqual(estimateSyncedNow(1000, 0), 1000);
});

// 2. Progresso/posicao --------------------------------------------------------
test('progresso e 0 exatamente no instante do spawn (note.time - travelMs)', () => {
  const note = makeNote({ time: 10_000 });
  const spawnTime = note.time - NOTE_TRAVEL_MS;
  assert.strictEqual(computeProgress(note, spawnTime, NOTE_TRAVEL_MS), 0);
});

test('progresso e 1 exatamente no note.time (linha de julgamento)', () => {
  const note = makeNote({ time: 10_000 });
  assert.strictEqual(computeProgress(note, note.time, NOTE_TRAVEL_MS), 1);
});

test('topPercent cresce de 0 ate HIT_LINE_PERCENT conforme o tempo avanca ate note.time', () => {
  const note = makeNote({ time: 10_000 });
  const spawnTime = note.time - NOTE_TRAVEL_MS;
  const midTime = spawnTime + NOTE_TRAVEL_MS / 2;

  const topAtSpawn = computeTopPercent(note, spawnTime, NOTE_TRAVEL_MS, HIT_LINE_PERCENT);
  const topAtMid = computeTopPercent(note, midTime, NOTE_TRAVEL_MS, HIT_LINE_PERCENT);
  const topAtHit = computeTopPercent(note, note.time, NOTE_TRAVEL_MS, HIT_LINE_PERCENT);

  assert.strictEqual(topAtSpawn, 0);
  assert.ok(Math.abs(topAtMid - HIT_LINE_PERCENT / 2) < 0.001);
  assert.strictEqual(topAtHit, HIT_LINE_PERCENT);
});

test('topPercent nunca e negativo, mesmo antes do spawn', () => {
  const note = makeNote({ time: 10_000 });
  const beforeSpawn = note.time - NOTE_TRAVEL_MS - 5000;
  assert.strictEqual(computeTopPercent(note, beforeSpawn, NOTE_TRAVEL_MS, HIT_LINE_PERCENT), 0);
});

// 3. Sincronizacao entre dois clientes ----------------------------------------
test('dois clientes com o mesmo (seed/startTimestamp implicito no note.time) e mesmo tempo sincronizado calculam a MESMA posicao', () => {
  const note = makeNote({ time: 10_000 });
  const clienteA_now = 9500; // relogio local do cliente A
  const clienteB_now = 9800; // relogio local do cliente B, diferente

  const offsetA = 300; // faz clienteA "ver" o mesmo instante do servidor que...
  const offsetB = 0; // ...clienteB ve sem offset: 9500+300 === 9800+0

  const syncedA = estimateSyncedNow(clienteA_now, offsetA);
  const syncedB = estimateSyncedNow(clienteB_now, offsetB);
  assert.strictEqual(syncedA, syncedB, 'pre-condicao do teste: os dois devem convergir pro mesmo instante sincronizado');

  const topA = computeTopPercent(note, syncedA, NOTE_TRAVEL_MS, HIT_LINE_PERCENT);
  const topB = computeTopPercent(note, syncedB, NOTE_TRAVEL_MS, HIT_LINE_PERCENT);

  assert.strictEqual(topA, topB, 'mesmo instante sincronizado deveria produzir a MESMA posicao visual para a mesma nota');
});

// 4. Spawn ---------------------------------------------------------------------
test('shouldSpawnNote e falso muito antes do horario de nascer da nota', () => {
  const note = makeNote({ time: 10_000 });
  const muitoAntes = note.time - NOTE_TRAVEL_MS - 10_000;
  assert.strictEqual(shouldSpawnNote(note, muitoAntes, NOTE_TRAVEL_MS, 50), false);
});

test('shouldSpawnNote e verdadeiro no/apos o horario de nascer da nota', () => {
  const note = makeNote({ time: 10_000 });
  const spawnTime = note.time - NOTE_TRAVEL_MS;
  assert.strictEqual(shouldSpawnNote(note, spawnTime, NOTE_TRAVEL_MS, 50), true);
});

// 5. Remocao --------------------------------------------------------------------
test('shouldRemoveNote e verdadeiro imediatamente quando a nota ja esta em estado final (hit)', () => {
  const note = makeNote({ time: 10_000, state: NoteEngine.NOTE_STATE.HIT });
  // mesmo bem antes do tempo normal de remocao por prazo
  assert.strictEqual(
    shouldRemoveNote(note, note.time, HIT_WINDOW_MS, REMOVE_BUFFER_MS, NoteEngine.isTerminal),
    true
  );
});

test('shouldRemoveNote e verdadeiro quando a nota ja esta em estado final (missed)', () => {
  const note = makeNote({ time: 10_000, state: NoteEngine.NOTE_STATE.MISSED });
  assert.strictEqual(
    shouldRemoveNote(note, note.time, HIT_WINDOW_MS, REMOVE_BUFFER_MS, NoteEngine.isTerminal),
    true
  );
});

test('shouldRemoveNote e falso para uma nota pendente ainda dentro da janela de julgamento', () => {
  const note = makeNote({ time: 10_000, state: NoteEngine.NOTE_STATE.PENDING });
  const dentroDaJanela = note.time + HIT_WINDOW_MS - 1;
  assert.strictEqual(
    shouldRemoveNote(note, dentroDaJanela, HIT_WINDOW_MS, REMOVE_BUFFER_MS, NoteEngine.isTerminal),
    false,
    'nao deveria remover antes do GameplayEngine ter chance de processar'
  );
});

test('shouldRemoveNote e falso logo apos a janela expirar, dentro da margem de seguranca (REMOVE_BUFFER_MS)', () => {
  const note = makeNote({ time: 10_000, state: NoteEngine.NOTE_STATE.PENDING });
  const logoApos = note.time + HIT_WINDOW_MS + 1;
  assert.strictEqual(
    shouldRemoveNote(note, logoApos, HIT_WINDOW_MS, REMOVE_BUFFER_MS, NoteEngine.isTerminal),
    false,
    'a margem de seguranca existe exatamente para nao remover neste momento'
  );
});

test('shouldRemoveNote e verdadeiro apos a janela + a margem de seguranca, mesmo se o estado nunca mudou', () => {
  const note = makeNote({ time: 10_000, state: NoteEngine.NOTE_STATE.PENDING });
  const bemDepois = note.time + HIT_WINDOW_MS + REMOVE_BUFFER_MS + 1;
  assert.strictEqual(
    shouldRemoveNote(note, bemDepois, HIT_WINDOW_MS, REMOVE_BUFFER_MS, NoteEngine.isTerminal),
    true
  );
});

// 6. API publica minima (start/stop existem e sao funcoes) ---------------------
test('NoteRenderer expoe start() e stop() como funcoes (contrato usado pelo main.js)', () => {
  assert.strictEqual(typeof NoteRenderer.start, 'function');
  assert.strictEqual(typeof NoteRenderer.stop, 'function');
});

test('start()/stop() nao lancam erro em ambiente sem DOM (Node) -- degradam com seguranca', () => {
  NoteRenderer.start({ timeline: [makeNote({})], clockOffsetMs: 0, hitWindowMs: HIT_WINDOW_MS });
  NoteRenderer.stop();
});

console.log(`\n${passed} teste(s) passaram.`);
