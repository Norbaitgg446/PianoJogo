/**
 * Controlador do lado CLIENTE da saida voluntaria de sala (Etapa 9B).
 *
 * O SERVIDOR (Etapa 9A, `server/room/leaveRoomFlow.js`) e a UNICA
 * autoridade sobre a saida: ele valida se o jogador realmente pertence
 * a sala, remove o jogador, atualiza a sala/match/revanche e responde
 * com `left_room` (confirmacao, so para quem saiu) -- este modulo NAO
 * decide nada disso de novo. Mesmo padrao ja usado por
 * `rematchController.js`/`matchAbandonmentController.js`: um pedaco
 * pequeno, sem DOM/WebSocket, cuja unica responsabilidade e o
 * "handshake" do lado do cliente:
 *
 * - clique -> exatamente UMA mensagem `leave_room` por pedido (cliques
 *   repetidos antes da resposta do servidor sao ignorados);
 * - nunca envia `leave_room` se o jogador local ja nao estiver em uma
 *   sala (`canLeave`, injetado -- normalmente `() => Boolean(currentSlot)`
 *   em main.js);
 * - quando a confirmacao (`left_room`) chega do servidor, dispara
 *   `onLeaveConfirmed` (injetado) exatamente uma vez, e volta a aceitar
 *   um novo pedido de saida (relevante depois de entrar em outra sala).
 *
 * Este modulo NAO sabe nada sobre DOM, WebSocket, MatchTimelineManager,
 * NoteRenderer, InputController, FeedbackRenderer ou UIController -- quem
 * usa este modulo (main.js) injeta o que deve acontecer de verdade
 * (parar loops, desligar input, resetar a tela etc.), reaproveitando as
 * funcoes ja existentes desses modulos. Isso mantem a
 * validacao/idempotencia 100% testavel em Node puro, isolada do resto
 * do ciclo de vida da sala/partida.
 */
const LeaveRoomController = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;

  /**
   * @param {{
   *   sendLeaveRoom: () => void,
   *   canLeave?: () => boolean,
   *   onLeaveConfirmed?: () => void,
   * }} deps
   */
  function createLeaveRoomController(deps = {}) {
    const { sendLeaveRoom, canLeave, onLeaveConfirmed } = deps;

    // Unico estado deste modulo: se ja pedimos para sair e ainda
    // estamos aguardando a confirmacao (`left_room`) do servidor.
    // Enquanto for `true`, nenhum novo `leave_room` e enviado -- isso e
    // o que garante que cliques repetidos (ou qualquer outra chamada
    // redundante de `requestLeave`) nunca gerem uma segunda mensagem
    // para o mesmo pedido.
    let pending = false;

    /**
     * Chamado pelo clique em "Sair da sala". So envia `leave_room` ao
     * servidor se: (a) nao houver um pedido de saida ja em andamento, e
     * (b) `canLeave()` (quando fornecido) confirmar que o jogador local
     * realmente esta em uma sala agora.
     *
     * @returns {boolean} true se o pedido foi enviado agora; false se
     *   foi ignorado (pedido ja pendente, ou jogador fora de uma sala).
     */
    function requestLeave() {
      if (pending) return false;
      if (typeof canLeave === 'function' && !canLeave()) return false;

      pending = true;
      if (typeof sendLeaveRoom === 'function') sendLeaveRoom();
      return true;
    }

    function isPending() {
      return pending;
    }

    /**
     * Processa a confirmacao (`left_room`) vinda do servidor. So age se
     * houver mesmo um pedido pendente daqui e o payload for do tipo
     * esperado -- qualquer outra coisa (mensagem duplicada, tipo
     * errado, nenhum pedido pendente) e ignorada com seguranca, sem
     * lancar excecao.
     *
     * @param {{type?: string}} message
     * @returns {boolean} true se a confirmacao foi processada agora.
     */
    function handleConfirmation(message) {
      if (!message || message.type !== 'left_room') return false;
      if (!pending) return false;

      pending = false;
      if (typeof onLeaveConfirmed === 'function') onLeaveConfirmed();
      return true;
    }

    /**
     * Devolve este controlador ao estado inicial. Chamado quando o
     * jogador entra em uma sala nova (proxima vez), garantindo que um
     * novo pedido de saida possa ser feito normalmente.
     */
    function reset() {
      pending = false;
    }

    return { requestLeave, isPending, handleConfirmation, reset };
  }

  const api = { createLeaveRoomController };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
