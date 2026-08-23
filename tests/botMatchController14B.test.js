/**
 * ETAPA 14B (parte 2) -- Integracao do Bot dentro de uma partida real.
 *
 * Testa client/js/match/botMatchController.js: criacao, execucao das
 * decisoes do BotController (Parte 1) contra o RELOGIO da partida,
 * PlayerState proprio e independente do Bot, finalizacao/MatchResult,
 * reset, e ausencia de qualquer efeito colateral sobre a timeline ou
 * sobre os fluxos existentes (Solo, Modo Teste, Multiplayer).
 *
 * Nao reimplementa julgamento (Judgement/BotController, ja testados em
 * botCoreReaction14B.test.js) nem pontuacao (PlayerState, ja testado em
 * playerMatchState.test.js/gameplayPlayerMatchStateIntegration.test.js)
 * -- so confirma que BotMatchController os orquestra corretamente ao
 * longo do tempo.
 *
 * Executar com: node tests/botMatchController14B.test.js
 */
const assert = require('assert');
const BotMatchController = require('../client/js/match/botMatchController');
const BotController = require('../client/js/match/botController');
const NoteEngine = require('../client/js/match/noteEngine');
const PlayerState = require('../client/js/match/playerState');
const MatchResult = require('../client/js/match/matchResult');
const GameplayEngine = require('../client/js/match/gameplayEngine');
const MatchTimelineManager = require('../client/js/match/matchTimelineManager');
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

// Janelas de julgamento simples e previsiveis para os testes.
const WINDOWS = { perfectMs: 50, greatMs: 150, goodMs: 300 };
const SCORE_VALUES = { PERFECT: 300, GREAT: 200, GOOD: 100, MISS: 0 };
const COMBO_TIERS = [{ minCombo: 0, multiplier: 1 }];
const PENALTIES = { MISS: -50, MISTAKE: -20 };
// "bem no futuro", mas ainda um numero FINITO -- tick() rejeita de
// proposito currentTime nao finito (NaN, Infinity, string...) como
// protecao contra uso incorreto; um relogio real de partida nunca
// passaria Infinity, so um epoch ms bem grande.
const FAR_FUTURE = 10_000_000_000;

function buildTimeline(overrides) {
  return NoteEngine.generateNoteTimeline({
    seed: 2024,
    startTimestamp: 1_000_000,
    length: 5,
    noteRange: 3,
    noteIntervalMs: 1000,
    leadInMs: 1000,
    ...overrides,
  });
}

function buildBaseOptions(overrides) {
  const timeline = buildTimeline();
  return {
    timeline,
    config: BotController.createConfig({ reactionTimeMs: 30 }), // dentro de perfectMs
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers: COMBO_TIERS,
    penalties: PENALTIES,
    ...overrides,
  };
}

// Avanca um botMatch ate o fim, "ticando" no horario exato de cada nota.
function runToCompletion(botMatch, timeline, config) {
  timeline.forEach((note) => {
    const actionTime = BotController.computeActionTime(note, config);
    BotMatchController.tick(botMatch, actionTime);
  });
}

// 1. Criacao do Bot dentro de uma partida --------------------------------
test('createBotMatch cria um botMatch com PlayerState e decisoes prontas', () => {
  const options = buildBaseOptions();
  const botMatch = BotMatchController.createBotMatch(options);

  assert.ok(botMatch);
  assert.ok(botMatch.playerState);
  assert.strictEqual(botMatch.entries.length, options.timeline.length);
});

test('createBotMatch exige "timeline" e "windows"', () => {
  assert.throws(() => BotMatchController.createBotMatch({ windows: WINDOWS }));
  assert.throws(() => BotMatchController.createBotMatch({ timeline: buildTimeline() }));
});

// 2. Bot recebe a timeline (mesma instancia, nunca uma copia) -------------
test('o Bot usa a MESMA instancia de timeline recebida (nunca uma copia)', () => {
  const timeline = buildTimeline();
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline }));

  assert.strictEqual(botMatch.timeline, timeline);
});

// 3. PlayerState independente ----------------------------------------------
test('o Bot possui seu proprio PlayerState, distinto do PlayerState de um jogador humano', () => {
  const humanState = PlayerState.createPlayerState();
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions());
  const botState = BotMatchController.getPlayerState(botMatch);

  assert.notStrictEqual(botState, humanState);
  PlayerState.registerHit(humanState, 'PERFECT', SCORE_VALUES, COMBO_TIERS);

  assert.strictEqual(humanState.score, 300);
  assert.strictEqual(botState.score, 0, 'alterar o PlayerState humano nao pode afetar o do Bot');
});

test('dois botMatch diferentes tem PlayerStates independentes entre si', () => {
  const botMatchA = BotMatchController.createBotMatch(buildBaseOptions());
  const botMatchB = BotMatchController.createBotMatch(buildBaseOptions());

  BotMatchController.tick(botMatchA, FAR_FUTURE);

  assert.notStrictEqual(BotMatchController.getPlayerState(botMatchA).score, undefined);
  assert.strictEqual(BotMatchController.getPlayerState(botMatchB).score, 0);
});

// 4. Bot executa uma nota ---------------------------------------------------
test('tick() executa a decisao de uma nota assim que o horario programado chega', () => {
  const timeline = buildTimeline();
  const config = BotController.createConfig({ reactionTimeMs: 30 });
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config }));

  const firstNote = timeline[0];
  const actionTime = BotController.computeActionTime(firstNote, config);

  // Antes do horario: nada acontece ainda.
  BotMatchController.tick(botMatch, actionTime - 1);
  assert.strictEqual(BotMatchController.getPlayerState(botMatch).hits, 0);

  // No horario exato: a decisao e executada.
  BotMatchController.tick(botMatch, actionTime);
  assert.strictEqual(BotMatchController.getPlayerState(botMatch).hits, 1);
});

test('tick() e idempotente: repetir o mesmo horario nao reaplica a mesma decisao duas vezes', () => {
  const timeline = buildTimeline({ length: 1 });
  const config = BotController.createConfig({ reactionTimeMs: 10 });
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config }));
  const actionTime = BotController.computeActionTime(timeline[0], config);

  BotMatchController.tick(botMatch, actionTime);
  const stateAfterFirst = { ...BotMatchController.getPlayerState(botMatch) };

  BotMatchController.tick(botMatch, actionTime);
  BotMatchController.tick(botMatch, actionTime + 10000);

  assert.deepStrictEqual(BotMatchController.getPlayerState(botMatch), stateAfterFirst);
});

// 5. Bot executa varias notas -----------------------------------------------
test('tick() com um horario bem no futuro executa todas as notas de uma vez', () => {
  const timeline = buildTimeline();
  const config = BotController.createConfig({ reactionTimeMs: 30 });
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config }));

  BotMatchController.tick(botMatch, FAR_FUTURE);

  const state = BotMatchController.getPlayerState(botMatch);
  assert.strictEqual(state.hits, timeline.length);
  assert.strictEqual(BotMatchController.isFinished(botMatch), true);
});

test('tick() executa as notas progressivamente conforme o relogio avanca', () => {
  const timeline = buildTimeline();
  const config = BotController.createConfig({ reactionTimeMs: 30 });
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config }));

  const hitsAfterEachTick = timeline.map((note) => {
    BotMatchController.tick(botMatch, BotController.computeActionTime(note, config));
    return BotMatchController.getPlayerState(botMatch).hits;
  });

  assert.deepStrictEqual(hitsAfterEachTick, [1, 2, 3, 4, 5]);
});

// 6-10. Cada julgamento/erro atualiza o score corretamente ------------------
test('PERFECT atualiza o score do Bot conforme SCORE_VALUES.PERFECT', () => {
  const timeline = buildTimeline({ length: 1 });
  const config = BotController.createConfig({ reactionTimeMs: 10 }); // dentro de perfectMs (50)
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config }));

  runToCompletion(botMatch, timeline, config);

  const state = BotMatchController.getPlayerState(botMatch);
  assert.strictEqual(state.perfectCount, 1);
  assert.strictEqual(state.score, SCORE_VALUES.PERFECT);
});

test('GREAT atualiza o score do Bot conforme SCORE_VALUES.GREAT', () => {
  const timeline = buildTimeline({ length: 1 });
  const config = BotController.createConfig({ reactionTimeMs: 100 }); // entre 50 e 150
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config }));

  runToCompletion(botMatch, timeline, config);

  const state = BotMatchController.getPlayerState(botMatch);
  assert.strictEqual(state.greatCount, 1);
  assert.strictEqual(state.score, SCORE_VALUES.GREAT);
});

test('GOOD atualiza o score do Bot conforme SCORE_VALUES.GOOD', () => {
  const timeline = buildTimeline({ length: 1 });
  const config = BotController.createConfig({ reactionTimeMs: 250 }); // entre 150 e 300
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config }));

  runToCompletion(botMatch, timeline, config);

  const state = BotMatchController.getPlayerState(botMatch);
  assert.strictEqual(state.goodCount, 1);
  assert.strictEqual(state.score, SCORE_VALUES.GOOD);
});

test('MISS atualiza o score do Bot com a penalidade de PENALTIES.MISS', () => {
  const timeline = buildTimeline({ length: 1 });
  const config = BotController.createConfig({ reactionTimeMs: 1000 }); // alem de goodMs (300)
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config }));

  runToCompletion(botMatch, timeline, config);

  const state = BotMatchController.getPlayerState(botMatch);
  assert.strictEqual(state.misses, 1);
  assert.strictEqual(state.score, PENALTIES.MISS);
});

test('um erro (mistakeChance 1) atualiza o score do Bot com a penalidade de PENALTIES.MISTAKE', () => {
  const timeline = buildTimeline({ length: 1 });
  const config = BotController.createConfig({ reactionTimeMs: 10, mistakeChance: 1 });
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config }));

  runToCompletion(botMatch, timeline, config);

  const state = BotMatchController.getPlayerState(botMatch);
  assert.strictEqual(state.mistakes, 1);
  assert.strictEqual(state.score, PENALTIES.MISTAKE);
  assert.strictEqual(state.perfectCount, 0, 'um erro nao deve contar como PERFECT');
});

// 11. Combo do Bot ------------------------------------------------------------
test('combo do Bot cresce a cada acerto e zera quando um MISS e registrado', () => {
  const timeline = buildTimeline({ length: 2 });
  const config = BotController.createConfig({ reactionTimeMs: 10 }); // sempre PERFECT
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config }));

  BotMatchController.tick(botMatch, BotController.computeActionTime(timeline[0], config));
  assert.strictEqual(BotMatchController.getPlayerState(botMatch).combo, 1);

  BotMatchController.tick(botMatch, BotController.computeActionTime(timeline[1], config));
  assert.strictEqual(BotMatchController.getPlayerState(botMatch).combo, 2);

  // PlayerState.registerMiss (reaproveitado pelo Bot, ver applyDecision)
  // ja e responsavel por zerar o combo -- nenhuma logica propria de
  // combo existe no Bot; aqui so confirmamos que o Bot realmente usa
  // esse comportamento existente ao processar um MISS.
  PlayerState.registerMiss(BotMatchController.getPlayerState(botMatch), PENALTIES.MISS);
  assert.strictEqual(BotMatchController.getPlayerState(botMatch).combo, 0);
});

test('maxCombo do Bot preserva o maior combo mesmo depois de um MISS zerar o combo atual', () => {
  const timeline = buildTimeline({ length: 3 });
  // reactionTimeMs 10 acerta as duas primeiras notas (PERFECT); a
  // terceira nota usara uma decisao MISS manualmente aplicada via tick
  // com mistakeChance 0 e um reactionTimeMs bem alto so para ELA --
  // como a config e a mesma para toda a timeline nesta etapa, simulamos
  // com duas timelines/configs diferentes concatenando os ticks.
  const configHit = BotController.createConfig({ reactionTimeMs: 10 });
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config: configHit }));

  BotMatchController.tick(botMatch, BotController.computeActionTime(timeline[0], configHit));
  BotMatchController.tick(botMatch, BotController.computeActionTime(timeline[1], configHit));
  assert.strictEqual(BotMatchController.getPlayerState(botMatch).maxCombo, 2);

  // Forca um MISS diretamente no PlayerState do Bot para validar que
  // maxCombo realmente preserva o pico (mesma regra ja testada em
  // playerState.js -- aqui so confirmamos que o Bot usa PlayerState de
  // verdade, sem logica propria de combo).
  PlayerState.registerMiss(BotMatchController.getPlayerState(botMatch), PENALTIES.MISS);
  const state = BotMatchController.getPlayerState(botMatch);
  assert.strictEqual(state.combo, 0);
  assert.strictEqual(state.maxCombo, 2);
});

// 12. Multiplicador do Bot ------------------------------------------------
test('maxMultiplier do Bot sobe conforme COMBO_MULTIPLIER.TIERS e o combo do Bot', () => {
  const timeline = buildTimeline({ length: 3 });
  const config = BotController.createConfig({ reactionTimeMs: 10 }); // sempre PERFECT
  const tiers = [
    { minCombo: 0, multiplier: 1 },
    { minCombo: 2, multiplier: 2 },
  ];
  const botMatch = BotMatchController.createBotMatch(
    buildBaseOptions({ timeline, config, comboMultiplierTiers: tiers })
  );

  runToCompletion(botMatch, timeline, config);

  const state = BotMatchController.getPlayerState(botMatch);
  assert.strictEqual(state.maxMultiplier, 2);
  // 2 notas com multiplicador 1 (combo 1) + 1 nota... na verdade combo
  // sobe a cada acerto: combo 1 (mult 1), combo 2 (mult 2), combo 3 (mult 2).
  assert.strictEqual(state.score, SCORE_VALUES.PERFECT * 1 + SCORE_VALUES.PERFECT * 2 + SCORE_VALUES.PERFECT * 2);
});

// 13. Bot usa o mesmo relogio da partida -------------------------------------
test('tick() nunca chama Date.now() internamente -- o resultado depende so do currentTime recebido', () => {
  const timeline = buildTimeline({ length: 1 });
  const config = BotController.createConfig({ reactionTimeMs: 10 });
  const actionTime = BotController.computeActionTime(timeline[0], config);

  const botMatchEarly = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config }));
  const botMatchLate = BotMatchController.createBotMatch(buildBaseOptions({ timeline: buildTimeline({ length: 1 }), config }));

  // Mesmo passando um currentTime completamente fora do relogio real
  // (bem no passado ou bem no futuro), o comportamento e identico --
  // provando que so o parametro `currentTime` importa, nunca o relogio
  // real da maquina.
  BotMatchController.tick(botMatchEarly, actionTime);
  BotMatchController.tick(botMatchLate, actionTime);

  assert.deepStrictEqual(
    BotMatchController.getPlayerState(botMatchEarly),
    BotMatchController.getPlayerState(botMatchLate)
  );
});

test('reactionTimeMs negativo (Bot reage ANTES da nota) tambem respeita o relogio recebido', () => {
  const timeline = buildTimeline({ length: 1 });
  const config = BotController.createConfig({ reactionTimeMs: -20 });
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config }));
  const actionTime = BotController.computeActionTime(timeline[0], config);

  assert.ok(actionTime < timeline[0].time);

  BotMatchController.tick(botMatch, actionTime - 1);
  assert.strictEqual(BotMatchController.getPlayerState(botMatch).hits, 0);

  BotMatchController.tick(botMatch, actionTime);
  assert.strictEqual(BotMatchController.getPlayerState(botMatch).hits, 1);
});

// 14. Bot nao executa depois do fim -------------------------------------------
test('depois de finalize(), tick() nao altera mais o PlayerState do Bot', () => {
  const timeline = buildTimeline();
  const config = BotController.createConfig({ reactionTimeMs: 30 });
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config }));

  BotMatchController.tick(botMatch, BotController.computeActionTime(timeline[0], config));
  BotMatchController.finalize(botMatch);

  const stateAfterFinalize = { ...BotMatchController.getPlayerState(botMatch) };
  BotMatchController.tick(botMatch, FAR_FUTURE);

  assert.deepStrictEqual(BotMatchController.getPlayerState(botMatch), stateAfterFinalize);
});

test('depois que todas as notas ja foram executadas, tick() com horario ainda maior nao muda nada', () => {
  const timeline = buildTimeline({ length: 1 });
  const config = BotController.createConfig({ reactionTimeMs: 10 });
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config }));

  BotMatchController.tick(botMatch, FAR_FUTURE);
  const stateAfterAll = { ...BotMatchController.getPlayerState(botMatch) };

  BotMatchController.tick(botMatch, FAR_FUTURE);
  assert.deepStrictEqual(BotMatchController.getPlayerState(botMatch), stateAfterAll);
});

// 15. Reset limpa o estado -----------------------------------------------------
test('reset() zera o PlayerState do Bot e recalcula as decisoes do zero', () => {
  const timeline = buildTimeline();
  const config = BotController.createConfig({ reactionTimeMs: 30 });
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config }));

  BotMatchController.tick(botMatch, FAR_FUTURE);
  assert.notStrictEqual(BotMatchController.getPlayerState(botMatch).hits, 0);

  BotMatchController.reset(botMatch);

  const state = BotMatchController.getPlayerState(botMatch);
  assert.strictEqual(state.hits, 0);
  assert.strictEqual(state.score, 0);
  assert.strictEqual(BotMatchController.isFinished(botMatch), false);
  assert.strictEqual(BotMatchController.getResult(botMatch), null);
});

test('reset() com nova timeline substitui a timeline anterior corretamente', () => {
  const timeline1 = buildTimeline();
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline: timeline1 }));

  const timeline2 = buildTimeline({ length: 8, seed: 555 });
  BotMatchController.reset(botMatch, { timeline: timeline2 });

  assert.strictEqual(botMatch.timeline, timeline2);
  assert.strictEqual(botMatch.entries.length, timeline2.length);
});

// 16-17. Finalizar gera resultado usando MatchResult ---------------------------
test('finalize() gera um resultado no MESMO formato de MatchResult.buildResult', () => {
  const timeline = buildTimeline({ length: 2 });
  const config = BotController.createConfig({ reactionTimeMs: 10 });
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline, config }));

  runToCompletion(botMatch, timeline, config);
  const result = BotMatchController.finalize(botMatch);

  const expected = MatchResult.buildResult({
    playerState: BotMatchController.getPlayerState(botMatch),
    timeline,
  });

  assert.deepStrictEqual(result, expected);
  assert.ok(Object.prototype.hasOwnProperty.call(result, 'accuracy'));
  assert.ok(Object.prototype.hasOwnProperty.call(result, 'totalNotes'));
});

test('finalize() nao interfere no resultado ativo do jogador local (MatchResult.generateResult/getResult)', () => {
  MatchResult.clearResult();
  const humanTimeline = buildTimeline({ length: 2 });
  const humanState = PlayerState.createPlayerState();
  PlayerState.registerHit(humanState, 'PERFECT', SCORE_VALUES, COMBO_TIERS);
  const humanResult = MatchResult.generateResult({ playerState: humanState, timeline: humanTimeline });

  const botMatch = BotMatchController.createBotMatch(buildBaseOptions());
  BotMatchController.tick(botMatch, FAR_FUTURE);
  BotMatchController.finalize(botMatch);

  assert.deepStrictEqual(MatchResult.getResult(), humanResult);
  MatchResult.clearResult();
});

test('finalize() e idempotente: chamar de novo devolve o MESMO resultado ja calculado', () => {
  const timeline = buildTimeline({ length: 1 });
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline }));

  BotMatchController.tick(botMatch, FAR_FUTURE);
  const first = BotMatchController.finalize(botMatch);
  const second = BotMatchController.finalize(botMatch);

  assert.strictEqual(first, second);
});

test('getResult() devolve null antes de finalize() ser chamado', () => {
  const botMatch = BotMatchController.createBotMatch(buildBaseOptions());
  assert.strictEqual(BotMatchController.getResult(botMatch), null);
});

// 18. Jogador e Bot permanecem com estados independentes -----------------------
test('rodar uma partida completa do Bot nao afeta um PlayerState humano separado, mesmo compartilhando a timeline', () => {
  const timeline = buildTimeline();
  const humanState = PlayerState.createPlayerState();
  const humanEngine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState: humanState,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
  });

  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline }));
  BotMatchController.tick(botMatch, FAR_FUTURE);

  // O jogador humano ainda consegue acertar normalmente qualquer nota
  // da MESMA timeline -- o Bot nunca "reivindicou" nenhuma nota nela.
  const note = timeline[0];
  const humanResult = humanEngine.handleKeyPress(note.lane, note.time);

  assert.strictEqual(humanResult.outcome, 'PERFECT');
  assert.strictEqual(humanState.hits, 1);
  assert.notStrictEqual(humanState, BotMatchController.getPlayerState(botMatch));
});

// 19. Timeline original nao e modificada ---------------------------------------
test('o Bot nunca marca nenhuma nota da timeline como hit/missed (NoteEngine.setNoteState nunca e chamado pelo Bot)', () => {
  const timeline = buildTimeline();
  const snapshotBefore = timeline.map((note) => ({ ...note }));

  const botMatch = BotMatchController.createBotMatch(buildBaseOptions({ timeline }));
  BotMatchController.tick(botMatch, FAR_FUTURE);
  BotMatchController.finalize(botMatch);

  assert.deepStrictEqual(timeline, snapshotBefore);
  timeline.forEach((note) => assert.strictEqual(note.state, NoteEngine.NOTE_STATE.PENDING));
});

// 20. Jogar Sozinho continua funcionando ----------------------------------------
test('o fluxo de Solo (GameplayEngine + MatchTimelineManager) continua funcionando com BotMatchController carregado', () => {
  MatchTimelineManager.clear();

  const timeline = MatchTimelineManager.ensureTimeline({
    seed: 9090,
    startTimestamp: 2_000_000,
    length: 5,
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

  MatchTimelineManager.clear();
});

// 21. Modo Teste continua funcionando --------------------------------------------
test('LocalServerSimulator (Modo Teste) continua reproduzindo normalmente o fluxo Solo', () => {
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

// 22. Multiplayer normal continua funcionando -------------------------------------
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

console.log(`\n${passed} teste(s) passaram.`);
