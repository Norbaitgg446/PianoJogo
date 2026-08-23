/**
 * Motor de interacao do jogador com as notas (Etapa 4B).
 *
 * Junta o NoteEngine (Etapa 4A), o Judgement e o PlayerState para
 * processar duas coisas:
 *
 * 1. `handleKeyPress(lane, currentTime)` -- o jogador pressionou uma
 *    tecla/lane em um determinado instante. Decide PERFECT, GOOD ou
 *    "erro" (tecla errada / fora da janela), atualiza o PlayerState
 *    DESTE jogador (nunca o do oponente) e devolve um evento leve para
 *    ser enviado ao servidor.
 *
 * 2. `processExpiredNotes(currentTime, hitWindowMs)` -- verifica quais
 *    notas passaram do tempo maximo sem ser atingidas (MISS) e atualiza
 *    o PlayerState/gera evento para cada uma, sem jamais reprocessar
 *    uma nota que ja tenha virado hit/missed antes.
 *
 * Este modulo NAO manda mensagem nenhuma sozinho: quem cria a engine
 * decide (via `sendEvent`) o que fazer com o evento -- normalmente
 * `SocketClient.send`. Isso mantem a camada de rede isolada, como no
 * resto do projeto, e permite testar toda a logica em Node sem
 * WebSocket/DOM nenhum.
 *
 * Nao ha nenhuma logica visual, de animacao, audio ou pontuacao com
 * multiplicadores complexos aqui -- apenas a interacao basica pedida
 * na Etapa 4B.
 */
const GameplayEngine = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;
  const NoteEngineRef = isNode ? require('./noteEngine') : NoteEngine;
  const JudgementRef = isNode ? require('./judgement') : Judgement;
  const PlayerStateRef = isNode ? require('./playerState') : PlayerState;

  /**
   * @param {object} options
   * @param {Array} options.timeline - timeline de notas (gerada pelo NoteEngine)
   * @param {object} options.playerState - estado DESTE jogador (PlayerState.createPlayerState())
   * @param {{perfectMs:number, greatMs?:number, goodMs:number}} options.windows - janelas de julgamento
   * @param {{PERFECT:number, GREAT?:number, GOOD:number, MISS:number}} options.scoreValues
   * @param {(type:string, payload:object) => void} [options.sendEvent] - callback de rede (ex: SocketClient.send)
   * @param {Array<{minCombo:number, multiplier:number}>} [options.comboMultiplierTiers] - ETAPA 13C,
   *   ex: ClientConfig.COMBO_MULTIPLIER.TIERS. Omitido => multiplicador sempre 1 (igual a antes).
   * @param {{MISTAKE?:number, MISS?:number}} [options.penalties] - ETAPA 13C, ex:
   *   ClientConfig.PENALTIES. Omitido => nenhuma penalizacao de pontos (igual a antes).
   */
  function createGameplayEngine({
    timeline,
    playerState,
    windows,
    scoreValues,
    sendEvent,
    comboMultiplierTiers,
    penalties,
  }) {
    const emit = typeof sendEvent === 'function' ? sendEvent : () => {};
    const mistakePenalty = penalties && penalties.MISTAKE;
    const missPenalty = penalties && penalties.MISS;

    /**
     * Processa uma tentativa de acerto do jogador.
     *
     * @returns {{outcome:string, lane:number, noteId:string|null, judgement:string|null}}
     *   outcome e um de: 'PERFECT', 'GOOD', 'MISTAKE'.
     */
    function handleKeyPress(lane, currentTime) {
      const candidate = JudgementRef.findJudgeableNote(timeline, lane, currentTime, windows);

      if (!candidate) {
        // Tecla errada (sem nenhuma nota candidata naquela lane) ou
        // dentro da lane certa porem fora de qualquer janela valida.
        PlayerStateRef.registerMistake(playerState, mistakePenalty);
        return { outcome: 'MISTAKE', lane, noteId: null, judgement: null };
      }

      const deltaMs = currentTime - candidate.time;
      const judgement = JudgementRef.classify(deltaMs, windows);

      // Reivindica a nota. Se outra chamada ja tiver processado essa
      // MESMA nota entre o findJudgeableNote e aqui, setNoteState
      // retorna false e nao aplicamos nada duas vezes.
      const applied = NoteEngineRef.setNoteState(timeline, candidate.id, NoteEngineRef.NOTE_STATE.HIT);
      if (!applied) {
        PlayerStateRef.registerMistake(playerState, mistakePenalty);
        return {
          outcome: 'MISTAKE',
          lane,
          noteId: candidate.id,
          judgement: null,
          reason: 'note_already_processed',
        };
      }

      PlayerStateRef.registerHit(playerState, judgement, scoreValues, comboMultiplierTiers);

      emit('note_hit', {
        noteId: candidate.id,
        lane,
        judgement,
        deltaMs,
        combo: playerState.combo,
        score: playerState.score,
      });

      return { outcome: judgement, lane, noteId: candidate.id, judgement, deltaMs };
    }

    /**
     * Verifica a timeline em busca de notas que passaram do tempo
     * maximo sem ter sido atingidas, marca cada uma como MISS (via
     * NoteEngine) exatamente uma vez, atualiza o PlayerState e emite
     * um evento leve por nota perdida.
     *
     * @param {number} currentTime
     * @param {number} hitWindowMs - mesma janela usada pelo NoteEngine (ex: ClientConfig.NOTE_HIT_WINDOW_MS)
     * @returns {Array} as notas que viraram "missed" nesta chamada
     */
    function processExpiredNotes(currentTime, hitWindowMs) {
      const alreadyTerminalIds = new Set(
        timeline.filter((note) => NoteEngineRef.isTerminal(note.state)).map((note) => note.id)
      );

      NoteEngineRef.updateTimelineStates(timeline, currentTime, hitWindowMs);

      const newlyMissed = timeline.filter(
        (note) => note.state === NoteEngineRef.NOTE_STATE.MISSED && !alreadyTerminalIds.has(note.id)
      );

      newlyMissed.forEach((note) => {
        PlayerStateRef.registerMiss(playerState, missPenalty);
        emit('note_miss', {
          noteId: note.id,
          lane: note.lane,
          combo: playerState.combo,
          misses: playerState.misses,
        });
      });

      return newlyMissed;
    }

    return { handleKeyPress, processExpiredNotes };
  }

  const api = { createGameplayEngine };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  return api;
})();
