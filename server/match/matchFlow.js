const MatchManager = require('./MatchManager');
const { Match, MATCH_STATE, MATCH_MODE } = require('./Match');
const { generateMatchSequence } = require('./matchSequenceResolver');
const { generateSeed } = require('../utils/idGenerator');
const finalMatchState = require('./finalMatchState');
const matchOutcome = require('./matchOutcome');
const matchAbandonment = require('./matchAbandonment');
const {
  MATCH_COUNTDOWN_SECONDS,
  TEST_SPEED,
  DEFAULT_MUSIC_ID,
} = require('../config');
const { broadcastToRoom } = require('../ws/broadcast');

// ETAPA 12A: idempotencia do `match_result` do modo Solo (equivalente
// ao que `matchOutcome.hasFinalOutcome` ja garante para multiplayer).
// Guardado por INSTANCIA da Match (mesmo padrao de
// finalMatchState.js/matchOutcome.js) -- uma Match nova (toda revanche
// Solo cria uma `new Match(...)`, ver startMatchFlow) nunca tem entrada
// aqui.
const soloResultsSent = new WeakSet();

/**
 * Normaliza o musicId solicitado para a criacao de uma Match.
 *
 * Regra (Etapa 10C): `undefined`/`null`/string vazia (ou so espacos)
 * significam "nenhuma musica foi especificada" -> `startMatchFlow` deve
 * cair no `DEFAULT_MUSIC_ID` do config. Qualquer OUTRO valor e tratado
 * como uma escolha explicita e precisa existir no `musicCatalog` --
 * nunca cai silenciosamente para o padrao (ver `generateMatchSequence`,
 * que lanca um Error descritivo se o musicId nao existir).
 *
 * @param {string|undefined|null} requestedMusicId
 * @returns {string|null} o musicId normalizado, ou `null` se nao foi
 *   especificado (sinal para usar DEFAULT_MUSIC_ID).
 */
function normalizeRequestedMusicId(requestedMusicId) {
  if (typeof requestedMusicId !== 'string') return null;
  const trimmed = requestedMusicId.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Chamado quando uma sala atinge 2 jogadores conectados (ou por
 * rematchFlow.startRematch, ao iniciar uma revanche). Cria (ou recria)
 * a partida daquela sala, define a seed/musica e inicia o fluxo:
 * READY -> COUNTDOWN -> PLAYING.
 *
 * @param {import('../rooms/Room').Room} room
 * @param {string} [requestedMusicId] - Etapa 10C: musicId explicito
 *   para esta Match (ex: rematchFlow reaproveitando a musica da partida
 *   anterior). Se omitido/vazio, usa `DEFAULT_MUSIC_ID` -- ainda nao ha
 *   selecao de musica pelo jogador, entao nenhum chamador de producao
 *   fora do rematch passa isto hoje. Um musicId explicito que nao
 *   exista no musicCatalog e REJEITADO (Error), nunca cai
 *   silenciosamente para outra musica.
 * @param {string} [mode] - ETAPA 12A: "multiplayer" (default, se
 *   omitido) ou "solo". Nao muda NADA do pipeline abaixo (seed, musica,
 *   sequencia, timeline, READY -> COUNTDOWN -> PLAYING) -- so marca
 *   `match.mode`, para que outras camadas (ex: finishMatch, mais
 *   abaixo) saibam nao tratar esta partida como um confronto P1 vs P2.
 */
function startMatchFlow(room, requestedMusicId, mode) {
  const match = new Match(room.code, mode);

  // A seed e definida UMA UNICA VEZ pelo servidor e e a mesma para os dois
  // jogadores -- isso nao muda nesta etapa (Etapa 10A): a musica so diz
  // QUAL sequencia usar (via sequenceId), nunca substitui a seed como
  // mecanismo de sincronizacao.
  match.seed = generateSeed();

  // Etapa 10A: a musica da partida vem do catalogo central
  // (server/music/musicCatalog.js). `match.music` e uma COPIA da
  // entrada do catalogo: nada aqui referencia o registro interno dele,
  // e uma Match nova nunca herda a musica de uma Match anterior (o
  // campo comeca `null` no construtor e so e preenchido aqui, de novo,
  // a cada chamada desta funcao).
  //
  // Etapa 10B: a resolucao musica -> sequenceId -> padrao -> sequencia
  // de referencia (antes inline aqui) foi extraida para
  // matchSequenceResolver.js, sem nenhuma mudanca de comportamento.
  //
  // Etapa 10C: a musica desta Match agora e definida NO MOMENTO DA
  // CRIACAO (aqui, antes de qualquer broadcast/estado READY), a partir
  // do `requestedMusicId` recebido -- nunca escolhida/alterada depois
  // pelo cliente. Ainda nao ha selecao de musica pelo jogador: hoje o
  // unico chamador que passa um musicId explicito e rematchFlow
  // (reaproveitando a musica da partida anterior); toda criacao normal
  // de sala continua caindo em DEFAULT_MUSIC_ID, exatamente como antes.
  const musicId = normalizeRequestedMusicId(requestedMusicId) || DEFAULT_MUSIC_ID;

  // O servidor continua gerando a sua propria copia da sequencia (a
  // partir da mesma seed) apenas para servir de referencia na hora de
  // validar o checksum enviado pelos clientes. Essa sequencia NUNCA e
  // enviada ao cliente (ver Match.toPublicJSON) -- cada cliente precisa
  // gera-la localmente para comprovar que o algoritmo deterministico
  // bate.
  const { music, noteSequence, referenceChecksum } = generateMatchSequence(match.seed, musicId);
  match.musicId = music.id;
  match.music = music;
  match.song = music.id;
  match.difficulty = music.difficulty;
  match.speed = TEST_SPEED; // velocidade configuravel fica para uma proxima etapa
  match.noteSequence = noteSequence;
  match._referenceChecksum = referenceChecksum;

  MatchManager.setMatch(room.code, match);

  match.setState(MATCH_STATE.READY);
  broadcastToRoom(room, {
    type: 'match_ready',
    match: match.toPublicJSON(),
  });

  scheduleCountdown(room, match);
}

/**
 * Define o timestamp unico de inicio (servidor) e avisa os dois clientes
 * ao mesmo tempo. Os clientes devem calcular a contagem regressiva
 * localmente a partir desse timestamp, e nao a partir do momento
 * em que a mensagem chegou.
 */
function scheduleCountdown(room, match) {
  const countdownMs = MATCH_COUNTDOWN_SECONDS * 1000;
  const serverTime = Date.now();
  const startTimestamp = serverTime + countdownMs;

  match.setState(MATCH_STATE.COUNTDOWN);
  match.startTimestamp = startTimestamp;

  broadcastToRoom(room, {
    type: 'match_countdown_start',
    serverTime,
    startTimestamp,
    countdownSeconds: MATCH_COUNTDOWN_SECONDS,
    match: match.toPublicJSON(),
  });

  match._countdownTimer = setTimeout(() => {
    // A partida pode ter sido cancelada durante a contagem (ex: jogador saiu).
    if (MatchManager.getMatch(room.code) !== match) return;

    match.setState(MATCH_STATE.PLAYING);
    broadcastToRoom(room, {
      type: 'match_started',
      startTimestamp: match.startTimestamp,
      match: match.toPublicJSON(),
    });
  }, countdownMs);
}

/**
 * Cancela a partida da sala (usado quando um jogador sai antes do inicio).
 * Avisa quem ainda estiver na sala que deve voltar para o estado de espera.
 */
function cancelMatch(room, reason) {
  const match = MatchManager.getMatch(room.code);
  if (!match) return;

  MatchManager.removeMatch(room.code);

  broadcastToRoom(room, {
    type: 'match_cancelled',
    reason,
    matchState: MATCH_STATE.WAITING_FOR_PLAYER,
  });
}

/**
 * Recebe o que um jogador reportou ter gerado localmente (seed + checksum,
 * opcionalmente a sequencia completa para fins de log). Quando os dois
 * jogadores ja tiverem reportado, compara os valores entre si e com a
 * sequencia de referencia calculada pelo proprio servidor.
 */
function handleSequenceCheck(room, slot, payload) {
  const match = MatchManager.getMatch(room.code);
  if (!match) return;

  match.recordSequenceCheck(slot, payload);
  console.log(
    `[match ${room.code}] ${slot} reportou seed=${payload.seed} checksum=${payload.checksum}`
  );

  if (!match.hasBothSequenceChecks()) {
    // Ainda aguardando o outro jogador reportar a sequencia gerada.
    return;
  }

  const player1Report = match._sequenceChecks.player1;
  const player2Report = match._sequenceChecks.player2;

  // ETAPA 12A: no modo Solo nao existe player2 -- hasBothSequenceChecks
  // ja garante que so chegamos aqui com player1Report preenchido, entao
  // a comparacao e so contra a sequencia de referencia do servidor.
  const identical =
    match.mode === MATCH_MODE.SOLO
      ? player1Report.checksum === match._referenceChecksum
      : player1Report.checksum === player2Report.checksum &&
        player1Report.checksum === match._referenceChecksum;

  console.log(`\n=== VERIFICACAO DE SEQUENCIA (sala ${room.code}) ===`);
  console.log('Player1:', { seed: player1Report.seed, checksum: player1Report.checksum });
  if (player2Report) {
    console.log('Player2:', { seed: player2Report.seed, checksum: player2Report.checksum });
  }
  console.log('Referencia do servidor:', match._referenceChecksum);
  console.log(identical ? 'Resultado: SEQUENCIAS IDENTICAS ✓' : 'Resultado: SEQUENCIAS DIFERENTES ✗');
  console.log('==========================================\n');

  broadcastToRoom(room, {
    type: 'sequence_check_result',
    identical,
    player1Checksum: player1Report.checksum,
    player2Checksum: player2Report ? player2Report.checksum : null,
    serverChecksum: match._referenceChecksum,
  });
}

/**
 * Ponto de integracao com o fluxo existente de finalizacao da partida
 * (Etapa 6B, ajustada minimamente na 6C). NAO detecta sozinho quando a
 * partida termina -- isso continua sendo decidido por outra camada (ex:
 * uma proxima etapa que escute o fim real da partida no servidor); esta
 * funcao so formaliza o que fazer quando ela terminar, reutilizando o
 * fluxo de match ja existente em vez de criar um sistema paralelo:
 *
 * 1. marca a partida como FINISHED (unico lugar deste modulo que faz
 *    essa transicao; nao mexe em countdown, seed ou timeline);
 * 2. delega a captura do resultado final para finalMatchState
 *    (Etapa 6B), que ja garante a captura unica e a copia imutavel.
 *    Enquanto a partida ainda estiver PLAYING (nao deveria acontecer,
 *    ja que o passo 1 sempre tenta sair de PLAYING primeiro, mas
 *    finalMatchState se protege de qualquer forma), nenhum snapshot e
 *    produzido e a funcao para aqui -- nada e comparado ainda;
 * 3. delega a comparacao (Etapa 6C) para matchOutcome, usando
 *    EXCLUSIVAMENTE o snapshot que acabou de vir de finalMatchState --
 *    nunca uma copia nova nem PlayerState do cliente;
 * 4. na PRIMEIRA vez que um outcome e efetivamente produzido para esta
 *    Match, envia `match_result` (somente result/winner/loser, sem
 *    nenhum estado interno do servidor) para os dois jogadores da sala.
 *
 * COMPATIBILIDADE: o valor de retorno continua sendo o snapshot final
 * dos dois jogadores (mesmo contrato da Etapa 6B) -- quem ja consumia
 * finishMatch() antes continua funcionando sem nenhuma mudanca. O
 * outcome calculado nesta etapa fica disponivel separadamente via
 * matchOutcome.getFinalOutcome(match) (ou matchOutcome.hasFinalOutcome),
 * para quem precisar dele.
 *
 * Idempotente: seguro chamar mais de uma vez para a mesma partida. Nem
 * o estado, nem o snapshot, nem o outcome sao recalculados/substituidos
 * depois da primeira vez -- e `match_result` e enviado NO MAXIMO uma vez
 * por partida (a checagem de "ja tinha outcome antes desta chamada" e o
 * que impede o reenvio).
 *
 * ABANDONO (Etapa 8C): se esta Match ja foi marcada como abandonada por
 * server/match/matchAbandonment.js, finishMatch NUNCA a trata como uma
 * finalizacao normal -- devolve `null` sem chamar finalMatchState nem
 * matchOutcome, e sem enviar `match_result`. Isso e necessario porque o
 * abandono ja tira a Match de PLAYING (ver matchAbandonment.handleAbandonment)
 * SEM passar por aqui; sem esta checagem, uma chamada posterior a
 * finishMatch() (ex: um gatilho de fim de partida "normal" disparando
 * por engano/corrida logo depois de um abandono) capturaria um snapshot
 * e um outcome "normais" para uma partida que na verdade terminou por
 * abandono, e enviaria um `match_result` (ex: "draw" 0x0) que nao
 * deveria existir -- exatamente o que este modulo documenta que NAO faz
 * por abandono (ver o cabecalho de matchAbandonment.js).
 *
 * @param {import('../rooms/Room').Room} room
 * @returns {{player1: object|null, player2: object|null}|null} o
 *   snapshot final dos dois jogadores (mesmo retorno da Etapa 6B), ou
 *   `null` se a match for invalida, ja tiver sido abandonada, ou ainda
 *   estiver em PLAYING.
 */
function finishMatch(room) {
  const match = MatchManager.getMatch(room.code);
  if (!match) return null;

  if (matchAbandonment.hasAbandonment(match)) {
    return null;
  }

  if (match.state === MATCH_STATE.PLAYING) {
    match.setState(MATCH_STATE.FINISHED);
  }

  const snapshot = finalMatchState.captureFinalMatchState(match);
  if (!snapshot) return null;

  // ETAPA 12A: Solo nunca passa por matchOutcome -- nao existe player2
  // real para comparar, entao NAO chamamos
  // matchOutcome.determineOutcome/captureFinalOutcome (isso compararia
  // contra um player2 vazio/fictício e produziria um "vencedor" que nao
  // deveria existir). O snapshot (score/hits/misses/combo, ja capturado
  // acima por finalMatchState, reutilizando finalMatchState/
  // matchResultState exatamente como o multiplayer) e preservado
  // normalmente -- so o `match_result` enviado ao cliente tem um
  // formato diferente (sem result/winner/loser), e so a estatistica de
  // player1.
  if (match.mode === MATCH_MODE.SOLO) {
    if (!soloResultsSent.has(match)) {
      soloResultsSent.add(match);
      broadcastToRoom(room, {
        type: 'match_result',
        mode: MATCH_MODE.SOLO,
        player1: snapshot.player1,
      });
    }
    return snapshot;
  }

  const hadOutcomeBefore = matchOutcome.hasFinalOutcome(match);
  const outcome = matchOutcome.captureFinalOutcome(match, snapshot);

  if (outcome && !hadOutcomeBefore) {
    // Primeira vez que esta partida produz um outcome: avisa os dois
    // jogadores. Payload minimo -- nenhum estado interno do servidor,
    // nenhum PlayerState completo, nada sobre o oponente alem do
    // resultado em si.
    broadcastToRoom(room, {
      type: 'match_result',
      result: outcome.result,
      winner: outcome.winner,
      loser: outcome.loser,
    });
  }

  return snapshot;
}

module.exports = {
  startMatchFlow,
  cancelMatch,
  handleSequenceCheck,
  finishMatch,
  // Exportado para testes (Etapa 10C): permite validar a regra de
  // normalizacao isoladamente, sem precisar montar uma sala/partida
  // completa so para checar "vazio -> default".
  normalizeRequestedMusicId,
};
