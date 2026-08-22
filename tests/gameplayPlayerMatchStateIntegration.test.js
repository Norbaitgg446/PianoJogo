/**
 * Testes automatizados da INTEGRACAO entre gameplayFlow.js e
 * playerMatchState.js (Etapa 7B): confirma que existe UMA UNICA fonte
 * de escrita do estado oficial (playerMatchState.updatePlayerMatchState),
 * que gameplayFlow so decide os valores e delega a escrita, e que tudo
 * continua compativel com finalMatchState (6B) e matchOutcome (6C).
 *
 * Nao testa vencedor/empate/ranking/etc alem do minimo necessario para
 * confirmar compatibilidade -- a suite completa disso continua em
 * tests/matchOutcome.test.js e tests/matchResultBroadcast.test.js.
 *
 * Executar com: node tests/gameplayPlayerMatchStateIntegration.test.js
 */
const assert = require('assert');
const fs = require('fs');
const { Room } = require('../server/rooms/Room');
const { Match, MATCH_STATE } = require('../server/match/Match');
const MatchManager = require('../server/match/MatchManager');
const gameplayFlow = require('../server/match/gameplayFlow');
const playerMatchState = require('../server/match/playerMatchState');
const finalMatchState = require('../server/match/finalMatchState');
const matchOutcome = require('../server/match/matchOutcome');

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
  const room = new Room(`GPI-ROOM${roomCounter}`);
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

const ZERO_STATE = { score: 0, combo: 0, maxCombo: 0, hits: 0, misses: 0, mistakes: 0 };

// 1. note_hit atualiza score oficial -------------------------------------------
test('note_hit atualiza o score oficial em match.players', () => {
  const { room, ws1, match } = setupRoomWithMatch(1);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-1-0', judgement: 'PERFECT', combo: 1, score: 300 });

  assert.strictEqual(match.players.player1.score, 300);
  assert.strictEqual(playerMatchState.getPlayerMatchState(match, 'player1').score, 300);
});

// 2. note_hit incrementa hits ---------------------------------------------------
test('note_hit incrementa hits oficiais', () => {
  const { room, ws1, match } = setupRoomWithMatch(2);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-2-0', judgement: 'GOOD', combo: 1, score: 100 });
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-2-1', judgement: 'GOOD', combo: 2, score: 200 });

  assert.strictEqual(match.players.player1.hits, 2);
});

// 3. note_hit incrementa combo ---------------------------------------------------
test('note_hit atualiza o combo oficial conforme reportado', () => {
  const { room, ws1, match } = setupRoomWithMatch(3);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-3-0', judgement: 'PERFECT', combo: 4, score: 400 });

  assert.strictEqual(match.players.player1.combo, 4);
});

// 4. maxCombo e atualizado --------------------------------------------------------
test('maxCombo sobe junto com o combo e nunca diminui', () => {
  const { room, ws1, match } = setupRoomWithMatch(4);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-4-0', judgement: 'PERFECT', combo: 8, score: 800 });
  assert.strictEqual(match.players.player1.maxCombo, 8);

  gameplayFlow.applyNoteMiss(ws1, room, { noteId: 'note-4-1', combo: 0, misses: 1 });
  assert.strictEqual(match.players.player1.combo, 0);
  assert.strictEqual(match.players.player1.maxCombo, 8, 'maxCombo nao pode diminuir apos um miss');
});

// 5. note_miss incrementa misses --------------------------------------------------
test('note_miss incrementa misses oficiais', () => {
  const { room, ws2, match } = setupRoomWithMatch(5);
  gameplayFlow.applyNoteMiss(ws2, room, { noteId: 'note-5-0', combo: 0, misses: 1 });
  gameplayFlow.applyNoteMiss(ws2, room, { noteId: 'note-5-1', combo: 0, misses: 2 });

  assert.strictEqual(match.players.player2.misses, 2);
});

// 6. note_miss reseta combo --------------------------------------------------------
test('note_miss zera o combo oficial do jogador', () => {
  const { room, ws1, match } = setupRoomWithMatch(6);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-6-0', judgement: 'PERFECT', combo: 5, score: 500 });
  gameplayFlow.applyNoteMiss(ws1, room, { noteId: 'note-6-1', combo: 0, misses: 1 });

  assert.strictEqual(match.players.player1.combo, 0);
});

// 7. score segue a regra ja existente (nao recalculada por outra formula) ------------
test('score de note_hit usa exatamente o valor reportado pelo cliente (regra da Etapa 4B)', () => {
  const { room, ws1, match } = setupRoomWithMatch(7);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-7-0', judgement: 'GOOD', combo: 1, score: 123 });
  assert.strictEqual(match.players.player1.score, 123);

  // Sem "score" no payload, o servidor preserva o score atual (nao zera nem recalcula).
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-7-1', judgement: 'GOOD' });
  assert.strictEqual(match.players.player1.score, 123);
});

// 8. player1 permanece isolado -----------------------------------------------------
test('eventos de player1 nunca alteram o estado oficial de player2', () => {
  const { room, ws1, match } = setupRoomWithMatch(8);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-8-0', judgement: 'PERFECT', combo: 3, score: 300 });
  gameplayFlow.applyNoteMiss(ws1, room, { noteId: 'note-8-1', combo: 0, misses: 1 });

  assert.deepStrictEqual(playerMatchState.getPlayerMatchState(match, 'player2'), ZERO_STATE);
});

// 9. player2 permanece isolado -----------------------------------------------------
test('eventos de player2 nunca alteram o estado oficial de player1', () => {
  const { room, ws2, match } = setupRoomWithMatch(9);
  gameplayFlow.applyNoteHit(ws2, room, { noteId: 'note-9-0', judgement: 'PERFECT', combo: 3, score: 300 });
  gameplayFlow.applyNoteMiss(ws2, room, { noteId: 'note-9-1', combo: 0, misses: 1 });

  assert.deepStrictEqual(playerMatchState.getPlayerMatchState(match, 'player1'), ZERO_STATE);
});

// 10. multiplos hits acumulam corretamente ------------------------------------------
test('multiplos note_hit de um jogador acumulam hits corretamente', () => {
  const { room, ws1, match } = setupRoomWithMatch(10);
  for (let i = 0; i < 5; i += 1) {
    gameplayFlow.applyNoteHit(ws1, room, { noteId: `note-10-${i}`, judgement: 'GOOD', combo: i + 1, score: (i + 1) * 100 });
  }
  assert.strictEqual(match.players.player1.hits, 5);
  assert.strictEqual(match.players.player1.score, 500);
  assert.strictEqual(match.players.player1.maxCombo, 5);
});

// 11. multiplos misses acumulam corretamente ------------------------------------------
test('multiplos note_miss de um jogador acumulam misses corretamente', () => {
  const { room, ws2, match } = setupRoomWithMatch(11);
  for (let i = 0; i < 4; i += 1) {
    gameplayFlow.applyNoteMiss(ws2, room, { noteId: `note-11-${i}`, combo: 0, misses: i + 1 });
  }
  assert.strictEqual(match.players.player2.misses, 4);
});

// 12. sequencia intercalada mantem estados independentes -------------------------------
test('sequencia intercalada de player1/player2 mantem estados oficiais independentes', () => {
  const { room, ws1, ws2, match } = setupRoomWithMatch(12);

  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-12-0', judgement: 'PERFECT', combo: 1, score: 300 });
  gameplayFlow.applyNoteHit(ws2, room, { noteId: 'note-12-0', judgement: 'GOOD', combo: 1, score: 100 });
  gameplayFlow.applyNoteMiss(ws1, room, { noteId: 'note-12-1', combo: 0, misses: 1 });
  gameplayFlow.applyNoteHit(ws2, room, { noteId: 'note-12-1', judgement: 'PERFECT', combo: 2, score: 400 });

  assert.strictEqual(match.players.player1.hits, 1);
  assert.strictEqual(match.players.player1.misses, 1);
  assert.strictEqual(match.players.player1.score, 300);

  assert.strictEqual(match.players.player2.hits, 2);
  assert.strictEqual(match.players.player2.misses, 0);
  assert.strictEqual(match.players.player2.score, 400);
  assert.strictEqual(match.players.player2.maxCombo, 2);
});

// 13. nova Match comeca zerada --------------------------------------------------------
test('uma nova Match comeca com o estado oficial zerado para os dois jogadores', () => {
  const match = new Match('GPI-FRESH');
  assert.deepStrictEqual(playerMatchState.getPlayerMatchState(match, 'player1'), ZERO_STATE);
  assert.deepStrictEqual(playerMatchState.getPlayerMatchState(match, 'player2'), ZERO_STATE);
});

// 14. revanche (nova Match) nao herda estado anterior -----------------------------------
test('uma nova Match criada apos outra ja pontuada nao herda nada dela (cenario de revanche)', () => {
  const { room, ws1, match: oldMatch } = setupRoomWithMatch(14);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-14-0', judgement: 'PERFECT', combo: 9, score: 900 });
  assert.strictEqual(oldMatch.players.player1.score, 900);

  // Mesmo fluxo real usado pelo matchFlow/rematchFlow: nova instancia de Match.
  const newMatch = new Match(room.code);
  MatchManager.setMatch(room.code, newMatch);

  assert.deepStrictEqual(playerMatchState.getPlayerMatchState(newMatch, 'player1'), ZERO_STATE);
  // A instancia antiga continua com seus proprios valores (nao afetada pela nova).
  assert.strictEqual(oldMatch.players.player1.score, 900);
});

// 15. finishMatch/finalMatchState capturam os valores oficiais atuais -------------------
test('finalMatchState.captureFinalMatchState le os valores oficiais atualizados pelo gameplay', () => {
  const { room, ws1, ws2, match } = setupRoomWithMatch(15);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-15-0', judgement: 'PERFECT', combo: 3, score: 300 });
  gameplayFlow.applyNoteHit(ws2, room, { noteId: 'note-15-0', judgement: 'GOOD', combo: 1, score: 100 });
  gameplayFlow.applyNoteMiss(ws2, room, { noteId: 'note-15-1', combo: 0, misses: 1 });

  match.setState(MATCH_STATE.FINISHED);
  const snapshot = finalMatchState.captureFinalMatchState(match);

  assert.strictEqual(snapshot.player1.score, 300);
  assert.strictEqual(snapshot.player1.combo, 3);
  assert.strictEqual(snapshot.player2.score, 100);
  assert.strictEqual(snapshot.player2.misses, 1);
});

// 16. matchOutcome continua funcionando com esses valores --------------------------------
test('matchOutcome.determineOutcome funciona normalmente com o estado atualizado pelo gameplay', () => {
  const { room, ws1, ws2, match } = setupRoomWithMatch(16);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-16-0', judgement: 'PERFECT', combo: 1, score: 500 });
  gameplayFlow.applyNoteHit(ws2, room, { noteId: 'note-16-0', judgement: 'GOOD', combo: 1, score: 200 });

  match.setState(MATCH_STATE.FINISHED);
  const snapshot = finalMatchState.captureFinalMatchState(match);
  const outcome = matchOutcome.determineOutcome(snapshot);

  assert.strictEqual(outcome.winner, 'player1');
  assert.strictEqual(outcome.loser, 'player2');
});

// 17. nenhum estado e atualizado fora de PLAYING (regra ja existente) --------------------
test('note_hit/note_miss fora de PLAYING nao alteram o estado oficial', () => {
  const { room, ws1, match } = setupRoomWithMatch(17);
  match.setState(MATCH_STATE.READY);

  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-17-0', judgement: 'PERFECT', combo: 1, score: 999 });
  gameplayFlow.applyNoteMiss(ws1, room, { noteId: 'note-17-1', combo: 0, misses: 1 });

  assert.deepStrictEqual(playerMatchState.getPlayerMatchState(match, 'player1'), ZERO_STATE);
});

// 18. payload invalido continua sendo rejeitado --------------------------------------------
test('judgement invalido continua sendo rejeitado sem alterar o estado oficial', () => {
  const { room, ws1, ws2, match } = setupRoomWithMatch(18);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-18-0', judgement: 'AMAZING', combo: 1, score: 999 });

  assert.strictEqual(match.players.player1.hits, 0);
  assert.strictEqual(match.players.player1.score, 0);
  assert.strictEqual(ws2.sent.length, 0);
  assert.strictEqual(ws1.sent[0].type, 'error');
});

// 19. nenhuma atualizacao duplicada acontece -----------------------------------------------
test('um unico note_hit resulta em exatamente um incremento de hits (sem duplicacao)', () => {
  const { room, ws1, match } = setupRoomWithMatch(19);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-19-0', judgement: 'GOOD', combo: 1, score: 100 });

  assert.strictEqual(match.players.player1.hits, 1, 'hits deveria ter sido incrementado uma unica vez');
});

// 20. messageRouter.js continua apenas roteando --------------------------------------------
test('messageRouter.js nao contem logica de atualizacao de score/combo/hits/misses', () => {
  const source = fs.readFileSync(`${__dirname}/../server/ws/messageRouter.js`, 'utf8');

  // O roteador so deve chamar os fluxos existentes, nunca escrever
  // diretamente em match.players ou usar operadores de incremento
  // sobre score/combo/hits/misses/mistakes.
  assert.ok(!/match\.players/.test(source), 'messageRouter.js nao deveria acessar match.players diretamente');
  assert.ok(!/\.(score|combo|maxCombo|hits|misses|mistakes)\s*(\+=|=[^=])/.test(source),
    'messageRouter.js nao deveria atribuir/incrementar campos de estado oficial diretamente');
  assert.ok(source.includes('gameplayFlow.applyNoteHit'), 'messageRouter.js deveria delegar note_hit para gameplayFlow');
  assert.ok(source.includes('gameplayFlow.applyNoteMiss'), 'messageRouter.js deveria delegar note_miss para gameplayFlow');
});

console.log(`\n${passed} teste(s) passaram.`);
