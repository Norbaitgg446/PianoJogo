/**
 * Estado oficial de partida por jogador (Etapa 7A).
 *
 * Responsabilidade unica: preparar/organizar a estrutura de estado que o
 * servidor ja mantem, por jogador, dentro de `match.players.player1` /
 * `match.players.player2` (definida em server/match/Match.js desde a
 * etapa de sincronizacao e ja atualizada por
 * server/match/gameplayFlow.js durante o jogo).
 *
 * Este modulo NAO:
 * - cria um segundo PlayerState paralelo -- so opera em cima de
 *   match.players.player1 / match.players.player2, que ja existem;
 * - reimplementa a leitura/projecao (snapshot) do estado -- reutiliza
 *   server/match/matchResultState.js (Etapa 6A), que ja faz exatamente
 *   isso (copia por valor, isolada por jogador). getPlayerMatchState
 *   aqui e apenas o nome que a Etapa 7A pediu para essa mesma operacao;
 * - duplica a logica de pontuacao/julgamento de
 *   server/match/gameplayFlow.js -- esse fluxo continua sendo o unico
 *   lugar que decide COMO score/combo/hits/misses mudam durante o
 *   gameplay. Este modulo so oferece uma forma segura e centralizada de
 *   criar, resetar e (quando necessario) aplicar atualizacoes ao estado
 *   guardado na Match, alem do snapshot;
 * - decide vencedor, empate ou resultado final (isso e de
 *   server/match/matchOutcome.js / server/match/finalMatchState.js);
 * - sabe nada sobre WebSocket, broadcast ou mensagens -- e um modulo
 *   puro, testavel em isolamento, que so olha para uma Match.
 */
const { RESULT_FIELDS, getPlayerResultState } = require('./matchResultState');

const VALID_SLOTS = ['player1', 'player2'];

function isValidSlot(slot) {
  return VALID_SLOTS.includes(slot);
}

/**
 * Estado inicial (zerado) de um jogador para uma partida nova.
 * Usa a mesma lista de campos que server/match/matchResultState.js
 * (RESULT_FIELDS), para nao definir uma segunda lista de campos em
 * paralelo.
 *
 * @returns {{score:number,combo:number,maxCombo:number,hits:number,misses:number,mistakes:number}}
 */
function createInitialPlayerMatchState() {
  const state = {};
  for (const field of RESULT_FIELDS) {
    state[field] = 0;
  }
  return state;
}

/**
 * Acesso interno (NAO seguro/mutavel) ao estado bruto de um jogador
 * dentro de uma Match. Usado apenas pelas funcoes deste modulo que
 * precisam realmente escrever no estado (reset/update) -- nunca
 * devolvido diretamente a quem chama de fora.
 */
function getRawPlayerState(match, slot) {
  if (!match || !match.players || !isValidSlot(slot)) return null;
  return match.players[slot] || null;
}

/**
 * Reseta o estado oficial de UM jogador para os valores zerados.
 * Nao afeta o outro jogador nem qualquer outro campo da Match (ex:
 * `life`, reservado para outra etapa).
 *
 * Slot invalido ou Match invalida: nao faz nada e devolve `false`
 * (nunca lanca excecao).
 *
 * @param {import('./Match').Match} match
 * @param {'player1'|'player2'} slot
 * @returns {boolean} true se o reset foi aplicado
 */
function resetPlayerMatchState(match, slot) {
  const playerState = getRawPlayerState(match, slot);
  if (!playerState) return false;

  const initial = createInitialPlayerMatchState();
  for (const field of RESULT_FIELDS) {
    playerState[field] = initial[field];
  }
  return true;
}

/**
 * Reseta o estado oficial dos DOIS jogadores de uma Match.
 * Util, por exemplo, para garantir explicitamente que uma partida
 * comeca zerada (na pratica isso ja acontece sozinho, porque
 * `new Match(...)` sempre cria o estado zerado -- ver Match.js -- mas
 * esta funcao fica disponivel para quem precisar reforcar/repetir esse
 * reset em uma Match ja existente, ex: em testes).
 *
 * @param {import('./Match').Match} match
 */
function resetAllPlayersMatchState(match) {
  VALID_SLOTS.forEach((slot) => resetPlayerMatchState(match, slot));
}

/**
 * Aplica atualizacoes pontuais ao estado oficial de UM jogador dentro
 * da Match. Pensada para uso interno/pontual (ex: reforcar um campo),
 * NAO para substituir a logica de gameplay ja existente em
 * server/match/gameplayFlow.js, que continua sendo quem decide como
 * hits/misses/combo/score mudam a cada evento de jogo.
 *
 * Regras aplicadas aqui (sempre, independente do que for passado em
 * `updates`):
 * - apenas os campos oficiais (RESULT_FIELDS) podem ser alterados;
 * - valores nao numericos/nao finitos sao ignorados (o campo mantem o
 *   valor anterior);
 * - `maxCombo` nunca diminui: se o `combo` resultante for maior que o
 *   `maxCombo` atual, `maxCombo` e elevado para acompanhar.
 *
 * Slot invalido ou Match invalida: nao faz nada e devolve `false`.
 *
 * @param {import('./Match').Match} match
 * @param {'player1'|'player2'} slot
 * @param {Partial<{score:number,combo:number,maxCombo:number,hits:number,misses:number,mistakes:number}>} updates
 * @returns {boolean} true se alguma atualizacao foi processada (a Match/slot eram validos)
 */
function updatePlayerMatchState(match, slot, updates) {
  const playerState = getRawPlayerState(match, slot);
  if (!playerState || !updates || typeof updates !== 'object') return false;

  for (const field of RESULT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(updates, field) && Number.isFinite(updates[field])) {
      playerState[field] = updates[field];
    }
  }

  // maxCombo nunca deve diminuir durante a mesma partida.
  if (playerState.combo > playerState.maxCombo) {
    playerState.maxCombo = playerState.combo;
  }

  return true;
}

/**
 * Snapshot seguro (copia por valor) do estado oficial de UM jogador.
 * Alterar o objeto devolvido aqui NUNCA altera match.players[slot].
 *
 * Reutiliza server/match/matchResultState.js (Etapa 6A) em vez de
 * reimplementar a projecao/copia -- mesma fonte de verdade, apenas com
 * o nome que esta etapa usa para a operacao de snapshot.
 *
 * @param {import('./Match').Match} match
 * @param {'player1'|'player2'} slot
 * @returns {{score:number,combo:number,maxCombo:number,hits:number,misses:number,mistakes:number}|null}
 */
function getPlayerMatchState(match, slot) {
  return getPlayerResultState(match, slot);
}

module.exports = {
  VALID_SLOTS,
  createInitialPlayerMatchState,
  resetPlayerMatchState,
  resetAllPlayersMatchState,
  updatePlayerMatchState,
  getPlayerMatchState,
};
