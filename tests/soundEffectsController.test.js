/**
 * Testes automatizados do sistema de efeitos sonoros (Etapa 13D — Parte 2).
 *
 * SoundEffectsController so toca em `window`/AudioContext DENTRO das
 * funcoes publicas (nunca no carregamento do modulo), entao da para
 * testar tudo em Node puro: um cenario sem `window` nenhum (simula o
 * ambiente de teste/Node de verdade) e outro com um `window.AudioContext`
 * "falso" minimo (duck-typing de createOscillator/createGain/resume),
 * no mesmo estilo ja usado em tests/feedbackRenderer.test.js e
 * tests/inputController.test.js -- sem jsdom nem navegador de verdade.
 *
 * Executar com: node tests/soundEffectsController.test.js
 */
const assert = require('assert');
const path = require('path');

const MODULE_PATH = require.resolve('../client/js/audio/soundEffectsController');

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

/**
 * Recarrega o modulo do zero (o AudioContext e um singleton por
 * modulo) para cada teste comecar com estado limpo, sem um teste
 * "vazar" AudioContext/flag `unsupported` para o proximo.
 */
function freshModule() {
  delete require.cache[MODULE_PATH];
  return require(MODULE_PATH);
}

// ---------------------------------------------------------------------
// Web Audio API "falsa": osciladores/gains minimos que so registram o
// que foi chamado, sem tocar nenhum som de verdade.
// ---------------------------------------------------------------------
function makeFakeAudioApi({ initialState = 'running', resumeResolves = true, throwOnConstruct = false } = {}) {
  const createdOscillators = [];
  const createdGains = [];
  let constructAttempts = 0;

  function FakeGainNode() {
    this.gain = {
      value: 1,
      setValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
    };
    this.disconnectCalled = false;
    this.connect = () => {};
    this.disconnect = () => {
      this.disconnectCalled = true;
    };
    createdGains.push(this);
  }

  function FakeOscillatorNode() {
    this.type = null;
    this.frequency = {
      value: 0,
      setValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
    };
    this.started = false;
    this.stopped = false;
    this.onended = null;
    this.disconnectCalled = false;
    this.connect = () => {};
    this.disconnect = () => {
      this.disconnectCalled = true;
    };
    this.start = () => {
      this.started = true;
    };
    // Simula o fim do som IMEDIATAMENTE (som curto, teste sincrono):
    // dispara onended, exatamente como o navegador faria ao terminar.
    this.stop = () => {
      this.stopped = true;
      if (typeof this.onended === 'function') this.onended();
    };
    createdOscillators.push(this);
  }

  function FakeAudioContext() {
    constructAttempts += 1;
    if (throwOnConstruct) {
      throw new Error('AudioContext bloqueado pelo navegador (simulado)');
    }
    this.state = initialState;
    this.currentTime = 0;
    this.destination = {};
    this.createGain = () => new FakeGainNode();
    this.createOscillator = () => new FakeOscillatorNode();
    this.resume = () => {
      if (resumeResolves) {
        this.state = 'running';
        return Promise.resolve();
      }
      return Promise.reject(new Error('resume recusado pelo navegador (simulado)'));
    };
  }

  return {
    FakeAudioContext,
    createdOscillators,
    createdGains,
    getConstructAttempts: () => constructAttempts,
  };
}

function withFakeWindow(audioApiOptions, fn) {
  const previousWindow = global.window;
  const fakeApi = makeFakeAudioApi(audioApiOptions);
  global.window = { AudioContext: fakeApi.FakeAudioContext };
  try {
    fn(freshModule(), fakeApi);
  } finally {
    if (previousWindow === undefined) {
      delete global.window;
    } else {
      global.window = previousWindow;
    }
  }
}

function withoutWindow(fn) {
  const previousWindow = global.window;
  delete global.window;
  try {
    fn(freshModule());
  } finally {
    if (previousWindow !== undefined) {
      global.window = previousWindow;
    }
  }
}

// ---------------------------------------------------------------------
// 1) Dados puros -- sem AudioContext nenhum.
// ---------------------------------------------------------------------

test('define um som para cada evento pedido no enunciado', () => {
  const SoundEffectsController = freshModule();
  const { SOUND_DEFS, OUTCOME_SOUND } = SoundEffectsController._internal;

  ['PERFECT', 'GREAT', 'GOOD', 'MISS', 'MISTAKE', 'COMBO_UP'].forEach((key) => {
    assert.ok(SOUND_DEFS[key], `SOUND_DEFS deveria ter uma definicao para ${key}`);
    assert.ok(SOUND_DEFS[key].freq > 0, `${key} deveria ter uma frequencia positiva`);
    assert.ok(SOUND_DEFS[key].duration > 0, `${key} deveria ter uma duracao positiva`);
  });

  // outcome (o mesmo texto que GameplayEngine/FeedbackRenderer usam)
  // mapeado 1:1 para os 5 julgamentos -- COMBO_UP nao e um outcome de
  // julgamento, e chamado separadamente (playComboUp).
  assert.deepStrictEqual(Object.keys(OUTCOME_SOUND).sort(), ['GOOD', 'GREAT', 'MISS', 'MISTAKE', 'PERFECT'].sort());
});

test('cada som e distinguivel dos demais (combinacao tipo+frequencia unica)', () => {
  const SoundEffectsController = freshModule();
  const { SOUND_DEFS } = SoundEffectsController._internal;

  const signatures = Object.values(SOUND_DEFS).map((def) => `${def.type}:${def.freq}`);
  const uniqueSignatures = new Set(signatures);
  assert.strictEqual(uniqueSignatures.size, signatures.length, 'dois sons nao deveriam compartilhar tipo+frequencia');
});

// ---------------------------------------------------------------------
// 2) Sem `window` (Node puro / navegador sem Web Audio) -- nunca lanca,
//    nunca trava: so devolve false silenciosamente.
// ---------------------------------------------------------------------

test('sem suporte a Web Audio: unlock() e todos os play*() devolvem false sem lancar', () => {
  withoutWindow((SoundEffectsController) => {
    assert.strictEqual(SoundEffectsController.unlock(), false);
    assert.strictEqual(SoundEffectsController.isReady(), false);
    assert.strictEqual(SoundEffectsController.playPerfect(), false);
    assert.strictEqual(SoundEffectsController.playGreat(), false);
    assert.strictEqual(SoundEffectsController.playGood(), false);
    assert.strictEqual(SoundEffectsController.playMiss(), false);
    assert.strictEqual(SoundEffectsController.playMistake(), false);
    assert.strictEqual(SoundEffectsController.playComboUp(), false);
    assert.strictEqual(SoundEffectsController.playForOutcome('PERFECT'), false);
  });
});

test('outcome desconhecido nunca toca nada e nunca lanca', () => {
  withoutWindow((SoundEffectsController) => {
    assert.strictEqual(SoundEffectsController.playForOutcome('ALGO_INEXISTENTE'), false);
    assert.strictEqual(SoundEffectsController.playForOutcome(undefined), false);
  });
});

// ---------------------------------------------------------------------
// 3) Com um AudioContext "falso" que funciona normalmente.
// ---------------------------------------------------------------------

test('com Web Audio disponivel e destravado, cada play* cria e inicia um oscilador', () => {
  withFakeWindow({ initialState: 'running' }, (SoundEffectsController, fakeApi) => {
    assert.strictEqual(SoundEffectsController.unlock(), true);
    assert.strictEqual(SoundEffectsController.isReady(), true);

    assert.strictEqual(SoundEffectsController.playPerfect(), true);
    assert.strictEqual(SoundEffectsController.playGreat(), true);
    assert.strictEqual(SoundEffectsController.playGood(), true);
    assert.strictEqual(SoundEffectsController.playMiss(), true);
    assert.strictEqual(SoundEffectsController.playMistake(), true);
    assert.strictEqual(SoundEffectsController.playComboUp(), true);

    assert.strictEqual(fakeApi.createdOscillators.length, 6);
    fakeApi.createdOscillators.forEach((osc) => {
      assert.strictEqual(osc.started, true);
      assert.strictEqual(osc.stopped, true);
    });
  });
});

test('playForOutcome() repassa o outcome de julgamento para o som certo', () => {
  withFakeWindow({ initialState: 'running' }, (SoundEffectsController, fakeApi) => {
    SoundEffectsController.unlock();

    assert.strictEqual(SoundEffectsController.playForOutcome('PERFECT'), true);
    assert.strictEqual(SoundEffectsController.playForOutcome('MISTAKE'), true);
    assert.strictEqual(SoundEffectsController.playForOutcome('NAO_EXISTE'), false);

    assert.strictEqual(fakeApi.createdOscillators.length, 2);
  });
});

test('nunca acumula nos de audio presos: onended desconecta oscilador e gain', () => {
  withFakeWindow({ initialState: 'running' }, (SoundEffectsController, fakeApi) => {
    SoundEffectsController.unlock();
    SoundEffectsController.playPerfect();

    // 2 gains: o gain MESTRE (criado uma vez por ensureContext, nunca
    // desconectado -- e o "alto-falante" compartilhado por todos os
    // sons) + o gain proprio deste som.
    assert.strictEqual(fakeApi.createdOscillators.length, 1);
    assert.strictEqual(fakeApi.createdGains.length, 2);
    // O fake dispara onended sincronamente dentro de stop() -- exatamente
    // o gatilho que o modulo usa para desconectar os dois nos do SOM
    // (nao o gain mestre, que precisa continuar conectado entre sons).
    assert.strictEqual(fakeApi.createdOscillators[0].disconnectCalled, true);
    const soundGain = fakeApi.createdGains[1];
    assert.strictEqual(soundGain.disconnectCalled, true);
  });
});

test('reaproveita um UNICO AudioContext entre varias chamadas (nunca cria mais de um)', () => {
  withFakeWindow({ initialState: 'running' }, (SoundEffectsController, fakeApi) => {
    SoundEffectsController.unlock();
    SoundEffectsController.playPerfect();
    SoundEffectsController.playGood();
    SoundEffectsController.playMiss();

    assert.strictEqual(fakeApi.getConstructAttempts(), 1);
    assert.strictEqual(fakeApi.createdOscillators.length, 3);
  });
});

// ---------------------------------------------------------------------
// 4) Bloqueio de autoplay: navegador recusa liberar o audio.
// ---------------------------------------------------------------------

test('AudioContext continua suspenso (autoplay bloqueado): nenhum som toca, nada lanca', () => {
  withFakeWindow({ initialState: 'suspended', resumeResolves: false }, (SoundEffectsController, fakeApi) => {
    // unlock() ainda devolve true (o contexto EXISTE), mas o navegador
    // nunca libera de verdade (resume() rejeita) -- item 3 do enunciado:
    // "se o navegador bloquear algum som, isso nao pode travar o jogo".
    assert.strictEqual(SoundEffectsController.unlock(), true);
    assert.strictEqual(SoundEffectsController.isReady(), false);

    assert.strictEqual(SoundEffectsController.playPerfect(), false);
    assert.strictEqual(SoundEffectsController.playForOutcome('MISS'), false);
    assert.strictEqual(SoundEffectsController.playComboUp(), false);

    // Nenhum oscilador chegou a ser criado -- o bloqueio e detectado
    // ANTES de tentar tocar qualquer coisa.
    assert.strictEqual(fakeApi.createdOscillators.length, 0);
  });
});

test('AudioContext lanca excecao ao ser criado: tratado como "sem suporte", sem lancar para quem chamou', () => {
  withFakeWindow({ throwOnConstruct: true }, (SoundEffectsController, fakeApi) => {
    assert.strictEqual(SoundEffectsController.unlock(), false);
    assert.strictEqual(SoundEffectsController.playPerfect(), false);
    assert.strictEqual(SoundEffectsController.playForOutcome('GOOD'), false);

    // So tenta construir o AudioContext UMA vez -- depois de falhar,
    // fica marcado como sem suporte (nunca tenta de novo a cada som).
    assert.strictEqual(fakeApi.getConstructAttempts(), 1);
  });
});

// ---------------------------------------------------------------------

console.log(`\n${passed} teste(s) passaram.`);
if (process.exitCode) {
  console.error('Um ou mais testes falharam.');
} else {
  console.log('Todos os testes passaram.');
}
