/**
 * Estado e ciclo de vida basico de um adversario do tipo "Bot" (Etapa 14A).
 *
 * IMPORTANTE -- LEIA ANTES DE MEXER:
 * Este modulo e uma peca NOVA e INDEPENDENTE. Ele nao substitui, nao
 * reaproveita o fluxo de, e nao e chamado por nenhum dos tres conceitos
 * que ja existem no projeto:
 *
 *   - "Jogar Sozinho" (Solo)  -- ver client/js/main.js (isSoloMode,
 *     btn-play-solo) e server/ws/messageRouter.js#handleStartSoloMatch.
 *     Continua identico: um unico jogador humano, sem oponente nenhum.
 *   - "Modo Teste" (local/offline) -- ver
 *     client/js/network/localServerSimulator.js. Continua identico: e
 *     um servidor de mentira que replica o MESMO fluxo Solo inteiramente
 *     no navegador. Nao tem nada a ver com o Bot desta etapa.
 *   - Multiplayer real (dois jogadores humanos via WebSocket/salas) --
 *     tambem continua 100% intocado.
 *
 * "Modo Bot" (este modulo) e um QUARTO conceito, novo: no futuro, um
 * jogador humano podera jogar contra um oponente controlado pelo
 * computador. NESTA ETAPA (14A) so existe a ESTRUTURA de dados/estado
 * do Bot -- nenhuma inteligencia, reacao, erro, julgamento (PERFECT/
 * GREAT/GOOD), pontuacao automatica ou dificuldade. O Bot criado aqui
 * nao joga sozinho, nao acerta nenhuma nota e nao altera o resultado de
 * nenhuma partida.
 *
 * REAPROVEITAMENTO (regra "nao duplique sistemas existentes"): o
 * "formato" de um estado de jogador (score, combo, maxCombo, hits,
 * misses, mistakes, perfectCount/greatCount/goodCount, maxMultiplier)
 * ja existe em PlayerState (client/js/match/playerState.js). Em vez de
 * redeclarar esses mesmos campos "na mao" aqui, o estado do Bot comeca
 * a partir de PlayerState.createPlayerState() e so acrescenta os dois
 * campos que o PlayerState nao tem e que o Bot precisa desde ja:
 *   - `active`      -- se este Bot esta ligado/participando (ainda sem
 *                       nenhum lugar do jogo que o ligue de verdade);
 *   - `multiplier`  -- o multiplicador de combo ATUAL (PlayerState so
 *                       guarda o MAIOR ja atingido, `maxMultiplier`;
 *                       o Bot vai precisar do valor "atual" quando a
 *                       pontuacao automatica for implementada).
 * Importante: isto NAO cria nenhum vinculo entre o Bot e o PlayerState
 * de nenhum jogador real. `createPlayerState()` so e usado aqui como
 * "molde" de campos -- cada chamada devolve um objeto novo e
 * independente, exatamente como qualquer outro lugar do projeto que
 * chama essa mesma funcao (ex: um GameplayEngine por jogador). Alterar
 * o estado de um Bot nunca toca no estado de nenhum PlayerState (e
 * vice-versa).
 *
 * API (mesmo padrao de modulo usado no resto do projeto -- IIFE +
 * export condicional para Node):
 *
 *   BotController.create(options)   -- cria uma nova instancia de Bot.
 *   BotController.reset(bot, opts)  -- volta um Bot ja existente ao
 *                                       estado inicial (zerado).
 *   BotController.update(bot, ...)  -- ponto de entrada unico por
 *                                       "frame"/tick para as PROXIMAS
 *                                       etapas (integracao com uma
 *                                       partida real). Continua um
 *                                       no-op nesta etapa tambem -- ver
 *                                       ETAPA 14B abaixo.
 *   BotController.getState(bot)     -- devolve um retrato (snapshot)
 *                                       do estado atual do Bot.
 *
 * ---------------------------------------------------------------------
 * ETAPA 14B (parte 1) -- NUCLEO DE REACAO/JULGAMENTO
 * ---------------------------------------------------------------------
 * Esta etapa ensina o BotController a OLHAR para uma timeline ja
 * existente (a mesma gerada por NoteEngine.generateNoteTimeline /
 * mantida por MatchTimelineManager -- nenhum segundo sistema de notas)
 * e DECIDIR, para cada nota, quando o Bot tentaria acerta-la e qual
 * julgamento isso resultaria. Ela NAO faz o Bot jogar de verdade ainda:
 * nao ha nenhuma ligacao com GameplayEngine, PlayerState, uma partida
 * em andamento, WebSocket ou pontuacao final -- so a DECISAO em si,
 * pura e testavel isoladamente (ver limite no fim deste comentario).
 *
 * Config do comportamento do Bot (`DEFAULT_CONFIG` / `createConfig`):
 *   - `reactionTimeMs`   -- ha quantos ms DEPOIS do tempo exato da nota
 *                            (`note.time`) o Bot tenta acerta-la. Pode
 *                            ser negativo (Bot reage ANTES da nota).
 *                            Exemplo do enunciado: nota em 5000ms,
 *                            reactionTimeMs 120 => acao em 5120ms.
 *   - `judgementOffsetMs` -- deslocamento fino adicional (ms), somado
 *                            ao `reactionTimeMs`. Default 0 (nao muda
 *                            o exemplo acima). Existe separado do
 *                            `reactionTimeMs` para as proximas etapas
 *                            poderem ajustar precisao/dificuldade sem
 *                            mexer no "tempo de reacao" conceitual.
 *   - `mistakeChance`     -- chance (0..1) do Bot errar essa nota de
 *                            proposito (vira `MISTAKE`, igual a uma
 *                            tecla errada de um jogador humano -- ver
 *                            gameplayEngine.js). Default 0 (nunca
 *                            erra), a UNICA configuracao usada nesta
 *                            etapa (dificuldade fica para depois).
 *   - `seed`              -- semente para a decisao de erro (ver
 *                            abaixo). Default fixo, para que o
 *                            comportamento padrao seja 100%
 *                            reproduzivel sem o chamador precisar
 *                            informar nada.
 *
 * ALEATORIEDADE CONTROLADA: nenhuma chamada a `Math.random()` existe
 * neste modulo. A decisao de erro (`rollMistake`) reaproveita o MESMO
 * gerador pseudoaleatorio deterministico ja usado pela sequencia de
 * notas (`SequenceGenerator.createSeededRandom`, ver
 * client/js/match/sequenceGenerator.js) -- semente + indice da nota
 * (`config.seed + note.index`) sempre produz exatamente o mesmo
 * resultado, em qualquer maquina, em qualquer execucao. E assim que os
 * testes conseguem reproduzir precisamente o mesmo "erro" ou "acerto".
 *
 * JULGAMENTO: nenhuma janela (PERFECT/GREAT/GOOD) e redefinida aqui.
 * `decideForNote`/`decideTimeline` recebem `windows` de quem chama
 * (ex: ClientConfig.JUDGEMENT_WINDOWS) e repassam directamente para
 * `Judgement.classify` -- a MESMA fonte que GameplayEngine ja usa para
 * o jogador humano. Um delta fora de qualquer janela vira MISS
 * (`Judgement.JUDGEMENT_RESULT.MISS`), a mesma constante do resto do
 * projeto.
 *
 *   BotController.DEFAULT_CONFIG        -- config padrao (congelada).
 *   BotController.createConfig(opts)    -- mescla `opts` sobre o padrao
 *                                           (funcao pura, nao muta nada).
 *   BotController.computeActionTime(note, config)
 *                                        -- `note.time + reactionTimeMs
 *                                           + judgementOffsetMs`.
 *   BotController.rollMistake(note, config)
 *                                        -- true/false deterministico
 *                                           (ver "ALEATORIEDADE" acima).
 *   BotController.decideForNote(note, { config, windows })
 *                                        -- decisao completa de UMA
 *                                           nota (ver formato abaixo).
 *   BotController.decideTimeline(timeline, { config, windows })
 *                                        -- decisao de TODAS as notas,
 *                                           numa timeline NOVA (nunca
 *                                           mutando a `timeline`
 *                                           recebida nem as notas nela).
 *
 * Formato de cada decisao (`decideForNote`/cada item de `decideTimeline`):
 *   {
 *     noteId, lane, noteIndex,   // identificam a nota original
 *     actionTime,                // epoch ms em que o Bot "agiria" (null se mistake)
 *     deltaMs,                   // actionTime - note.time (null se mistake)
 *     judgement,                 // 'PERFECT'|'GREAT'|'GOOD'|'MISS'|null (null se mistake)
 *     mistake,                   // true se o Bot "errou de proposito" essa nota
 *     outcome,                   // 'PERFECT'|'GREAT'|'GOOD'|'MISS'|'MISTAKE'
 *   }
 * (`outcome` espelha o mesmo vocabulario que
 * GameplayEngine.handleKeyPress ja devolve para um jogador humano --
 * nenhum vocabulario novo e inventado.)
 *
 * LIMITE DESTA PARTE (nao implementado de proposito): interface do
 * Bot, botao do Modo Bot, uma partida real contra o Bot, tela
 * mostrando o Bot, animacoes, sons, dificuldade (alem da config padrao
 * acima), matchmaking, WebSocket, e nenhuma pontuacao final do Bot
 * integrada a uma partida -- `update()` continua no-op, e nada aqui
 * chama PlayerState.registerHit/Miss/Mistake nem GameplayEngine. Isso
 * fica para a proxima parte da Etapa 14B.
 *
 * ---------------------------------------------------------------------
 * ETAPA 14D (PARTE 1) -- PREPARACAO PARA DIFICULDADES DO BOT
 * ---------------------------------------------------------------------
 * Apenas arquitetura nesta parte (ver client/js/config.js:
 * `BOT_DIFFICULTY` para os identificadores EASY/MEDIUM/HARD e
 * `BOT_DIFFICULTY_PRESETS` para uma config por dificuldade -- na Parte 1
 * os tres presets eram IDENTICOS a `DEFAULT_CONFIG` de proposito, entao
 * nenhum comportamento mudava ainda).
 *
 * `createConfigForDifficulty(presets, difficulty, overrides)` (abaixo)
 * e a UNICA peca nova deste modulo: resolve um identificador de
 * dificuldade + um mapa de presets numa config completa, pronta para
 * `create`/`reset`/`decideForNote`/`decideTimeline` -- o MESMO
 * `config` que ja existia desde a Etapa 14B, nenhum segundo sistema de
 * configuracao. `BotMatchController.createBotMatch({ config, ... })`
 * ja aceita esse resultado sem nenhuma mudanca (ver botMatchController.js).
 *
 * Nada nesta etapa CHAMA `createConfigForDifficulty` automaticamente:
 * `main.js` continua criando o Bot sem passar `config`
 * (`BotMatchController.createBotMatch({ timeline, windows, ... })`),
 * entao o Bot continua usando `DEFAULT_CONFIG` exatamente como na
 * Etapa 14B/14C. Escolher uma dificuldade de verdade continua fora do
 * escopo (nenhum botao/tela ainda).
 *
 * ---------------------------------------------------------------------
 * ETAPA 14D (PARTE 2A) -- LOGICA DAS DIFICULDADES DO BOT
 * ---------------------------------------------------------------------
 * Os tres presets em `ClientConfig.BOT_DIFFICULTY_PRESETS` deixaram de
 * ser identicos: EASY reage mais devagar (reactionTimeMs +
 * judgementOffsetMs maiores, empurrando o `deltaMs` que
 * `decideForNote` calcula para fora da janela PERFECT/GREAT do
 * `Judgement.classify`) e erra de proposito com mais frequencia
 * (`mistakeChance` maior). HARD e o oposto: reage mais perto do tempo
 * exato da nota (deltaMs dentro de PERFECT_MS) e quase nunca erra de
 * proposito. MEDIUM fica entre os dois. Nenhum parametro novo foi
 * criado -- so valores diferentes para os MESMOS quatro campos que
 * `createConfig`/`decideForNote` ja aceitavam desde a Etapa 14B (ver
 * comentario detalhado em `BOT_DIFFICULTY_PRESETS`, em config.js).
 *
 * Continua nada CHAMANDO `createConfigForDifficulty` automaticamente
 * (`main.js`/`BotMatchController` inalterados) -- o Bot so usa um
 * preset de dificuldade quando alguem passa `config` explicitamente
 * (hoje, so os testes). Selecao de dificuldade pelo jogador (botao,
 * tela) continua fora do escopo.
 */
const BotController = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;
  const PlayerStateRef = isNode ? require('./playerState') : PlayerState;
  // ETAPA 14B -- reaproveitados, nunca duplicados: Judgement e quem ja
  // decide PERFECT/GREAT/GOOD/MISS para o jogador humano (gameplayEngine.js);
  // SequenceGenerator e quem ja fornece o UNICO gerador pseudoaleatorio
  // deterministico do projeto (usado hoje para a sequencia de notas).
  const JudgementRef = isNode ? require('./judgement') : Judgement;
  const SequenceGeneratorRef = isNode ? require('./sequenceGenerator') : SequenceGenerator;

  /**
   * Monta o estado inicial (zerado) de um Bot.
   *
   * @param {{active?: boolean}} [options] - `active` comeca `false`
   *   por padrao (nenhum lugar do jogo liga um Bot ainda nesta etapa).
   * @returns {object}
   */
  function createInitialState(options) {
    const base = PlayerStateRef.createPlayerState();

    return {
      ...base,
      // Se este Bot esta ativo/participando de uma partida. So um
      // campo de estado por enquanto -- nada no jogo le ou escreve
      // este valor ainda.
      active: !!(options && options.active),
      // Multiplicador de combo ATUAL (distinto de `maxMultiplier`,
      // que ja vem de PlayerState.createPlayerState() acima e comeca
      // em 1). Enquanto o Bot nao acerta nenhuma nota (proximas
      // etapas), permanece no valor minimo, igual ao `maxMultiplier`.
      multiplier: 1,
    };
  }

  // ---------------------------------------------------------------------
  // ETAPA 14B -- configuracao de comportamento (ver comentario do topo).
  // ---------------------------------------------------------------------

  /**
   * Config padrao do Bot. Congelada (Object.freeze) para que ninguem
   * altere os valores padrao por engano -- quem precisa de uma config
   * diferente usa `createConfig(overrides)`, que devolve um objeto NOVO.
   */
  const DEFAULT_CONFIG = Object.freeze({
    reactionTimeMs: 120,
    judgementOffsetMs: 0,
    mistakeChance: 0,
    seed: 1,
  });

  /**
   * Mescla `overrides` sobre `DEFAULT_CONFIG`. Funcao pura: nunca muta
   * `DEFAULT_CONFIG` nem `overrides`, sempre devolve um objeto novo.
   *
   * @param {{reactionTimeMs?:number, judgementOffsetMs?:number, mistakeChance?:number, seed?:number}} [overrides]
   * @returns {object}
   */
  function createConfig(overrides) {
    return { ...DEFAULT_CONFIG, ...(overrides || {}) };
  }

  /**
   * ETAPA 14D (PARTE 1) -- resolve uma config COMPLETA do Bot a partir
   * de um preset de dificuldade (`presets[difficulty]`), com
   * `overrides` opcionais mesclados por cima (mesma regra de
   * `createConfig`). Funcao pura: nunca muta `presets`/`overrides`, e
   * sempre devolve um objeto NOVO (nenhuma referencia compartilhada
   * entre chamadas nem com `DEFAULT_CONFIG`).
   *
   * So a PONTE entre "identificador de dificuldade" e "config do Bot"
   * -- este modulo continua sem saber o que e EASY/MEDIUM/HARD
   * (nenhuma dessas strings existe aqui; quem chama passa o
   * identificador e o mapa de presets, ex:
   * `ClientConfig.BOT_DIFFICULTY.EASY` e
   * `ClientConfig.BOT_DIFFICULTY_PRESETS`, ambos em config.js).
   * `create`/`reset`/`decideForNote`/`decideTimeline` continuam
   * recebendo config normalmente, exatamente como se ela tivesse sido
   * escrita a mao -- nenhum segundo caminho de config e criado.
   *
   * Um `difficulty` desconhecido (ou `presets` omitido) nao lanca erro:
   * comporta-se como se nenhum preset existisse, e o resultado e
   * apenas `createConfig(overrides)` (cai no `DEFAULT_CONFIG` mesclado
   * com os overrides, se houver).
   *
   * @param {{[key:string]: object}} [presets] - ex: ClientConfig.BOT_DIFFICULTY_PRESETS
   * @param {string} [difficulty] - ex: ClientConfig.BOT_DIFFICULTY.EASY
   * @param {object} [overrides] - mesclado por cima do preset (por ultimo, vence)
   * @returns {object} config completa, mesmo formato de createConfig/DEFAULT_CONFIG
   */
  function createConfigForDifficulty(presets, difficulty, overrides) {
    const preset = (presets && difficulty && presets[difficulty]) || {};
    return createConfig({ ...preset, ...(overrides || {}) });
  }

  /**
   * Instante (epoch ms) em que o Bot tentaria agir sobre esta nota.
   *
   *   actionTime = note.time + reactionTimeMs + judgementOffsetMs
   *
   * Deterministico: mesma nota + mesma config sempre produz o mesmo
   * resultado (nenhum relogio real/Date.now envolvido).
   *
   * @param {{time:number}} note
   * @param {object} [config] - ex: DEFAULT_CONFIG ou createConfig(...)
   * @returns {number}
   */
  function computeActionTime(note, config) {
    const cfg = config || DEFAULT_CONFIG;
    const reactionTimeMs = Number.isFinite(cfg.reactionTimeMs)
      ? cfg.reactionTimeMs
      : DEFAULT_CONFIG.reactionTimeMs;
    const judgementOffsetMs = Number.isFinite(cfg.judgementOffsetMs)
      ? cfg.judgementOffsetMs
      : DEFAULT_CONFIG.judgementOffsetMs;

    return note.time + reactionTimeMs + judgementOffsetMs;
  }

  /**
   * Decide, de forma deterministica, se o Bot "erra de proposito" esta
   * nota (equivalente a uma tecla errada de um jogador humano -- vira
   * MISTAKE, nunca MISS).
   *
   * Nao usa Math.random(): reaproveita
   * SequenceGenerator.createSeededRandom (mesmo gerador ja usado para a
   * sequencia de notas do projeto), semeado com `config.seed + note.index`.
   * A MESMA nota com a MESMA config sempre produz a MESMA decisao, em
   * qualquer maquina/execucao -- e o que torna os testes reproduziveis.
   *
   * `mistakeChance` <= 0 nunca erra; >= 1 sempre erra (sem gastar
   * nenhum sorteio nesses dois casos extremos).
   *
   * @param {{index:number}} note
   * @param {object} [config]
   * @returns {boolean}
   */
  function rollMistake(note, config) {
    const cfg = config || DEFAULT_CONFIG;
    const chance = Number.isFinite(cfg.mistakeChance) ? cfg.mistakeChance : DEFAULT_CONFIG.mistakeChance;

    if (chance <= 0) return false;
    if (chance >= 1) return true;

    const seed = Number.isFinite(cfg.seed) ? cfg.seed : DEFAULT_CONFIG.seed;
    const random = SequenceGeneratorRef.createSeededRandom(seed + note.index);
    return random() < chance;
  }

  /**
   * Decisao completa do Bot para UMA nota da timeline: se ele erra de
   * proposito (`mistake`/`MISTAKE`) ou, caso contrario, quando tentaria
   * agir (`actionTime`) e qual julgamento isso resultaria
   * (`judgement`/`outcome`), calculado via `Judgement.classify` -- a
   * MESMA fonte de julgamento do jogador humano (nenhum valor
   * reimplementado aqui).
   *
   * Funcao pura: nunca muta `note` nem nenhum objeto recebido.
   *
   * @param {{id:string,index:number,lane:number,time:number}} note
   * @param {object} options
   * @param {object} [options.config] - ex: DEFAULT_CONFIG ou createConfig(...)
   * @param {{perfectMs:number, greatMs?:number, goodMs:number}} options.windows -
   *   OBRIGATORIO, ex: ClientConfig.JUDGEMENT_WINDOWS (mesma fonte usada
   *   por GameplayEngine) -- este modulo nunca inventa suas proprias janelas.
   * @returns {{noteId:string, lane:number, noteIndex:number, actionTime:(number|null),
   *   deltaMs:(number|null), judgement:(string|null), mistake:boolean, outcome:string}}
   */
  function decideForNote(note, options) {
    const config = (options && options.config) || DEFAULT_CONFIG;
    const windows = options && options.windows;

    if (!windows) {
      throw new Error(
        'BotController.decideForNote: "windows" e obrigatorio (ex: ClientConfig.JUDGEMENT_WINDOWS).'
      );
    }

    if (rollMistake(note, config)) {
      return {
        noteId: note.id,
        lane: note.lane,
        noteIndex: note.index,
        actionTime: null,
        deltaMs: null,
        judgement: null,
        mistake: true,
        outcome: 'MISTAKE',
      };
    }

    const actionTime = computeActionTime(note, config);
    const deltaMs = actionTime - note.time;
    const judgement = JudgementRef.classify(deltaMs, windows) || JudgementRef.JUDGEMENT_RESULT.MISS;

    return {
      noteId: note.id,
      lane: note.lane,
      noteIndex: note.index,
      actionTime,
      deltaMs,
      judgement,
      mistake: false,
      outcome: judgement,
    };
  }

  /**
   * Decisao do Bot para TODAS as notas de uma timeline, numa lista
   * NOVA -- nunca muta `timeline` nem nenhuma nota dela (`decideForNote`
   * so LE `note.id`/`note.index`/`note.lane`/`note.time`, nunca
   * escreve). Uma timeline sem notas (ou invalida) devolve `[]`.
   *
   * @param {Array} timeline - ex: MatchTimelineManager.ensureTimeline(...)
   * @param {object} options - mesmos parametros de `decideForNote`
   * @returns {Array}
   */
  function decideTimeline(timeline, options) {
    if (!Array.isArray(timeline)) return [];
    return timeline.map((note) => decideForNote(note, options));
  }

  /**
   * Cria uma nova instancia de Bot (estado inicial zerado).
   *
   * ETAPA 14B: tambem guarda a config de comportamento do Bot
   * (`bot.config`, ver DEFAULT_CONFIG/createConfig acima) -- so um
   * lugar conveniente para carregar `reactionTimeMs`/`mistakeChance`/
   * `judgementOffsetMs`/`seed` junto da instancia; nada nesta etapa lê
   * `bot.config` automaticamente (quem quiser decidir notas continua
   * chamando `decideForNote`/`decideTimeline` explicitamente).
   *
   * @param {{active?: boolean, config?: object}} [options]
   * @returns {{state: object, config: object}}
   */
  function create(options) {
    return {
      state: createInitialState(options),
      config: createConfig(options && options.config),
    };
  }

  /**
   * Reseta um Bot ja existente de volta ao estado inicial zerado
   * (substitui o estado inteiro -- nenhum campo antigo sobrevive) e
   * recria a config a partir de `options.config` (ou do padrao, se
   * omitido).
   *
   * @param {{state: object, config: object}} bot
   * @param {{active?: boolean, config?: object}} [options]
   * @returns {{state: object, config: object}} o mesmo `bot` recebido, renovado
   */
  function reset(bot, options) {
    if (!bot) return bot;
    bot.state = createInitialState(options);
    bot.config = createConfig(options && options.config);
    return bot;
  }

  /**
   * Ponto de entrada unico, por "tick"/frame, para a logica do Bot.
   *
   * ETAPA 14A: propositalmente um no-op. Nao ha ainda tempo de reacao,
   * chance de erro, julgamento de notas, pontuacao automatica nem
   * dificuldade -- so a ASSINATURA da funcao existe, para que as
   * proximas etapas possam preencher o comportamento sem quebrar quem
   * ja chama `update()`. Nao lanca erro se `bot` for invalido; apenas
   * devolve o valor recebido sem tocar em nada.
   *
   * @param {{state: object}} bot
   * @param {number} [currentTime] - reservado para uso futuro
   * @returns {{state: object}} o mesmo `bot` recebido, sem nenhuma alteracao
   */
  function update(bot, currentTime) { // eslint-disable-line no-unused-vars
    if (!bot) return bot;
    return bot;
  }

  /**
   * Retrato (snapshot) do estado atual do Bot -- uma copia, nao a
   * referencia interna, para que quem consome `getState()` no resto do
   * cliente nunca altere o estado do Bot por engano.
   *
   * @param {{state: object}} bot
   * @returns {object|null} copia do estado, ou `null` se `bot` for invalido
   */
  function getState(bot) {
    if (!bot || !bot.state) return null;
    return { ...bot.state };
  }

  const api = {
    create,
    reset,
    update,
    getState,
    // ETAPA 14B -- nucleo de reacao/julgamento (ver comentario do topo).
    DEFAULT_CONFIG,
    createConfig,
    // ETAPA 14D (PARTE 1) -- preparacao de dificuldade (ver comentario acima).
    createConfigForDifficulty,
    computeActionTime,
    rollMistake,
    decideForNote,
    decideTimeline,
  };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
