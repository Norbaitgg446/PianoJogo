/**
 * Guarda as partidas ativas em memoria (Map<roomCode, Match>).
 * Mesma logica do RoomManager: sem persistencia, tudo se perde
 * se o servidor reiniciar.
 */
class MatchManager {
  constructor() {
    this.matches = new Map();
  }

  setMatch(roomCode, match) {
    this.matches.set(roomCode, match);
  }

  getMatch(roomCode) {
    return this.matches.get(roomCode) || null;
  }

  /**
   * Remove a partida da memoria, garantindo que qualquer timer
   * de contagem regressiva pendente seja cancelado antes.
   */
  removeMatch(roomCode) {
    const match = this.matches.get(roomCode);
    if (match) {
      match.clearCountdownTimer();
    }
    this.matches.delete(roomCode);
  }
}

module.exports = new MatchManager();
