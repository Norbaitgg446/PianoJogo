/**
 * Controlador do lado CLIENTE do abandono de partida (Etapa 8B).
 *
 * O SERVIDOR (Etapa 8A, `server/match/matchAbandonment.js`) e a UNICA
 * autoridade sobre quando uma partida foi abandonada: ele ja detecta a
 * desconexao durante `PLAYING`, muda a Match para `FINISHED` e envia
 * `match_abandoned` (`{ type, abandonedBy }`) para quem ficou. Este
 * modulo NAO decide nada disso de novo -- so trata, do lado do cliente,
 * o que fazer quando essa mensagem chega:
 *
 * - valida o payload recebido (nunca confia cegamente nele -- ver
 *   `isValidPayload`);
 * - decide se o abandono e do OPONENTE ou (por alguma inconsistencia)
 *   do proprio jogador local, sem tratar os dois casos como erro fatal;
 * - garante que o mesmo abandono so e processado UMA vez por partida
 *   (protege contra o evento chegar duplicado, ex: 'close' e 'error'
 *   disparando os dois do lado do servidor).
 *
 * Este modulo NAO sabe nada sobre DOM, WebSocket, NoteRenderer,
 * InputController, FeedbackRenderer, MatchTimelineManager ou
 * UIController -- mesmo padrao ja usado por rematchController.js: quem
 * usa este modulo (main.js) injeta, via `onAbandonment`, o que deve
 * acontecer de verdade (parar loops, desligar input, mostrar mensagem
 * etc.), reaproveitando as funcoes ja existentes desses modulos. Isso
 * mantem a validacao/idempotencia 100% testavel em Node puro, isolada
 * do resto do ciclo de vida da partida.
 */
const MatchAbandonmentController = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;

  const VALID_SLOTS = ['player1', 'player2'];

  /**
   * Um payload de `match_abandoned` so e considerado valido se:
   * - a mensagem existir e for do tipo esperado;
   * - `abandonedBy` for um slot conhecido ('player1' | 'player2');
   * - o cliente souber o proprio slot no momento (`currentSlot`), ou
   *   seja, ja exista uma sala/partida local a que isso possa se
   *   referir.
   *
   * Qualquer outra coisa (mensagem nula, tipo errado, slot
   * desconhecido/ausente, cliente sem slot ainda) e tratada como
   * payload invalido -- nunca lancamos excecao, apenas devolvemos
   * `false` para quem chamar decidir ignorar com seguranca.
   *
   * @param {{type?: string, abandonedBy?: string}} message
   * @param {string|null} currentSlot
   * @returns {boolean}
   */
  function isValidPayload(message, currentSlot) {
    if (!message || message.type !== 'match_abandoned') return false;
    if (!VALID_SLOTS.includes(message.abandonedBy)) return false;
    if (!VALID_SLOTS.includes(currentSlot)) return false;
    return true;
  }

  /**
   * @param {{
   *   onAbandonment?: (info: {abandonedBy: string, isLocalPlayer: boolean}) => void,
   * }} deps
   */
  function createAbandonmentController(deps = {}) {
    const { onAbandonment } = deps;

    // Se o abandono da partida ATUAL ja foi processado. Reseta para
    // `false` sempre que uma partida nova de verdade comeca (ver
    // `reset`, chamado por main.js no mesmo lugar/momento em que
    // rematchController.reset() e MatchResult.clearResult() ja sao
    // chamados) -- assim um evento duplicado da MESMA partida nunca
    // dispara `onAbandonment` duas vezes, mas a PROXIMA partida comeca
    // livre para tratar o proprio abandono normalmente.
    let handled = false;

    /**
     * Processa uma mensagem `match_abandoned` recebida da rede.
     *
     * Idempotente: a primeira chamada valida com sucesso processa o
     * abandono e marca esta partida como tratada; qualquer chamada
     * seguinte (mesmo com um payload valido) e ignorada em silencio.
     *
     * @param {{type?: string, abandonedBy?: string}} message
     * @param {string|null} currentSlot - slot do jogador LOCAL neste
     *   cliente (ex: `currentSlot` de main.js).
     * @returns {boolean} true se o abandono foi processado agora
     *   (primeira vez, payload valido); false em qualquer outro caso.
     */
    function handleEvent(message, currentSlot) {
      if (handled) return false;
      if (!isValidPayload(message, currentSlot)) return false;

      handled = true;

      const isLocalPlayer = message.abandonedBy === currentSlot;
      if (typeof onAbandonment === 'function') {
        onAbandonment({ abandonedBy: message.abandonedBy, isLocalPlayer });
      }

      return true;
    }

    function hasHandled() {
      return handled;
    }

    /**
     * Devolve este controlador ao estado inicial. Chamado quando uma
     * partida nova de verdade comeca (mesmo ponto de `startMatchGameplay`
     * em que `rematchController.reset()` ja e chamado) -- nunca dentro
     * do fluxo de abandono em si.
     */
    function reset() {
      handled = false;
    }

    return { handleEvent, hasHandled, reset };
  }

  const api = { isValidPayload, createAbandonmentController, VALID_SLOTS };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
