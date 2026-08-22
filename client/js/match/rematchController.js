/**
 * Controlador do lado CLIENTE do fluxo de revanche (Etapa 5B-5A,
 * Parte 2). So o "handshake" de clique -> "aguardando" -> confirmado
 * pelo servidor / cancelado -- nenhuma logica de rede (WebSocket) ou de
 * DOM mora aqui. Quem usa este modulo (main.js) injeta:
 *
 * - sendRematchReady(): dispara a mensagem 'rematch_ready' de verdade
 *   (via SocketClient.send, ja existente);
 * - onWaitingStateChange(isWaiting): a UI deve entrar/sair do estado
 *   "Aguardando o outro jogador..." (ResultRenderer.setPlayAgainWaiting);
 * - onCancelled(reason): a revanche foi cancelada pelo servidor (ex:
 *   oponente desconectou antes dos dois ficarem prontos).
 *
 * O fluxo real de "os dois prontos -> nova partida" continua vindo
 * inteiramente do servidor (Parte 1) atraves das mensagens JA
 * existentes: match_ready -> match_countdown_start -> match_started.
 * Este modulo NAO participa dessa parte -- so garante que o CLIQUE no
 * botao "Jogar Novamente" vira exatamente UMA mensagem 'rematch_ready'
 * por handshake, mesmo com cliques repetidos.
 */
const RematchController = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;

  /**
   * @param {{
   *   sendRematchReady: () => void,
   *   onWaitingStateChange?: (isWaiting: boolean) => void,
   *   onCancelled?: (reason: string) => void,
   * }} deps
   */
  function createRematchController(deps = {}) {
    const { sendRematchReady, onWaitingStateChange, onCancelled } = deps;

    // Unico estado deste modulo: se o jogador LOCAL ja pediu revanche
    // para esta rodada de handshake (ainda nao resolvida). Guarda tanto
    // "ja enviei a mensagem" quanto "estou mostrando aguardando" na
    // mesma flag -- os dois sempre andam juntos neste fluxo.
    let waitingForOpponent = false;

    /**
     * Chamado pelo clique em "Jogar Novamente". Envia a solicitacao ao
     * servidor exatamente uma vez: cliques repetidos (ou chamadas
     * repetidas por qualquer motivo) enquanto ja estivermos esperando
     * o oponente sao ignorados -- nunca envia uma segunda mensagem
     * 'rematch_ready' para o mesmo handshake.
     *
     * @returns {boolean} true se a solicitacao foi enviada agora; false
     *   se ja havia uma pendente e esta chamada foi ignorada.
     */
    function requestRematch() {
      if (waitingForOpponent) return false;

      waitingForOpponent = true;
      if (typeof sendRematchReady === 'function') sendRematchReady();
      if (typeof onWaitingStateChange === 'function') onWaitingStateChange(true);
      return true;
    }

    function isWaiting() {
      return waitingForOpponent;
    }

    /**
     * O servidor cancelou o handshake de revanche em andamento (ex: o
     * oponente desconectou antes dos dois ficarem prontos). So faz
     * sentido agir se realmente havia uma revanche pendente daqui --
     * chamadas quando nao ha nada pendente sao ignoradas, para nunca
     * mostrar uma mensagem de cancelamento sem motivo.
     */
    function handleCancelled(reason) {
      if (!waitingForOpponent) return;

      waitingForOpponent = false;
      if (typeof onWaitingStateChange === 'function') onWaitingStateChange(false);
      if (typeof onCancelled === 'function') onCancelled(reason);
    }

    /**
     * Chamado quando uma partida nova de verdade comeca (match_started)
     * -- devolve este controlador ao estado inicial, para que a
     * PROXIMA vez que esta partida terminar o jogador possa pedir
     * revanche de novo (novo handshake, do zero).
     */
    function reset() {
      waitingForOpponent = false;
    }

    return {
      requestRematch,
      isWaiting,
      handleCancelled,
      reset,
    };
  }

  const api = { createRematchController };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
