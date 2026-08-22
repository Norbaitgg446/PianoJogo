// Estados possiveis de uma partida.
const MATCH_STATE = {
  WAITING_FOR_PLAYER: 'WAITING_FOR_PLAYER', // sala ainda nao tem os 2 jogadores
  READY: 'READY',                           // 2 jogadores conectados, preparando inicio
  COUNTDOWN: 'COUNTDOWN',                   // contagem regressiva em andamento
  PLAYING: 'PLAYING',                       // partida em andamento
  FINISHED: 'FINISHED',                     // partida encerrada (nao usado ainda nesta etapa)
};

/**
 * Representa a partida associada a uma sala.
 * Guarda apenas o necessario para a ETAPA 2 (sincronizacao de inicio),
 * mas ja reserva a estrutura que as proximas etapas vao preencher
 * (musica, notas, seed, pontuacao, combo, vida).
 */
class Match {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.state = MATCH_STATE.WAITING_FOR_PLAYER;

    // Timestamp (epoch ms, definido pelo servidor) em que a partida deve comecar.
    // E o unico horario que os dois clientes devem usar para sincronizar o inicio.
    this.startTimestamp = null;

    // Referencia do timer interno de contagem regressiva (uso exclusivo do servidor,
    // nunca deve ser enviado ao cliente).
    this._countdownTimer = null;

    // ---- Campos reservados para as proximas etapas (NAO implementados ainda) ----
    this.song = null;            // dados da musica escolhida
    this.difficulty = null;      // dificuldade da partida
    this.speed = null;           // velocidade da partida
    this.seed = null;            // seed usada para gerar a partida (definida pelo servidor)

    // ---- Musica (Etapa 10A) ----
    // musicId/music vem do catalogo central (server/music/musicCatalog.js),
    // nunca escritos aqui diretamente -- quem preenche e matchFlow.js,
    // uma unica vez, ao criar a partida. `music` e uma COPIA da entrada
    // do catalogo (id/title/artist/bpm/durationMs/difficulty/sequenceId):
    // alterar este objeto nunca afeta o catalogo nem outra Match. Uma
    // Match nova (ex: revanche) sempre comeca com estes campos `null` --
    // nunca herda a musica da Match anterior da mesma sala.
    this.musicId = null;
    this.music = null;
    this.noteSequence = null;    // sequencia de referencia do servidor (uso INTERNO, nunca exposta ao cliente)
    this.players = {
      player1: this._createEmptyPlayerMatchState(),
      player2: this._createEmptyPlayerMatchState(),
    };
    // -------------------------------------------------------------------------

    // Estado transitorio do teste de igualdade de sequencia (Etapa 3).
    // Guarda o que cada jogador reportou ter gerado localmente, para o
    // servidor poder comparar. Nao faz parte da configuracao da partida.
    this._sequenceChecks = {
      player1: null,
      player2: null,
    };
  }

  _createEmptyPlayerMatchState() {
    return {
      score: 0,
      combo: 0,
      maxCombo: 0,
      hits: 0,
      misses: 0,
      mistakes: 0,
      life: null,
    };
  }

  setState(state) {
    this.state = state;
  }

  clearCountdownTimer() {
    if (this._countdownTimer) {
      clearTimeout(this._countdownTimer);
      this._countdownTimer = null;
    }
  }

  /**
   * Registra o que um jogador reportou ter gerado localmente
   * (seed utilizada + checksum da sequencia resultante).
   */
  recordSequenceCheck(slot, payload) {
    this._sequenceChecks[slot] = payload;
  }

  hasBothSequenceChecks() {
    return Boolean(this._sequenceChecks.player1 && this._sequenceChecks.player2);
  }

  /**
   * Representacao publica da partida (nunca inclui o timer interno,
   * a sequencia de referencia do servidor, nem o estado do teste de checksum).
   */
  toPublicJSON() {
    return {
      roomCode: this.roomCode,
      state: this.state,
      startTimestamp: this.startTimestamp,
      seed: this.seed,
      song: this.song,
      difficulty: this.difficulty,
      speed: this.speed,
      musicId: this.musicId,
      music: this.music,
      players: this.players,
    };
  }
}

module.exports = { Match, MATCH_STATE };
