/**
 * Deteccao do fim de partida (Etapa 5B-4A).
 *
 * Responsabilidade unica: decidir QUANDO a partida terminou, olhando
 * exclusivamente para o estado real da timeline ja existente (a mesma
 * instancia mantida por MatchTimelineManager/NoteEngine, ja mutada in
 * -place por GameplayEngine durante o jogo).
 *
 * Regra de termino: a partida acaba quando TODAS as notas da timeline
 * estao em um estado terminal (hit ou missed) -- ver
 * NoteEngine.isTerminal, ja existente desde a Etapa 4A. Nenhuma logica
 * nova de "processada" e criada aqui; este modulo so agrega o que o
 * NoteEngine ja sabe sobre cada nota individual.
 *
 * NAO decide isso a partir de:
 * - a nota ter saido visualmente da tela (isso e NoteRenderer, uma
 *   camada puramente visual que roda sua propria janela de remocao);
 * - score, combo, hits/misses de PlayerState;
 * - tempo decorrido / "espera X segundos depois de tal mensagem".
 *
 * MULTIPLAYER: os dois jogadores compartilham a MESMA timeline (mesma
 * seed + mesmo startTimestamp, ver MatchTimelineManager), mas cada nota
 * so vira hit/missed a partir do que ACONTECE NAQUELE CLIENTE -- hit
 * quando o jogador LOCAL acerta (GameplayEngine.handleKeyPress) e
 * missed quando o tempo dela expira (GameplayEngine.processExpiredNotes,
 * que roda para AMBOS os jogadores, ja que e baseado no relogio
 * sincronizado, nao em quem apertou o que). Isso e o que garante que a
 * timeline de cada cliente conclui no mesmo instante (mesmo relogio),
 * mesmo que o NUMERO de hits/misses de cada jogador seja diferente --
 * este modulo nunca compara os dois jogadores entre si nem olha para
 * PlayerState, entao um resultado 90 hits/10 misses e outro 80/20 sobre
 * a MESMA timeline terminam exatamente juntos.
 *
 * Este modulo NAO sabe nada sobre DOM, WebSocket, InputController,
 * NoteRenderer ou loops de animacao -- quem usa (main.js) decide o que
 * fazer no callback `onMatchEnd` (parar loops, bloquear input, etc).
 * Isso mantem a deteccao 100% testavel em Node puro, isolada do resto
 * do ciclo de vida da partida.
 *
 * ETAPA 15A (PARTE 1): `createMatchEndDetector` agora tambem aceita um
 * `durationMs` opcional, apenas armazenado (ver `getDurationMs()`) para
 * uma proxima parte da Etapa 15 usar. Regra de termino continua sendo
 * SOMENTE a timeline (acima) -- nenhuma partida termina mais cedo por
 * causa de `durationMs` ainda.
 *
 * ETAPA 15C-1B: `checkForEnd` agora tambem considera a duracao maxima,
 * reutilizando `MatchDuration.hasReachedMatchDuration` (nenhuma logica
 * de tempo duplicada aqui -- ver matchDuration.js). A regra conceitual
 * passa a ser "timeline terminou OU duracao maxima foi atingida", mas
 * SOMENTE quando o chamador fornece os tres ingredientes necessarios
 * (`startTime` na criacao do detector, `durationMs` na criacao do
 * detector, e `currentTime` em cada chamada de `checkForEnd`). Sem
 * qualquer um desses tres, `hasReachedMatchDuration` recebe argumento(s)
 * `undefined` e devolve `false` (ver sua propria defensividade), entao
 * o comportamento antigo (fim SOMENTE pela timeline) e preservado
 * automaticamente -- nenhum "if" extra precisou ser escrito para isso.
 *
 * Este modulo continua SEM relogio proprio: nunca le o relogio do
 * sistema nem inicia timers/intervalos. `currentTime` e sempre o que o
 * chamador decidir passar para `checkForEnd(currentTime)`.
 */
const MatchEndDetector = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;
  const NoteEngineRef = isNode ? require('./noteEngine') : NoteEngine;
  const MatchDurationRef = isNode ? require('./matchDuration') : MatchDuration;

  /**
   * Se TODAS as notas da timeline ja estao em estado terminal
   * (hit ou missed). Uma timeline vazia/invalida nunca e considerada
   * concluida (protege contra checar antes da timeline existir).
   *
   * @param {Array} timeline
   * @returns {boolean}
   */
  function isTimelineFinished(timeline) {
    if (!Array.isArray(timeline) || timeline.length === 0) return false;
    return timeline.every((note) => NoteEngineRef.isTerminal(note.state));
  }

  /**
   * Cria um detector de fim de partida ligado a UMA timeline especifica
   * (a mesma instancia usada pelo GameplayEngine do jogador local).
   *
   * Uma nova partida deve chamar esta factory de novo (uma instancia
   * nova por partida, exatamente como GameplayEngine/PlayerState ja
   * fazem hoje em main.js) -- assim o reset entre partidas acontece
   * naturalmente, sem nenhum estado global sobrando da partida anterior.
   *
   * @param {object} options
   * @param {Array} options.timeline - timeline da partida (NoteEngine.generateNoteTimeline)
   * @param {() => void} [options.onMatchEnd] - chamado exatamente UMA vez,
   *   na primeira chamada de checkForEnd() em que a timeline estiver
   *   inteiramente concluida.
   * @param {number} [options.durationMs] - ETAPA 15A (PARTE 1) / 15C-1B:
   *   duracao maxima (ms) desta partida. Sem `startTime` (abaixo) e sem
   *   `currentTime` (passado a cada `checkForEnd`), fica apenas
   *   armazenado (ver `getDurationMs()`), sem nenhum efeito -- exatamente
   *   como na Etapa 15A. Omitido => `undefined`, sem nenhuma mudanca de
   *   comportamento.
   * @param {number} [options.startTime] - ETAPA 15C-1B: instante em que a
   *   partida comecou, na MESMA unidade/relogio que sera passado como
   *   `currentTime` a `checkForEnd`. So e usado junto com `durationMs`
   *   para calcular se a duracao maxima foi atingida (via
   *   `MatchDuration.hasReachedMatchDuration`); nunca lido do relogio do
   *   sistema por este modulo. Omitido => `undefined`, sem nenhuma
   *   mudanca de comportamento.
   */
  function createMatchEndDetector({ timeline, onMatchEnd, durationMs, startTime }) {
    const emit = typeof onMatchEnd === 'function' ? onMatchEnd : () => {};
    let ended = false;

    /**
     * Verifica se a partida deve ser considerada encerrada e, se for a
     * PRIMEIRA vez que isso e detectado, dispara `onMatchEnd` e marca a
     * partida como encerrada.
     *
     * Encerra quando: a timeline terminou (todas as notas em estado
     * terminal, como sempre) OU a duracao maxima foi atingida (ETAPA
     * 15C-1B, via `MatchDuration.hasReachedMatchDuration` -- reutilizada
     * aqui, nunca reimplementada). A checagem de duracao so acontece
     * quando `durationMs`/`startTime` (fornecidos na criacao) e
     * `currentTime` (fornecido aqui) estao TODOS presentes; caso
     * contrario `hasReachedMatchDuration` devolve `false` por sua propria
     * defensividade, preservando o comportamento antigo (fim SOMENTE
     * pela timeline) sem nenhuma logica condicional extra neste modulo.
     *
     * Seguro chamar quantas vezes for preciso (ex: a cada frame do
     * mesmo loop que ja varre notas expiradas) -- depois da primeira
     * deteccao, chamadas seguintes nao fazem nada e nao re-emitem o
     * evento, o que impede: finalizar duas vezes, disparar multiplos
     * eventos, ou criar multiplos timers a partir do callback.
     *
     * @param {number} [currentTime] - ETAPA 15C-1B: instante atual, na
     *   MESMA unidade/relogio de `startTime`. Este modulo NUNCA le esse
     *   valor sozinho (sem ler relogio do sistema) -- quem chama
     *   `checkForEnd` e responsavel por fornece-lo. Omitido => nenhuma
     *   checagem de duracao acontece nesta chamada (equivalente a nao
     *   informar `durationMs`).
     * @returns {boolean} true somente na chamada que efetivamente
     *   detectou e disparou o fim da partida; false em qualquer outro
     *   caso (partida ja encerrada antes, ou ainda nao atingiu nenhuma
     *   das duas condicoes de termino).
     */
    function checkForEnd(currentTime) {
      if (ended) return false;

      const timelineDone = isTimelineFinished(timeline);
      const durationReached = MatchDurationRef.hasReachedMatchDuration(
        currentTime,
        startTime,
        durationMs
      );

      if (!timelineDone && !durationReached) return false;

      ended = true;
      emit();
      return true;
    }

    /**
     * Se esta instancia ja detectou o fim da partida.
     */
    function hasEnded() {
      return ended;
    }

    /**
     * Reseta esta instancia para o estado "nao encerrada". Nao e
     * necessario no fluxo normal (uma partida nova cria uma instancia
     * nova via createMatchEndDetector), mas fica disponivel para quem
     * preferir reaproveitar a mesma instancia explicitamente.
     */
    function reset() {
      ended = false;
    }

    /**
     * ETAPA 15A (PARTE 1): devolve o `durationMs` recebido na criacao
     * deste detector (ou `undefined` se nenhum foi informado). So
     * leitura -- nada dentro deste modulo consome este valor ainda.
     */
    function getDurationMs() {
      return durationMs;
    }

    return { checkForEnd, hasEnded, reset, getDurationMs };
  }

  const api = { isTimelineFinished, createMatchEndDetector };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
