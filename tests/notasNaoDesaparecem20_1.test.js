/**
 * Testes automatizados da Etapa 20-1.
 *
 * Bug corrigido: em client/index.html, o script de matchEndDetector.js
 * era carregado ANTES do script de matchDuration.js. Como
 * matchEndDetector.js referencia o global `MatchDuration` no momento em
 * que o proprio arquivo carrega (`const MatchDurationRef = isNode ?
 * require('./matchDuration') : MatchDuration;`), isso lancava
 * `ReferenceError: MatchDuration is not defined` assim que a pagina
 * carregava, impedindo `MatchEndDetector` de sequer existir como objeto
 * global.
 *
 * Consequencia pratica: dentro de `startMatchGameplay` (main.js), a
 * criacao do `MatchEndDetector` (que acontece ANTES de
 * `startExpiredNotesLoop()`) lancava excecao e interrompia o resto da
 * funcao -- entao `startExpiredNotesLoop()` NUNCA rodava.
 * `GameplayEngine.processExpiredNotes` (que marca as notas como
 * "missed" e permite a remocao quase imediata pelo NoteRenderer) parava
 * de ser chamado durante toda a partida. As notas nao acertadas so
 * eram removidas pelo mecanismo de seguranca baseado em tempo do
 * proprio NoteRenderer (`note.time + hitWindowMs + REMOVE_BUFFER_MS`),
 * o que fazia com que ficassem paradas no final da lane por muito mais
 * tempo do que o normal -- exatamente o sintoma relatado ("notas presas
 * no final do quadrado" e "notas que nao desaparecem").
 *
 * A correcao foi trocar a ORDEM dos dois <script> em client/index.html
 * (matchDuration.js passa a carregar antes de matchEndDetector.js).
 * Nenhuma das funcoes protegidas (MATCH_DURATION_IDS, MATCH_DURATION_MS,
 * resolveMatchDuration, hasReachedMatchDuration, generateExtendedTimeline,
 * computeNoteCountForDuration, score/combo/julgamento, checksum) foi
 * alterada.
 *
 * Este arquivo cobre:
 *   1. Regressao estatica do bug real (ordem dos <script> em index.html).
 *   2. O fluxo completo de expiracao/remocao de notas (NoteEngine +
 *      GameplayEngine + NoteRenderer), com timeline original e
 *      timeline estendida (Etapa 16), para 30S/1M/5M/10M.
 *   3. Notas consecutivas expirando e notas expirando depois de varios
 *      ciclos do padrao base.
 *   4. Que Bot (BotMatchController) usa a MESMA timeline/GameplayEngine
 *      e nunca cria um sistema paralelo de remocao.
 *   5. Regressao: acerto de notas, nao remocao antecipada, duracao da
 *      partida intacta, timeline cobrindo a duracao inteira.
 *
 * Executar com: node tests/notasNaoDesaparecem20_1.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const NoteEngine = require('../client/js/match/noteEngine');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const NoteRenderer = require('../client/js/render/noteRenderer');
const PlayerState = require('../client/js/match/playerState');
const ClientConfig = require('../client/js/config');
const BotMatchController = require('../client/js/match/botMatchController');

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

const SEED = 987654321;
const START = 1_800_000_000_000;
const LENGTH = 16;
const NOTE_RANGE = 3;
const NOTE_INTERVAL_MS = ClientConfig.NOTE_INTERVAL_MS;
const LEAD_IN_MS = ClientConfig.NOTE_LEAD_IN_MS;
const HIT_WINDOW_MS = ClientConfig.NOTE_HIT_WINDOW_MS;
const DURATIONS = Object.values(ClientConfig.MATCH_DURATION_IDS).map((id) => ({
  id,
  durationMs: ClientConfig.MATCH_DURATION_MS[id],
}));

// Mesmo mapeamento maiuscula->minuscula que main.js faz ao chamar
// GameplayEngine.createGameplayEngine (ver client/js/main.js, chamada de
// startMatchGameplay) -- Judgement.classify/findJudgeableNote esperam
// {perfectMs, greatMs, goodMs}, enquanto ClientConfig.JUDGEMENT_WINDOWS
// usa {PERFECT_MS, GREAT_MS, GOOD_MS}.
const WINDOWS = {
  perfectMs: ClientConfig.JUDGEMENT_WINDOWS.PERFECT_MS,
  greatMs: ClientConfig.JUDGEMENT_WINDOWS.GREAT_MS,
  goodMs: ClientConfig.JUDGEMENT_WINDOWS.GOOD_MS,
};

function buildExtendedTimeline(durationMs) {
  return NoteEngine.generateExtendedTimeline({
    seed: SEED,
    startTimestamp: START,
    length: LENGTH,
    noteRange: NOTE_RANGE,
    noteIntervalMs: NOTE_INTERVAL_MS,
    leadInMs: LEAD_IN_MS,
    durationMs,
  });
}

function buildOriginalTimeline() {
  return NoteEngine.generateNoteTimeline({
    seed: SEED,
    startTimestamp: START,
    length: LENGTH,
    noteRange: NOTE_RANGE,
    noteIntervalMs: NOTE_INTERVAL_MS,
    leadInMs: LEAD_IN_MS,
  });
}

/**
 * Roda o fluxo real (GameplayEngine.processExpiredNotes) em passos
 * pequenos, como um loop de requestAnimationFrame a ~60fps, do inicio
 * ate bem depois da ultima nota, e devolve estatisticas uteis para os
 * testes: se alguma nota nunca virou terminal e se alguma nota nunca
 * ficou "removivel" visualmente (NoteRenderer._internal.shouldRemoveNote).
 */
function simulateFullMatch(timeline, { stepMs = 16, extraTailMs = 5000 } = {}) {
  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: ClientConfig.SCORE_VALUES,
  });

  const lastNoteTime = timeline[timeline.length - 1].time;
  const endSimTime = lastNoteTime + HIT_WINDOW_MS + extraTailMs;

  let t = START;
  while (t < endSimTime) {
    engine.processExpiredNotes(t, HIT_WINDOW_MS);
    t += stepMs;
  }
  // Garante que o instante final tambem foi processado.
  engine.processExpiredNotes(endSimTime, HIT_WINDOW_MS);

  const stuckStates = timeline.filter((n) => !NoteEngine.isTerminal(n.state));

  const internal = NoteRenderer._internal;
  const stuckVisually = timeline.filter(
    (n) => !internal.shouldRemoveNote(n, endSimTime, HIT_WINDOW_MS, internal.REMOVE_BUFFER_MS, NoteEngine.isTerminal)
  );

  return { playerState, stuckStates, stuckVisually, lastNoteTime, endSimTime };
}

// ---------------------------------------------------------------------
// 1. Regressao estatica do bug real: ordem dos <script> em index.html
// ---------------------------------------------------------------------
test('client/index.html carrega matchDuration.js ANTES de matchEndDetector.js (causa raiz da 20-1)', () => {
  const html = fs.readFileSync(path.join(__dirname, '../client/index.html'), 'utf8');
  const durationIndex = html.indexOf('js/match/matchDuration.js');
  const endDetectorIndex = html.indexOf('js/match/matchEndDetector.js');

  assert.ok(durationIndex !== -1, 'index.html deveria referenciar matchDuration.js');
  assert.ok(endDetectorIndex !== -1, 'index.html deveria referenciar matchEndDetector.js');
  assert.ok(
    durationIndex < endDetectorIndex,
    'matchDuration.js precisa carregar antes de matchEndDetector.js, pois matchEndDetector.js le o global MatchDuration assim que carrega'
  );
});

test('nenhuma outra dependencia baseada em global (isNode ? require : Global) ficou fora de ordem em index.html', () => {
  const html = fs.readFileSync(path.join(__dirname, '../client/index.html'), 'utf8');
  const scriptOrder = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  const indexOf = (file) => scriptOrder.indexOf(file);

  // Pares [dependente, dependencia] conhecidos (mesmo padrao do bug real).
  const pairs = [
    ['match/botController.js', 'match/playerState.js'],
    ['match/botController.js', 'match/judgement.js'],
    ['match/botController.js', 'match/sequenceGenerator.js'],
    ['match/botMatchController.js', 'match/playerState.js'],
    ['match/botMatchController.js', 'match/botController.js'],
    ['match/botMatchController.js', 'match/judgement.js'],
    ['match/botMatchController.js', 'match/matchResult.js'],
    ['match/gameplayEngine.js', 'match/noteEngine.js'],
    ['match/gameplayEngine.js', 'match/judgement.js'],
    ['match/gameplayEngine.js', 'match/playerState.js'],
    ['match/matchEndDetector.js', 'match/noteEngine.js'],
    ['match/matchEndDetector.js', 'match/matchDuration.js'],
    ['match/matchTimelineManager.js', 'match/noteEngine.js'],
    ['render/noteRenderer.js', 'match/noteEngine.js'],
    ['render/noteRenderer.js', 'config.js'],
  ];

  pairs.forEach(([dependent, dependency]) => {
    const dependentIdx = indexOf(dependent);
    const dependencyIdx = indexOf(dependency);
    assert.ok(dependentIdx !== -1, `${dependent} deveria estar em index.html`);
    assert.ok(dependencyIdx !== -1, `${dependency} deveria estar em index.html`);
    assert.ok(
      dependencyIdx < dependentIdx,
      `${dependency} precisa carregar antes de ${dependent} (senao o global correspondente nao existe ainda)`
    );
  });
});

// ---------------------------------------------------------------------
// 2. Nota normal (timeline original) sendo removida apos expirar
// ---------------------------------------------------------------------
test('nota normal (timeline original, sem estender) e marcada MISSED e fica removivel apos expirar', () => {
  const timeline = buildOriginalTimeline();
  const { stuckStates, stuckVisually } = simulateFullMatch(timeline);

  assert.strictEqual(stuckStates.length, 0, 'nenhuma nota deveria continuar pending/active ao final');
  assert.strictEqual(stuckVisually.length, 0, 'nenhuma nota deveria continuar presa visualmente ao final');
});

// ---------------------------------------------------------------------
// 3. Nota adicional da timeline estendida (Etapa 16) sendo removida
// ---------------------------------------------------------------------
test('notas adicionais geradas por generateExtendedTimeline (alem do padrao base) tambem sao removidas normalmente', () => {
  const durationMs = ClientConfig.MATCH_DURATION_MS['1M'];
  const timeline = buildExtendedTimeline(durationMs);

  assert.ok(timeline.length > LENGTH, 'a timeline estendida precisa ter mais notas que o padrao base para este teste fazer sentido');

  const { stuckStates, stuckVisually } = simulateFullMatch(timeline);

  const stuckAdditional = stuckStates.filter((_, idx) => idx >= LENGTH);
  assert.strictEqual(stuckStates.length, 0, 'nenhuma nota (incluindo as adicionais) deveria ficar sem estado terminal');
  assert.strictEqual(stuckVisually.length, 0, 'nenhuma nota (incluindo as adicionais) deveria ficar presa visualmente');
  assert.strictEqual(stuckAdditional.length, 0);
});

// ---------------------------------------------------------------------
// 4. Varias notas consecutivas expirando
// ---------------------------------------------------------------------
test('varias notas consecutivas nao acertadas expiram todas, uma apos a outra, sem travar nenhuma', () => {
  const timeline = buildExtendedTimeline(ClientConfig.MATCH_DURATION_MS['30S']);
  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: ClientConfig.SCORE_VALUES,
  });

  // Nenhuma tecla e pressionada: TODAS as notas devem virar MISS.
  let t = START;
  const endSimTime = timeline[timeline.length - 1].time + HIT_WINDOW_MS + 1000;
  let totalMissed = 0;
  while (t < endSimTime) {
    const newlyMissed = engine.processExpiredNotes(t, HIT_WINDOW_MS);
    totalMissed += newlyMissed.length;
    t += 16;
  }

  assert.strictEqual(totalMissed, timeline.length, 'todas as notas deveriam ter sido processadas como MISS exatamente uma vez cada');
  assert.strictEqual(playerState.misses, timeline.length);
  assert.ok(timeline.every((n) => n.state === NoteEngine.NOTE_STATE.MISSED));
});

// ---------------------------------------------------------------------
// 5. Notas expirando depois de varios ciclos da sequencia
// ---------------------------------------------------------------------
test('notas expiram normalmente mesmo depois de varios ciclos completos do padrao base (index >> length)', () => {
  const durationMs = ClientConfig.MATCH_DURATION_MS['5M'];
  const timeline = buildExtendedTimeline(durationMs);

  assert.ok(timeline.length > LENGTH * 5, 'este teste precisa de uma timeline com varios ciclos completos do padrao base');

  const { stuckStates, stuckVisually } = simulateFullMatch(timeline);

  // Foco especifico nas notas de indice bem alto (varios ciclos depois
  // do padrao original), que e onde o bug relatado se manifestava.
  const lateNotes = timeline.slice(-20);
  const lateStuckStates = lateNotes.filter((n) => !NoteEngine.isTerminal(n.state));

  assert.strictEqual(stuckStates.length, 0);
  assert.strictEqual(stuckVisually.length, 0);
  assert.strictEqual(lateStuckStates.length, 0, 'as ultimas notas da timeline (varios ciclos depois) tambem precisam expirar normalmente');
});

// ---------------------------------------------------------------------
// 6. Notas nao ficando presas no limite visual (topPercent nunca "empacado")
// ---------------------------------------------------------------------
test('uma nota nao acertada eventualmente fica removivel visualmente logo apos passar do limite (nao so muito depois via fallback)', () => {
  const timeline = buildOriginalTimeline();
  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: ClientConfig.SCORE_VALUES,
  });

  const note = timeline[0];
  const internal = NoteRenderer._internal;

  // Logo ANTES do limite: ainda nao deveria ser removivel.
  engine.processExpiredNotes(note.time - 1, HIT_WINDOW_MS);
  assert.strictEqual(
    internal.shouldRemoveNote(note, note.time - 1, HIT_WINDOW_MS, internal.REMOVE_BUFFER_MS, NoteEngine.isTerminal),
    false
  );

  // Logo DEPOIS do limite (1 frame a 60fps): o fluxo normal
  // (processExpiredNotes) ja deveria ter marcado a nota como MISSED,
  // entao ela fica removivel quase imediatamente -- SEM precisar
  // esperar o fallback de seguranca (note.time + hitWindowMs + buffer).
  const justAfter = note.time + 16;
  engine.processExpiredNotes(justAfter, HIT_WINDOW_MS);
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.MISSED, 'processExpiredNotes deveria marcar a nota como MISSED logo apos o limite');
  assert.strictEqual(
    internal.shouldRemoveNote(note, justAfter, HIT_WINDOW_MS, internal.REMOVE_BUFFER_MS, NoteEngine.isTerminal),
    true,
    'a nota deveria ficar removivel quase imediatamente, nao apenas apos o fallback de seguranca'
  );
});

// ---------------------------------------------------------------------
// 7. Estado da nota sendo atualizado corretamente
// ---------------------------------------------------------------------
test('o estado da nota segue pending -> active -> missed corretamente quando nao acertada', () => {
  const timeline = buildOriginalTimeline();
  const note = timeline[0];

  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.PENDING);

  NoteEngine.updateTimelineStates(timeline, note.time - HIT_WINDOW_MS, HIT_WINDOW_MS);
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.ACTIVE);

  NoteEngine.updateTimelineStates(timeline, note.time + 1, HIT_WINDOW_MS);
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.MISSED);
});

// ---------------------------------------------------------------------
// 8. Remocao do elemento visual apos expiracao (shouldRemoveNote)
// ---------------------------------------------------------------------
test('shouldRemoveNote retorna true assim que a nota se torna terminal (hit ou missed)', () => {
  const internal = NoteRenderer._internal;
  const timeline = buildOriginalTimeline();
  const hitNote = timeline[0];
  const missedNote = timeline[1];

  NoteEngine.setNoteState(timeline, hitNote.id, NoteEngine.NOTE_STATE.HIT);
  NoteEngine.updateTimelineStates(timeline, missedNote.time + 1, HIT_WINDOW_MS);

  assert.strictEqual(
    internal.shouldRemoveNote(hitNote, hitNote.time, HIT_WINDOW_MS, internal.REMOVE_BUFFER_MS, NoteEngine.isTerminal),
    true
  );
  assert.strictEqual(
    internal.shouldRemoveNote(missedNote, missedNote.time + 1, HIT_WINDOW_MS, internal.REMOVE_BUFFER_MS, NoteEngine.isTerminal),
    true
  );
});

// ---------------------------------------------------------------------
// 9/10. Comportamento preservado com timeline original E estendida,
//        para 30S / 1M / 5M / 10M
// ---------------------------------------------------------------------
DURATIONS.forEach(({ id, durationMs }) => {
  test(`timeline estendida para duracao ${id} (${durationMs}ms) nao deixa nenhuma nota presa`, () => {
    const timeline = buildExtendedTimeline(durationMs);
    const { stuckStates, stuckVisually, lastNoteTime } = simulateFullMatch(timeline);

    assert.strictEqual(stuckStates.length, 0, `[${id}] nenhuma nota deveria ficar sem estado terminal`);
    assert.strictEqual(stuckVisually.length, 0, `[${id}] nenhuma nota deveria ficar presa visualmente`);
    assert.ok(
      lastNoteTime - START >= durationMs,
      `[${id}] a ultima nota da timeline precisa cobrir pelo menos a duracao escolhida (comportamento da Etapa 16, preservado)`
    );
  });
});

test('comportamento preservado: timeline ORIGINAL (sem duracao/sem estender) continua funcionando como antes', () => {
  const timeline = buildOriginalTimeline();
  assert.strictEqual(timeline.length, LENGTH);
  const { stuckStates, stuckVisually } = simulateFullMatch(timeline);
  assert.strictEqual(stuckStates.length, 0);
  assert.strictEqual(stuckVisually.length, 0);
});

// ---------------------------------------------------------------------
// 11/12/13. Solo / Bot / Multiplayer
// ---------------------------------------------------------------------
test('[Solo] o mesmo GameplayEngine/NoteEngine usado pelo Modo Solo processa a timeline estendida sem deixar notas presas (30S)', () => {
  // Solo usa exatamente createGameplayEngine + a timeline de
  // MatchTimelineManager/NoteEngine.generateExtendedTimeline, sem
  // nenhuma logica adicional -- ja coberto pelos testes acima. Este
  // teste apenas deixa explicito o cenario "Solo" pedido na Etapa 20-1.
  const timeline = buildExtendedTimeline(ClientConfig.MATCH_DURATION_MS['30S']);
  const { stuckStates, stuckVisually } = simulateFullMatch(timeline);
  assert.strictEqual(stuckStates.length, 0);
  assert.strictEqual(stuckVisually.length, 0);
});

test('[Bot] BotMatchController nunca marca notas sozinho e depende do MESMO GameplayEngine.processExpiredNotes para remocao', () => {
  const timeline = buildExtendedTimeline(ClientConfig.MATCH_DURATION_MS['1M']);

  const botMatch = BotMatchController.createBotMatch({
    timeline,
    config: ClientConfig.BOT_DIFFICULTY_PRESETS.MEDIUM,
    windows: WINDOWS,
  });

  // O bot usa a MESMA instancia de timeline (nunca uma copia).
  assert.strictEqual(botMatch.timeline, timeline);

  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: ClientConfig.SCORE_VALUES,
  });

  let t = START;
  const endSimTime = timeline[timeline.length - 1].time + HIT_WINDOW_MS + 3000;
  while (t < endSimTime) {
    BotMatchController.tick(botMatch, t);
    engine.processExpiredNotes(t, HIT_WINDOW_MS);
    t += 16;
  }
  engine.processExpiredNotes(endSimTime, HIT_WINDOW_MS);

  const stuckStates = timeline.filter((n) => !NoteEngine.isTerminal(n.state));
  assert.strictEqual(stuckStates.length, 0, 'nenhuma nota deveria ficar sem estado terminal quando o Bot esta jogando junto');

  // Confirma que a timeline em si nao foi trocada por uma copia paralela.
  assert.strictEqual(botMatch.timeline, timeline);
});

test('[Multiplayer] dois clientes com o mesmo seed/startTimestamp/duracao geram a MESMA timeline (sem sistema paralelo por jogador)', () => {
  const durationMs = ClientConfig.MATCH_DURATION_MS['1M'];
  const timelineClientA = buildExtendedTimeline(durationMs);
  const timelineClientB = buildExtendedTimeline(durationMs);

  assert.strictEqual(timelineClientA.length, timelineClientB.length);
  timelineClientA.forEach((note, idx) => {
    assert.strictEqual(note.time, timelineClientB[idx].time);
    assert.strictEqual(note.lane, timelineClientB[idx].lane);
    assert.strictEqual(note.id, timelineClientB[idx].id);
  });

  // Cada "cliente" roda seu proprio GameplayEngine local (como no
  // multiplayer real: cada peer processa expiracao localmente), e
  // ambos devem chegar ao mesmo resultado -- nenhuma nota presa em
  // nenhum dos dois.
  const resultA = simulateFullMatch(timelineClientA);
  const resultB = simulateFullMatch(timelineClientB);

  assert.strictEqual(resultA.stuckStates.length, 0);
  assert.strictEqual(resultB.stuckStates.length, 0);
});

// ---------------------------------------------------------------------
// Regressao
// ---------------------------------------------------------------------
test('[regressao] notas ainda podem ser acertadas normalmente (PERFECT/GOOD) apos a correcao', () => {
  const timeline = buildExtendedTimeline(ClientConfig.MATCH_DURATION_MS['1M']);
  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: ClientConfig.SCORE_VALUES,
  });

  const targetNote = timeline[0];
  const result = engine.handleKeyPress(targetNote.lane, targetNote.time);

  assert.ok(['PERFECT', 'GOOD'].includes(result.outcome), `esperava PERFECT/GOOD, recebi ${result.outcome}`);
  assert.strictEqual(targetNote.state, NoteEngine.NOTE_STATE.HIT);
  assert.strictEqual(playerState.score > 0, true);
});

test('[regressao] notas nao sao removidas/marcadas MISS antes da hora (antes de note.time)', () => {
  const timeline = buildExtendedTimeline(ClientConfig.MATCH_DURATION_MS['30S']);
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState: PlayerState.createPlayerState(),
    windows: WINDOWS,
    scoreValues: ClientConfig.SCORE_VALUES,
  });

  const note = timeline[5];
  engine.processExpiredNotes(note.time - 1, HIT_WINDOW_MS);
  assert.notStrictEqual(note.state, NoteEngine.NOTE_STATE.MISSED, 'a nota nao deveria virar MISSED antes do seu note.time');
});

test('[regressao] a duracao da partida continua intacta (resolveMatchDuration/hasReachedMatchDuration nao foram alterados)', () => {
  const MatchDuration = require('../client/js/match/matchDuration');
  DURATIONS.forEach(({ id, durationMs }) => {
    const resolved = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, id);
    assert.strictEqual(resolved, durationMs, `resolveMatchDuration(MATCH_DURATION_MS, '${id}') deveria continuar devolvendo ${durationMs}`);

    // hasReachedMatchDuration(currentTime, startTime, durationMs)
    assert.strictEqual(MatchDuration.hasReachedMatchDuration(START + durationMs - 1, START, durationMs), false);
    assert.strictEqual(MatchDuration.hasReachedMatchDuration(START + durationMs, START, durationMs), true);
  });
});

test('[regressao] a timeline continua preenchendo a duracao inteira para todas as opcoes de duracao', () => {
  DURATIONS.forEach(({ id, durationMs }) => {
    const timeline = buildExtendedTimeline(durationMs);
    const lastNote = timeline[timeline.length - 1];
    assert.ok(
      lastNote.time - START >= durationMs,
      `[${id}] a ultima nota (${lastNote.time - START}ms) deveria cobrir pelo menos a duracao (${durationMs}ms)`
    );
  });
});

console.log(`\n${passed} teste(s) passaram, ${failed} falharam.`);
