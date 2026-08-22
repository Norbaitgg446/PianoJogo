/**
 * Controlador da partida no cliente.
 * Responsavel apenas por calcular "quanto falta" para o inicio da partida
 * com base no timestamp definido pelo SERVIDOR, evitando que a contagem
 * regressiva dependa de quando a mensagem chegou em cada navegador.
 *
 * Estrategia:
 * 1. O servidor manda startTimestamp (quando a partida deve comecar) e
 *    serverTime (o "agora" do servidor no momento do envio).
 * 2. O cliente calcula clockOffset = serverTime - Date.now() (uma estimativa
 *    grosseira de diferenca entre os relogios, sem medir round-trip).
 * 3. A cada tick, o cliente estima "agora, no relogio do servidor" somando
 *    esse offset ao seu proprio relogio, e calcula quanto falta ate
 *    startTimestamp. Isso faz os dois navegadores convergirem para o
 *    mesmo instante de inicio, independente de pequenas diferencas de
 *    latencia no recebimento da mensagem.
 */
const MatchController = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;

  let intervalId = null;

  function stopCountdown() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  /**
   * @param {{startTimestamp:number, serverTime:number}} data
   * @param {(secondsRemaining:number) => void} onTick chamado a cada atualizacao com o segundo atual (3,2,1)
   * @param {() => void} onComplete chamado uma unica vez quando o timestamp de inicio e alcancado
   */
  function startCountdown(data, onTick, onComplete) {
    stopCountdown();

    const clockOffset = data.serverTime - Date.now();
    let lastWholeSecondShown = null;

    function tick() {
      const estimatedServerNow = Date.now() + clockOffset;
      const remainingMs = data.startTimestamp - estimatedServerNow;

      if (remainingMs <= 0) {
        stopCountdown();
        onComplete();
        return;
      }

      const secondsRemaining = Math.ceil(remainingMs / 1000);
      if (secondsRemaining !== lastWholeSecondShown) {
        lastWholeSecondShown = secondsRemaining;
        onTick(secondsRemaining);
      }
    }

    tick();
    // 100ms e suficiente para detectar a virada de segundo com precisao,
    // sem gerar trafego ou custo de processamento desnecessario.
    intervalId = setInterval(tick, 100);
  }

  const api = { startCountdown, stopCountdown };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
