/**
 * ETAPA 15C-1A — Funcao pura de limite de duracao.
 *
 * IMPORTANTE: esta etapa e SOMENTE a funcao pura + testes. Nenhuma
 * partida termina mais cedo por causa disto ainda -- ninguem chama
 * `hasReachedMatchDuration` a partir de MatchController/
 * BotMatchController/MatchEndDetector/main.js para de fato encerrar
 * uma partida. Isso fica para uma proxima parte da Etapa 15.
 *
 * Este arquivo testa exclusivamente
 * `MatchDuration.hasReachedMatchDuration(currentTime, startTime, durationMs)`:
 *   - antes do limite (false);
 *   - exatamente no limite (true);
 *   - depois do limite (true);
 *   - durações de 30s, 1min, 5min e 10min;
 *   - valores invalidos/nao finitos (false, nunca lanca erro);
 *   - numeros negativos;
 *   - que a funcao nao depende de nenhum relogio externo (Date.now/
 *     performance.now/setTimeout/setInterval/requestAnimationFrame/DOM),
 *     tanto por inspecao estatica do arquivo-fonte quanto chamando a
 *     funcao repetidas vezes com os mesmos argumentos.
 *
 * Mesmo estilo dos demais arquivos de teste do projeto (ex:
 * tests/matchDuration15A.test.js): exercita o modulo REAL, nunca
 * reimplementa a logica aqui.
 *
 * Executar com: node tests/matchDurationLimit15C1A.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const MatchDuration = require('../client/js/match/matchDuration');

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

// =====================================================================
// 1. Antes / exatamente no / depois do limite (exemplo do enunciado)
// =====================================================================

test('antes da duracao (currentTime - startTime < durationMs) devolve false', () => {
  const result = MatchDuration.hasReachedMatchDuration(39999, 10000, 30000);
  assert.strictEqual(result, false);
});

test('exatamente na duracao (currentTime - startTime === durationMs) devolve true', () => {
  const result = MatchDuration.hasReachedMatchDuration(40000, 10000, 30000);
  assert.strictEqual(result, true);
});

test('depois da duracao (currentTime - startTime > durationMs) devolve true', () => {
  const result = MatchDuration.hasReachedMatchDuration(45000, 10000, 30000);
  assert.strictEqual(result, true);
});

// =====================================================================
// 2. Duracoes reais do jogo (30s / 1min / 5min / 10min)
// =====================================================================

test('duracao de 30 segundos (30000ms): false antes, true no limite, true depois', () => {
  const startTime = 0;
  const durationMs = 30000;

  assert.strictEqual(MatchDuration.hasReachedMatchDuration(29999, startTime, durationMs), false);
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(30000, startTime, durationMs), true);
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(30001, startTime, durationMs), true);
});

test('duracao de 1 minuto (60000ms): false antes, true no limite, true depois', () => {
  const startTime = 5000;
  const durationMs = 60000;

  assert.strictEqual(MatchDuration.hasReachedMatchDuration(64999, startTime, durationMs), false);
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(65000, startTime, durationMs), true);
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(65001, startTime, durationMs), true);
});

test('duracao de 5 minutos (300000ms): false antes, true no limite, true depois', () => {
  const startTime = 1_000_000;
  const durationMs = 300000;

  assert.strictEqual(MatchDuration.hasReachedMatchDuration(1_299_999, startTime, durationMs), false);
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(1_300_000, startTime, durationMs), true);
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(1_300_001, startTime, durationMs), true);
});

test('duracao de 10 minutos (600000ms): false antes, true no limite, true depois', () => {
  const startTime = 2_000_000;
  const durationMs = 600000;

  assert.strictEqual(MatchDuration.hasReachedMatchDuration(2_599_999, startTime, durationMs), false);
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(2_600_000, startTime, durationMs), true);
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(2_600_001, startTime, durationMs), true);
});

// =====================================================================
// 3. Valores invalidos / nao finitos -- nunca lanca erro, nunca considera atingido
// =====================================================================

test('currentTime invalido (undefined) devolve false', () => {
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(undefined, 0, 30000), false);
});

test('startTime invalido (null) devolve false', () => {
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(40000, null, 30000), false);
});

test('durationMs invalido (string) devolve false', () => {
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(40000, 10000, 'trinta mil'), false);
});

test('currentTime NaN devolve false', () => {
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(NaN, 10000, 30000), false);
});

test('durationMs Infinity (nao finito) devolve false', () => {
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(40000, 10000, Infinity), false);
});

test('chamar sem nenhum argumento nunca lanca erro e devolve false', () => {
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(), false);
});

test('durationMs igual a zero (duracao "desligada") devolve false, mesmo com currentTime muito maior que startTime', () => {
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(999999, 0, 0), false);
});

test('durationMs negativo devolve false (nao cria comportamento inesperado)', () => {
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(40000, 10000, -30000), false);
});

// =====================================================================
// 4. Numeros negativos (validos, so o durationMs <= 0 e tratado como invalido)
// =====================================================================

test('startTime e currentTime negativos, com durationMs positivo, funcionam normalmente', () => {
  // relogio hipotetico negativo: -10000 (start) .. -5000 (agora) = 5000ms decorridos
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(-5000, -10000, 4000), true);
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(-5000, -10000, 5000), true);
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(-5000, -10000, 6000), false);
});

test('currentTime menor que startTime (relogio "andou para tras") nunca considera duracao atingida', () => {
  assert.strictEqual(MatchDuration.hasReachedMatchDuration(5000, 10000, 30000), false);
});

// =====================================================================
// 5. Independencia de relogio externo
// =====================================================================

test('hasReachedMatchDuration e pura: mesma entrada sempre devolve a mesma saida', () => {
  const a = MatchDuration.hasReachedMatchDuration(45000, 10000, 30000);
  const b = MatchDuration.hasReachedMatchDuration(45000, 10000, 30000);
  const c = MatchDuration.hasReachedMatchDuration(45000, 10000, 30000);
  assert.strictEqual(a, true);
  assert.strictEqual(a, b);
  assert.strictEqual(b, c);
});

test('client/js/match/matchDuration.js nunca referencia Date.now/performance.now/setTimeout/setInterval/requestAnimationFrame/document/window', () => {
  const filePath = path.join(__dirname, '../client/js/match/matchDuration.js');
  const content = fs.readFileSync(filePath, 'utf8');

  [
    'Date.now(',
    'performance.now(',
    'setTimeout(',
    'setInterval(',
    'requestAnimationFrame(',
    'document.',
    'window.',
  ].forEach((forbidden) => {
    assert.ok(
      !content.includes(forbidden),
      `matchDuration.js nao deveria conter "${forbidden}" (funcao precisa ser pura, sem relogio/timer/DOM)`
    );
  });
});

console.log(`\n${passed} teste(s) passaram.`);
