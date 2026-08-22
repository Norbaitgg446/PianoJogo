/**
 * Testes automatizados do NoteEngine (Etapa 4A).
 *
 * Roda em Node puro (sem framework de testes), reutilizando os mesmos
 * modulos que rodam no navegador (client/js/match/sequenceGenerator.js e
 * client/js/match/noteEngine.js), gracas ao fallback `module.exports`
 * adicionado a esses arquivos (ativo apenas em Node; nao afeta o browser).
 *
 * Executar com: node tests/noteEngine.test.js
 */
const assert = require('assert');
const NoteEngine = require('../client/js/match/noteEngine');

const BASE_PARAMS = {
  seed: 123456789,
  startTimestamp: 1_700_000_000_000,
  length: 16,
  noteRange: 3, // 3 lanes: 1=esquerda, 2=cima, 3=direita
  noteIntervalMs: 600,
  leadInMs: 1000,
};

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

// 1. A mesma seed produz as mesmas notas -----------------------------------
test('mesma seed produz a mesma sequencia de lanes', () => {
  const timelineA = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const timelineB = NoteEngine.generateNoteTimeline(BASE_PARAMS);

  const lanesA = timelineA.map((n) => n.lane);
  const lanesB = timelineB.map((n) => n.lane);

  assert.deepStrictEqual(lanesA, lanesB, 'lanes deveriam ser identicas para a mesma seed');
  assert.strictEqual(timelineA.length, BASE_PARAMS.length);
  assert.ok(lanesA.every((lane) => lane >= 1 && lane <= BASE_PARAMS.noteRange));
});

// 1b. Alteracao para 3 lanes: nenhuma nota pode ter lane 4, e todas devem
// estar estritamente entre 1 e 3.
test('com 3 lanes, nenhuma nota gerada possui lane 4 e todas estao entre 1 e 3', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const lanes = timeline.map((n) => n.lane);

  assert.strictEqual(BASE_PARAMS.noteRange, 3, 'este projeto agora deve usar 3 lanes');
  assert.ok(lanes.every((lane) => lane !== 4), 'nenhuma lane deveria ser 4');
  assert.ok(lanes.every((lane) => lane >= 1 && lane <= 3), 'todas as lanes devem estar entre 1 e 3');
});

test('seeds diferentes tendem a produzir sequencias diferentes', () => {
  const timelineA = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const timelineB = NoteEngine.generateNoteTimeline({ ...BASE_PARAMS, seed: 987654321 });

  const lanesA = timelineA.map((n) => n.lane).join(',');
  const lanesB = timelineB.map((n) => n.lane).join(',');

  assert.notStrictEqual(lanesA, lanesB, 'seeds diferentes nao deveriam colidir nesta amostra');
});

// 2. As notas possuem os mesmos tempos nos dois clientes --------------------
test('dois clientes com a mesma seed e o mesmo startTimestamp geram os mesmos tempos', () => {
  // Simula os dois jogadores gerando a timeline localmente, de forma
  // independente, a partir dos mesmos dados recebidos do servidor
  // (seed + startTimestamp), exatamente como aconteceria em dois
  // navegadores diferentes.
  const player1Timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const player2Timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);

  const timesP1 = player1Timeline.map((n) => n.time);
  const timesP2 = player2Timeline.map((n) => n.time);

  assert.deepStrictEqual(timesP1, timesP2, 'os tempos das notas devem ser identicos nos dois clientes');

  // Confirma que os tempos sao derivados do startTimestamp do servidor,
  // e nao de qualquer relogio local: primeira nota = startTimestamp + leadInMs.
  assert.strictEqual(timesP1[0], BASE_PARAMS.startTimestamp + BASE_PARAMS.leadInMs);
  // Intervalo entre notas consecutivas deve respeitar noteIntervalMs (configuravel).
  assert.strictEqual(timesP1[1] - timesP1[0], BASE_PARAMS.noteIntervalMs);
});

// 3. Os IDs das notas sao deterministicos ------------------------------------
test('ids das notas sao deterministicos e estaveis entre geracoes', () => {
  const timelineA = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const timelineB = NoteEngine.generateNoteTimeline(BASE_PARAMS);

  const idsA = timelineA.map((n) => n.id);
  const idsB = timelineB.map((n) => n.id);

  assert.deepStrictEqual(idsA, idsB);
  // ids nao podem se repetir dentro da mesma timeline
  assert.strictEqual(new Set(idsA).size, idsA.length);
  // formato esperado: note-<seed>-<index>
  assert.strictEqual(idsA[0], NoteEngine.buildNoteId(BASE_PARAMS.seed, 0));
  assert.strictEqual(idsA[5], NoteEngine.buildNoteId(BASE_PARAMS.seed, 5));
});

// 4. Uma nota pode mudar de estado corretamente ------------------------------
test('uma nota transiciona pending -> active -> hit corretamente', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const note = timeline[0];
  const hitWindowMs = 150;

  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.PENDING);

  // Ainda longe do tempo da nota: continua pending.
  NoteEngine.updateTimelineStates(timeline, note.time - 10_000, hitWindowMs);
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.PENDING);

  // Dentro da janela de julgamento: vira active.
  NoteEngine.updateTimelineStates(timeline, note.time, hitWindowMs);
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.ACTIVE);

  // Jogador acerta a nota: vira hit.
  const applied = NoteEngine.setNoteState(timeline, note.id, NoteEngine.NOTE_STATE.HIT);
  assert.strictEqual(applied, true);
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.HIT);
});

test('uma nota nao atingida a tempo vira missed automaticamente', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const note = timeline[1];
  const hitWindowMs = 150;

  NoteEngine.updateTimelineStates(timeline, note.time + hitWindowMs + 1, hitWindowMs);
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.MISSED);
});

// 5. Uma nota nao pode ser processada duas vezes -----------------------------
test('uma nota ja "hit" nao pode ser reprocessada (ex: tentar marcar missed depois)', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const note = timeline[2];
  const hitWindowMs = 150;

  NoteEngine.updateTimelineStates(timeline, note.time, hitWindowMs);
  const firstApply = NoteEngine.setNoteState(timeline, note.id, NoteEngine.NOTE_STATE.HIT);
  assert.strictEqual(firstApply, true);
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.HIT);

  // Tenta processar a mesma nota de novo (ex: segundo input do jogador,
  // ou bug que chama setNoteState duas vezes).
  const secondApply = NoteEngine.setNoteState(timeline, note.id, NoteEngine.NOTE_STATE.HIT);
  assert.strictEqual(secondApply, false, 'nao deveria conseguir reprocessar uma nota ja hit');

  const tryOverrideToMissed = NoteEngine.setNoteState(timeline, note.id, NoteEngine.NOTE_STATE.MISSED);
  assert.strictEqual(tryOverrideToMissed, false, 'nao deveria conseguir sobrescrever hit com missed');
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.HIT, 'estado deve permanecer hit');

  // updateTimelineStates tambem nao pode reverter/alterar uma nota terminal,
  // mesmo muito tempo depois de expirada a janela de julgamento.
  NoteEngine.updateTimelineStates(timeline, note.time + 100_000, hitWindowMs);
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.HIT, 'updateTimelineStates nao pode sobrescrever estado terminal');
});

test('setNoteState rejeita nota inexistente e estado invalido', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);

  assert.strictEqual(NoteEngine.setNoteState(timeline, 'note-inexistente', NoteEngine.NOTE_STATE.HIT), false);
  assert.strictEqual(NoteEngine.setNoteState(timeline, timeline[0].id, 'estado-invalido'), false);
  assert.strictEqual(timeline[0].state, NoteEngine.NOTE_STATE.PENDING);
});

console.log(`\n${passed} teste(s) passaram.`);
