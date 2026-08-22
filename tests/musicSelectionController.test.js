/**
 * Testes automatizados do controlador CLIENTE de selecao de musica
 * (Etapa 10D): guarda o catalogo recebido, impede envio duplicado
 * enquanto uma selecao esta pendente, reage a confirmacao/rejeicao do
 * servidor, e reseta corretamente entre partidas/salas.
 *
 * Testa MusicSelectionController diretamente, em Node puro (sem DOM) --
 * mesmo estilo de tests/rematchFlow.test.js (versao servidor) e do
 * proprio rematchController.js (versao cliente).
 *
 * Executar com: node tests/musicSelectionController.test.js
 */
const assert = require('assert');
const MusicSelectionController = require('../client/js/music/musicSelectionController');

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

const CATALOG = [
  { id: 'music-001', title: 'A', artist: 'X', bpm: 120, durationMs: 90000, difficulty: 'easy' },
  { id: 'music-002', title: 'B', artist: 'Y', bpm: 140, durationMs: 105000, difficulty: 'medium' },
];

test('[1] setCatalog guarda a lista e notifica onCatalogChange', () => {
  let received = null;
  const controller = MusicSelectionController.createMusicSelectionController({
    sendSelectMusic: () => {},
    onCatalogChange: (musics) => {
      received = musics;
    },
  });

  controller.setCatalog(CATALOG);
  assert.deepStrictEqual(received, CATALOG);
  assert.deepStrictEqual(controller.getCatalog(), CATALOG);
});

test('[2] selectMusic envia select_music para um musicId existente no catalogo', () => {
  const sent = [];
  const controller = MusicSelectionController.createMusicSelectionController({
    sendSelectMusic: (musicId) => sent.push(musicId),
  });
  controller.setCatalog(CATALOG);

  const result = controller.selectMusic('music-002');

  assert.strictEqual(result, true);
  assert.deepStrictEqual(sent, ['music-002']);
  assert.strictEqual(controller.isPending(), true);
});

test('[3] selectMusic rejeita um musicId que nao esta no catalogo local', () => {
  const sent = [];
  const controller = MusicSelectionController.createMusicSelectionController({
    sendSelectMusic: (musicId) => sent.push(musicId),
  });
  controller.setCatalog(CATALOG);

  const result = controller.selectMusic('music-nao-existe');

  assert.strictEqual(result, false);
  assert.deepStrictEqual(sent, []);
});

test('[4] selectMusic impede envio duplicado enquanto ha uma selecao pendente', () => {
  const sent = [];
  const controller = MusicSelectionController.createMusicSelectionController({
    sendSelectMusic: (musicId) => sent.push(musicId),
  });
  controller.setCatalog(CATALOG);

  controller.selectMusic('music-001');
  const second = controller.selectMusic('music-002');

  assert.strictEqual(second, false);
  assert.deepStrictEqual(sent, ['music-001']);
});

test('[5] handleConfirmation do PROPRIO slot atualiza a musica confirmada e libera novo envio', () => {
  let confirmedPayload = null;
  const controller = MusicSelectionController.createMusicSelectionController({
    sendSelectMusic: () => {},
    onSelectionConfirmed: (payload) => {
      confirmedPayload = payload;
    },
  });
  controller.setCatalog(CATALOG);
  controller.selectMusic('music-002');

  const handled = controller.handleConfirmation(
    { type: 'music_selected', slot: 'player1', musicId: 'music-002', selection: { player1: 'music-002', player2: null } },
    'player1'
  );

  assert.strictEqual(handled, true);
  assert.strictEqual(controller.getConfirmedMusicId(), 'music-002');
  assert.strictEqual(controller.isPending(), false);
  assert.ok(confirmedPayload);
});

test('[6] handleConfirmation de OUTRO slot nao altera a musica confirmada local', () => {
  const controller = MusicSelectionController.createMusicSelectionController({
    sendSelectMusic: () => {},
  });
  controller.setCatalog(CATALOG);

  controller.handleConfirmation(
    { type: 'music_selected', slot: 'player2', musicId: 'music-001', selection: { player1: null, player2: 'music-001' } },
    'player1'
  );

  assert.strictEqual(controller.getConfirmedMusicId(), null);
});

test('[7] handleRejection libera uma nova tentativa sem alterar a musica confirmada', () => {
  const controller = MusicSelectionController.createMusicSelectionController({
    sendSelectMusic: () => {},
  });
  controller.setCatalog(CATALOG);
  controller.selectMusic('music-001');

  const handled = controller.handleRejection('musica invalida');

  assert.strictEqual(handled, true);
  assert.strictEqual(controller.isPending(), false);
  assert.strictEqual(controller.getConfirmedMusicId(), null);
});

test('[8] reset() devolve pending/confirmedMusicId ao estado inicial, mas preserva o catalogo', () => {
  const controller = MusicSelectionController.createMusicSelectionController({
    sendSelectMusic: () => {},
  });
  controller.setCatalog(CATALOG);
  controller.selectMusic('music-001');
  controller.handleConfirmation(
    { type: 'music_selected', slot: 'player1', musicId: 'music-001' },
    'player1'
  );

  controller.reset();

  assert.strictEqual(controller.getConfirmedMusicId(), null);
  assert.strictEqual(controller.isPending(), false);
  assert.deepStrictEqual(controller.getCatalog(), CATALOG);
});

console.log(`\n${passed} teste(s) passaram.`);
