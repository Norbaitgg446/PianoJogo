/**
 * Selecao de musica ANTES da partida comecar (Etapa 10D).
 *
 * ORIGEM: ate a Etapa 10C nao havia nenhuma forma de o JOGADOR escolher
 * a musica -- toda Match nova usava `DEFAULT_MUSIC_ID`, exceto a
 * revanche, que reaproveitava o musicId da partida anterior
 * (rematchFlow.js). Esta etapa introduz o mecanismo de selecao em si,
 * sem alterar nenhum desses dois comportamentos quando ninguem
 * seleciona nada.
 *
 * Este modulo NAO:
 * - decide como/quando uma Match e criada -- isso continua sendo
 *   INTEIRAMENTE responsabilidade de matchFlow.js (seed, sequencia,
 *   timeline, estado READY/COUNTDOWN/PLAYING). Este modulo so guarda
 *   uma CONFIGURACAO (qual musicId cada slot pediu para a PROXIMA
 *   Match daquela sala) e resolve, de forma deterministica, qual
 *   musicId usar quando essa proxima Match for de fato criada;
 * - substitui ou duplica o musicCatalog -- toda validacao de
 *   "musica existe" usa exclusivamente `musicCatalog.musicExists`;
 * - guarda nenhum estado de PARTIDA (score/combo/seed/timeline) -- a
 *   selecao e so uma preferencia para a proxima Match, nunca carrega
 *   nada da Match atual/anterior;
 * - fica dentro de messageRouter.js: o router so reconhece o tipo da
 *   mensagem (`select_music`) e delega para `handleSelectMusic` aqui.
 *
 * ESTADO: Map<roomCode, {player1: string|null, player2: string|null}>.
 * Uma entrada so existe enquanto houver pelo menos uma selecao
 * pendente para aquela sala -- assim que a Match que vai consumi-la e
 * criada (ver matchFlow/rematchFlow via messageRouter.js), o chamador
 * limpa a entrada com `clearRoomSelection` (a selecao NUNCA e reusada
 * automaticamente para uma segunda Match sem um novo pedido explicito
 * do jogador). Isso e o que garante que a selecao "e apenas uma
 * configuracao": ela nunca carrega estado de uma Match para a
 * seguinte, so o musicId escolhido.
 *
 * REGRA PARA DOIS JOGADORES (quando escolhem musicas diferentes):
 * a sala ja usa slots fixos e determinos por ordem de entrada
 * ('player1' = quem criou/entrou primeiro, ver Room.addPlayer) -- nao
 * existe (nem foi criado aqui) nenhum conceito adicional de "dono da
 * sala"/host separado disso. `player1` e a menor regra compativel com
 * essa arquitetura ja existente (mesmo "primeiro a entrar" que decide
 * o slot): se player1 tiver selecionado uma musica, essa e a musica
 * usada, mesmo que player2 tenha escolhido outra. Se so player2 tiver
 * selecionado, usa a de player2. Se nenhum dos dois selecionou nada,
 * `resolveSelectedMusicId` devolve `null` -- o chamador (matchFlow)
 * cai no `DEFAULT_MUSIC_ID`, exatamente como antes desta etapa.
 * Deterministica, testavel e igual nos dois clientes porque e
 * calculada UMA vez, aqui, no servidor -- nunca no cliente.
 */
const RoomManager = require('../rooms/RoomManager');
const MatchManager = require('../match/MatchManager');
const { MATCH_STATE } = require('../match/Match');
const musicCatalog = require('./musicCatalog');
const { sendError, broadcastToRoom } = require('../ws/broadcast');

// Map<roomCode, { player1: string|null, player2: string|null }>
const pendingSelections = new Map();

function getState(roomCode) {
  return pendingSelections.get(roomCode) || null;
}

function getOrCreateState(roomCode) {
  let state = pendingSelections.get(roomCode);
  if (!state) {
    state = { player1: null, player2: null };
    pendingSelections.set(roomCode, state);
  }
  return state;
}

/**
 * Campos PUBLICOS de uma musica, para a lista de selecao do cliente.
 * Nunca inclui `sequenceId` (detalhe interno de geracao de sequencia,
 * sem nenhuma utilidade para o jogador escolher uma musica) nem
 * qualquer outro campo que o musicCatalog venha a ganhar no futuro e
 * que nao seja necessario para a selecao.
 *
 * @returns {Array<{id: string, title: string, artist: string, bpm: number, durationMs: number, difficulty: string}>}
 */
function getPublicCatalog() {
  return musicCatalog.getAllMusics().map(({ id, title, artist, bpm, durationMs, difficulty }) => ({
    id,
    title,
    artist,
    bpm,
    durationMs,
    difficulty,
  }));
}

/**
 * Resolve, de forma deterministica, qual musicId deve ser usado na
 * PROXIMA Match desta sala, a partir do que os jogadores selecionaram
 * ate agora (ver regra no cabecalho deste arquivo).
 *
 * @param {string} roomCode
 * @returns {string|null} o musicId a usar, ou `null` se ninguem
 *   selecionou nada (o chamador deve cair em DEFAULT_MUSIC_ID/na
 *   musica da partida anterior, conforme o fluxo).
 */
function resolveSelectedMusicId(roomCode) {
  const state = getState(roomCode);
  if (!state) return null;
  if (state.player1) return state.player1;
  if (state.player2) return state.player2;
  return null;
}

/**
 * Remove QUALQUER selecao pendente desta sala (usado depois que a
 * proxima Match ja foi criada consumindo essa selecao, ou quando a
 * sala deixa de existir). Nunca deve ser chamado antes da Match ser
 * efetivamente criada -- ver messageRouter.js/rematchFlow.js.
 */
function clearRoomSelection(roomCode) {
  pendingSelections.delete(roomCode);
}

/**
 * Remove apenas a selecao de UM slot (usado quando aquele jogador sai
 * da sala/desconecta, para nunca "prender" uma selecao antiga -- ver
 * leaveRoomFlow.js/connectionHandler.js). Se depois disso nao sobrar
 * nenhuma selecao para a sala, a entrada inteira e removida.
 */
function clearPlayerSelection(roomCode, slot) {
  const state = getState(roomCode);
  if (!state) return;
  state[slot] = null;
  if (!state.player1 && !state.player2) {
    pendingSelections.delete(roomCode);
  }
}

/**
 * type: 'select_music', musicId: string
 *
 * Validacao (nesta ordem -- a primeira que falhar rejeita a mensagem
 * inteira, sem registrar nada):
 * 1. o jogador pertence a uma sala (`ws.roomCode`/`ws.slot`);
 * 2. a sala existe;
 * 3. a conexao realmente ocupa aquele slot naquela sala agora (mesma
 *    checagem defensiva ja usada por leaveRoomFlow.js);
 * 4. a partida (se existir) nao esta em PLAYING;
 * 5. a partida (se existir) nao esta em COUNTDOWN;
 * 6. `musicId` e uma string nao vazia;
 * 7. a musica existe no musicCatalog.
 *
 * SEGURANCA: nunca confia em nenhum roomCode/slot vindo do cliente --
 * a mensagem esperada carrega SOMENTE `musicId` (ver payload no
 * enunciado da etapa); a sala/slot usados sao sempre `ws.roomCode`/
 * `ws.slot`, exatamente como leaveRoomFlow.js/matchFlow.js ja fazem.
 *
 * @param {object} ws
 * @param {{musicId?: unknown}} message
 */
function handleSelectMusic(ws, message) {
  const { roomCode, slot } = ws;
  if (!roomCode || !slot) {
    return sendError(ws, 'Voce precisa estar em uma sala para selecionar uma musica.');
  }

  const room = RoomManager.getRoom(roomCode);
  if (!room) {
    return sendError(ws, 'Sala nao existe mais.');
  }

  if (room.players[slot] !== ws) {
    return sendError(ws, 'Voce nao pertence mais a essa sala.');
  }

  const match = MatchManager.getMatch(roomCode);
  if (match && match.state === MATCH_STATE.PLAYING) {
    return sendError(ws, 'Nao e possivel selecionar musica com a partida em andamento.');
  }
  if (match && match.state === MATCH_STATE.COUNTDOWN) {
    return sendError(ws, 'Nao e possivel selecionar musica depois que a contagem regressiva comecou.');
  }
  // Etapa 11: mesma protecao, agora tambem para READY -- a Match ja foi
  // criada (musicId/music/seed/noteSequence ja resolvidos e enviados em
  // `match_ready`) e so ainda nao come\u00e7ou o countdown. Na pratica esse
  // estado dura 0ms (matchFlow.startMatchFlow chama scheduleCountdown
  // de forma sincrona logo em seguida, sem nenhum I/O no meio, entao
  // nenhuma mensagem de rede consegue ser processada enquanto a Match
  // esta em READY). Mesmo assim, a configuracao "fonte de verdade" da
  // partida (ver Match.js) ja existe nesse momento -- permitir uma
  // selecao aqui violaria a regra de que nada pode alterar a Match
  // depois de criada, entao a checagem fica explicita tambem para este
  // estado, por seguranca/defesa em profundidade (ex: se uma proxima
  // etapa introduzir algum passo assincrono entre READY e COUNTDOWN).
  if (match && match.state === MATCH_STATE.READY) {
    return sendError(ws, 'Nao e possivel selecionar musica: a partida ja foi criada.');
  }

  const musicId = typeof message.musicId === 'string' ? message.musicId.trim() : '';
  if (!musicId) {
    return sendError(ws, 'musicId invalido.');
  }
  if (!musicCatalog.musicExists(musicId)) {
    return sendError(ws, `Musica "${musicId}" nao existe no catalogo.`);
  }

  const state = getOrCreateState(roomCode);
  state[slot] = musicId;

  // Confirma para os dois jogadores da sala (payload minimo: nenhum
  // estado interno do servidor, so a selecao atual de cada slot) --
  // e o que permite ao cliente "reagir a confirmacao do servidor"
  // (ver client/js/music/musicSelectionController.js).
  broadcastToRoom(room, {
    type: 'music_selected',
    slot,
    musicId,
    selection: { player1: state.player1, player2: state.player2 },
  });
}

module.exports = {
  getPublicCatalog,
  resolveSelectedMusicId,
  clearRoomSelection,
  clearPlayerSelection,
  handleSelectMusic,
  // Exportado para testes: permite inspecionar o estado bruto sem
  // expor o Map interno diretamente.
  getSelectionState: getState,
};
