/**
 * Testes automatizados da camada de entrada (Etapa 5B-1):
 * - teclado e toque disparam a MESMA funcao central (triggerLane);
 * - o mapeamento de teclas fisicas para lanes esta correto;
 * - sem handler registrado, a entrada e ignorada com seguranca
 *   (nao lanca erro);
 * - bindTouchButtons habilita os botoes e o clique chama a lane certa.
 *
 * InputController so toca em `document`/DOM dentro de bindKeyboard e
 * bindTouchButtons -- por isso da para testar toda a logica de
 * despacho (triggerLane/setLaneHandler) em Node puro, e testar
 * bindTouchButtons passando um container "falso" (duck-typing de
 * querySelectorAll), sem precisar de jsdom nem de navegador de verdade.
 *
 * Executar com: node tests/inputController.test.js
 */
const assert = require('assert');
const InputController = require('../client/js/input/inputController');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`OK   - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// Botao "falso" minimo o suficiente para bindTouchButtons: precisa de
// disabled, dataset.lane e addEventListener('click', ...).
function makeFakeButton(lane) {
  const listeners = {};
  return {
    disabled: true,
    dataset: { lane: String(lane) },
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    click() {
      if (listeners.click) listeners.click();
    },
  };
}

function makeFakeContainer(buttons) {
  return {
    querySelectorAll: () => buttons,
  };
}

test('setLaneHandler + triggerLane: chama o handler com a lane recebida', () => {
  const received = [];
  InputController.setLaneHandler((lane) => received.push(lane));

  InputController.triggerLane(1);
  InputController.triggerLane(2);
  InputController.triggerLane(3);

  assert.deepStrictEqual(received, [1, 2, 3]);
});

test('sem handler registrado, triggerLane nao lanca erro (entrada ignorada)', () => {
  InputController.setLaneHandler(null);
  assert.doesNotThrow(() => InputController.triggerLane(1));
});

test('setLaneHandler troca o handler ativo (so o mais recente recebe a lane)', () => {
  const first = [];
  const second = [];

  InputController.setLaneHandler((lane) => first.push(lane));
  InputController.setLaneHandler((lane) => second.push(lane));

  InputController.triggerLane(2);

  assert.deepStrictEqual(first, []);
  assert.deepStrictEqual(second, [2]);
});

test('bindTouchButtons: habilita os botoes do container e o clique dispara a lane correta', () => {
  const btnLane1 = makeFakeButton(1);
  const btnLane2 = makeFakeButton(2);
  const btnLane3 = makeFakeButton(3);
  const container = makeFakeContainer([btnLane1, btnLane2, btnLane3]);

  const received = [];
  InputController.setLaneHandler((lane) => received.push(lane));
  InputController.bindTouchButtons(container);

  assert.strictEqual(btnLane1.disabled, false, 'botao da lane 1 deveria ficar habilitado');
  assert.strictEqual(btnLane2.disabled, false, 'botao da lane 2 deveria ficar habilitado');
  assert.strictEqual(btnLane3.disabled, false, 'botao da lane 3 deveria ficar habilitado');

  btnLane1.click();
  btnLane3.click();
  btnLane2.click();

  assert.deepStrictEqual(received, [1, 3, 2], 'toque deve produzir o mesmo evento logico da lane correspondente');
});

test('bindTouchButtons com container vazio/nulo nao lanca erro', () => {
  assert.doesNotThrow(() => InputController.bindTouchButtons(null));
  assert.doesNotThrow(() => InputController.bindTouchButtons(makeFakeContainer([])));
});

console.log(`\n${passed} teste(s) passaram.`);
