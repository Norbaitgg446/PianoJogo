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
  //
  // ETAPA 15 — precisa ser >= NOTE_TRAVEL_MS (abaixo). Uma seta "nasce"
  // visualmente em `note.time - NOTE_TRAVEL_MS` (ver NoteRenderer). Se
  // NOTE_LEAD_IN_MS fosse menor que NOTE_TRAVEL_MS, a primeira nota
  // teria `note.time - NOTE_TRAVEL_MS < startTimestamp`, ou seja, ela
  // deveria comecar a cair ANTES do proprio inicio da partida -- mas
  // NoteRenderer.start() (chamado em `match_started`) so comeca a
  // desenhar a partir de startTimestamp, entao a seta aparecia ja
  // "nascida" no meio do percurso, em vez de no topo da lane. Manter
  // este valor igual a NOTE_TRAVEL_MS garante que a primeira nota nasce
  // exatamente no topo no instante em que a partida comeca de verdade.
  NOTE_LEAD_IN_MS: 1800,

  // Quanto tempo (ms) uma seta leva descendo do topo da lane ate o final
  // do percurso (note.time). Unica fonte de verdade deste numero: e usado
  // tanto pela camada visual (NoteRenderer, para saber onde desenhar a
  // seta a cada instante) quanto pela camada de julgamento (para saber
  // durante quanto tempo a seta pode ser pressionada). Os dois PRECISAM
  // usar o mesmo valor, senao a seta pareceria "acertavel" num trecho do
  // percurso e nao no outro. A velocidade em si (duracao da queda) e a
  // mesma que ja existia antes desta etapa -- so passou a ser
  // compartilhada em vez de ficar hardcoded so no NoteRenderer.
  NOTE_TRAVEL_MS: 1800,

  // ETAPA 13B — nova mecanica de setas: o jogador pode pressionar a tecla
  // a qualquer momento enquanto a seta estiver descendo (nao precisa mais
  // esperar ela chegar numa "area de acerto" estreita). Por isso a janela
  // em que uma nota fica "active" (podendo ser julgada) agora cobre TODO
  // o percurso: comeca no instante em que a seta nasce no topo
  // (note.time - NOTE_TRAVEL_MS) e vai ate ela chegar ao final do
  // percurso (note.time). Se ninguem acertar ate la, ela vira "missed"
  // exatamente nesse instante (ver NoteEngine.updateTimelineStates).
  NOTE_HIT_WINDOW_MS: 1800, // = NOTE_TRAVEL_MS (mesmo valor acima)

  // ---- Configuracao de julgamento e pontuacao (Etapa 4B) ----
  // Janelas de tempo (ms, distancia absoluta ate o tempo exato da nota)
  // usadas para classificar uma tentativa de acerto.
  //
  // ETAPA 13B: GOOD_MS precisa cobrir o MESMO intervalo em que a nota
  // fica "active" (NOTE_TRAVEL_MS / NOTE_HIT_WINDOW_MS acima), senao um
  // acerto valido em qualquer ponto da queda seria rejeitado como erro
  // pelo Judgement.findJudgeableNote.
  //
  // ETAPA 13C: adicionada uma faixa intermediaria (GREAT_MS) entre
  // PERFECT e GOOD, exatamente como pedido no enunciado ("pode existir
  // uma faixa intermediaria adicional"). PERFECT_MS continua igual
  // (60ms) e GOOD_MS continua cobrindo o percurso inteiro da seta --
  // nenhuma das duas mudou. GREAT_MS e o novo limite (ms de distancia
  // absoluta ate o tempo exato da nota) que separa GREAT de GOOD.
  JUDGEMENT_WINDOWS: {
    PERFECT_MS: 60,
    GREAT_MS: 200, // ETAPA 13C — faixa intermediaria entre PERFECT e GOOD
    GOOD_MS: 1800, // = NOTE_TRAVEL_MS (mesmo valor acima)
  },

  // Pontuacao concedida por julgamento. MISS nunca pontua (o PENALTIES.MISS
  // abaixo e quem desconta pontos por uma seta perdida -- ver ETAPA 13C).
  SCORE_VALUES: {
    PERFECT: 300,
    GREAT: 200, // ETAPA 13C — pontuacao da faixa intermediaria
    GOOD: 100,
    MISS: 0,
  },

  // ---- ETAPA 13C — Multiplicador de pontuacao por combo ----
  // Quanto maior o combo atual (apos o acerto), maior o multiplicador
  // aplicado a pontuacao base (SCORE_VALUES acima) daquele acerto.
  // Erro de direcao ou MISS zeram o combo (ver PlayerState), entao o
  // multiplicador volta sozinho ao valor inicial (1x) no proximo acerto.
  //
  // TIERS deve estar ordenado por minCombo crescente. Para um combo N,
  // vale o multiplicador do ULTIMO tier cuja minCombo <= N. Nenhum
  // numero magico: tudo centralizado aqui, facil de ajustar depois.
  COMBO_MULTIPLIER: {
    TIERS: [
      { minCombo: 0, multiplier: 1 },
      { minCombo: 5, multiplier: 1.5 },
      { minCombo: 10, multiplier: 2 },
      { minCombo: 20, multiplier: 3 },
    ],
  },

  // ---- ETAPA 13C — Penalizacao de pontuacao ----
  // Pontos DESCONTADOS (valores negativos) quando o jogador erra a
  // direcao (MISTAKE) ou deixa uma seta chegar ao final do percurso sem
  // acertar (MISS). O score do jogador pode ficar negativo durante a
  // partida se ele errar muitas vezes -- nada no codigo o impede disso
  // (PlayerState.score e um numero comum, sem clamping em zero).
  PENALTIES: {
    MISTAKE: -50,
    MISS: -30,
  },

  // ---- ETAPA 13E — Dificuldade progressiva ----
  // Conforme a partida avança (mais notas ja "processadas" -- ja
  // nasceram na timeline, independente de hit/miss/erro), o INTERVALO
  // entre notas consecutivas diminui progressivamente: as setas passam
  // a aparecer mais frequentemente, exigindo reacoes mais rapidas.
  //
  // O que NAO muda (de proposito, para nao tocar em nada fora do
  // escopo desta etapa):
  //   - NOTE_TRAVEL_MS / NOTE_HIT_WINDOW_MS / JUDGEMENT_WINDOWS acima:
  //     o percurso de CADA seta (do topo ate o final da pista) continua
  //     tendo exatamente a mesma duracao e a mesma janela de julgamento
  //     de sempre -- nenhuma janela nova e criada. So o ESPACAMENTO
  //     entre uma seta e a proxima diminui.
  //   - SCORE_VALUES / COMBO_MULTIPLIER / PENALTIES acima: pontuacao,
  //     combo e multiplicadores continuam identicos.
  //
  // Baseado no PROGRESSO da sequencia (indice da nota dentro da
  // timeline, o mesmo `index` que NoteEngine.generateNoteTimeline ja
  // usa), nunca em um timer/setInterval independente -- por isso a
  // mesma seed + o mesmo padrao de musica sempre produzem a MESMA
  // timeline, nos dois jogadores, sem nenhuma nova fonte de
  // divergencia entre eles (a sincronizacao existente continua sendo
  // 100% baseada em seed + startTimestamp, como antes desta etapa).
  //
  // STAGES deve estar ordenado por notesPlayed crescente (mesmo padrao
  // ja usado em COMBO_MULTIPLIER.TIERS acima). Para a N-esima nota da
  // timeline (indice 0-based), vale o multiplicador do ULTIMO estagio
  // cujo notesPlayed <= N -- o intervalo ANTES dessa nota (distancia
  // ate a nota anterior) e dividido por esse multiplicador (quanto
  // maior o multiplicador, menor o intervalo, mais rapido as setas se
  // sucedem). A primeira nota (indice 0) nunca tem um intervalo "antes
  // dela" (e a primeira), entao o estagio de indice 0 so afeta a partir
  // da segunda nota em diante.
  //
  // Progressao pensada para os padroes hoje cadastrados no catalogo de
  // musicas (16 e 24 notas, ver sequenceCatalog.js): um novo patamar a
  // cada 4 notas, sempre um aumento pequeno (8 pontos percentuais por
  // patamar) para nunca dar um salto abrupto de dificuldade, ate um
  // teto de 30% mais rapido que o inicio.
  DIFFICULTY_PROGRESSION: {
    STAGES: [
      { notesPlayed: 0, speedMultiplier: 1.0 },
      { notesPlayed: 4, speedMultiplier: 1.08 },
      { notesPlayed: 8, speedMultiplier: 1.16 },
      { notesPlayed: 12, speedMultiplier: 1.24 },
      { notesPlayed: 16, speedMultiplier: 1.3 },
    ],
    // Redundante com o ultimo estagio acima, mas mantido explicito:
    // nenhum multiplicador jamais deve superar este teto, mesmo que
    // estagios futuros sejam adicionados sem atualizar este numero.
    MAX_SPEED_MULTIPLIER: 1.3,
  },

  // ---- ETAPA 14D (PARTE 1) — Preparacao da dificuldade do Bot ----
  // A Parte 1 deixou os tres presets abaixo IDENTICOS entre si e
  // identicos a BotController.DEFAULT_CONFIG (client/js/match/botController.js)
  // de proposito -- so a arquitetura existia ainda. A PARTE 2A (abaixo)
  // e quem finalmente da valores diferentes a cada um.
  //
  // Este bloco afeta SOMENTE o Bot: nao e lido por PlayerState,
  // NoteEngine, GameplayEngine, Judgement, MatchTimelineManager nem
  // por nenhum fluxo de Solo/Modo Teste/Multiplayer. Nenhum desses
  // sistemas sabe que "dificuldade do Bot" existe.
  //
  // BOT_DIFFICULTY -- identificadores estaveis (nunca o texto exibido
  // na UI, que ainda nem existe -- a Parte 2A tambem nao cria nenhum
  // botao/tela de selecao). Usar sempre estas constantes em vez de
  // strings soltas ("EASY" etc.) espalhadas pelo codigo.
  BOT_DIFFICULTY: {
    EASY: 'EASY',
    MEDIUM: 'MEDIUM',
    HARD: 'HARD',
  },

  // ---- ETAPA 14D (PARTE 2A) — Logica das dificuldades do Bot ----
  // BOT_DIFFICULTY_PRESETS -- uma config completa por dificuldade, no
  // MESMO formato aceito por BotController.createConfig/
  // BotMatchController.createBotMatch (reactionTimeMs, judgementOffsetMs,
  // mistakeChance, seed -- ver botController.js). Cada chave aqui e
  // um objeto NOVO e independente (nunca a mesma referencia entre
  // dificuldades, nem a mesma referencia de BotController.DEFAULT_CONFIG),
  // entao editar um preset nunca afeta os outros por engano.
  //
  // NENHUM sistema novo foi criado para chegar nestes numeros -- eles
  // so aproveitam os tres parametros que BotController.decideForNote ja
  // usava desde a Etapa 14B:
  //
  //   - reactionTimeMs + judgementOffsetMs -- juntos formam o `deltaMs`
  //     que BotController.computeActionTime/decideForNote repassa para
  //     Judgement.classify (a MESMA fonte de PERFECT/GREAT/GOOD/MISS do
  //     jogador humano -- ver JUDGEMENT_WINDOWS acima: perfectMs 60,
  //     greatMs 200, goodMs 1800). Quanto MAIOR esse total, mais tarde
  //     o Bot "reage" em relacao ao tempo exato da nota, e pior a janela
  //     de julgamento que Judgement.classify devolve:
  //       HARD   -> 60 + 0  = 60ms  de delta  => cai em PERFECT_MS (60)
  //       MEDIUM -> 130 + 10 = 140ms de delta => cai em GREAT_MS (200)
  //       EASY   -> 220 + 40 = 260ms de delta => cai em GOOD_MS (1800)
  //     Ou seja, a "reacao mais lenta e menos consistente" do EASY (e a
  //     "reacao mais rapida e mais consistente" do HARD) sao um efeito
  //     DIRETO do mesmo calculo que ja existia -- nenhuma logica de
  //     julgamento foi copiada ou reimplementada aqui.
  //   - mistakeChance -- consumido do mesmo jeito de sempre por
  //     BotController.rollMistake (determinístico via
  //     SequenceGenerator.createSeededRandom(seed + note.index), nunca
  //     Math.random()). EASY > MEDIUM > HARD, para que o Bot facil erre
  //     a nota de proposito (MISTAKE) com bem mais frequencia que o
  //     dificil.
  //   - seed -- mantido igual ao DEFAULT_CONFIG (1) nas tres
  //     dificuldades: a diferenca de comportamento vem so dos
  //     parametros acima, nunca de uma sequencia de erros diferente.
  //     Mesma dificuldade + mesma seed (+ mesma timeline) continua
  //     100% reproduzivel, exatamente como antes.
  BOT_DIFFICULTY_PRESETS: {
    EASY: { reactionTimeMs: 220, judgementOffsetMs: 40, mistakeChance: 0.35, seed: 1 },
    MEDIUM: { reactionTimeMs: 130, judgementOffsetMs: 10, mistakeChance: 0.12, seed: 1 },
    HARD: { reactionTimeMs: 60, judgementOffsetMs: 0, mistakeChance: 0.03, seed: 1 },
  },

  // ---- ETAPA 15A — Preparacao do sistema de duracao das partidas ----
  // Apenas arquitetura/identificadores nesta parte: nenhuma partida
  // termina mais cedo por causa disto ainda. A resolucao do identificador
  // para milissegundos fica em client/js/match/matchDuration.js
  // (MatchDuration.resolveMatchDuration), no mesmo espirito de
  // BotController.createConfigForDifficulty acima -- nenhum modulo deve
  // ler MATCH_DURATION_MS diretamente nem hardcode estes numeros em
  // outro lugar.
  //
  // MATCH_DURATION_IDS -- identificadores estaveis (nunca o texto
  // exibido na UI, que ainda nem existe -- esta parte nao cria nenhum
  // botao/tela de selecao de duracao), no mesmo padrao ja usado por
  // BOT_DIFFICULTY acima.
  MATCH_DURATION_IDS: {
    THIRTY_SECONDS: '30S',
    ONE_MINUTE: '1M',
    FIVE_MINUTES: '5M',
    TEN_MINUTES: '10M',
  },

  // MATCH_DURATION_MS -- duracao (ms) correspondente a cada identificador
  // acima, no mesmo padrao ja usado por BOT_DIFFICULTY_PRESETS.
  MATCH_DURATION_MS: {
    '30S': 30 * 1000,
    '1M': 60 * 1000,
    '5M': 5 * 60 * 1000,
    '10M': 10 * 60 * 1000,
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ClientConfig;
}
