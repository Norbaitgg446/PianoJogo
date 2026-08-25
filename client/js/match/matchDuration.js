/**
 * Etapa 15A — Preparacao do sistema de duracao das partidas (PARTE 1).
 *
 * IMPORTANTE: esta etapa e SOMENTE arquitetura. Nenhuma partida termina
 * mais cedo por causa deste modulo ainda -- ninguem chama
 * `resolveMatchDuration` a partir de MatchController/BotMatchController/
 * MatchEndDetector/main.js para de fato encerrar uma partida mais cedo.
 * Isso fica para uma proxima parte da Etapa 15.
 *
 * Responsabilidade unica: transformar um identificador de duracao (ex:
 * ClientConfig.MATCH_DURATION_IDS.ONE_MINUTE) na duracao correspondente
 * em milissegundos, usando a tabela ja centralizada em
 * ClientConfig.MATCH_DURATION_MS -- nenhum numero magico duplicado aqui.
 *
 * Mesmo espirito de BotController.createConfigForDifficulty (presets +
 * identificador + fallback seguro), so que para duracao em vez de
 * dificuldade do Bot.
 *
 * `resolveMatchDuration` e uma funcao PURA:
 *   - nao acessa DOM;
 *   - nao acessa relogio do sistema (nunca le o instante atual);
 *   - nao inicia nenhum timer/intervalo;
 *   - nao altera estado global (nunca escreve em `durationsMs` nem em
 *     nenhuma outra estrutura recebida);
 *   - mesma entrada sempre devolve a mesma saida.
 *
 * FALLBACK SEGURO: quando `durationId` nao e informado (undefined/null)
 * ou nao existe na tabela `durationsMs` recebida, a funcao devolve
 * `fallbackMs` (por padrao `null`) em vez de lancar erro ou inventar um
 * numero. `null` aqui representa exatamente o comportamento ATUAL do
 * projeto: "sem duracao configurada" -- a partida continua terminando
 * do jeito que termina hoje (ver MatchEndDetector: todas as notas da
 * timeline em estado terminal), nunca por um timer de duracao.
 */
const MatchDuration = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;

  /**
   * Resolve um identificador de duracao de partida para milissegundos.
   *
   * @param {Object<string, number>} [durationsMs] - tabela de duracoes,
   *   ex: ClientConfig.MATCH_DURATION_MS ({'30S': 30000, '1M': 60000, ...}).
   * @param {string} [durationId] - identificador desejado, ex:
   *   ClientConfig.MATCH_DURATION_IDS.ONE_MINUTE ('1M').
   * @param {number|null} [fallbackMs] - valor devolvido quando `durationId`
   *   nao e informado ou nao existe em `durationsMs`. Por padrao `null`,
   *   que preserva o comportamento atual do projeto (nenhuma duracao
   *   configurada -- ver comentario do modulo acima).
   * @returns {number|null} a duracao em ms, ou `fallbackMs` se nao
   *   resolvivel.
   */
  function resolveMatchDuration(durationsMs, durationId, fallbackMs = null) {
    if (
      durationsMs &&
      typeof durationId === 'string' &&
      Object.prototype.hasOwnProperty.call(durationsMs, durationId) &&
      Number.isFinite(durationsMs[durationId])
    ) {
      return durationsMs[durationId];
    }

    return fallbackMs;
  }

  /**
   * ETAPA 15C-1A: verifica se uma partida ja atingiu sua duracao maxima.
   *
   * Funcao PURA: depende SOMENTE dos tres argumentos recebidos --
   * nao le relogio do sistema (nunca chama o "agora" do runtime), nao
   * usa timers/agendamento (nenhum callback baseado em tempo), nao
   * acessa DOM nem variavel global nenhuma.
   * Quem chama e responsavel por fornecer `currentTime` (ex: o relogio
   * sincronizado ja usado pelo GameplayEngine/MatchTimelineManager).
   *
   * Regra: `currentTime - startTime >= durationMs`
   *   - false antes da duracao;
   *   - true exatamente na duracao;
   *   - true depois da duracao.
   *
   * Defensiva: se `currentTime`, `startTime` ou `durationMs` nao forem
   * numeros finitos, ou se `durationMs <= 0` (duracao "desligada"/invalida,
   * preservando o comportamento atual do projeto de partida sem limite de
   * tempo), a funcao devolve `false` -- nunca lanca erro, nunca considera
   * a duracao atingida por engano.
   *
   * @param {number} currentTime - instante atual (mesma unidade/relogio de startTime)
   * @param {number} startTime - instante em que a partida comecou
   * @param {number} durationMs - duracao maxima permitida, em ms
   * @returns {boolean} true se a partida ja atingiu (ou ultrapassou) a duracao
   */
  function hasReachedMatchDuration(currentTime, startTime, durationMs) {
    if (
      !Number.isFinite(currentTime) ||
      !Number.isFinite(startTime) ||
      !Number.isFinite(durationMs)
    ) {
      return false;
    }

    if (durationMs <= 0) {
      return false;
    }

    return currentTime - startTime >= durationMs;
  }

  const api = { resolveMatchDuration, hasReachedMatchDuration };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
