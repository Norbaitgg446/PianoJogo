/**
 * Gerador pseudoaleatorio deterministico (mulberry32) — versao cliente.
 *
 * IMPORTANTE: este algoritmo precisa ser IDENTICO ao de
 * server/match/sequenceGenerator.js. E por isso que a mesma seed enviada
 * pelo servidor produz, aqui no navegador, exatamente a mesma sequencia
 * que o servidor calculou internamente. Nao usamos Math.random() porque
 * ele nao e deterministico entre execucoes/maquinas diferentes.
 */
const SequenceGenerator = (() => {
  function createSeededRandom(seed) {
    let state = seed >>> 0;

    return function nextRandom() {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateSequence(seed, length, noteRange) {
    const random = createSeededRandom(seed);
    const sequence = [];
    for (let i = 0; i < length; i++) {
      sequence.push(Math.floor(random() * noteRange) + 1);
    }
    return sequence;
  }

  function calculateChecksum(sequence) {
    return sequence.reduce((acc, value, index) => (acc + value * (index + 1)) % 1000000007, 0);
  }

  return { createSeededRandom, generateSequence, calculateChecksum };
})();

// Exportado condicionalmente para permitir reuso/teste em Node (ex: scripts
// de teste automatizado da Etapa 4A) sem alterar em nada o comportamento
// no navegador, onde `module` nao existe e este bloco e simplesmente ignorado.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SequenceGenerator;
}
