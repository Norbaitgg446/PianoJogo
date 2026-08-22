/**
 * Catalogo central de MUSICAS (Etapa 10A).
 *
 * Responsabilidade unica: representar as musicas disponiveis no jogo
 * como dados estruturados e validados, e permitir consulta-las por ID.
 * Este modulo NAO:
 * - sabe nada sobre Room/Match/WebSocket -- e consultado por quem
 *   precisar (ex: server/match/matchFlow.js), nunca o contrario;
 * - gera a sequencia de notas em si (isso continua sendo
 *   server/match/sequenceGenerator.js, a partir da seed da PARTIDA) --
 *   cada musica apenas aponta para um `sequenceId`, que e o "molde" de
 *   geracao (length/noteRange/timing) guardado em
 *   server/music/sequenceCatalog.js;
 * - implementa selecao de musica, audio, efeitos, ranking, XP, moedas
 *   ou dificuldade dinamica -- tudo isso fica para proximas etapas;
 * - e colocado dentro de messageRouter.js, Match.js ou main.js -- fica
 *   isolado aqui de proposito, para poder ser consultado (e testado)
 *   sem depender de nenhum desses.
 *
 * ESTRUTURA de uma musica (o minimo definido pela Etapa 10A):
 *   { id, title, artist, bpm, durationMs, difficulty, sequenceId }
 * `sequenceId` e uma referencia (foreign key) para
 * server/music/sequenceCatalog.js -- nunca os parametros de geracao
 * embutidos diretamente aqui, para permitir que musicas diferentes
 * compartilhem o mesmo "molde" de dificuldade sem duplicar numeros.
 *
 * ISOLAMENTO: toda leitura (`getAllMusics`, `getMusicById`,
 * `getMusicMetadata`) devolve uma COPIA (`{ ...entry }`) do registro
 * interno -- os campos de uma musica sao todos primitivos (string/
 * number), entao uma copia rasa basta para garantir que alterar o
 * objeto devolvido nunca afeta o catalogo nem outra musica. O catalogo
 * tambem nao guarda nem le nenhum estado de sala/partida -- e so dados
 * estaticos, os mesmos para qualquer partida que consultar.
 */
const sequenceCatalog = require('./sequenceCatalog');

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPositiveFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Valida a forma de uma definicao de musica antes de registra-la.
 * Lanca um Error descritivo (nunca falha silenciosamente, nunca
 * registra parcialmente) se qualquer campo obrigatorio for invalido.
 *
 * @param {object} definition
 */
function validateMusicDefinition(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new Error('Definicao de musica invalida: objeto ausente.');
  }

  const { id, title, artist, bpm, durationMs, difficulty, sequenceId } = definition;

  if (!isNonEmptyString(id)) {
    throw new Error('Musica invalida: "id" precisa ser uma string nao vazia.');
  }
  if (!isNonEmptyString(title)) {
    throw new Error(`Musica "${id}" invalida: "title" precisa ser uma string nao vazia.`);
  }
  if (!isNonEmptyString(artist)) {
    throw new Error(`Musica "${id}" invalida: "artist" precisa ser uma string nao vazia.`);
  }
  if (!isPositiveFiniteNumber(bpm)) {
    throw new Error(`Musica "${id}" invalida: "bpm" precisa ser um numero positivo.`);
  }
  if (!isPositiveFiniteNumber(durationMs)) {
    throw new Error(`Musica "${id}" invalida: "durationMs" precisa ser um numero positivo.`);
  }
  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    throw new Error(
      `Musica "${id}" invalida: "difficulty" precisa ser uma das seguintes: ${VALID_DIFFICULTIES.join(', ')}.`
    );
  }
  if (!isNonEmptyString(sequenceId)) {
    throw new Error(`Musica "${id}" invalida: "sequenceId" precisa ser uma string nao vazia.`);
  }
  if (!sequenceCatalog.sequenceExists(sequenceId)) {
    throw new Error(`Musica "${id}" invalida: sequenceId "${sequenceId}" nao existe no sequenceCatalog.`);
  }
}

/**
 * Catalogo de musicas propriamente dito. Exportado como classe (alem do
 * singleton padrao mais abaixo, que e o realmente usado em producao)
 * para permitir instancias isoladas em testes -- mesmo padrao ja usado
 * por RoomManager/MatchManager (classe + singleton), mas aqui a classe
 * tambem e exposta para nao precisar de um catalogo de producao "sujo"
 * so para testar validacao/duplicidade.
 */
class MusicCatalog {
  constructor() {
    this._musics = new Map();
  }

  /**
   * Registra uma nova musica. Lanca um Error (nao registra nada) se a
   * definicao for invalida OU se o id ja existir neste catalogo --
   * nunca sobrescreve uma musica existente silenciosamente.
   */
  registerMusic(definition) {
    validateMusicDefinition(definition);

    if (this._musics.has(definition.id)) {
      throw new Error(`Musica duplicada: id "${definition.id}" ja foi registrado neste catalogo.`);
    }

    this._musics.set(definition.id, { ...definition });
    return this.getMusicById(definition.id);
  }

  /**
   * Todas as musicas do catalogo, em copias independentes (a ordem de
   * registro e preservada, mas nenhum item devolvido e a referencia
   * interna).
   */
  getAllMusics() {
    return [...this._musics.values()].map((entry) => ({ ...entry }));
  }

  /**
   * Musica por ID, ou `null` se nao existir (mesmo padrao ja usado por
   * RoomManager.getRoom/MatchManager.getMatch -- nunca lanca para uma
   * busca simples).
   */
  getMusicById(id) {
    const entry = this._musics.get(id);
    return entry ? { ...entry } : null;
  }

  /**
   * Alias semantico de getMusicById: "os metadados de uma musica" sao,
   * nesta etapa, a propria musica (nao ha nenhum campo interno/privado
   * separado ainda). Mantido como funcao propria para que uma proxima
   * etapa possa restringir o que e exposto aqui sem mexer em
   * getMusicById (usado, por exemplo, para compor `match.music`).
   */
  getMusicMetadata(id) {
    return this.getMusicById(id);
  }

  musicExists(id) {
    return this._musics.has(id);
  }
}

/**
 * Monta o catalogo PADRAO (usado em producao) com algumas musicas de
 * teste -- suficientes para validar a arquitetura, sem a necessidade de
 * dezenas de musicas reais nesta etapa.
 */
function buildDefaultCatalog() {
  const catalog = new MusicCatalog();

  catalog.registerMusic({
    id: 'music-001',
    title: 'Sinais de Teste',
    artist: 'Estudio Interno',
    bpm: 120,
    durationMs: 90000,
    difficulty: 'easy',
    sequenceId: 'seq-basic-01',
  });

  catalog.registerMusic({
    id: 'music-002',
    title: 'Contagem Regressiva',
    artist: 'Estudio Interno',
    bpm: 140,
    durationMs: 105000,
    difficulty: 'medium',
    sequenceId: 'seq-basic-02',
  });

  return catalog;
}

// Singleton usado em producao -- mesmo padrao de RoomManager/MatchManager.
const defaultCatalog = buildDefaultCatalog();

module.exports = {
  MusicCatalog,
  validateMusicDefinition,
  VALID_DIFFICULTIES,
  getAllMusics: () => defaultCatalog.getAllMusics(),
  getMusicById: (id) => defaultCatalog.getMusicById(id),
  getMusicMetadata: (id) => defaultCatalog.getMusicMetadata(id),
  musicExists: (id) => defaultCatalog.musicExists(id),
};
