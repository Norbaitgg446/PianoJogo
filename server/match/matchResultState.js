/**
 * Estado de resultado multiplayer (Etapa 6A).
 *
 * Responsabilidade unica: expor, de forma isolada e somente-leitura, o
 * estado atual de CADA jogador (player1 e player2) de uma Match, no
 * formato que a proxima etapa (comparacao/vencedor/empate) vai consumir.
 *
 * Este modulo NAO:
 * - cria nenhum estado novo -- le exclusivamente match.players.player1 /
 *   match.players.player2, que ja existem em server/match/Match.js desde
 *   a etapa de sincronizacao da partida e ja sao mantidos/atualizados por
 *   server/match/gameplayFlow.js durante o jogo;
 * - duplica PlayerState (client) nem recria os campos -- apenas projeta
 *   (copia por valor) os mesmos campos ja existentes: score, combo,
 *   maxCombo, hits, misses, mistakes;
 * - compara os dois jogadores entre si;
 * - decide vencedor, perdedor ou empate;
 * - altera GameplayEngine, julgamento, pontuacao, combo, sincronizacao
 *   da partida ou o fluxo de revanche;
 * - sabe nada sobre WebSocket, mensagens ou broadcast -- e um modulo
 *   puro, testavel em isolamento, que so olha para uma Match.
 *
 * USO FUTURO: a proxima etapa (comparacao final / vencedor / empate) deve
 * chamar getMatchResultState(match) para obter os dois estados prontos
 * para comparar, em vez de acessar match.players diretamente ou
 * reimplementar essa leitura.
 */

// Mesma lista de campos usada por PlayerState (client) e por
// Match._createEmptyPlayerMatchState (server) -- mantida aqui em UM
// lugar so para a projecao, sem redefinir nenhum valor padrao novo.
const RESULT_FIELDS = ['score', 'combo', 'maxCombo', 'hits', 'misses', 'mistakes'];

/**
 * Projeta (copia por valor) o estado de UM jogador de uma Match para um
 * objeto simples com apenas os campos de resultado. Nao mexe no objeto
 * original (match.players[slot]) nem guarda referencia a ele.
 *
 * @param {import('./Match').Match} match
 * @param {'player1'|'player2'} slot
 * @returns {{score:number,combo:number,maxCombo:number,hits:number,misses:number,mistakes:number}|null}
 *   `null` se a match ou o slot forem invalidos (ex: match ainda nao
 *   inicializada, slot desconhecido).
 */
function getPlayerResultState(match, slot) {
  const playerState = match && match.players && match.players[slot];
  if (!playerState) return null;

  const snapshot = {};
  for (const field of RESULT_FIELDS) {
    snapshot[field] = playerState[field];
  }
  return snapshot;
}

/**
 * Projeta o estado dos DOIS jogadores de uma Match de uma so vez.
 * Cada lado e isolado (objetos distintos, sem referencia compartilhada);
 * atualizar o snapshot devolvido aqui nunca afeta match.players nem o
 * snapshot do outro jogador.
 *
 * NAO compara os dois estados nem calcula nada a partir deles -- apenas
 * os agrupa para a proxima etapa consumir.
 *
 * @param {import('./Match').Match} match
 * @returns {{player1: object|null, player2: object|null}}
 */
function getMatchResultState(match) {
  return {
    player1: getPlayerResultState(match, 'player1'),
    player2: getPlayerResultState(match, 'player2'),
  };
}

module.exports = { RESULT_FIELDS, getPlayerResultState, getMatchResultState };
