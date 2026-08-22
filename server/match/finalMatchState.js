/**
 * Snapshot final da partida (Etapa 6B).
 *
 * Responsabilidade unica: guardar, uma UNICA vez por partida, uma copia
 * congelada do resultado dos dois jogadores no exato momento em que a
 * partida termina -- para que a proxima etapa (comparacao/vencedor/
 * empate) tenha um resultado final ESTAVEL para consultar, mesmo que
 * `match.players` continue existindo (ou, em tese, mudando) depois disso.
 *
 * Este modulo NAO:
 * - recalcula nada -- usa exclusivamente
 *   matchResultState.getMatchResultState(match), criado na Etapa 6A, que
 *   ja projeta (copia por valor) os campos de match.players.player1 e
 *   match.players.player2;
 * - duplica PlayerState nem cria uma segunda estrutura paralela de
 *   score -- so armazena o snapshot ja produzido pela Etapa 6A;
 * - compara os dois jogadores, decide vencedor/perdedor/empate, envia
 *   nada por WebSocket, nem mexe em DOM/UI;
 * - altera GameplayEngine, MatchResult (cliente), o sistema de
 *   revanche, o countdown ou a seed/timeline da partida.
 *
 * ARMAZENAMENTO: o snapshot fica associado a instancia da Match (nao a
 * roomCode), guardado em uma WeakMap privada deste modulo. Isso e
 * proposital:
 * - nao exige alterar server/match/Match.js;
 * - cada partida NOVA (ex: uma revanche, que sempre cria uma instancia
 *   `new Match(...)` nova -- ver server/match/matchFlow.js e
 *   server/match/rematchFlow.js, nenhum dos dois alterado aqui) nunca
 *   tem entrada nesta WeakMap, entao comeca automaticamente sem nenhum
 *   resultado final anterior "vazado" -- sem precisar chamar nenhuma
 *   funcao de limpeza manualmente a cada revanche;
 * - quando a Match antiga deixa de ser referenciada em qualquer outro
 *   lugar (ex: MatchManager.removeMatch), a entrada correspondente desta
 *   WeakMap tambem se torna elegivel para coleta de lixo sozinha.
 *
 * IMUTABILIDADE: o snapshot devolvido por captureFinalMatchState /
 * getFinalMatchState e congelado (Object.freeze, em cada jogador e no
 * objeto que os agrupa) e feito de copias independentes -- mutar o
 * objeto devolvido nao tem efeito nenhum sobre o snapshot guardado, e
 * mudancas futuras em match.players tambem nao afetam mais o snapshot
 * ja capturado.
 */
const { MATCH_STATE } = require('./Match');
const { getMatchResultState } = require('./matchResultState');

// match (instancia) -> snapshot final congelado. Privado deste modulo:
// ninguem fora daqui deve ler/escrever isso diretamente.
const finalStates = new WeakMap();

/**
 * Congela profundamente (mas apenas nos dois niveis que interessam aqui:
 * o objeto agrupador e cada jogador) uma copia do snapshot devolvido por
 * getMatchResultState, garantindo que nem o snapshot guardado nem o que
 * for devolvido a quem chamar possam ser mutados por engano.
 */
function freezeSnapshot(rawState) {
  const player1 = rawState.player1 ? Object.freeze({ ...rawState.player1 }) : null;
  const player2 = rawState.player2 ? Object.freeze({ ...rawState.player2 }) : null;
  return Object.freeze({ player1, player2 });
}

/**
 * Captura o snapshot final dos dois jogadores para esta Match e o
 * guarda como o resultado definitivo dela.
 *
 * Regras:
 * - uma partida ainda em PLAYING nunca e considerada finalizada -- a
 *   captura e recusada (devolve null, nada e guardado). Quem decide
 *   *quando* a partida realmente terminou e responsabilidade de outra
 *   camada (ex: matchFlow.finishMatch, que muda match.state para
 *   MATCH_STATE.FINISHED antes de chamar esta funcao) -- este modulo so
 *   se recusa a tratar uma partida em andamento como encerrada;
 * - o snapshot so e criado UMA VEZ por partida: se ja existir um
 *   snapshot guardado para esta Match, chamadas seguintes NAO o
 *   substituem -- apenas devolvem o mesmo snapshot ja capturado
 *   (idempotente, seguro de chamar mais de uma vez, ex: se o fluxo de
 *   finalizacao disparar duas vezes por qualquer motivo).
 *
 * @param {import('./Match').Match} match
 * @returns {{player1: object|null, player2: object|null}|null} o
 *   snapshot final (recem-capturado ou o que ja existia), ou `null` se
 *   a match for invalida ou ainda estiver em PLAYING.
 */
function captureFinalMatchState(match) {
  if (!match) return null;

  if (finalStates.has(match)) {
    // Ja existe um resultado final para esta partida: nunca sobrescrever.
    return finalStates.get(match);
  }

  if (match.state === MATCH_STATE.PLAYING) {
    // Partida ainda em andamento: nao pode ser tratada como finalizada.
    return null;
  }

  const snapshot = freezeSnapshot(getMatchResultState(match));
  finalStates.set(match, snapshot);
  return snapshot;
}

/**
 * Devolve o snapshot final ja capturado para esta Match, ou `null` se
 * ainda nao houver nenhum (partida ainda em andamento, ou
 * captureFinalMatchState nunca foi chamada/foi recusada).
 *
 * @param {import('./Match').Match} match
 * @returns {{player1: object|null, player2: object|null}|null}
 */
function getFinalMatchState(match) {
  if (!match) return null;
  return finalStates.get(match) || null;
}

/**
 * Se ja existe um snapshot final capturado para esta Match.
 *
 * @param {import('./Match').Match} match
 * @returns {boolean}
 */
function hasFinalMatchState(match) {
  return Boolean(match) && finalStates.has(match);
}

/**
 * Descarta o snapshot final guardado para esta Match, se houver.
 *
 * Nao e necessario chamar isso no fluxo normal de revanche -- cada nova
 * partida ja e uma instancia de Match nova, que nunca tem entrada nesta
 * WeakMap (ver nota de ARMAZENAMENTO acima). Esta funcao fica disponivel
 * para quem precisar limpar explicitamente o resultado de uma Match
 * especifica (ex: cancelamento manual, testes).
 *
 * @param {import('./Match').Match} match
 */
function clearFinalMatchState(match) {
  if (!match) return;
  finalStates.delete(match);
}

module.exports = {
  captureFinalMatchState,
  getFinalMatchState,
  hasFinalMatchState,
  clearFinalMatchState,
};
