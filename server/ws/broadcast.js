/**
 * Envia um objeto JSON para uma conexao (se ela ainda estiver aberta).
 */
function send(ws, payload) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendError(ws, message) {
  send(ws, { type: 'error', message });
}

/**
 * Envia o mesmo payload para os dois jogadores de uma sala
 * (ignora silenciosamente slots vazios/desconectados).
 */
function broadcastToRoom(room, payload) {
  send(room.players.player1, payload);
  send(room.players.player2, payload);
}

module.exports = { send, sendError, broadcastToRoom };
