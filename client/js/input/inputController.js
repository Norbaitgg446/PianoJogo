/**
 * Camada de entrada do jogador (Etapa 5B-1).
 *
 * Responsavel APENAS por capturar teclado e toque e traduzir os dois
 * para o MESMO evento logico: "o jogador pressionou a lane N". Nao
 * sabe nada sobre GameplayEngine, PlayerState, notas, julgamento,
 * combo ou pontuacao -- apenas captura a entrada bruta (DOM) e chama
 * um unico callback central (`setLaneHandler`) com o numero da lane.
 *
 * Quem decide o que fazer com essa lane (chamar
 * GameplayEngine.handleKeyPress do jogador LOCAL, por exemplo) e quem
 * registra o handler via `setLaneHandler` -- normalmente main.js. Isso
 * mantem esta camada reutilizavel e testavel sem precisar de um
 * GameplayEngine de verdade, e garante que teclado e toque nunca
 * duplicam logica: os dois caem exatamente na mesma funcao.
 *
 * Mapeamento fixo de teclas (igual ao data-key/data-lane ja presentes
 * nos botoes de index.html):
 *   ArrowLeft  -> lane 1
 *   ArrowUp    -> lane 2
 *   ArrowRight -> lane 3
 */
const InputController = (() => {
  const KEY_TO_LANE = {
    ArrowLeft: 1,
    ArrowUp: 2,
    ArrowRight: 3,
  };

  // Handler unico e atual para "lane pressionada". Definido de fora
  // (main.js) apenas quando ha um jogador/partida local para receber
  // a entrada; null quando nao ha ninguem ouvindo (ex: antes da
  // partida comecar), fazendo com que teclado/toque sejam ignorados
  // com seguranca em vez de dar erro.
  let laneHandler = null;

  /**
   * Define a funcao que recebe cada lane pressionada (teclado OU
   * toque). Passe `null` para parar de reagir a entrada (ex: fora de
   * uma partida ativa).
   *
   * @param {(lane:number) => void | null} handler
   */
  function setLaneHandler(handler) {
    laneHandler = typeof handler === 'function' ? handler : null;
  }

  /**
   * Ponto central por onde TODA entrada (teclado ou toque) passa.
   * Teclado e toque nunca chamam o GameplayEngine diretamente -- ambos
   * chamam esta funcao, que repassa para o handler atual.
   *
   * @param {number} lane
   */
  function triggerLane(lane) {
    if (!laneHandler) return;
    laneHandler(lane);
  }

  function isTypingIntoField(target) {
    if (!target || !target.tagName) return false;
    const tag = target.tagName.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA';
  }

  /**
   * Liga o listener de teclado global. Seguro chamar uma unica vez no
   * boot do app (main.js): sem handler registrado, teclas nao fazem
   * nada, entao nao ha problema em jah deixar o listener ativo antes
   * de existir uma partida.
   */
  function bindKeyboard() {
    document.addEventListener('keydown', (event) => {
      // Evita disparar lane repetidamente enquanto a tecla fica
      // pressionada (keydown repete automaticamente no navegador).
      if (event.repeat) return;

      // Nao rouba ArrowLeft/ArrowRight de campos de texto (ex: input
      // do codigo da sala).
      if (isTypingIntoField(event.target)) return;

      const lane = KEY_TO_LANE[event.key];
      if (!lane) return;

      // Evita rolar a pagina com as setas durante o jogo.
      event.preventDefault();
      triggerLane(lane);
    });
  }

  /**
   * Liga o toque nas 3 teclas visuais de UM container (ex: o
   * keys-bar do jogador local). Cada botao ja tem data-lane no HTML
   * (ver index.html); o toque produz exatamente o mesmo evento logico
   * (`triggerLane`) que o teclado produziria para a mesma lane.
   *
   * Idempotente na pratica: so deve ser chamada uma vez por container
   * (quem chama -- main.js -- controla isso), pois cada chamada
   * adiciona um listener novo por botao.
   *
   * @param {HTMLElement} containerEl
   */
  function bindTouchButtons(containerEl) {
    if (!containerEl) return;

    const buttons = containerEl.querySelectorAll('[data-lane]');
    buttons.forEach((button) => {
      button.disabled = false;
      button.addEventListener('click', () => {
        const lane = Number(button.dataset.lane);
        if (!lane) return;
        triggerLane(lane);
      });
    });
  }

  const api = { setLaneHandler, triggerLane, bindKeyboard, bindTouchButtons };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  return api;
})();
