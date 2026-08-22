const RoomManager = require('../rooms/RoomManager');
const MatchManager = require('../match/MatchManager');
const { MATCH_STATE } = require('../match/Match');
const matchFlow = require('../match/matchFlow');
const rematchFlow = require('../match/rematchFlow');
const matchAbandonment = require('../match/matchAbandonment');
const musicSelectionFlow = require('../music/musicSelectionFlow');
const { send } = require('./broadcast');
const { routeMessage } = require('./messageRouter');
const { generatePlayerId } = require('../utils/idGenerator');

/**
 * Trata a saida de um jogador (fechamento da conexao).
 * Atualiza o estado da sala, avisa o oponente e decide o que
 * acontece com a partida (se existir uma para essa sala).
 */
function handleDisconnect(ws) {
  const { roomCode, slot } = ws;
  if (!roomCode || !slot) return;

  const room = RoomManager.getRoom(roomCode);
  if (!room) return;

  const match = MatchManager.getMatch(roomCode);
  const matchAlreadyStarted = match && match.state === MATCH_STATE.PLAYING;
  const matchPendingStart = match && !matchAlreadyStarted && match.state !== MATCH_STATE.FINISHED;

  room.removePlayer(slot);

  // Etapa 10D: mesma limpeza feita em leaveRoomFlow.js -- uma
  // desconexao tambem nunca deve deixar uma selecao de musica presa.
  musicSelectionFlow.clearPlayerSelection(roomCode, slot);

  const opponent = room.getOpponentConnection(slot);
  send(opponent, {
    type: 'opponent_left',
    slot,
    room: room.toPublicJSON(),
  });

  if (matchPendingStart) {
    // Jogador saiu antes (ou durante) a contagem regressiva: cancela a partida
    // e o outro jogador volta para o estado de espera.
    matchFlow.cancelMatch(room, 'O oponente saiu antes do inicio da partida.');
  }

  if (matchAlreadyStarted) {
    // Jogador saiu DURANTE a partida (PLAYING): abandono (Etapa 8A).
    // Encerra a partida atual de forma segura e avisa quem ficou -- ver
    // server/match/matchAbandonment.js. Vitoria/derrota por abandono,
    // recompensa, ranking etc. ficam para uma proxima etapa.
    matchAbandonment.handleAbandonment(room, match, slot);
  }

  if (rematchFlow.isRematchPending(room.code)) {
    // Um dos jogadores desconectou enquanto os dois ainda aguardavam a
    // revanche: cancela o handshake e avisa quem ainda estiver na sala.
    // Nunca inicia uma partida nova com apenas um jogador.
    rematchFlow.cancelRematch(room, 'O oponente desconectou antes da revanche comecar.');
  }

  if (room.isEmpty()) {
    RoomManager.deleteRoom(room.code);
    MatchManager.removeMatch(room.code);
    musicSelectionFlow.clearRoomSelection(room.code);
  }
}

/**
 * Registra os listeners de uma nova conexao WebSocket.
 */
function registerConnection(ws) {
  // Metadados da conexao (preenchidos quando o jogador cria/entra em uma sala).
  ws.playerId = generatePlayerId();
  ws.roomCode = null;
  ws.slot = null;

  send(ws, { type: 'connected', playerId: ws.playerId });

  ws.on('message', (raw) => routeMessage(ws, raw));

  ws.on('close', () => handleDisconnect(ws));

  ws.on('error', () => handleDisconnect(ws));
}

module.exports = { registerConnection };
