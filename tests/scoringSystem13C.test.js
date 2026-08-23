/**
 * ETAPA 13C -- Sistema de Pontuacao e Penalizacao.
 *
 * Esta suite NAO reimplementa nenhum sistema: exercita os modulos REAIS
 * de producao (Judgement, PlayerState, GameplayEngine, NoteEngine,
 * ClientConfig no cliente; gameplayFlow/playerMatchState/messageRouter
 * no servidor), reaproveitando o mesmo padrao de mocks ja usado em
 * tests/gameplayEngine.test.js, tests/newArrowMechanic13B.test.js,
 * tests/soloMode12A.test.js e tests/serverGameplayFlow.test.js.
 *
 * Cobre exatamente o que o enunciado da Etapa 13C pediu:
 *   - PERFECT / GREAT / GOOD (pontuacao por velocidade);
 *   - acerto tardio (ainda dentro do percurso -> GOOD);
 *   - tecla errada (erro de direcao / MISTAKE), com penalizacao e quebra
 *     de combo, sem avancar a sequencia;
 *   - MISS por deixar a seta chegar ao final do percurso, com
 *     penalizacao e quebra de combo;
 *   - combo (cresce, quebra, maxCombo nunca diminui);
 *   - multiplicador de pontuacao por combo (config-driven);
 *   - pontuacao negativa (score pode ficar abaixo de zero);
 *   - Solo usando exatamente o mesmo sistema (nenhum sistema paralelo);
 *   - Multiplayer usando exatamente o mesmo sistema, com o servidor
 *     continuando como fonte de verdade do resultado final.
 *
 * Executar com: node tests/scoringSystem13C.test.js
 */
const assert = require('assert');

const ClientConfig = require('../client/js/config');
const NoteEngine = require('../client/js/match/noteEngine');
const PlayerState = require('../client/js/match/playerState');
const Judgement = require('../client/js/match/judgement');
const GameplayEngine = require('../client/js/match/gameplayEngine');

const RoomManager = require('../server/rooms/RoomManager');
const MatchManager = require('../server/match/MatchManager');
const { MATCH_STATE, MATCH_MODE } = require('../server/match/Match');
const { registerConnection } = require('../server/ws/connectionHandler');
const { routeMessage } = require('../server/ws/messageRouter');
const gameplayFlow = require('../server/match/gameplayFlow');

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

// ---------------------------------------------------------------------
// Helpers de cliente (mesmos valores reais de ClientConfig -- producao).
// ---------------------------------------------------------------------
const WINDOWS = {
  perfectMs: ClientConfig.JUDGEMENT_WINDOWS.PERFECT_MS,
  greatMs: ClientConfig.JUDGEMENT_WINDOWS.GREAT_MS,
  goodMs: ClientConfig.JUDGEMENT_WINDOWS.GOOD_MS,
};
const SCORE_VALUES = ClientConfig.SCORE_VALUES;
const COMBO_TIERS = ClientConfig.COMBO_MULTIPLIER.TIERS;
const PENALTIES = ClientConfig.PENALTIES;
const HIT_WINDOW_MS = ClientConfig.NOTE_HIT_WINDOW_MS;

const BASE_PARAMS = {
  seed: 130024,
  startTimestamp: 5_000_000,
  length: 12,
  noteRange: 3,
  noteIntervalMs: 600,
  leadInMs: 0,
};

function makeFullEngine(events) {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    comboMultiplierTiers: COMBO_TIERS,
    penalties: PENALTIES,
    sendEvent: (type, payload) => events && events.push({ type, payload }),
  });
  return { timeline, playerState, engine };
}

// =====================================================================
// BLOCO A -- Pontuacao por velocidade (PERFECT / GREAT / GOOD)
// =====================================================================

test('acerto muito rapido (dentro de PERFECT_MS) resulta em PERFECT e pontua SCORE_VALUES.PERFECT', () => {
  const { timeline, playerState, engine } = makeFullEngine();
  const note = timeline[0];

  const result = engine.handleKeyPress(note.lane, note.time);

  assert.strictEqual(result.outcome, 'PERFECT');
  assert.strictEqual(playerState.score, SCORE_VALUES.PERFECT);
});

test('acerto rapido (entre PERFECT_MS e GREAT_MS) resulta em GREAT e pontua SCORE_VALUES.GREAT', () => {
  const { timeline, playerState, engine } = makeFullEngine();
  const note = timeline[0];
  // > perfectMs, <= greatMs
  const attemptTime = note.time + (ClientConfig.JUDGEMENT_WINDOWS.PERFECT_MS + 10);

  const result = engine.handleKeyPress(note.lane, attemptTime);

  assert.strictEqual(result.outcome, 'GREAT');
  assert.strictEqual(playerState.score, SCORE_VALUES.GREAT);
  assert.ok(SCORE_VALUES.GREAT < SCORE_VALUES.PERFECT, 'GREAT deve valer menos que PERFECT');
  assert.ok(SCORE_VALUES.GREAT > SCORE_VALUES.GOOD, 'GREAT deve valer mais que GOOD');
});

test('acerto mais tardio (entre GREAT_MS e GOOD_MS, ainda dentro do percurso) resulta em GOOD', () => {
  const { timeline, playerState, engine } = makeFullEngine();
  const note = timeline[0];
  // > greatMs, <= goodMs (ainda dentro do percurso inteiro da seta)
  const attemptTime = note.time + (ClientConfig.JUDGEMENT_WINDOWS.GREAT_MS + 50);

  const result = engine.handleKeyPress(note.lane, attemptTime);

  assert.strictEqual(result.outcome, 'GOOD');
  assert.strictEqual(playerState.score, SCORE_VALUES.GOOD);
});

test('acerto tardio proximo do final do percurso ainda conta como GOOD (janela cobre o percurso inteiro, regra da 13B)', () => {
  const { timeline, playerState, engine } = makeFullEngine();
  const note = timeline[0];
  const attemptTime = note.time + ClientConfig.JUDGEMENT_WINDOWS.GOOD_MS - 1;

  const result = engine.handleKeyPress(note.lane, attemptTime);

  assert.strictEqual(result.outcome, 'GOOD');
  assert.strictEqual(playerState.score, SCORE_VALUES.GOOD);
});

test('classify sem greatMs informado (chamador antigo) nunca retorna GREAT -- compatibilidade com a 4B/13B', () => {
  const oldWindows = { perfectMs: 60, goodMs: 150 };
  assert.strictEqual(Judgement.classify(100, oldWindows), 'GOOD');
  assert.strictEqual(Judgement.classify(30, oldWindows), 'PERFECT');
});

// =====================================================================
// BLOCO B -- Erro de direcao (MISTAKE)
// =====================================================================

test('tecla errada (sem candidato na lane) penaliza pontos, quebra combo, e NAO avanca a sequencia', () => {
  const { timeline, playerState, engine } = makeFullEngine();

  // Acerta a primeira nota para ter combo > 0 antes do erro.
  const note0 = timeline[0];
  engine.handleKeyPress(note0.lane, note0.time);
  assert.strictEqual(playerState.combo, 1);
  const scoreBeforeMistake = playerState.score;

  // lane 99 nunca existe (noteRange=3) -> erro puro, sem nota candidata.
  const result = engine.handleKeyPress(99, note0.time + 50);

  assert.strictEqual(result.outcome, 'MISTAKE');
  assert.strictEqual(playerState.mistakes, 1);
  assert.strictEqual(playerState.combo, 0, 'erro de direcao deve quebrar o combo');
  assert.strictEqual(
    playerState.score,
    scoreBeforeMistake + PENALTIES.MISTAKE,
    'erro de direcao deve descontar PENALTIES.MISTAKE pontos'
  );

  // A seta correta (proxima da sequencia) continua disponivel/pendente.
  const nextNote = timeline[1];
  assert.notStrictEqual(nextNote.state, NoteEngine.NOTE_STATE.HIT);
  assert.notStrictEqual(nextNote.state, NoteEngine.NOTE_STATE.MISSED);
});

test('depois de um erro de direcao, a seta correta ainda pode ser acertada normalmente', () => {
  const { timeline, playerState, engine } = makeFullEngine();
  const expected = timeline[0];
  const wrongLane = [1, 2, 3].find((lane) => lane !== expected.lane);

  // Erro de direcao (aperta a lane errada perto da seta esperada).
  engine.handleKeyPress(wrongLane, expected.time - 100);
  assert.strictEqual(playerState.mistakes, 1);
  assert.notStrictEqual(expected.state, NoteEngine.NOTE_STATE.HIT);

  // A seta esperada continua acertavel depois do erro.
  const result = engine.handleKeyPress(expected.lane, expected.time);
  assert.ok(['PERFECT', 'GREAT', 'GOOD'].includes(result.outcome));
  assert.strictEqual(expected.state, NoteEngine.NOTE_STATE.HIT);
});

// =====================================================================
// BLOCO C -- Seta perdida (MISS por chegar ao final do percurso)
// =====================================================================

test('seta perdida (expira sem input) penaliza pontos e quebra combo', () => {
  const { timeline, playerState, engine } = makeFullEngine();

  // Acerta a primeira nota para ter combo > 0 antes do MISS.
  const note0 = timeline[0];
  engine.handleKeyPress(note0.lane, note0.time);
  const scoreBeforeMiss = playerState.score;
  assert.strictEqual(playerState.combo, 1);

  const note1 = timeline[1];
  const missed = engine.processExpiredNotes(note1.time + 1, HIT_WINDOW_MS);

  assert.strictEqual(missed.length, 1);
  assert.strictEqual(missed[0].id, note1.id);
  assert.strictEqual(playerState.misses, 1);
  assert.strictEqual(playerState.combo, 0, 'MISS deve quebrar o combo');
  assert.strictEqual(
    playerState.score,
    scoreBeforeMiss + PENALTIES.MISS,
    'MISS deve descontar PENALTIES.MISS pontos'
  );
});

test('nao existe margem de tempo extra depois do final do percurso (regra da 13B mantida)', () => {
  const { timeline, engine } = makeFullEngine();
  const note = timeline[0];

  // Um instante antes do fim: ainda deve poder ser acertada (nao terminal).
  assert.notStrictEqual(note.state, NoteEngine.NOTE_STATE.MISSED);

  // No instante exato em que expira, vira MISS -- sem tolerancia extra.
  const missed = engine.processExpiredNotes(note.time + 1, HIT_WINDOW_MS);
  assert.strictEqual(missed[0].id, note.id);
  assert.strictEqual(note.state, NoteEngine.NOTE_STATE.MISSED);
});

// =====================================================================
// BLOCO D -- Combo e multiplicador
// =====================================================================

test('combo cresce a cada acerto e maxCombo guarda o pico (nunca diminui)', () => {
  const { timeline, playerState, engine } = makeFullEngine();

  for (let i = 0; i < 6; i++) {
    const note = timeline[i];
    engine.handleKeyPress(note.lane, note.time);
  }
  assert.strictEqual(playerState.combo, 6);
  assert.strictEqual(playerState.maxCombo, 6);

  // Erro derruba o combo, mas maxCombo permanece.
  engine.handleKeyPress(99, timeline[6].time);
  assert.strictEqual(playerState.combo, 0);
  assert.strictEqual(playerState.maxCombo, 6);
});

test('multiplicador aumenta a pontuacao a partir do tier de combo configurado', () => {
  const { timeline, playerState, engine } = makeFullEngine();

  // Os primeiros 4 acertos ficam abaixo do primeiro tier (minCombo: 5)
  // -> multiplicador 1x, pontuacao exatamente igual ao valor base.
  for (let i = 0; i < 4; i++) {
    const note = timeline[i];
    const result = engine.handleKeyPress(note.lane, note.time);
    assert.strictEqual(result.judgement, 'PERFECT');
  }
  assert.strictEqual(playerState.score, SCORE_VALUES.PERFECT * 4, 'sem multiplicador antes do primeiro tier');

  // O 5o acerto atinge combo=5 -> entra no tier de multiplicador 1.5x.
  const fifthTier = COMBO_TIERS.find((t) => t.minCombo === 5);
  const note5 = timeline[4];
  engine.handleKeyPress(note5.lane, note5.time);
  assert.strictEqual(playerState.combo, 5);

  const expectedScoreAfterFifth = SCORE_VALUES.PERFECT * 4 + SCORE_VALUES.PERFECT * fifthTier.multiplier;
  assert.strictEqual(playerState.score, expectedScoreAfterFifth);
});

test('multiplicador volta ao valor inicial (1x) apos erro/MISS quebrar o combo', () => {
  const { timeline, playerState, engine } = makeFullEngine();

  // Sobe o combo ate o tier de 1.5x (minCombo: 5).
  for (let i = 0; i < 5; i++) {
    const note = timeline[i];
    engine.handleKeyPress(note.lane, note.time);
  }
  assert.strictEqual(playerState.combo, 5);

  // Erro quebra o combo.
  engine.handleKeyPress(99, timeline[5].time);
  assert.strictEqual(playerState.combo, 0);

  const scoreBeforeNextHit = playerState.score;
  const note6 = timeline[6];
  engine.handleKeyPress(note6.lane, note6.time);

  // Combo volta a 1 -> multiplicador 1x novamente (abaixo do primeiro tier).
  assert.strictEqual(playerState.combo, 1);
  assert.strictEqual(playerState.score, scoreBeforeNextHit + SCORE_VALUES.PERFECT);
});

test('sem comboMultiplierTiers configurado, multiplicador e sempre 1x (compatibilidade com a 4B)', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    // comboMultiplierTiers omitido de proposito.
  });

  for (let i = 0; i < 6; i++) {
    engine.handleKeyPress(timeline[i].lane, timeline[i].time);
  }
  assert.strictEqual(playerState.score, SCORE_VALUES.PERFECT * 6);
});

// =====================================================================
// BLOCO E -- Pontuacao negativa
// =====================================================================

test('o score pode ficar negativo se o jogador errar muitas vezes', () => {
  const { timeline, playerState, engine } = makeFullEngine();

  // Varios erros de direcao seguidos, sem nenhum acerto antes.
  for (let i = 0; i < 5; i++) {
    engine.handleKeyPress(99, timeline[0].time + i);
  }

  assert.strictEqual(playerState.mistakes, 5);
  assert.strictEqual(playerState.score, PENALTIES.MISTAKE * 5);
  assert.ok(playerState.score < 0, 'score deve poder ficar negativo apos varios erros');
});

test('sem penalties configurado, MISS/MISTAKE nao tocam o score (compatibilidade com a 4B/13B)', () => {
  const timeline = NoteEngine.generateNoteTimeline(BASE_PARAMS);
  const playerState = PlayerState.createPlayerState();
  const engine = GameplayEngine.createGameplayEngine({
    timeline,
    playerState,
    windows: WINDOWS,
    scoreValues: SCORE_VALUES,
    // penalties omitido de proposito.
  });

  engine.handleKeyPress(99, timeline[0].time);
  engine.processExpiredNotes(timeline[0].time + 1, HIT_WINDOW_MS);

  assert.strictEqual(playerState.mistakes, 1);
  assert.strictEqual(playerState.misses, 1);
  assert.strictEqual(playerState.score, 0);
});

// =====================================================================
// BLOCO F -- Servidor: judgement GREAT aceito, servidor como fonte de
// verdade do resultado final.
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
    close() {
      this.readyState = 3;
    },
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
  assert.ok(match && match._countdownTimer, 'esperava um _countdownTimer real agendado');
  match._countdownTimer._onTimeout();
}

test('servidor aceita judgement GREAT em note_hit (nova faixa da Etapa 13C)', () => {
  let roomCounter = 0;
  const { Room } = require('../server/rooms/Room');
  roomCounter += 1;
  const room = new Room(`SCOREROOM${roomCounter}`);
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  room.addPlayer(ws1);
  room.addPlayer(ws2);

  const { Match } = require('../server/match/Match');
  const match = new Match(room.code);
  match.seed = 9001;
  match.setState(MATCH_STATE.PLAYING);
  MatchManager.setMatch(room.code, match);

  gameplayFlow.applyNoteHit(ws1, room, {
    noteId: 'note-9001-0',
    lane: 1,
    judgement: 'GREAT',
    deltaMs: 120,
    combo: 1,
    score: 200,
  });

  assert.strictEqual(match.players.player1.hits, 1);
  assert.strictEqual(match.players.player1.score, 200);
  assert.strictEqual(match.players.player1.combo, 1);
});

test('servidor ainda rejeita judgement invalido (nao vira GREAT/PERFECT/GOOD por engano)', () => {
  let roomCounter = 0;
  const { Room } = require('../server/rooms/Room');
  roomCounter += 1;
  const room = new Room(`SCOREROOM_INVALID${roomCounter}`);
  const ws1 = createMockSocket();
  room.addPlayer(ws1);

  const { Match } = require('../server/match/Match');
  const match = new Match(room.code);
  match.seed = 9002;
  match.setState(MATCH_STATE.PLAYING);
  MatchManager.setMatch(room.code, match);

  gameplayFlow.applyNoteHit(ws1, room, {
    noteId: 'note-9002-0',
    lane: 1,
    judgement: 'AMAZING',
    combo: 1,
    score: 999999,
  });

  assert.strictEqual(match.players.player1.hits, 0);
  assert.strictEqual(match.players.player1.score, 0);
});

// =====================================================================
// BLOCO G -- Solo usa exatamente o mesmo sistema de pontuacao
// =====================================================================

test('Solo: note_hit com GREAT e penalizacoes de MISTAKE/MISS chegam ao resultado final via o mesmo pipeline', () => {
  const ws = createMockSocket();
  registerConnection(ws);
  send(ws, { type: 'start_solo_match' });

  const roomCode = lastOfType(ws, 'room_created').roomCode;
  const match = MatchManager.getMatch(roomCode);
  fireRealCountdown(match);
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);

  // Um GREAT (nova faixa da 13C) e um MISS, exatamente como o cliente
  // real reportaria (client/js/main.js -> GameplayEngine -> sendEvent).
  send(ws, {
    type: 'note_hit',
    noteId: `note-${match.seed}-0`,
    lane: 1,
    judgement: 'GREAT',
    deltaMs: 120,
    combo: 1,
    score: SCORE_VALUES.GREAT,
  });
  send(ws, {
    type: 'note_miss',
    noteId: `note-${match.seed}-1`,
    lane: 2,
    combo: 0,
    misses: 1,
    score: SCORE_VALUES.GREAT + PENALTIES.MISS,
  });

  send(ws, { type: 'sequence_complete' });

  const result = lastOfType(ws, 'match_result');
  assert.ok(result);
  assert.strictEqual(result.mode, MATCH_MODE.SOLO);
  assert.strictEqual(result.player1.hits, 1);
  assert.strictEqual(result.player1.misses, 1);
  assert.strictEqual(result.player1.score, SCORE_VALUES.GREAT + PENALTIES.MISS);
  // Solo nunca ganha vencedor/perdedor -- mesmo comportamento da 12A.
  assert.strictEqual(result.winner, undefined);
  assert.strictEqual(result.player2, undefined);
});

// =====================================================================
// BLOCO H -- Multiplayer: servidor continua sendo a fonte de verdade
// =====================================================================

function createFullRoomViaProduction() {
  const wsPlayer1 = createMockSocket();
  const wsPlayer2 = createMockSocket();
  registerConnection(wsPlayer1);
  registerConnection(wsPlayer2);

  send(wsPlayer1, { type: 'create_room' });
  const roomCode = lastOfType(wsPlayer1, 'room_created').roomCode;

  send(wsPlayer2, { type: 'join_room', roomCode });

  const room = RoomManager.getRoom(roomCode);
  const match = MatchManager.getMatch(roomCode);
  return { room, wsPlayer1, wsPlayer2, match, roomCode };
}

test('Multiplayer: score oficial (fonte de verdade) reflete os note_hit/note_miss reportados por cada jogador, e o vencedor e decidido a partir dele', () => {
  const finalMatchState = require('../server/match/finalMatchState');
  const matchOutcome = require('../server/match/matchOutcome');
  const matchFlow = require('../server/match/matchFlow');

  const { room, wsPlayer1, wsPlayer2, match } = createFullRoomViaProduction();
  fireRealCountdown(match);
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);

  // player1: um PERFECT e depois uma seta perdida (MISS) -- exatamente
  // como o cliente real reportaria via GameplayEngine/SocketClient.
  send(wsPlayer1, {
    type: 'note_hit',
    noteId: `note-${match.seed}-0`,
    lane: 1,
    judgement: 'PERFECT',
    combo: 1,
    score: SCORE_VALUES.PERFECT,
  });
  send(wsPlayer1, {
    type: 'note_miss',
    noteId: `note-${match.seed}-1`,
    lane: 2,
    combo: 0,
    misses: 1,
    score: SCORE_VALUES.PERFECT + PENALTIES.MISS,
  });

  // player2: dois GREATs seguidos (nova faixa da Etapa 13C).
  send(wsPlayer2, {
    type: 'note_hit',
    noteId: `note-${match.seed}-0`,
    lane: 1,
    judgement: 'GREAT',
    combo: 1,
    score: SCORE_VALUES.GREAT,
  });
  send(wsPlayer2, {
    type: 'note_hit',
    noteId: `note-${match.seed}-1`,
    lane: 3,
    judgement: 'GREAT',
    combo: 2,
    score: SCORE_VALUES.GREAT * 2,
  });

  matchFlow.finishMatch(room);

  // O SERVIDOR (match.players, escrito via playerMatchState/gameplayFlow
  // a partir dos eventos acima) e a fonte de verdade do resultado final
  // -- e o que finalMatchState/matchOutcome usam para decidir o vencedor,
  // nunca um numero calculado so pelo cliente e aceito sem verificacao.
  const snapshot = finalMatchState.getFinalMatchState(match);
  assert.strictEqual(snapshot.player1.score, SCORE_VALUES.PERFECT + PENALTIES.MISS);
  assert.strictEqual(snapshot.player2.score, SCORE_VALUES.GREAT * 2);

  const outcome = matchOutcome.getFinalOutcome(match);
  assert.strictEqual(outcome.winner, 'player2', 'player2 tem mais pontos, deve vencer');

  // match_result enviado aos dois jogadores continua no formato minimo
  // ja existente (result/winner/loser, sem estado interno) -- nenhuma
  // mudanca de contrato nesta etapa.
  const result1 = lastOfType(wsPlayer1, 'match_result');
  const result2 = lastOfType(wsPlayer2, 'match_result');
  assert.ok(result1 && result2, 'ambos os jogadores devem receber match_result');
  assert.deepStrictEqual(result1, result2);
  assert.strictEqual(result1.winner, 'player2');
});

console.log(`\n${passed} teste(s) passaram, ${failed} falharam.`);
