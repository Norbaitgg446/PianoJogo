/**
 * Configuracoes gerais do servidor multiplayer.
 * Centralizar aqui evita "magic numbers" espalhados pelo codigo
 * e facilita ajustes nas proximas etapas (ex: heartbeat, timeouts).
 */
module.exports = {
  PORT: process.env.PORT || 3000,

  // Quantidade fixa de jogadores por sala nesta etapa.
  MAX_PLAYERS_PER_ROOM: 2,

  // Tamanho do codigo da sala (ex: "A1B2C3").
  ROOM_CODE_LENGTH: 6,

  // Caracteres usados para gerar o codigo (sem caracteres ambiguos: 0/O, 1/I).
  ROOM_CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',

  // Duracao da contagem regressiva antes do inicio da partida (3, 2, 1 -> iniciar).
  MATCH_COUNTDOWN_SECONDS: 3,

  // ---- Configuracao de TESTE da partida (Etapa 3) ----
  // Valores fixos apenas para comprovar que seed/sequencia sao sincronizados.
  // Serao substituidos por um sistema real de musicas/dificuldades no futuro.
  TEST_SONG_ID: 'test-song-01',
  TEST_DIFFICULTY: 'easy',
  TEST_SPEED: 1,
  TEST_SEQUENCE_LENGTH: 16, // quantidade de "notas" de teste na sequencia
  TEST_NOTE_RANGE: 3,       // valores possiveis: 1 a 3 (lanes: 1=esquerda, 2=cima, 3=direita)

  // ---- Musicas (Etapa 10A) ----
  // Ainda nao ha selecao de musica (isso fica para uma proxima etapa):
  // toda partida nova usa esta musica padrao do catalogo
  // (server/music/musicCatalog.js). O sequenceId dela ja aponta para os
  // MESMOS valores de TEST_SEQUENCE_LENGTH/TEST_NOTE_RANGE acima (ver
  // server/music/sequenceCatalog.js), entao nenhum comportamento de
  // gameplay muda nesta etapa -- so a origem desses numeros.
  DEFAULT_MUSIC_ID: 'music-001',
};
