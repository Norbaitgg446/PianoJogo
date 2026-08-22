/**
 * Gerador pseudoaleatorio deterministico (mulberry32).
 * A mesma seed sempre produz exatamente a mesma sequencia de numeros,
 * o que e essencial para que os dois jogadores gerem a mesma sequencia
 * de notas localmente, sem depender de Math.random() (nao deterministico
 * e independente entre navegadores).
 *
 * IMPORTANTE: esta logica existe DUPLICADA (mas identica) em
 * client/js/match/sequenceGenerator.js, pois o projeto nao usa um bundler
 * compartilhando codigo entre servidor (Node) e cliente (browser).
 * Qualquer alteracao no algoritmo precisa ser replicada nos dois arquivos,
 * caso contrario client e servidor deixam de gerar a mesma sequencia.
 */
function createSeededRandom(seed) {
  let state = seed >>> 0;

  // Retorna uma funcao geradora de numeros em [0, 1), assim como Math.random(),
  // mas 100% deterministica a partir da seed.
  return function nextRandom() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Gera uma sequencia de teste de "notas" (numeros de 1 a noteRange)
 * a partir de uma seed. Usada nesta etapa apenas para comprovar que
 * seed identica => sequencia identica. A sequencia real de notas do
 * jogo do piano sera gerada por um sistema proprio no futuro.
 */
function generateSequence(seed, length, noteRange) {
  const random = createSeededRandom(seed);
  const sequence = [];
  for (let i = 0; i < length; i++) {
    sequence.push(Math.floor(random() * noteRange) + 1);
  }
  return sequence;
}

/**
 * Checksum simples (nao criptografico) usado apenas para comparar
 * rapidamente se duas sequencias sao identicas, sem precisar
 * transmitir a sequencia inteira em todos os casos.
 */
function calculateChecksum(sequence) {
  return sequence.reduce((acc, value, index) => (acc + value * (index + 1)) % 1000000007, 0);
}

module.exports = { createSeededRandom, generateSequence, calculateChecksum };
