/**
 * Catalogo de PADROES de sequencia de notas -- versao cliente (Etapa 10B).
 *
 * IMPORTANTE (mesmo raciocinio ja documentado em
 * client/js/match/sequenceGenerator.js): o projeto nao usa um bundler
 * compartilhando codigo entre servidor (Node) e cliente (browser), entao
 * este catalogo existe DUPLICADO (mas deve permanecer IDENTICO em
 * conteudo) em relacao a server/music/sequenceCatalog.js. Isso ja era
 * verdade mesmo antes desta etapa para o gerador de numeros
 * pseudoaleatorios -- aqui aplicamos a mesma estrategia para os
 * "moldes" de sequencia (length/noteRange/noteIntervalMs/leadInMs) de
 * cada musica, que ate a Etapa 10A so existiam no servidor.
 *
 * Ate a Etapa 10A, o cliente NUNCA usava o sequenceId da musica: ele
 * sempre montava a timeline com os mesmos 4 numeros fixos de
 * ClientConfig (TEST_SEQUENCE_LENGTH/TEST_NOTE_RANGE/NOTE_INTERVAL_MS/
 * NOTE_LEAD_IN_MS), nao importava qual musica o servidor tivesse
 * escolhido. Isso funcionava so porque, ate entao, so existia UM
 * padrao efetivamente em uso (os dois exemplos de teste do catalogo
 * do servidor tinham os mesmos valores usados aqui). A Etapa 10B
 * corrige isso: agora o cliente resolve o MESMO sequenceId recebido em
 * `match.music.sequenceId` (o servidor envia `match.music` completo em
 * toPublicJSON) contra este catalogo, para montar a timeline com o
 * padrao correto de CADA musica -- ver client/js/main.js.
 *
 * A seed continua sendo o UNICO mecanismo de sincronizacao entre os
 * dois jogadores; este catalogo so decide OS PARAMETROS (quantas notas,
 * quantas lanes, timing) usados junto da seed -- nunca substitui nem
 * complementa a seed com nenhuma fonte de aleatoriedade propria.
 *
 * ISOLAMENTO: `getSequencePattern` sempre devolve uma copia rasa (todos
 * os campos sao primitivos) -- alterar o objeto devolvido nunca afeta
 * o catalogo interno nem outro padrao.
 */
const SequenceCatalog = (() => {
  // Map<sequenceId, {length, noteRange, noteIntervalMs, leadInMs}>.
  // Privado deste modulo -- ninguem de fora deve escrever aqui
  // diretamente.
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
   * estiver invalido -- mesmas regras da versao servidor.
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

  // ---- Padroes de teste -- DEVEM permanecer identicos aos registrados
  // em server/music/sequenceCatalog.js. Qualquer alteracao ali precisa
  // ser replicada aqui, ou os dois lados deixam de montar a mesma
  // timeline a partir do mesmo sequenceId. ----
  // ETAPA 15 — leadInMs elevado de 1000 para 1800 (= NOTE_TRAVEL_MS),
  // mantido identico ao server/music/sequenceCatalog.js. Ver
  // ClientConfig.NOTE_LEAD_IN_MS para a explicacao completa do motivo.
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

  return {
    sequenceExists,
    getSequencePattern,
    getAllSequenceIds,
    registerPattern,
  };
})();

// Exportado condicionalmente (mesmo padrao ja usado em
// client/js/match/sequenceGenerator.js) para permitir reuso/teste em
// Node sem alterar nada no navegador, onde `module` nao existe.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SequenceCatalog;
}
