/**
 * Saida voluntaria de uma sala (Etapa 9A).
 *
 * Responsabilidade unica: quando um jogador manda `leave_room`, encerrar a
 * participacao DELE naquela sala de forma segura -- sem fechar o
 * WebSocket, sem mexer em outra sala, e sem duplicar nenhum sistema que
 * ja existe (Room/RoomManager, MatchManager, matchFlow, matchAbandonment,
 * rematchFlow).
 *
 * Este modulo NAO:
 * - decide o que acontece com uma partida em PLAYING -- isso continua
 *   sendo responsabilidade de matchAbandonment.js (mesmo mecanismo usado
 *   para desconexao). `leave_room` so decide QUANDO chamar
 *   matchAbandonment.handleAbandonment, nunca reimplementa o que ele faz;
 * - decide o que acontece com uma partida em WAITING_FOR_PLAYER/READY/
 *   COUNTDOWN -- isso continua sendo matchFlow.cancelMatch;
 * - decide o que acontece com uma revanche pendente -- isso continua
 *   sendo rematchFlow.cancelRematch;
 * - fecha a conexao WebSocket. O jogador so deixa de pertencer a sala;
 * - sabe nada sobre a interface (botao/modal) -- isso e client, e fica
 *   para uma proxima etapa.
 *
 * DIFERENCA para `disconnect` (connectionHandler.js): `leave_room` e uma
 * decisao explicita do jogador, com a conexao permanecendo aberta; o
 * fluxo de logica (o que fazer com sala/match/revanche) e o MESMO usado
 * hoje para desconexao, entao este modulo reaproveita exatamente as
 * mesmas chamadas que connectionHandler.handleDisconnect ja faz -- so
 * muda o gatilho (mensagem explicita em vez de 'close'/'error') e o fato
 * de NAO fechar nada no fim.
 *
 * SEGURANCA / IDEMPOTENCIA: a unica fonte de verdade sobre "o jogador
 * esta nesta sala, neste slot" e o proprio objeto `ws` (ws.roomCode,
 * ws.slot) tal como guardado pelo servidor -- a mensagem do cliente NAO
 * carrega roomCode nem slot (ver mensagem esperada: apenas
 * `{ type: 'leave_room' }`), entao nao ha como um jogador tentar sair
 * usando o roomCode/slot de outro. Alem disso, so processamos a saida se
 * `room.players[slot] === ws` (a conexao realmente ocupa aquele slot
 * naquela sala agora); caso contrario (ex: leave_room chamado de novo
 * depois de ja ter saido, sala recriada, etc.) a chamada e rejeitada sem
 * tocar em nada. Ao final, `ws.roomCode`/`ws.slot` sao limpos, entao:
 * - uma segunda chamada de `leave_room` para a MESMA conexao cai direto
 *   na checagem "nao esta em uma sala" (idempotente, sem lancar erro
 *   interno nem reenviar `player_left_room`);
 * - qualquer comando de gameplay/revanche que chegue depois desta
 *   conexao e rejeitado por messageRouter.js, que ja exige
 *   `ws.roomCode`/`ws.slot` preenchidos para todos esses handlers.
 */
const RoomManager = require('../rooms/RoomManager');
const MatchManager = require('../match/MatchManager');
const { MATCH_STATE } = require('../match/Match');
const matchFlow = require('../match/matchFlow');
const rematchFlow = require('../match/rematchFlow');
const matchAbandonment = require('../match/matchAbandonment');
const musicSelectionFlow = require('../music/musicSelectionFlow');
const { send, sendError } = require('../ws/broadcast');

/**
 * type: 'leave_room'
 * O jogador decidiu sair voluntariamente da sala em que esta.
 *
 * @param {object} ws conexao do jogador que pediu para sair
 */
function handleLeaveRoom(ws) {
  const { roomCode, slot } = ws;

  if (!roomCode || !slot) {
    return sendError(ws, 'Voce nao esta em uma sala.');
  }

  const room = RoomManager.getRoom(roomCode);
  if (!room) {
    // Sala ja nao existe mais (ex: foi removida por outro motivo entre a
    // ultima acao e este leave_room). Limpa o estado local desta conexao
    // defensivamente, mas nao ha mais nada para atualizar/avisar.
    ws.roomCode = null;
    ws.slot = null;
    return sendError(ws, 'Sala nao existe mais.');
  }

  if (room.players[slot] !== ws) {
    // A conexao nao ocupa (mais) esse slot nessa sala -- ex: leave_room
    // repetido, ou um estado local desatualizado. Nunca remove outro
    // jogador nem reprocessa uma saida ja concluida.
    ws.roomCode = null;
    ws.slot = null;
    return sendError(ws, 'Voce nao pertence mais a essa sala.');
  }

  const match = MatchManager.getMatch(roomCode);
  const matchAlreadyStarted = match && match.state === MATCH_STATE.PLAYING;
  const matchPendingStart = match && !matchAlreadyStarted && match.state !== MATCH_STATE.FINISHED;

  room.removePlayer(slot);

  // Etapa 10D: a saida nunca deve deixar uma selecao de musica presa
  // -- nem para quem saiu (nao faz mais sentido usa-la) nem, se a sala
  // ficar vazia, para a sala inteira (ver abaixo).
  musicSelectionFlow.clearPlayerSelection(roomCode, slot);

  const opponent = room.getOpponentConnection(slot);
  send(opponent, {
    type: 'player_left_room',
    player: slot,
  });

  if (matchPendingStart) {
    // WAITING_FOR_PLAYER, READY ou COUNTDOWN: impede que uma partida seja
    // iniciada (ou continue) com um jogador que acabou de sair.
    matchFlow.cancelMatch(room, 'O oponente saiu da sala antes do inicio da partida.');
  }

  if (matchAlreadyStarted) {
    // PLAYING: reutiliza exatamente o mesmo mecanismo de abandono usado
    // para desconexao -- nenhum segundo sistema de abandono e criado.
    matchAbandonment.handleAbandonment(room, match, slot);
  }

  if (rematchFlow.isRematchPending(room.code)) {
    // Revanche pendente: cancela o handshake, limpa qualquer "ready"
    // antigo e avisa quem ainda estiver na sala. Nunca inicia uma nova
    // Match com apenas um jogador.
    rematchFlow.cancelRematch(room, 'O oponente saiu da sala antes da revanche comecar.');
  }

  if (room.isEmpty()) {
    RoomManager.deleteRoom(room.code);
    MatchManager.removeMatch(room.code);
    musicSelectionFlow.clearRoomSelection(room.code);
  }

  // Confirma para quem saiu que a saida foi concluida (payload minimo).
  // Isso NAO fecha o WebSocket: a conexao segue aberta para uso futuro
  // (entrar em outra sala, etc. -- fora do escopo desta etapa).
  send(ws, { type: 'left_room' });

  // Desvincula esta conexao da sala/slot. A partir daqui, qualquer outro
  // comando desta conexao relacionado a sala (gameplay, revanche, ou um
  // novo leave_room) e tratado como "fora de uma sala".
  ws.roomCode = null;
  ws.slot = null;
}

module.exports = { handleLeaveRoom };
