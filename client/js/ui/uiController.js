/**
 * Camada de UI do cliente.
 * Responsavel apenas por ler/escrever no DOM. Nao sabe nada sobre
 * WebSocket; recebe dados prontos e atualiza a tela.
 */
const UIController = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;

  const el = {
    statusText: document.getElementById('status-text'),
    lobby: document.getElementById('lobby'),
    roomInfo: document.getElementById('room-info'),
    testPanel: document.getElementById('test-panel'),
    roomCodeDisplay: document.getElementById('room-code-display'),
    playerSlotDisplay: document.getElementById('player-slot-display'),
    roomStateDisplay: document.getElementById('room-state-display'),
    opponentStatusDisplay: document.getElementById('opponent-status-display'),
    messageLog: document.getElementById('message-log'),
    inputRoomCode: document.getElementById('input-room-code'),
    matchPanel: document.getElementById('match-panel'),
    matchStateDisplay: document.getElementById('match-state-display'),
    matchSeedDisplay: document.getElementById('match-seed-display'),
    countdownDisplay: document.getElementById('countdown-display'),
    gameField: document.getElementById('game-field'),
    musicSelectionPanel: document.getElementById('music-selection-panel'),
    musicList: document.getElementById('music-list'),
    musicSelectionStatus: document.getElementById('music-selection-status'),
  };

  function setConnectionStatus(status) {
    el.statusText.textContent = status;
  }

  function showRoomJoined({ roomCode, slot, roomState }) {
    el.lobby.classList.add('hidden');
    el.roomInfo.classList.remove('hidden');
    el.testPanel.classList.remove('hidden');
    // Etapa 10D: a selecao de musica fica visivel assim que o jogador
    // esta em uma sala -- o servidor ja aceita `select_music` mesmo
    // antes do oponente entrar (ver messageRouter.js).
    showMusicSelection();

    el.roomCodeDisplay.textContent = roomCode;
    el.playerSlotDisplay.textContent = slot;
    updateRoomState(roomState);
  }

  function updateRoomState(room) {
    if (!room) return;
    el.roomStateDisplay.textContent = room.state;

    const mySlot = el.playerSlotDisplay.textContent;
    const opponentSlot = mySlot === 'player1' ? 'player2' : 'player1';
    const opponent = room.players[opponentSlot];

    el.opponentStatusDisplay.textContent = opponent ? 'conectado' : 'aguardando...';
  }

  function logMessage(text) {
    const item = document.createElement('li');
    item.textContent = text;
    el.messageLog.appendChild(item);
    el.messageLog.scrollTop = el.messageLog.scrollHeight;
  }

  function getRoomCodeInput() {
    return el.inputRoomCode.value.trim().toUpperCase();
  }

  function showError(message) {
    logMessage(`[erro] ${message}`);
  }

  function setMatchState(state) {
    el.matchPanel.classList.remove('hidden');
    el.matchStateDisplay.textContent = state;
    // Etapa 10D: a partir de READY (musica ja definida para esta
    // Match, ver matchFlow.startMatchFlow) a selecao nao tem mais
    // efeito nenhum -- o servidor ja rejeita `select_music` a partir
    // daqui mesmo (COUNTDOWN/PLAYING); esconder aqui so evita mostrar
    // uma lista que nao faz mais nada.
    hideMusicSelection();
    showGameField();
  }

  // Mostra apenas a ESTRUTURA do campo (Etapa 5A-1). Nao desenha notas,
  // nao anima nada -- so revela os placeholders dos dois jogadores.
  function showGameField() {
    el.gameField.classList.remove('hidden');
    document.documentElement.classList.add('match-active');
    document.body.classList.add('match-active');
  }

  function hideGameField() {
    el.gameField.classList.add('hidden');
    document.documentElement.classList.remove('match-active');
    document.body.classList.remove('match-active');
  }

  function setMatchSeed(seed) {
    el.matchSeedDisplay.textContent = seed;
  }

  function showCountdownTick(secondsRemaining) {
    el.countdownDisplay.classList.remove('hidden');
    el.countdownDisplay.textContent = secondsRemaining;
  }

  function showCountdownFinished() {
    el.countdownDisplay.textContent = 'INICIAR';
  }

  function hideCountdown() {
    el.countdownDisplay.classList.add('hidden');
  }

  function resetMatchToWaiting() {
    el.matchPanel.classList.remove('hidden');
    el.matchStateDisplay.textContent = 'WAITING_FOR_PLAYER';
    hideCountdown();
    hideGameField();
    // Etapa 10D: a partida da sala voltou a esperar (cancelada antes
    // de comecar, ou encerrada por abandono) -- a selecao volta a
    // fazer sentido para a proxima tentativa.
    showMusicSelection();
  }

  /**
   * Devolve a tela inteira ao estado inicial de lobby (Etapa 9B):
   * esconde sala/partida/campo de jogo/painel de teste e volta a
   * mostrar apenas "Criar sala" / "Entrar em sala". Usado quando o
   * PROPRIO jogador local sai voluntariamente da sala (`left_room`) --
   * diferente de `resetMatchToWaiting` (que mantem o jogador NA sala,
   * apenas devolvendo a PARTIDA ao estado de espera).
   */
  function resetToLobby() {
    el.lobby.classList.remove('hidden');
    el.roomInfo.classList.add('hidden');
    el.testPanel.classList.add('hidden');
    el.matchPanel.classList.add('hidden');
    hideCountdown();
    hideGameField();

    el.roomCodeDisplay.textContent = '-';
    el.playerSlotDisplay.textContent = '-';
    el.roomStateDisplay.textContent = '-';
    el.opponentStatusDisplay.textContent = 'aguardando...';
    el.matchStateDisplay.textContent = '-';
    el.matchSeedDisplay.textContent = '-';
  }

  /**
   * Etapa 10D — interface SIMPLES de selecao de musica: uma lista de
   * botoes, um por musica do catalogo (id/titulo/artista/bpm/duracao/
   * dificuldade -- os mesmos campos publicos que o servidor envia em
   * `music_catalog`, ver server/music/musicSelectionFlow.js). Sem
   * capas, player de audio, waveform ou animacoes -- so funcionalidade.
   *
   * Este metodo NAO decide se uma selecao e valida nem envia nada pela
   * rede: so monta a lista e delega cada clique para `onSelect`
   * (injetado por main.js, que por sua vez usa
   * MusicSelectionController.selectMusic).
   *
   * @param {Array<{id: string, title: string, artist: string, bpm: number, durationMs: number, difficulty: string}>} musics
   * @param {(musicId: string) => void} onSelect
   */
  function renderMusicOptions(musics, onSelect) {
    el.musicList.innerHTML = '';

    (musics || []).forEach((music) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.musicId = music.id;

      const durationSeconds = Math.round((music.durationMs || 0) / 1000);
      button.textContent = `${music.title} — ${music.artist} (${music.bpm} BPM, ${durationSeconds}s, ${music.difficulty})`;

      button.addEventListener('click', () => {
        if (typeof onSelect === 'function') onSelect(music.id);
      });

      item.appendChild(button);
      el.musicList.appendChild(item);
    });
  }

  /**
   * Atualiza qual botao aparece marcado como "selecionado" (classe
   * `.selected`) a partir do musicId confirmado pelo SERVIDOR para o
   * jogador local -- nunca a partir de um clique otimista (ver
   * musicSelectionController.handleConfirmation).
   *
   * @param {string|null} musicId
   */
  function setSelectedMusic(musicId) {
    const buttons = el.musicList.querySelectorAll('button');
    buttons.forEach((button) => {
      button.classList.toggle('selected', button.dataset.musicId === musicId);
    });
  }

  /**
   * Habilita/desabilita toda a lista de musicas (Etapa 10D: usado
   * enquanto uma selecao ja foi enviada e ainda nao foi confirmada
   * pelo servidor, para reforcar visualmente o que
   * MusicSelectionController.isPending ja impede na pratica -- nunca
   * a unica protecao contra envio duplicado).
   */
  function setMusicListDisabled(disabled) {
    const buttons = el.musicList.querySelectorAll('button');
    buttons.forEach((button) => {
      button.disabled = Boolean(disabled);
    });
  }

  function setMusicSelectionStatus(text) {
    el.musicSelectionStatus.textContent = text;
  }

  function showMusicSelection() {
    el.musicSelectionPanel.classList.remove('hidden');
  }

  function hideMusicSelection() {
    el.musicSelectionPanel.classList.add('hidden');
  }

  /**
   * O OUTRO jogador saiu voluntariamente da sala (`player_left_room`).
   * So atualiza o texto de status do oponente -- o payload desse evento
   * nao traz o objeto `room` inteiro (ver server/room/leaveRoomFlow.js),
   * entao nao ha nada de `room.state` para reexibir aqui. Qualquer
   * efeito sobre a PARTIDA (cancelamento/abandono/revanche) chega por
   * mensagens dedicadas e separadas (`match_cancelled`/`match_abandoned`/
   * `rematch_cancelled`), que ja tem seus proprios handlers -- este
   * metodo nunca decide nada sobre isso sozinho.
   */
  function showOpponentLeftRoom() {
    el.opponentStatusDisplay.textContent = 'saiu da sala';
  }

  const api = {
    setConnectionStatus,
    showRoomJoined,
    updateRoomState,
    logMessage,
    getRoomCodeInput,
    showError,
    setMatchState,
    setMatchSeed,
    showCountdownTick,
    showCountdownFinished,
    hideCountdown,
    resetMatchToWaiting,
    resetToLobby,
    showOpponentLeftRoom,
    showGameField,
    hideGameField,
  };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
