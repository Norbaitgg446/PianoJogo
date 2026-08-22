/**
 * Testes automatizados do fluxo de gameplay no SERVIDOR (Etapa 4B):
 * comunicacao entre os dois jogadores via note_hit/note_miss, isolamento
 * de estado entre jogadores da mesma sala, e validacao basica.
 *
 * Usa mocks simples de conexao WebSocket (nao sobe um servidor real) e os
 * modulos reais de Room/Match/MatchManager/gameplayFlow.
 *
 * Executar com: node tests/serverGameplayFlow.test.js
 */
const assert = require('assert');
const { Room } = require('../server/rooms/Room');
const { Match, MATCH_STATE } = require('../server/match/Match');
const MatchManager = require('../server/match/MatchManager');
const gameplayFlow = require('../server/match/gameplayFlow');

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

function createMockSocket() {
  return {
    OPEN: 1,
    readyState: 1,
    sent: [],
    send(raw) {
      this.sent.push(JSON.parse(raw));
    },
  };
}

let roomCounter = 0;
function setupRoomWithMatch(seed = 123) {
  roomCounter += 1;
  const room = new Room(`ROOM${roomCounter}`);
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  room.addPlayer(ws1); // player1
  room.addPlayer(ws2); // player2

  const match = new Match(room.code);
  match.seed = seed;
  match.setState(MATCH_STATE.PLAYING);
  MatchManager.setMatch(room.code, match);

  return { room, ws1, ws2, match };
}

// 1. note_hit e retransmitido para o oponente (comunicacao entre os dois jogadores)
test('note_hit de player1 atualiza o estado dele e avisa player2 (nao player1)', () => {
  const { room, ws1, ws2, match } = setupRoomWithMatch(555);

  gameplayFlow.applyNoteHit(ws1, room, {
    noteId: 'note-555-0',
    lane: 1,
    judgement: 'PERFECT',
    deltaMs: 5,
    combo: 1,
    score: 300,
  });

  assert.strictEqual(match.players.player1.hits, 1);
  assert.strictEqual(match.players.player1.score, 300);
  assert.strictEqual(match.players.player1.combo, 1);
  assert.strictEqual(match.players.player1.maxCombo, 1);

  // Estado do adversario (player2) nao foi tocado.
  assert.strictEqual(match.players.player2.hits, 0);
  assert.strictEqual(match.players.player2.score, 0);

  // player1 nao recebe eco da propria acao; player2 recebe o evento leve.
  assert.strictEqual(ws1.sent.length, 0);
  assert.strictEqual(ws2.sent.length, 1);
  assert.deepStrictEqual(ws2.sent[0], {
    type: 'opponent_note_event',
    slot: 'player1',
    event: 'note_hit',
    judgement: 'PERFECT',
    combo: 1,
    score: 300,
  });
});

// 2. note_miss tambem e retransmitido, no sentido contrario ------------------
test('note_miss de player2 atualiza o estado dele e avisa player1', () => {
  const { room, ws1, ws2, match } = setupRoomWithMatch(777);

  gameplayFlow.applyNoteMiss(ws2, room, {
    noteId: 'note-777-3',
    lane: 2,
    combo: 0,
    misses: 1,
  });

  assert.strictEqual(match.players.player2.misses, 1);
  assert.strictEqual(match.players.player2.combo, 0);
  assert.strictEqual(match.players.player1.misses, 0, 'estado de player1 nao pode ser alterado');

  assert.strictEqual(ws2.sent.length, 0);
  assert.strictEqual(ws1.sent.length, 1);
  assert.deepStrictEqual(ws1.sent[0], {
    type: 'opponent_note_event',
    slot: 'player2',
    event: 'note_miss',
    combo: 0,
    misses: 1,
  });
});

// 3. Comunicacao completa: varias acoes intercaladas dos dois jogadores -----
test('sequencia de eventos dos dois jogadores mantem os estados corretos e isolados', () => {
  const { room, ws1, ws2, match } = setupRoomWithMatch(999);

  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-999-0', judgement: 'PERFECT', combo: 1, score: 300 });
  gameplayFlow.applyNoteHit(ws2, room, { noteId: 'note-999-0', judgement: 'GOOD', combo: 1, score: 100 });
  gameplayFlow.applyNoteMiss(ws1, room, { noteId: 'note-999-1', combo: 0, misses: 1 });
  gameplayFlow.applyNoteHit(ws2, room, { noteId: 'note-999-1', judgement: 'PERFECT', combo: 2, score: 400 });

  assert.strictEqual(match.players.player1.hits, 1);
  assert.strictEqual(match.players.player1.misses, 1);
  assert.strictEqual(match.players.player1.score, 300);

  assert.strictEqual(match.players.player2.hits, 2);
  assert.strictEqual(match.players.player2.misses, 0);
  assert.strictEqual(match.players.player2.score, 400);
  assert.strictEqual(match.players.player2.maxCombo, 2);

  // player1 recebeu os dois eventos de player2; player2 recebeu os dois de player1.
  assert.strictEqual(ws1.sent.length, 2);
  assert.strictEqual(ws2.sent.length, 2);
});

// 4. Validacao basica: judgement invalido e rejeitado -------------------------
test('note_hit com judgement invalido e rejeitado com erro, sem alterar estado', () => {
  const { room, ws1, ws2, match } = setupRoomWithMatch(111);

  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-111-0', judgement: 'AMAZING', combo: 1, score: 999 });

  assert.strictEqual(match.players.player1.hits, 0, 'nao deveria ter aplicado o hit invalido');
  assert.strictEqual(ws2.sent.length, 0, 'oponente nao deveria ter recebido nada');
  assert.strictEqual(ws1.sent.length, 1);
  assert.strictEqual(ws1.sent[0].type, 'error');
});

// 5. Sem partida em andamento: evento e rejeitado -----------------------------
test('note_hit fora de uma partida em PLAYING e rejeitado', () => {
  const { room, ws1, ws2, match } = setupRoomWithMatch(222);
  match.setState(MATCH_STATE.READY); // partida ainda nao comecou

  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-222-0', judgement: 'PERFECT', combo: 1, score: 300 });

  assert.strictEqual(match.players.player1.hits, 0);
  assert.strictEqual(ws2.sent.length, 0);
  assert.strictEqual(ws1.sent.length, 1);
  assert.strictEqual(ws1.sent[0].type, 'error');
});

// 6. noteId de outra seed/partida: apenas gera warning, nao quebra -----------
test('noteId com prefixo de seed errada nao derruba o fluxo (apenas plausibilidade fraca)', () => {
  const { room, ws1, ws2, match } = setupRoomWithMatch(333);

  assert.strictEqual(gameplayFlow.isPlausibleNoteId(match, 'note-333-0'), true);
  assert.strictEqual(gameplayFlow.isPlausibleNoteId(match, 'note-999999-0'), false);

  // Mesmo com noteId implausivel, a Etapa 4B ainda nao bloqueia (sem anti-cheat completo).
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-999999-0', judgement: 'GOOD', combo: 1, score: 100 });
  assert.strictEqual(match.players.player1.hits, 1);
  assert.strictEqual(ws2.sent.length, 1);
});

console.log(`\n${passed} teste(s) passaram.`);
