/**
 * Estado local de um jogador (Etapa 4B).
 *
 * Cada jogador possui sua PROPRIA instancia deste estado. As funcoes
 * aqui sao puras em relacao a "qual jogador": elas recebem o objeto de
 * estado a ser alterado como parametro e so mexem nele. Isso e proposital
 * -- garante que um jogador nunca altera o estado local do outro por
 * engano: quem chama e responsavel por passar sempre o estado correto
 * (o seu proprio).
 *
 * Nao sabe nada sobre WebSocket, DOM, notas ou julgamento -- apenas
 * acumula os numeros (score, combo, maxCombo, hits, misses, mistakes).
 */
const PlayerState = (() => {
  /**
   * Cria um novo estado de jogador zerado.
   */
  function createPlayerState() {
    return {
      score: 0,
      combo: 0,
      maxCombo: 0,
      hits: 0,
      misses: 0,
      mistakes: 0,
    };
  }

  /**
   * Registra um acerto (PERFECT ou GOOD): soma pontos conforme
   * scoreValues, incrementa hits e aumenta o combo (atualizando
   * maxCombo se necessario).
   *
   * @param {object} state - estado do jogador (mutado in-place)
   * @param {string} judgement - 'PERFECT' | 'GOOD'
   * @param {object} scoreValues - ex: ClientConfig.SCORE_VALUES
   */
  function registerHit(state, judgement, scoreValues) {
    const points = (scoreValues && scoreValues[judgement]) || 0;

    state.score += points;
    state.hits += 1;
    state.combo += 1;

    if (state.combo > state.maxCombo) {
      state.maxCombo = state.combo;
    }

    return state;
  }

  /**
   * Registra uma nota perdida por tempo (a nota expirou sem ser
   * atingida). Zera o combo. Nao pontua.
   */
  function registerMiss(state) {
    state.misses += 1;
    state.combo = 0;
    return state;
  }

  /**
   * Registra um erro do jogador (tecla errada ou fora da janela
   * valida, sem nenhuma nota associada). Zera o combo. Nao pontua.
   */
  function registerMistake(state) {
    state.mistakes += 1;
    state.combo = 0;
    return state;
  }

  const api = { createPlayerState, registerHit, registerMiss, registerMistake };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  return api;
})();
