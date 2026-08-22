/**
 * Testes automatizados do sistema de resultado final da partida
 * (Etapa 5B-4B).
 *
 * PlayerState (contagem de score/combo/hits/misses/mistakes) e
 * NoteEngine/MatchEndDetector (quando a partida termina) ja sao
 * cobertos por seus proprios arquivos de teste -- este arquivo testa
 * apenas a camada nova: MatchResult calcula/guarda o resultado
 * corretamente a partir do que esses sistemas ja fornecem, sem
 * recalcular nada por conta propria e sem misturar jogadores.
 *
 * Executar com: node tests/matchResult.test.js
 */
const assert = require('assert');
const NoteEngine = require('../client/js/match/noteEngine');
const PlayerState = require('../client/js/match/playerState');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const MatchEndDetector = require('../client/js/match/matchEndDetector');
const MatchResult = require('../client/js/match/matchResult');

const BASE_PARAMS = {
  seed: 111,
  startTimestamp: 1_000_000,
  length: 10,
  noteRange: 3,
  noteIntervalMs: 600,
  leadInMs: 0,
};

const WINDOWS = { perfectMs: 60, goodMs: 150 };
const SCORE_VALUES = { PERFECT: 300, GOOD: 100, MISS: 0 };

let passed = 0;
function test(name, fn) {
  try {
    MatchResult.clearResult(); // cada teste comeca sem resultado vazado do anterior
    fn();
    passed++;
    console.log(`OK   - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

/**
 * Monta uma timeline + PlayerState com uma quantidade especifica de
 * hits/misses/mistakes (via GameplayEngine real, como aconteceria numa
 * partida de verdade) -- nao mexe direto nos numeros do PlayerState.
 */
function playThroughMatch({ hits = 0, misses = 0, mistakes = 0, params = BASE_PARAMS } = {}) {
  const timeline = NoteEngine.generateNoteTimeline(params);
  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
  });

  let index = 0;

  for (let i = 0; i < hits; i++, index++) {
    const note = timeline[index];
    engine.handleKeyPress(note.lane, note.time);
  }
  for (let i = 0; i < misses; i++, index++) {
    const note = timeline[index];
    engine.processExpiredNotes(note.time + WINDOWS.goodMs + 1, WINDOWS.goodMs);
  }
  for (let i = 0; i < mistakes; i++) {
    // Tecla errada (lane invalida) nao consome nenhuma nota -- so
    // registra mistake, exatamente como GameplayEngine ja faz hoje.
    engine.handleKeyPress(999, Date.now());
  }

  return { timeline, playerState, engine };
}

// ---------------------------------------------------------------------
// 1 e 11. Resultado e criado corretamente quando a partida termina,
// disparado pelo callback do MatchEndDetector, uma unica vez
// ---------------------------------------------------------------------
test('generateResult, chamado a partir do onMatchEnd do MatchEndDetector, cria o resultado exatamente uma vez', () => {
  const { timeline, playerState } = playThroughMatch({ hits: 6, misses: 3, mistakes: 1 });
  // Preenche as notas restantes (as usadas em handleKeyPress ja viraram
  // hit; as usadas em processExpiredNotes ja viraram missed) -- aqui so
  // garantimos que a timeline INTEIRA fica concluida para o detector dar match.
  timeline.forEach((note) => {
    if (!NoteEngine.isTerminal(note.state)) note.state = NoteEngine.NOTE_STATE.MISSED;
  });

  let generateCalls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => {
      generateCalls += 1;
      MatchResult.generateResult({ playerState, timeline });
    },
  });

  detector.checkForEnd();
  detector.checkForEnd(); // chamadas extras (mesmo frame seguinte) nao devem gerar de novo
  detector.checkForEnd();

  assert.strictEqual(generateCalls, 1, 'o resultado so pode ser gerado uma vez por partida');
  assert.ok(MatchResult.hasResult());
});

// ---------------------------------------------------------------------
// 2-6. Cada campo do resultado corresponde exatamente ao PlayerState
// ---------------------------------------------------------------------
test('score final do resultado corresponde ao score do PlayerState', () => {
  const { timeline, playerState } = playThroughMatch({ hits: 4 });
  const result = MatchResult.generateResult({ playerState, timeline });

  assert.strictEqual(result.score, playerState.score);
  assert.strictEqual(result.score, SCORE_VALUES.PERFECT * 4);
});

test('maxCombo do resultado corresponde ao maxCombo do PlayerState', () => {
  const { timeline, playerState } = playThroughMatch({ hits: 5, misses: 1 });
  const result = MatchResult.generateResult({ playerState, timeline });

  assert.strictEqual(result.maxCombo, playerState.maxCombo);
  assert.strictEqual(result.maxCombo, 5); // combo quebrou no miss depois de 5 acertos seguidos
});

test('hits do resultado correspondem aos hits do PlayerState', () => {
  const { timeline, playerState } = playThroughMatch({ hits: 7, misses: 2 });
  const result = MatchResult.generateResult({ playerState, timeline });

  assert.strictEqual(result.hits, playerState.hits);
  assert.strictEqual(result.hits, 7);
});

test('misses do resultado correspondem aos misses do PlayerState', () => {
  const { timeline, playerState } = playThroughMatch({ hits: 3, misses: 4 });
  const result = MatchResult.generateResult({ playerState, timeline });

  assert.strictEqual(result.misses, playerState.misses);
  assert.strictEqual(result.misses, 4);
});

test('mistakes do resultado correspondem aos mistakes do PlayerState', () => {
  const { timeline, playerState } = playThroughMatch({ hits: 2, mistakes: 3 });
  const result = MatchResult.generateResult({ playerState, timeline });

  assert.strictEqual(result.mistakes, playerState.mistakes);
  assert.strictEqual(result.mistakes, 3);
});

// ---------------------------------------------------------------------
// 7. Total de notas e calculado corretamente
// ---------------------------------------------------------------------
test('totalNotes corresponde ao tamanho real da timeline da partida', () => {
  const { timeline, playerState } = playThroughMatch({ hits: 2, params: { ...BASE_PARAMS, length: 25 } });
  const result = MatchResult.generateResult({ playerState, timeline });

  assert.strictEqual(result.totalNotes, 25);
  assert.strictEqual(result.totalNotes, timeline.length);
});

// ---------------------------------------------------------------------
// 8. Precisao e calculada corretamente (hits / totalNotes * 100)
// ---------------------------------------------------------------------
test('accuracy e calculada como hits / totalNotes * 100', () => {
  assert.strictEqual(MatchResult.calculateAccuracy(82, 100), 82);
  assert.strictEqual(MatchResult.calculateAccuracy(1, 3), 33.33);
  assert.strictEqual(MatchResult.calculateAccuracy(2, 3), 66.67);
});

test('accuracy do resultado bate com o exemplo da especificacao (82 hits em 100 notas = 82%)', () => {
  const params = { ...BASE_PARAMS, length: 100 };
  const { timeline, playerState } = playThroughMatch({ hits: 82, misses: 12, mistakes: 6, params });
  timeline.forEach((note) => {
    if (!NoteEngine.isTerminal(note.state)) note.state = NoteEngine.NOTE_STATE.MISSED;
  });

  const result = MatchResult.generateResult({ playerState, timeline });

  assert.deepStrictEqual(result, {
    score: playerState.score,
    maxCombo: playerState.maxCombo,
    hits: 82,
    misses: playerState.misses,
    mistakes: 6,
    totalNotes: 100,
    accuracy: 82,
  });
});

// ---------------------------------------------------------------------
// 9. Precisao com 0 notas retorna 0 (sem divisao por zero)
// ---------------------------------------------------------------------
test('accuracy com totalNotes 0 retorna 0, sem lancar erro de divisao por zero', () => {
  assert.strictEqual(MatchResult.calculateAccuracy(0, 0), 0);
  assert.strictEqual(MatchResult.calculateAccuracy(5, 0), 0);
});

test('buildResult com timeline vazia produz totalNotes 0 e accuracy 0', () => {
  const playerState = PlayerState.createPlayerState();
  const result = MatchResult.buildResult({ playerState, timeline: [] });

  assert.strictEqual(result.totalNotes, 0);
  assert.strictEqual(result.accuracy, 0);
});

// ---------------------------------------------------------------------
// 10. Resultado nao e recalculado a cada frame -- generateResult so
// muda o resultado ativo quando explicitamente chamada de novo
// ---------------------------------------------------------------------
test('o resultado ativo nao muda sozinho so por o PlayerState continuar mudando depois (nenhum recalculo automatico)', () => {
  const { timeline, playerState } = playThroughMatch({ hits: 3 });
  const result = MatchResult.generateResult({ playerState, timeline });
  const snapshotScore = result.score;

  // Simula o PlayerState "continuando a mudar" (nao deveria acontecer
  // de verdade depois do fim da partida, mas prova que MatchResult
  // tirou um retrato e nao uma referencia viva).
  playerState.score += 99999;
  playerState.hits += 5;

  assert.strictEqual(result.score, snapshotScore);
  assert.strictEqual(MatchResult.getResult().score, snapshotScore);
});

test('chamar getResult() varias vezes seguidas nunca recalcula nada, so devolve o mesmo objeto ja gerado', () => {
  const { timeline, playerState } = playThroughMatch({ hits: 1 });
  const generated = MatchResult.generateResult({ playerState, timeline });

  const readA = MatchResult.getResult();
  const readB = MatchResult.getResult();

  assert.strictEqual(readA, generated);
  assert.strictEqual(readB, generated);
});

// ---------------------------------------------------------------------
// 12. Resultado de um jogador nao interfere no outro
// ---------------------------------------------------------------------
test('resultados de dois jogadores diferentes (duas timelines/PlayerStates) nao se misturam', () => {
  const jogo1 = playThroughMatch({ hits: 9, misses: 1 });
  const jogo2 = playThroughMatch({ hits: 6, misses: 4 });

  const resultado1 = MatchResult.buildResult({ playerState: jogo1.playerState, timeline: jogo1.timeline });
  const resultado2 = MatchResult.buildResult({ playerState: jogo2.playerState, timeline: jogo2.timeline });

  assert.strictEqual(resultado1.hits, 9);
  assert.strictEqual(resultado2.hits, 6);
  assert.notStrictEqual(resultado1.score, resultado2.score);
  assert.notStrictEqual(resultado1.hits, resultado2.hits);
  // Objetos completamente independentes -- mudar um nao pode mudar o outro.
  resultado1.score = -1;
  assert.notStrictEqual(resultado2.score, -1);
});

// ---------------------------------------------------------------------
// 13. Nova partida comeca sem resultado antigo
// ---------------------------------------------------------------------
test('clearResult() descarta o resultado ativo (getResult volta a null, hasResult volta a false)', () => {
  const { timeline, playerState } = playThroughMatch({ hits: 2 });
  MatchResult.generateResult({ playerState, timeline });
  assert.ok(MatchResult.hasResult());

  MatchResult.clearResult();

  assert.strictEqual(MatchResult.getResult(), null);
  assert.strictEqual(MatchResult.hasResult(), false);
});

test('uma nova partida (clearResult no inicio, como main.js faz em startMatchGameplay) nao herda o resultado da anterior', () => {
  const partidaAnterior = playThroughMatch({ hits: 8, misses: 2 });
  MatchResult.generateResult({ playerState: partidaAnterior.playerState, timeline: partidaAnterior.timeline });
  assert.ok(MatchResult.hasResult());

  // Equivalente ao que startMatchGameplay faz antes de comecar a nova partida.
  MatchResult.clearResult();
  assert.strictEqual(MatchResult.hasResult(), false, 'a partida nova ainda nao tem resultado nenhum');

  const partidaNova = playThroughMatch({ hits: 3, misses: 1 });
  const resultadoNovo = MatchResult.generateResult({ playerState: partidaNova.playerState, timeline: partidaNova.timeline });

  assert.strictEqual(resultadoNovo.hits, 3, 'nao pode ter herdado os 8 hits da partida anterior');
});

// ---------------------------------------------------------------------
// 14. Partida cancelada antes do fim nao gera resultado
// ---------------------------------------------------------------------
test('uma partida cancelada antes do fim (clearResult, sem generateResult) nao deixa nenhum resultado disponivel', () => {
  const { timeline, playerState } = playThroughMatch({ hits: 4 });
  // A partida foi cancelada -- nada chama generateResult(). O
  // equivalente ao handler de match_cancelled em main.js so chama clearResult().
  MatchResult.clearResult();

  assert.strictEqual(MatchResult.hasResult(), false);
  assert.strictEqual(MatchResult.getResult(), null);
  // (playerState/timeline continuam existindo normalmente -- so nao ha
  // resultado FINAL gerado a partir deles, que e a garantia pedida.)
  assert.ok(playerState.hits >= 0 && timeline.length > 0);
});

// ---------------------------------------------------------------------
// 15. Todos os dados permanecem disponiveis depois do termino
// ---------------------------------------------------------------------
test('todos os campos do resultado continuam disponiveis (nenhum some) depois de gerado', () => {
  const { timeline, playerState } = playThroughMatch({ hits: 5, misses: 2, mistakes: 1 });
  const result = MatchResult.generateResult({ playerState, timeline });

  ['score', 'maxCombo', 'hits', 'misses', 'mistakes', 'totalNotes', 'accuracy'].forEach((field) => {
    assert.ok(Object.prototype.hasOwnProperty.call(result, field), `campo ausente: ${field}`);
    assert.strictEqual(typeof result[field], 'number', `campo nao numerico: ${field}`);
  });

  // E continuam disponiveis via getResult() depois, sem precisar
  // guardar a referencia original em lugar nenhum.
  const readLater = MatchResult.getResult();
  assert.deepStrictEqual(readLater, result);
});

console.log(`\n${passed} teste(s) passaram.`);
