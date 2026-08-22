/**
 * Configuracao de teste do cliente para a Etapa 3.
 * TEST_SEQUENCE_LENGTH e TEST_NOTE_RANGE precisam ser EXATAMENTE iguais
 * aos valores usados em server/config.js, pois ambos os lados geram a
 * sequencia localmente a partir da mesma seed. Se esses numeros
 * divergirem, os dois clientes produzirao sequencias diferentes mesmo
 * com a seed correta.
 */
const ClientConfig = {
  TEST_SEQUENCE_LENGTH: 16,
  TEST_NOTE_RANGE: 3, // 3 lanes: 1=esquerda (←), 2=cima (↑), 3=direita (→)

  // ---- Configuracao de timing das notas (Etapa 4A) ----
  // Intervalo fixo (ms) entre o tempo de uma nota e a proxima.
  // Precisa ser IDENTICO nos dois clientes, assim como TEST_SEQUENCE_LENGTH
  // e TEST_NOTE_RANGE, pois os tempos das notas sao derivados dele.
  NOTE_INTERVAL_MS: 600,

  // Atraso adicional (ms) somado ao startTimestamp antes da primeira nota,
  // para dar um pequeno "respiro" logo apos o fim da contagem regressiva.
  NOTE_LEAD_IN_MS: 1000,

  // Janela (ms) para tras/para frente do tempo exato da nota em que ela
  // e considerada "active" (dentro do intervalo em que pode ser julgada).
  // Fora dessa janela, sem ter sido processada, a nota vira "missed".
  NOTE_HIT_WINDOW_MS: 150,

  // ---- Configuracao de julgamento e pontuacao (Etapa 4B) ----
  // Janelas de tempo (ms, distancia absoluta ate o tempo exato da nota)
  // usadas para classificar uma tentativa de acerto. GOOD_MS deve ser
  // <= NOTE_HIT_WINDOW_MS: alem disso a nota ja teria virado "missed"
  // automaticamente pelo NoteEngine antes do jogador conseguir julga-la.
  JUDGEMENT_WINDOWS: {
    PERFECT_MS: 60,
    GOOD_MS: 150,
  },

  // Pontuacao concedida por julgamento. MISS nunca pontua.
  // Sem multiplicadores de combo nesta etapa (fica para depois).
  SCORE_VALUES: {
    PERFECT: 300,
    GOOD: 100,
    MISS: 0,
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ClientConfig;
}
