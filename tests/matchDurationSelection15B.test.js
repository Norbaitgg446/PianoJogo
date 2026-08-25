/**
 * ETAPA 15B — Interface para escolher a duração da partida.
 *
 * A Etapa 15A (tests/matchDuration15A.test.js) ja cobriu a
 * ARQUITETURA de duracao (identificadores, resolveMatchDuration,
 * fallback seguro, nenhum modulo do servidor conhecendo MATCH_DURATION).
 * Este arquivo cobre exclusivamente a INTERFACE criada por cima dela:
 *
 *   - "Jogar Sozinho" e a escolha de dificuldade do Bot abrem a tela
 *     "Escolha a duração da partida" ANTES de iniciar a partida de
 *     fato (nunca iniciam diretamente mais);
 *   - as quatro opcoes (30s/1min/5min/10min) existem, cada uma
 *     resolvendo para o identificador/ms correto (Etapa 15A);
 *   - um identificador invalido nunca e aceito;
 *   - "Cancelar" fecha a tela, limpa a duracao selecionada e NUNCA
 *     inicia partida (nem Solo nem Bot ficam "pela metade");
 *   - a duracao escolhida fica guardada em estado de modulo PROPRIO
 *     (`selectedMatchDuration`), no mesmo padrao de
 *     isBotMode/selectedBotDifficulty -- nunca localStorage, nunca
 *     estado duplicado;
 *   - "Jogar Novamente" (revanche de Solo/Bot) mantem a duracao ja
 *     escolhida, sem reabrir a tela de selecao;
 *   - a duracao e limpa ao sair da sala/voltar ao menu/iniciar
 *     multiplayer real (Criar sala/Entrar na sala), que NUNCA passam
 *     por esta tela -- o servidor ainda nao conhece duracao (Etapa 15A);
 *   - Solo, Bot, Modo Teste e Multiplayer continuam funcionando;
 *   - nenhum timer/encerramento por tempo foi introduzido nesta etapa.
 *
 * Mesmo estilo dos demais arquivos desta serie (ex:
 * tests/botDifficulty14D2Interface.test.js): exercita os modulos REAIS
 * (ClientConfig, MatchDuration, UIController, LocalServerSimulator,
 * modulos do servidor) e faz verificacao ESTATICA do codigo-fonte de
 * client/index.html e client/js/main.js onde um teste de integracao
 * real exigiria um navegador de verdade.
 *
 * Executar com: node tests/matchDurationSelection15B.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ClientConfig = require('../client/js/config');
const MatchDuration = require('../client/js/match/matchDuration');
const LocalServerSimulator = require('../client/js/network/localServerSimulator');

// Regressao de multiplayer do lado do servidor (mesmos modulos reais ja
// usados pelos demais arquivos desta serie).
const MatchManager = require('../server/match/MatchManager');
const { MATCH_STATE, MATCH_MODE } = require('../server/match/Match');
const { registerConnection } = require('../server/ws/connectionHandler');
const { routeMessage } = require('../server/ws/messageRouter');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`OK   - ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const indexHtmlPath = path.join(__dirname, '../client/index.html');
const mainJsPath = path.join(__dirname, '../client/js/main.js');
const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');
const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');

function extractBlock(regex, label) {
  const match = regex.exec(mainJsContent);
  assert.ok(match, `${label}: bloco nao encontrado em main.js`);
  return match[0];
}

const DURATION_IDS = ['30S', '1M', '5M', '10M'];

// =====================================================================
// BLOCO A -- O PAINEL APARECE, COM AS QUATRO OPCOES E CANCELAR
// =====================================================================

test('painel "Escolha a duração da partida" existe em client/index.html, escondido por padrao', () => {
  assert.ok(
    /<section[^>]*id="match-duration-panel"[^>]*class="panel hidden"/.test(indexHtmlContent),
    'esperava <section id="match-duration-panel" class="panel hidden"> (mesmo padrao de painel/hidden ja usado no resto do lobby)'
  );
});

test('painel de duracao tem as quatro opcoes (30S/1M/5M/10M) e um botao Cancelar', () => {
  const panelMatch = /<section[^>]*id="match-duration-panel"[^]*?<\/section>/.exec(indexHtmlContent);
  assert.ok(panelMatch, 'bloco do match-duration-panel nao encontrado');
  const panel = panelMatch[0];

  DURATION_IDS.forEach((id) => {
    assert.ok(new RegExp(`data-duration="${id}"`).test(panel), `esperava um botao com data-duration="${id}"`);
  });
  assert.ok(/id="btn-match-duration-cancel"/.test(panel), 'esperava um botao de cancelar');

  // As quatro opcoes precisam ser elementos DIFERENTES.
  const indices = DURATION_IDS.map((id) => panel.indexOf(`data-duration="${id}"`));
  assert.ok(
    indices.every((i) => i !== -1) && new Set(indices).size === DURATION_IDS.length,
    'as quatro opcoes de duracao precisam ser elementos distintos'
  );
});

test('index.html liga cada rotulo em portugues ao identificador correto (30S/1M/5M/10M)', () => {
  assert.ok(/data-duration="30S"[^>]*>[^<]*30 segundos/.test(indexHtmlContent), 'esperava o botao "30 segundos"');
  assert.ok(/data-duration="1M"[^>]*>[^<]*1 minuto/.test(indexHtmlContent), 'esperava o botao "1 minuto"');
  assert.ok(/data-duration="5M"[^>]*>[^<]*5 minutos/.test(indexHtmlContent), 'esperava o botao "5 minutos"');
  assert.ok(/data-duration="10M"[^>]*>[^<]*10 minutos/.test(indexHtmlContent), 'esperava o botao "10 minutos"');
});

// =====================================================================
// BLOCO B -- ABRIR A SELECAO ANTES DE INICIAR (SOLO E BOT), NUNCA DIRETO
// =====================================================================

test('"Jogar Sozinho" abre a selecao de duracao e NAO inicia a partida diretamente', () => {
  const soloHandlerBlock = extractBlock(
    /document\.getElementById\('btn-play-solo'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-play-solo'
  );
  assert.ok(
    soloHandlerBlock.includes('UIController.showMatchDurationSelection()'),
    'o clique precisa abrir a tela "Escolha a duração da partida"'
  );
  assert.ok(
    !soloHandlerBlock.includes("SocketClient.send('start_solo_match')"),
    'o clique NAO deve mais iniciar a partida diretamente -- isso agora acontece so ao escolher uma duracao'
  );
});

test('escolher uma dificuldade do Bot abre a selecao de duracao e NAO inicia a partida diretamente', () => {
  const optionsBlock = extractBlock(
    /document\.querySelectorAll\('#bot-difficulty-panel \[data-difficulty\]'\)\.forEach\(\(button\) => \{[^]*?\n {2}\}\);/,
    'handler das opcoes de dificuldade'
  );
  assert.ok(
    optionsBlock.includes('UIController.showMatchDurationSelection()'),
    'escolher uma dificuldade precisa abrir a tela "Escolha a duração da partida"'
  );
  assert.ok(
    !optionsBlock.includes("SocketClient.send('start_solo_match')"),
    'escolher uma dificuldade NAO deve mais iniciar a partida diretamente -- isso agora acontece so ao escolher uma duracao'
  );
});

// =====================================================================
// BLOCO C -- CADA OPCAO SELECIONA A DURACAO CORRETA / IDENTIFICADOR INVALIDO
// =====================================================================

test('o handler das opcoes de duracao usa o proprio data-duration do botao clicado, valida antes de aceitar, guarda e so ENTAO inicia a partida', () => {
  const durationOptionsBlock = extractBlock(
    /document\.querySelectorAll\('#match-duration-panel \[data-duration\]'\)\.forEach\(\(button\) => \{[^]*?\n {2}\}\);/,
    'handler das opcoes de duracao'
  );

  assert.ok(
    /const durationId = button\.dataset\.duration;/.test(durationOptionsBlock),
    'o identificador precisa vir diretamente de button.dataset.duration -- nenhuma conversao para outro valor'
  );
  assert.ok(
    /ClientConfig\.MATCH_DURATION_MS/.test(durationOptionsBlock),
    'precisa validar o identificador contra ClientConfig.MATCH_DURATION_MS (Etapa 15A) antes de aceitar'
  );
  assert.ok(
    durationOptionsBlock.includes('selectedMatchDuration = durationId'),
    'escolher uma duracao valida precisa guardar o identificador em selectedMatchDuration'
  );
  assert.ok(
    durationOptionsBlock.includes('UIController.hideMatchDurationSelection()'),
    'escolher uma duracao valida precisa fechar a tela de selecao'
  );
  assert.ok(
    durationOptionsBlock.includes("SocketClient.send('start_solo_match')"),
    'escolher uma duracao valida precisa, so ENTAO, iniciar a partida (mesmo pipeline ja existente)'
  );

  // A validacao precisa acontecer ANTES de guardar/iniciar (return
  // antecipado), nunca depois.
  const validationIndex = durationOptionsBlock.indexOf('ClientConfig.MATCH_DURATION_MS');
  const assignIndex = durationOptionsBlock.indexOf('selectedMatchDuration = durationId');
  assert.ok(
    validationIndex !== -1 && assignIndex !== -1 && validationIndex < assignIndex,
    'a validacao do identificador precisa vir ANTES de guardar a duracao escolhida'
  );
});

test('os quatro botoes do painel de duracao usam exatamente os identificadores de ClientConfig.MATCH_DURATION_IDS (Etapa 15A)', () => {
  const panelMatch = /<section[^>]*id="match-duration-panel"[^]*?<\/section>/.exec(indexHtmlContent);
  const panel = panelMatch[0];
  const idsInHtml = [...panel.matchAll(/data-duration="([^"]+)"/g)].map((m) => m[1]);

  assert.deepStrictEqual(
    idsInHtml.sort(),
    Object.values(ClientConfig.MATCH_DURATION_IDS).sort(),
    'os data-duration do HTML precisam bater EXATAMENTE com ClientConfig.MATCH_DURATION_IDS'
  );
});

DURATION_IDS.forEach((id) => {
  test(`o identificador "${id}" resolve para o mesmo ms usado pela Etapa 15A (MatchDuration.resolveMatchDuration)`, () => {
    const ms = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, id);
    assert.ok(Number.isFinite(ms), `esperava um numero finito de ms para "${id}"`);
    assert.strictEqual(ms, ClientConfig.MATCH_DURATION_MS[id]);
  });
});

test('um identificador invalido (fora de ClientConfig.MATCH_DURATION_MS) nunca resolve para um numero -- cai no fallback seguro', () => {
  const ms = MatchDuration.resolveMatchDuration(ClientConfig.MATCH_DURATION_MS, 'INVALIDO_15B');
  assert.strictEqual(ms, null, 'identificador invalido precisa cair no fallback (null), nunca inventar um numero');
});

// =====================================================================
// BLOCO D -- CANCELAR NUNCA INICIA PARTIDA
// =====================================================================

test('"Cancelar" na tela de duracao fecha o painel, limpa a duracao e desfaz Solo/Bot otimisticamente ligados, sem nunca iniciar partida', () => {
  const cancelBlock = extractBlock(
    /document\.getElementById\('btn-match-duration-cancel'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-match-duration-cancel'
  );

  assert.ok(
    cancelBlock.includes('UIController.hideMatchDurationSelection()'),
    'cancelar precisa fechar a tela de selecao de duracao'
  );
  assert.ok(
    cancelBlock.includes('selectedMatchDuration = null'),
    'cancelar precisa limpar selectedMatchDuration'
  );
  assert.ok(cancelBlock.includes('isSoloMode = false'), 'cancelar precisa devolver isSoloMode a falso');
  assert.ok(cancelBlock.includes('isBotMode = false'), 'cancelar precisa devolver isBotMode a falso');
  assert.ok(cancelBlock.includes('botMatch = null'), 'cancelar precisa devolver botMatch a nulo');
  assert.ok(
    cancelBlock.includes('selectedBotDifficulty = null'),
    'cancelar precisa limpar selectedBotDifficulty (nenhuma tentativa de Bot cancelada sobrevive)'
  );
  assert.ok(
    !cancelBlock.includes('SocketClient.send'),
    'cancelar NUNCA deve enviar nenhuma mensagem de rede/iniciar partida'
  );
});

// =====================================================================
// BLOCO E -- ESTADO DE MODULO PROPRIO (nada de localStorage/duplicacao)
// =====================================================================

test('main.js declara "selectedMatchDuration" como estado de modulo PROPRIO, comecando null (mesmo padrao de selectedBotDifficulty)', () => {
  assert.ok(
    /let selectedMatchDuration = null;/.test(mainJsContent),
    'esperava "let selectedMatchDuration = null;" declarado (mesmo estilo de selectedBotDifficulty)'
  );
});

test('nenhum arquivo do cliente USA localStorage para a duracao da partida (comentarios mencionando a proibicao nao contam)', () => {
  const clientDir = path.join(__dirname, '../client');
  function walk(dir) {
    let matches = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        matches = matches.concat(walk(fullPath));
      } else if (entry.name.endsWith('.js') || entry.name.endsWith('.html')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (/localStorage\s*\./.test(content)) matches.push(fullPath);
      }
    }
    return matches;
  }
  assert.deepStrictEqual(walk(clientDir), [], 'nenhum arquivo do cliente deveria CHAMAR localStorage.*');
});

// =====================================================================
// BLOCO F -- REVANCHE MANTEM A DURACAO ESCOLHIDA
// =====================================================================

test('"Jogar Novamente" (Solo/Bot) nunca mexe em selectedMatchDuration (nem zera, nem reabre a tela de selecao)', () => {
  const onPlayAgainBlock = extractBlock(
    /ResultRenderer\.setOnPlayAgain\(\(\) => \{[^]*?\n {2}\}\);/,
    'ResultRenderer.setOnPlayAgain'
  );
  assert.ok(
    !onPlayAgainBlock.includes('selectedMatchDuration'),
    '"Jogar Novamente" nao deveria tocar em selectedMatchDuration -- a duracao da partida anterior deve sobreviver a revanche'
  );
  assert.ok(
    !onPlayAgainBlock.includes('showMatchDurationSelection'),
    '"Jogar Novamente" nao deveria reabrir a tela de selecao de duracao'
  );
});

// =====================================================================
// BLOCO G -- LIMPEZA NOS PONTOS DE ENTRADA/SAIDA CORRETOS
// =====================================================================

test('"Criar sala" / "Entrar na sala" (multiplayer real) limpam selectedMatchDuration, e nunca abrem a tela de duracao', () => {
  const createRoomBlock = extractBlock(
    /document\.getElementById\('btn-create-room'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-create-room'
  );
  const joinRoomBlock = extractBlock(
    /document\.getElementById\('btn-join-room'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-join-room'
  );

  [createRoomBlock, joinRoomBlock].forEach((block) => {
    assert.ok(block.includes('selectedMatchDuration = null'), 'multiplayer precisa limpar selectedMatchDuration');
    assert.ok(
      !block.includes('showMatchDurationSelection'),
      'multiplayer real nunca deveria abrir a tela de selecao de duracao (servidor ainda nao conhece duracao, Etapa 15A)'
    );
  });
});

test('sair da sala (handleLeftRoom) limpa selectedMatchDuration', () => {
  const leftRoomBlock = extractBlock(/function handleLeftRoom\(\) \{[^]*?\n {2}\}/, 'handleLeftRoom');
  assert.ok(
    leftRoomBlock.includes('selectedMatchDuration = null'),
    'sair da sala precisa limpar selectedMatchDuration (mesmo padrao de selectedBotDifficulty)'
  );
});

test('"Voltar ao Menu" limpa selectedMatchDuration explicitamente, alem de recarregar a pagina', () => {
  const onBackToMenuBlock = extractBlock(
    /ResultRenderer\.setOnBackToMenu\(\(\) => \{[^]*?\n {2}\}\);/,
    'ResultRenderer.setOnBackToMenu'
  );
  assert.ok(
    onBackToMenuBlock.includes('selectedMatchDuration = null'),
    '"Voltar ao Menu" precisa limpar selectedMatchDuration'
  );
});

// =====================================================================
// BLOCO H -- UIController: o painel de fato abre/fecha (mecanismo real)
// =====================================================================

function makeFakeElement(initial = {}) {
  const classes = new Set(initial.classes || []);
  return {
    textContent: initial.textContent || '',
    value: initial.value || '',
    classList: {
      add: (...cls) => cls.forEach((c) => classes.add(c)),
      remove: (...cls) => cls.forEach((c) => classes.delete(c)),
      toggle: (c, force) => {
        const shouldHave = force === undefined ? !classes.has(c) : Boolean(force);
        if (shouldHave) classes.add(c);
        else classes.delete(c);
      },
      contains: (c) => classes.has(c),
    },
    appendChild() {},
    querySelectorAll: () => [],
    _classes: classes,
  };
}

function makeFakeUIDocument() {
  const elements = {
    'status-text': makeFakeElement(),
    lobby: makeFakeElement({ classes: ['hidden'] }),
    'room-info': makeFakeElement(),
    'test-panel': makeFakeElement(),
    'room-code-display': makeFakeElement(),
    'player-slot-display': makeFakeElement(),
    'room-state-display': makeFakeElement(),
    'opponent-status-display': makeFakeElement({ textContent: 'aguardando...' }),
    'message-log': makeFakeElement(),
    'input-room-code': makeFakeElement(),
    'match-panel': makeFakeElement({ classes: ['hidden'] }),
    'match-state-display': makeFakeElement(),
    'match-seed-display': makeFakeElement(),
    'countdown-display': makeFakeElement({ classes: ['hidden'] }),
    'game-field': makeFakeElement({ classes: ['hidden'] }),
    'music-selection-panel': makeFakeElement({ classes: ['hidden'] }),
    'music-list': makeFakeElement(),
    'music-selection-status': makeFakeElement(),
    'player2-name': makeFakeElement({ textContent: 'Jogador 2' }),
    'bot-difficulty-panel': makeFakeElement({ classes: ['hidden'] }),
    'match-duration-panel': makeFakeElement({ classes: ['hidden'] }),
  };
  return {
    getElementById: (id) => elements[id] || null,
    createElement: () => makeFakeElement(),
    documentElement: makeFakeElement(),
    body: makeFakeElement(),
    _elements: elements,
  };
}

function withFreshUIController(fn) {
  const originalDocument = global.document;
  const fakeDocument = makeFakeUIDocument();
  global.document = fakeDocument;

  const uiControllerPath = require.resolve('../client/js/ui/uiController');
  delete require.cache[uiControllerPath];

  try {
    // eslint-disable-next-line global-require
    const UIController = require('../client/js/ui/uiController');
    return fn(UIController, fakeDocument);
  } finally {
    delete require.cache[uiControllerPath];
    global.document = originalDocument;
  }
}

test('UIController.showMatchDurationSelection() remove a classe "hidden" do painel', () => {
  withFreshUIController((UIController, doc) => {
    assert.ok(doc._elements['match-duration-panel']._classes.has('hidden'));
    UIController.showMatchDurationSelection();
    assert.ok(!doc._elements['match-duration-panel']._classes.has('hidden'));
  });
});

test('UIController.hideMatchDurationSelection() devolve a classe "hidden" ao painel', () => {
  withFreshUIController((UIController, doc) => {
    UIController.showMatchDurationSelection();
    assert.ok(!doc._elements['match-duration-panel']._classes.has('hidden'));
    UIController.hideMatchDurationSelection();
    assert.ok(doc._elements['match-duration-panel']._classes.has('hidden'));
  });
});

test('UIController.showMatchDurationSelection/hideMatchDurationSelection degradam com seguranca sem o elemento no DOM', () => {
  const originalDocument = global.document;
  global.document = { getElementById: () => null, createElement: () => makeFakeElement(), documentElement: makeFakeElement(), body: makeFakeElement() };
  const uiControllerPath = require.resolve('../client/js/ui/uiController');
  delete require.cache[uiControllerPath];
  try {
    // eslint-disable-next-line global-require
    const UIController = require('../client/js/ui/uiController');
    assert.doesNotThrow(() => UIController.showMatchDurationSelection());
    assert.doesNotThrow(() => UIController.hideMatchDurationSelection());
  } finally {
    delete require.cache[uiControllerPath];
    global.document = originalDocument;
  }
});

// =====================================================================
// BLOCO I -- NENHUM ENCERRAMENTO POR TEMPO NESTA ETAPA (PARAR AQUI)
// =====================================================================

test('nenhum timer/intervalo/relogio novo foi introduzido pela selecao de duracao em main.js', () => {
  const soloHandlerBlock = extractBlock(
    /document\.getElementById\('btn-play-solo'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-play-solo'
  );
  const durationOptionsBlock = extractBlock(
    /document\.querySelectorAll\('#match-duration-panel \[data-duration\]'\)\.forEach\(\(button\) => \{[^]*?\n {2}\}\);/,
    'handler das opcoes de duracao'
  );
  const cancelBlock = extractBlock(
    /document\.getElementById\('btn-match-duration-cancel'\)\.addEventListener\('click', \(\) => \{[^]*?\n {2}\}\);/,
    'handler de btn-match-duration-cancel'
  );

  [soloHandlerBlock, durationOptionsBlock, cancelBlock].forEach((block) => {
    ['setTimeout(', 'setInterval(', 'Date.now(', 'requestAnimationFrame('].forEach((forbidden) => {
      assert.ok(!block.includes(forbidden), `nao deveria conter "${forbidden}" (nenhum timer nesta etapa)`);
    });
  });
});

// NOTA: ate a Etapa 15B (inclusive), este teste verificava que
// startMatchGameplay AINDA NAO usava selectedMatchDuration/durationMs --
// a Etapa 15B era SOMENTE selecao/armazenamento. A partir da Etapa
// 15C-1C, startMatchGameplay passou a resolver selectedMatchDuration em
// durationMs (via MatchDuration.resolveMatchDuration) e a repassa-lo ao
// MatchEndDetector do Solo -- exatamente a "proxima parte da Etapa 15"
// que este teste ja antecipava. Essa integracao (composicao completa:
// selecao -> ms -> detector -> fim de partida por tempo, incluindo o
// Bot continuar de fora por enquanto) e coberta em detalhe por
// tests/soloMatchDuration15C1C.test.js -- aqui so confirmamos que a
// Etapa 15B em si (o painel de selecao) continua intacta.

test('a selecao de duracao nao toca em nenhum arquivo do servidor (server/)', () => {
  const serverDir = path.join(__dirname, '../server');
  function walk(dir) {
    let matches = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        matches = matches.concat(walk(fullPath));
      } else if (entry.name.endsWith('.js')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('selectedMatchDuration') || content.includes('match-duration-panel')) {
          matches.push(fullPath);
        }
      }
    }
    return matches;
  }
  assert.deepStrictEqual(walk(serverDir), [], 'nenhum arquivo do servidor deveria conhecer a selecao de duracao nesta etapa');
});

// =====================================================================
// BLOCO J -- SOLO / BOT / MODO TESTE / MULTIPLAYER CONTINUAM FUNCIONANDO
// =====================================================================

test('LocalServerSimulator (Modo Teste) mantem sua API intacta com a selecao de duracao carregada', () => {
  assert.strictEqual(typeof LocalServerSimulator.createLocalConnection, 'function');
});

test('LocalServerSimulator ainda reproduz normalmente o fluxo Solo (room_created .. match_started)', () => {
  const messages = [];
  const connection = LocalServerSimulator.createLocalConnection({
    onMessage: (message) => messages.push(message),
    onStatusChange: () => {},
    countdownMs: 0,
  });

  connection.send('start_solo_match');

  const types = messages.map((m) => m.type);
  assert.ok(types.includes('room_created'));
  assert.ok(types.includes('match_ready'));
});

test('LocalServerSimulator continua recusando create_room/join_room (multiplayer exige servidor real)', () => {
  const messages = [];
  const connection = LocalServerSimulator.createLocalConnection({
    onMessage: (message) => messages.push(message),
    onStatusChange: () => {},
    countdownMs: 0,
  });

  connection.send('create_room');

  const errorMessage = messages.find((m) => m.type === 'error');
  assert.ok(errorMessage, 'multiplayer local deveria responder com error, nunca fingir sucesso');
});

test('Multiplayer real (dois jogadores) continua funcionando de ponta a ponta ate FINISHED, sem nenhuma influencia da selecao de duracao', () => {
  function createMockSocket() {
    return {
      OPEN: 1,
      readyState: 1,
      sent: [],
      send(raw) {
        this.sent.push(JSON.parse(raw));
      },
      on() {},
      close() {
        this.readyState = 3;
      },
    };
  }
  function send(ws, message) {
    routeMessage(ws, JSON.stringify(message));
  }
  function lastOfType(socket, type) {
    const matches = socket.sent.filter((m) => m.type === type);
    return matches.length ? matches[matches.length - 1] : null;
  }

  const wsPlayer1 = createMockSocket();
  const wsPlayer2 = createMockSocket();
  registerConnection(wsPlayer1);
  registerConnection(wsPlayer2);

  send(wsPlayer1, { type: 'create_room' });
  const roomCode = lastOfType(wsPlayer1, 'room_created').roomCode;
  send(wsPlayer2, { type: 'join_room', roomCode });

  const match = MatchManager.getMatch(roomCode);
  assert.strictEqual(match.mode, MATCH_MODE.MULTIPLAYER);

  assert.ok(match._countdownTimer, 'esperava um countdown real agendado');
  match._countdownTimer._onTimeout();
  assert.strictEqual(match.state, MATCH_STATE.PLAYING);

  // Nenhum campo relacionado a selecao de duracao chega ao servidor.
  const allSent = [...wsPlayer1.sent, ...wsPlayer2.sent];
  allSent.forEach((message) => {
    assert.ok(!('selectedMatchDuration' in message), 'nenhuma mensagem de rede deveria conter selectedMatchDuration');
    if (message.match) {
      assert.ok(!('duration' in message.match), 'match.duration nao deveria existir nesta etapa');
    }
  });
});

console.log(`\n${passed} passaram, ${failed} falharam.`);
