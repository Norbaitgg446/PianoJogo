/**
 * Motor de notas (Etapa 4A).
 *
 * Responsavel por transformar a sequencia deterministica ja existente
 * (SequenceGenerator, a partir da seed enviada pelo servidor) em uma
 * "timeline" de objetos de nota, cada um com um tempo absoluto
 * (epoch ms, no mesmo relogio de referencia do servidor usado pelo
 * MatchController) e uma maquina de estados simples.
 *
 * Este modulo NAO sabe nada sobre:
 * - DOM / interface visual do piano;
 * - animacoes ou efeitos;
 * - audio/musica;
 * - pontuacao, combo, ranking, habilidades, vitoria/derrota.
 *
 * Ele apenas produz e gerencia os dados das notas. A camada visual
 * (proxima etapa) vai ler esses dados para desenhar/animar.
 *
 * IMPORTANTE: nao reimplementa nenhuma logica de aleatoriedade. Toda a
 * geracao pseudoaleatoria continua vindo do SequenceGenerator ja
 * existente (client/js/match/sequenceGenerator.js) — a mesma seed usada
 * ali produz aqui exatamente a mesma sequencia, nos dois jogadores.
 */
const NoteEngine = (() => {
  // Em Node (testes automatizados) o SequenceGenerator precisa ser
  // importado via require. No navegador ele ja existe como variavel
  // global, carregada por <script> antes deste arquivo em index.html —
  // por isso a referencia bare `SequenceGenerator` no branch else.
  const SequenceGeneratorRef =
    typeof module !== 'undefined' && module.exports
      ? require('./sequenceGenerator')
      : SequenceGenerator;

  // Estados possiveis de uma nota.
  const NOTE_STATE = {
    PENDING: 'pending', // ainda nao chegou a janela de julgamento
    ACTIVE: 'active', // dentro da janela de julgamento, aguardando input
    HIT: 'hit', // processada com sucesso (estado final)
    MISSED: 'missed', // passou da janela sem ser atingida (estado final)
  };

  // Estados finais: uma vez atingidos, a nota nunca muda de estado de novo.
  // E o que garante que "a mesma nota nao pode ser processada duas vezes".
  const TERMINAL_STATES = new Set([NOTE_STATE.HIT, NOTE_STATE.MISSED]);

  const VALID_STATES = new Set(Object.values(NOTE_STATE));

  /**
   * ID deterministico da nota: mesma seed + mesmo indice => mesmo id,
   * sempre, nos dois clientes.
   */
  function buildNoteId(seed, index) {
    return `note-${seed}-${index}`;
  }

  /**
   * Gera a timeline completa de notas de uma partida.
   *
   * @param {object} options
   * @param {number} options.seed - seed da partida (a mesma dos dois jogadores).
   * @param {number} options.startTimestamp - epoch ms (relogio do servidor)
   *   em que a partida comeca. Deve vir do fluxo de sincronizacao ja
   *   existente (match_started / MatchController), nunca do relogio local.
   * @param {number} options.length - quantidade de notas a gerar.
   * @param {number} options.noteRange - quantidade de lanes/teclas (1..noteRange).
   * @param {number} options.noteIntervalMs - intervalo fixo (ms) entre notas
   *   consecutivas. Configuravel (ver ClientConfig.NOTE_INTERVAL_MS).
   * @param {number} [options.leadInMs] - atraso extra (ms) antes da primeira
   *   nota, somado ao startTimestamp. Default 0.
   * @returns {Array<{id:string,index:number,lane:number,time:number,state:string}>}
   */
  function generateNoteTimeline({
    seed,
    startTimestamp,
    length,
    noteRange,
    noteIntervalMs,
    leadInMs = 0,
  }) {
    if (!Number.isFinite(seed)) {
      throw new Error('NoteEngine: seed invalida.');
    }
    if (!Number.isFinite(startTimestamp)) {
      throw new Error('NoteEngine: startTimestamp invalido.');
    }
    if (!Number.isInteger(length) || length <= 0) {
      throw new Error('NoteEngine: length invalido.');
    }
    if (!Number.isInteger(noteRange) || noteRange <= 0) {
      throw new Error('NoteEngine: noteRange invalido.');
    }
    if (!Number.isFinite(noteIntervalMs) || noteIntervalMs <= 0) {
      throw new Error('NoteEngine: noteIntervalMs invalido.');
    }

    // Reutiliza o gerador deterministico ja existente. Nao ha aqui
    // nenhum novo sistema de aleatoriedade.
    const sequence = SequenceGeneratorRef.generateSequence(seed, length, noteRange);

    return sequence.map((lane, index) => ({
      id: buildNoteId(seed, index),
      index,
      lane,
      time: startTimestamp + leadInMs + index * noteIntervalMs,
      state: NOTE_STATE.PENDING,
    }));
  }

  function getNoteById(timeline, noteId) {
    return timeline.find((note) => note.id === noteId) || null;
  }

  function isTerminal(state) {
    return TERMINAL_STATES.has(state);
  }

  /**
   * Tenta transicionar uma nota especifica para um novo estado.
   *
   * Regras:
   * - Nota inexistente => nao faz nada, retorna false.
   * - Nota ja em estado final (hit/missed) => nao faz nada, retorna false.
   *   Isso e o que impede a mesma nota de ser processada duas vezes.
   * - Estado de destino invalido => nao faz nada, retorna false.
   * - Caso contrario, aplica a mudanca e retorna true.
   *
   * @param {Array} timeline
   * @param {string} noteId
   * @param {string} newState
   * @returns {boolean} se a transicao foi aplicada
   */
  function setNoteState(timeline, noteId, newState) {
    if (!VALID_STATES.has(newState)) return false;

    const note = getNoteById(timeline, noteId);
    if (!note) return false;
    if (isTerminal(note.state)) return false;

    note.state = newState;
    return true;
  }

  /**
   * Atualiza automaticamente os estados "pending -> active" e
   * "(pending|active) -> missed" com base no tempo atual, usando a
   * mesma janela de julgamento (hitWindowMs) para todas as notas.
   *
   * `currentTime` deve ser calculado no mesmo relogio de referencia do
   * startTimestamp (ver MatchController.startCountdown / clockOffset),
   * nunca em `Date.now()` puro de cada jogador isoladamente.
   *
   * Notas ja em estado final sao ignoradas (nunca reprocessadas).
   *
   * @param {Array} timeline
   * @param {number} currentTime - epoch ms estimado do relogio do servidor
   * @param {number} hitWindowMs - janela (ms) para tras/frente do tempo da nota
   * @returns {Array} a propria timeline (mutada in-place), por conveniencia
   */
  function updateTimelineStates(timeline, currentTime, hitWindowMs) {
    for (const note of timeline) {
      if (isTerminal(note.state)) continue;

      const activatesAt = note.time - hitWindowMs;
      const expiresAt = note.time + hitWindowMs;

      if (currentTime > expiresAt) {
        note.state = NOTE_STATE.MISSED;
      } else if (currentTime >= activatesAt && note.state === NOTE_STATE.PENDING) {
        note.state = NOTE_STATE.ACTIVE;
      }
    }
    return timeline;
  }

  const api = {
    NOTE_STATE,
    buildNoteId,
    generateNoteTimeline,
    getNoteById,
    setNoteState,
    updateTimelineStates,
    isTerminal,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  return api;
})();
