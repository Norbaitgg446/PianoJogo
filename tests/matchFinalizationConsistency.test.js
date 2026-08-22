/**
 * Testes automatizados de FECHAMENTO E CONSISTENCIA do estado final
 * (Etapa 7C): confirma que o encerramento da partida (matchFlow.finishMatch)
 * usa EXCLUSIVAMENTE o estado oficial mantido pelo servidor
 * (Match.players, atualizado via playerMatchState.updatePlayerMatchState
 * na Etapa 7B), que o snapshot final (finalMatchState, Etapa 6B) e
 * imutavel e fiel a esse estado, que matchOutcome (Etapa 6C) so decide a
 * partir desse mesmo snapshot, e que nada disso vaza entre partidas
 * (revanche) nem pode ser influenciado pelo cliente apos o encerramento.
 *
 * Nao recalcula vencedor/empate com regras novas -- so verifica que a
 * cadeia PLAYING -> gameplay -> FINISHED -> snapshot -> outcome usa uma
 * UNICA fonte de verdade em cada etapa.
 *
 * Executar com: node tests/matchFinalizationConsistency.test.js
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
const matchFlow = require('../server/match/matchFlow');

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
  const room = new Room(`MFC-ROOM${roomCounter}`);
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

// 1. finishMatch captura o estado oficial ------------------------------------------
test('finishMatch captura o estado oficial da Match (nao inventa outro)', () => {
  const { room, ws1, match } = setupRoomWithMatch(1);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-1-0', judgement: 'PERFECT', combo: 2, score: 200 });

  const snapshot = matchFlow.finishMatch(room);

  assert.ok(snapshot, 'finishMatch deveria devolver um snapshot');
  assert.strictEqual(snapshot.player1.score, match.players.player1.score);
  assert.strictEqual(snapshot.player1.hits, match.players.player1.hits);
});

// 2. snapshot contem player1 ---------------------------------------------------------
test('snapshot final contem player1', () => {
  const { room } = setupRoomWithMatch(2);
  const snapshot = matchFlow.finishMatch(room);
  assert.ok(snapshot.player1, 'snapshot deveria conter player1');
});

// 3. snapshot contem player2 ---------------------------------------------------------
test('snapshot final contem player2', () => {
  const { room } = setupRoomWithMatch(3);
  const snapshot = matchFlow.finishMatch(room);
  assert.ok(snapshot.player2, 'snapshot deveria conter player2');
});

// 4. snapshot contem score correto ----------------------------------------------------
test('snapshot final contem o score oficial correto', () => {
  const { room, ws1 } = setupRoomWithMatch(4);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-4-0', judgement: 'PERFECT', combo: 1, score: 777 });

  const snapshot = matchFlow.finishMatch(room);
  assert.strictEqual(snapshot.player1.score, 777);
});

// 5. snapshot contem combo correto -----------------------------------------------------
test('snapshot final contem o combo oficial correto', () => {
  const { room, ws1 } = setupRoomWithMatch(5);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-5-0', judgement: 'PERFECT', combo: 6, score: 600 });

  const snapshot = matchFlow.finishMatch(room);
  assert.strictEqual(snapshot.player1.combo, 6);
});

// 6. snapshot contem maxCombo correto ---------------------------------------------------
test('snapshot final contem o maxCombo oficial correto', () => {
  const { room, ws1 } = setupRoomWithMatch(6);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-6-0', judgement: 'PERFECT', combo: 9, score: 900 });
  gameplayFlow.applyNoteMiss(ws1, room, { noteId: 'note-6-1', combo: 0, misses: 1 });

  const snapshot = matchFlow.finishMatch(room);
  assert.strictEqual(snapshot.player1.maxCombo, 9);
});

// 7. snapshot contem hits correto -------------------------------------------------------
test('snapshot final contem hits oficiais corretos', () => {
  const { room, ws1 } = setupRoomWithMatch(7);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-7-0', judgement: 'GOOD', combo: 1, score: 100 });
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-7-1', judgement: 'GOOD', combo: 2, score: 200 });

  const snapshot = matchFlow.finishMatch(room);
  assert.strictEqual(snapshot.player1.hits, 2);
});

// 8. snapshot contem misses correto ------------------------------------------------------
test('snapshot final contem misses oficiais corretos', () => {
  const { room, ws2 } = setupRoomWithMatch(8);
  gameplayFlow.applyNoteMiss(ws2, room, { noteId: 'note-8-0', combo: 0, misses: 1 });
  gameplayFlow.applyNoteMiss(ws2, room, { noteId: 'note-8-1', combo: 0, misses: 2 });

  const snapshot = matchFlow.finishMatch(room);
  assert.strictEqual(snapshot.player2.misses, 2);
});

// 9. snapshot contem mistakes correto ------------------------------------------------------
test('snapshot final contem mistakes oficiais corretos', () => {
  const { room, match } = setupRoomWithMatch(9);
  // O protocolo de gameplay atual nao envia "mistake" separadamente
  // (ver Etapa 7B) -- o campo e escrito atraves da mesma unica camada
  // de escrita oficial (playerMatchState), simulando uma origem futura
  // sem inventar um novo protocolo aqui.
  playerMatchState.updatePlayerMatchState(match, 'player2', { mistakes: 3 });

  const snapshot = matchFlow.finishMatch(room);
  assert.strictEqual(snapshot.player2.mistakes, 3);
});

// 10. snapshot nao pode ser alterado externamente -----------------------------------------
test('snapshot final e imutavel (Object.freeze), mutacao nao tem efeito', () => {
  const { room, ws1 } = setupRoomWithMatch(10);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-10-0', judgement: 'PERFECT', combo: 1, score: 500 });

  const snapshot = matchFlow.finishMatch(room);
  assert.ok(Object.isFrozen(snapshot), 'snapshot agrupador deveria estar congelado');
  assert.ok(Object.isFrozen(snapshot.player1), 'snapshot.player1 deveria estar congelado');
  assert.ok(Object.isFrozen(snapshot.player2), 'snapshot.player2 deveria estar congelado');

  snapshot.player1.score = 999999;
  assert.strictEqual(snapshot.player1.score, 500, 'mutacao no snapshot congelado nao deveria ter efeito');
});

// 11. alterar Match depois do snapshot nao altera o snapshot ------------------------------
test('alterar match.players depois do snapshot capturado nao afeta o snapshot ja guardado', () => {
  const { room, match } = setupRoomWithMatch(11);
  const snapshot = matchFlow.finishMatch(room);
  const scoreAntes = snapshot.player1.score;

  // Mesmo que algo (indevidamente) tente mexer em match.players depois
  // do encerramento, o snapshot ja capturado nao muda.
  match.players.player1.score = 123456;

  const snapshotDepois = finalMatchState.getFinalMatchState(match);
  assert.strictEqual(snapshotDepois.player1.score, scoreAntes);
  assert.notStrictEqual(snapshotDepois.player1.score, 123456);
});

// 12. alterar o snapshot nao altera a Match -----------------------------------------------
test('mutar o snapshot devolvido nao afeta match.players (protecao ja existente, reaproveitada)', () => {
  const { room, match, ws1 } = setupRoomWithMatch(12);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-12-0', judgement: 'PERFECT', combo: 1, score: 321 });
  const snapshot = matchFlow.finishMatch(room);

  snapshot.player1.score = 0;

  assert.strictEqual(match.players.player1.score, 321);
});

// 13. matchOutcome utiliza os valores do snapshot -------------------------------------------
test('matchOutcome.determineOutcome usa exatamente os valores do snapshot final', () => {
  const { room, ws1, ws2, match } = setupRoomWithMatch(13);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-13-0', judgement: 'PERFECT', combo: 1, score: 800 });
  gameplayFlow.applyNoteHit(ws2, room, { noteId: 'note-13-0', judgement: 'GOOD', combo: 1, score: 300 });

  matchFlow.finishMatch(room);
  const snapshot = finalMatchState.getFinalMatchState(match);
  const outcome = matchOutcome.getFinalOutcome(match);

  assert.strictEqual(outcome.winner, 'player1');
  assert.ok(snapshot.player1.score > snapshot.player2.score);
});

// 14. resultado final corresponde ao estado oficial -------------------------------------
test('resultado final (match_result enviado) corresponde ao estado oficial acumulado', () => {
  const { room, ws1, ws2 } = setupRoomWithMatch(14);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-14-0', judgement: 'PERFECT', combo: 1, score: 100 });
  gameplayFlow.applyNoteHit(ws2, room, { noteId: 'note-14-0', judgement: 'PERFECT', combo: 1, score: 900 });

  matchFlow.finishMatch(room);

  const messageToWs1 = ws1.sent.find((m) => m.type === 'match_result');
  assert.ok(messageToWs1, 'player1 deveria ter recebido match_result');
  assert.strictEqual(messageToWs1.winner, 'player2');
  assert.strictEqual(messageToWs1.result, 'player2_win');
});

// 15. finishMatch nao captura duas vezes a mesma partida --------------------------------
test('finishMatch chamado duas vezes nao recaptura nem gera um segundo match_result', () => {
  const { room, ws1, ws2 } = setupRoomWithMatch(15);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-15-0', judgement: 'PERFECT', combo: 1, score: 500 });

  const firstSnapshot = matchFlow.finishMatch(room);
  const secondSnapshot = matchFlow.finishMatch(room);

  assert.deepStrictEqual(firstSnapshot, secondSnapshot);
  const resultMessagesWs1 = ws1.sent.filter((m) => m.type === 'match_result');
  const resultMessagesWs2 = ws2.sent.filter((m) => m.type === 'match_result');
  assert.strictEqual(resultMessagesWs1.length, 1, 'match_result deveria ter sido enviado apenas uma vez');
  assert.strictEqual(resultMessagesWs2.length, 1, 'match_result deveria ter sido enviado apenas uma vez');
});

// 16. finishMatch mantem o contrato de retorno existente ----------------------------------
test('finishMatch continua devolvendo {player1, player2} (mesmo contrato da Etapa 6B)', () => {
  const { room } = setupRoomWithMatch(16);
  const snapshot = matchFlow.finishMatch(room);

  assert.deepStrictEqual(Object.keys(snapshot).sort(), ['player1', 'player2']);

  const roomSemMatch = new Room('MFC-NOMATCH');
  assert.strictEqual(matchFlow.finishMatch(roomSemMatch), null, 'sem match, deveria devolver null como antes');
});

// 17. gameplay nao altera estado depois de FINISHED --------------------------------------
test('note_hit/note_miss apos FINISHED nao alteram o estado oficial nem o snapshot', () => {
  const { room, ws1, ws2, match } = setupRoomWithMatch(17);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-17-0', judgement: 'PERFECT', combo: 1, score: 111 });

  matchFlow.finishMatch(room);
  assert.strictEqual(match.state, MATCH_STATE.FINISHED);

  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-17-1', judgement: 'PERFECT', combo: 99, score: 999999 });
  gameplayFlow.applyNoteMiss(ws2, room, { noteId: 'note-17-2', combo: 0, misses: 50 });

  assert.strictEqual(match.players.player1.score, 111, 'score nao deveria mudar apos FINISHED');
  assert.strictEqual(match.players.player2.misses, 0, 'misses nao deveria mudar apos FINISHED');

  const snapshot = finalMatchState.getFinalMatchState(match);
  assert.strictEqual(snapshot.player1.score, 111, 'snapshot final tambem nao deveria mudar');

  assert.strictEqual(ws1.sent[ws1.sent.length - 1].type, 'error', 'evento de gameplay apos FINISHED deveria ser rejeitado');
});

// 18. nova Match comeca com estado zerado -------------------------------------------------
test('uma nova Match (revanche) comeca com o estado oficial totalmente zerado', () => {
  const match = new Match('MFC-FRESH');
  assert.deepStrictEqual(playerMatchState.getPlayerMatchState(match, 'player1'), ZERO_STATE);
  assert.deepStrictEqual(playerMatchState.getPlayerMatchState(match, 'player2'), ZERO_STATE);
});

// 19. nova Match nao reutiliza snapshot anterior -------------------------------------------
test('uma nova Match nunca tem snapshot final herdado de uma partida anterior', () => {
  const { room, ws1 } = setupRoomWithMatch(19);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-19-0', judgement: 'PERFECT', combo: 1, score: 400 });
  matchFlow.finishMatch(room);

  // Revanche real: nova instancia de Match na mesma sala (mesmo padrao
  // usado por matchFlow.startMatchFlow/rematchFlow, nenhum alterado aqui).
  const newMatch = new Match(room.code);
  MatchManager.setMatch(room.code, newMatch);

  assert.strictEqual(finalMatchState.getFinalMatchState(newMatch), null);
  assert.strictEqual(finalMatchState.hasFinalMatchState(newMatch), false);
});

// 20. nova Match nao reutiliza outcome anterior --------------------------------------------
test('uma nova Match nunca tem outcome herdado de uma partida anterior', () => {
  const { room, ws1, ws2 } = setupRoomWithMatch(20);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-20-0', judgement: 'PERFECT', combo: 1, score: 700 });
  gameplayFlow.applyNoteHit(ws2, room, { noteId: 'note-20-0', judgement: 'GOOD', combo: 1, score: 200 });
  matchFlow.finishMatch(room);

  const newMatch = new Match(room.code);
  MatchManager.setMatch(room.code, newMatch);

  assert.strictEqual(matchOutcome.getFinalOutcome(newMatch), null);
  assert.strictEqual(matchOutcome.hasFinalOutcome(newMatch), false);
});

// 21. revanche continua funcionando (fluxo completo old -> new independente) ----------------
test('revanche: partida antiga mantem seu resultado, nova partida comeca isolada e funcional', () => {
  const { room, ws1, ws2, match: oldMatch } = setupRoomWithMatch(21);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-21-0', judgement: 'PERFECT', combo: 1, score: 1000 });
  matchFlow.finishMatch(room);
  const oldOutcome = matchOutcome.getFinalOutcome(oldMatch);
  assert.ok(oldOutcome);

  const newMatch = new Match(room.code);
  newMatch.seed = 21000;
  newMatch.setState(MATCH_STATE.PLAYING);
  MatchManager.setMatch(room.code, newMatch);

  gameplayFlow.applyNoteHit(ws2, room, { noteId: 'note-21000-0', judgement: 'GOOD', combo: 1, score: 250 });
  const newSnapshot = matchFlow.finishMatch(room);

  assert.strictEqual(newSnapshot.player2.score, 250);
  assert.strictEqual(newSnapshot.player1.score, 0);
  // O outcome antigo continua intacto, associado apenas a instancia antiga.
  assert.strictEqual(matchOutcome.getFinalOutcome(oldMatch), oldOutcome);
});

// 22. player1 e player2 continuam isolados durante a finalizacao ---------------------------
test('finalizacao isola completamente player1 e player2', () => {
  const { room, ws1 } = setupRoomWithMatch(22);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-22-0', judgement: 'PERFECT', combo: 5, score: 500 });

  const snapshot = matchFlow.finishMatch(room);
  assert.strictEqual(snapshot.player1.score, 500);
  assert.deepStrictEqual(snapshot.player2, ZERO_STATE);
});

// 23. estado oficial nao depende do cliente -------------------------------------------------
test('depois de FINISHED, nenhum valor reportado pelo cliente consegue influenciar o resultado', () => {
  const { room, ws1, ws2 } = setupRoomWithMatch(23);
  gameplayFlow.applyNoteHit(ws1, room, { noteId: 'note-23-0', judgement: 'PERFECT', combo: 1, score: 50 });
  gameplayFlow.applyNoteHit(ws2, room, { noteId: 'note-23-0', judgement: 'GOOD', combo: 1, score: 10 });

  matchFlow.finishMatch(room);
  const outcomeAntes = matchOutcome.getFinalOutcome(MatchManager.getMatch(room.code));

  // Cliente (player2) tenta "trapacear" depois do fim, reportando um
  // score absurdo -- deve ser rejeitado (partida nao esta mais PLAYING),
  // e o outcome ja calculado nunca muda.
  gameplayFlow.applyNoteHit(ws2, room, { noteId: 'note-23-1', judgement: 'PERFECT', combo: 999, score: 999999 });

  const outcomeDepois = matchOutcome.getFinalOutcome(MatchManager.getMatch(room.code));
  assert.deepStrictEqual(outcomeDepois, outcomeAntes);
  assert.strictEqual(outcomeDepois.winner, 'player1');
});

// 24. nenhum segundo sistema de snapshot foi criado -------------------------------------------
test('nao existe um segundo modulo de snapshot final alem de finalMatchState', () => {
  // playerMatchState e gameplayFlow (Etapas 7A/7B) nao devem exportar
  // nenhuma funcao de captura/snapshot final de partida.
  const forbidden = ['capturefinalmatchstate', 'getfinalmatchstate', 'hasfinalmatchstate', 'finalsnapshot'];

  [playerMatchState, gameplayFlow].forEach((mod) => {
    Object.keys(mod).forEach((name) => {
      const lower = name.toLowerCase();
      forbidden.forEach((keyword) => {
        assert.ok(!lower.includes(keyword), `export inesperado "${name}" pareceria um segundo snapshot final`);
      });
    });
  });
});

// 25. nenhuma segunda logica de vencedor foi criada ---------------------------------------------
test('nao existe uma segunda logica de vencedor/empate fora de matchOutcome', () => {
  const forbidden = ['winner', 'vencedor', 'draw', 'empate', 'determineoutcome'];

  [playerMatchState, gameplayFlow, finalMatchState].forEach((mod) => {
    Object.keys(mod).forEach((name) => {
      const lower = name.toLowerCase();
      forbidden.forEach((keyword) => {
        assert.ok(!lower.includes(keyword), `export inesperado "${name}" pareceria uma segunda logica de vencedor`);
      });
    });
  });

  // Confirma tambem, ao nivel de codigo-fonte, que gameplayFlow e
  // playerMatchState nunca comparam score entre os dois jogadores
  // (nenhuma comparacao "player1...player2" ou "score >").
  const gameplaySource = fs.readFileSync(`${__dirname}/../server/match/gameplayFlow.js`, 'utf8');
  const playerStateSource = fs.readFileSync(`${__dirname}/../server/match/playerMatchState.js`, 'utf8');
  [gameplaySource, playerStateSource].forEach((source) => {
    assert.ok(!/player1[\s\S]{0,40}score[\s\S]{0,10}(>|<)/.test(source), 'nao deveria haver comparacao de score entre jogadores aqui');
  });
});

console.log(`\n${passed} teste(s) passaram.`);
