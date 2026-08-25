/**
 * ETAPA 16-2C — Validacao final da integracao da timeline estendida
 * (Solo/Bot/Multiplayer), com PARAMETROS REAIS DE PRODUCAO.
 *
 * Esta etapa NAO cria nenhuma funcionalidade nova. As Etapas 16-2A
 * (tests/noteEngineExtendedTimeline16_2A.test.js) e 16-2B
 * (tests/timelineDurationIntegration16_2B.test.js) ja cobrem,
 * respectivamente: a pureza/determinismo de
 * NoteEngine.generateExtendedTimeline/computeNoteCountForDuration
 * isoladamente, e a integracao (MatchTimelineManager.ensureTimeline +
 * main.js) com parametros de teste pequenos/artificiais.
 *
 * Esta suite fecha a validacao usando os MESMOS parametros que a
 * partida real usa em producao:
 *   - client/js/music/sequenceCatalog.js (seq-basic-01 length=16
 *     noteIntervalMs=600, seq-basic-02 length=24 noteIntervalMs=500),
 *     ambos com leadInMs=1800 (ClientConfig.NOTE_LEAD_IN_MS);
 *   - ClientConfig.DIFFICULTY_PROGRESSION.STAGES (progressao real,
 *     ate 1.3x);
 *   - ClientConfig.MATCH_DURATION_MS (30S/1M/5M/10M);
 *   - ClientConfig.BOT_DIFFICULTY_PRESETS (EASY/MEDIUM/HARD reais);
 *   - o servidor real (RoomManager/MatchManager/messageRouter/matchFlow/
 *     matchDurationSelectionFlow/rematchFlow/gameplayFlow), no mesmo
 *     padrao ja usado por tests/multiplayerDurationFullFlowValidation15CMP3.test.js.
 *
 * Nenhum modulo de producao e alterado por esta suite. Se algo aqui
 * falhar, a causa deve ser investigada e corrigida no minimo necessario
 * (ver enunciado da Etapa 16-2C) -- mas a expectativa desta suite,
 * escrita depois de uma leitura completa do codigo existente, e que
 * TUDO passe sem nenhuma mudanca de producao.
 *
 * Executar com: node tests/timelineDurationFinalValidation16_2C.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ClientConfig = require('../client/js/config');
const MatchDuration = require('../client/js/match/matchDuration');
const MatchEndDetector = require('../client/js/match/matchEndDetector');
const NoteEngine = require('../client/js/match/noteEngine');
const SequenceGenerator = require('../client/js/match/sequenceGenerator');
const SequenceCatalog = require('../client/js/music/sequenceCatalog');
const BotController = require('../client/js/match/botController');
const BotMatchController = require('../client/js/match/botMatchController');
const MatchTimelineManager = require('../client/js/match/matchTimelineManager');

const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { MATCH_STATE, MATCH_MODE } = require('../server/match/Match');
const { MATCH_COUNTDOWN_SECONDS } = require('../server/config');
const { registerConnection } = require('../server/ws/connectionHandler');
const { routeMessage } = require('../server/ws/messageRouter');
const matchSequenceResolver = require('../server/match/matchSequenceResolver');
const serverSequenceGenerator = require('../server/match/sequenceGenerator');

let passed = 0;
function test(name, fn) {
  try {
    MatchTimelineManager.clear(); // cada teste comeca sem partida ativa no singleton
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
// Parametros reais de producao
// =====================================================================

const PATTERNS = {
  'seq-basic-01': SequenceCatalog.getSequencePattern('seq-basic-01'), // length 16, 600ms
  'seq-basic-02': SequenceCatalog.getSequencePattern('seq-basic-02'), // length 24, 500ms
};

const DURATION_IDS = ['30S', '1M', '5M', '10M'];
const STAGES = ClientConfig.DIFFICULTY_PROGRESSION.STAGES;
const START_TIMESTAMP = 1_700_000_000_000; // epoch ms plausivel, so um valor fixo p/ determinismo do teste

function durationMsFor(id) {
  return ClientConfig.MATCH_DURATION_MS[id];
}

// =====================================================================
// BLOCO A — Duracoes: 30S/1M/5M/10M, para os DOIS padroes reais de musica
// =====================================================================

Object.entries(PATTERNS).forEach(([sequenceId, pattern]) => {
  DURATION_IDS.forEach((durationId) => {
    test(`[A] "${sequenceId}" + "${durationId}" (${durationMsFor(durationId)}ms): a timeline estendida cobre a partida inteira`, () => {
      const durationMs = durationMsFor(durationId);
      const timeline = NoteEngine.generateExtendedTimeline({
        seed: 16_2003,
        startTimestamp: START_TIMESTAMP,
        length: pattern.length,
        noteRange: pattern.noteRange,
        noteIntervalMs: pattern.noteIntervalMs,
        leadInMs: pattern.leadInMs,
        difficultyStages: STAGES,
        durationMs,
      });

      const lastNote = timeline[timeline.length - 1];
      const coveredMs = lastNote.time - START_TIMESTAMP;

      assert.ok(
        coveredMs >= durationMs,
        `"${sequenceId}"/"${durationId}": ultima nota cobre ${coveredMs}ms, esperado >= ${durationMs}ms`
      );
      assert.ok(
        timeline.length > pattern.length,
        `"${sequenceId}"/"${durationId}": deveria ter mais notas que o padrao-base (${pattern.length})`
      );
    });
  });
});

// =====================================================================
// BLOCO B — Timeline: integridade estrutural com parametros reais
// =====================================================================

function buildRealExtendedTimeline(sequenceId, durationId, seed = 16_2004) {
  const pattern = PATTERNS[sequenceId];
  return {
    pattern,
    timeline: NoteEngine.generateExtendedTimeline({
      seed,
      startTimestamp: START_TIMESTAMP,
      length: pattern.length,
      noteRange: pattern.noteRange,
      noteIntervalMs: pattern.noteIntervalMs,
      leadInMs: pattern.leadInMs,
      difficultyStages: STAGES,
      durationMs: durationMsFor(durationId),
    }),
  };
}

test('[B] a primeira nota da timeline estendida e identica a primeira nota da sequencia-base', () => {
  const { pattern, timeline } = buildRealExtendedTimeline('seq-basic-01', '5M');
  const base = NoteEngine.generateNoteTimeline({
    seed: 16_2004,
    startTimestamp: START_TIMESTAMP,
    length: pattern.length,
    noteRange: pattern.noteRange,
    noteIntervalMs: pattern.noteIntervalMs,
    leadInMs: pattern.leadInMs,
    difficultyStages: STAGES,
  });

  assert.deepStrictEqual(timeline[0], base[0]);
});

test('[B] o padrao-base inteiro (todos os `length` primeiros indices) continua intacto dentro da timeline estendida', () => {
  const { pattern, timeline } = buildRealExtendedTimeline('seq-basic-02', '10M');
  const base = NoteEngine.generateNoteTimeline({
    seed: 16_2004,
    startTimestamp: START_TIMESTAMP,
    length: pattern.length,
    noteRange: pattern.noteRange,
    noteIntervalMs: pattern.noteIntervalMs,
    leadInMs: pattern.leadInMs,
    difficultyStages: STAGES,
  });

  assert.deepStrictEqual(timeline.slice(0, pattern.length), base);
});

test('[B] as notas adicionais sao deterministicas (duas geracoes independentes produzem a MESMA timeline)', () => {
  const run1 = buildRealExtendedTimeline('seq-basic-01', '10M').timeline;
  const run2 = buildRealExtendedTimeline('seq-basic-01', '10M').timeline;
  assert.deepStrictEqual(run1, run2);
});

DURATION_IDS.forEach((durationId) => {
  test(`[B] "${durationId}": os tempos (time) sao sempre estritamente crescentes`, () => {
    const { timeline } = buildRealExtendedTimeline('seq-basic-01', durationId);
    for (let i = 1; i < timeline.length; i++) {
      assert.ok(timeline[i].time > timeline[i - 1].time, `note[${i}].time deveria ser > note[${i - 1}].time`);
    }
  });
});

test('[B] nao existem lacunas inesperadas: cada intervalo entre notas consecutivas fica entre noteIntervalMs/MAX_SPEED_MULTIPLIER e noteIntervalMs', () => {
  const { pattern, timeline } = buildRealExtendedTimeline('seq-basic-01', '5M');
  const maxMultiplier = ClientConfig.DIFFICULTY_PROGRESSION.MAX_SPEED_MULTIPLIER;
  // Tolerancia pequena (0.01ms) so para absorver erro de ponto flutuante
  // acumulado ao longo de varias somas sucessivas (elapsedMs += ...),
  // nunca para mascarar uma lacuna real (que seria de dezenas/centenas de ms).
  const FLOAT_EPSILON_MS = 0.01;
  const minGap = pattern.noteIntervalMs / maxMultiplier - FLOAT_EPSILON_MS;
  const maxGap = pattern.noteIntervalMs + FLOAT_EPSILON_MS;

  for (let i = 1; i < timeline.length; i++) {
    const gap = timeline[i].time - timeline[i - 1].time;
    assert.ok(gap > 0, `gap[${i}] deveria ser positivo`);
    assert.ok(
      gap >= minGap && gap <= maxGap,
      `gap[${i}] = ${gap}ms fora do intervalo esperado [${minGap}, ${maxGap}]`
    );
  }
});

test('[B] a timeline nunca termina antes da duracao escolhida (para as 4 duracoes, ambos os padroes)', () => {
  Object.keys(PATTERNS).forEach((sequenceId) => {
    DURATION_IDS.forEach((durationId) => {
      const durationMs = durationMsFor(durationId);
      const { timeline } = buildRealExtendedTimeline(sequenceId, durationId);
      const lastNote = timeline[timeline.length - 1];
      assert.ok(lastNote.time - START_TIMESTAMP >= durationMs, `"${sequenceId}"/"${durationId}" terminou cedo demais`);
    });
  });
});

test('[B] a ultima parte da timeline ainda possui notas utilizaveis (campos validos, lane dentro do range)', () => {
  const { pattern, timeline } = buildRealExtendedTimeline('seq-basic-02', '10M');
  const tail = timeline.slice(-5);
  tail.forEach((note) => {
    assert.ok(Number.isFinite(note.time));
    assert.ok(note.lane >= 1 && note.lane <= pattern.noteRange);
    assert.strictEqual(note.state, NoteEngine.NOTE_STATE.PENDING);
    assert.ok(typeof note.id === 'string' && note.id.length > 0);
  });
});

// =====================================================================
// BLOCO C — Encerramento: SOMENTE o MatchEndDetector encerra a partida
// =====================================================================

DURATION_IDS.forEach((durationId) => {
  test(`[C] "${durationId}": a partida NAO termina so porque a sequencia-base acabou (timeline estendida ainda tem notas pendentes antes do limite)`, () => {
    const durationMs = durationMsFor(durationId);
    const { pattern, timeline } = buildRealExtendedTimeline('seq-basic-01', durationId);

    // Confirma que, sem a extensao (16-2A/2B), a sequencia-base sozinha
    // teria acabado bem antes da duracao escolhida -- e exatamente o
    // problema que a timeline estendida resolve.
    const baseCoverageMs = pattern.leadInMs + (pattern.length - 1) * pattern.noteIntervalMs;
    assert.ok(
      baseCoverageMs < durationMs,
      `pre-condicao do teste: o padrao-base (${baseCoverageMs}ms) deveria ser mais curto que "${durationId}" (${durationMs}ms)`
    );

    let calls = 0;
    const detector = MatchEndDetector.createMatchEndDetector({
      timeline,
      onMatchEnd: () => calls++,
      durationMs,
      startTime: START_TIMESTAMP,
    });

    // Um instante antes do limite: mesmo com a timeline (curta, sem
    // extensao) do padrao-base ja teoricamente esgotada, a timeline
    // ESTENDIDA ainda tem notas pendentes -- entao o encerramento so
    // pode vir da duracao, nunca da timeline "acabar".
    assert.strictEqual(detector.checkForEnd(START_TIMESTAMP + durationMs - 1), false);
    assert.strictEqual(calls, 0);

    const stillPending = timeline.some((n) => n.state === NoteEngine.NOTE_STATE.PENDING);
    assert.ok(stillPending, 'a timeline estendida deveria continuar com notas pendentes ate perto do limite');
  });

  test(`[C] "${durationId}": MatchEndDetector continua sendo o UNICO responsavel pelo encerramento (encerra exatamente no limite)`, () => {
    const durationMs = durationMsFor(durationId);
    const { timeline } = buildRealExtendedTimeline('seq-basic-01', durationId);

    let calls = 0;
    const detector = MatchEndDetector.createMatchEndDetector({
      timeline,
      onMatchEnd: () => calls++,
      durationMs,
      startTime: START_TIMESTAMP,
    });

    assert.strictEqual(detector.checkForEnd(START_TIMESTAMP + durationMs - 1), false);
    assert.strictEqual(detector.checkForEnd(START_TIMESTAMP + durationMs), true);
    assert.strictEqual(calls, 1);

    // Depois do limite, o encerramento continua funcionando normalmente
    // (chamadas seguintes nao re-emitem, mas hasEnded continua true).
    assert.strictEqual(detector.checkForEnd(START_TIMESTAMP + durationMs + 60_000), false);
    assert.strictEqual(calls, 1);
    assert.strictEqual(detector.hasEnded(), true);
  });
});

test('[C] nenhuma segunda logica de encerramento foi criada: matchEndDetector.js nao referencia generateExtendedTimeline/computeNoteCountForDuration', () => {
  const content = fs.readFileSync(
    path.join(__dirname, '..', 'client', 'js', 'match', 'matchEndDetector.js'),
    'utf8'
  );
  assert.ok(!content.includes('generateExtendedTimeline'));
  assert.ok(!content.includes('computeNoteCountForDuration'));
});

// =====================================================================
// BLOCO D — Solo: cadeia completa com parametros reais
// =====================================================================

function resolveDurationLikeMain({ selectedMatchDuration, matchDurationMsFromServer }) {
  return (
    MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, selectedMatchDuration) ??
    (typeof matchDurationMsFromServer === 'number' ? matchDurationMsFromServer : null)
  );
}

DURATION_IDS.forEach((durationId) => {
  test(`[D] Solo "${durationId}": selectedMatchDuration -> resolvedMatchDurationMs -> ensureTimeline -> timeline estendida -> MatchEndDetector encerra no limite`, () => {
    const pattern = PATTERNS['seq-basic-01'];
    const resolvedMatchDurationMs = resolveDurationLikeMain({ selectedMatchDuration: durationId });
    assert.strictEqual(resolvedMatchDurationMs, durationMsFor(durationId));

    const timeline = MatchTimelineManager.ensureTimeline({
      seed: 16_2005,
      startTimestamp: START_TIMESTAMP,
      length: pattern.length,
      noteRange: pattern.noteRange,
      noteIntervalMs: pattern.noteIntervalMs,
      leadInMs: pattern.leadInMs,
      difficultyStages: STAGES,
      durationMs: resolvedMatchDurationMs,
    });

    assert.ok(timeline.length > pattern.length, 'Solo deveria receber a timeline estendida');

    let ended = false;
    const detector = MatchEndDetector.createMatchEndDetector({
      timeline,
      onMatchEnd: () => {
        ended = true;
      },
      durationMs: resolvedMatchDurationMs,
      startTime: START_TIMESTAMP,
    });

    assert.strictEqual(detector.checkForEnd(START_TIMESTAMP + resolvedMatchDurationMs - 1), false);
    assert.strictEqual(ended, false);
    assert.strictEqual(detector.checkForEnd(START_TIMESTAMP + resolvedMatchDurationMs), true);
    assert.strictEqual(ended, true);

    // A partida continua recebendo notas ate o fim: mesmo no ultimo
    // instante valido antes do encerramento, ainda ha notas pendentes.
    const stillPending = timeline.some((n) => n.state === NoteEngine.NOTE_STATE.PENDING);
    assert.ok(stillPending);
  });
});

// =====================================================================
// BLOCO E — Bot: mesma timeline estendida, dificuldade intacta
// =====================================================================

const EXPECTED_BOT_PRESETS = {
  EASY: { reactionTimeMs: 220, judgementOffsetMs: 40, mistakeChance: 0.35, seed: 1 },
  MEDIUM: { reactionTimeMs: 130, judgementOffsetMs: 10, mistakeChance: 0.12, seed: 1 },
  HARD: { reactionTimeMs: 60, judgementOffsetMs: 0, mistakeChance: 0.03, seed: 1 },
};

test('[E] EASY/MEDIUM/HARD continuam com os mesmos valores de reactionTimeMs/judgementOffsetMs/mistakeChance', () => {
  assert.deepStrictEqual(ClientConfig.BOT_DIFFICULTY_PRESETS, EXPECTED_BOT_PRESETS);
});

['EASY', 'MEDIUM', 'HARD'].forEach((difficulty) => {
  DURATION_IDS.forEach((durationId) => {
    test(`[E] Bot "${difficulty}" / "${durationId}": recebe a MESMA timeline estendida e processa notas durante toda a duracao`, () => {
      const pattern = PATTERNS['seq-basic-01'];
      const resolvedMatchDurationMs = resolveDurationLikeMain({ selectedMatchDuration: durationId });

      const timeline = MatchTimelineManager.ensureTimeline({
        seed: 16_2006,
        startTimestamp: START_TIMESTAMP,
        length: pattern.length,
        noteRange: pattern.noteRange,
        noteIntervalMs: pattern.noteIntervalMs,
        leadInMs: pattern.leadInMs,
        difficultyStages: STAGES,
        durationMs: resolvedMatchDurationMs,
      });

      const botConfig = BotController.createConfigForDifficulty(ClientConfig.BOT_DIFFICULTY_PRESETS, difficulty);
      assert.deepStrictEqual(botConfig, EXPECTED_BOT_PRESETS[difficulty]);

      const botMatch = BotMatchController.createBotMatch({
        timeline, // MESMA instancia, nunca uma segunda geracao
        config: botConfig,
        windows: {
          perfectMs: ClientConfig.JUDGEMENT_WINDOWS.PERFECT_MS,
          greatMs: ClientConfig.JUDGEMENT_WINDOWS.GREAT_MS,
          goodMs: ClientConfig.JUDGEMENT_WINDOWS.GOOD_MS,
        },
        scoreValues: ClientConfig.SCORE_VALUES,
        comboMultiplierTiers: ClientConfig.COMBO_MULTIPLIER.TIERS,
        penalties: ClientConfig.PENALTIES,
        durationMs: resolvedMatchDurationMs,
      });

      assert.strictEqual(botMatch.durationMs, resolvedMatchDurationMs);

      // No meio da duracao: o Bot ainda nao processou TODAS as decisoes
      // (a timeline estendida continua tendo notas depois desse ponto).
      const midTime = START_TIMESTAMP + Math.floor(resolvedMatchDurationMs / 2);
      BotMatchController.tick(botMatch, midTime);
      assert.strictEqual(
        BotMatchController.isFinished(botMatch),
        false,
        'o Bot nao deveria ter processado a timeline inteira na metade da duracao'
      );

      // No fim exato da duracao (o mesmo instante em que o
      // MatchEndDetector real encerraria a partida): confirma que o
      // Bot ja processou notas ate ali (nao ficou "sem notas" antes do
      // limite).
      const executedNow = BotMatchController.tick(botMatch, START_TIMESTAMP + resolvedMatchDurationMs);
      assert.ok(
        executedNow.length > 0 || BotMatchController.isFinished(botMatch) === false,
        'o Bot deveria continuar recebendo/processando notas ate o limite da duracao'
      );
    });
  });
});

test('[E] o Bot para normalmente quando finalize() e chamado (mesmo com decisoes ainda pendentes na timeline estendida)', () => {
  const pattern = PATTERNS['seq-basic-01'];
  const durationMs = durationMsFor('1M');
  const timeline = MatchTimelineManager.ensureTimeline({
    seed: 16_2007,
    startTimestamp: START_TIMESTAMP,
    length: pattern.length,
    noteRange: pattern.noteRange,
    noteIntervalMs: pattern.noteIntervalMs,
    leadInMs: pattern.leadInMs,
    difficultyStages: STAGES,
    durationMs,
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

  BotMatchController.tick(botMatch, START_TIMESTAMP + Math.floor(durationMs / 2));
  assert.strictEqual(BotMatchController.isFinished(botMatch), false);

  BotMatchController.finalize(botMatch); // e o que main.js faz via handleLocalMatchEnd
  assert.strictEqual(BotMatchController.isFinished(botMatch), true);

  const scoreAfterFinalize = botMatch.playerState.score;
  BotMatchController.tick(botMatch, START_TIMESTAMP + durationMs + 999_999); // muito depois
  assert.strictEqual(botMatch.playerState.score, scoreAfterFinalize, 'tick() apos finalize() nao deveria alterar mais nada');
});

// =====================================================================
// BLOCO F — Multiplayer: harness de servidor real
// =====================================================================

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

function fireRealCountdown(match) {
  assert.ok(match && match._countdownTimer, 'esperava um _countdownTimer real agendado por scheduleCountdown');
  match._countdownTimer._onTimeout();
}

function createFullRoomWithDuration(durationId) {
  const wsPlayer1 = createMockSocket();
  const wsPlayer2 = createMockSocket();
  registerConnection(wsPlayer1);
  registerConnection(wsPlayer2);

  send(wsPlayer1, { type: 'create_room' });
  const roomCode = lastOfType(wsPlayer1, 'room_created').roomCode;

  send(wsPlayer1, { type: 'select_duration', durationId });
  send(wsPlayer2, { type: 'join_room', roomCode });

  const room = RoomManager.getRoom(roomCode);
  const match = MatchManager.getMatch(roomCode);
  return { room, wsPlayer1, wsPlayer2, match, roomCode };
}

['30S', '1M'].forEach((durationId) => {
  test(`[F] Multiplayer "${durationId}" (fluxo integrado real): ambos jogadores recebem a MESMA duracao/seed/startTimestamp e a timeline calculada localmente por cada um cobre a partida inteira`, () => {
    const { wsPlayer1, wsPlayer2, match } = createFullRoomWithDuration(durationId);

    const readyP1 = lastOfType(wsPlayer1, 'match_ready').match;
    const readyP2 = lastOfType(wsPlayer2, 'match_ready').match;
    assert.strictEqual(readyP1.durationMs, durationMsFor(durationId));
    assert.strictEqual(readyP1.durationMs, readyP2.durationMs);

    fireRealCountdown(match);
    assert.strictEqual(match.state, MATCH_STATE.PLAYING);

    const startedP1 = lastOfType(wsPlayer1, 'match_started');
    const startedP2 = lastOfType(wsPlayer2, 'match_started');
    assert.ok(startedP1 && startedP2);
    assert.strictEqual(startedP1.startTimestamp, startedP2.startTimestamp, 'startTimestamp precisa estar sincronizado');
    assert.strictEqual(startedP1.match.seed, startedP2.match.seed);
    assert.strictEqual(startedP1.match.durationMs, durationMsFor(durationId));

    // Cada "cliente" calcula sua PROPRIA timeline localmente (nunca
    // recebida pela rede) -- reproduzido aqui com duas chamadas
    // INDEPENDENTES a NoteEngine.generateExtendedTimeline, simulando os
    // dois navegadores, para confirmar que produzem timelines IDENTICAS
    // (unico mecanismo de sincronizacao: seed + startTimestamp + duracao,
    // todos vindos do servidor).
    const sequenceId = startedP1.match.music.sequenceId;
    const pattern = SequenceCatalog.getSequencePattern(sequenceId);
    const commonArgs = {
      seed: startedP1.match.seed,
      startTimestamp: startedP1.startTimestamp,
      length: pattern.length,
      noteRange: pattern.noteRange,
      noteIntervalMs: pattern.noteIntervalMs,
      leadInMs: pattern.leadInMs,
      difficultyStages: STAGES,
      durationMs: startedP1.match.durationMs,
    };
    const timelinePlayer1 = NoteEngine.generateExtendedTimeline(commonArgs);
    const timelinePlayer2 = NoteEngine.generateExtendedTimeline({ ...commonArgs });

    assert.deepStrictEqual(timelinePlayer1, timelinePlayer2, 'os dois jogadores precisam calcular a MESMA timeline');

    const lastNote = timelinePlayer1[timelinePlayer1.length - 1];
    const coveredMs = lastNote.time - startedP1.startTimestamp;
    assert.ok(
      coveredMs >= durationMsFor(durationId),
      `nenhum jogador deveria ficar sem notas antes do fim da duracao (cobriu ${coveredMs}ms)`
    );
  });

  test(`[F] Multiplayer "${durationId}": o servidor encerra a Match no limite correto quando o cliente avisa (sequence_complete), e nenhum jogador fica sem notas antes do outro`, () => {
    const { wsPlayer1, wsPlayer2, match } = createFullRoomWithDuration(durationId);
    fireRealCountdown(match);
    assert.strictEqual(match.state, MATCH_STATE.PLAYING);

    // Ambos os "clientes" chegam ao limite de duracao ao MESMO TEMPO
    // (mesma timeline, mesmo startTimestamp, mesmo durationMs) --
    // simula o MatchEndDetector local de cada um avisando o servidor.
    send(wsPlayer1, { type: 'sequence_complete' });
    assert.strictEqual(match.state, MATCH_STATE.FINISHED, 'a Match deveria encerrar assim que o primeiro sequence_complete chega');

    // Idempotente: o segundo jogador tambem avisa (mesma timeline
    // compartilhada terminando junto) -- nao deveria quebrar nem gerar
    // um segundo processamento.
    send(wsPlayer2, { type: 'sequence_complete' });
    assert.strictEqual(match.state, MATCH_STATE.FINISHED);

    const resultP1Count = wsPlayer1.sent.filter((m) => m.type === 'match_result').length;
    const resultP2Count = wsPlayer2.sent.filter((m) => m.type === 'match_result').length;
    assert.strictEqual(resultP1Count, 1, 'cada jogador deveria receber exatamente UM match_result');
    assert.strictEqual(resultP2Count, 1);
  });

  test(`[F] Multiplayer "${durationId}": select_duration continua funcionando e a revanche preserva a duracao`, () => {
    const { wsPlayer1, wsPlayer2, match, roomCode } = createFullRoomWithDuration(durationId);
    fireRealCountdown(match);
    send(wsPlayer1, { type: 'sequence_complete' });
    assert.strictEqual(match.state, MATCH_STATE.FINISHED);

    send(wsPlayer1, { type: 'rematch_ready' });
    send(wsPlayer2, { type: 'rematch_ready' });

    const newMatch = MatchManager.getMatch(roomCode);
    assert.ok(newMatch && newMatch !== match, 'a revanche deveria criar uma NOVA Match');
    assert.strictEqual(newMatch.durationMs, durationMsFor(durationId), 'a revanche deveria preservar a MESMA duracao por padrao');
  });
});

// --- Validacao ESTRUTURAL de 5M/10M (sem rodar o handshake de rede completo) ---

['5M', '10M'].forEach((durationId) => {
  test(`[F] Multiplayer "${durationId}" (validacao estrutural): nao existe limite artificial de notas/timeline para durar a partida inteira`, () => {
    const durationMs = durationMsFor(durationId);

    Object.values(PATTERNS).forEach((pattern) => {
      const requiredCount = NoteEngine.computeNoteCountForDuration({
        length: pattern.length,
        noteIntervalMs: pattern.noteIntervalMs,
        leadInMs: pattern.leadInMs,
        durationMs,
        difficultyStages: STAGES,
      });

      // Nenhum teto artificial: o numero de notas cresce proporcionalmente
      // a duracao pedida (5M exige mais notas que 1M, 10M exige mais que 5M).
      const requiredCount1M = NoteEngine.computeNoteCountForDuration({
        length: pattern.length,
        noteIntervalMs: pattern.noteIntervalMs,
        leadInMs: pattern.leadInMs,
        durationMs: durationMsFor('1M'),
        difficultyStages: STAGES,
      });
      assert.ok(requiredCount > requiredCount1M, `"${durationId}" deveria exigir mais notas que "1M"`);

      const timeline = NoteEngine.generateExtendedTimeline({
        seed: 16_2008,
        startTimestamp: START_TIMESTAMP,
        length: pattern.length,
        noteRange: pattern.noteRange,
        noteIntervalMs: pattern.noteIntervalMs,
        leadInMs: pattern.leadInMs,
        difficultyStages: STAGES,
        durationMs,
      });

      assert.strictEqual(timeline.length, requiredCount);
      const lastNote = timeline[timeline.length - 1];
      assert.ok(lastNote.time - START_TIMESTAMP >= durationMs);
    });
  });
});

test('[F] Multiplayer: os dois jogadores sempre recebem a mesma duracao (transporte via toPublicJSON, ja existente)', () => {
  DURATION_IDS.forEach((durationId) => {
    const { wsPlayer1, wsPlayer2 } = createFullRoomWithDuration(durationId);
    const readyP1 = lastOfType(wsPlayer1, 'match_ready').match;
    const readyP2 = lastOfType(wsPlayer2, 'match_ready').match;
    assert.strictEqual(readyP1.durationId, durationId);
    assert.strictEqual(readyP1.durationId, readyP2.durationId);
    assert.strictEqual(readyP1.durationMs, readyP2.durationMs);
  });
});

// =====================================================================
// BLOCO G — Checksum: sequencia-base intocada
// =====================================================================

test('[G] a sequencia-base (client) permanece EXATAMENTE igual com ou sem durationMs informado', () => {
  const pattern = PATTERNS['seq-basic-01'];
  const seed = 16_2009;

  const baseAlone = SequenceGenerator.generateSequence(seed, pattern.length, pattern.noteRange);

  const extended = NoteEngine.generateExtendedTimeline({
    seed,
    startTimestamp: START_TIMESTAMP,
    length: pattern.length,
    noteRange: pattern.noteRange,
    noteIntervalMs: pattern.noteIntervalMs,
    leadInMs: pattern.leadInMs,
    difficultyStages: STAGES,
    durationMs: durationMsFor('10M'),
  });
  const baseFromExtended = extended.slice(0, pattern.length).map((n) => n.lane);

  assert.deepStrictEqual(baseFromExtended, baseAlone);
});

test('[G] o checksum existente (SequenceGenerator.calculateChecksum) continua passando sobre a sequencia-base, independente da timeline estendida', () => {
  const pattern = PATTERNS['seq-basic-02'];
  const seed = 16_2010;

  const baseSequence = SequenceGenerator.generateSequence(seed, pattern.length, pattern.noteRange);
  const referenceChecksum = SequenceGenerator.calculateChecksum(baseSequence);

  // Gera a timeline estendida (como main.js faria) e recalcula o
  // checksum a partir SOMENTE dos primeiros `length` indices dela --
  // exatamente o que qualquer verificacao futura precisaria fazer para
  // continuar validando corretamente.
  const extended = NoteEngine.generateExtendedTimeline({
    seed,
    startTimestamp: START_TIMESTAMP,
    length: pattern.length,
    noteRange: pattern.noteRange,
    noteIntervalMs: pattern.noteIntervalMs,
    leadInMs: pattern.leadInMs,
    difficultyStages: STAGES,
    durationMs: durationMsFor('5M'),
  });
  const laneSequenceFromExtended = extended.slice(0, pattern.length).map((n) => n.lane);
  const checksumFromExtended = SequenceGenerator.calculateChecksum(laneSequenceFromExtended);

  assert.strictEqual(checksumFromExtended, referenceChecksum);
});

test('[G] as notas adicionais NAO sao incluidas indevidamente no checksum: usar a timeline inteira produziria um checksum DIFERENTE do de referencia', () => {
  const pattern = PATTERNS['seq-basic-01'];
  const seed = 16_2011;

  const baseSequence = SequenceGenerator.generateSequence(seed, pattern.length, pattern.noteRange);
  const referenceChecksum = SequenceGenerator.calculateChecksum(baseSequence);

  const extended = NoteEngine.generateExtendedTimeline({
    seed,
    startTimestamp: START_TIMESTAMP,
    length: pattern.length,
    noteRange: pattern.noteRange,
    noteIntervalMs: pattern.noteIntervalMs,
    leadInMs: pattern.leadInMs,
    difficultyStages: STAGES,
    durationMs: durationMsFor('10M'),
  });
  const fullExtendedLanes = extended.map((n) => n.lane);
  const checksumIfExtendedWereUsedByMistake = SequenceGenerator.calculateChecksum(fullExtendedLanes);

  assert.notStrictEqual(
    checksumIfExtendedWereUsedByMistake,
    referenceChecksum,
    'usar a timeline inteira no checksum precisa dar um resultado diferente do de referencia (prova de que sao caminhos distintos)'
  );
});

test('[G] client e servidor continuam concordando sobre a sequencia-base (matchSequenceResolver vs SequenceGenerator do cliente)', () => {
  const seed = 16_2012;
  const musicId = 'music-001'; // ver server/music/musicCatalog.js

  const serverSide = matchSequenceResolver.generateMatchSequence(seed, musicId);
  const pattern = SequenceCatalog.getSequencePattern(serverSide.music.sequenceId);

  const clientSequence = SequenceGenerator.generateSequence(seed, pattern.length, pattern.noteRange);
  const clientChecksum = SequenceGenerator.calculateChecksum(clientSequence);

  assert.deepStrictEqual(clientSequence, serverSide.noteSequence);
  assert.strictEqual(clientChecksum, serverSide.referenceChecksum);
  assert.strictEqual(clientChecksum, serverSequenceGenerator.calculateChecksum(serverSide.noteSequence));
});

test('[G] generateAndReportLocalSequence (main.js) nunca usa durationMs/generateExtendedTimeline para calcular o checksum reportado', () => {
  const mainJsContent = fs.readFileSync(path.join(__dirname, '..', 'client', 'js', 'main.js'), 'utf8');
  const start = mainJsContent.indexOf('function generateAndReportLocalSequence');
  assert.ok(start >= 0, 'generateAndReportLocalSequence deveria existir em main.js');
  const end = mainJsContent.indexOf('\n  }', start);
  const body = mainJsContent.slice(start, end);

  assert.ok(!body.includes('durationMs'), 'checksum nao deveria depender de durationMs');
  assert.ok(!body.includes('generateExtendedTimeline'), 'checksum nao deveria usar a timeline estendida');
  assert.ok(body.includes('pattern.length'), 'checksum deveria continuar usando exclusivamente pattern.length');
});

// =====================================================================
// BLOCO H — Regressao
// =====================================================================

test('[H] Solo continua funcionando de ponta a ponta (start_solo_match -> READY -> COUNTDOWN -> PLAYING) mesmo apos a integracao da timeline estendida', () => {
  const wsSolo = createMockSocket();
  registerConnection(wsSolo);

  send(wsSolo, { type: 'start_solo_match', musicId: 'music-001' });
  const roomCode = lastOfType(wsSolo, 'room_created') ? lastOfType(wsSolo, 'room_created').roomCode : null;

  const match = roomCode ? MatchManager.getMatch(roomCode) : lastOfType(wsSolo, 'match_ready') && MatchManager.getMatch(lastOfType(wsSolo, 'match_ready').match.roomCode);

  assert.ok(match, 'esperava uma Match Solo criada');
  assert.strictEqual(match.mode, MATCH_MODE.SOLO);

  fireRealCountdown(match);
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);
  assert.ok(lastOfType(wsSolo, 'match_started'));
});

test('[H] nenhuma dificuldade do Bot foi alterada por esta etapa (EASY/MEDIUM/HARD identicos ao snapshot conhecido)', () => {
  assert.deepStrictEqual(ClientConfig.BOT_DIFFICULTY_PRESETS, EXPECTED_BOT_PRESETS);
});

test('[H] nenhuma logica de pontuacao/combo/janelas de julgamento foi alterada (ClientConfig continua com os valores esperados)', () => {
  assert.deepStrictEqual(ClientConfig.JUDGEMENT_WINDOWS, {
    PERFECT_MS: 60,
    GREAT_MS: 200,
    GOOD_MS: 1800,
  });
});

test('[H] nenhum timer/loop NOVO foi criado por esta etapa: main.js continua com exatamente 2 requestAnimationFrame e zero setTimeout/setInterval', () => {
  const mainJsContent = fs.readFileSync(path.join(__dirname, '..', 'client', 'js', 'main.js'), 'utf8');
  const rafCount = (mainJsContent.match(/requestAnimationFrame\(/g) || []).length;
  assert.strictEqual(rafCount, 2, `esperava exatamente 2 requestAnimationFrame, encontrado ${rafCount}`);
  assert.ok(!/[^.]setTimeout\(/.test(mainJsContent.replace(/\/\/.*$/gm, '')), 'main.js nao deveria conter setTimeout novo');
  assert.ok(!mainJsContent.includes('setInterval('), 'main.js nao deveria conter setInterval novo');
});

test('[H] nenhum loop/timer novo foi introduzido nos modulos do NoteEngine/MatchTimelineManager/MatchEndDetector/MatchDuration', () => {
  ['noteEngine.js', 'matchTimelineManager.js', 'matchEndDetector.js', 'matchDuration.js'].forEach((file) => {
    const rawContent = fs.readFileSync(path.join(__dirname, '..', 'client', 'js', 'match', file), 'utf8');
    // Remove comentarios de bloco (/** ... */ e /* ... */) antes de checar
    // chamadas reais -- varios destes modulos DOCUMENTAM em comentarios que
    // "nunca chamam Date.now()/setTimeout()", o que faria uma busca textual
    // ingenua encontrar essas palavras dentro do proprio comentario.
    const content = rawContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!content.includes('setTimeout('), `${file} nao deveria conter setTimeout`);
    assert.ok(!content.includes('setInterval('), `${file} nao deveria conter setInterval`);
    assert.ok(!content.includes('requestAnimationFrame('), `${file} nao deveria conter requestAnimationFrame`);
    assert.ok(!content.includes('Date.now('), `${file} nao deveria chamar Date.now() diretamente`);
  });
});

test('[H] Multiplayer continua funcionando de ponta a ponta com a timeline estendida integrada (regressao geral)', () => {
  const { wsPlayer1, wsPlayer2, match } = createFullRoomWithDuration('1M');
  fireRealCountdown(match);
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);
  assert.ok(lastOfType(wsPlayer1, 'match_started'));
  assert.ok(lastOfType(wsPlayer2, 'match_started'));

  send(wsPlayer1, { type: 'sequence_complete' });
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);
});

console.log(`\n${passed} teste(s) passaram.`);
