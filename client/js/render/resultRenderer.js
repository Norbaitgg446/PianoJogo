/**
 * Tela visual de resultado da partida (Etapa 5B-4C).
 *
 * Este modulo NAO calcula nada: ele so RECEBE um objeto de resultado
 * ja pronto (exatamente o formato que `MatchResult.generateResult` /
 * `MatchResult.getResult` ja produzem -- score, maxCombo, hits, misses,
 * mistakes, totalNotes, accuracy) e mostra isso na tela.
 *
 * Fluxo (nenhuma logica de jogo mora aqui):
 *
 *   MatchEndDetector.onMatchEnd -> MatchResult.generateResult(...) -\
 *                                                                    |-> main.js -> ResultRenderer.show(result) -> DOM
 *
 * Responsabilidade unica deste modulo:
 * - mostrar o resultado (show);
 * - esconder a tela de resultado (hide);
 * - atualizar os campos exibidos (feito internamente por show);
 * - resetar a tela para o estado inicial (reset).
 *
 * Este modulo NAO sabe nada sobre:
 * - WebSocket, salas, matchmaking ou revanche real;
 * - vencedor/perdedor ou comparacao entre os dois jogadores -- so
 *   existe UM conjunto de elementos na tela (nao ha slot player1/player2
 *   aqui), e ele so e preenchido com o resultado do jogador LOCAL. Isso
 *   torna impossivel, por construcao, o resultado de um jogador vazar
 *   para o "campo" do outro -- nao existe campo do outro jogador aqui;
 * - score/combo/hits/misses/mistakes -- esses numeros ja vem prontos de
 *   MatchResult, este modulo so formata e escreve no DOM.
 *
 * Os botoes "Jogar Novamente" e "Voltar ao Menu" tem sua INTERFACE e
 * seus HANDLERS preparados aqui (via setOnPlayAgain/setOnBackToMenu),
 * mas a DECISAO do que cada um faz de verdade fica com quem usa este
 * modulo (main.js) -- este arquivo so garante que o clique chega ao
 * callback registrado, uma unica vez por clique, sem duplicar listeners
 * mesmo que `show`/`ensureResolved` seja chamado varias vezes (uma vez
 * por partida).
 */
const ResultRenderer = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;

  // Classe aplicada a <html>/<body> enquanto a tela de resultado esta
  // visivel, para travar o scroll da pagina -- mesmo padrao ja usado
  // pela classe `match-active` (ver uiController.js), so que com nome
  // proprio para nao interferir na logica existente do campo de jogo.
  const LOCK_SCROLL_CLASS = 'result-active';

  function isBrowser() {
    return typeof document !== 'undefined';
  }

  // Estado do modulo: referencias de DOM resolvidas uma unica vez (elas
  // nao mudam de identidade ao longo da vida da pagina, entao cache-las
  // para sempre e seguro e evita re-resolver/re-ligar listeners a cada
  // partida) + os handlers atuais dos botoes (podem ser trocados por
  // quem usa o modulo via setOnPlayAgain/setOnBackToMenu).
  const state = {
    resolved: false,
    listenersBound: false,
    els: {
      root: null,
      score: null,
      accuracy: null,
      maxCombo: null,
      hits: null,
      misses: null,
      mistakes: null,
      btnPlayAgain: null,
      btnBackToMenu: null,
      rematchStatus: null,
    },
    onPlayAgain: null,
    onBackToMenu: null,
  };

  /**
   * Resolve (uma unica vez, para sempre) os elementos de DOM da tela de
   * resultado e liga os listeners dos botoes. Se o DOM ainda nao tiver
   * esses elementos, os campos ficam null e as funcoes abaixo apenas
   * nao fazem nada -- sem lancar erro.
   */
  function ensureResolved() {
    if (state.resolved || !isBrowser()) return state;

    state.els.root = document.getElementById('result-screen');
    state.els.score = document.getElementById('result-score');
    state.els.accuracy = document.getElementById('result-accuracy');
    state.els.maxCombo = document.getElementById('result-max-combo');
    state.els.hits = document.getElementById('result-hits');
    state.els.misses = document.getElementById('result-misses');
    state.els.mistakes = document.getElementById('result-mistakes');
    state.els.btnPlayAgain = document.getElementById('btn-play-again');
    state.els.btnBackToMenu = document.getElementById('btn-back-to-menu');
    state.els.rematchStatus = document.getElementById('result-rematch-status');
    state.resolved = true;

    bindListenersOnce();
    return state;
  }

  /**
   * Liga os listeners de clique dos botoes exatamente UMA vez (mesmo
   * que `show`/`ensureResolved` seja chamado de novo a cada partida) --
   * isso e o que garante que nunca existam listeners duplicados, sem
   * precisar remover/re-adicionar nada a cada partida. O clique sempre
   * repassa para o handler ATUAL registrado em `state.onPlayAgain` /
   * `state.onBackToMenu` (que pode ser trocado depois via os setters
   * abaixo), entao nao ha necessidade de religar nada quando o handler
   * muda.
   */
  function bindListenersOnce() {
    if (state.listenersBound) return;

    if (state.els.btnPlayAgain) {
      state.els.btnPlayAgain.addEventListener('click', () => {
        if (typeof state.onPlayAgain === 'function') state.onPlayAgain();
      });
    }
    if (state.els.btnBackToMenu) {
      state.els.btnBackToMenu.addEventListener('click', () => {
        if (typeof state.onBackToMenu === 'function') state.onBackToMenu();
      });
    }

    state.listenersBound = true;
  }

  // ---------------------------------------------------------------------
  // Funcoes PURAS de formatacao (sem DOM) -- testaveis isoladamente,
  // mesmo padrao usado em FeedbackRenderer._internal.
  // ---------------------------------------------------------------------

  function formatScore(score) {
    return Number(score || 0).toLocaleString('pt-BR');
  }

  function formatAccuracy(accuracy) {
    return `${Number(accuracy || 0).toFixed(2)}%`;
  }

  function formatCount(value) {
    return String(Number(value || 0));
  }

  /**
   * Trava/destrava o scroll da pagina enquanto a tela de resultado
   * estiver visivel (mesma tecnica ja usada para `match-active`).
   */
  function setScrollLocked(locked) {
    if (!isBrowser()) return;
    document.documentElement.classList[locked ? 'add' : 'remove'](LOCK_SCROLL_CLASS);
    document.body.classList[locked ? 'add' : 'remove'](LOCK_SCROLL_CLASS);
  }

  /**
   * Mostra a tela de resultado com os dados de UM resultado ja pronto
   * (formato de MatchResult.generateResult/getResult). Escreve apenas
   * nos elementos proprios da tela de resultado -- nunca em elementos
   * de player1/player2 do campo de jogo.
   *
   * @param {{score:number,maxCombo:number,hits:number,misses:number,
   *   mistakes:number,totalNotes:number,accuracy:number}} result
   */
  function show(result) {
    const s = ensureResolved();
    if (!s.els.root || !result) return;

    if (s.els.score) s.els.score.textContent = formatScore(result.score);
    if (s.els.accuracy) s.els.accuracy.textContent = formatAccuracy(result.accuracy);
    if (s.els.maxCombo) s.els.maxCombo.textContent = formatCount(result.maxCombo);
    if (s.els.hits) s.els.hits.textContent = formatCount(result.hits);
    if (s.els.misses) s.els.misses.textContent = formatCount(result.misses);
    if (s.els.mistakes) s.els.mistakes.textContent = formatCount(result.mistakes);

    s.els.root.classList.remove('hidden');

    // Forca reflow antes de adicionar `is-visible`, para a animacao CSS
    // de entrada (painel + numeros) tocar do zero mesmo que a tela ja
    // tenha sido mostrada antes nesta mesma pagina.
    void s.els.root.offsetWidth;
    s.els.root.classList.add('is-visible');

    setScrollLocked(true);
  }

  /**
   * Esconde a tela de resultado (sem apagar os valores exibidos --
   * quem quiser limpar tambem os valores deve chamar `reset`). Seguro
   * chamar mesmo quando a tela ja esta escondida ou nunca foi mostrada
   * (ex: ao iniciar uma partida nova, ou ao cancelar uma partida).
   */
  function hide() {
    const s = ensureResolved();
    if (!s.els.root) return;

    s.els.root.classList.remove('is-visible');
    s.els.root.classList.add('hidden');
    setScrollLocked(false);
  }

  /**
   * Reseta a tela para o estado inicial: esconde e limpa todos os
   * campos exibidos, para que nenhum numero de uma partida anterior
   * apareca por um instante antes do proximo `show` preencher os
   * valores novos. Chamado ao iniciar uma partida nova (garante que a
   * tela comeca "limpa" mesmo que nunca va ser mostrada ate o fim
   * desta nova partida).
   */
  function reset() {
    const s = ensureResolved();

    hide();

    if (s.els.score) s.els.score.textContent = '';
    if (s.els.accuracy) s.els.accuracy.textContent = '';
    if (s.els.maxCombo) s.els.maxCombo.textContent = '';
    if (s.els.hits) s.els.hits.textContent = '';
    if (s.els.misses) s.els.misses.textContent = '';
    if (s.els.mistakes) s.els.mistakes.textContent = '';

    // Etapa 5B-5A (Parte 2): volta o botao/estado de revanche ao ponto
    // de partida (habilitado, sem mensagem de espera/cancelamento), do
    // mesmo jeito que os campos de score acima -- para nunca sobrar
    // "Aguardando o outro jogador..." (ou uma mensagem de cancelamento)
    // de uma partida anterior na tela da partida nova.
    setPlayAgainWaiting(false);
  }

  /**
   * Etapa 5B-5A (Parte 2): alterna a tela de resultado para o estado de
   * "aguardando o outro jogador confirmar a revanche" (ou volta dele).
   * So exibicao -- quem decide QUANDO chamar isso e o RematchController
   * (via main.js), nunca este modulo.
   *
   * @param {boolean} isWaiting
   */
  function setPlayAgainWaiting(isWaiting) {
    const s = ensureResolved();

    if (s.els.btnPlayAgain) s.els.btnPlayAgain.disabled = !!isWaiting;

    if (s.els.rematchStatus) {
      if (isWaiting) {
        s.els.rematchStatus.textContent = 'Aguardando o outro jogador...';
        s.els.rematchStatus.classList.remove('hidden');
      } else {
        s.els.rematchStatus.textContent = '';
        s.els.rematchStatus.classList.add('hidden');
      }
    }
  }

  /**
   * Etapa 5B-5A (Parte 2): mostra que a revanche foi cancelada (ex: o
   * oponente desconectou enquanto aguardavamos) e reabilita o botao
   * "Jogar Novamente" para uma nova tentativa.
   *
   * @param {string} [reason]
   */
  function showRematchCancelled(reason) {
    const s = ensureResolved();

    if (s.els.btnPlayAgain) s.els.btnPlayAgain.disabled = false;

    if (s.els.rematchStatus) {
      s.els.rematchStatus.textContent = reason ? `Revanche cancelada: ${reason}` : 'Revanche cancelada.';
      s.els.rematchStatus.classList.remove('hidden');
    }
  }

  /**
   * Se a tela de resultado esta visivel no momento.
   */
  function isVisible() {
    const s = ensureResolved();
    if (!s.els.root) return false;
    return s.els.root.classList.contains('is-visible');
  }

  /**
   * Registra o handler chamado quando o botao "Jogar Novamente" e
   * clicado. Substitui qualquer handler anterior (nao acumula).
   * @param {() => void} handler
   */
  function setOnPlayAgain(handler) {
    ensureResolved();
    state.onPlayAgain = typeof handler === 'function' ? handler : null;
  }

  /**
   * Registra o handler chamado quando o botao "Voltar ao Menu" e
   * clicado. Substitui qualquer handler anterior (nao acumula).
   * @param {() => void} handler
   */
  function setOnBackToMenu(handler) {
    ensureResolved();
    state.onBackToMenu = typeof handler === 'function' ? handler : null;
  }

  const api = {
    show,
    hide,
    reset,
    isVisible,
    setOnPlayAgain,
    setOnBackToMenu,
    setPlayAgainWaiting,
    showRematchCancelled,
    // Expostas para teste automatizado (funcoes puras + internals):
    _internal: {
      formatScore,
      formatAccuracy,
      formatCount,
      LOCK_SCROLL_CLASS,
      ensureResolved,
      state,
      // So para os testes automatizados: no navegador de verdade os
      // elementos de DOM da tela de resultado nunca sao substituidos
      // por outros, entao cachear a resolucao/listeners para sempre e
      // seguro e evita listeners duplicados. Cada teste, porem, monta
      // seu proprio `document` falso -- esta funcao forca uma nova
      // resolucao (e uma nova ligacao de listeners) contra o `document`
      // falso ATUAL, simulando "a pagina carregou de novo".
      _resetForTests() {
        state.resolved = false;
        state.listenersBound = false;
        state.onPlayAgain = null;
        state.onBackToMenu = null;
        Object.keys(state.els).forEach((key) => {
          state.els[key] = null;
        });
      },
    },
  };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
