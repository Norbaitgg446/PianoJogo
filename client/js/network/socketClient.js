/**
 * Camada de rede do cliente.
 * Isola o uso de WebSocket do resto do jogo, para que nas proximas
 * etapas (jogo do piano, etc.) o restante do codigo nao precise
 * saber como a conexao funciona por dentro.
 *
 * ETAPA 13 -- Modo de Teste Local (file://): quando a pagina e aberta
 * via file:// (ex: abrindo client/index.html direto pelo gerenciador
 * de arquivos do celular, sem servidor Node nenhum rodando),
 * `window.location.host` fica vazio e um WebSocket real nunca
 * conseguiria conectar em lugar nenhum -- por isso o botao "Jogar
 * Sozinho" simplesmente nao fazia nada nesse caso. Este modulo agora
 * detecta isso em `connect()` e, SOMENTE nesse caso, delega para
 * LocalServerSimulator (client/js/network/localServerSimulator.js), que
 * fala o MESMO protocolo de mensagens (match_ready/match_started/etc.)
 * gerado localmente, sem nenhum WebSocket.
 *
 * Em http:// e https:// (inclusive quando hospedado), NADA muda: `send`
 * e `connect` continuam usando exatamente o mesmo WebSocket real de
 * antes, com a mesma logica ws/wss baseada em window.location.protocol
 * que ja existia.
 *
 * A interface publica deste modulo (connect/send/onMessage/
 * onStatusChange) e EXATAMENTE a mesma de antes -- client/js/main.js
 * nao precisa saber (e nao sabe) se esta falando com um WebSocket real
 * ou com o LocalServerSimulator.
 */
const SocketClient = (() => {
  let socket = null;
  let messageHandlers = [];
  let statusHandlers = [];

  // Etapa 13: setado em connect() somente quando `isLocalFileMode()` e
  // verdadeiro. Enquanto isto for `null` (todo o comportamento
  // hospedado/http/https), o restante deste modulo funciona
  // identicamente a antes desta etapa.
  let localConnection = null;

  function isLocalFileMode() {
    return (
      typeof LocalServerSimulator !== 'undefined' &&
      LocalServerSimulator.isLocalFileMode &&
      LocalServerSimulator.isLocalFileMode()
    );
  }

  function getWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }

  function connect() {
    if (isLocalFileMode()) {
      // ITEM 1/2 do pedido: file:// -> Modo de Teste Local, sem nenhuma
      // tentativa de abrir WebSocket (nem valido, nem invalido).
      localConnection = LocalServerSimulator.createLocalConnection({
        onMessage: (data) => messageHandlers.forEach((handler) => handler(data)),
        onStatusChange: (status) => notifyStatus(status),
      });
      localConnection.connect();
      return;
    }

    // ITEM 4 do pedido: hospedado (http:// -> ws://, https:// -> wss://),
    // comportamento inalterado.
    socket = new WebSocket(getWebSocketUrl());

    socket.addEventListener('open', () => {
      notifyStatus('connected');
    });

    socket.addEventListener('close', () => {
      notifyStatus('disconnected');
    });

    socket.addEventListener('error', () => {
      notifyStatus('error');
    });

    socket.addEventListener('message', (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (err) {
        console.error('Mensagem invalida recebida do servidor:', event.data);
        return;
      }
      messageHandlers.forEach((handler) => handler(data));
    });
  }

  function send(type, payload = {}) {
    if (localConnection) {
      localConnection.send(type, payload);
      return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn('Tentativa de enviar mensagem sem conexao ativa.');
      return;
    }
    socket.send(JSON.stringify({ type, ...payload }));
  }

  function onMessage(handler) {
    messageHandlers.push(handler);
  }

  function onStatusChange(handler) {
    statusHandlers.push(handler);
  }

  function notifyStatus(status) {
    statusHandlers.forEach((handler) => handler(status));
  }

  const api = { connect, send, onMessage, onStatusChange };

  // Exportado condicionalmente (mesmo padrao ja usado em
  // client/js/match/sequenceGenerator.js e outros modulos do cliente)
  // para permitir testes automatizados em Node (Etapa 13), sem alterar
  // nada do comportamento no navegador, onde `module` nao existe.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  return api;
})();
