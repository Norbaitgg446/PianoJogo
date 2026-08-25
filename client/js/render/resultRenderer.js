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
 *
 * ETAPA 13F — PARTE 2: alem dos campos que ja existiam, `show(result)`
 * agora tambem exibe a contagem detalhada de PERFECT/GREAT/GOOD (que a
 * Parte 1 ja calcula em `perfectCount`/`greatCount`/`goodCount`, dentro
 * do MESMO objeto de resultado -- nenhum campo novo e inventado aqui)
 * e o maior multiplicador atingido (`maxMultiplier`). Nenhuma conta
 * nova e feita neste arquivo -- so formatacao e exibicao.
 *
 * Tambem nesta parte: este modulo passa a saber exibir (nunca decidir)
 * vencedor/perdedor/empate, via `setMatchOutcome('win'|'lose'|'draw'|null)`.
 * Quem decide o outcome continua sendo exclusivamente o servidor
 * (server/match/matchOutcome.js, inalterado) -- main.js so traduz o
 * `winner`/`loser`/`result` que ja vem prontos de `match_result` para
 * o ponto de vista do jogador local (comparando com o proprio slot) e
 * repassa aqui. No Solo e no Modo Teste, main.js nunca chama
 * `setMatchOutcome` com um valor (o servidor tambem nunca envia
 * winner/loser nesses modos -- ver matchFlow.js#finishMatch), entao o
 * bloco de vencedor/perdedor permanece escondido o tempo todo, sem
 * nenhum `if (modo === solo)` dentro deste arquivo.
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
      // ETAPA 13F — PARTE 2: contagem detalhada de julgamentos e maior
      // multiplicador -- mesmos campos que MatchResult.buildResult ja
      // produz desde a Parte 1 (perfectCount/greatCount/goodCount/
      // maxMultiplier), agora tambem exibidos na tela.
      perfect: null,
      great: null,
      good: null,
      maxMultiplier: null,
      // ETAPA 13F — PARTE 2: bloco de vencedor/perdedor/empate,
      // exibido somente no Multiplayer (ver setMatchOutcome abaixo).
      outcome: null,
      // ETAPA 14C — PARTE 2: bloco "RESULTADO DA PARTIDA" do modo Bot
      // (comparacao de score jogador x Bot), exclusivo de isBotMode --
      // ver showBotMatchResult/hideBotMatchResult abaixo. Reaproveita o
      // MESMO #result-outcome acima para vencedor/perdedor/empate (via
      // setBotMatchOutcome), nunca um elemento de outcome paralelo.
      botBlock: null,
      botPlayerScore: null,
      botScore: null,
      // ETAPA 14D — PARTE 2C: dificuldade do Bot exibida no MESMO
      // bloco acima ("Dificuldade: FÁCIL"/"MÉDIO"/"DIFÍCIL") -- ver
      // showBotMatchResult/hideBotMatchResult abaixo.
      botDifficulty: null,
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
    state.els.perfect = document.getElementById('result-perfect');
    state.els.great = document.getElementById('result-great');
    state.els.good = document.getElementById('result-good');
    state.els.maxMultiplier = document.getElementById('result-max-multiplier');
    state.els.outcome = document.getElementById('result-outcome');
    // ETAPA 14C — PARTE 2: elementos do bloco "RESULTADO DA PARTIDA"
    // (modo Bot). Ausentes no DOM => os campos ficam null e
    // showBotMatchResult/hideBotMatchResult simplesmente nao fazem
    // nada, mesmo padrao ja usado por todo o resto deste modulo.
    state.els.botBlock = document.getElementById('result-bot-block');
    state.els.botPlayerScore = document.getElementById('result-bot-player-score');
    state.els.botScore = document.getElementById('result-bot-score');
    // ETAPA 14D — PARTE 2C: elemento do rotulo de dificuldade do Bot.
    // Ausente no DOM => o campo fica null e formatDifficultyLabel
    // simplesmente nao e escrito em lugar nenhum, mesmo padrao ja
    // usado por todo o resto deste modulo.
    state.els.botDifficulty = document.getElementById('result-bot-difficulty');
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
   * ETAPA 13F — PARTE 2: formata o maior multiplicador atingido
   * (`maxMultiplier`, ja calculado por MatchResult desde a Parte 1).
   * Sem multiplicador configurado na partida, o valor ja chega como 1
   * (ver PlayerState/GameplayEngine) -- aqui so formata para exibicao
   * ("1×", "2×", "4×", ...).
   */
  function formatMultiplier(value) {
    return `${Number(value || 1)}×`;
  }

  // ETAPA 14D — PARTE 2C: rotulos (pt-BR) para cada identificador
  // estavel de dificuldade do Bot (ClientConfig.BOT_DIFFICULTY, em
  // client/js/config.js) -- usados SOMENTE para texto nesta tela (ex:
  // "Dificuldade: FÁCIL"). O MESMO mapeamento texto que
  // UIController.BOT_DIFFICULTY_LABELS ja usa para "BOT — FÁCIL"
  // durante a partida; duplicado aqui de proposito (mesmo padrao que
  // o resto deste modulo ja segue: cada camada de exibicao formata os
  // proprios textos, sem depender de outro modulo de UI) -- nenhum
  // identificador novo e inventado, e nenhuma logica de Bot mora aqui.
  const BOT_DIFFICULTY_LABELS = {
    EASY: 'FÁCIL',
    MEDIUM: 'MÉDIO',
    HARD: 'DIFÍCIL',
  };

  /**
   * ETAPA 14D — PARTE 2C: formata o rotulo de dificuldade exibido no
   * bloco "RESULTADO DA PARTIDA" do modo Bot. Um `difficulty`
   * desconhecido/omitido devolve string vazia (o elemento fica sem
   * texto, nunca "Dificuldade: undefined") -- mesmo espirito de
   * tolerancia a entrada invalida do resto das funcoes formatXxx
   * acima.
   *
   * @param {string} [difficulty] - "EASY"/"MEDIUM"/"HARD"
   * @returns {string}
   */
  function formatDifficultyLabel(difficulty) {
    const label = BOT_DIFFICULTY_LABELS[difficulty];
    return label ? `Dificuldade: ${label}` : '';
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
    // ETAPA 13F — PARTE 2: contagem detalhada (PERFECT/GREAT/GOOD) e
    // maior multiplicador -- mesmos campos que MatchResult ja produz
    // (Parte 1), so exibidos aqui pela primeira vez.
    if (s.els.perfect) s.els.perfect.textContent = formatCount(result.perfectCount);
    if (s.els.great) s.els.great.textContent = formatCount(result.greatCount);
    if (s.els.good) s.els.good.textContent = formatCount(result.goodCount);
    if (s.els.maxMultiplier) s.els.maxMultiplier.textContent = formatMultiplier(result.maxMultiplier);

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
    if (s.els.perfect) s.els.perfect.textContent = '';
    if (s.els.great) s.els.great.textContent = '';
    if (s.els.good) s.els.good.textContent = '';
    if (s.els.maxMultiplier) s.els.maxMultiplier.textContent = '';

    // Etapa 5B-5A (Parte 2): volta o botao/estado de revanche ao ponto
    // de partida (habilitado, sem mensagem de espera/cancelamento), do
    // mesmo jeito que os campos de score acima -- para nunca sobrar
    // "Aguardando o outro jogador..." (ou uma mensagem de cancelamento)
    // de uma partida anterior na tela da partida nova.
    setPlayAgainWaiting(false);

    // ETAPA 13F — PARTE 2: nenhuma partida nova pode comecar com o
    // vencedor/perdedor de uma partida anterior ainda visivel -- mesmo
    // raciocinio de todos os campos acima. So no Multiplayer alguem vai
    // chamar setMatchOutcome de novo (quando o `match_result` oficial
    // chegar); no Solo/Modo Teste este bloco so permanece escondido.
    clearMatchOutcome();

    // ETAPA 14C — PARTE 2: mesmo raciocinio acima, para o bloco
    // "RESULTADO DA PARTIDA" do modo Bot -- nenhuma partida nova (Bot,
    // Solo ou Multiplayer) pode comecar com o score/outcome do Bot de
    // uma tentativa anterior ainda visivel. So main.js volta a chamar
    // showBotMatchResult/setBotMatchOutcome quando isBotMode e a
    // partida termina de novo.
    hideBotMatchResult();
  }

  /**
   * Etapa 5B-5A (Parte 2): alterna a tela de resultado para o estado de
   * "aguardando o outro jogador confirmar a revanche" (ou volta dele).
   * So exibicao -- quem decide QUANDO chamar isso e o RematchController
   * (via main.js), nunca este modulo.
   *
   * @param {boolean} isWaiting
   * @param {string} [message] - texto mostrado enquanto `isWaiting` for
   *   true (padrao: 'Aguardando o outro jogador...', o MESMO texto de
   *   sempre -- nenhum chamador existente muda de comportamento). Passar
   *   uma string vazia desabilita o botao sem mostrar nenhuma mensagem
   *   -- usado pelo Solo/Bot/Modo Teste (ETAPA de correcao do "Jogar
   *   Novamente"), onde nao ha oponente para "aguardar".
   */
  function setPlayAgainWaiting(isWaiting, message = 'Aguardando o outro jogador...') {
    const s = ensureResolved();

    if (s.els.btnPlayAgain) s.els.btnPlayAgain.disabled = !!isWaiting;

    if (s.els.rematchStatus) {
      if (isWaiting && message) {
        s.els.rematchStatus.textContent = message;
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

  // Classes usadas no bloco de vencedor/perdedor/empate -- centralizadas
  // aqui para nunca ficar com uma classe de estado antiga esquecida
  // quando o outcome muda (ex: de "win" para "lose" numa revanche).
  const OUTCOME_CLASSES = ['result-outcome-win', 'result-outcome-lose', 'result-outcome-draw'];
  const OUTCOME_LABELS = {
    win: 'VOCÊ VENCEU',
    lose: 'VOCÊ PERDEU',
    draw: 'EMPATE',
  };

  /**
   * ETAPA 13F — PARTE 2: mostra o bloco de vencedor/perdedor/empate,
   * exclusivo do Multiplayer. Este modulo NAO decide quem venceu --
   * `outcome` ja chega pronto de quem usa este modulo (main.js), que
   * por sua vez so traduz `winner`/`loser`/`result` de `match_result`
   * (Etapa 12, servidor -- ver server/match/matchOutcome.js, inalterado)
   * para o ponto de vista do jogador local.
   *
   * @param {'win'|'lose'|'draw'|null} outcome - `null`/valor invalido
   *   esconde o bloco (equivalente a chamar clearMatchOutcome()) -- e o
   *   que garante que o Solo e o Modo Teste, que nunca chamam esta
   *   funcao com um valor, nunca mostram vencedor/perdedor.
   */
  function setMatchOutcome(outcome) {
    const s = ensureResolved();
    if (!s.els.outcome) return;

    if (outcome !== 'win' && outcome !== 'lose' && outcome !== 'draw') {
      clearMatchOutcome();
      return;
    }

    s.els.outcome.textContent = OUTCOME_LABELS[outcome];
    s.els.outcome.classList.remove(...OUTCOME_CLASSES);
    s.els.outcome.classList.add(`result-outcome-${outcome}`);
    s.els.outcome.classList.remove('hidden');
  }

  /**
   * Esconde e limpa o bloco de vencedor/perdedor/empate. Chamado por
   * `reset()` (toda partida nova comeca sem nenhum outcome de uma
   * partida anterior) -- Solo/Modo Teste simplesmente nunca chamam
   * `setMatchOutcome` de novo depois disso, entao o bloco permanece
   * escondido por toda a partida.
   */
  function clearMatchOutcome() {
    const s = ensureResolved();
    if (!s.els.outcome) return;

    s.els.outcome.textContent = '';
    s.els.outcome.classList.remove(...OUTCOME_CLASSES);
    s.els.outcome.classList.add('hidden');
  }

  // ETAPA 14C — PARTE 2: rotulos do bloco de vencedor/perdedor/empate
  // EXCLUSIVOS do modo Bot (reutiliza o MESMO #result-outcome e as
  // MESMAS classes de cor de setMatchOutcome/OUTCOME_CLASSES acima --
  // nenhum elemento ou sistema visual paralelo). So o TEXTO muda: aqui
  // o adversario tem nome proprio ("BOT VENCEU") em vez de "VOCÊ
  // PERDEU". Bot e Multiplayer sao mutuamente exclusivos (main.js nunca
  // chama os dois na mesma partida), entao nunca ha ambiguidade sobre
  // qual rotulo o #result-outcome esta mostrando.
  const OUTCOME_LABELS_BOT = {
    win: 'VOCÊ VENCEU',
    lose: 'BOT VENCEU',
    draw: 'EMPATE',
  };

  /**
   * ETAPA 14C — PARTE 2: mostra o bloco de vencedor/perdedor/empate do
   * MODO BOT (rotulos proprios, ver OUTCOME_LABELS_BOT). Este modulo
   * NAO decide quem venceu -- `outcome` ja chega pronto de quem usa
   * este modulo (main.js), que por sua vez so compara os dois scores
   * ja prontos (MatchResult do jogador humano / BotMatchController do
   * Bot) -- nenhum calculo de vencedor novo aqui.
   *
   * @param {'win'|'lose'|'draw'|null} outcome - `null`/valor invalido
   *   esconde o bloco (equivalente a chamar clearMatchOutcome()).
   */
  function setBotMatchOutcome(outcome) {
    const s = ensureResolved();
    if (!s.els.outcome) return;

    if (outcome !== 'win' && outcome !== 'lose' && outcome !== 'draw') {
      clearMatchOutcome();
      return;
    }

    s.els.outcome.textContent = OUTCOME_LABELS_BOT[outcome];
    s.els.outcome.classList.remove(...OUTCOME_CLASSES);
    s.els.outcome.classList.add(`result-outcome-${outcome}`);
    s.els.outcome.classList.remove('hidden');
  }

  /**
   * ETAPA 14C — PARTE 2: mostra o bloco "RESULTADO DA PARTIDA" do modo
   * Bot (seu score / score do Bot lado a lado). Os dois numeros ja
   * chegam prontos de quem usa este modulo (main.js: `result.score` do
   * MatchResult do jogador humano e `botResult.score` do
   * BotMatchController/MatchResult do Bot) -- nenhum calculo de
   * pontuacao novo aqui, so formatacao (mesma `formatScore` ja usada
   * para o score do jogador acima) e exibicao.
   *
   * ETAPA 14D — PARTE 2C: alem dos dois scores, agora tambem recebe
   * (opcional) `difficulty` ("EASY"/"MEDIUM"/"HARD", ja escolhida pelo
   * jogador na tela "Escolha a dificuldade" -- ver
   * ClientConfig.BOT_DIFFICULTY) e exibe "Dificuldade: FÁCIL/MÉDIO/
   * DIFÍCIL" no MESMO bloco -- so formatacao (formatDifficultyLabel
   * acima), nenhuma decisao de dificuldade nova aqui.
   *
   * @param {{playerScore:number, botScore:number, difficulty?:string}} scores
   */
  function showBotMatchResult({ playerScore, botScore, difficulty } = {}) {
    const s = ensureResolved();
    if (!s.els.botBlock) return;

    if (s.els.botPlayerScore) s.els.botPlayerScore.textContent = formatScore(playerScore);
    if (s.els.botScore) s.els.botScore.textContent = formatScore(botScore);
    if (s.els.botDifficulty) s.els.botDifficulty.textContent = formatDifficultyLabel(difficulty);
    s.els.botBlock.classList.remove('hidden');
  }

  /**
   * Esconde e limpa o bloco "RESULTADO DA PARTIDA" do modo Bot. Chamado
   * por `reset()` (toda partida nova comeca sem o score do Bot de uma
   * partida anterior) -- Solo/Multiplayer simplesmente nunca chamam
   * `showBotMatchResult` de novo depois disso, entao o bloco permanece
   * escondido por toda a partida.
   */
  function hideBotMatchResult() {
    const s = ensureResolved();
    if (!s.els.botBlock) return;

    if (s.els.botPlayerScore) s.els.botPlayerScore.textContent = '';
    if (s.els.botScore) s.els.botScore.textContent = '';
    // ETAPA 14D — PARTE 2C: mesmo raciocinio acima -- nenhuma partida
    // nova pode comecar com a dificuldade de uma tentativa anterior
    // ainda visivel neste campo.
    if (s.els.botDifficulty) s.els.botDifficulty.textContent = '';
    s.els.botBlock.classList.add('hidden');
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
    // ETAPA 13F — PARTE 2: bloco de vencedor/perdedor/empate (Multiplayer).
    setMatchOutcome,
    clearMatchOutcome,
    // ETAPA 14C — PARTE 2: bloco de vencedor/perdedor/empate + score
    // comparado (modo Bot, exclusivo).
    setBotMatchOutcome,
    showBotMatchResult,
    hideBotMatchResult,
    // Expostas para teste automatizado (funcoes puras + internals):
    _internal: {
      formatScore,
      formatAccuracy,
      formatCount,
      formatMultiplier,
      formatDifficultyLabel,
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
