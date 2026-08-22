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
 */
const MatchEndDetector = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;
  const NoteEngineRef = isNode ? require('./noteEngine') : NoteEngine;

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
   */
  function createMatchEndDetector({ timeline, onMatchEnd }) {
    const emit = typeof onMatchEnd === 'function' ? onMatchEnd : () => {};
    let ended = false;

    /**
     * Verifica se a timeline terminou e, se for a PRIMEIRA vez que isso
     * e detectado, dispara `onMatchEnd` e marca a partida como
     * encerrada.
     *
     * Seguro chamar quantas vezes for preciso (ex: a cada frame do
     * mesmo loop que ja varre notas expiradas) -- depois da primeira
     * deteccao, chamadas seguintes nao fazem nada e nao re-emitem o
     * evento, o que impede: finalizar duas vezes, disparar multiplos
     * eventos, ou criar multiplos timers a partir do callback.
     *
     * @returns {boolean} true somente na chamada que efetivamente
     *   detectou e disparou o fim da partida; false em qualquer outro
     *   caso (partida ja encerrada antes, ou ainda ha nota pendente/ativa).
     */
    function checkForEnd() {
      if (ended) return false;
      if (!isTimelineFinished(timeline)) return false;

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

    return { checkForEnd, hasEnded, reset };
  }

  const api = { isTimelineFinished, createMatchEndDetector };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
