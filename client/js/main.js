/**
 * Ponto de entrada do cliente.
 * Conecta a camada de rede (SocketClient) com a camada de UI (UIController).
 * Nesta etapa nao ha nenhuma logica de jogo: apenas sala + conexao + teste.
 */
(() => {
  let currentSlot = null;
  // ETAPA 12A: true assim que o jogador pediu para "Jogar Sozinho"
  // (otimista, no proprio clique -- ver btn-play-solo abaixo) ate sair
  // da sala/abandonar. So controla UI (UIController.setSoloMode) e qual
  // fluxo o botao "Jogar Novamente" usa (start_solo_match, nunca o
  // handshake multiplayer de rematchController) -- o servidor continua
  // sendo a UNICA autoridade sobre `match.mode`.
  let isSoloMode = false;

  // Engine de gameplay do jogador LOCAL (Etapa 5B-1). So existe uma
  // instancia aqui -- a deste navegador -- porque cada cliente so
  // controla o proprio jogador; o estado do oponente chega via
  // rede (opponent_note_event), nunca por uma segunda instancia
  // local do GameplayEngine. Isso e o que garante o isolamento:
  // fisicamente nao ha como o teclado/toque deste navegador tocar
  // no estado do oponente.
  let localGameplayEngine = null;
  // Estado do jogador LOCAL (Etapa 4B), guardado aqui tambem (alem de
  // dentro do closure de startMatchGameplay) para que handleLanePressed
  // e o loop de notas expiradas possam ler score/combo atuais e repassar
  // ao FeedbackRenderer (Etapa 5B-3B) -- sem duplicar/recalcular nada,
  // so lendo os campos que PlayerState.registerHit/Miss/Mistake ja
  // mantem atualizados.
  let localPlayerState = null;
  let touchBound = false;
  // Offset (ms) entre o relogio deste navegador e o relogio do servidor,
  // calculado com a MESMA formula que MatchController ja usa internamente
  // (serverTime - Date.now() no instante em que o servidor informou o
  // horario) -- ver case 'match_countdown_start' abaixo. MatchController
  // nao expõe o proprio offset, entao capturamos aqui, sem alterar aquele
  // modulo, para o NoteRenderer (Etapa 5B-2B) poder desenhar as notas no
  // mesmo relogio sincronizado usado pela contagem regressiva.
  let matchClockOffsetMs = 0;
  // Loop que verifica periodicamente notas expiradas (MISS), usando o
  // MESMO relogio sincronizado do julgamento de acerto e do NoteRenderer.
  // So chama GameplayEngine.processExpiredNotes (Etapa 4B, ja existente) --
  // nenhuma logica de MISS nova e criada aqui. processExpiredNotes so
  // dispara evento de rede para notas que REALMENTE viraram MISS nesta
  // chamada (ver gameplayEngine.js), entao rodar a cada frame nao gera
  // eventos repetidos.
  let expiredNotesLoopId = null;
  let expiredNotesLoopToken = 0;
  // Detector do fim da partida local (Etapa 5B-4A). Uma instancia NOVA
  // por partida (criada em startMatchGameplay, junto com o GameplayEngine
  // e o PlayerState desta mesma partida), ligada exatamente a MESMA
  // timeline usada para julgamento -- nunca uma copia. So decide QUANDO
  // a partida terminou (todas as notas hit/missed); quem decide O QUE
  // fazer com isso e o callback registrado abaixo (handleLocalMatchEnd).
  let localMatchEndDetector = null;

  // Etapa 10D: controlador da selecao de musica do lado do cliente.
  // So garante um `select_music` por pedido enquanto nao houver
  // confirmacao (ver musicSelectionController.js) -- o servidor
  // continua sendo a UNICA autoridade sobre qual musica sera usada.
  const musicSelectionController = MusicSelectionController.createMusicSelectionController({
    sendSelectMusic: (musicId) => SocketClient.send('select_music', { musicId }),
    onCatalogChange: (musics) => {
      UIController.renderMusicOptions(musics, (musicId) => {
        const sent = musicSelectionController.selectMusic(musicId);
        if (sent) {
          UIController.setMusicListDisabled(true);
          UIController.setMusicSelectionStatus('Selecao enviada, aguardando confirmacao do servidor...');
        }
      });
      UIController.setSelectedMusic(musicSelectionController.getConfirmedMusicId());
    },
    onSelectionConfirmed: (message) => {
      UIController.setMusicListDisabled(false);
      UIController.setSelectedMusic(musicSelectionController.getConfirmedMusicId());
      if (message.slot === currentSlot) {
        UIController.setMusicSelectionStatus(`Musica selecionada: ${message.musicId}.`);
        UIController.logMessage(`Voce selecionou a musica ${message.musicId}.`);
      } else {
        UIController.logMessage(`${message.slot} selecionou uma musica.`);
      }
    },
    onSelectionRejected: (message) => {
      UIController.setMusicListDisabled(false);
      UIController.logMessage(`[erro] ${message}`);
    },
  });

  // Etapa 5B-5A (Parte 2): controlador do handshake de revanche do
  // lado do cliente (clique -> "aguardando" -> confirmado/cancelado
  // pelo servidor). Todo o "o que fazer de verdade" (enviar a
  // mensagem, mudar a UI) e passado por injecao abaixo -- o modulo em
  // si nao sabe nada de WebSocket/DOM (ver rematchController.js).
  const rematchController = RematchController.createRematchController({
    sendRematchReady: () => SocketClient.send('rematch_ready'),
    onWaitingStateChange: (isWaiting) => {
      ResultRenderer.setPlayAgainWaiting(isWaiting);
      if (isWaiting) {
        UIController.logMessage('Aguardando o outro jogador...');
      }
    },
    onCancelled: (reason) => {
      ResultRenderer.showRematchCancelled(reason);
      UIController.logMessage(`Revanche cancelada: ${reason}`);
    },
  });

  // Etapa 8B: controlador do abandono do lado do cliente. So valida o
  // payload de `match_abandoned` e garante que o mesmo abandono nunca e
  // processado duas vezes -- o que fazer de verdade (parar loops,
  // desligar input, mostrar mensagem) e injetado abaixo via
  // `onAbandonment`, reaproveitando integralmente os modulos ja
  // existentes (mesmo padrao de `rematchController` acima).
  const matchAbandonmentController = MatchAbandonmentController.createAbandonmentController({
    onAbandonment: ({ isLocalPlayer }) => handleMatchAbandoned(isLocalPlayer),
  });

  // Etapa 9B: controlador da saida voluntaria de sala do lado do
  // cliente. So garante um `leave_room` por pedido (nunca dois cliques
  // gerando duas mensagens) e que nada e enviado se o jogador local ja
  // nao estiver em uma sala -- o que fazer de verdade quando a
  // confirmacao (`left_room`) chegar (parar loops, resetar telas etc.)
  // e injetado abaixo via `onLeaveConfirmed`, reaproveitando
  // integralmente os modulos ja existentes (mesmo padrao de
  // `rematchController`/`matchAbandonmentController` acima).
  const leaveRoomController = LeaveRoomController.createLeaveRoomController({
    sendLeaveRoom: () => SocketClient.send('leave_room'),
    canLeave: () => Boolean(currentSlot),
    onLeaveConfirmed: () => handleLeftRoom(),
  });

  /**
   * "Agora", no mesmo relogio de referencia do servidor usado pela
   * timeline/NoteRenderer (Etapa 5B-2B) -- nunca o horario bruto de
   * chegada de mensagem nem Date.now() puro. Mesma formula usada
   * internamente por MatchController e pelo NoteRenderer.
   */
  function getSyncedNow() {
    return Date.now() + matchClockOffsetMs;
  }

  function stopExpiredNotesLoop() {
    expiredNotesLoopToken += 1;
    if (expiredNotesLoopId !== null) {
      cancelAnimationFrame(expiredNotesLoopId);
      expiredNotesLoopId = null;
    }
  }

  /**
   * Roda em requestAnimationFrame, igual ao NoteRenderer, chamando
   * apenas o metodo que ja existe no GameplayEngine local para varrer a
   * timeline em busca de notas expiradas. Guardado por token (mesmo
   * padrao do NoteRenderer) para nunca haver dois loops da mesma
   * partida rodando ao mesmo tempo.
   */
  function startExpiredNotesLoop() {
    stopExpiredNotesLoop();
    expiredNotesLoopToken += 1;
    const token = expiredNotesLoopToken;

    function loop() {
      if (token !== expiredNotesLoopToken) return;
      if (localGameplayEngine) {
        const newlyMissed = localGameplayEngine.processExpiredNotes(getSyncedNow(), ClientConfig.NOTE_HIT_WINDOW_MS);

        // Etapa 5B-3B: cada nota que REALMENTE virou MISS agora (ja
        // decidido acima pelo GameplayEngine/NoteEngine) ganha o
        // feedback visual correspondente -- nenhuma logica de MISS
        // nova, so exibicao do que ja aconteceu.
        if (newlyMissed && newlyMissed.length > 0) {
          newlyMissed.forEach((note) => {
            FeedbackRenderer.showJudgement(currentSlot, 'MISS');
            FeedbackRenderer.flashNote(currentSlot, note.id, 'MISS');
          });
          if (localPlayerState) {
            FeedbackRenderer.updateScore(currentSlot, localPlayerState.score);
            FeedbackRenderer.updateCombo(currentSlot, localPlayerState.combo);
          }
        }
      }

      // Etapa 5B-4A: depois de varrer as notas expiradas acima (mesmo
      // frame, mesmo relogio sincronizado), verifica se a timeline
      // inteira ja esta concluida (todas hit/missed). checkForEnd() so
      // dispara handleLocalMatchEnd() na primeira vez que isso for
      // verdade -- chamadas seguintes (inclusive apos o loop ja ter sido
      // parado por dentro do proprio callback) nao fazem nada.
      if (localMatchEndDetector) {
        localMatchEndDetector.checkForEnd();
      }

      expiredNotesLoopId = requestAnimationFrame(loop);
    }

    expiredNotesLoopId = requestAnimationFrame(loop);
  }

  /**
   * Callback do MatchEndDetector (Etapa 5B-4A): roda exatamente uma vez,
   * no exato frame em que a timeline local terminar de ser processada.
   *
   * Ciclo de vida do fim da partida, apenas o que esta etapa pede:
   * - para o loop de renderizacao das notas (NoteRenderer.stop);
   * - para o loop de processamento de MISS (stopExpiredNotesLoop);
   * - impede novos inputs de alterar a partida (InputController.setLaneHandler(null),
   *   o MESMO mecanismo ja usado em match_cancelled -- com o handler
   *   nulo, InputController.triggerLane vira no-op para teclado e toque);
   * - preserva localPlayerState/localGameplayEngine/a timeline: nada e
   *   zerado ou apagado aqui. A proxima etapa (tela de resultado) ainda
   *   vai precisar ler esses dados.
   *
   * NAO mostra vencedor, ranking, tela de resultado, nem compara os
   * dois jogadores -- isso fica para uma etapa futura.
   */
  function handleLocalMatchEnd() {
    console.log('[match_end] timeline da partida concluida (todas as notas hit/missed).');
    UIController.logMessage('Partida concluida: todas as notas foram processadas.');

    // Etapa 5B-4B: gera o resultado final do jogador LOCAL exatamente
    // aqui -- uma unica vez, disparado pelo proprio callback de fim de
    // partida (nunca a cada frame). Le somente o que PlayerState e a
    // timeline ja existente (via MatchTimelineManager.getTimeline())
    // ja fornecem -- nenhuma contagem nova de hits/misses/mistakes.
    const timeline = MatchTimelineManager.getTimeline();
    if (localPlayerState && timeline) {
      const result = MatchResult.generateResult({ playerState: localPlayerState, timeline });
      console.log('[match_result]', result);
      UIController.logMessage(
        `Resultado: score ${result.score}, precisao ${result.accuracy}% (${result.hits}/${result.totalNotes}).`
      );

      // Etapa 5B-4C: esconde o campo de gameplay e mostra a tela visual
      // de resultado com o MESMO objeto que MatchResult acabou de gerar
      // -- nenhum numero novo e calculado aqui, ResultRenderer so exibe.
      UIController.hideGameField();
      ResultRenderer.show(result);
      // Etapa 10D: a partida terminou -- o servidor ja aceita uma nova
      // selecao de musica para a proxima Match desta sala (ex: antes
      // de uma revanche, ver rematchFlow.js), entao a interface volta
      // a ficar visivel aqui.
      musicSelectionController.reset();
      UIController.showMusicSelection();
    }

    NoteRenderer.stop();
    stopExpiredNotesLoop();
    InputController.setLaneHandler(null);

    // Etapa 12: avisa o servidor que a timeline local terminou. Isto e
    // so um GATILHO (nenhum score/resultado e enviado aqui) para que o
    // servidor chame o mesmo matchFlow.finishMatch ja existente e
    // transicione a Match para FINISHED de verdade -- sem isso a Match
    // ficava presa em PLAYING no servidor (mesmo com o resultado local
    // ja visivel aqui) e a revanche nunca conseguia comecar. Ver
    // gameplayFlow.applySequenceComplete no servidor para o restante
    // do fluxo (idempotente: enviar isto mais de uma vez nao tem
    // efeito depois da primeira, e handleLocalMatchEnd em si so roda
    // uma vez por partida, ver MatchEndDetector).
    SocketClient.send('sequence_complete');
  }

  /**
   * Chamado (via matchAbandonmentController, Etapa 8B) quando o servidor
   * avisa que a partida foi encerrada por abandono (`match_abandoned`,
   * Etapa 8A -- o servidor ja e a autoridade: a Match la ja virou
   * FINISHED antes mesmo desta mensagem chegar).
   *
   * Encerra a experiencia local da MESMA forma que `match_cancelled` ja
   * faz hoje (ver o case correspondente no listener de mensagens abaixo)
   * -- reaproveitando exatamente as mesmas chamadas, sem inventar um
   * segundo mecanismo de "fim de partida":
   * - para o NoteRenderer e o loop de notas expiradas;
   * - desliga o input local (InputController.setLaneHandler(null)) --
   *   depois disso, handleLanePressed nunca mais e chamado por teclado/
   *   toque, entao nenhum novo julgamento (nem MISS, ja que o loop
   *   tambem parou) consegue mais acontecer;
   * - zera as referencias locais (localGameplayEngine/localPlayerState/
   *   localMatchEndDetector) -- com o loop parado, `localMatchEndDetector`
   *   nunca mais e consultado de qualquer forma, entao ele NUNCA dispara
   *   `handleLocalMatchEnd` para esta partida (nenhum MatchResult/
   *   `match_result` normal e gerado ou enviado);
   * - MatchTimelineManager.clear()/MatchResult.clearResult() -- mesma
   *   limpeza ja usada em match_cancelled, para nada desta partida vazar
   *   para a proxima;
   * - devolve a tela ao estado de espera (UIController.resetMatchToWaiting,
   *   ja usado por match_cancelled) e ResultRenderer.reset() -- NUNCA
   *   ResultRenderer.show(), porque esta etapa nao gera nenhum resultado
   *   normal;
   * - rematchController.reset() -- so devolve o handshake de revanche ao
   *   estado inicial (mesmo efeito de match_cancelled); NAO inicia
   *   nenhuma revanche sozinho. Se o jogador que ficou clicar "Jogar
   *   Novamente" depois disso, a mensagem so chega ao servidor, que (ja
   *   na Etapa 8A) recusa sem oponente conectado -- nenhum comportamento
   *   novo e criado aqui;
   * - mostra uma mensagem simples reaproveitando UIController.logMessage
   *   (mesmo mecanismo ja usado para toda mensagem informativa/erro do
   *   projeto) -- nenhuma tela nova.
   *
   * @param {boolean} isLocalPlayer - true somente se `abandonedBy`
   *   apontava para o proprio jogador local (inconsistencia de payload;
   *   ver matchAbandonmentController.isValidPayload). Mesmo nesse caso
   *   o encerramento local acontece da mesma forma, com seguranca.
   */
  function handleMatchAbandoned(isLocalPlayer) {
    NoteRenderer.stop();
    stopExpiredNotesLoop();
    InputController.setLaneHandler(null);
    FeedbackRenderer.reset();

    localGameplayEngine = null;
    localPlayerState = null;
    localMatchEndDetector = null;
    MatchTimelineManager.clear();
    MatchResult.clearResult();

    ResultRenderer.reset();
    rematchController.reset();
    // Etapa 10D: mesmo motivo do reset acima -- a selecao pendente
    // desta partida ja foi consumida/descartada no servidor (ver
    // matchFlow/musicSelectionFlow), entao a UI local tambem nao deve
    // continuar mostrando-a.
    musicSelectionController.reset();
    UIController.resetMatchToWaiting();

    UIController.logMessage(
      isLocalPlayer ? 'Partida encerrada.' : 'Seu adversario saiu da partida.'
    );
  }

  /**
   * Chamado (via leaveRoomController, Etapa 9B) quando o servidor
   * confirma (`left_room`) que o PROPRIO jogador local saiu da sala
   * (Etapa 9A -- o servidor ja e a autoridade: a sala/match la ja
   * foram atualizados antes mesmo desta mensagem chegar).
   *
   * Encerra qualquer partida/estado local da MESMA forma que
   * `handleMatchAbandoned`/`match_cancelled` ja fazem hoje (reaproveita
   * exatamente as mesmas chamadas, nenhum segundo mecanismo de "fim de
   * partida" e criado) e, alem disso, devolve a TELA INTEIRA ao estado
   * de lobby (diferente de `handleMatchAbandoned`, que mantem o
   * jogador na sala aguardando revanche) -- afinal aqui o jogador nao
   * pertence mais a sala nenhuma:
   * - para o NoteRenderer, o loop de notas expiradas e a contagem
   *   regressiva (MatchController.stopCountdown -- seguro chamar mesmo
   *   que nao houvesse countdown ativo, ver matchController.js);
   * - desliga o input local (InputController.setLaneHandler(null));
   * - zera as referencias locais de partida (localGameplayEngine/
   *   localPlayerState/localMatchEndDetector) e a timeline/resultado
   *   (MatchTimelineManager.clear()/MatchResult.clearResult()), para
   *   nada desta sessao vazar para a proxima sala;
   * - devolve rematchController/matchAbandonmentController ao estado
   *   inicial (mesmos resets ja usados por match_cancelled/abandono) --
   *   nenhuma revanche ou abandono de uma sala anterior pode afetar a
   *   proxima;
   * - esconde a tela de resultado (ResultRenderer.reset()) -- nunca
   *   mostra nada, esta etapa nao gera nenhum resultado;
   * - zera `currentSlot` e devolve a UI ao lobby
   *   (UIController.resetToLobby()) -- so DEPOIS de sair de verdade,
   *   nunca antes de a confirmacao do servidor chegar.
   *
   * NAO fecha o WebSocket, NAO recarrega a pagina e NAO cria uma sala
   * nova automaticamente -- a conexao segue aberta e pronta para um
   * novo `create_room`/`join_room`.
   */
  function handleLeftRoom() {
    MatchController.stopCountdown();
    NoteRenderer.stop();
    stopExpiredNotesLoop();
    InputController.setLaneHandler(null);
    FeedbackRenderer.reset();

    localGameplayEngine = null;
    localPlayerState = null;
    localMatchEndDetector = null;
    MatchTimelineManager.clear();
    MatchResult.clearResult();

    ResultRenderer.reset();
    rematchController.reset();
    matchAbandonmentController.reset();
    // Etapa 10D: o servidor ja limpa a selecao pendente da sala inteira
    // ao processar `leave_room` (ver leaveRoomFlow.js) -- a UI local
    // tambem volta ao estado inicial, para nunca vazar para uma
    // proxima sala.
    musicSelectionController.reset();

    currentSlot = null;
    // ETAPA 12A: de volta ao lobby -- nenhuma sala/partida (solo ou
    // multiplayer) associada mais.
    isSoloMode = false;
    UIController.setSoloMode(false);
    UIController.resetToLobby();
    UIController.logMessage('Voce saiu da sala.');
  }

  // Handler central chamado pelo InputController para QUALQUER lane
  // pressionada (teclado ou toque, ja unificados). So repassa para o
  // GameplayEngine do jogador local -- PERFECT/GOOD/MISTAKE, combo e
  // pontuacao continuam sendo decididos inteiramente por ele, com a
  // timeline real da partida (Etapa 5B-2A). Aqui so logamos o
  // resultado como feedback simples de que a entrada chegou.
  function handleLanePressed(lane) {
    if (!localGameplayEngine) return;

    // Etapa 5B-3A: julgamento usa o relogio sincronizado da partida
    // (getSyncedNow), o MESMO usado pelo NoteRenderer para posicionar as
    // notas -- nunca o horario bruto de chegada da tecla no navegador.
    const result = localGameplayEngine.handleKeyPress(lane, getSyncedNow());

    console.log(`Lane ${lane} pressionada`, result);
    UIController.logMessage(`Lane ${lane} pressionada (${result.outcome})`);

    // Etapa 5B-3B: so REPASSA o resultado (ja decidido acima pelo
    // GameplayEngine) para a camada visual -- nenhum julgamento/score/
    // combo novo e calculado aqui.
    FeedbackRenderer.showJudgement(currentSlot, result.outcome);
    if (result.outcome === 'PERFECT' || result.outcome === 'GOOD') {
      FeedbackRenderer.flashNote(currentSlot, result.noteId, 'HIT');
    }
    if (localPlayerState) {
      FeedbackRenderer.updateScore(currentSlot, localPlayerState.score);
      FeedbackRenderer.updateCombo(currentSlot, localPlayerState.combo);
    }
  }

  InputController.setLaneHandler(null);
  InputController.bindKeyboard();

  // Etapa 5B-4C: liga os handlers dos botoes da tela de resultado UMA
  // unica vez (ResultRenderer garante internamente que o clique nunca
  // fica duplicado, mesmo que a tela seja mostrada varias vezes ao
  // longo de partidas diferentes).
  //
  // "Voltar ao Menu": o fluxo atual do jogo nao tem um conceito de
  // "sala"/"partida" que possa ser abandonado no meio (nao existe
  // mensagem de rede tipo `leave_room`, e o enunciado desta etapa pede
  // explicitamente para NAO alterar servidor/salas/Match). A unica
  // forma ja suportada, de maneira segura, de voltar ao Menu Principal (a
  // tela inicial de "Criar sala" / "Entrar em sala") e recarregar a
  // pagina -- e o que este handler faz. Nenhum sistema novo de sala é
  // inventado aqui.
  ResultRenderer.setOnBackToMenu(() => {
    ResultRenderer.hide();
    window.location.reload();
  });

  // "Jogar Novamente": Etapa 5B-5A (Parte 2). O clique so pede ao
  // RematchController para negociar a revanche -- ele garante que
  // cliques repetidos nunca enviam uma segunda solicitacao (ver
  // rematchController.js). Esconder a tela de resultado NAO acontece
  // aqui: ela some sozinha quando `match_started` chegar de verdade
  // (mesmo fluxo/reset ja usado por qualquer partida nova, dentro de
  // startMatchGameplay). Enquanto isso, a tela de resultado continua
  // visivel, so com o botao desabilitado e a mensagem de espera.
  ResultRenderer.setOnPlayAgain(() => {
    // ETAPA 12A: no modo Solo NAO usamos o handshake multiplayer de
    // rematchController (nao faz sentido negociar prontidao com um
    // oponente que nao existe) -- pedimos diretamente uma nova partida
    // Solo, reutilizando a MESMA arquitetura (start_solo_match, ver
    // server/ws/messageRouter.js#handleStartSoloMatch, que sempre cria
    // uma Match nova: nova seed/timeline/estado, nunca reaproveita a
    // anterior). O multiplayer continua usando rematchController
    // exatamente como antes.
    if (isSoloMode) {
      SocketClient.send('start_solo_match');
      return;
    }
    rematchController.requestRematch();
  });

  SocketClient.onStatusChange((status) => {
    UIController.setConnectionStatus(status);
  });

  SocketClient.onMessage((message) => {
    switch (message.type) {
      case 'connected':
        // Conexao estabelecida e o servidor atribuiu um playerId interno.
        break;

      case 'room_created':
        currentSlot = message.slot;
        UIController.showRoomJoined({
          roomCode: message.roomCode,
          slot: message.slot,
          roomState: message.room,
        });
        UIController.logMessage(`Sala criada: ${message.roomCode}`);
        break;

      case 'room_joined':
        currentSlot = message.slot;
        UIController.showRoomJoined({
          roomCode: message.roomCode,
          slot: message.slot,
          roomState: message.room,
        });
        UIController.logMessage(`Voce entrou na sala ${message.roomCode}`);
        break;

      case 'music_catalog':
        // Etapa 10D: lista de musicas disponiveis (dados publicos,
        // ver server/music/musicSelectionFlow.js#getPublicCatalog).
        // Delega inteiramente ao controlador dedicado -- este case so
        // repassa a mensagem crua.
        musicSelectionController.setCatalog(message.musics);
        break;

      case 'music_selected':
        // Etapa 10D: confirmacao do servidor de que uma selecao (do
        // proprio jogador local ou do oponente) foi registrada para a
        // proxima partida desta sala. Delega ao controlador dedicado
        // (Etapa 10D) -- este case so repassa a mensagem crua e o
        // proprio slot local, para o controlador distinguir a propria
        // confirmacao da do oponente.
        musicSelectionController.handleConfirmation(message, currentSlot);
        break;

      case 'opponent_joined':
        UIController.updateRoomState(message.room);
        UIController.logMessage('Oponente entrou na sala.');
        break;

      case 'room_full':
        UIController.updateRoomState(message.room);
        UIController.logMessage('Sala completa: os dois jogadores estao conectados.');
        break;

      case 'opponent_left':
        UIController.updateRoomState(message.room);
        UIController.logMessage('Oponente saiu da sala.');
        break;

      case 'left_room':
        // Etapa 9B: confirmacao do servidor de que o PROPRIO jogador
        // local saiu da sala (Etapa 9A). Delega ao controlador dedicado
        // (Etapa 9B) a validacao/idempotencia -- este case so repassa a
        // mensagem crua; o que fazer de verdade esta em handleLeftRoom
        // (injetado como onLeaveConfirmed acima).
        leaveRoomController.handleConfirmation(message);
        break;

      case 'player_left_room':
        // Etapa 9B: o OUTRO jogador saiu voluntariamente da sala
        // (Etapa 9A). So atualizamos o status/aviso da sala aqui --
        // qualquer efeito sobre a PARTIDA (cancelamento/abandono) ou
        // sobre uma revanche pendente ja chega por mensagens dedicadas
        // e separadas (match_cancelled/match_abandoned/rematch_cancelled,
        // ja tratadas em outros cases), entao este case nunca decide
        // isso sozinho.
        UIController.showOpponentLeftRoom();
        UIController.logMessage(`${message.player} saiu da sala.`);
        break;

      case 'match_ready':
        // ETAPA 12A: sincroniza o modo visual com a verdade do servidor
        // (match.mode) -- o servidor e a UNICA autoridade; o clique em
        // "Jogar Sozinho" so adianta isso de forma otimista.
        isSoloMode = message.match.mode === 'solo';
        UIController.setSoloMode(isSoloMode);
        UIController.setMatchState(message.match.state);
        UIController.setMatchSeed(message.match.seed);
        UIController.logMessage('Os dois jogadores estao prontos. Preparando inicio...');
        generateAndReportLocalSequence(message.match);
        break;

      case 'match_countdown_start':
        UIController.setMatchState(message.match.state);
        UIController.logMessage(
          `Contagem regressiva iniciada pelo servidor (inicio em ${message.countdownSeconds}s).`
        );
        matchClockOffsetMs = message.serverTime - Date.now();
        MatchController.startCountdown(
          { startTimestamp: message.startTimestamp, serverTime: message.serverTime },
          (secondsRemaining) => UIController.showCountdownTick(secondsRemaining),
          () => UIController.showCountdownFinished()
        );
        break;

      case 'match_started':
        UIController.setMatchState(message.match.state);
        UIController.showCountdownFinished();
        UIController.logMessage('Partida iniciada (timestamp do servidor alcancado).');
        startMatchGameplay(message);
        break;

      case 'match_cancelled':
        MatchController.stopCountdown();
        NoteRenderer.stop();
        stopExpiredNotesLoop();
        FeedbackRenderer.reset();
        // Etapa 5B-4C: partida cancelada NUNCA mostra a tela de
        // resultado. Chamar reset() aqui e seguro mesmo que a tela
        // nunca tenha sido mostrada (ex: cancelamento durante a
        // contagem regressiva, antes de qualquer nota existir).
        ResultRenderer.reset();
        // Etapa 5B-5A (Parte 2): se este cancelamento aconteceu durante
        // o countdown/gameplay de uma revanche (nova partida ja criada
        // pelo servidor apos os dois ficarem prontos), o handshake ja
        // estava resolvido -- devolve o controlador ao estado inicial
        // tambem aqui, pelo mesmo motivo do reset acima.
        rematchController.reset();
        // Etapa 10D: mesmo motivo do reset acima -- se havia uma
        // selecao pendente para a Match que acabou de ser cancelada, a
        // UI local nao deve continuar mostrando-a como se fosse
        // valida para a proxima tentativa (o servidor ja a limpa/
        // ignora do lado dele quando aplicavel).
        musicSelectionController.reset();
        UIController.resetMatchToWaiting();
        UIController.logMessage(`Partida cancelada: ${message.reason}`);
        localGameplayEngine = null;
        localPlayerState = null;
        localMatchEndDetector = null;
        InputController.setLaneHandler(null);
        MatchTimelineManager.clear();
        // Etapa 5B-4B: partida cancelada antes do fim NAO gera resultado
        // -- e nao pode sobrar nenhum resultado de uma tentativa anterior.
        MatchResult.clearResult();
        break;

      case 'match_abandoned':
        // Etapa 8B: o servidor (Etapa 8A, ja autoridade) detectou que o
        // adversario desconectou durante PLAYING e encerrou a Match la.
        // Delega ao controlador dedicado (Etapa 8B) toda a validacao do
        // payload e a protecao contra evento duplicado -- este case so
        // repassa a mensagem crua e o proprio slot local.
        matchAbandonmentController.handleEvent(message, currentSlot);
        break;

      case 'match_result':
        // Etapa 12: resultado OFICIAL do servidor (winner/loser/result),
        // calculado exclusivamente a partir do snapshot final real dos
        // dois jogadores (matchFlow.finishMatch -> finalMatchState ->
        // matchOutcome) -- chega depois do resultado local que
        // handleLocalMatchEnd ja mostra (Etapa 5B-4C), nunca o substitui
        // com numeros diferentes (mesmos valores, ja que o servidor so
        // registra o que o proprio cliente reportou via note_hit/
        // note_miss). Garante que gameplay/input ficam parados
        // (chamadas idempotentes, mesmas ja usadas em match_cancelled/
        // match_abandoned) e so registra o resultado oficial no log --
        // nenhuma tela nova, nenhuma segunda partida iniciada aqui (a
        // revanche continua dependendo exclusivamente do clique em
        // "Jogar Novamente").
        NoteRenderer.stop();
        stopExpiredNotesLoop();
        InputController.setLaneHandler(null);
        // ETAPA 12A: no modo Solo o servidor nao envia result/winner/
        // loser (nao ha oponente para comparar -- ver
        // matchFlow.finishMatch) -- so as estatisticas de player1, ja
        // mostradas pelo resultado local (handleLocalMatchEnd). Nao
        // mostrar vencedor/perdedor/empate aqui.
        UIController.logMessage(
          message.mode === 'solo'
            ? 'Resultado oficial do servidor confirmado (modo Solo).'
            : message.result === 'draw'
              ? 'Resultado oficial do servidor: empate.'
              : `Resultado oficial do servidor: ${message.winner} venceu.`
        );
        break;

      case 'sequence_check_result':
        console.log('[sequence_check_result]', message);
        UIController.logMessage(
          message.identical
            ? 'SEQUENCIAS IDENTICAS ✓ (ver console para detalhes)'
            : 'SEQUENCIAS DIFERENTES ✗ (ver console para detalhes)'
        );
        break;

      case 'opponent_note_event':
        // Apenas log textual (infra de comunicacao) — nenhuma interface
        // visual de jogo ainda. A Etapa 4B ainda nao envia estes eventos
        // sozinha (nao ha input de teclado no piano ainda); este handler
        // existe para a comunicacao ja funcionar de ponta a ponta assim
        // que a proxima etapa (interface visual) comecar a chamar
        // GameplayEngine.handleKeyPress / processExpiredNotes.
        console.log('[opponent_note_event]', message);
        UIController.logMessage(
          `Oponente: ${message.event}${message.judgement ? ` (${message.judgement})` : ''} — combo ${message.combo}`
        );
        break;

      case 'rematch_player_ready':
        // Etapa 5B-5A (Parte 2): so log informativo -- o estado de
        // "aguardando" da UI local ja e controlado de forma otimista
        // pelo proprio clique (RematchController), nao por esta
        // mensagem. Isso so confirma, para quem estiver de olho no
        // log, quais jogadores ja pediram revanche ate agora.
        UIController.logMessage(
          message.ready && message.ready.player1 && message.ready.player2
            ? 'Os dois jogadores estao prontos para a revanche.'
            : `${message.slot} esta pronto para a revanche.`
        );
        break;

      case 'rematch_cancelled':
        // Etapa 5B-5A (Parte 2): o servidor cancelou o handshake de
        // revanche (ex: o oponente desconectou enquanto aguardavamos).
        // Todo o "o que fazer" (UI + log) ja esta encapsulado em
        // RematchController.handleCancelled -- aqui so repassamos.
        rematchController.handleCancelled(message.reason);
        break;

      case 'test_message':
        UIController.logMessage(`[${message.from}] enviou uma mensagem de teste.`);
        break;

      case 'error':
        // Etapa 10D: se havia uma selecao de musica pendente daqui, o
        // controlador dedicado trata a rejeicao (libera para nova
        // tentativa); se nao havia nenhuma selecao pendente,
        // handleRejection nao faz nada (ver musicSelectionController.js)
        // -- nenhum outro tipo de erro do projeto e afetado por isso.
        musicSelectionController.handleRejection(message.message);
        UIController.showError(message.message);
        break;

      default:
        console.warn('Mensagem desconhecida recebida:', message);
    }
  });

  /**
   * Resolve o padrao (length/noteRange/noteIntervalMs/leadInMs) da
   * musica desta partida (Etapa 10B).
   *
   * `match.music.sequenceId` vem do servidor (ver Match.toPublicJSON),
   * que ja resolveu a musica no musicCatalog -- aqui so precisamos
   * resolver esse MESMO sequenceId contra o catalogo de padroes do
   * cliente (client/js/music/sequenceCatalog.js), para que musicas
   * diferentes produzam sequencias/timelines com parametros diferentes,
   * sem nenhum novo mecanismo de sincronizacao (a seed continua sendo
   * a unica).
   *
   * Se por algum motivo a mensagem nao trouxer `match.music` (ex: uma
   * versao antiga do servidor, ou uma mensagem de teste manual), cai de
   * volta nos valores fixos de ClientConfig -- o mesmo comportamento
   * que existia antes desta etapa -- em vez de quebrar a partida.
   */
  function resolveSequencePattern(match) {
    const sequenceId = match && match.music && match.music.sequenceId;
    const pattern = sequenceId ? SequenceCatalog.getSequencePattern(sequenceId) : null;

    if (pattern) return pattern;

    return {
      length: ClientConfig.TEST_SEQUENCE_LENGTH,
      noteRange: ClientConfig.TEST_NOTE_RANGE,
      noteIntervalMs: ClientConfig.NOTE_INTERVAL_MS,
      leadInMs: ClientConfig.NOTE_LEAD_IN_MS,
    };
  }

  /**
   * A partir da seed recebida do servidor, gera a sequencia de teste
   * LOCALMENTE (sem pedir cada nota ao servidor) e reporta um checksum
   * de volta, para o servidor confirmar se os dois jogadores geraram
   * exatamente a mesma coisa.
   *
   * Etapa 10B: length/noteRange agora vem do padrao da musica desta
   * partida (resolveSequencePattern), em vez de sempre os mesmos
   * valores fixos de ClientConfig -- assim o checksum reportado bate
   * com o `_referenceChecksum` do servidor (que ja usa o padrao da
   * musica desde a Etapa 10A) mesmo quando a musica muda.
   */
  function generateAndReportLocalSequence(match) {
    const pattern = resolveSequencePattern(match);
    const sequence = SequenceGenerator.generateSequence(match.seed, pattern.length, pattern.noteRange);
    const checksum = SequenceGenerator.calculateChecksum(sequence);

    console.log(
      `[${currentSlot}] seed=${match.seed} sequence=[${sequence.join(', ')}] checksum=${checksum}`
    );
    UIController.logMessage(`Sequencia gerada localmente a partir da seed ${match.seed}.`);

    SocketClient.send('sequence_check', { seed: match.seed, sequence, checksum });
  }

  /**
   * Garante a timeline de notas desta partida (Etapa 5B-2A) e cria o
   * GameplayEngine do jogador local ja apontando pra ela, ligando a
   * entrada (teclado + toque).
   *
   * A timeline vem exclusivamente de MatchTimelineManager.ensureTimeline,
   * que por sua vez usa exclusivamente NoteEngine.generateNoteTimeline
   * (Etapa 4A) -- nenhum gerador ou sistema de timeline novo. Os dados
   * usados (seed, startTimestamp) vem do proprio servidor via a
   * mensagem match_started, nunca do relogio ou de qualquer estado
   * local de cada navegador -- e por isso os dois jogadores acabam
   * gerando exatamente a mesma timeline, cada um localmente, sem que
   * a sequencia completa precise trafegar pelo WebSocket.
   *
   * Reutiliza integralmente PlayerState.createPlayerState() e
   * GameplayEngine.createGameplayEngine() ja existentes (Etapa 4B) --
   * nenhuma logica de julgamento/combo/pontuacao e recriada aqui.
   *
   * A partir da Etapa 5B-2B, a timeline tambem e entregue ao NoteRenderer
   * (camada puramente visual, so leitura) para desenhar/mover as notas no
   * DOM -- ele nao participa em nada do julgamento/pontuacao acima.
   *
   * @param {object} message - payload da mensagem match_started (tem
   *   startTimestamp e match.seed, ambos definidos pelo servidor).
   */
  function startMatchGameplay(message) {
    if (!currentSlot) return;

    // Etapa 5B-4B: descarta qualquer resultado de uma partida anterior
    // ANTES de comecar a nova -- garante que o resultado antigo nunca
    // vaza para esta partida (hasResult()/getResult() so voltam a
    // refletir algo depois que ESTA partida terminar de verdade).
    MatchResult.clearResult();
    // Etapa 5B-4C: garante que a tela de resultado de uma partida
    // anterior nunca fique visivel/preenchida ao iniciar esta nova
    // partida (mesmo raciocinio do MatchResult.clearResult acima).
    ResultRenderer.reset();
    // Etapa 5B-5A (Parte 2): a partida nova comecou de verdade --
    // devolve o controlador de revanche ao estado inicial, para que
    // esta MESMA partida possa gerar um novo handshake de revanche
    // quando ela terminar (o handshake anterior ja foi resolvido).
    rematchController.reset();
    // Etapa 8B: mesma logica -- esta e uma partida NOVA, entao o
    // controlador de abandono precisa poder tratar um abandono desta
    // partida normalmente (o de uma partida anterior, se algum, ja foi
    // tratado e nao deve mais gerar nenhum efeito).
    matchAbandonmentController.reset();
    // Etapa 10D: a musica desta Match ja esta definida (ver
    // message.match.musicId/message.match.music, resolvidos pelo
    // servidor antes mesmo do countdown) -- a selecao que a originou
    // (se houve alguma) ja foi consumida no servidor, entao a UI local
    // tambem volta ao estado inicial para a PROXIMA selecao (ex: antes
    // de uma revanche futura).
    musicSelectionController.reset();

    // Etapa 10B: os parametros da timeline vem do padrao da musica desta
    // partida (resolveSequencePattern), nunca mais sempre os mesmos 4
    // valores fixos -- e assim que musica diferente => padrao diferente
    // => timeline diferente, mantendo a MESMA seed como unico mecanismo
    // de sincronizacao entre os dois jogadores.
    const pattern = resolveSequencePattern(message.match);
    const timeline = MatchTimelineManager.ensureTimeline({
      seed: message.match.seed,
      startTimestamp: message.startTimestamp,
      length: pattern.length,
      noteRange: pattern.noteRange,
      noteIntervalMs: pattern.noteIntervalMs,
      leadInMs: pattern.leadInMs,
    });
    UIController.logMessage(`Timeline de notas gerada localmente (${timeline.length} notas).`);

    // Camada visual (Etapa 5B-2B): so LE a timeline acima, nunca a altera.
    // Calcula posicao localmente, com base no mesmo relogio sincronizado
    // usado pela contagem regressiva (matchClockOffsetMs) -- nenhuma
    // posicao de nota trafega pelo WebSocket.
    NoteRenderer.start({
      timeline,
      clockOffsetMs: matchClockOffsetMs,
      hitWindowMs: ClientConfig.NOTE_HIT_WINDOW_MS,
    });

    const playerState = PlayerState.createPlayerState();
    localPlayerState = playerState;
    // Limpa qualquer estado visual (timers, ultimo score/combo exibido)
    // de uma partida anterior neste MESMO slot antes de comecar a nova.
    FeedbackRenderer.reset(currentSlot);

    localGameplayEngine = GameplayEngine.createGameplayEngine({
      timeline,
      playerState,
      windows: {
        perfectMs: ClientConfig.JUDGEMENT_WINDOWS.PERFECT_MS,
        goodMs: ClientConfig.JUDGEMENT_WINDOWS.GOOD_MS,
      },
      scoreValues: ClientConfig.SCORE_VALUES,
      sendEvent: SocketClient.send,
    });

    InputController.setLaneHandler(handleLanePressed);

    // Etapa 5B-4A: uma instancia nova do detector de fim de partida,
    // ligada a ESTA timeline (a mesma usada acima pelo GameplayEngine).
    // Criar de novo aqui, a cada partida, e o que garante o reset
    // correto entre partidas -- nao ha estado global "encerrado"
    // sobrando de uma partida anterior.
    localMatchEndDetector = MatchEndDetector.createMatchEndDetector({
      timeline,
      onMatchEnd: handleLocalMatchEnd,
    });

    // Comeca a varrer a timeline em busca de notas expiradas (MISS),
    // usando o sistema ja existente (GameplayEngine.processExpiredNotes)
    // e o mesmo relogio sincronizado do julgamento de acerto acima.
    startExpiredNotesLoop();

    // So liga o toque nas teclas do PROPRIO jogador (data-lane), uma
    // unica vez -- as teclas do oponente continuam desabilitadas e
    // sem listener, entao nunca chamam o GameplayEngine local.
    if (!touchBound) {
      const ownKeysContainer = document.getElementById(`${currentSlot}-keys`);
      InputController.bindTouchButtons(ownKeysContainer);
      touchBound = true;
    }
  }

  document.getElementById('btn-create-room').addEventListener('click', () => {
    isSoloMode = false;
    UIController.setSoloMode(false);
    SocketClient.send('create_room');
  });

  document.getElementById('btn-join-room').addEventListener('click', () => {
    const roomCode = UIController.getRoomCodeInput();
    if (!roomCode) {
      UIController.showError('Informe um codigo de sala.');
      return;
    }
    isSoloMode = false;
    UIController.setSoloMode(false);
    SocketClient.send('join_room', { roomCode });
  });

  // ETAPA 12A: "Jogar Sozinho". So pede ao servidor (start_solo_match) --
  // reutiliza integralmente o mesmo pipeline de sala/partida do
  // multiplayer (ver server/ws/messageRouter.js#handleStartSoloMatch).
  // O modo visual e ligado aqui, de forma otimista; `match_ready` acima
  // sincroniza com a verdade do servidor assim que ela chegar.
  document.getElementById('btn-play-solo').addEventListener('click', () => {
    isSoloMode = true;
    UIController.setSoloMode(true);
    SocketClient.send('start_solo_match');
  });

  document.getElementById('btn-send-test').addEventListener('click', () => {
    SocketClient.send('test_message', { text: 'ping' });
    UIController.logMessage(`[${currentSlot}] voce enviou uma mensagem de teste.`);
  });

  // Etapa 9B: "Sair da sala". O clique so pede ao LeaveRoomController
  // para negociar a saida -- ele garante que cliques repetidos nunca
  // enviam um segundo `leave_room` para o mesmo pedido, e que nada e
  // enviado se o jogador local ja nao estiver em uma sala (ver
  // leaveRoomController.js). O reset de verdade (telas, timeline,
  // input etc.) so acontece quando a confirmacao do servidor chegar
  // (ver handleLeftRoom, chamado via onLeaveConfirmed).
  document.getElementById('btn-leave-room').addEventListener('click', () => {
    leaveRoomController.requestLeave();
  });

  SocketClient.connect();
})();
