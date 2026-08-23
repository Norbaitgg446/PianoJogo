/**
 * Execucao do Bot dentro de uma partida real (Etapa 14B, parte 2).
 *
 * A Parte 1 (client/js/match/botController.js) ensinou o Bot a OLHAR
 * para uma timeline e DECIDIR, para cada nota, quando agiria e qual
 * julgamento isso resultaria -- tudo puro/sem estado, sem tocar em
 * PlayerState nem em nenhuma partida real.
 *
 * Este modulo e a camada de EXECUCAO: pega essas decisoes e as aplica,
 * no momento certo (mesmo relogio da partida), sobre o PROPRIO
 * PlayerState do Bot -- criando o fluxo completo pedido nesta etapa:
 *
 *   timeline -> BotController -> tempo de reacao -> julgamento -> PlayerState do Bot
 *
 * IMPORTANTE -- LEIA ANTES DE MEXER:
 *
 * 1. Isto e um QUARTO fluxo, novo e independente. "Jogar Sozinho"
 *    (isSoloMode/btn-play-solo em main.js), "Modo Teste"
 *    (localServerSimulator.js) e o Multiplayer normal (WebSocket/salas
 *    reais) continuam usando exatamente o mesmo caminho de sempre --
 *    nenhum deles chama este arquivo, e este arquivo nao chama nenhum
 *    deles. Nao ha nenhum botao, tela ou fluxo de partida real ligando
 *    este modulo a nada ainda (fica para a proxima parte da Etapa 14B).
 *
 * 2. NAO reimplementa gameplay. Reaproveita integralmente:
 *    - a MESMA timeline da partida real (a instancia recebida em
 *      `timeline`, nunca uma copia/segunda geracao -- ver NoteEngine/
 *      MatchTimelineManager, ja existentes);
 *    - BotController.decideTimeline/computeActionTime (Parte 1) para
 *      decidir CADA nota -- nenhum julgamento e recalculado aqui;
 *    - PlayerState.createPlayerState/registerHit/registerMiss/
 *      registerMistake (ja existentes) para acumular score/combo/
 *      contagens do Bot -- NENHUMA logica de pontuacao e duplicada
 *      aqui, este modulo so decide QUANDO chamar cada uma;
 *    - MatchResult.buildResult (ja existente) para gerar o resultado
 *      final do Bot, no MESMO formato do resultado de um jogador
 *      humano -- nenhum formato paralelo de resultado.
 *
 * 3. O Bot NUNCA marca nenhuma nota da timeline como hit/missed (nunca
 *    chama NoteEngine.setNoteState). A timeline e a MESMA usada pelo
 *    GameplayEngine do jogador humano (quando os dois estiverem na
 *    mesma partida, proxima parte) -- se o Bot "reivindicasse" notas
 *    nela, tiraria notas do jogador humano por engano. O Bot so LE
 *    `note.id`/`note.index`/`note.lane`/`note.time` (via BotController)
 *    e escreve exclusivamente no PROPRIO PlayerState (nunca no do
 *    jogador, nunca na timeline).
 *
 * 4. PlayerState PROPRIO e independente: `createBotMatch` sempre chama
 *    `PlayerState.createPlayerState()` para o Bot -- nunca recebe nem
 *    reaproveita o PlayerState de nenhum jogador humano. Alterar o
 *    estado do Bot nunca toca no estado de nenhum jogador (e vice-versa),
 *    exatamente como ja garantido pelo proprio PlayerState (Etapa 4B) e
 *    reforcado pelos testes desta etapa.
 *
 * 5. RELOGIO: nenhum `Date.now()` e chamado aqui. `tick(botMatch,
 *    currentTime)` recebe o "agora" de fora -- o MESMO relogio
 *    sincronizado que o resto do cliente ja usa para o jogador humano
 *    (ex: `getSyncedNow()` em main.js, chamado dentro do MESMO loop de
 *    requestAnimationFrame que ja processa `GameplayEngine.
 *    processExpiredNotes`, nunca um `setTimeout` novo por nota -- ver
 *    "SEM TIMERS POR NOTA" abaixo).
 *
 * SEM TIMERS POR NOTA: as decisoes de TODAS as notas sao pre-calculadas
 * uma UNICA vez em `createBotMatch` (via BotController.decideTimeline,
 * ja deterministico). `tick()` e um mecanismo CENTRALIZADO -- percorre
 * essas decisoes ja calculadas e executa (aplica ao PlayerState do Bot)
 * cada uma cujo horario programado (`computeActionTime`) ja chegou.
 * Nao ha nenhum `setTimeout`/`setInterval` por nota, nem no total: quem
 * chama `tick()` decide o proprio ritmo (ex: uma vez por frame), este
 * modulo nunca agenda nada sozinho.
 *
 * CICLO DE VIDA:
 *   BotMatchController.createBotMatch(options) -- cria um Bot pronto
 *     para jogar UMA partida (PlayerState zerado + decisoes
 *     pre-calculadas para toda a timeline).
 *   BotMatchController.tick(botMatch, currentTime) -- executa (uma
 *     unica vez cada) as decisoes cujo horario ja chegou e devolve
 *     exatamente essas decisoes (ETAPA 14C — PARTE 2, mesmo padrao de
 *     GameplayEngine.processExpiredNotes devolvendo as notas MISS da
 *     chamada -- para main.js poder mostrar o feedback visual de cada
 *     uma via FeedbackRenderer, sem recalcular nenhum julgamento).
 *     Idempotente: chamar de novo com o mesmo/menor currentTime nao
 *     reaplica nada (devolve `[]`). Nao faz nada (devolve `[]`) se a
 *     partida do Bot ja tiver sido finalizada (`finalize`) -- ver
 *     "IMPEDIR ACOES DEPOIS DO FIM" abaixo.
 *   BotMatchController.isFinished(botMatch) -- true quando todas as
 *     notas ja foram executadas OU `finalize()` ja foi chamado.
 *   BotMatchController.finalize(botMatch) -- gera (uma unica vez;
 *     chamadas seguintes devolvem o MESMO resultado ja calculado) o
 *     resultado final do Bot via MatchResult.buildResult, e marca a
 *     partida do Bot como finalizada -- depois disso `tick()` nunca
 *     mais altera o PlayerState do Bot, mesmo que ainda restassem
 *     decisoes nao executadas (ex: partida encerrada antes do fim).
 *   BotMatchController.getResult(botMatch) -- o resultado ja gerado por
 *     `finalize()`, ou `null` se ainda nao chamado.
 *   BotMatchController.getPlayerState(botMatch) -- o PlayerState (real,
 *     mesma referencia -- mesmo padrao de acesso direto que o resto do
 *     projeto ja usa para PlayerState, nunca uma copia) do Bot.
 *   BotMatchController.reset(botMatch, options) -- reinicia esta MESMA
 *     instancia para uma partida nova (novo PlayerState zerado, novas
 *     decisoes pre-calculadas; timeline/config/etc podem ser
 *     substituidos ou reaproveitados do `botMatch` anterior).
 *
 * IMPEDIR ACOES DEPOIS DO FIM: `tick()` verifica `botMatch.finished`
 * logo no inicio e nao faz absolutamente nada se for `true` -- nem
 * ler nem escrever o PlayerState do Bot. `finished` fica `true`
 * automaticamente assim que a ULTIMA decisao pendente e executada
 * dentro de `tick()`, e tambem e forcado por `finalize()`.
 *
 * LIMITE DESTA PARTE (nao implementado de proposito): nenhum botao
 * "Jogar contra Bot", tela nova, animacao, nome/avatar do Bot,
 * dificuldade selecionavel, sons, matchmaking, ranking ou integracao
 * com o Multiplayer online -- so a capacidade do Bot participar
 * corretamente de uma partida INTERNAMENTE. Isso fica para a proxima
 * parte da Etapa 14B.
 */
const BotMatchController = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;
  const PlayerStateRef = isNode ? require('./playerState') : PlayerState;
  const BotControllerRef = isNode ? require('./botController') : BotController;
  const JudgementRef = isNode ? require('./judgement') : Judgement;
  const MatchResultRef = isNode ? require('./matchResult') : MatchResult;

  /**
   * Monta um novo estado interno de "Bot jogando uma partida": um
   * PlayerState proprio zerado + uma decisao pre-calculada (via
   * BotController.decideTimeline, ja deterministico) e um horario de
   * execucao (via BotController.computeActionTime, a MESMA formula
   * usada internamente pela propria decisao) para CADA nota da
   * timeline recebida.
   *
   * Funcao interna pura em relacao a `options` -- nunca muta a
   * `timeline` recebida nem nenhuma nota dela.
   *
   * @param {object} options
   * @param {Array} options.timeline - OBRIGATORIO. A MESMA timeline da
   *   partida real (ex: MatchTimelineManager.getTimeline()/ensureTimeline()).
   * @param {object} [options.config] - config de comportamento do Bot
   *   (ver BotController.DEFAULT_CONFIG/createConfig, Parte 1).
   *   Omitido => BotController.DEFAULT_CONFIG.
   * @param {{perfectMs:number, greatMs?:number, goodMs:number}} options.windows -
   *   OBRIGATORIO, mesma fonte que o jogador humano usa (ex:
   *   ClientConfig.JUDGEMENT_WINDOWS) -- repassado adiante para
   *   BotController/Judgement, nunca redefinido aqui.
   * @param {object} [options.scoreValues] - ex: ClientConfig.SCORE_VALUES.
   *   Repassado diretamente para PlayerState.registerHit.
   * @param {Array<{minCombo:number, multiplier:number}>} [options.comboMultiplierTiers] -
   *   ex: ClientConfig.COMBO_MULTIPLIER.TIERS. Repassado diretamente
   *   para PlayerState.registerHit.
   * @param {{MISTAKE?:number, MISS?:number}} [options.penalties] - ex:
   *   ClientConfig.PENALTIES. Repassado diretamente para
   *   PlayerState.registerMiss/registerMistake.
   * @returns {object} o novo estado interno (`botMatch`)
   */
  function buildBotMatch(options) {
    const opts = options || {};

    if (!Array.isArray(opts.timeline)) {
      throw new Error('BotMatchController: "timeline" e obrigatoria (a MESMA timeline da partida real).');
    }
    if (!opts.windows) {
      throw new Error('BotMatchController: "windows" e obrigatorio (ex: ClientConfig.JUDGEMENT_WINDOWS).');
    }

    const config = BotControllerRef.createConfig(opts.config);
    const decisions = BotControllerRef.decideTimeline(opts.timeline, { config, windows: opts.windows });

    const entries = opts.timeline.map((note, index) => ({
      note,
      decision: decisions[index],
      scheduledTime: BotControllerRef.computeActionTime(note, config),
      executed: false,
    }));

    return {
      timeline: opts.timeline,
      config,
      windows: opts.windows,
      scoreValues: opts.scoreValues,
      comboMultiplierTiers: opts.comboMultiplierTiers,
      penalties: opts.penalties,
      playerState: PlayerStateRef.createPlayerState(),
      entries,
      finished: false,
      result: null,
    };
  }

  /**
   * Cria uma nova instancia de "Bot jogando uma partida" (ver
   * `buildBotMatch` acima para os parametros).
   *
   * @param {object} options
   * @returns {object} botMatch
   */
  function createBotMatch(options) {
    return buildBotMatch(options);
  }

  /**
   * Aplica UMA decisao ja calculada ao PlayerState do Bot, reutilizando
   * exclusivamente as funcoes ja existentes de PlayerState -- nenhuma
   * logica de pontuacao/combo e recalculada aqui:
   *
   * - `decision.mistake` (Bot "errou de proposito", ver
   *   BotController.rollMistake) -> PlayerState.registerMistake;
   * - `decision.judgement === 'MISS'` (Bot reagiu tarde/cedo demais
   *   para qualquer julgamento valido) -> PlayerState.registerMiss;
   * - qualquer outro julgamento (PERFECT/GREAT/GOOD) -> PlayerState.registerHit.
   *
   * @param {object} botMatch
   * @param {object} decision - um item de BotController.decideTimeline
   */
  function applyDecision(botMatch, decision) {
    const { playerState, scoreValues, comboMultiplierTiers, penalties } = botMatch;
    const mistakePenalty = penalties && penalties.MISTAKE;
    const missPenalty = penalties && penalties.MISS;

    if (decision.mistake) {
      PlayerStateRef.registerMistake(playerState, mistakePenalty);
      return;
    }

    if (decision.judgement === JudgementRef.JUDGEMENT_RESULT.MISS) {
      PlayerStateRef.registerMiss(playerState, missPenalty);
      return;
    }

    PlayerStateRef.registerHit(playerState, decision.judgement, scoreValues, comboMultiplierTiers);
  }

  /**
   * Avanca o Bot ate `currentTime`: executa (uma unica vez cada) todas
   * as decisoes ainda pendentes cujo horario programado
   * (`entry.scheduledTime`) ja chegou, na ordem da timeline. Nao faz
   * nada se `botMatch` for invalido, se `currentTime` nao for um
   * numero finito, ou se a partida do Bot ja tiver sido finalizada
   * (ver `finalize` abaixo) -- ver "IMPEDIR ACOES DEPOIS DO FIM" no
   * comentario do topo.
   *
   * Chamar `tick()` varias vezes com o mesmo `currentTime` (ou
   * currentTime menor que o anterior) e seguro: cada decisao so e
   * aplicada UMA vez (`entry.executed`), nunca reprocessada.
   *
   * Marca `botMatch.finished = true` automaticamente assim que a
   * ULTIMA decisao pendente e executada.
   *
   * @param {object} botMatch
   * @param {number} currentTime - "agora", no MESMO relogio sincronizado
   *   ja usado pelo resto do cliente (ex: getSyncedNow() de main.js) --
   *   este modulo nunca le Date.now() sozinho.
   * @returns {Array<object>} ETAPA 14C — PARTE 2: as decisoes (mesmo
   *   formato de BotController.decideForNote/decideTimeline --
   *   {noteId, outcome, ...}, nenhum formato novo) executadas NESTA
   *   chamada, na ordem da timeline. `[]` quando nenhuma decisao nova
   *   foi executada (inclusive quando `botMatch` ja estava finalizado)
   *   -- mesmo padrao ja usado por
   *   GameplayEngine.processExpiredNotes (que devolve as notas MISS
   *   desta chamada), so para que quem chama `tick()` (main.js) possa
   *   mostrar o feedback visual (FeedbackRenderer) de CADA acerto/erro
   *   do Bot exatamente no frame em que ele aconteceu, sem duplicar
   *   nenhum julgamento -- o `outcome` de cada item ja foi decidido por
   *   BotController.decideTimeline em `createBotMatch`, nunca
   *   recalculado aqui.
   */
  function tick(botMatch, currentTime) {
    if (!botMatch || botMatch.finished) return [];
    if (!Number.isFinite(currentTime)) return [];

    const executedNow = [];
    let allExecuted = true;
    for (const entry of botMatch.entries) {
      if (entry.executed) continue;

      if (currentTime >= entry.scheduledTime) {
        applyDecision(botMatch, entry.decision);
        entry.executed = true;
        executedNow.push(entry.decision);
      } else {
        allExecuted = false;
      }
    }

    if (allExecuted) {
      botMatch.finished = true;
    }

    return executedNow;
  }

  /**
   * Se a partida do Bot ja terminou (todas as decisoes ja executadas,
   * ou `finalize()` ja foi chamado).
   *
   * @param {object} botMatch
   * @returns {boolean}
   */
  function isFinished(botMatch) {
    return !!(botMatch && botMatch.finished);
  }

  /**
   * Gera (uma unica vez -- chamadas seguintes devolvem o MESMO
   * resultado ja calculado, sem recalcular) o resultado final do Bot,
   * via MatchResult.buildResult -- a MESMA funcao pura que ja gera o
   * resultado do jogador humano (ver client/js/match/matchResult.js),
   * nenhum formato paralelo de resultado. Le apenas o PlayerState do
   * Bot no instante da chamada (snapshot), exatamente como
   * MatchResult.buildResult ja faz para qualquer jogador.
   *
   * IMPORTANTE: usa `MatchResult.buildResult` (funcao pura), nunca
   * `MatchResult.generateResult` -- este ultimo guarda o resultado num
   * unico "resultado ativo" global, reservado para o jogador LOCAL
   * (ver client/js/main.js#handleLocalMatchEnd). Gerar o resultado do
   * Bot atraves de `generateResult` sobrescreveria esse resultado
   * global por engano; `buildResult` nunca guarda nada globalmente.
   *
   * Tambem marca a partida do Bot como finalizada
   * (`botMatch.finished = true`) -- depois desta chamada, `tick()`
   * nunca mais altera o PlayerState do Bot, mesmo que restassem
   * decisoes nao executadas (ex: partida encerrada antes do fim, por
   * abandono).
   *
   * @param {object} botMatch
   * @returns {object|null} o resultado do Bot, ou `null` se `botMatch` for invalido
   */
  function finalize(botMatch) {
    if (!botMatch) return null;

    if (!botMatch.result) {
      botMatch.result = MatchResultRef.buildResult({
        playerState: botMatch.playerState,
        timeline: botMatch.timeline,
      });
    }
    botMatch.finished = true;

    return botMatch.result;
  }

  /**
   * O resultado do Bot ja gerado por `finalize()`, ou `null` se ainda
   * nao foi chamado.
   *
   * @param {object} botMatch
   * @returns {object|null}
   */
  function getResult(botMatch) {
    return (botMatch && botMatch.result) || null;
  }

  /**
   * O PlayerState (real, mesma referencia -- nunca uma copia) do Bot.
   * Mesmo padrao de acesso direto que o resto do projeto ja usa para
   * PlayerState (ex: main.js le `localPlayerState.score` diretamente).
   *
   * @param {object} botMatch
   * @returns {object|null}
   */
  function getPlayerState(botMatch) {
    return (botMatch && botMatch.playerState) || null;
  }

  /**
   * Reinicia esta MESMA instancia de `botMatch` para uma partida nova:
   * PlayerState novo (zerado) e decisoes pre-calculadas de novo, do
   * zero (nenhuma decisao/estado da partida anterior sobrevive).
   *
   * `options` e OPCIONAL campo a campo -- qualquer campo omitido
   * reaproveita o valor ja usado por `botMatch` (ex: chamar
   * `reset(botMatch)` sem nada recomeca a MESMA timeline/config
   * anteriores; chamar `reset(botMatch, { timeline: novaTimeline })`
   * troca so a timeline, mantendo a mesma config/windows/etc).
   *
   * @param {object} botMatch
   * @param {object} [options] - mesmos campos de `createBotMatch`, todos opcionais
   * @returns {object} o mesmo `botMatch` recebido, renovado
   */
  function reset(botMatch, options) {
    if (!botMatch) return botMatch;
    const opts = options || {};

    const renewed = buildBotMatch({
      timeline: opts.timeline || botMatch.timeline,
      config: opts.config || botMatch.config,
      windows: opts.windows || botMatch.windows,
      scoreValues: opts.scoreValues !== undefined ? opts.scoreValues : botMatch.scoreValues,
      comboMultiplierTiers:
        opts.comboMultiplierTiers !== undefined ? opts.comboMultiplierTiers : botMatch.comboMultiplierTiers,
      penalties: opts.penalties !== undefined ? opts.penalties : botMatch.penalties,
    });

    Object.assign(botMatch, renewed);
    return botMatch;
  }

  const api = {
    createBotMatch,
    tick,
    isFinished,
    finalize,
    getResult,
    getPlayerState,
    reset,
  };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
