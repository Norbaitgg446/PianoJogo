/**
 * Controlador do lado CLIENTE da selecao de musica (Etapa 10D).
 *
 * O SERVIDOR (`server/music/musicSelectionFlow.js`) e a UNICA
 * autoridade sobre a selecao: ele valida se o musicId existe, se o
 * jogador pertence a sala, se a partida ainda nao comecou, e decide
 * (quando os dois jogadores escolhem musicas diferentes) qual musica
 * sera usada -- este modulo NAO decide nada disso de novo. Mesmo
 * padrao ja usado por `rematchController.js`/`leaveRoomController.js`/
 * `matchAbandonmentController.js`: um pedaco pequeno, sem DOM/
 * WebSocket, cuja unica responsabilidade e:
 *
 * - guardar o catalogo de musicas recebido do servidor
 *   (`music_catalog`), so para permitir renderizar a lista e validar
 *   localmente um clique antes de gastar uma mensagem de rede;
 * - impedir envio duplicado: enquanto uma selecao ainda nao foi
 *   confirmada (ou rejeitada) pelo servidor, uma nova tentativa e
 *   ignorada;
 * - guardar a ultima musica CONFIRMADA pelo servidor
 *   (`music_selected`);
 * - resetar quando uma nova partida comeca ou a sala e abandonada
 *   (mesmo motivo de `rematchController.reset()`/
 *   `matchAbandonmentController.reset()`: o handshake anterior ja foi
 *   resolvido, e uma partida nova nao deve herdar nada dele).
 *
 * Este modulo NAO sabe nada sobre DOM ou WebSocket -- quem usa este
 * modulo (main.js) injeta o que deve acontecer de verdade (enviar a
 * mensagem `select_music`, atualizar a tela), reaproveitando as
 * funcoes ja existentes (SocketClient.send, UIController). Isso mantem
 * a logica de selecao 100% testavel em Node puro.
 */
const MusicSelectionController = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;

  /**
   * @param {{
   *   sendSelectMusic: (musicId: string) => void,
   *   onCatalogChange?: (musics: Array<object>) => void,
   *   onSelectionConfirmed?: (payload: {slot: string, musicId: string, selection: object}) => void,
   *   onSelectionRejected?: (message: string) => void,
   * }} deps
   */
  function createMusicSelectionController(deps = {}) {
    const { sendSelectMusic, onCatalogChange, onSelectionConfirmed, onSelectionRejected } = deps;

    // Catalogo recebido do servidor (`music_catalog`). Guardado so para
    // permitir validar localmente se um musicId existe antes de
    // enviar `select_music` -- a validacao de verdade continua sendo
    // feita pelo servidor (esta e apenas uma conveniencia de UI, nunca
    // uma segunda fonte de verdade).
    let catalog = [];

    // Ultima musica que o SERVIDOR confirmou para o jogador local
    // (nunca a que foi apenas clicada/enviada -- so depois de
    // `music_selected` chegar).
    let confirmedMusicId = null;

    // true enquanto uma selecao ja foi enviada e ainda nao foi
    // confirmada/rejeitada pelo servidor -- e o que impede envio
    // duplicado (cliques repetidos, ou qualquer outra chamada
    // redundante de `selectMusic`, nunca geram uma segunda mensagem
    // para o mesmo pedido).
    let pending = false;

    /**
     * Guarda a lista de musicas recebida do servidor (`music_catalog`)
     * e notifica quem injetou este controlador, para renderizar a
     * interface de selecao.
     *
     * @param {Array<object>} musics
     */
    function setCatalog(musics) {
      catalog = Array.isArray(musics) ? musics : [];
      if (typeof onCatalogChange === 'function') onCatalogChange(catalog);
    }

    function getCatalog() {
      return catalog;
    }

    /**
     * Chamado pelo clique/selecao de uma musica na interface. So envia
     * `select_music` ao servidor se: (a) nao houver uma selecao ja
     * pendente, e (b) o musicId parecer valido E existir no catalogo
     * conhecido localmente (checagem de conveniencia -- o servidor
     * sempre valida de novo, ver musicSelectionFlow.js).
     *
     * @param {string} musicId
     * @returns {boolean} true se o pedido foi enviado agora; false se
     *   foi ignorado (pedido ja pendente, ou musicId invalido/
     *   inexistente no catalogo local).
     */
    function selectMusic(musicId) {
      if (pending) return false;
      if (typeof musicId !== 'string' || musicId.trim() === '') return false;

      const existsLocally = catalog.some((music) => music && music.id === musicId);
      if (!existsLocally) return false;

      pending = true;
      if (typeof sendSelectMusic === 'function') sendSelectMusic(musicId);
      return true;
    }

    function isPending() {
      return pending;
    }

    function getConfirmedMusicId() {
      return confirmedMusicId;
    }

    /**
     * Processa a confirmacao (`music_selected`) vinda do servidor.
     * Aceita a confirmacao mesmo que nao tenhamos uma selecao pendente
     * daqui (ex: o OUTRO jogador selecionou uma musica -- este mesmo
     * broadcast tambem chega para quem nao clicou em nada), mas so
     * atualiza `confirmedMusicId` local quando o `slot` do payload for
     * o do proprio jogador (injetado via `localSlot` no momento da
     * chamada).
     *
     * @param {{type?: string, slot?: string, musicId?: string, selection?: object}} message
     * @param {string|null} localSlot - slot ('player1'|'player2') do
     *   jogador LOCAL, para distinguir a propria confirmacao da do
     *   oponente.
     * @returns {boolean} true se a mensagem foi reconhecida e tratada.
     */
    function handleConfirmation(message, localSlot) {
      if (!message || message.type !== 'music_selected') return false;

      if (message.slot === localSlot) {
        pending = false;
        confirmedMusicId = message.musicId;
      }

      if (typeof onSelectionConfirmed === 'function') onSelectionConfirmed(message);
      return true;
    }

    /**
     * Processa uma rejeicao do servidor (`error`) enquanto havia uma
     * selecao pendente daqui -- libera para uma nova tentativa, sem
     * alterar `confirmedMusicId` (a ultima selecao valida continua
     * sendo a mesma).
     *
     * @param {string} message
     */
    function handleRejection(message) {
      if (!pending) return false;

      pending = false;
      if (typeof onSelectionRejected === 'function') onSelectionRejected(message);
      return true;
    }

    /**
     * Devolve este controlador ao estado inicial: nenhuma selecao
     * pendente, nenhuma musica confirmada. Chamado quando uma partida
     * nova comeca de verdade (a selecao anterior ja foi consumida por
     * ela, ver server/music/musicSelectionFlow.js) e quando a sala e
     * abandonada/deixada (nada deve vazar para a proxima sala).
     *
     * NAO limpa o catalogo (`catalog`): a lista de musicas disponiveis
     * continua sendo a mesma independentemente de qual partida/sala --
     * so a SELECAO (config para a proxima Match) e reiniciada.
     */
    function reset() {
      confirmedMusicId = null;
      pending = false;
    }

    return {
      setCatalog,
      getCatalog,
      selectMusic,
      isPending,
      getConfirmedMusicId,
      handleConfirmation,
      handleRejection,
      reset,
    };
  }

  const api = { createMusicSelectionController };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
