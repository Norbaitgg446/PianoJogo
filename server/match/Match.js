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
// Modos possiveis de uma Match (ETAPA 12A).
// "multiplayer" e o valor padrao (comportamento inalterado de todas as
// etapas anteriores) -- "solo" e usado exclusivamente pelo fluxo
// start_solo_match (ver server/match/matchFlow.js), que reutiliza esta
// MESMA classe/estrutura, apenas com player2 nunca preenchido.
const MATCH_MODE = {
  MULTIPLAYER: 'multiplayer',
  SOLO: 'solo',
};

class Match {
  constructor(roomCode, mode) {
    this.roomCode = roomCode;
    this.state = MATCH_STATE.WAITING_FOR_PLAYER;

    // ETAPA 12A: modo da partida. Default "multiplayer" -- obrigatorio
    // para nao quebrar nenhuma partida existente. So "solo" (ver
    // matchFlow.startMatchFlow) muda esse valor.
    this.mode = mode === MATCH_MODE.SOLO ? MATCH_MODE.SOLO : MATCH_MODE.MULTIPLAYER;

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

    // ---- Duracao da partida (ETAPA 15C-MP — Parte 1) ----
    // `durationId` e um dos identificadores estaveis de
    // ClientConfig.MATCH_DURATION_IDS ("30S"/"1M"/"5M"/"10M", ver
    // client/js/config.js) ou `null` quando nenhuma duracao valida foi
    // selecionada para esta partida (mesmo significado de "sem duracao
    // configurada" que Solo/Bot ja usam). `durationMs` e o valor em
    // milissegundos correspondente, resolvido EXCLUSIVAMENTE via
    // MatchDuration.resolveMatchDuration (client/js/match/matchDuration.js)
    // + ClientConfig.MATCH_DURATION_MS -- nunca uma tabela paralela.
    // Preenchidos uma unica vez por matchFlow.startMatchFlow, no mesmo
    // momento em que musicId/music/difficulty/speed sao definidos --
    // nunca alterados depois. NAO usados ainda para encerrar a partida
    // (isso fica para uma proxima parte): por enquanto sao apenas
    // transportados ate os dois jogadores via toPublicJSON.
    this.durationId = null;
    this.durationMs = null;

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

  /**
   * ETAPA 12A: no modo Solo so existe player1 -- entao o "teste de
   * igualdade de sequencia" (pensado para comparar P1 vs P2) so precisa
   * do relatorio de player1 para ser considerado completo. Nenhuma
   * mudanca de comportamento para o modo multiplayer (continua exigindo
   * os dois).
   */
  hasBothSequenceChecks() {
    if (this.mode === MATCH_MODE.SOLO) {
      return Boolean(this._sequenceChecks.player1);
    }
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
      mode: this.mode,
      startTimestamp: this.startTimestamp,
      seed: this.seed,
      song: this.song,
      difficulty: this.difficulty,
      speed: this.speed,
      durationId: this.durationId,
      durationMs: this.durationMs,
      musicId: this.musicId,
      music: this.music,
      players: this.players,
    };
  }
}

module.exports = { Match, MATCH_STATE, MATCH_MODE };
