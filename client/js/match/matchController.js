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

  // ---------------------------------------------------------------------
  // Funcoes PURAS (sem timer/DOM) -- extraidas de dentro de tick() so
  // para serem testaveis isoladamente em Node (ETAPA 15), no mesmo
  // padrao ja usado por NoteRenderer._internal. O comportamento de
  // startCountdown abaixo continua exatamente o mesmo -- estas funcoes
  // so tornam a MESMA formula que ja existia inspecionavel por testes,
  // sem duplicar nenhuma logica nova.
  // ---------------------------------------------------------------------

  /** "Agora" estimado no relogio do servidor, dado o offset ja calculado. */
  function computeEstimatedServerNow(localNow, clockOffset) {
    return localNow + clockOffset;
  }

  /** Quanto falta (ms) para startTimestamp, a partir do "agora" estimado. */
  function computeRemainingMs(startTimestamp, estimatedServerNow) {
    return startTimestamp - estimatedServerNow;
  }

  /** Segundo inteiro (3,2,1...) exibido para um remainingMs > 0 dado. */
  function computeSecondsRemaining(remainingMs) {
    return Math.ceil(remainingMs / 1000);
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
      const estimatedServerNow = computeEstimatedServerNow(Date.now(), clockOffset);
      const remainingMs = computeRemainingMs(data.startTimestamp, estimatedServerNow);

      if (remainingMs <= 0) {
        stopCountdown();
        onComplete();
        return;
      }

      const secondsRemaining = computeSecondsRemaining(remainingMs);
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
  api._internal = { computeEstimatedServerNow, computeRemainingMs, computeSecondsRemaining };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
