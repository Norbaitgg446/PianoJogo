/**
 * Catalogo de PADROES de sequencia de notas (Etapa 10A).
 *
 * Ate a Etapa 9C, a partida gerava sua sequencia de notas a partir de
 * dois numeros soltos hardcoded em server/config.js (TEST_SEQUENCE_LENGTH,
 * TEST_NOTE_RANGE), sem nenhuma ligacao com "qual musica" estava sendo
 * jogada. Esta etapa introduz um nivel de indirecao no meio:
 *
 *   musica (musicCatalog.js) --sequenceId--> padrao (este arquivo)
 *
 * Um "padrao" aqui NAO e a sequencia de notas em si -- a sequencia
 * continua sendo gerada exatamente como antes, por
 * server/match/sequenceGenerator.js (generateSequence(seed, length,
 * noteRange)), a partir da seed UNICA de cada partida (ver
 * server/match/matchFlow.js). Nenhum segundo sistema de sincronizacao e
 * criado: seed continua sendo o unico numero que faz o cliente e o
 * servidor gerarem exatamente a mesma sequencia.
 *
 * O que este catalogo guarda e o "molde" reutilizavel dessa geracao:
 * quantas notas (length), quantas lanes possiveis (noteRange) e os
 * parametros de tempo ja usados pela timeline do cliente hoje
 * (noteIntervalMs/leadInMs -- ver client/js/match/matchTimelineManager.js
 * e client/js/match/noteEngine.js). Duas musicas diferentes podem
 * compartilhar o MESMO sequenceId (mesmo "molde" de dificuldade), ou ter
 * cada uma o seu proprio -- este modulo nao assume uma relacao 1:1.
 *
 * Isolamento: `getSequencePattern` sempre devolve uma copia rasa (o
 * padrao so tem campos primitivos, entao um clone raso basta). Alterar
 * o objeto devolvido NUNCA afeta o catalogo interno nem outro padrao.
 */

// Map<sequenceId, {length, noteRange, noteIntervalMs, leadInMs}>. Privado
// deste modulo -- ninguem de fora deve escrever aqui diretamente.
const patterns = new Map();

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isPositiveFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Valida a forma de um padrao de sequencia antes de registra-lo.
 * Lanca um Error descritivo (nunca falha silenciosamente) se algo
 * estiver invalido.
 */
function validatePattern(sequenceId, pattern) {
  if (typeof sequenceId !== 'string' || sequenceId.trim() === '') {
    throw new Error('sequenceId invalido: precisa ser uma string nao vazia.');
  }
  if (!pattern || typeof pattern !== 'object') {
    throw new Error(`Padrao de sequencia invalido para "${sequenceId}": objeto ausente.`);
  }
  if (!isPositiveInteger(pattern.length)) {
    throw new Error(`Padrao de sequencia "${sequenceId}": length precisa ser um inteiro positivo.`);
  }
  if (!isPositiveInteger(pattern.noteRange)) {
    throw new Error(`Padrao de sequencia "${sequenceId}": noteRange precisa ser um inteiro positivo.`);
  }
  if (!isPositiveFiniteNumber(pattern.noteIntervalMs)) {
    throw new Error(`Padrao de sequencia "${sequenceId}": noteIntervalMs precisa ser um numero positivo.`);
  }
  if (typeof pattern.leadInMs !== 'number' || !Number.isFinite(pattern.leadInMs) || pattern.leadInMs < 0) {
    throw new Error(`Padrao de sequencia "${sequenceId}": leadInMs precisa ser um numero >= 0.`);
  }
}

/**
 * Registra um novo padrao de sequencia. Usado internamente por este
 * modulo para montar o catalogo padrao, mas exportado tambem para
 * testes/instancias isoladas (ver SequenceCatalog abaixo).
 */
function registerPattern(sequenceId, pattern) {
  validatePattern(sequenceId, pattern);
  if (patterns.has(sequenceId)) {
    throw new Error(`sequenceId duplicado: "${sequenceId}" ja foi registrado.`);
  }
  patterns.set(sequenceId, { ...pattern });
}

function sequenceExists(sequenceId) {
  return patterns.has(sequenceId);
}

/**
 * Devolve uma COPIA do padrao (nunca a referencia interna), ou `null`
 * se o sequenceId nao existir.
 */
function getSequencePattern(sequenceId) {
  const pattern = patterns.get(sequenceId);
  return pattern ? { ...pattern } : null;
}

function getAllSequenceIds() {
  return [...patterns.keys()];
}

// ---- Padroes de teste, suficientes para validar a arquitetura ----
// (mesmos valores ja usados hoje via TEST_SEQUENCE_LENGTH/TEST_NOTE_RANGE
// e ClientConfig.NOTE_INTERVAL_MS/NOTE_LEAD_IN_MS, para nao mudar NENHUM
// comportamento observavel de gameplay nesta etapa.)
// ETAPA 15 — leadInMs elevado de 1000 para 1800 (= NOTE_TRAVEL_MS) em
// AMBOS os padroes, pelo mesmo motivo documentado em
// client/js/config.js#NOTE_LEAD_IN_MS: a primeira nota so pode comecar
// a cair no topo da lane no instante em que a partida comeca de
// verdade, nunca antes. Mantido identico ao client/js/music/sequenceCatalog.js.
registerPattern('seq-basic-01', {
  length: 16,
  noteRange: 3,
  noteIntervalMs: 600,
  leadInMs: 1800,
});

registerPattern('seq-basic-02', {
  length: 24,
  noteRange: 3,
  noteIntervalMs: 500,
  leadInMs: 1800,
});

module.exports = {
  sequenceExists,
  getSequencePattern,
  getAllSequenceIds,
  registerPattern,
};
