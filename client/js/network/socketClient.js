/**
 * Camada de rede do cliente.
 * Isola o uso de WebSocket do resto do jogo, para que nas proximas
 * etapas (jogo do piano, etc.) o restante do codigo nao precise
 * saber como a conexao funciona por dentro.
 */
const SocketClient = (() => {
  let socket = null;
  let messageHandlers = [];
  let statusHandlers = [];

  function getWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }

  function connect() {
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

  return { connect, send, onMessage, onStatusChange };
})();
