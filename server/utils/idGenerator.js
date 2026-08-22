const crypto = require('crypto');
const { ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET } = require('../config');

/**
 * Gera um codigo de sala aleatorio (ex: "K7X2QM").
 * A unicidade real e garantida pelo RoomManager, que verifica
 * colisao contra as salas existentes.
 */
function generateRoomCode(length = ROOM_CODE_LENGTH) {
  let code = '';
  for (let i = 0; i < length; i++) {
    const index = crypto.randomInt(0, ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[index];
  }
  return code;
}

/**
 * Gera um ID unico de jogador (usado internamente pelo servidor,
 * independente do "player1/player2" que e a posicao dentro da sala).
 */
function generatePlayerId() {
  return crypto.randomUUID();
}

/**
 * Gera a seed da partida (inteiro positivo). Definida SOMENTE pelo servidor
 * e enviada aos dois jogadores, para que ambos gerem a mesma sequencia.
 */
function generateSeed() {
  return crypto.randomInt(1, 1_000_000_000);
}

module.exports = { generateRoomCode, generatePlayerId, generateSeed };
