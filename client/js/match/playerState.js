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
 *
 * ETAPA 13F — a tela de resultado precisa da contagem SEPARADA de cada
 * julgamento de acerto (PERFECT/GREAT/GOOD, que juntos ja compunham
 * `hits`) e do maior multiplicador de combo (`comboMultiplierTiers`,
 * Etapa 13C) atingido durante a partida. `hits`, `misses` e `mistakes`
 * continuam existindo exatamente como antes (nenhum campo removido,
 * nenhum sistema paralelo de pontuacao criado) -- os campos novos so
 * detalham numeros que ja eram acumulados aqui.
 */
const PlayerState = (() => {
  /**
   * Cria um novo estado de jogador zerado.
   *
   * ETAPA 13F — `perfectCount`/`greatCount`/`goodCount` juntos sempre
   * somam exatamente `hits` (cada acerto incrementa `hits` E o contador
   * especifico do julgamento correspondente, nunca um sem o outro).
   * `maxMultiplier` comeca em 1 (o multiplicador minimo possivel, ver
   * `resolveComboMultiplier` abaixo) e so cresce quando um multiplicador
   * maior que o registrado e efetivamente atingido.
   */
  function createPlayerState() {
    return {
      score: 0,
      combo: 0,
      maxCombo: 0,
      hits: 0,
      misses: 0,
      mistakes: 0,
      perfectCount: 0,
      greatCount: 0,
      goodCount: 0,
      maxMultiplier: 1,
    };
  }

  /**
   * ETAPA 13C — resolve o multiplicador de pontuacao aplicavel a um
   * combo, a partir de uma lista de faixas (tiers) configuravel (ex:
   * ClientConfig.COMBO_MULTIPLIER.TIERS). Para um combo N, vale o
   * multiplicador do ULTIMO tier cuja minCombo <= N.
   *
   * Quando `tiers` nao e uma lista valida/nao-vazia (ex: chamadores
   * antigos que nao passam esse parametro), o multiplicador e sempre 1
   * -- comportamento IDENTICO ao de antes desta etapa.
   *
   * @param {number} combo
   * @param {Array<{minCombo:number, multiplier:number}>} [tiers]
   * @returns {number}
   */
  function resolveComboMultiplier(combo, tiers) {
    if (!Array.isArray(tiers) || tiers.length === 0) return 1;

    let multiplier = 1;
    for (const tier of tiers) {
      if (combo >= tier.minCombo && Number.isFinite(tier.multiplier)) {
        multiplier = tier.multiplier;
      }
    }
    return multiplier;
  }

  /**
   * Registra um acerto (PERFECT, GREAT ou GOOD): soma pontos conforme
   * scoreValues, incrementa hits e aumenta o combo (atualizando
   * maxCombo se necessario).
   *
   * ETAPA 13C — `comboMultiplierTiers` e OPCIONAL: quando informado
   * (ex: ClientConfig.COMBO_MULTIPLIER.TIERS), a pontuacao base do
   * julgamento e multiplicada pelo multiplicador correspondente ao
   * combo JA ATUALIZADO por este acerto (o combo sobe primeiro, depois
   * o multiplicador e calculado a partir do novo valor). Quando
   * omitido, o multiplicador e sempre 1 -- pontuacao identica a de
   * antes desta etapa.
   *
   * ETAPA 13F — alem do total (`hits`), tambem incrementa o contador
   * especifico do julgamento (`perfectCount`/`greatCount`/`goodCount`) e
   * atualiza `maxMultiplier` se o multiplicador desta jogada superar o
   * maior ja visto na partida. Julgamento desconhecido (nenhum dos tres
   * esperados -- nao deveria acontecer, ja que Judgement.classify so
   * devolve PERFECT/GREAT/GOOD/null) nao incrementa nenhum contador
   * especifico, mas `hits` continua sendo somado normalmente (mesmo
   * comportamento de antes desta etapa).
   *
   * @param {object} state - estado do jogador (mutado in-place)
   * @param {string} judgement - 'PERFECT' | 'GREAT' | 'GOOD'
   * @param {object} scoreValues - ex: ClientConfig.SCORE_VALUES
   * @param {Array<{minCombo:number, multiplier:number}>} [comboMultiplierTiers]
   */
  function registerHit(state, judgement, scoreValues, comboMultiplierTiers) {
    const basePoints = (scoreValues && scoreValues[judgement]) || 0;

    state.hits += 1;
    state.combo += 1;

    if (state.combo > state.maxCombo) {
      state.maxCombo = state.combo;
    }

    if (judgement === 'PERFECT') state.perfectCount += 1;
    else if (judgement === 'GREAT') state.greatCount += 1;
    else if (judgement === 'GOOD') state.goodCount += 1;

    const multiplier = resolveComboMultiplier(state.combo, comboMultiplierTiers);
    if (multiplier > state.maxMultiplier) {
      state.maxMultiplier = multiplier;
    }
    state.score += basePoints * multiplier;

    return state;
  }

  /**
   * Registra uma nota perdida por tempo (a nota expirou sem ser
   * atingida). Zera o combo.
   *
   * ETAPA 13C — `penaltyPoints` e OPCIONAL (ex:
   * ClientConfig.PENALTIES.MISS, um numero negativo). Quando informado
   * e finito, e somado ao score (descontando pontos). Quando omitido,
   * o score nao e tocado -- comportamento IDENTICO ao de antes desta
   * etapa.
   *
   * @param {object} state
   * @param {number} [penaltyPoints]
   */
  function registerMiss(state, penaltyPoints) {
    state.misses += 1;
    state.combo = 0;
    if (Number.isFinite(penaltyPoints)) {
      state.score += penaltyPoints;
    }
    return state;
  }

  /**
   * Registra um erro do jogador (tecla errada ou fora da janela
   * valida, sem nenhuma nota associada). Zera o combo.
   *
   * ETAPA 13C — `penaltyPoints` e OPCIONAL (ex:
   * ClientConfig.PENALTIES.MISTAKE, um numero negativo), com a mesma
   * regra de registerMiss acima: omitido => score intocado (igual a
   * antes desta etapa).
   *
   * @param {object} state
   * @param {number} [penaltyPoints]
   */
  function registerMistake(state, penaltyPoints) {
    state.mistakes += 1;
    state.combo = 0;
    if (Number.isFinite(penaltyPoints)) {
      state.score += penaltyPoints;
    }
    return state;
  }

  const api = {
    createPlayerState,
    registerHit,
    registerMiss,
    registerMistake,
    resolveComboMultiplier,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  return api;
})();
