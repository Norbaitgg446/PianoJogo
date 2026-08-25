const MatchManager = require('./MatchManager');
const { MATCH_STATE } = require('./Match');
const matchFlow = require('./matchFlow');
const musicSelectionFlow = require('../music/musicSelectionFlow');
const matchDurationSelectionFlow = require('./matchDurationSelectionFlow');
const { broadcastToRoom, sendError } = require('../ws/broadcast');

/**
 * Fluxo de revanche (Etapa 5B-5A, Parte 1 - servidor).
 *
 * Depois que uma partida termina, os dois jogadores podem pedir revanche
 * dentro da MESMA sala. Este modulo controla apenas o "handshake" de
 * prontidao (ready/ready) e delega a criacao da nova partida para o
 * fluxo ja existente (matchFlow.startMatchFlow), que ja cuida de:
 * - gerar nova seed;
 * - gerar novo startTimestamp;
 * - agendar o countdown sincronizado;
 * - transicionar READY -> COUNTDOWN -> PLAYING.
 *
 * Nao duplica nenhuma dessas responsabilidades aqui.
 *
 * Estado guardado em memoria (Map<roomCode, RematchState>). So existe uma
 * entrada para uma sala enquanto houver uma revanche sendo negociada; assim
 * que a nova partida comeca (ou a revanche e cancelada), a entrada e
 * removida -- isso e o que garante que nao seja possivel iniciar duas
 * revanches simultaneas para a mesma sala nem criar duas partidas novas
 * para o mesmo handshake (operacao idempotente).
 */

function createEmptyState() {
  return {
    player1: false,
    player2: false,
  };
}

class RematchManager {
  constructor() {
    this.states = new Map();
  }

  getState(roomCode) {
    return this.states.get(roomCode) || null;
  }

  getOrCreateState(roomCode) {
    let state = this.states.get(roomCode);
    if (!state) {
      state = createEmptyState();
      this.states.set(roomCode, state);
    }
    return state;
  }

  isPending(roomCode) {
    return this.states.has(roomCode);
  }

  clear(roomCode) {
    this.states.delete(roomCode);
  }
}

// Singleton, mesmo padrao do RoomManager/MatchManager.
const rematchManager = new RematchManager();

// Estados em que uma partida e considerada "ativa" para os fins da revanche:
// enquanto a partida atual da sala estiver em qualquer um destes estados,
// nenhum pedido de revanche e aceito (isso cobre tanto "ready durante
// PLAYING" quanto o caso de uma revanche que ja disparou uma nova partida
// e ainda esta em READY/COUNTDOWN -- impede um segundo handshake/segunda
// partida para a mesma revanche).
const ACTIVE_MATCH_STATES = new Set([
  MATCH_STATE.READY,
  MATCH_STATE.COUNTDOWN,
  MATCH_STATE.PLAYING,
]);

/**
 * Um jogador pede para entrar no estado de "pronto para revanche".
 *
 * Regras:
 * - so pode pedir revanche se nao houver uma partida em PLAYING nesta sala
 *   (ready durante PLAYING e ignorado);
 * - so pode pedir revanche se o oponente ainda estiver conectado na sala
 *   (nunca criamos uma partida nova com apenas um jogador);
 * - pedidos duplicados do mesmo jogador sao ignorados (idempotente);
 * - quando os dois estiverem prontos, inicia a nova partida usando o
 *   fluxo existente e limpa o estado de revanche desta sala.
 */
function requestRematch(ws, room) {
  const slot = ws.slot;
  if (!slot || !room.players[slot]) {
    return sendError(ws, 'Voce precisa estar em uma sala para pedir revanche.');
  }

  const opponentSlot = room.getOpponentSlot(slot);
  const opponentConnection = room.players[opponentSlot];
  if (!opponentConnection) {
    return sendError(ws, 'Nao e possivel pedir revanche sem um oponente conectado.');
  }

  const currentMatch = MatchManager.getMatch(room.code);
  if (currentMatch && ACTIVE_MATCH_STATES.has(currentMatch.state)) {
    // Ready durante uma partida ativa (READY/COUNTDOWN/PLAYING) e ignorado --
    // isso tambem impede que uma revanche ja iniciada dispare uma segunda
    // partida para o mesmo handshake.
    return sendError(ws, 'Nao e possivel pedir revanche com uma partida em andamento.');
  }

  const state = rematchManager.getOrCreateState(room.code);

  if (state[slot]) {
    // Pedido duplicado do mesmo jogador: ignorado silenciosamente (idempotente).
    return;
  }

  state[slot] = true;

  broadcastToRoom(room, {
    type: 'rematch_player_ready',
    slot,
    ready: { player1: state.player1, player2: state.player2 },
  });

  if (state.player1 && state.player2) {
    startRematch(room);
  }
}

/**
 * Os dois jogadores estao prontos: limpa o estado de negociacao de
 * revanche desta sala (evita disparar duas vezes / revanches simultaneas)
 * e delega a criacao da nova partida ao fluxo ja existente.
 *
 * Etapa 10C: enquanto nao existisse selecao de musica pela interface, a
 * revanche reaproveitava a MESMA musica (musicId) da partida anterior --
 * "mesma musica" nao significa "mesma Match": a nova Match continua
 * sendo uma instancia nova, com seed/timeline/estado novos (ver
 * matchFlow.startMatchFlow), so o musicId requisitado e igual. O
 * musicId e lido da partida anterior ANTES dela ser removida (nunca do
 * catalogo global nem de nenhum estado da sala) -- se por qualquer
 * motivo a partida anterior nao tiver um musicId valido (nao deveria
 * acontecer), `startMatchFlow` cai no `DEFAULT_MUSIC_ID`, exatamente
 * como uma criacao de sala nova faria.
 *
 * Etapa 10D: se os jogadores selecionaram uma NOVA musica (via
 * `select_music`) enquanto aguardavam a revanche -- a partida anterior
 * ja esta FINISHED nesse momento, entao a selecao e permitida pelas
 * mesmas regras de musicSelectionFlow.js -- essa selecao tem
 * prioridade sobre a musica da partida anterior. So integra a nova
 * selecao aqui, sem duplicar nenhuma regra: quem decide QUAL musicId
 * (entre os dois slots) continua sendo exclusivamente
 * `musicSelectionFlow.resolveSelectedMusicId`. Enquanto nao houver
 * nenhuma selecao nova, o comportamento e EXATAMENTE o da Etapa 10C
 * (reaproveita `previousMusicId`).
 */
function startRematch(room) {
  const previousMatch = MatchManager.getMatch(room.code);
  const previousMusicId = previousMatch ? previousMatch.musicId : null;

  const newlySelectedMusicId = musicSelectionFlow.resolveSelectedMusicId(room.code);
  const musicIdForRematch = newlySelectedMusicId || previousMusicId;

  // ETAPA 15C-MP — Parte 1: MESMA regra da musica acima, agora para a
  // duracao -- se os jogadores selecionaram uma NOVA duracao (via
  // `select_duration`) enquanto aguardavam a revanche, ela tem
  // prioridade; senao, a revanche reaproveita a duracao da partida
  // anterior desta sala (nunca a tabela default/nenhuma tabela nova).
  const previousDurationId = previousMatch ? previousMatch.durationId : null;
  const newlySelectedDurationId = matchDurationSelectionFlow.resolveSelectedDuration(room.code);
  const durationIdForRematch = newlySelectedDurationId || previousDurationId;

  // Remove a entrada ANTES de criar a nova partida: assim, mesmo que
  // alguma mensagem redundante chegue nesse meio-tempo, nao ha um estado
  // "pendente" para reagir a ela, e uma segunda revanche so pode comecar
  // a partir de um novo handshake, do zero.
  rematchManager.clear(room.code);

  // Garante que a partida anterior (e qualquer timer associado a ela)
  // seja removida antes de criar a nova, para nao reaproveitar nada dela.
  MatchManager.removeMatch(room.code);

  // Reutiliza o fluxo existente: nova seed, novo startTimestamp, novo
  // countdown sincronizado, transicao READY -> COUNTDOWN -> PLAYING --
  // so o musicId/durationId requisitados mudam (nova selecao, se
  // houver, senao os valores da partida anterior).
  matchFlow.startMatchFlow(room, musicIdForRematch, undefined, durationIdForRematch);

  // A selecao pendente (se havia) ja foi consumida por esta nova
  // Match -- nunca reaproveitada automaticamente por uma proxima
  // revanche sem um novo pedido explicito do jogador.
  musicSelectionFlow.clearRoomSelection(room.code);
  matchDurationSelectionFlow.clearRoomSelection(room.code);
}

/**
 * Cancela uma revanche em negociacao (ex: um dos jogadores desconectou
 * antes dos dois ficarem prontos). Nao mexe em nenhuma partida ja em
 * andamento -- so existe algo a cancelar aqui enquanto o handshake de
 * revanche ainda estiver pendente.
 */
function cancelRematch(room, reason) {
  if (!rematchManager.isPending(room.code)) return;

  rematchManager.clear(room.code);

  broadcastToRoom(room, {
    type: 'rematch_cancelled',
    reason,
  });
}

function isRematchPending(roomCode) {
  return rematchManager.isPending(roomCode);
}

function getRematchState(roomCode) {
  return rematchManager.getState(roomCode);
}

module.exports = {
  requestRematch,
  cancelRematch,
  isRematchPending,
  getRematchState,
};
