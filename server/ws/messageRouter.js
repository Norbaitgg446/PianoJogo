const RoomManager = require('../rooms/RoomManager');
const MatchManager = require('../match/MatchManager');
const { MATCH_STATE, MATCH_MODE } = require('../match/Match');
const matchFlow = require('../match/matchFlow');
const gameplayFlow = require('../match/gameplayFlow');
const rematchFlow = require('../match/rematchFlow');
const leaveRoomFlow = require('../room/leaveRoomFlow');
const musicSelectionFlow = require('../music/musicSelectionFlow');
const matchDurationSelectionFlow = require('../match/matchDurationSelectionFlow');
const { send, sendError, broadcastToRoom } = require('./broadcast');

/**
 * type: 'create_room'
 * O jogador que envia essa mensagem se torna o player1 de uma sala nova.
 */
function handleCreateRoom(ws) {
  if (ws.roomCode) {
    return sendError(ws, 'Voce ja esta em uma sala.');
  }

  const room = RoomManager.createRoom();
  const slot = room.addPlayer(ws);

  send(ws, {
    type: 'room_created',
    roomCode: room.code,
    slot,
    room: room.toPublicJSON(),
  });

  // Etapa 10D: assim que o jogador tem uma sala, ja pode conhecer as
  // musicas disponiveis para selecionar (mesmo antes do oponente
  // entrar). Payload somente com dados publicos -- ver
  // musicSelectionFlow.getPublicCatalog.
  send(ws, { type: 'music_catalog', musics: musicSelectionFlow.getPublicCatalog() });
}

/**
 * type: 'join_room', roomCode: string
 * O jogador entra em uma sala existente, se houver vaga.
 */
function handleJoinRoom(ws, message) {
  if (ws.roomCode) {
    return sendError(ws, 'Voce ja esta em uma sala.');
  }

  const roomCode = (message.roomCode || '').trim().toUpperCase();
  const room = RoomManager.getRoom(roomCode);

  if (!room) {
    return sendError(ws, 'Sala nao encontrada.');
  }

  if (room.isFull()) {
    return sendError(ws, 'Sala ja esta cheia.');
  }

  const slot = room.addPlayer(ws);

  // Confirma para quem entrou.
  send(ws, {
    type: 'room_joined',
    roomCode: room.code,
    slot,
    room: room.toPublicJSON(),
  });

  // Etapa 10D: quem acabou de entrar tambem precisa conhecer o
  // catalogo de musicas para poder selecionar (o outro jogador ja
  // recebeu isso em 'create_room').
  send(ws, { type: 'music_catalog', musics: musicSelectionFlow.getPublicCatalog() });

  // Avisa o oponente que alguem entrou.
  const opponent = room.getOpponentConnection(slot);
  send(opponent, {
    type: 'opponent_joined',
    slot,
    room: room.toPublicJSON(),
  });

  // Se a sala ficou cheia, avisa os dois explicitamente (infra)
  // e entrega o controle para a camada de partida (match), que cuida
  // do estado READY -> COUNTDOWN -> PLAYING.
  if (room.isFull()) {
    broadcastToRoom(room, { type: 'room_full', room: room.toPublicJSON() });

    // Etapa 10D: se algum jogador ja selecionou uma musica enquanto
    // aguardava (unico momento em que ha uma janela real antes desta
    // primeira Match), usa essa selecao (ver regra em
    // musicSelectionFlow.resolveSelectedMusicId). Ninguem selecionou
    // nada -> `null` -> matchFlow cai em DEFAULT_MUSIC_ID, exatamente
    // como antes desta etapa (Etapa 10C).
    const requestedMusicId = musicSelectionFlow.resolveSelectedMusicId(room.code);
    // ETAPA 15C-MP — Parte 1: mesma logica, agora tambem para a duracao
    // (ver server/match/matchDurationSelectionFlow.js). Se nenhum dos
    // jogadores selecionou uma duracao valida enquanto aguardava, cai em
    // `null` -- matchFlow trata isso como "sem duracao configurada",
    // exatamente o comportamento atual (nenhuma partida termina mais
    // cedo por causa disto ainda).
    const requestedDurationId = matchDurationSelectionFlow.resolveSelectedDuration(room.code);
    matchFlow.startMatchFlow(room, requestedMusicId, undefined, requestedDurationId);
    // A selecao pendente ja foi consumida por esta Match -- nunca deve
    // ser reaproveitada automaticamente por uma Match futura (ex: uma
    // revanche) sem um novo pedido explicito do jogador.
    musicSelectionFlow.clearRoomSelection(room.code);
    matchDurationSelectionFlow.clearRoomSelection(room.code);
  }
}

/**
 * type: 'start_solo_match', musicId?: string (ETAPA 12A)
 *
 * O jogador pede para jogar SOZINHO. Reutiliza integralmente a mesma
 * arquitetura do multiplayer (Room/RoomManager, Match/MatchManager,
 * matchFlow.startMatchFlow -- mesmo pipeline de musica/seed/sequencia/
 * timeline, mesmo READY -> COUNTDOWN -> PLAYING) -- a UNICA diferenca e
 * que a Match criada aqui nunca espera por "player2" e e marcada com
 * `mode: "solo"` (ver matchFlow.startMatchFlow).
 *
 * Dois casos:
 * - jogador ainda NAO esta em nenhuma sala: cria uma Room nova (mesmo
 *   `RoomManager.createRoom` de `create_room`), adiciona o jogador como
 *   player1 e inicia a Match Solo nela;
 * - jogador ja esta em uma sala Solo cuja ultima Match ja terminou
 *   (`FINISHED`): e um pedido de "jogar novamente" Solo (ETAPA 12A,
 *   item 8) -- NAO usa o handshake multiplayer de rematchFlow.js (nao
 *   faz sentido negociar prontidao com um oponente que nao existe).
 *   Reaproveita a MESMA sala, mas SEMPRE cria uma Match nova (nunca
 *   reaproveita a Match/seed/timeline/estado anterior -- ver
 *   matchFlow.startMatchFlow, que sempre faz `new Match(...)` com nova
 *   seed).
 */
function handleStartSoloMatch(ws, message) {
  const requestedMusicId = typeof message.musicId === 'string' ? message.musicId : undefined;

  let room;
  let previousMusicId = null;

  if (ws.roomCode) {
    room = RoomManager.getRoom(ws.roomCode);
    if (!room || room.players[ws.slot] !== ws) {
      return sendError(ws, 'Sala nao existe mais.');
    }

    const currentMatch = MatchManager.getMatch(room.code);
    if (currentMatch && currentMatch.mode !== MATCH_MODE.SOLO) {
      return sendError(ws, 'Voce ja esta em uma sala multiplayer.');
    }
    if (currentMatch && currentMatch.state !== MATCH_STATE.FINISHED) {
      return sendError(ws, 'Ja existe uma partida solo em andamento nesta sala.');
    }

    // ETAPA 12A (item 8, mesma regra ja usada por rematchFlow.startRematch
    // para o multiplayer): "se a mesma musica for escolhida novamente,
    // ela pode ser reutilizada" -- lida da partida anterior ANTES dela
    // ser removida, nunca do catalogo global. So usada quando o pedido
    // atual nao trouxe um musicId explicito.
    previousMusicId = currentMatch ? currentMatch.musicId : null;

    // Nunca reaproveita a Match anterior (nem o timer/seed/estado dela)
    // -- matchFlow.startMatchFlow abaixo sempre cria uma Match nova.
    MatchManager.removeMatch(room.code);
  } else {
    room = RoomManager.createRoom();
    const slot = room.addPlayer(ws);

    send(ws, {
      type: 'room_created',
      roomCode: room.code,
      slot,
      room: room.toPublicJSON(),
    });

    send(ws, { type: 'music_catalog', musics: musicSelectionFlow.getPublicCatalog() });
  }

  matchFlow.startMatchFlow(room, requestedMusicId || previousMusicId, MATCH_MODE.SOLO);
}

/**
 * type: 'test_message', text: string
 * Apenas repassa uma mensagem de teste para o oponente na mesma sala.
 * Usado para comprovar que a comunicacao em tempo real funciona.
 */
function handleTestMessage(ws, message) {
  if (!ws.roomCode || !ws.slot) {
    return sendError(ws, 'Voce precisa estar em uma sala para enviar uma mensagem de teste.');
  }

  const room = RoomManager.getRoom(ws.roomCode);
  if (!room) {
    return sendError(ws, 'Sala nao existe mais.');
  }

  const opponent = room.getOpponentConnection(ws.slot);
  if (!opponent) {
    return sendError(ws, 'Nenhum oponente conectado no momento.');
  }

  send(opponent, {
    type: 'test_message',
    from: ws.slot,
    text: typeof message.text === 'string' ? message.text : '',
  });
}

/**
 * type: 'sequence_check', seed: number, checksum: number, sequence?: number[]
 * O cliente reporta o que gerou localmente a partir da seed recebida,
 * para o servidor comparar com o outro jogador (e com a sua propria
 * sequencia de referencia).
 */
function handleSequenceCheckMessage(ws, message) {
  if (!ws.roomCode || !ws.slot) {
    return sendError(ws, 'Voce precisa estar em uma sala para reportar a sequencia.');
  }

  const room = RoomManager.getRoom(ws.roomCode);
  if (!room) {
    return sendError(ws, 'Sala nao existe mais.');
  }

  matchFlow.handleSequenceCheck(room, ws.slot, {
    seed: message.seed,
    checksum: message.checksum,
    sequence: Array.isArray(message.sequence) ? message.sequence : null,
  });
}

/**
 * type: 'note_hit', noteId, lane, judgement, deltaMs, combo, score
 * O cliente reporta que acertou uma nota (PERFECT ou GOOD), ja
 * processada e julgada localmente (ver gameplayEngine.js no cliente).
 */
function handleNoteHitMessage(ws, message) {
  if (!ws.roomCode || !ws.slot) {
    return sendError(ws, 'Voce precisa estar em uma sala para reportar um acerto.');
  }

  const room = RoomManager.getRoom(ws.roomCode);
  if (!room) {
    return sendError(ws, 'Sala nao existe mais.');
  }

  gameplayFlow.applyNoteHit(ws, room, message);
}

/**
 * type: 'note_miss', noteId, lane, combo, misses
 * O cliente reporta que uma nota expirou sem ser atingida.
 */
function handleNoteMissMessage(ws, message) {
  if (!ws.roomCode || !ws.slot) {
    return sendError(ws, 'Voce precisa estar em uma sala para reportar uma nota perdida.');
  }

  const room = RoomManager.getRoom(ws.roomCode);
  if (!room) {
    return sendError(ws, 'Sala nao existe mais.');
  }

  gameplayFlow.applyNoteMiss(ws, room, message);
}

/**
 * type: 'sequence_complete' (Etapa 12)
 * O cliente avisa que a timeline local (a mesma dos dois jogadores,
 * mesma seed/startTimestamp) terminou de ser processada -- todas as
 * notas ja estao hit/missed (ver client/js/match/matchEndDetector.js).
 * So um gatilho: quem decide o snapshot/outcome real e exclusivamente
 * o servidor, via gameplayFlow.applySequenceComplete ->
 * matchFlow.finishMatch (ja existente, so nunca era chamado em
 * producao -- ver o comentario em gameplayFlow.js).
 */
function handleSequenceCompleteMessage(ws) {
  if (!ws.roomCode || !ws.slot) {
    return sendError(ws, 'Voce precisa estar em uma sala para reportar o fim da sequencia.');
  }

  const room = RoomManager.getRoom(ws.roomCode);
  if (!room) {
    return sendError(ws, 'Sala nao existe mais.');
  }

  gameplayFlow.applySequenceComplete(ws, room);
}

/**
 * type: 'rematch_ready'
 * O cliente informa que o jogador local quer jogar novamente (dentro da
 * MESMA sala). Toda a logica de handshake/inicio da nova partida vive em
 * server/match/rematchFlow.js.
 */
function handleRematchReadyMessage(ws) {
  if (!ws.roomCode || !ws.slot) {
    return sendError(ws, 'Voce precisa estar em uma sala para pedir revanche.');
  }

  const room = RoomManager.getRoom(ws.roomCode);
  if (!room) {
    return sendError(ws, 'Sala nao existe mais.');
  }

  rematchFlow.requestRematch(ws, room);
}

/**
 * type: 'leave_room'
 * O jogador decidiu sair voluntariamente da sala em que esta (diferente
 * de uma desconexao/`close` da conexao). Toda a logica de validacao,
 * remocao, aviso ao oponente e integracao com match/revanche vive em
 * server/room/leaveRoomFlow.js -- este handler so reconhece o tipo da
 * mensagem e delega.
 */
function handleLeaveRoomMessage(ws) {
  leaveRoomFlow.handleLeaveRoom(ws);
}

/**
 * type: 'select_music', musicId: string
 * O jogador solicita uma musica para a PROXIMA partida da sala. Toda a
 * validacao/registro/regra de dois jogadores vive em
 * server/music/musicSelectionFlow.js -- este handler so reconhece o
 * tipo da mensagem e delega, mesmo padrao ja usado para
 * `leave_room`/`rematch_ready`.
 */
function handleSelectMusicMessage(ws, message) {
  musicSelectionFlow.handleSelectMusic(ws, message);
}

/**
 * type: 'select_duration', durationId: string (ETAPA 15C-MP — Parte 1)
 * O jogador solicita uma duracao de partida para a PROXIMA Match
 * Multiplayer da sala. Toda a validacao/registro/regra de dois
 * jogadores vive em server/match/matchDurationSelectionFlow.js -- este
 * handler so reconhece o tipo da mensagem e delega, mesmo padrao ja
 * usado para `select_music`. NAO encerra nenhuma partida por tempo
 * ainda -- so prepara o transporte da duracao ate a Match.
 */
function handleSelectDurationMessage(ws, message) {
  matchDurationSelectionFlow.handleSelectDuration(ws, message);
}

/**
 * Ponto de entrada: recebe a mensagem crua (string) e distribui
 * para o handler correto com base no campo "type".
 */
function routeMessage(ws, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch (err) {
    return sendError(ws, 'Mensagem invalida (JSON malformado).');
  }

  switch (message.type) {
    case 'create_room':
      return handleCreateRoom(ws);
    case 'join_room':
      return handleJoinRoom(ws, message);
    case 'start_solo_match':
      return handleStartSoloMatch(ws, message);
    case 'test_message':
      return handleTestMessage(ws, message);
    case 'sequence_check':
      return handleSequenceCheckMessage(ws, message);
    case 'note_hit':
      return handleNoteHitMessage(ws, message);
    case 'note_miss':
      return handleNoteMissMessage(ws, message);
    case 'sequence_complete':
      return handleSequenceCompleteMessage(ws);
    case 'rematch_ready':
      return handleRematchReadyMessage(ws);
    case 'leave_room':
      return handleLeaveRoomMessage(ws);
    case 'select_music':
      return handleSelectMusicMessage(ws, message);
    case 'select_duration':
      return handleSelectDurationMessage(ws, message);
    default:
      return sendError(ws, `Tipo de mensagem desconhecido: ${message.type}`);
  }
}

module.exports = { routeMessage, send, sendError, broadcastToRoom };
