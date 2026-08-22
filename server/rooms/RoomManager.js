const { Room } = require('./Room');
const { generateRoomCode } = require('../utils/idGenerator');
const { MAX_ROOM_CODE_ATTEMPTS } = { MAX_ROOM_CODE_ATTEMPTS: 20 };

/**
 * Guarda todas as salas ativas em memoria (Map<code, Room>).
 * Nesta etapa nao ha persistencia: se o servidor reiniciar, as salas somem.
 */
class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  /**
   * Cria uma nova sala com um codigo unico e ja garante 1 tentativa
   * de retry caso o codigo gerado colida com um existente.
   */
  createRoom() {
    let code = generateRoomCode();
    let attempts = 0;

    while (this.rooms.has(code) && attempts < MAX_ROOM_CODE_ATTEMPTS) {
      code = generateRoomCode();
      attempts++;
    }

    if (this.rooms.has(code)) {
      throw new Error('Nao foi possivel gerar um codigo de sala unico.');
    }

    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get(code) || null;
  }

  roomExists(code) {
    return this.rooms.has(code);
  }

  /**
   * Remove a sala do mapa (usado quando ela fica vazia).
   */
  deleteRoom(code) {
    this.rooms.delete(code);
  }

  getActiveRoomCount() {
    return this.rooms.size;
  }
}

// Singleton: um unico RoomManager compartilhado por todo o servidor.
module.exports = new RoomManager();
