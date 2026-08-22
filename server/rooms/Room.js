const { MAX_PLAYERS_PER_ROOM } = require('../config');

// Estados possiveis da sala nesta etapa.
// (Nas proximas etapas podera surgir algo como "IN_GAME", "FINISHED", etc.)
const ROOM_STATE = {
  WAITING_FOR_PLAYERS: 'WAITING_FOR_PLAYERS',
  FULL: 'FULL',
  EMPTY: 'EMPTY', // usado apenas internamente antes de remocao
};

/**
 * Representa uma sala de jogo 1v1.
 * A sala vive somente em memoria (nao ha persistencia em banco).
 */
class Room {
  constructor(code) {
    this.code = code;
    this.state = ROOM_STATE.WAITING_FOR_PLAYERS;

    // slots fixos: 'player1' e 'player2'
    this.players = {
      player1: null,
      player2: null,
    };

    this.createdAt = Date.now();
  }

  getPlayerCount() {
    return Object.values(this.players).filter(Boolean).length;
  }

  isFull() {
    return this.getPlayerCount() >= MAX_PLAYERS_PER_ROOM;
  }

  isEmpty() {
    return this.getPlayerCount() === 0;
  }

  /**
   * Adiciona um jogador na primeira vaga livre.
   * Retorna o slot ("player1" | "player2") ou null se a sala estiver cheia.
   */
  addPlayer(playerConnection) {
    if (this.isFull()) return null;

    const slot = this.players.player1 === null ? 'player1' : 'player2';
    this.players[slot] = playerConnection;
    playerConnection.slot = slot;
    playerConnection.roomCode = this.code;

    this.state = this.isFull() ? ROOM_STATE.FULL : ROOM_STATE.WAITING_FOR_PLAYERS;
    return slot;
  }

  /**
   * Remove um jogador pelo slot. Ajusta o estado da sala.
   */
  removePlayer(slot) {
    if (!this.players[slot]) return;
    this.players[slot] = null;
    this.state = this.isEmpty() ? ROOM_STATE.EMPTY : ROOM_STATE.WAITING_FOR_PLAYERS;
  }

  getOpponentSlot(slot) {
    return slot === 'player1' ? 'player2' : 'player1';
  }

  getOpponentConnection(slot) {
    return this.players[this.getOpponentSlot(slot)];
  }

  /**
   * Representacao "publica" da sala (o que pode ser enviado ao cliente).
   * Nunca expor objetos internos de conexao (ws) diretamente.
   */
  toPublicJSON() {
    return {
      code: this.code,
      state: this.state,
      playerCount: this.getPlayerCount(),
      players: {
        player1: this.players.player1
          ? { connected: true }
          : null,
        player2: this.players.player2
          ? { connected: true }
          : null,
      },
    };
  }
}

module.exports = { Room, ROOM_STATE };
