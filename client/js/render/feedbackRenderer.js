/**
 * Camada visual de feedback dos julgamentos (Etapa 5B-3B).
 *
 * Este modulo NAO julga nada, NAO calcula score/combo e NAO decide
 * PERFECT/GOOD/MISS/MISTAKE -- ele so RECEBE o resultado que o
 * GameplayEngine/PlayerState ja calcularam (via main.js) e mostra isso
 * na tela: um texto de julgamento perto das teclas, o score e o combo
 * atuais.
 *
 * Fluxo (nenhuma logica de jogo mora aqui):
 *
 *   GameplayEngine.handleKeyPress(...) -> {outcome}         -\
 *   GameplayEngine.processExpiredNotes(...) -> notas MISS    |-> main.js -> FeedbackRenderer (este arquivo) -> DOM
 *   PlayerState.score / PlayerState.combo (via playerState) -/
 *
 * Cada jogador (`player1` / `player2`) tem seu proprio conjunto de
 * elementos na tela (ver index.html: `${slot}-score`, `${slot}-combo`,
 * `${slot}-feedback`). Este cliente so escreve no slot do jogador
 * LOCAL (`currentSlot`, decidido por main.js) -- nunca no do
 * adversario, o que garante o isolamento pedido na Etapa 5B-3B.
 */
const FeedbackRenderer = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;

  // ---- Rotulos/estilos por resultado. Nenhuma logica nova de MISS ----
  // ---- ou MISTAKE: so como CADA resultado ja existente e exibido.  ----
  const JUDGEMENT_LABELS = {
    PERFECT: 'PERFECT',
    GOOD: 'GOOD',
    MISS: 'MISS',
    MISTAKE: 'ERRO', // distinto de MISS: erro de tecla != nota perdida por tempo
  };

  const JUDGEMENT_CLASS = {
    PERFECT: 'judgement-perfect',
    GOOD: 'judgement-good',
    MISS: 'judgement-miss',
    MISTAKE: 'judgement-mistake',
  };

  // Quanto tempo (ms) o texto de julgamento fica visivel antes de
  // comecar a desaparecer -- "rapido", como pedido no enunciado.
  const FEEDBACK_VISIBLE_MS = 550;
  // Quanto tempo (ms) o "flash" opcional na propria nota acertada/perdida
  // fica visivel (Etapa 5B-3B, item 8) antes de ser removido -- so um
  // efeito visual leve, nunca mexe em note.state.
  const NOTE_FLASH_MS = 220;

  const NOTE_FLASH_CLASS = {
    HIT: 'note-flash-hit',
    MISS: 'note-flash-miss',
  };

  // Estado por slot (player1/player2): referencias de DOM ja resolvidas
  // + os ultimos valores exibidos, para so escrever no DOM quando o
  // score/combo realmente mudar.
  const slots = {};

  function isBrowser() {
    return typeof document !== 'undefined';
  }

  function getSlotState(slot) {
    if (!slots[slot]) {
      slots[slot] = {
        scoreEl: null,
        comboEl: null,
        feedbackEl: null,
        lastScore: null,
        lastCombo: null,
        feedbackHideTimeoutId: null,
        resolved: false,
      };
    }
    return slots[slot];
  }

  /**
   * Resolve (uma vez) os elementos de DOM deste slot. Se o DOM ainda
   * nao tiver esses elementos (ex: fora de uma partida), os campos
   * ficam null e as funcoes abaixo simplesmente nao fazem nada -- sem
   * lancar erro.
   */
  function ensureResolved(slot) {
    const state = getSlotState(slot);
    if (state.resolved || !isBrowser()) return state;

    state.scoreEl = document.getElementById(`${slot}-score`);
    state.comboEl = document.getElementById(`${slot}-combo`);
    state.feedbackEl = document.getElementById(`${slot}-feedback`);
    state.resolved = true;
    return state;
  }

  // ---------------------------------------------------------------------
  // Funcoes PURAS (sem DOM) -- testaveis isoladamente.
  // ---------------------------------------------------------------------

  function formatScore(score) {
    return `SCORE ${Number(score || 0).toLocaleString('pt-BR')}`;
  }

  function formatCombo(combo) {
    return `COMBO ${Number(combo || 0)}`;
  }

  function valueChanged(previous, next) {
    return previous !== next;
  }

  // ---------------------------------------------------------------------
  // Score / combo -- so leem o que PlayerState/GameplayEngine ja calculam.
  // ---------------------------------------------------------------------

  /**
   * Atualiza o score exibido para o slot indicado. So escreve no DOM
   * quando o valor realmente mudou desde a ultima chamada.
   */
  function updateScore(slot, score) {
    const state = ensureResolved(slot);
    if (!state.scoreEl) return;
    if (!valueChanged(state.lastScore, score)) return;

    state.lastScore = score;
    state.scoreEl.textContent = formatScore(score);
  }

  /**
   * Atualiza o combo exibido. Quando o combo cai para 0 (quebrado), o
   * indicador e escondido (classe `hidden`, ja usada no resto do
   * projeto) em vez de mostrar "COMBO 0" -- nenhum sistema de combo
   * novo, so a decisao de quando exibir o que o PlayerState ja tem.
   */
  function updateCombo(slot, combo) {
    const state = ensureResolved(slot);
    if (!state.comboEl) return;
    if (!valueChanged(state.lastCombo, combo)) return;

    state.lastCombo = combo;
    if (combo > 0) {
      state.comboEl.textContent = formatCombo(combo);
      state.comboEl.classList.remove('hidden');
    } else {
      state.comboEl.classList.add('hidden');
    }
  }

  // ---------------------------------------------------------------------
  // Feedback de julgamento (PERFECT/GOOD/MISS/ERRO).
  // ---------------------------------------------------------------------

  function clearJudgementClasses(el) {
    Object.values(JUDGEMENT_CLASS).forEach((cls) => el.classList.remove(cls));
    el.classList.remove('is-visible');
  }

  /**
   * Mostra o resultado de UM julgamento (ja decidido pelo GameplayEngine)
   * na area de feedback do slot indicado, com uma animacao curta de
   * entrada/saida, e agenda o proprio desaparecimento.
   *
   * Chamar de novo antes do anterior sumir substitui o texto/timer (nunca
   * acumula dois timers nem dois textos ao mesmo tempo para o mesmo slot).
   *
   * @param {string} slot - 'player1' | 'player2'
   * @param {'PERFECT'|'GOOD'|'MISS'|'MISTAKE'} outcome - resultado ja
   *   calculado por GameplayEngine.handleKeyPress ou processExpiredNotes.
   */
  function showJudgement(slot, outcome) {
    const label = JUDGEMENT_LABELS[outcome];
    if (!label) return; // outcome desconhecido: nao mostra nada, nao lanca erro

    const state = ensureResolved(slot);
    const el = state.feedbackEl;
    if (!el) return;

    if (state.feedbackHideTimeoutId) {
      clearTimeout(state.feedbackHideTimeoutId);
      state.feedbackHideTimeoutId = null;
    }

    clearJudgementClasses(el);
    // Forca reflow para a animacao CSS reiniciar mesmo se o MESMO
    // julgamento repetir rapido (ex: dois PERFECT seguidos).
    void el.offsetWidth;

    el.textContent = label;
    el.classList.add(JUDGEMENT_CLASS[outcome]);
    el.classList.add('is-visible');

    // Um UNICO timer agendado por chamada -- nunca um loop/rAF: o
    // feedback e um evento pontual, nao uma animacao continua.
    state.feedbackHideTimeoutId = setTimeout(() => {
      el.classList.remove('is-visible');
      state.feedbackHideTimeoutId = null;
    }, FEEDBACK_VISIBLE_MS);
  }

  /**
   * Efeito visual leve e OPCIONAL na propria nota (Etapa 5B-3B, item 8):
   * localiza o elemento visual que o NoteRenderer ja criou para esta
   * nota (via o mesmo `data-note-id` que ele ja usa) e aplica uma
   * classe transitoria. Nunca mexe em `note.state` nem em nenhum outro
   * dado da nota -- so um `classList` num elemento de DOM que o
   * NoteRenderer continua controlando (posicao/remocao) normalmente.
   * Se a nota ja tiver sido removida da tela, nao faz nada.
   *
   * @param {string} slot
   * @param {string|null} noteId
   * @param {'HIT'|'MISS'} kind
   */
  function flashNote(slot, noteId, kind) {
    if (!isBrowser() || !noteId) return;
    const flashClass = NOTE_FLASH_CLASS[kind];
    if (!flashClass) return;

    const playfield = document.getElementById(`${slot}-playfield`);
    if (!playfield) return;

    const noteEl = playfield.querySelector(`[data-note-id="${noteId}"]`);
    if (!noteEl) return;

    noteEl.classList.add(flashClass);
    setTimeout(() => noteEl.classList.remove(flashClass), NOTE_FLASH_MS);
  }

  /**
   * Limpa timers e caches de um slot (ou de todos, se nenhum slot for
   * passado). Chamado ao final/cancelamento da partida para nao deixar
   * nenhum timer pendente de uma partida antiga, e para forcar os
   * proximos updateScore/updateCombo a escrever de novo no DOM (evita
   * mostrar valores da partida anterior).
   *
   * @param {string} [slot]
   */
  function reset(slot) {
    const slotsToReset = slot ? [slot] : Object.keys(slots);

    slotsToReset.forEach((key) => {
      const state = slots[key];
      if (!state) return;

      if (state.feedbackHideTimeoutId) {
        clearTimeout(state.feedbackHideTimeoutId);
        state.feedbackHideTimeoutId = null;
      }
      if (state.feedbackEl) {
        clearJudgementClasses(state.feedbackEl);
        state.feedbackEl.textContent = '';
      }
      if (state.comboEl) {
        state.comboEl.classList.add('hidden');
      }

      // Descarta TODO o estado cacheado deste slot (nao so os valores) --
      // isso forca ensureResolved a re-consultar o DOM na proxima
      // chamada, em vez de continuar apontando para elementos antigos.
      // Isso importa tanto para o navegador de verdade (defensivo, caso
      // o DOM mude entre partidas) quanto para os testes automatizados
      // (cada teste monta seu proprio `document` falso).
      delete slots[key];
    });
  }

  const api = {
    updateScore,
    updateCombo,
    showJudgement,
    flashNote,
    reset,
    // Expostas para teste automatizado (funcoes/constantes puras):
    _internal: {
      formatScore,
      formatCombo,
      valueChanged,
      JUDGEMENT_LABELS,
      JUDGEMENT_CLASS,
      NOTE_FLASH_CLASS,
      FEEDBACK_VISIBLE_MS,
      NOTE_FLASH_MS,
    },
  };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
