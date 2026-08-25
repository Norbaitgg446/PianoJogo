/**
 * ETAPA 15C-1D — Parte 3: Validacao do fluxo COMPLETO da duracao no Bot.
 *
 * As Partes 1 e 2 ja implementaram e testaram, isoladamente:
 *   - Parte 1 (tests/botMatchDuration15C1D.test.js, blocos 1-5): a
 *     resolucao de `selectedMatchDuration` e a passagem de `durationMs`
 *     para `BotMatchController.createBotMatch`.
 *   - Parte 2 (tests/botMatchDuration15C1D.test.js, blocos 6-9): o Bot
 *     encerrando pelo `MatchEndDetector` compartilhado com o Solo.
 *
 * Esta Parte 3 NAO adiciona nenhuma logica nova. Ela fecha a validacao
 * do fluxo INTEIRO, ponta a ponta, exatamente como um jogador vivencia:
 *
 *   escolher dificuldade -> escolher duracao -> partida comeca ->
 *   duracao permanece associada -> o MESMO MatchEndDetector controla o
 *   fim -> ao atingir o limite a partida termina -> o Bot para de ser
 *   processado -> o resultado existente e exibido -> "Jogar Novamente"
 *   preserva dificuldade e duracao -> "Voltar ao Menu" limpa os dois.
 *
 * Mesma estrategia ja usada por toda a serie 14D/15 (main.js e um
 * script de navegador, entao esta suite combina):
 *
 *   (a) COMPOSICAO REAL: os MESMOS modulos (ClientConfig, MatchDuration,
 *       NoteEngine, BotController, BotMatchController, MatchEndDetector,
 *       MatchResult, PlayerState) montados EXATAMENTE como
 *       startMatchGameplay/handleLocalMatchEnd ja fazem, para provar
 *       que a composicao inteira funciona de ponta a ponta -- nenhuma
 *       peca e reimplementada aqui;
 *
 *   (b) INSPECAO ESTATICA de client/js/main.js -- confirma que os
 *       PONTOS DE ENTRADA/SAIDA (selecao de dificuldade/duracao,
 *       "Jogar Novamente", "Voltar ao Menu") realmente ligam essas
 *       pecas do jeito validado em (a), e que nenhum sistema paralelo
 *       foi introduzido.
 *
 * Executar com: node tests/botMatchDurationFullFlow15C1D3.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ClientConfig = require('../client/js/config');
const MatchDuration = require('../client/js/match/matchDuration');
const MatchEndDetector = require('../client/js/match/matchEndDetector');
const MatchResult = require('../client/js/match/matchResult');
const NoteEngine = require('../client/js/match/noteEngine');
const BotController = require('../client/js/match/botController');
const BotMatchController = require('../client/js/match/botMatchController');

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

const mainJsPath = path.join(__dirname, '../client/js/main.js');
const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');

function extractBlock(regex, label) {
  const match = regex.exec(mainJsContent);
  assert.ok(match, `bloco nao encontrado em main.js: ${label}`);
  return match[0];
}

const WINDOWS = {
  perfectMs: ClientConfig.JUDGEMENT_WINDOWS.PERFECT_MS,
  greatMs: ClientConfig.JUDGEMENT_WINDOWS.GREAT_MS,
  goodMs: ClientConfig.JUDGEMENT_WINDOWS.GOOD_MS,
};

/**
 * Reproduz, com os modulos REAIS, a composicao completa que
 * startMatchGameplay faz para UMA partida de Bot (passos 1-5 do
 * enunciado): dificuldade escolhida -> duracao escolhida -> timeline ->
 * BotMatchController -> MatchEndDetector, os DOIS usando o MESMO
 * `resolvedMatchDurationMs` e o MESMO `startTime`.
 */
function playOneBotMatch({ difficulty, durationId, startTimestamp = 1_000_000, seed = 15200 }) {
  const timeline = NoteEngine.generateNoteTimeline({
    seed,
    startTimestamp,
    length: 6,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });

  const resolvedMatchDurationMs = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, durationId);
  const botConfig = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, difficulty);

  const botMatch = BotMatchController.createBotMatch({
    timeline,
    config: botConfig,
    windows: WINDOWS,
    scoreValues: ClientConfig.SCORE_VALUES,
    comboMultiplierTiers: ClientConfig.COMBO_MULTIPLIER.TIERS,
    penalties: ClientConfig.PENALTIES,
    durationMs: resolvedMatchDurationMs,
  });

  let matchEndCalls = 0;
  let botResultAtEnd = null;
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    // Mesmo formato de handleLocalMatchEnd: finaliza o Bot (mesma
    // funcao ja existente, BotMatchController.finalize) assim que o
    // detector dispara -- nenhum segundo "fim de partida" e inventado.
    onMatchEnd: () => {
      matchEndCalls++;
      botResultAtEnd = BotMatchController.finalize(botMatch);
    },
    durationMs: resolvedMatchDurationMs,
    startTime: startTimestamp,
  });

  return {
    timeline,
    botConfig,
    botMatch,
    detector,
    resolvedMatchDurationMs,
    getMatchEndCalls: () => matchEndCalls,
    getBotResultAtEnd: () => botResultAtEnd,
  };
}

// =====================================================================
// PASSOS 1-4: dificuldade + duracao escolhidas chegam e PERMANECEM
// associadas a partida do Bot
// =====================================================================

test('a duracao escolhida chega ao Bot: botMatch.durationMs === o ms resolvido para o identificador escolhido', () => {
  const { botMatch, resolvedMatchDurationMs } = playOneBotMatch({ difficulty: 'MEDIUM', durationId: '1M' });
  assert.strictEqual(resolvedMatchDurationMs, ClientConfig.MATCH_DURATION_MS['1M']);
  assert.strictEqual(botMatch.durationMs, resolvedMatchDurationMs);
});

test('a duracao permanece associada durante toda a partida (varios frames antes do limite, sem nenhuma mudanca)', () => {
  const { botMatch, detector, getMatchEndCalls } = playOneBotMatch({
    difficulty: 'HARD',
    durationId: '1M',
    startTimestamp: 2_000_000,
  });

  // Varios "frames" (mesmo padrao do loop real: tick + checkForEnd sob
  // o MESMO currentTime), todos antes do limite de 60000ms.
  [2_000_600, 2_010_000, 2_030_000, 2_059_999].forEach((currentTime) => {
    BotMatchController.tick(botMatch, currentTime);
    detector.checkForEnd(currentTime);
    assert.strictEqual(botMatch.durationMs, 60000, 'durationMs nunca deveria mudar durante a partida');
  });
  assert.strictEqual(getMatchEndCalls(), 0, 'a partida nao deveria ter terminado ainda');
});

// =====================================================================
// PASSO 5: o MESMO detector de encerramento controla o limite
// (30S/1M/5M/10M)
// =====================================================================

['30S', '1M', '5M', '10M'].forEach((durationId) => {
  test(`a partida de Bot com duracao "${durationId}" termina exatamente no limite, via o MESMO MatchEndDetector`, () => {
    const startTimestamp = 3_000_000;
    const { detector, resolvedMatchDurationMs, getMatchEndCalls } = playOneBotMatch({
      difficulty: 'EASY',
      durationId,
      startTimestamp,
    });

    assert.strictEqual(detector.checkForEnd(startTimestamp + resolvedMatchDurationMs - 1), false);
    assert.strictEqual(getMatchEndCalls(), 0);

    assert.strictEqual(detector.checkForEnd(startTimestamp + resolvedMatchDurationMs), true);
    assert.strictEqual(getMatchEndCalls(), 1);
  });
});

test('a partida de Bot tambem termina QUANDO o currentTime ja passou do limite (nao so exatamente nele)', () => {
  const startTimestamp = 4_000_000;
  const { detector, getMatchEndCalls } = playOneBotMatch({ difficulty: 'MEDIUM', durationId: '30S', startTimestamp });
  assert.strictEqual(detector.checkForEnd(startTimestamp + 45_000), true);
  assert.strictEqual(getMatchEndCalls(), 1);
});

// =====================================================================
// PASSOS 6-7: ao atingir a duracao, a partida termina normalmente E o
// Bot PARA de ser processado
// =====================================================================

test('ao atingir a duracao, o Bot para de ser processado: tick() apos o fim nao executa mais nenhuma decisao nova', () => {
  const startTimestamp = 5_000_000;
  const { botMatch, detector } = playOneBotMatch({ difficulty: 'HARD', durationId: '30S', startTimestamp });

  // Chega no limite -> onMatchEnd -> BotMatchController.finalize(botMatch)
  // (ver playOneBotMatch acima, mesmo formato de handleLocalMatchEnd).
  detector.checkForEnd(startTimestamp + 30_000);
  assert.strictEqual(BotMatchController.isFinished(botMatch), true, 'finalize() deveria marcar o Bot como finalizado');

  const executedCountAntes = botMatch.entries.filter((e) => e.executed).length;
  const scoreAntes = botMatch.playerState.score;

  // Mesmo que ainda restassem decisoes nao executadas (partida
  // encerrada antes do fim da timeline), um tick() bem mais tarde NAO
  // pode mudar mais nada -- exatamente a garantia ja documentada em
  // BotMatchController.tick/finalize (Etapa 14C/14B).
  const executedAgora = BotMatchController.tick(botMatch, startTimestamp + 999_999);
  assert.deepStrictEqual(executedAgora, [], 'tick() apos o fim nao deveria executar nenhuma decisao nova');

  const executedCountDepois = botMatch.entries.filter((e) => e.executed).length;
  assert.strictEqual(executedCountDepois, executedCountAntes, 'nenhuma nota nova deveria ter sido executada');
  assert.strictEqual(botMatch.playerState.score, scoreAntes, 'o score do Bot nao deveria mudar depois do fim');
});

test('checkForEnd chamado varias vezes depois do fim so dispara onMatchEnd/finalize UMA UNICA vez', () => {
  const startTimestamp = 6_000_000;
  const { detector, botMatch, getMatchEndCalls } = playOneBotMatch({
    difficulty: 'EASY',
    durationId: '30S',
    startTimestamp,
  });

  detector.checkForEnd(startTimestamp + 30_000);
  const resultAfterFirstEnd = BotMatchController.getResult(botMatch);

  detector.checkForEnd(startTimestamp + 40_000);
  detector.checkForEnd(startTimestamp + 50_000);

  assert.strictEqual(getMatchEndCalls(), 1, 'onMatchEnd deveria disparar uma UNICA vez');
  assert.strictEqual(BotMatchController.getResult(botMatch), resultAfterFirstEnd, 'o resultado do Bot nao deveria ser recalculado');
});

// =====================================================================
// PASSO 8: o resultado EXISTENTE (MatchResult.buildResult, mesmo
// formato do jogador humano) continua funcionando normalmente
// =====================================================================

test('ao terminar por duracao, o resultado do Bot e gerado pelo MESMO MatchResult.buildResult (nenhum formato novo)', () => {
  const startTimestamp = 7_000_000;
  const { detector, botMatch, getBotResultAtEnd } = playOneBotMatch({
    difficulty: 'MEDIUM',
    durationId: '30S',
    startTimestamp,
  });

  detector.checkForEnd(startTimestamp + 30_000);

  const botResult = getBotResultAtEnd();
  assert.ok(botResult, 'BotMatchController.finalize deveria devolver um resultado');
  assert.strictEqual(botResult, BotMatchController.getResult(botMatch));

  // Mesmo formato que MatchResult.buildResult ja produz para o jogador
  // humano -- comparando com uma chamada direta e independente.
  const directResult = MatchResult.buildResult({ playerState: botMatch.playerState, timeline: botMatch.timeline });
  assert.deepStrictEqual(botResult, directResult);
});

// =====================================================================
// PASSO 9: "Jogar Novamente" preserva dificuldade E duracao
// =====================================================================

test('"Jogar Novamente" (revanche do Bot) reutiliza a MESMA dificuldade E a MESMA duracao escolhidas antes -- nova partida, mesmos parametros', () => {
  const primeira = playOneBotMatch({ difficulty: 'HARD', durationId: '5M', startTimestamp: 8_000_000, seed: 15201 });

  // "Jogar Novamente" nao muda selectedBotDifficulty/selectedMatchDuration
  // (ver inspecao estatica abaixo) -- simula exatamente isso: os MESMOS
  // dois identificadores sao reaproveitados para montar a partida
  // seguinte, com startTime novo (nova partida de verdade).
  const revanche = playOneBotMatch({ difficulty: 'HARD', durationId: '5M', startTimestamp: 8_100_000, seed: 15201 });

  assert.strictEqual(revanche.resolvedMatchDurationMs, primeira.resolvedMatchDurationMs);
  assert.strictEqual(revanche.botMatch.durationMs, primeira.botMatch.durationMs);
  assert.deepStrictEqual(revanche.botConfig, primeira.botConfig);

  // Nova partida de verdade: PlayerState novo, independente da anterior.
  assert.notStrictEqual(revanche.botMatch.playerState, primeira.botMatch.playerState);
});

test('"Jogar Novamente" (Bot): o handler nunca toca em selectedBotDifficulty nem selectedMatchDuration, nem reabre as telas de selecao', () => {
  const onPlayAgainBlock = extractBlock(
    /ResultRenderer\.setOnPlayAgain\(\(\) => \{[^]*?\n {2}\}\);/,
    'ResultRenderer.setOnPlayAgain'
  );

  assert.ok(
    !onPlayAgainBlock.includes('selectedBotDifficulty'),
    '"Jogar Novamente" nao deveria tocar em selectedBotDifficulty'
  );
  assert.ok(
    !onPlayAgainBlock.includes('selectedMatchDuration'),
    '"Jogar Novamente" nao deveria tocar em selectedMatchDuration'
  );
  assert.ok(
    !onPlayAgainBlock.includes('showBotDifficultySelection'),
    '"Jogar Novamente" nao deveria reabrir a tela de selecao de dificuldade'
  );
  assert.ok(
    !onPlayAgainBlock.includes('showMatchDurationSelection'),
    '"Jogar Novamente" nao deveria reabrir a tela de selecao de duracao'
  );
  // Reutiliza exclusivamente o pipeline ja existente (start_solo_match
  // para Solo/Bot, rematchController para Multiplayer real) -- nenhum
  // sistema novo de revanche.
  assert.ok(onPlayAgainBlock.includes("SocketClient.send('start_solo_match')"));
  assert.ok(onPlayAgainBlock.includes('rematchController.requestRematch()'));
});

test('a partida de Bot iniciada pelo mesmo pipeline (start_solo_match) chega ao servidor com mode "solo", o que faz isSoloMode=true tambem para o Bot (ver linha "message.match.mode === \'solo\'")', () => {
  assert.ok(
    /isSoloMode = message\.match\.mode === 'solo';/.test(mainJsContent),
    'startMatchGameplay deveria continuar derivando isSoloMode do modo "solo" retornado pelo servidor -- mesmo pipeline usado por Bot e por "Jogar Sozinho"'
  );
});

// =====================================================================
// PASSO 10: "Voltar ao Menu" limpa dificuldade E duracao corretamente
// =====================================================================

test('"Voltar ao Menu" limpa selectedBotDifficulty E selectedMatchDuration (alem de isBotMode/botMatch)', () => {
  const onBackToMenuBlock = extractBlock(
    /ResultRenderer\.setOnBackToMenu\(\(\) => \{[^]*?\n {2}\}\);/,
    'ResultRenderer.setOnBackToMenu'
  );

  assert.ok(onBackToMenuBlock.includes('selectedBotDifficulty = null'), '"Voltar ao Menu" precisa limpar selectedBotDifficulty');
  assert.ok(onBackToMenuBlock.includes('selectedMatchDuration = null'), '"Voltar ao Menu" precisa limpar selectedMatchDuration');
  assert.ok(onBackToMenuBlock.includes('isBotMode = false'), '"Voltar ao Menu" precisa limpar isBotMode');
  assert.ok(onBackToMenuBlock.includes('botMatch = null'), '"Voltar ao Menu" precisa limpar botMatch');
});

// =====================================================================
// FLUXO COMPLETO PONTA A PONTA: escolha -> partida -> fim -> revanche
// -> voltar ao menu, tudo em sequencia, com os modulos reais
// =====================================================================

test('fluxo completo: escolher EASY + "10M" -> partida comeca -> nao termina antes -> termina no limite -> Bot para -> resultado gerado -> revanche com os MESMOS parametros -> "voltar ao menu" (simulado) limpa tudo', () => {
  // 1-2: jogador escolhe dificuldade e duracao (estado local simulado,
  // mesmo padrao de selectedBotDifficulty/selectedMatchDuration).
  let selectedBotDifficulty = 'EASY';
  let selectedMatchDuration = '10M';

  // 3-5: partida comeca, duracao resolvida e associada.
  const partida1 = playOneBotMatch({
    difficulty: selectedBotDifficulty,
    durationId: selectedMatchDuration,
    startTimestamp: 9_000_000,
    seed: 15202,
  });
  assert.strictEqual(partida1.resolvedMatchDurationMs, 600000);
  assert.strictEqual(partida1.botMatch.durationMs, 600000);

  // Antes do limite: nao termina.
  assert.strictEqual(partida1.detector.checkForEnd(9_000_000 + 599_999), false);
  assert.strictEqual(partida1.getMatchEndCalls(), 0);

  // 6: no limite, termina normalmente.
  assert.strictEqual(partida1.detector.checkForEnd(9_000_000 + 600_000), true);
  assert.strictEqual(partida1.getMatchEndCalls(), 1);

  // 7: Bot para de ser processado.
  assert.strictEqual(BotMatchController.isFinished(partida1.botMatch), true);
  assert.deepStrictEqual(BotMatchController.tick(partida1.botMatch, 9_999_999), []);

  // 8: resultado existente funcionando.
  assert.ok(partida1.getBotResultAtEnd(), 'resultado do Bot deveria existir apos o fim');

  // 9: "Jogar Novamente" -- selectedBotDifficulty/selectedMatchDuration
  // permanecem intocados (nenhum handler os zera), entao a proxima
  // partida usa os MESMOS dois valores.
  const partida2 = playOneBotMatch({
    difficulty: selectedBotDifficulty,
    durationId: selectedMatchDuration,
    startTimestamp: 9_700_000,
    seed: 15202,
  });
  assert.strictEqual(partida2.resolvedMatchDurationMs, partida1.resolvedMatchDurationMs);
  assert.deepStrictEqual(partida2.botConfig, partida1.botConfig);

  // 10: "Voltar ao Menu" -- mesma limpeza ja feita pelo handler real
  // (ver teste estatico acima), simulada aqui sobre o estado local.
  selectedBotDifficulty = null;
  selectedMatchDuration = null;
  assert.strictEqual(selectedBotDifficulty, null);
  assert.strictEqual(selectedMatchDuration, null);
});

// =====================================================================
// NENHUM TIMER/RELOGIO NOVO (reforco final desta parte)
// =====================================================================

test('nenhum timer/relogio novo em nenhum modulo usado pelo fluxo do Bot (main.js, botMatchController.js, matchEndDetector.js, matchDuration.js)', () => {
  const filesToCheck = [
    mainJsPath,
    path.join(__dirname, '../client/js/match/botMatchController.js'),
    path.join(__dirname, '../client/js/match/matchEndDetector.js'),
    path.join(__dirname, '../client/js/match/matchDuration.js'),
  ];

  filesToCheck.forEach((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    ['setTimeout(', 'setInterval('].forEach((forbidden) => {
      assert.ok(!content.includes(forbidden), `${path.basename(filePath)} nao deveria conter "${forbidden}"`);
    });
  });

  // main.js e o UNICO lugar com requestAnimationFrame, e continua com
  // exatamente os mesmos 2 usos de sempre (loop de notas + loop de
  // MISS/duracao/Bot) -- nenhum terceiro loop foi criado para o Bot.
  const rafCount = (mainJsContent.match(/requestAnimationFrame\(/g) || []).length;
  assert.strictEqual(rafCount, 2, `esperava exatamente 2 requestAnimationFrame(, encontrou ${rafCount}`);

  // Um UNICO MatchEndDetector.createMatchEndDetector em todo main.js --
  // Solo e Bot compartilham a MESMA instancia, nenhum segundo detector
  // dedicado ao Bot foi criado.
  const detectorCreations = (mainJsContent.match(/MatchEndDetector\.createMatchEndDetector\(/g) || []).length;
  assert.strictEqual(detectorCreations, 1, 'deveria existir uma UNICA criacao de MatchEndDetector em main.js (compartilhada por Solo e Bot)');
});

// =====================================================================
// NENHUMA ALTERACAO EM SOLO / MULTIPLAYER / MODO TESTE
// =====================================================================

test('Solo continua funcionando de ponta a ponta com o MESMO MatchEndDetector (nenhuma mudanca nesta parte)', () => {
  const timeline = NoteEngine.generateNoteTimeline({
    seed: 15203,
    startTimestamp: 10_000_000,
    length: 5,
    noteRange: 3,
    noteIntervalMs: 600,
    leadInMs: 0,
  });
  const resolvedMatchDurationMs = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, '1M');
  let calls = 0;
  const detector = MatchEndDetector.createMatchEndDetector({
    timeline,
    onMatchEnd: () => calls++,
    durationMs: resolvedMatchDurationMs,
    startTime: 10_000_000,
  });

  assert.strictEqual(detector.checkForEnd(10_000_000 + 59_999), false);
  assert.strictEqual(detector.checkForEnd(10_000_000 + 60_000), true);
  assert.strictEqual(calls, 1);
});

test('Multiplayer real ("Criar sala"/"Entrar em sala") continua zerando selectedMatchDuration/selectedBotDifficulty e nunca chama BotMatchController', () => {
  const createRoomBlock = extractBlock(
    /document\.getElementById\('btn-create-room'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-create-room'
  );
  const joinRoomBlock = extractBlock(
    /document\.getElementById\('btn-join-room'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-join-room'
  );

  [createRoomBlock, joinRoomBlock].forEach((block) => {
    assert.ok(block.includes('selectedMatchDuration = null'));
    assert.ok(!block.includes('BotMatchController'));
    assert.ok(!block.includes('showMatchDurationSelection'));
    assert.ok(!block.includes('showBotDifficultySelection'));
  });
});

test('Modo Teste continua sem definir selectedMatchDuration/selectedBotDifficulty/isBotMode (permanece exatamente como antes)', () => {
  const testHandlerIdx = mainJsContent.indexOf("btn-send-test");
  assert.ok(testHandlerIdx !== -1, 'handler de Modo Teste nao encontrado');
  const testHandlerBody = mainJsContent.slice(testHandlerIdx, testHandlerIdx + 400);

  assert.ok(!testHandlerBody.includes('selectedMatchDuration ='));
  assert.ok(!testHandlerBody.includes('selectedBotDifficulty ='));
  assert.ok(!testHandlerBody.includes('isBotMode = true'));
});

console.log(`\n${passed} teste(s) passaram.`);
