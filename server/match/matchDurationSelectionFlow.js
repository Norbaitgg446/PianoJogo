/**
 * Selecao de duracao da partida ANTES do inicio (ETAPA 15C-MP — Parte 1).
 *
 * ORIGEM: ate esta etapa, duracao so existia no Solo/Bot (Etapa 15A-15C1D),
 * inteiramente do lado do CLIENTE -- a variavel de estado do modulo de
 * entrada do cliente (ver client/js/main.js) era resolvida para ms via
 * MatchDuration.resolveMatchDuration e nunca chegava
 * ao servidor, porque Solo/Bot nao precisam sincronizar nada entre dois
 * jogadores. O MULTIPLAYER real precisa: os dois clientes tem que enxergar
 * EXATAMENTE a mesma duracao, entao o servidor passa a ser a autoridade,
 * no MESMO padrao ja usado para musica (server/music/musicSelectionFlow.js).
 *
 * Este modulo NAO:
 * - decide como/quando uma Match e criada -- isso continua sendo
 *   INTEIRAMENTE responsabilidade de matchFlow.js. Este modulo so guarda
 *   uma CONFIGURACAO (qual durationId cada slot pediu para a PROXIMA
 *   Match daquela sala) e resolve, de forma deterministica, qual
 *   durationId usar quando essa proxima Match for de fato criada;
 * - cria nenhuma tabela de duracoes nova -- toda validacao de "duracao
 *   valida" usa exclusivamente ClientConfig.MATCH_DURATION_MS (a MESMA
 *   tabela do cliente, requerida diretamente daqui -- nenhum numero
 *   magico duplicado);
 * - encerra nenhuma partida por tempo -- isso fica para uma proxima
 *   parte da Etapa 15C-MP. Aqui a duracao e apenas transportada;
 * - guarda nenhum estado de PARTIDA (score/combo/seed/timeline) -- a
 *   selecao e so uma preferencia para a proxima Match, nunca carrega
 *   nada da Match atual/anterior;
 * - fica dentro de messageRouter.js: o router so reconhece o tipo da
 *   mensagem (`select_duration`) e delega para `handleSelectDuration` aqui.
 *
 * ESTADO: Map<roomCode, {player1: string|null, player2: string|null}>.
 * Mesmo ciclo de vida de musicSelectionFlow.js: uma entrada so existe
 * enquanto houver pelo menos uma selecao pendente para aquela sala; assim
 * que a Match que vai consumi-la e criada, o chamador limpa a entrada com
 * `clearRoomSelection` (a selecao NUNCA e reusada automaticamente para
 * uma segunda Match sem um novo pedido explicito do jogador).
 *
 * REGRA PARA DOIS JOGADORES (quando escolhem duracoes diferentes): MESMA
 * regra de desempate ja usada para musica -- `player1` tem prioridade. Se
 * so player2 tiver selecionado, usa a de player2. Se nenhum dos dois
 * selecionou nada, `resolveSelectedDuration` devolve `null` -- o chamador
 * (matchFlow) trata como "nenhuma duracao configurada", exatamente o
 * comportamento atual (sem limite de tempo).
 */
const RoomManager = require('../rooms/RoomManager');
const MatchManager = require('./MatchManager');
const { MATCH_STATE } = require('./Match');
const ClientConfig = require('../../client/js/config');
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
 * Verifica se um identificador de duracao e valido, usando
 * EXCLUSIVAMENTE a tabela ja centralizada em ClientConfig.MATCH_DURATION_MS
 * (as unicas opcoes continuam sendo "30S"/"1M"/"5M"/"10M" -- nenhuma
 * tabela nova aqui).
 *
 * @param {unknown} durationId
 * @returns {boolean}
 */
function isValidDurationId(durationId) {
  return (
    typeof durationId === 'string' &&
    Object.prototype.hasOwnProperty.call(ClientConfig.MATCH_DURATION_MS, durationId)
  );
}

/**
 * Resolve, de forma deterministica, qual durationId deve ser usado na
 * PROXIMA Match desta sala, a partir do que os jogadores selecionaram
 * ate agora (ver regra de desempate no cabecalho deste arquivo).
 *
 * @param {string} roomCode
 * @returns {string|null} o durationId a usar, ou `null` se ninguem
 *   selecionou nada validamente (o chamador deve tratar como "sem
 *   duracao configurada").
 */
function resolveSelectedDuration(roomCode) {
  const state = getState(roomCode);
  if (!state) return null;
  if (state.player1) return state.player1;
  if (state.player2) return state.player2;
  return null;
}

/**
 * Remove QUALQUER selecao pendente desta sala (usado depois que a
 * proxima Match ja foi criada consumindo essa selecao, ou quando a sala
 * deixa de existir). Nunca deve ser chamado antes da Match ser
 * efetivamente criada -- ver messageRouter.js/rematchFlow.js.
 */
function clearRoomSelection(roomCode) {
  pendingSelections.delete(roomCode);
}

/**
 * Remove apenas a selecao de UM slot (usado quando aquele jogador sai da
 * sala/desconecta, para nunca "prender" uma selecao antiga -- ver
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
 * type: 'select_duration', durationId: string
 *
 * Validacao (nesta ordem -- a primeira que falhar rejeita a mensagem
 * inteira, sem registrar nada), no MESMO padrao ja usado por
 * musicSelectionFlow.handleSelectMusic:
 * 1. o jogador pertence a uma sala (`ws.roomCode`/`ws.slot`);
 * 2. a sala existe;
 * 3. a conexao realmente ocupa aquele slot naquela sala agora;
 * 4. a partida (se existir) nao esta em PLAYING;
 * 5. a partida (se existir) nao esta em COUNTDOWN;
 * 6. a partida (se existir) nao esta em READY (mesma protecao de
 *    "defesa em profundidade" ja usada para musica);
 * 7. `durationId` e um identificador valido de
 *    ClientConfig.MATCH_DURATION_MS.
 *
 * SEGURANCA: nunca confia em nenhum roomCode/slot vindo do cliente -- a
 * mensagem esperada carrega SOMENTE `durationId`; a sala/slot usados sao
 * sempre `ws.roomCode`/`ws.slot`.
 *
 * @param {object} ws
 * @param {{durationId?: unknown}} message
 */
function handleSelectDuration(ws, message) {
  const { roomCode, slot } = ws;
  if (!roomCode || !slot) {
    return sendError(ws, 'Voce precisa estar em uma sala para selecionar a duracao da partida.');
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
    return sendError(ws, 'Nao e possivel selecionar a duracao com a partida em andamento.');
  }
  if (match && match.state === MATCH_STATE.COUNTDOWN) {
    return sendError(ws, 'Nao e possivel selecionar a duracao depois que a contagem regressiva comecou.');
  }
  if (match && match.state === MATCH_STATE.READY) {
    return sendError(ws, 'Nao e possivel selecionar a duracao: a partida ja foi criada.');
  }

  const durationId = message.durationId;
  if (!isValidDurationId(durationId)) {
    return sendError(ws, `Duracao "${durationId}" invalida.`);
  }

  const state = getOrCreateState(roomCode);
  state[slot] = durationId;

  // Confirma para os dois jogadores da sala (payload minimo: nenhum
  // estado interno do servidor, so a selecao atual de cada slot) --
  // mesmo padrao de `music_selected`.
  broadcastToRoom(room, {
    type: 'duration_selected',
    slot,
    durationId,
    selection: { player1: state.player1, player2: state.player2 },
  });
}

module.exports = {
  isValidDurationId,
  resolveSelectedDuration,
  clearRoomSelection,
  clearPlayerSelection,
  handleSelectDuration,
  // Exportado para testes: permite inspecionar o estado bruto sem expor
  // o Map interno diretamente.
  getSelectionState: getState,
};
