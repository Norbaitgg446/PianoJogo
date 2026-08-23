const MatchManager = require('./MatchManager');
const { MATCH_STATE } = require('./Match');
const playerMatchState = require('./playerMatchState');
const matchFlow = require('./matchFlow');
const { send, sendError } = require('../ws/broadcast');

/**
 * Fluxo de jogo (Etapa 4B, integrado ao estado oficial na Etapa 7B).
 *
 * O cliente processa julgamento, combo e pontuacao LOCALMENTE (ver
 * client/js/match/gameplayEngine.js) e so avisa o servidor quando algo
 * importante acontece: um acerto (note_hit) ou uma nota perdida por
 * tempo (note_miss). Nada e enviado a cada frame, e a sequencia de
 * notas nunca e retransmitida -- so o resultado pontual.
 *
 * O servidor, por enquanto:
 * - decide, aqui mesmo, quais devem ser os PROXIMOS valores de
 *   hits/combo/score (note_hit) ou misses/combo (note_miss) a partir do
 *   payload reportado -- essa regra de calculo e a mesma desde a Etapa
 *   4B, apenas isolada em funcoes puras (ver computeNoteHitUpdate /
 *   computeNoteMissUpdate mais abaixo) para nao ficar espalhada;
 * - delega a ESCRITA desses valores em match.players[slot] para
 *   server/match/playerMatchState.js (Etapa 7A), que e a UNICA camada
 *   que efetivamente muta o estado oficial da Match. Isso evita ter
 *   duas fontes de atualizacao (gameplayFlow escrevendo direto E
 *   playerMatchState escrevendo separadamente) -- gameplayFlow decide
 *   "quais valores", playerMatchState e quem "aplica e protege" (slot
 *   invalido, maxCombo nunca diminuir, etc.);
 * - repassa um evento leve para o oponente, para que o cliente dele
 *   possa (numa proxima etapa) mostrar o progresso do outro jogador;
 * - faz uma checagem BEM basica de plausibilidade do noteId.
 *
 * NAO valida ainda se o tempo/ordem reportados batem com
 * match.noteSequence / match.startTimestamp -- isso fica reservado
 * para um sistema anti-cheat completo em uma proxima etapa. O ponto de
 * entrada (isPlausibleNoteId) ja esta isolado aqui de proposito, para
 * ser reforcado depois sem mexer no resto do fluxo.
 */

// ETAPA 13C: 'GREAT' e a nova faixa intermediaria de julgamento
// (ClientConfig.JUDGEMENT_WINDOWS.GREAT_MS / SCORE_VALUES.GREAT no
// cliente) -- precisa ser aceita aqui tambem, senao todo note_hit com
// esse julgamento seria rejeitado como invalido.
const VALID_HIT_JUDGEMENTS = new Set(['PERFECT', 'GREAT', 'GOOD']);

/**
 * Checagem leve: o noteId reportado tem o formato esperado para a seed
 * desta partida (ver NoteEngine.buildNoteId no cliente)? Isso nao prova
 * que a nota/tempo reportados sao verdadeiros, apenas descarta o caso
 * mais obvio de payload malformado ou de outra partida.
 */
function isPlausibleNoteId(match, noteId) {
  return typeof noteId === 'string' && noteId.startsWith(`note-${match.seed}-`);
}

function getPlayingMatch(room) {
  const match = MatchManager.getMatch(room.code);
  if (!match || match.state !== MATCH_STATE.PLAYING) return null;
  return match;
}

/**
 * Calcula os PROXIMOS valores de hits/combo/score para um note_hit, a
 * partir do estado atual do jogador (snapshot seguro, somente leitura)
 * e do payload reportado pelo cliente. Funcao pura: nao muta nada,
 * apenas decide os valores -- a mesma regra usada desde a Etapa 4B,
 * so isolada aqui para nao duplicar quando for aplicada.
 *
 * @param {{hits:number, combo:number, score:number}} currentState
 * @param {{combo?: number, score?: number}} payload
 */
function computeNoteHitUpdate(currentState, payload) {
  const combo = Number.isFinite(payload.combo) ? payload.combo : currentState.combo + 1;
  const score = Number.isFinite(payload.score) ? payload.score : currentState.score;
  return {
    hits: currentState.hits + 1,
    combo,
    score,
  };
}

/**
 * type: 'note_hit', noteId, lane, judgement ('PERFECT'|'GOOD'), deltaMs, combo, score
 */
function applyNoteHit(ws, room, payload) {
  const match = getPlayingMatch(room);
  if (!match) return sendError(ws, 'Nao ha partida em andamento nesta sala.');

  const slot = ws.slot;
  const currentState = playerMatchState.getPlayerMatchState(match, slot);
  if (!currentState) return;

  if (!VALID_HIT_JUDGEMENTS.has(payload.judgement)) {
    return sendError(ws, 'Julgamento invalido em note_hit.');
  }

  if (!isPlausibleNoteId(match, payload.noteId)) {
    console.warn(`[match ${room.code}] noteId suspeito reportado por ${slot} em note_hit:`, payload.noteId);
  }

  // Nesta etapa o servidor confia no resultado local do cliente e
  // apenas o registra. A validacao completa (comparar contra o tempo
  // real da nota) e trabalho de uma proxima etapa.
  //
  // gameplayFlow decide OS VALORES (computeNoteHitUpdate); quem
  // efetivamente escreve em match.players[slot] e SEMPRE
  // playerMatchState.updatePlayerMatchState (Etapa 7A) -- unica camada
  // de escrita do estado oficial. maxCombo nunca diminuir tambem e
  // garantido la, nao aqui.
  const nextValues = computeNoteHitUpdate(currentState, payload);
  playerMatchState.updatePlayerMatchState(match, slot, nextValues);
  const updatedState = playerMatchState.getPlayerMatchState(match, slot);

  const opponent = room.getOpponentConnection(slot);
  send(opponent, {
    type: 'opponent_note_event',
    slot,
    event: 'note_hit',
    judgement: payload.judgement,
    combo: updatedState.combo,
    score: updatedState.score,
  });
}

/**
 * Calcula os PROXIMOS valores de misses/combo/score para um note_miss.
 * Mesma regra desde a Etapa 4B para misses/combo (miss soma 1, combo
 * zera).
 *
 * ETAPA 13C: uma seta perdida agora pode descontar pontos (ver
 * ClientConfig.PENALTIES.MISS no cliente) -- o servidor precisa
 * refletir isso no estado oficial, senao o resultado final (fonte de
 * verdade) ficaria com um score desatualizado em relacao ao que o
 * jogador realmente viu na tela. Segue exatamente o MESMO padrao ja
 * usado por computeNoteHitUpdate acima: confia no `score` reportado
 * pelo cliente quando presente e valido, e so cai para o score atual
 * (sem mudanca) quando o payload nao traz esse campo -- por isso
 * chamadores antigos (que nunca mandavam `score` em note_miss)
 * continuam com o score intocado, exatamente como antes desta etapa.
 *
 * @param {{misses:number, score:number}} currentState
 * @param {{score?: number}} payload
 */
function computeNoteMissUpdate(currentState, payload) {
  const score = Number.isFinite(payload.score) ? payload.score : currentState.score;
  return {
    misses: currentState.misses + 1,
    combo: 0,
    score,
  };
}

/**
 * type: 'note_miss', noteId, lane, combo, misses
 */
function applyNoteMiss(ws, room, payload) {
  const match = getPlayingMatch(room);
  if (!match) return sendError(ws, 'Nao ha partida em andamento nesta sala.');

  const slot = ws.slot;
  const currentState = playerMatchState.getPlayerMatchState(match, slot);
  if (!currentState) return;

  if (!isPlausibleNoteId(match, payload.noteId)) {
    console.warn(`[match ${room.code}] noteId suspeito reportado por ${slot} em note_miss:`, payload.noteId);
  }

  // Mesma regra de sempre (miss += 1, combo = 0) + score (ETAPA 13C,
  // ver computeNoteMissUpdate acima), aplicada atraves da unica camada
  // de escrita do estado oficial (playerMatchState).
  const nextValues = computeNoteMissUpdate(currentState, payload);
  playerMatchState.updatePlayerMatchState(match, slot, nextValues);
  const updatedState = playerMatchState.getPlayerMatchState(match, slot);

  const opponent = room.getOpponentConnection(slot);
  send(opponent, {
    type: 'opponent_note_event',
    slot,
    event: 'note_miss',
    combo: updatedState.combo,
    misses: updatedState.misses,
  });
}

/**
 * type: 'sequence_complete' (Etapa 12)
 *
 * BUG encontrado na analise desta etapa: nada em codigo de producao
 * chamava matchFlow.finishMatch() -- so os testes chamavam essa funcao
 * diretamente. Na pratica (fluxo real via WebSocket), quando a timeline
 * local de um jogador terminava (MatchEndDetector do cliente, ver
 * client/js/main.js), o cliente mostrava um resultado local e nunca
 * avisava o servidor -- a Match da sala ficava PRESA em PLAYING para
 * sempre. Isso quebrava o fim-a-fim da partida: o servidor nunca
 * capturava o snapshot final nem enviava `match_result`, e a revanche
 * ficava permanentemente bloqueada (rematchFlow.requestRematch rejeita
 * pedidos enquanto match.state estiver em PLAYING/COUNTDOWN/READY).
 *
 * CORRECAO MINIMA (reutilizando tudo que ja existe, nenhum sistema
 * paralelo): um jogador cujo timeline local terminou agora avisa o
 * servidor com esta mensagem. O servidor NAO confia em nenhum dado do
 * payload (nao ha payload) -- so usa o aviso como GATILHO para chamar o
 * mesmo matchFlow.finishMatch(room) que os testes ja validam havera
 * muito tempo. finishMatch continua sendo 100% responsavel por decidir
 * o snapshot/outcome/vencedor, exclusivamente a partir do estado oficial
 * do servidor (match.players, escrito somente por playerMatchState via
 * applyNoteHit/applyNoteMiss acima) -- nunca a partir de nada que o
 * cliente reporte aqui.
 *
 * Idempotente por construcao, reutilizando os mesmos mecanismos ja
 * existentes:
 * - getPlayingMatch(room) so retorna a Match se ela realmente estiver
 *   PLAYING -- uma segunda mensagem (do mesmo jogador, ou do oponente
 *   reportando o fim da MESMA timeline compartilhada) chega depois que
 *   a Match ja virou FINISHED, entao e ignorada aqui, sem chamar
 *   finishMatch de novo;
 * - mesmo que chegasse a chamar finishMatch mais de uma vez, a propria
 *   funcao (matchFlow.js) e finalMatchState/matchOutcome ja garantem
 *   nao recapturar snapshot nem reenviar `match_result` (Etapa 6B/6C,
 *   ja cobertas pelos testes existentes).
 */
function applySequenceComplete(ws, room) {
  const match = getPlayingMatch(room);
  if (!match) return; // partida ja finalizada/abandonada/nao iniciada: ignora

  matchFlow.finishMatch(room);
}

module.exports = { applyNoteHit, applyNoteMiss, applySequenceComplete, isPlausibleNoteId };
