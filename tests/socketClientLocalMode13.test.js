/**
 * ETAPA 13 -- Modo de Teste Local (file://).
 *
 * Testa client/js/network/socketClient.js com `window`/`WebSocket`
 * mockados (Node nao tem nenhum dos dois nativamente), cobrindo
 * exatamente os requisitos do pedido:
 *
 *   - file:// -> Modo de Teste Local, NUNCA tenta `new WebSocket(...)`;
 *   - http:// -> continua usando "ws://" (comportamento de producao
 *     100% inalterado);
 *   - https:// -> continua usando "wss://" (idem);
 *   - qualquer mensagem de multiplayer (create_room/join_room) em
 *     http/https continua indo por cima do WebSocket real, nunca pelo
 *     LocalServerSimulator.
 *
 * Como socketClient.js le `window`/`WebSocket` GLOBAIS (e um arquivo de
 * navegador, carregado via <script>, nao via `require`), os testes
 * abaixo definem esses globais ANTES de cada `require` e usam
 * `delete require.cache` para forcar uma instancia nova do modulo por
 * cenario (cada IIFE `SocketClient` guarda seu proprio `socket`/
 * `localConnection` em closure).
 *
 * Executar com: node tests/socketClientLocalMode13.test.js
 */
const assert = require('assert');
const path = require('path');

const SOCKET_CLIENT_PATH = require.resolve('../client/js/network/socketClient');
const LocalServerSimulator = require('../client/js/network/localServerSimulator');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`OK   - ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

/**
 * Mock minimo de WebSocket: registra a URL usada para conectar e nunca
 * chega a abrir de verdade (nenhum teste aqui depende de eventos
 * `open`/`message` reais -- so de QUAL URL/protocolo foi escolhido, e
 * de que o multiplayer continua passando por aqui).
 */
class MockWebSocket {
  constructor(url) {
    MockWebSocket.instances.push(this);
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
    this.sent = [];
    this._listeners = {};
  }
  addEventListener(event, handler) {
    (this._listeners[event] = this._listeners[event] || []).push(handler);
  }
  send(data) {
    this.sent.push(data);
  }
}
MockWebSocket.OPEN = 1;

function freshSocketClient({ protocol, host = 'example.com:3000' }) {
  delete require.cache[SOCKET_CLIENT_PATH];
  MockWebSocket.instances = [];
  global.window = { location: { protocol, host } };
  global.WebSocket = MockWebSocket;
  global.LocalServerSimulator = LocalServerSimulator;
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const SocketClient = require(SOCKET_CLIENT_PATH);
  return SocketClient;
}

function cleanupGlobals() {
  delete global.window;
  delete global.WebSocket;
  delete global.LocalServerSimulator;
}

async function run() {
  await test('http:// -> connect() abre um WebSocket real em ws://<host>', () => {
    const SocketClient = freshSocketClient({ protocol: 'http:', host: 'meujogo.exemplo.com' });
    SocketClient.connect();

    assert.strictEqual(MockWebSocket.instances.length, 1);
    assert.strictEqual(MockWebSocket.instances[0].url, 'ws://meujogo.exemplo.com');
    cleanupGlobals();
  });

  await test('https:// -> connect() abre um WebSocket real em wss://<host>', () => {
    const SocketClient = freshSocketClient({ protocol: 'https:', host: 'meujogo.exemplo.com' });
    SocketClient.connect();

    assert.strictEqual(MockWebSocket.instances.length, 1);
    assert.strictEqual(MockWebSocket.instances[0].url, 'wss://meujogo.exemplo.com');
    cleanupGlobals();
  });

  await test('file:// -> connect() NUNCA cria um WebSocket', () => {
    const SocketClient = freshSocketClient({ protocol: 'file:', host: '' });
    SocketClient.connect();

    assert.strictEqual(MockWebSocket.instances.length, 0);
    cleanupGlobals();
  });

  await test('file:// -> status "connected" chega mesmo sem WebSocket (via LocalServerSimulator)', () => {
    const SocketClient = freshSocketClient({ protocol: 'file:', host: '' });
    const statuses = [];
    SocketClient.onStatusChange((status) => statuses.push(status));
    SocketClient.connect();

    assert.deepStrictEqual(statuses, ['connected']);
    cleanupGlobals();
  });

  await test('file:// -> start_solo_match chega como match_ready via LocalServerSimulator (sem servidor)', () => {
    const SocketClient = freshSocketClient({ protocol: 'file:', host: '' });
    const messages = [];
    SocketClient.onMessage((message) => messages.push(message));
    SocketClient.connect();
    SocketClient.send('start_solo_match');

    assert.ok(messages.some((m) => m.type === 'match_ready' && m.match.mode === 'solo'));
    assert.strictEqual(MockWebSocket.instances.length, 0, 'nenhum WebSocket deveria ter sido criado');
    cleanupGlobals();
  });

  await test('file:// -> create_room responde error, nao trava tentando abrir WebSocket', () => {
    const SocketClient = freshSocketClient({ protocol: 'file:', host: '' });
    const messages = [];
    SocketClient.onMessage((message) => messages.push(message));
    SocketClient.connect();
    SocketClient.send('create_room');

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].type, 'error');
    assert.strictEqual(MockWebSocket.instances.length, 0);
    cleanupGlobals();
  });

  await test('http:// -> multiplayer (create_room) continua indo pelo WebSocket real, nunca pelo simulador local', () => {
    const SocketClient = freshSocketClient({ protocol: 'http:', host: 'meujogo.exemplo.com' });
    SocketClient.connect();
    SocketClient.send('create_room');

    const socket = MockWebSocket.instances[0];
    assert.strictEqual(socket.sent.length, 1);
    assert.deepStrictEqual(JSON.parse(socket.sent[0]), { type: 'create_room' });
    cleanupGlobals();
  });

  await test('https:// -> qualquer mensagem enviada usa o WebSocket real (wss), nunca o simulador local', () => {
    const SocketClient = freshSocketClient({ protocol: 'https:', host: 'meujogo.exemplo.com' });
    SocketClient.connect();
    SocketClient.send('start_solo_match');

    const socket = MockWebSocket.instances[0];
    assert.strictEqual(socket.sent.length, 1);
    assert.deepStrictEqual(JSON.parse(socket.sent[0]), { type: 'start_solo_match' });
    cleanupGlobals();
  });

  console.log(`\n${passed} teste(s) passaram, ${failed} falharam.`);
}

run();
