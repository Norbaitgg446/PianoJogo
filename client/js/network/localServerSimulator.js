/**
 * ETAPA 13 -- Modo de Teste Local (file://).
 *
 * Este modulo NAO e um segundo sistema de gameplay. Ele nao sabe nada
 * sobre GameplayEngine, NoteEngine, MatchController, PlayerState,
 * timeline ou julgamento -- essa logica inteira continua vivendo
 * exclusivamente em client/js/main.js e client/js/match/*, exatamente
 * como no modo hospedado (ver main.js#startMatchGameplay).
 *
 * O QUE ISTO E: um "servidor de mentira" que fala o MESMO protocolo de
 * mensagens que server/ws/messageRouter.js + server/match/matchFlow.js
 * falam de verdade (mesmos tipos de mensagem, mesmos campos), so que
 * gerado inteiramente no proprio navegador, sem WebSocket, sem rede e
 * sem processo Node nenhum. Do ponto de vista de client/js/main.js, as
 * mensagens que chegam daqui sao INDISTINGUIVEIS das que chegariam de
 * um servidor real -- e por isso nenhuma linha de main.js precisa
 * mudar: ele so reage a `SocketClient.onMessage`, nao importa a origem.
 *
 * Mensagens replicadas (mesmo formato de server/ws/messageRouter.js +
 * server/match/matchFlow.js, para o fluxo Solo):
 *   room_created -> music_catalog -> match_ready -> match_countdown_start
 *   -> match_started -> (gameplay 100% local) -> match_result
 *
 * O QUE NAO E REPLICADO (de proposito, fora do escopo do modo local):
 * - multiplayer real (create_room/join_room) -- ver handleCreateOrJoin
 *   abaixo, que responde com um `error` claro em vez de fingir criar
 *   uma sala com um oponente que nao existe;
 * - comparacao de checksum entre dois jogadores (sequence_check) -- so
 *   existe UM jogador aqui, entao a resposta e sempre "identico",
 *   apenas para nao quebrar o log que main.js ja mostra;
 * - selecao de musica com efeito real -- o SERVIDOR REAL de producao
 *   tambem nao usa a selecao de musica para decidir a musica de uma
 *   partida Solo (ver server/ws/messageRouter.js#handleStartSoloMatch:
 *   o `musicId` de start_solo_match nunca e enviado pelo cliente, entao
 *   toda partida Solo hospedada cai sempre em DEFAULT_MUSIC_ID, salvo
 *   reaproveitar a musica da Match anterior da mesma sala). Este
 *   simulador reproduz EXATAMENTE esse mesmo comportamento -- nao e uma
 *   limitacao nova do modo local, e o comportamento real do servidor.
 *
 * Cada instancia (`createLocalConnection`) tem seu proprio estado --
 * nao ha nenhum singleton/estado global compartilhado entre partidas ou
 * entre chamadas de teste.
 */
const LocalServerSimulator = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;

  // Mesmo valor de server/config.js#MATCH_COUNTDOWN_SECONDS.
  const DEFAULT_COUNTDOWN_SECONDS = 3;

  // Mesmo roomCode nao importa aqui (nunca ha uma segunda sala/jogador
  // para colidir) -- um valor fixo e legivel para quem olhar o console.
  const LOCAL_ROOM_CODE = 'LOCAL-TEST';

  // Copia dos dois registros de server/music/musicCatalog.js
  // (buildDefaultCatalog). Mantido IDENTICO de proposito -- mesmo
  // raciocinio ja documentado em client/js/music/sequenceCatalog.js
  // para o "molde" de sequencia: o projeto nao usa um bundler
  // compartilhando codigo entre servidor (Node) e cliente (browser).
  const MUSIC_CATALOG = [
    {
      id: 'music-001',
      title: 'Sinais de Teste',
      artist: 'Estudio Interno',
      bpm: 120,
      durationMs: 90000,
      difficulty: 'easy',
      sequenceId: 'seq-basic-01',
    },
    {
      id: 'music-002',
      title: 'Contagem Regressiva',
      artist: 'Estudio Interno',
      bpm: 140,
      durationMs: 105000,
      difficulty: 'medium',
      sequenceId: 'seq-basic-02',
    },
  ];

  // Mesmo valor de server/config.js#DEFAULT_MUSIC_ID. Toda partida Solo
  // (aqui e no servidor real -- ver comentario acima) usa esta musica.
  const DEFAULT_MUSIC_ID = 'music-001';

  const MULTIPLAYER_UNAVAILABLE_MESSAGE =
    'O modo Multiplayer precisa de conexao com o servidor. Abra o jogo pelo endereco da hospedagem.';
  const FEATURE_UNAVAILABLE_MESSAGE =
    'Este recurso precisa de conexao com o servidor. Abra o jogo pelo endereco da hospedagem.';

  function getMusicById(musicId) {
    const music = MUSIC_CATALOG.find((entry) => entry.id === musicId);
    return music ? { ...music } : null;
  }

  function getPublicCatalog() {
    return MUSIC_CATALOG.map(({ id, title, artist, bpm, durationMs, difficulty }) => ({
      id,
      title,
      artist,
      bpm,
      durationMs,
      difficulty,
    }));
  }

  /**
   * Gera uma seed positiva para a Match (mesmo papel de
   * server/utils/idGenerator.js#generateSeed, sem precisar de
   * crypto -- aqui nunca ha um segundo jogador para comparar contra a
   * mesma seed, entao Math.random() e suficiente).
   */
  function generateLocalSeed() {
    return Math.floor(Math.random() * 999999999) + 1;
  }

  function createEmptyPlayerMatchState() {
    return { score: 0, combo: 0, maxCombo: 0, hits: 0, misses: 0, mistakes: 0, life: null };
  }

  /**
   * Mesmo formato de Match.toPublicJSON() (server/match/Match.js) para
   * os campos que client/js/main.js realmente le
   * (state/mode/startTimestamp/seed/music/musicId).
   */
  function buildMatchPublicJSON({ state, startTimestamp, seed, music }) {
    return {
      roomCode: LOCAL_ROOM_CODE,
      state,
      mode: 'solo',
      startTimestamp,
      seed,
      song: music.id,
      difficulty: music.difficulty,
      speed: 1,
      musicId: music.id,
      music,
      players: {
        player1: createEmptyPlayerMatchState(),
        player2: createEmptyPlayerMatchState(),
      },
    };
  }

  // Mesmo formato de Room.toPublicJSON() (server/rooms/Room.js).
  function buildRoomPublicJSON() {
    return {
      code: LOCAL_ROOM_CODE,
      state: 'WAITING_FOR_PLAYERS',
      playerCount: 1,
      players: {
        player1: { connected: true },
        player2: null,
      },
    };
  }

  /**
   * @param {object} [deps]
   * @param {(message: object) => void} [deps.onMessage] - chamado para
   *   cada mensagem "recebida" (mesmo formato de SocketClient.onMessage).
   * @param {(status: string) => void} [deps.onStatusChange] - chamado
   *   para cada mudanca de status (mesmo formato de
   *   SocketClient.onStatusChange). Sempre "connected" assim que
   *   `connect()` e chamado (nunca ha rede real para falhar aqui).
   * @param {number} [deps.countdownMs] - Etapa 13 (testes): permite
   *   encurtar a contagem regressiva real (3000ms) para testes rapidos.
   *   Producao/uso normal nunca passa isto (usa o valor real).
   */
  function createLocalConnection(deps = {}) {
    const onMessage = typeof deps.onMessage === 'function' ? deps.onMessage : () => {};
    const onStatusChange = typeof deps.onStatusChange === 'function' ? deps.onStatusChange : () => {};
    const countdownSeconds = DEFAULT_COUNTDOWN_SECONDS;
    const countdownMs =
      typeof deps.countdownMs === 'number' && deps.countdownMs >= 0
        ? deps.countdownMs
        : countdownSeconds * 1000;

    // Equivalente local a `ws.roomCode` no servidor real: existe uma
    // "sala" (mesmo que so com player1) assim que a primeira partida
    // Solo comeca, ate um `leave_room`.
    let hasRoom = false;
    const pendingTimers = [];

    function schedule(fn, ms) {
      const id = setTimeout(fn, ms);
      pendingTimers.push(id);
      return id;
    }

    function clearPendingTimers() {
      pendingTimers.forEach((id) => clearTimeout(id));
      pendingTimers.length = 0;
    }

    function connect() {
      // Nunca ha handshake real -- "conectado" assim que o modo local
      // e ativado, mesmo sem nenhum socket.
      onStatusChange('connected');
    }

    /**
     * type: 'start_solo_match' (mesmo contrato de
     * messageRouter.js#handleStartSoloMatch, restrito ao caminho que o
     * cliente realmente usa: sem musicId explicito -- ver comentario no
     * topo do arquivo).
     */
    function startSoloMatch() {
      const music = getMusicById(DEFAULT_MUSIC_ID);
      const seed = generateLocalSeed();

      if (!hasRoom) {
        hasRoom = true;
        onMessage({
          type: 'room_created',
          roomCode: LOCAL_ROOM_CODE,
          slot: 'player1',
          room: buildRoomPublicJSON(),
        });
        onMessage({ type: 'music_catalog', musics: getPublicCatalog() });
      }

      onMessage({
        type: 'match_ready',
        match: buildMatchPublicJSON({ state: 'READY', startTimestamp: null, seed, music }),
      });

      // Mesmo formato de matchFlow.js#scheduleCountdown: define
      // serverTime/startTimestamp UMA vez e so entao avisa o cliente.
      schedule(() => {
        const serverTime = Date.now();
        const startTimestamp = serverTime + countdownMs;

        onMessage({
          type: 'match_countdown_start',
          serverTime,
          startTimestamp,
          countdownSeconds,
          match: buildMatchPublicJSON({ state: 'COUNTDOWN', startTimestamp, seed, music }),
        });

        schedule(() => {
          onMessage({
            type: 'match_started',
            startTimestamp,
            match: buildMatchPublicJSON({ state: 'PLAYING', startTimestamp, seed, music }),
          });
        }, countdownMs);
      }, 0);
    }

    /**
     * type: 'create_room' | 'join_room' -- ITEM 3 do pedido: o modo
     * local NUNCA tenta abrir um WebSocket para o multiplayer. So
     * informa, com uma mensagem clara, que e preciso abrir o jogo pelo
     * endereco hospedado.
     */
    function handleMultiplayerUnavailable() {
      onMessage({ type: 'error', message: MULTIPLAYER_UNAVAILABLE_MESSAGE });
    }

    function handleLeaveRoom() {
      hasRoom = false;
      clearPendingTimers();
      onMessage({ type: 'left_room' });
    }

    /**
     * type: 'sequence_check' -- so existe um jogador local, entao a
     * unica comparacao possivel e "contra si mesmo" (sempre identico).
     * Mantido apenas para o log que main.js ja exibe nao ficar
     * pendurado a espera de uma resposta que nunca chegaria.
     */
    function handleSequenceCheck(payload) {
      const checksum = payload && typeof payload.checksum === 'number' ? payload.checksum : null;
      onMessage({
        type: 'sequence_check_result',
        identical: true,
        player1Checksum: checksum,
        player2Checksum: null,
        serverChecksum: checksum,
      });
    }

    /**
     * type: 'sequence_complete' -- gatilho do fim da partida local (ver
     * main.js#handleLocalMatchEnd). Equivalente local a
     * gameplayFlow.applySequenceComplete -> matchFlow.finishMatch para
     * o modo Solo: so confirma ao cliente que o resultado e oficial.
     * Nenhum score/estatistica novo e calculado aqui -- o resultado que
     * a tela ja mostra (ResultRenderer.show, dentro de
     * handleLocalMatchEnd) veio inteiramente do PlayerState/timeline
     * locais, nunca deste modulo.
     */
    function handleSequenceComplete() {
      onMessage({
        type: 'match_result',
        mode: 'solo',
        player1: createEmptyPlayerMatchState(),
      });
    }

    /**
     * type: 'select_music' -- mesmo raciocinio do comentario no topo:
     * confirma a selecao (para a lista de musicas nao ficar presa em
     * "aguardando confirmacao"), mas isso nunca muda a musica de uma
     * partida Solo -- exatamente como o servidor real hoje.
     */
    function handleSelectMusic(payload) {
      const musicId = payload && typeof payload.musicId === 'string' ? payload.musicId : null;
      if (!musicId || !getMusicById(musicId)) {
        onMessage({ type: 'error', message: 'Musica invalida.' });
        return;
      }
      onMessage({ type: 'music_selected', slot: 'player1', musicId });
    }

    function send(type, payload = {}) {
      switch (type) {
        case 'start_solo_match':
          return startSoloMatch();
        case 'create_room':
        case 'join_room':
          return handleMultiplayerUnavailable();
        case 'leave_room':
          return handleLeaveRoom();
        case 'sequence_check':
          return handleSequenceCheck(payload);
        case 'sequence_complete':
          return handleSequenceComplete();
        case 'select_music':
          return handleSelectMusic(payload);
        case 'note_hit':
        case 'note_miss':
          // Telemetria fire-and-forget (ver client/js/match/gameplayEngine.js)
          // -- sem oponente para retransmitir, e o resultado final Solo
          // nunca depende disso (ver handleSequenceComplete acima).
          return;
        case 'rematch_ready':
        case 'test_message':
          // So fazem sentido com um oponente real conectado.
          return onMessage({ type: 'error', message: FEATURE_UNAVAILABLE_MESSAGE });
        default:
          return onMessage({
            type: 'error',
            message: `Tipo de mensagem nao suportado no modo de teste local: ${type}`,
          });
      }
    }

    return { connect, send };
  }

  /**
   * Verdadeiro somente quando a pagina foi aberta via file:// (ex: o
   * gerenciador de arquivos do celular abrindo client/index.html
   * diretamente) -- nunca em http:// nem https://. Ver ITEM 1 do
   * pedido.
   */
  function isLocalFileMode() {
    return typeof window !== 'undefined' && !!window.location && window.location.protocol === 'file:';
  }

  const api = {
    createLocalConnection,
    isLocalFileMode,
    getPublicCatalog,
    // Exportado para testes (Etapa 13): permite validar o catalogo e o
    // musicId padrao sem precisar montar uma conexao completa.
    DEFAULT_MUSIC_ID,
    MULTIPLAYER_UNAVAILABLE_MESSAGE,
  };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
