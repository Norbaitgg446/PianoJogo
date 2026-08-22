/**
 * Abandono / desconexao DURANTE uma partida em andamento (Etapa 8A).
 *
 * Responsabilidade unica: quando um jogador desconecta enquanto a Match da
 * sala esta em MATCH_STATE.PLAYING, encerrar aquela partida de forma
 * segura e avisar o jogador que permaneceu conectado.
 *
 * Este modulo NAO:
 * - decide vencedor/perdedor por abandono, nem calcula recompensa, XP,
 *   ranking ou estatisticas -- isso fica para uma proxima etapa. Por isso
 *   NAO reutiliza matchFlow.finishMatch()/matchOutcome aqui: finishMatch
 *   sempre delega a matchOutcome.captureFinalOutcome, que compara SCORE e
 *   produz um vencedor/perdedor "normal" (e dispara `match_result`) --
 *   exatamente o que esta etapa foi instruida a NAO fazer ainda. O que
 *   este modulo reutiliza de fato e o que ja existe para representar
 *   "partida encerrada": o proprio enum MATCH_STATE e Match#setState;
 * - trata desconexao durante WAITING_FOR_PLAYER, READY ou COUNTDOWN --
 *   esses casos continuam send do connectionHandler.js/matchFlow.js
 *   (matchFlow.cancelMatch), sem nenhuma mudanca aqui;
 * - decide o que fazer com a Room (isEmpty/deleteRoom) nem com o
 *   handshake de revanche -- isso continua em connectionHandler.js;
 * - sabe nada sobre gameplayFlow.js: `note_hit`/`note_miss` param de
 *   afetar o estado oficial simplesmente porque getPlayingMatch() (em
 *   gameplayFlow.js) exige match.state === PLAYING, e este modulo tira a
 *   Match desse estado -- nenhuma alteracao foi necessaria la.
 *
 * IDEMPOTENCIA: qual jogador abandonou (e se esta Match ja foi tratada
 * como abandonada) fica guardado em uma WeakMap privada, associada a
 * INSTANCIA da Match -- mesmo padrao ja usado por finalMatchState.js e
 * matchOutcome.js. Isso garante, sem precisar de nenhuma limpeza manual:
 * - chamar handleAbandonment mais de uma vez para a MESMA Match (ex:
 *   'close' e 'error' disparando os dois, ou qualquer outra chamada
 *   redundante) so processa/envia o evento da PRIMEIRA vez;
 * - uma Match NOVA (ex: revanche, que sempre cria `new Match(...)`) nunca
 *   tem entrada nesta WeakMap, entao nunca "herda" abandono de uma
 *   partida anterior da mesma sala.
 */
const { MATCH_STATE } = require('./Match');
const { send } = require('../ws/broadcast');

// match (instancia) -> { abandonedBy: 'player1'|'player2' }. Privado deste
// modulo: ninguem fora daqui deve ler/escrever isso diretamente.
const abandonedMatches = new WeakMap();

/**
 * Se esta Match ja foi marcada como abandonada.
 *
 * @param {import('./Match').Match} match
 * @returns {boolean}
 */
function hasAbandonment(match) {
  return Boolean(match) && abandonedMatches.has(match);
}

/**
 * Devolve as informacoes de abandono ja guardadas para esta Match, ou
 * `null` se ela nunca foi tratada como abandonada.
 *
 * @param {import('./Match').Match} match
 * @returns {{abandonedBy: 'player1'|'player2'}|null}
 */
function getAbandonmentInfo(match) {
  if (!match) return null;
  return abandonedMatches.get(match) || null;
}

/**
 * Trata o abandono de `slot` na Match de `room`, quando (e somente
 * quando) a partida estiver em PLAYING no momento da desconexao.
 *
 * Regras:
 * - se `match` for invalido, ou nao estiver em PLAYING, nada acontece
 *   (quem decide SE deve chamar esta funcao continua sendo
 *   connectionHandler.js, mas a checagem tambem e feita aqui de novo,
 *   para este modulo nunca depender cegamente do chamador);
 * - se esta Match ja tiver sido marcada como abandonada antes, a chamada
 *   e ignorada (idempotente) -- nenhum segundo `match_abandoned` e
 *   enviado, e o estado ja esta fora de PLAYING de qualquer forma;
 * - a partida sai de PLAYING (reutilizando MATCH_STATE.FINISHED e
 *   Match#setState, sem inventar um estado novo) ANTES de qualquer
 *   outra coisa, para que nenhum `note_hit`/`note_miss` que chegue logo
 *   em seguida consiga alterar o estado oficial (gameplayFlow.js ja
 *   exige PLAYING, entao isso basta);
 * - qualquer timer de countdown pendente desta Match e cancelado
 *   (defensivo -- normalmente ja nao existe mais nesse ponto, ja que a
 *   partida esta em PLAYING);
 * - o jogador que permaneceu conectado (oponente de `slot` NESTA sala)
 *   recebe um evento `match_abandoned` com o minimo necessario: que a
 *   partida acabou por abandono e quem abandonou.
 *
 * @param {import('../rooms/Room').Room} room
 * @param {import('./Match').Match|null} match
 * @param {'player1'|'player2'} slot
 * @returns {boolean} true se o abandono foi processado agora (primeira vez)
 */
function handleAbandonment(room, match, slot) {
  if (!room || !match) return false;
  if (match.state !== MATCH_STATE.PLAYING) return false;

  if (hasAbandonment(match)) {
    // Ja tratado (ex: 'close' e 'error' disparando os dois para a mesma
    // conexao): nunca reprocessar nem reenviar o evento.
    return false;
  }

  abandonedMatches.set(match, { abandonedBy: slot });

  match.clearCountdownTimer();
  match.setState(MATCH_STATE.FINISHED);

  const opponent = room.getOpponentConnection(slot);
  send(opponent, {
    type: 'match_abandoned',
    abandonedBy: slot,
  });

  return true;
}

module.exports = { handleAbandonment, hasAbandonment, getAbandonmentInfo };
