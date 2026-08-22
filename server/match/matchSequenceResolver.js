/**
 * Resolucao de (musica -> padrao -> sequencia de referencia) para uma
 * Match (Etapa 10B).
 *
 * ORIGEM: ate a Etapa 10A, esta logica (buscar a musica no
 * musicCatalog, resolver o sequenceId dela no sequenceCatalog, gerar a
 * sequencia de referencia com generateSequence(seed, length, noteRange))
 * vivia inline dentro de server/match/matchFlow.js#startMatchFlow,
 * sempre usando `config.DEFAULT_MUSIC_ID`. Isso funcionava, mas nao
 * dava para testar (nem reutilizar) a resolucao para uma musica
 * diferente sem duplicar a logica ou instanciar uma sala/partida
 * completa.
 *
 * ETAPA 10B: extrai exatamente essa mesma logica para ca, sem alterar
 * nenhum comportamento -- matchFlow.js agora so CHAMA
 * `generateMatchSequence(seed, musicId)` em vez de repetir o corpo
 * inline. Isso permite:
 *   - testar diretamente que music-001 e music-002 resolvem para
 *     sequenceIds/padroes diferentes, sem depender de selecao de
 *     musica (que continua nao implementada);
 *   - garantir isolamento entre duas resolucoes (nenhuma delas
 *     compartilha o mesmo objeto `pattern`/`music`/`noteSequence`).
 *
 * NAO introduz nenhum sistema paralelo de musica/sequencia/timeline:
 * usa exclusivamente musicCatalog, sequenceCatalog e
 * server/match/sequenceGenerator.js, ja existentes.
 */
const musicCatalog = require('../music/musicCatalog');
const sequenceCatalog = require('../music/sequenceCatalog');
const { generateSequence, calculateChecksum } = require('./sequenceGenerator');

/**
 * Resolve a musica e o padrao de sequencia associado a ela.
 * Lanca um Error descritivo (nunca falha silenciosamente) se a musica
 * ou o sequenceId dela nao existirem nos catalogos.
 *
 * @param {string} musicId
 * @returns {{music: object, pattern: object}} copias independentes,
 *   ja isoladas pelos proprios catalogos (musicCatalog/sequenceCatalog).
 */
function resolveMusicAndPattern(musicId) {
  const music = musicCatalog.getMusicById(musicId);
  if (!music) {
    throw new Error(`Musica "${musicId}" nao encontrada no catalogo.`);
  }

  const pattern = sequenceCatalog.getSequencePattern(music.sequenceId);
  if (!pattern) {
    throw new Error(`sequenceId "${music.sequenceId}" da musica "${music.id}" nao existe no sequenceCatalog.`);
  }

  return { music, pattern };
}

/**
 * Gera a sequencia de referencia (uso interno do servidor) para uma
 * partida, a partir da seed dela e da musica escolhida. Mesmo
 * comportamento que ja existia inline em matchFlow.js, apenas
 * reutilizavel/testavel isoladamente.
 *
 * @param {number} seed - seed UNICA da Match (definida por matchFlow.js).
 * @param {string} musicId
 * @returns {{music: object, pattern: object, noteSequence: number[], referenceChecksum: number}}
 */
function generateMatchSequence(seed, musicId) {
  const { music, pattern } = resolveMusicAndPattern(musicId);
  const noteSequence = generateSequence(seed, pattern.length, pattern.noteRange);
  const referenceChecksum = calculateChecksum(noteSequence);

  return { music, pattern, noteSequence, referenceChecksum };
}

module.exports = { resolveMusicAndPattern, generateMatchSequence };
