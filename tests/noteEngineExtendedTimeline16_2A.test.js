/**
 * Testes automatizados da preparacao de geracao continua de notas
 * (Etapa 16-2A).
 *
 * Cobrem exclusivamente as duas funcoes novas adicionadas a
 * client/js/match/noteEngine.js nesta etapa:
 *   - NoteEngine.computeNoteCountForDuration
 *   - NoteEngine.generateExtendedTimeline
 *
 * IMPORTANTE: nenhuma dessas funcoes e chamada por MatchTimelineManager,
 * main.js ou botMatchController.js ainda -- isso fica para uma proxima
 * etapa. Este arquivo testa as funcoes isoladamente, em Node puro,
 * exatamente como os demais testes de NoteEngine (ver tests/noteEngine.test.js).
 *
 * Executar com: node tests/noteEngineExtendedTimeline16_2A.test.js
 */
const assert = require('assert');
const NoteEngine = require('../client/js/match/noteEngine');

const BASE_PARAMS = {
  seed: 123456789,
  startTimestamp: 1_700_000_000_000,
  length: 4,
  noteRange: 3,
  noteIntervalMs: 600,
  leadInMs: 1800,
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

// ---------------------------------------------------------------------
// 1. Padrao pequeno sendo repetido
// ---------------------------------------------------------------------
test('um padrao pequeno (length=4) e repetido ciclicamente ao pedir totalLength maior', () => {
  const baseTimeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const extended = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, totalLength: 10 });

  assert.strictEqual(extended.length, 10);

  const baseLanes = baseTimeline.map((n) => n.lane);
  const extendedLanes = extended.map((n) => n.lane);

  // Repeticao ciclica: lane[index] === lane[index % length]
  for (let i = 0; i < extended.length; i++) {
    assert.strictEqual(
      extendedLanes[i],
      baseLanes[i % BASE_PARAMS.length],
      `lane do indice ${i} deveria repetir a lane do indice ${i % BASE_PARAMS.length} do padrao-base`
    );
  }
});

// ---------------------------------------------------------------------
// 2. Multiplas repeticoes (varios ciclos completos)
// ---------------------------------------------------------------------
test('multiplos ciclos completos do padrao-base sao repetidos corretamente', () => {
  const totalLength = BASE_PARAMS.length * 5; // 5 ciclos completos
  const extended = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, totalLength });
  const baseTimeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const baseLanes = baseTimeline.map((n) => n.lane);

  assert.strictEqual(extended.length, totalLength);

  for (let cycle = 0; cycle < 5; cycle++) {
    const cycleLanes = extended
      .slice(cycle * BASE_PARAMS.length, (cycle + 1) * BASE_PARAMS.length)
      .map((n) => n.lane);
    assert.deepStrictEqual(cycleLanes, baseLanes, `ciclo ${cycle} deveria repetir exatamente o padrao-base`);
  }
});

// ---------------------------------------------------------------------
// 3. Ordem crescente dos tempos
// ---------------------------------------------------------------------
test('os tempos das notas estendidas sao estritamente crescentes', () => {
  const extended = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, totalLength: 30 });

  for (let i = 1; i < extended.length; i++) {
    assert.ok(
      extended[i].time > extended[i - 1].time,
      `time do indice ${i} (${extended[i].time}) deveria ser maior que do indice ${i - 1} (${extended[i - 1].time})`
    );
  }
});

test('os indices das notas estendidas sao crescentes e sequenciais (0..N-1)', () => {
  const extended = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, totalLength: 12 });
  extended.forEach((note, i) => assert.strictEqual(note.index, i));
});

// ---------------------------------------------------------------------
// 4. Intervalos preservados
// ---------------------------------------------------------------------
test('sem difficultyStages, o intervalo entre notas consecutivas e sempre noteIntervalMs', () => {
  const extended = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, totalLength: 20 });

  for (let i = 1; i < extended.length; i++) {
    const delta = extended[i].time - extended[i - 1].time;
    assert.strictEqual(delta, BASE_PARAMS.noteIntervalMs);
  }
});

test('com difficultyStages, o intervalo estendido usa a MESMA progressao de generateNoteTimeline', () => {
  const difficultyStages = [
    { notesPlayed: 0, speedMultiplier: 1.0 },
    { notesPlayed: 4, speedMultiplier: 1.5 },
  ];

  // A timeline "normal" (sem estender) ja usa esta progressao hoje --
  // usamos ela como referencia de comportamento esperado para os
  // primeiros indices.
  const referenceParams = { ...BASE_PARAMS, length: 8, difficultyStages };
  const reference = NoteEngine.generateNoteTimeline(referenceParams);

  const extended = NoteEngine.generateExtendedTimeline({
    ...BASE_PARAMS,
    length: 8,
    difficultyStages,
    totalLength: 8,
  });

  assert.deepStrictEqual(
    extended.map((n) => n.time),
    reference.map((n) => n.time),
    'com totalLength igual ao length, generateExtendedTimeline deve reproduzir EXATAMENTE os mesmos tempos de generateNoteTimeline'
  );
});

// ---------------------------------------------------------------------
// 5. Determinismo
// ---------------------------------------------------------------------
test('a mesma entrada (seed + parametros + totalLength) produz sempre a mesma timeline estendida', () => {
  const optionsA = { ...BASE_PARAMS, totalLength: 15 };
  const optionsB = { ...BASE_PARAMS, totalLength: 15 };

  const timelineA = NoteEngine.generateExtendedTimeline(optionsA);
  const timelineB = NoteEngine.generateExtendedTimeline(optionsB);

  assert.deepStrictEqual(timelineA, timelineB);
});

test('a mesma entrada (seed + parametros + durationMs) produz sempre a mesma timeline estendida', () => {
  const optionsA = { ...BASE_PARAMS, durationMs: 20_000 };
  const optionsB = { ...BASE_PARAMS, durationMs: 20_000 };

  const timelineA = NoteEngine.generateExtendedTimeline(optionsA);
  const timelineB = NoteEngine.generateExtendedTimeline(optionsB);

  assert.deepStrictEqual(timelineA, timelineB);
});

test('computeNoteCountForDuration e deterministico (mesma entrada -> mesma saida)', () => {
  const options = {
    length: BASE_PARAMS.length,
    noteIntervalMs: BASE_PARAMS.noteIntervalMs,
    leadInMs: BASE_PARAMS.leadInMs,
    durationMs: 30_000,
  };

  const countA = NoteEngine.computeNoteCountForDuration(options);
  const countB = NoteEngine.computeNoteCountForDuration({ ...options });

  assert.strictEqual(countA, countB);
});

test('seeds diferentes produzem timelines estendidas com lanes diferentes (na amostra usada)', () => {
  const timelineA = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, totalLength: 20 });
  const timelineB = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, seed: 987654321, totalLength: 20 });

  const lanesA = timelineA.map((n) => n.lane).join(',');
  const lanesB = timelineB.map((n) => n.lane).join(',');

  assert.notStrictEqual(lanesA, lanesB);
});

// ---------------------------------------------------------------------
// 6. Padrao vazio/invalido
// ---------------------------------------------------------------------
test('generateExtendedTimeline rejeita length invalido (0)', () => {
  assert.throws(() => NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, length: 0, totalLength: 10 }));
});

test('generateExtendedTimeline rejeita length invalido (negativo)', () => {
  assert.throws(() => NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, length: -4, totalLength: 10 }));
});

test('generateExtendedTimeline rejeita length nao inteiro', () => {
  assert.throws(() => NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, length: 3.5, totalLength: 10 }));
});

test('generateExtendedTimeline rejeita noteRange invalido', () => {
  assert.throws(() => NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, noteRange: 0, totalLength: 10 }));
});

test('generateExtendedTimeline rejeita noteIntervalMs invalido', () => {
  assert.throws(() => NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, noteIntervalMs: 0, totalLength: 10 }));
});

test('generateExtendedTimeline rejeita seed invalida', () => {
  assert.throws(() => NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, seed: NaN, totalLength: 10 }));
});

test('generateExtendedTimeline rejeita startTimestamp invalido', () => {
  assert.throws(() =>
    NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, startTimestamp: undefined, totalLength: 10 })
  );
});

test('computeNoteCountForDuration rejeita length invalido', () => {
  assert.throws(() =>
    NoteEngine.computeNoteCountForDuration({ length: 0, noteIntervalMs: 600, durationMs: 10_000 })
  );
});

test('computeNoteCountForDuration rejeita noteIntervalMs invalido', () => {
  assert.throws(() =>
    NoteEngine.computeNoteCountForDuration({ length: 4, noteIntervalMs: 0, durationMs: 10_000 })
  );
});

test('sem durationMs nem totalLength, generateExtendedTimeline devolve apenas o padrao-base (nenhuma extensao)', () => {
  const extended = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS });
  assert.strictEqual(extended.length, BASE_PARAMS.length);
});

test('durationMs invalido (negativo) e tratado como "sem duracao": devolve apenas o padrao-base', () => {
  const extended = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, durationMs: -500 });
  assert.strictEqual(extended.length, BASE_PARAMS.length);
});

test('durationMs menor que o tempo ja ocupado pelo padrao-base nunca encurta a timeline', () => {
  const extended = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, durationMs: 100 });
  assert.strictEqual(extended.length, BASE_PARAMS.length);
});

test('totalLength menor que length e elevado para length (nunca encurta o padrao-base)', () => {
  const extended = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, totalLength: 2 });
  assert.strictEqual(extended.length, BASE_PARAMS.length);
});

// ---------------------------------------------------------------------
// 7. Nenhuma alteracao do padrao original
// ---------------------------------------------------------------------
test('generateExtendedTimeline nao altera o resultado de generateNoteTimeline para os mesmos parametros-base', () => {
  const before = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, totalLength: 50 });
  const after = NoteEngine.generateNoteTimeline(BASE_PARAMS);

  assert.deepStrictEqual(before, after, 'chamar generateExtendedTimeline nao pode afetar generateNoteTimeline');
});

test('os primeiros N=length elementos da timeline estendida sao equivalentes ao padrao-base (checksum preservado)', () => {
  const baseTimeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const extended = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, totalLength: 40 });

  const baseSlice = extended.slice(0, BASE_PARAMS.length);

  assert.deepStrictEqual(
    baseSlice.map((n) => n.lane),
    baseTimeline.map((n) => n.lane),
    'as lanes dos primeiros `length` indices devem bater com o padrao-base (checksum continua validavel)'
  );
  assert.deepStrictEqual(
    baseSlice.map((n) => n.time),
    baseTimeline.map((n) => n.time)
  );
  assert.deepStrictEqual(
    baseSlice.map((n) => n.id),
    baseTimeline.map((n) => n.id)
  );
});

test('a funcao nao muta nenhum objeto de entrada (options) recebido', () => {
  const options = { ...BASE_PARAMS, totalLength: 10 };
  const snapshot = JSON.stringify(options);

  NoteEngine.generateExtendedTimeline(options);

  assert.strictEqual(JSON.stringify(options), snapshot, 'options nao deveria ser mutado');
});

// ---------------------------------------------------------------------
// 8. Estrutura das notas preservada
// ---------------------------------------------------------------------
test('cada nota da timeline estendida tem exatamente os campos {id, index, lane, time, state}', () => {
  const extended = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, totalLength: 12 });

  extended.forEach((note) => {
    const keys = Object.keys(note).sort();
    assert.deepStrictEqual(keys, ['id', 'index', 'lane', 'state', 'time']);
    assert.strictEqual(typeof note.id, 'string');
    assert.strictEqual(typeof note.index, 'number');
    assert.strictEqual(typeof note.lane, 'number');
    assert.strictEqual(typeof note.time, 'number');
    assert.strictEqual(note.state, NoteEngine.NOTE_STATE.PENDING);
  });
});

test('ids das notas estendidas sao unicos e seguem o formato note-<seed>-<index>', () => {
  const extended = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, totalLength: 15 });
  const ids = extended.map((n) => n.id);

  assert.strictEqual(new Set(ids).size, ids.length, 'ids nao podem se repetir');
  extended.forEach((note, i) => {
    assert.strictEqual(note.id, NoteEngine.buildNoteId(BASE_PARAMS.seed, i));
  });
});

test('todas as lanes da timeline estendida estao dentro de [1, noteRange]', () => {
  const extended = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, totalLength: 25 });
  extended.forEach((note) => {
    assert.ok(note.lane >= 1 && note.lane <= BASE_PARAMS.noteRange);
  });
});

test('notas da timeline estendida podem transicionar de estado usando as funcoes ja existentes (setNoteState/updateTimelineStates)', () => {
  const extended = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, totalLength: 10 });
  const note = extended[6]; // indice alem do padrao-base original (length=4)
  const hitWindowMs = 150;

  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.PENDING);

  NoteEngine.updateTimelineStates(extended, note.time, hitWindowMs);
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.ACTIVE);

  const applied = NoteEngine.setNoteState(extended, note.id, NoteEngine.NOTE_STATE.HIT);
  assert.strictEqual(applied, true);
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.HIT);
});

// ---------------------------------------------------------------------
// 9. computeNoteCountForDuration -- comportamento dedicado
// ---------------------------------------------------------------------
test('computeNoteCountForDuration nunca devolve menos que length', () => {
  const count = NoteEngine.computeNoteCountForDuration({
    length: 16,
    noteIntervalMs: 600,
    leadInMs: 1800,
    durationMs: 1, // duracao irrisoria
  });
  assert.ok(count >= 16);
});

test('computeNoteCountForDuration cresce conforme durationMs cresce', () => {
  const shortCount = NoteEngine.computeNoteCountForDuration({
    length: 16,
    noteIntervalMs: 600,
    leadInMs: 1800,
    durationMs: 30_000,
  });
  const longCount = NoteEngine.computeNoteCountForDuration({
    length: 16,
    noteIntervalMs: 600,
    leadInMs: 1800,
    durationMs: 600_000,
  });
  assert.ok(longCount > shortCount);
});

test('a ultima nota gerada por generateExtendedTimeline(durationMs) cobre pelo menos durationMs', () => {
  const durationMs = 12_345;
  const extended = NoteEngine.generateExtendedTimeline({ ...BASE_PARAMS, durationMs });
  const lastNoteRelativeTime = extended[extended.length - 1].time - BASE_PARAMS.startTimestamp;

  assert.ok(
    lastNoteRelativeTime >= durationMs,
    `ultima nota (${lastNoteRelativeTime}ms) deveria cobrir pelo menos durationMs (${durationMs}ms)`
  );
});

console.log(`\n${passed} teste(s) passaram.`);
