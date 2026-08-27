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

  // ETAPA 14C: true assim que o jogador pediu "Jogar contra Bot" (ver
  // btn-play-bot abaixo) ate sair da sala/abandonar/trocar de modo --
  // estado PROPRIO, NUNCA reaproveitando isSoloMode para representar o
  // Bot. Por baixo, o clique reutiliza o MESMO pipeline de partida do
  // Solo (start_solo_match), pelo mesmo motivo que o Modo Teste ja faz
  // isso hoje (unica forma existente de obter seed/timeline
  // sincronizadas) -- por isso `isSoloMode` tambem acaba virando true
  // quando o servidor confirma `match.mode === 'solo'` (ver case
  // 'match_ready' abaixo, inalterado). Isso e apenas um detalhe de
  // encanamento: nenhuma logica do Bot (abaixo) e condicionada a
  // `isSoloMode` -- so a `isBotMode`, que so este bloco/os handlers do
  // botao do Bot alteram.
  let isBotMode = false;
  // Instancia do Bot ativo NESTA partida (Etapa 14C), criada por
  // BotMatchController.createBotMatch (Etapa 14B) dentro de
  // startMatchGameplay quando isBotMode e verdadeiro. Null fora do
  // modo Bot ou entre partidas.
  let botMatch = null;
  // ETAPA 14D — PARTE 2B: identificador ("EASY"/"MEDIUM"/"HARD", ver
  // ClientConfig.BOT_DIFFICULTY) escolhido pelo jogador na tela
  // "Escolha a dificuldade" (aberta por btn-play-bot, ver mais abaixo).
  // Estado PROPRIO -- nunca persistido (sem localStorage), existe
  // somente durante o fluxo da partida atual/sala atual, exatamente
  // como isBotMode/botMatch acima: comeca null, e definido quando o
  // jogador escolhe uma das tres opcoes, e limpo sempre que isBotMode
  // tambem e limpo (cancelar a selecao, trocar de modo, sair da sala).
  // Usado dentro de startMatchGameplay para resolver a config do Bot
  // (via BotController.createConfigForDifficulty, Etapa 14D-2A) --
  // nenhum sistema de Bot novo, so este identificador chegando ao
  // sistema ja existente.
  let selectedBotDifficulty = null;

  // ETAPA 15B: identificador da duracao escolhida pelo jogador na tela
  // "Escolha a duração da partida" (aberta antes de iniciar Solo/Bot,
  // ver botoes mais abaixo) -- um dos quatro valores estaveis de
  // ClientConfig.MATCH_DURATION_IDS ("30S"/"1M"/"5M"/"10M", definidos
  // na Etapa 15A). Mesmo padrao de estado PROPRIO de
  // isBotMode/selectedBotDifficulty acima: nunca persistido (sem
  // localStorage), comeca null, e definido quando o jogador escolhe
  // uma das quatro opcoes, e limpo sempre que o jogador cancela essa
  // selecao ou sai da sala/volta ao menu/inicia um multiplayer real.
  // IMPORTANTE (Etapa 15B): esta etapa e SOMENTE selecao e
  // armazenamento -- nenhuma partida termina mais cedo por causa
  // deste valor ainda. Ele fica disponivel aqui para a proxima parte
  // da Etapa 15 aplicar de fato (ver client/js/match/matchDuration.js).
  let selectedMatchDuration = null;

  // ETAPA 15C-MP — Parte 4: qual fluxo abriu a tela "Escolha a duração
  // da partida" (mesmo painel reutilizado por Solo/Bot desde a Etapa
  // 15B, ver `match-duration-panel` em client/index.html) -- um dos
  // tres valores estaveis: 'solo', 'bot' ou 'multiplayer'. Estado
  // PROPRIO (mesmo padrao de `selectedBotDifficulty`/
  // `selectedMatchDuration` acima): nunca persistido, comeca `null`,
  // e sempre limpo assim que o painel e fechado (opcao escolhida ou
  // cancelamento) ou a sala e deixada. So decide O QUE FAZER quando o
  // jogador escolhe uma das quatro opcoes do painel:
  // - 'solo'/'bot': comportamento ja existente desde a Etapa 15B --
  //   guarda a escolha em `selectedMatchDuration` (resolvida
  //   localmente por MatchDuration.resolveMatchDuration) e envia
  //   `start_solo_match`;
  // - 'multiplayer': a sala JA existe (criada por "Criar Sala" antes
  //   deste painel abrir) -- em vez de iniciar uma partida nova, so
  //   envia `select_duration` pelo fluxo Multiplayer ja preparado
  //   (Etapa 15C-MP — Parte 1), reutilizando o MESMO identificador
  //   ("30S"/"1M"/"5M"/"10M"). A Match real so e criada quando a sala
  //   ficar cheia (ver server/ws/messageRouter.js#handleJoinRoom),
  //   nunca por uma mensagem enviada aqui -- e o servidor (nao este
  //   cliente) quem resolve/transporta a duracao para os dois
  //   jogadores (`match_ready`/`match.durationMs`, ja consumido em
  //   startMatchGameplay).
  let matchDurationSelectionContext = null;

  // Debounce do "Jogar Novamente" no Solo/Bot/Modo Teste (item a
  // corrigir nesta etapa): esses modos NAO passam pelo handshake de
  // `rematchController` abaixo (nao ha oponente para negociar
  // prontidao) -- o clique manda `start_solo_match` diretamente ao
  // servidor. Sem nenhuma protecao, um duplo clique (ou um duplo
  // disparo do evento de clique, comum em telas sensiveis ao toque)
  // faz o MESMO handler rodar duas vezes: a primeira mensagem cria a
  // partida nova normalmente, e a segunda chega ao servidor enquanto
  // essa partida recem-criada ainda esta READY/COUNTDOWN/PLAYING (ver
  // server/ws/messageRouter.js#handleStartSoloMatch), que rejeita com
  // "Ja existe uma partida solo em andamento nesta sala." -- exatamente
  // o erro relatado. Esta flag garante UM `start_solo_match` por
  // partida terminada, o mesmo raciocinio que `rematchController` ja
  // usa para o Multiplayer (ver `waitingForOpponent` em
  // rematchController.js), sem inventar nenhum sistema de partida novo.
  let soloRematchInFlight = false;

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
      // Correcao mobile: o corpo inteiro do frame fica dentro de um
      // try/finally. Sem isso, uma excecao inesperada no meio do frame
      // (que pode depender de timing/navegador e so aparecer em certos
      // celulares) impede a ultima linha (reagendar o proximo
      // requestAnimationFrame) de rodar -- o loop inteiro morre
      // silenciosamente: notas param de ser marcadas como perdidas e o
      // jogo parece "travado" mesmo continuando a receber cliques/toques.
      try {
        runExpiredNotesFrame();
      } catch (err) {
        console.error('[main] erro no loop de notas expiradas (ignorado, loop continua):', err);
      } finally {
        expiredNotesLoopId = requestAnimationFrame(loop);
      }
    }

    function runExpiredNotesFrame() {
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
            // Etapa 13D Parte 2: so REPASSA o mesmo outcome ('MISS') que
            // ja acionou o feedback visual acima para o efeito sonoro --
            // nenhuma logica de MISS nova. Se o navegador tiver
            // bloqueado o audio, playForOutcome so devolve false; nunca
            // lanca e nunca interrompe este loop.
            SoundEffectsController.playForOutcome('MISS');
          });
          if (localPlayerState) {
            FeedbackRenderer.updateScore(currentSlot, localPlayerState.score);
            FeedbackRenderer.updateCombo(currentSlot, localPlayerState.combo);
          }
        }
      }

      // ETAPA 14C: avanca o Bot no MESMO frame/relogio sincronizado
      // acima (getSyncedNow(), nunca Date.now() dentro do Bot -- ver
      // botMatchController.js) -- nenhum setTimeout/setInterval novo
      // por nota nem no total; quem decide o ritmo e este MESMO loop de
      // requestAnimationFrame que ja processa as notas expiradas do
      // jogador humano. Nao mexe na timeline nem no PlayerState do
      // jogador -- so no PROPRIO PlayerState do Bot, exibido na area
      // reaproveitada do player2 (FeedbackRenderer, mesmo mecanismo ja
      // usado para o jogador local).
      if (isBotMode && botMatch) {
        const botExecutedNow = BotMatchController.tick(botMatch, getSyncedNow());

        // ETAPA 14C — PARTE 2: feedback visual de CADA acerto/erro do
        // Bot nesta partida (PERFECT/GREAT/GOOD/MISS/ERRO) -- so
        // REPASSA, via FeedbackRenderer (mesmo mecanismo/area do
        // player2 ja usado para score/combo), o `outcome` que
        // BotController ja decidiu (Etapa 14B) e que BotMatchController.tick
        // acabou de aplicar ao PlayerState do Bot acima. Nenhum
        // julgamento novo e calculado aqui. O Bot nunca chama
        // NoteEngine.setNoteState (ver botMatchController.js) -- a nota
        // visual exibida em player2-playfield (mesmo `note.id`, ja
        // desenhada nos dois lados pelo NoteRenderer) so recebe um
        // "flash" transitorio, sem afetar a timeline real do jogador.
        if (botExecutedNow && botExecutedNow.length > 0) {
          botExecutedNow.forEach((decision) => {
            FeedbackRenderer.showJudgement('player2', decision.outcome);
            if (
              decision.outcome === 'PERFECT' ||
              decision.outcome === 'GREAT' ||
              decision.outcome === 'GOOD'
            ) {
              FeedbackRenderer.flashNote('player2', decision.noteId, 'HIT');
            } else if (decision.outcome === 'MISS') {
              FeedbackRenderer.flashNote('player2', decision.noteId, 'MISS');
            }
          });
        }

        FeedbackRenderer.updateScore('player2', botMatch.playerState.score);
        FeedbackRenderer.updateCombo('player2', botMatch.playerState.combo);
      }

      // Etapa 5B-4A: depois de varrer as notas expiradas acima (mesmo
      // frame, mesmo relogio sincronizado), verifica se a timeline
      // inteira ja esta concluida (todas hit/missed). checkForEnd() so
      // dispara handleLocalMatchEnd() na primeira vez que isso for
      // verdade -- chamadas seguintes (inclusive apos o loop ja ter sido
      // parado por dentro do proprio callback) nao fazem nada.
      //
      // ETAPA 15C-1C: passa getSyncedNow() -- o MESMO relogio
      // sincronizado ja usado logo acima (processExpiredNotes) e pelo
      // NoteRenderer -- para que o detector TAMBEM possa considerar a
      // duracao maxima da partida (Etapa 15C-1B), sem nenhum relogio ou
      // agendamento novo: este MESMO requestAnimationFrame (linha
      // abaixo) e que ja decide o ritmo de tudo. Quando o detector foi
      // criado sem duracao (ver startMatchGameplay), este argumento
      // simplesmente nao tem efeito (comportamento antigo, so timeline).
      if (localMatchEndDetector) {
        localMatchEndDetector.checkForEnd(getSyncedNow());
      }
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
    // ETAPA 14C: gera o resultado final do Bot assim que a partida
    // termina, reaproveitando integralmente BotMatchController.finalize
    // (Etapa 14B) -- o MESMO formato de MatchResult que o jogador
    // humano ja usa abaixo, guardado dentro do proprio `botMatch`
    // (BotMatchController.getResult).
    //
    // CORRECAO ETAPA 18: tudo o que so gera/exibe o resultado (bloco
    // abaixo) agora fica dentro de um try/catch. Antes desta correcao,
    // qualquer excecao neste trecho (ex: um elemento de UI inesperado)
    // era engolida SILENCIOSAMENTE pelo try/catch generico do loop de
    // animacao (ver startExpiredNotesLoop -- "erro no loop de notas
    // expiradas (ignorado, loop continua)"), o que interrompia esta
    // funcao NO MEIO: o MatchEndDetector ja tinha marcado a partida
    // como encerrada (nao dispara de novo), mas o codigo de limpeza
    // logo abaixo (NoteRenderer.stop/stopExpiredNotesLoop/
    // InputController.setLaneHandler(null)/SocketClient.send(
    // 'sequence_complete')) NUNCA rodava -- exatamente o sintoma
    // relatado: as setas paravam de aparecer (a timeline realmente
    // tinha acabado) mas a partida nunca "terminava de verdade" (sem
    // tela de resultado, input continuava ligado, e o servidor nunca
    // era avisado, travando inclusive a revanche). Agora a limpeza
    // roda SEMPRE (bloco `finally` abaixo), erro ou nao.
    try {
      if (isBotMode && botMatch) {
        BotMatchController.finalize(botMatch);
      }

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

      // ETAPA 14C — PARTE 2: resultado do MODO BOT (vencedor/perdedor/
      // empate + comparacao de score), exclusivo de isBotMode -- NUNCA
      // altera a regra de vencedor do Multiplayer (que continua vindo
      // exclusivamente do servidor, via match_result/setMatchOutcome
      // mais abaixo). A comparacao aqui usa apenas os DOIS scores ja
      // prontos: `result.score` (MatchResult do jogador humano, acima)
      // e `botResult.score` (BotMatchController.getResult, ja calculado
      // por MatchResult.buildResult dentro de finalize() acima) --
      // nenhuma formula de pontuacao/vencedor nova, so um `>`/`<`/`===`
      // simples entre dois numeros ja existentes.
      if (isBotMode && botMatch) {
        const botResult = BotMatchController.getResult(botMatch);
        if (botResult) {
          let botOutcome;
          if (result.score > botResult.score) botOutcome = 'win';
          else if (botResult.score > result.score) botOutcome = 'lose';
          else botOutcome = 'draw';

          ResultRenderer.setBotMatchOutcome(botOutcome);
          // ETAPA 14D — PARTE 2C: agora tambem repassa a dificuldade
          // JA escolhida nesta partida (selectedBotDifficulty) para a
          // tela de resultado exibir "Dificuldade: FÁCIL/MÉDIO/
          // DIFÍCIL" -- nenhuma dificuldade nova e decidida aqui, so
          // o MESMO identificador que ja resolveu a config do Bot em
          // startMatchGameplay (ver BotController.createConfigForDifficulty
          // acima).
          ResultRenderer.showBotMatchResult({
            playerScore: result.score,
            botScore: botResult.score,
            difficulty: selectedBotDifficulty,
          });
          UIController.logMessage(
            `Resultado do modo Bot: voce ${result.score} x ${botResult.score} Bot.`
          );
        }
      }
      // Etapa 10D: a partida terminou -- o servidor ja aceita uma nova
      // selecao de musica para a proxima Match desta sala (ex: antes
      // de uma revanche, ver rematchFlow.js), entao a interface volta
      // a ficar visivel aqui.
      musicSelectionController.reset();
      UIController.showMusicSelection();
      }
    } catch (err) {
      // CORRECAO ETAPA 18: nunca deixa este erro morrer silenciosamente
      // dentro do try/catch generico do loop de animacao -- loga aqui,
      // de forma explicita, exatamente o que quebrou ao montar/exibir
      // o resultado. O `finally` abaixo garante que a partida termina
      // de verdade (limpeza + aviso ao servidor) mesmo assim.
      console.error('[match_end] erro ao gerar/exibir o resultado (partida encerra mesmo assim):', err);
    } finally {
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
      //
      // CORRECAO ETAPA 18: movido para dentro de um `finally` -- roda
      // SEMPRE, mesmo se o bloco acima (geracao/exibicao do resultado)
      // tiver lancado uma excecao. Isso e o que garante que o servidor
      // sempre saiba que a partida acabou (nunca mais fica presa em
      // PLAYING) e que o input/loop local sempre sejam desligados.
      SocketClient.send('sequence_complete');
    }
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
    // ETAPA 14C: a partida do Bot (se havia uma) tambem acabou aqui --
    // nunca deixa uma instancia "orfa" sendo referenciada (o loop que a
    // chamaria ja parou acima de qualquer forma).
    botMatch = null;

    ResultRenderer.reset();
    rematchController.reset();
    soloRematchInFlight = false;
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
    // ETAPA 14C: mesmo motivo do reset acima -- nenhuma instancia de
    // Bot deve sobreviver a saida da sala.
    botMatch = null;

    ResultRenderer.reset();
    rematchController.reset();
    soloRematchInFlight = false;
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
    // ETAPA 14C: mesmo motivo -- de volta ao lobby, nenhum modo Bot
    // associado mais.
    isBotMode = false;
    UIController.setBotMode(false);
    // ETAPA 14D — PARTE 2B: mesmo motivo -- nenhuma dificuldade de Bot
    // escolhida sobrevive a saida da sala.
    selectedBotDifficulty = null;
    // ETAPA 15B: mesmo motivo -- nenhuma duracao escolhida sobrevive a
    // saida da sala.
    selectedMatchDuration = null;
    // ETAPA 15C-MP — Parte 4: mesmo motivo -- o painel de duracao (se
    // ainda estivesse aberto, ex: cancelamento pelo botao dedicado
    // logo abaixo ja o fecha, mas isto cobre qualquer outro caminho de
    // saida) nunca deve sobreviver a saida da sala, e nenhum contexto
    // de uma tentativa anterior ("multiplayer" de uma sala que acabou
    // de ser deixada) pode vazar para a proxima.
    UIController.hideMatchDurationSelection();
    matchDurationSelectionContext = null;
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

    // Etapa 13D Parte 2: combo ANTES desta tentativa, so para detectar
    // depois se ele realmente subiu (nunca recalculado -- PlayerState
    // continua sendo a UNICA fonte de verdade do combo; isto so LE o
    // valor que ele ja mantinha antes de handleKeyPress atualizar).
    const comboBefore = localPlayerState ? localPlayerState.combo : 0;

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
    if (result.outcome === 'PERFECT' || result.outcome === 'GREAT' || result.outcome === 'GOOD') {
      FeedbackRenderer.flashNote(currentSlot, result.noteId, 'HIT');
    }

    // Etapa 13D Parte 2: efeito sonoro do julgamento (PERFECT/GREAT/
    // GOOD/ERRO) -- so REPASSA o mesmo `result.outcome` ja usado acima
    // para o feedback visual. Bloqueio de audio pelo navegador nunca
    // interrompe o fluxo: playForOutcome so devolve false nesse caso.
    SoundEffectsController.playForOutcome(result.outcome);

    if (localPlayerState) {
      FeedbackRenderer.updateScore(currentSlot, localPlayerState.score);
      FeedbackRenderer.updateCombo(currentSlot, localPlayerState.combo);

      // Etapa 13D Parte 2: som extra e distinto quando o combo REALMENTE
      // sobe (toca por cima do som de julgamento acima, nunca no lugar
      // dele). Usa o combo que o proprio PlayerState ja atualizou dentro
      // de handleKeyPress -- nenhum combo novo e calculado aqui.
      if (localPlayerState.combo > comboBefore) {
        SoundEffectsController.playComboUp();
      }
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
    // ETAPA 14D — PARTE 2C: limpa explicitamente todo estado do modo
    // Bot desta partida ANTES de recarregar -- mesmo padrao ja usado
    // por "Criar sala"/"Entrar em sala"/"Jogar Sozinho"/"Cancelar" da
    // selecao de dificuldade (ver os handlers correspondentes mais
    // abaixo). O reload logo em seguida ja destroi este closure
    // inteiro (nenhuma variavel sobrevive de qualquer forma), mas
    // deixar a limpeza explicita aqui documenta a intencao e garante
    // o mesmo resultado mesmo que o reload deixe de existir no
    // futuro: nenhuma dificuldade escolhida numa partida contra Bot
    // pode vazar para o proximo modo iniciado (Solo, Multiplayer ou
    // um novo Bot).
    isBotMode = false;
    UIController.setBotMode(false);
    botMatch = null;
    selectedBotDifficulty = null;
    // ETAPA 15B: mesmo motivo -- nenhuma duracao escolhida numa
    // partida anterior pode vazar para o proximo modo iniciado.
    selectedMatchDuration = null;
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
      // Mesma ideia de `rematchController.requestRematch()`: ignora
      // cliques repetidos enquanto o pedido anterior ainda nao virou
      // uma partida nova (ver comentario de `soloRematchInFlight`
      // acima). `setPlayAgainWaiting(true, '')` desabilita o botao
      // imediatamente (mesmo mecanismo ja usado pelo Multiplayer) sem
      // mostrar a mensagem "Aguardando o outro jogador...", que nao
      // faz sentido aqui (nao ha oponente).
      if (soloRematchInFlight) return;
      soloRematchInFlight = true;
      ResultRenderer.setPlayAgainWaiting(true, '');
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
        // ETAPA 15C-MP — Parte 4: `room_created` tambem e o mesmo
        // evento que confirma uma sala nova criada por "Jogar
        // Sozinho"/Bot (ver server/ws/messageRouter.js#handleStartSoloMatch),
        // que ja escolheram a duracao ANTES de enviar `start_solo_match`
        // (isSoloMode/isBotMode ja estao `true` nesse momento, ver os
        // handlers de clique mais abaixo) -- para esses dois, o painel
        // ja foi mostrado e fechado, e nao deve reabrir aqui. Somente
        // o multiplayer real ("Criar Sala", sem nenhum dos dois modos
        // ligado) ainda precisa da escolha, e so agora, com a sala de
        // fato criada, e que faz sentido pedi-la -- reutilizando o
        // MESMO painel (`showMatchDurationSelection`/
        // `hideMatchDurationSelection`) que Solo/Bot ja usam.
        if (!isSoloMode && !isBotMode) {
          matchDurationSelectionContext = 'multiplayer';
          UIController.showMatchDurationSelection();
        }
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
        soloRematchInFlight = false;
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
        // ETAPA 14C: mesmo motivo -- nenhuma instancia de Bot sobrevive
        // a uma partida cancelada.
        botMatch = null;
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
        // match_abandoned).
        //
        // ETAPA 13F — PARTE 2: alem do log, agora tambem preenchemos o
        // bloco de vencedor/perdedor/empate da tela de resultado
        // (ResultRenderer.setMatchOutcome) -- nenhuma logica NOVA de
        // decisao de vencedor e criada aqui, so uma TRADUCAO do que o
        // servidor ja decidiu (`message.winner`/`message.loser`/
        // `message.result`, ver server/match/matchOutcome.js, inalterado)
        // para o ponto de vista do jogador local (comparando com
        // `currentSlot`, que so este cliente conhece).
        NoteRenderer.stop();
        stopExpiredNotesLoop();
        InputController.setLaneHandler(null);
        // ETAPA 12A: no modo Solo o servidor nao envia result/winner/
        // loser (nao ha oponente para comparar -- ver
        // matchFlow.finishMatch) -- so as estatisticas de player1, ja
        // mostradas pelo resultado local (handleLocalMatchEnd). Nao
        // mostrar vencedor/perdedor/empate aqui (o Modo Teste tambem
        // cai aqui, ja que localServerSimulator so replica o fluxo
        // Solo -- ver localServerSimulator.js).
        if (message.mode === 'solo') {
          UIController.logMessage('Resultado oficial do servidor confirmado (modo Solo).');
        } else if (message.result === 'draw') {
          ResultRenderer.setMatchOutcome('draw');
          UIController.logMessage('Resultado oficial do servidor: empate.');
        } else {
          ResultRenderer.setMatchOutcome(message.winner === currentSlot ? 'win' : 'lose');
          UIController.logMessage(`Resultado oficial do servidor: ${message.winner} venceu.`);
        }
        break;

      case 'sequence_check_result':
        console.log('[sequence_check_result]', message);
        UIController.logMessage(
          message.identical
            ? 'SEQUENCIAS IDENTICAS ✓ (ver console para detalhes)'
            : 'SEQUENCIAS DIFERENTES ✗ (ver console para detalhes)'
        );
        break;

      case 'opponent_note_event': {
        // ETAPA 19: alem do log, agora tambem refletimos o placar/combo
        // do adversario na tela dele (`${opponentSlot}-score` /
        // `${opponentSlot}-combo`, ja existentes no index.html — ver
        // FeedbackRenderer). Ate aqui este handler so logava a mensagem
        // e o placar do oponente ficava sempre zerado na tela, porque
        // nada chamava FeedbackRenderer.updateScore/updateCombo para o
        // slot dele. O servidor (gameplayFlow.js) ja manda `score` em
        // note_hit e `combo` em ambos os eventos — so precisavamos usar
        // esses campos aqui. Nenhum calculo novo de pontuacao/combo e
        // feito no cliente: os valores vem prontos do servidor, fonte
        // de verdade oficial (mesma logica ja usada para o jogador
        // local).
        console.log('[opponent_note_event]', message);
        const opponentSlot = message.slot;
        if (opponentSlot) {
          if (Number.isFinite(message.score)) {
            FeedbackRenderer.updateScore(opponentSlot, message.score);
          }
          if (Number.isFinite(message.combo)) {
            FeedbackRenderer.updateCombo(opponentSlot, message.combo);
          }
        }
        UIController.logMessage(
          `Oponente: ${message.event}${message.judgement ? ` (${message.judgement})` : ''} — combo ${message.combo}`
        );
        break;
      }

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

        // CORRECAO "Jogar Novamente": se o servidor rejeitou um pedido
        // de nova partida (Solo/Bot: `start_solo_match` respondido com
        // "Ja existe uma partida solo em andamento"; Multiplayer:
        // `rematch_ready` respondido com "Nao e possivel pedir revanche
        // com uma partida em andamento", ex: o adversario ainda nao
        // terminou a propria timeline), o botao precisa voltar a ficar
        // clicavel -- sem isso ele ficava desabilitado PARA SEMPRE (nada
        // mais o reabilitava), impedindo qualquer nova tentativa.
        // rematchController.reset()/soloRematchInFlight=false sao
        // seguros de chamar mesmo quando o erro nao tinha nada a ver com
        // revanche (idempotente, mesmo racicionio de todo outro reset
        // "amplo" ja usado neste arquivo, ex: handleMatchAbandoned).
        rematchController.reset();
        soloRematchInFlight = false;
        ResultRenderer.setPlayAgainWaiting(false);
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
    soloRematchInFlight = false;
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

    // ETAPA 15C-1C/15C-1D/15C-MP — Parte 2 (movido para ANTES da timeline
    // nesta Etapa 16-2B, sem nenhuma segunda resolucao): resolve o MESMO
    // `resolvedMatchDurationMs` usado mais abaixo pelo Bot e pelo
    // MatchEndDetector -- ver os comentarios detalhados originais deste
    // calculo logo adiante, no bloco do Bot. So foi reposicionado para
    // que este UNICO valor ja calculado possa tambem ser repassado a
    // MatchTimelineManager.ensureTimeline logo abaixo (item 3 da Etapa
    // 16-2B: "reutilize o resolvedMatchDurationMs que ja existe", "nao
    // crie uma segunda resolucao da duracao"). O calculo em si continua
    // exatamente o mesmo, sem nenhuma alteracao de logica.
    const resolvedMatchDurationMs = MatchDuration.resolveMatchDuration(
      ClientConfig.MATCH_DURATION_MS,
      selectedMatchDuration
    ) ?? (typeof message.match.durationMs === 'number' ? message.match.durationMs : null);

    // ETAPA 19: a curva de dificuldade estatica (ClientConfig.
    // DIFFICULTY_PROGRESSION.STAGES) foi desenhada para o padrao-base
    // MAIS CURTO do catalogo (16 notas, ~10-15s) -- exatamente a duracao
    // de uma partida ANTES de existir selecao de duracao. Com partidas
    // de ate 10 minutos (Etapa 16-2B/generateExtendedTimeline repetindo
    // o mesmo padrao ciclicamente), usar essa curva sem ajuste faz a
    // velocidade atingir o teto (MAX_SPEED_MULTIPLIER) logo nas
    // primeiras ~16 notas e ficar PARADA nesse teto pelo resto da
    // partida, por mais longa que ela seja -- o mesmo comportamento
    // "baixinho por muito tempo" (relativo a duracao real escolhida)
    // que motivou esta etapa.
    //
    // Correcao: quando ha uma duracao de partida configurada
    // (`resolvedMatchDurationMs`), primeiro estimamos quantas notas essa
    // duracao vai exigir (NoteEngine.computeNoteCountForDuration, SEM
    // estagios -- so uma estimativa em velocidade base, ja que os
    // estagios que queremos calcular dependem dessa estimativa) e depois
    // escalamos a curva original proporcionalmente a essa quantidade
    // (NoteEngine.buildScaledDifficultyStages) -- MESMOS multiplicadores
    // de sempre, so espalhados ao longo de toda a partida em vez de so
    // do inicio. Sem duracao configurada (Modo Teste/Multiplayer/Solo/Bot
    // sem selecao), `resolvedMatchDurationMs` e null e usamos a curva
    // original sem nenhuma alteracao -- comportamento IDENTICO ao de
    // antes desta etapa.
    let timelineDifficultyStages = ClientConfig.DIFFICULTY_PROGRESSION.STAGES;
    if (Number.isFinite(resolvedMatchDurationMs) && resolvedMatchDurationMs > 0) {
      const estimatedTotalNotes = NoteEngine.computeNoteCountForDuration({
        length: pattern.length,
        noteIntervalMs: pattern.noteIntervalMs,
        leadInMs: pattern.leadInMs,
        durationMs: resolvedMatchDurationMs,
      });
      timelineDifficultyStages = NoteEngine.buildScaledDifficultyStages(
        ClientConfig.DIFFICULTY_PROGRESSION.STAGES,
        estimatedTotalNotes
      );
    }

    const timeline = MatchTimelineManager.ensureTimeline({
      seed: message.match.seed,
      startTimestamp: message.startTimestamp,
      length: pattern.length,
      noteRange: pattern.noteRange,
      noteIntervalMs: pattern.noteIntervalMs,
      leadInMs: pattern.leadInMs,
      // ETAPA 13E/19: mesma configuracao centralizada para QUALQUER modo
      // (Multiplayer/Solo/Teste) -- startMatchGameplay e o UNICO ponto
      // de entrada que monta a timeline em todos eles, entao nenhum
      // modo pode ficar com um comportamento de dificuldade diferente
      // dos outros por acidente. Agora escalada pela duracao real da
      // partida (ver comentario acima) quando houver uma configurada.
      difficultyStages: timelineDifficultyStages,
      // ETAPA 16-2B: MESMO `resolvedMatchDurationMs` usado pelo
      // MatchEndDetector abaixo (ver bloco do Bot/MatchEndDetector) --
      // nenhuma segunda fonte de duracao. Quando `null` (Modo
      // Teste/Multiplayer/Solo/Bot sem duracao configurada), o
      // MatchTimelineManager preserva o comportamento antigo (timeline-base
      // normal, sem extensao) -- ver matchTimelineManager.js.
      durationMs: resolvedMatchDurationMs,
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
        greatMs: ClientConfig.JUDGEMENT_WINDOWS.GREAT_MS,
        goodMs: ClientConfig.JUDGEMENT_WINDOWS.GOOD_MS,
      },
      scoreValues: ClientConfig.SCORE_VALUES,
      // ETAPA 13C: multiplicador de combo e penalizacoes de MISTAKE/MISS,
      // ambos centralizados em ClientConfig -- ver client/js/config.js.
      comboMultiplierTiers: ClientConfig.COMBO_MULTIPLIER.TIERS,
      penalties: ClientConfig.PENALTIES,
      sendEvent: SocketClient.send,
    });

    // ETAPA 15C-1C / 15C-1D / 15C-MP — Parte 2: resolucao de
    // `resolvedMatchDurationMs` (identificador escolhido pelo jogador ->
    // ms via MatchDuration.resolveMatchDuration + ClientConfig.
    // MATCH_DURATION_MS, com fallback para `message.match.durationMs` do
    // Multiplayer real) FOI MOVIDA para ANTES da timeline acima nesta
    // Etapa 16-2B, para que MatchTimelineManager.ensureTimeline tambem
    // possa reaproveitar o MESMO valor (ver comentario completo no local
    // original da resolucao, logo acima, junto da timeline). O calculo
    // em si nao mudou -- so o ponto onde ele acontece.
    //
    // ETAPA 14C/14D: cria o Bot desta partida SOMENTE quando isBotMode.
    // Reaproveita a MESMA instancia de `timeline` acima (nunca uma
    // copia/segunda geracao) e as MESMAS janelas/pontuacao/penalidades
    // ja usadas pelo GameplayEngine do jogador humano logo acima --
    // nenhum sistema de pontuacao/julgamento novo. BotMatchController
    // ja cria o PROPRIO PlayerState do Bot internamente (nunca
    // reaproveitando `playerState`, que e exclusivamente do jogador
    // humano) -- ver client/js/match/botMatchController.js.
    //
    // ETAPA 14D — PARTE 2B: `config` agora resolve o preset de
    // dificuldade escolhido pelo jogador (`selectedBotDifficulty`,
    // "EASY"/"MEDIUM"/"HARD") via
    // BotController.createConfigForDifficulty (Etapa 14D-2A) --
    // exatamente a mesma ponte ja pronta desde aquela parte, so
    // finalmente chamada com um identificador de verdade (antes,
    // nada chamava esta funcao e o Bot sempre usava DEFAULT_CONFIG).
    // Nenhum parametro novo, nenhum segundo sistema de configuracao.
    botMatch = null;
    if (isBotMode) {
      const botConfig = BotController.createConfigForDifficulty(
        ClientConfig.BOT_DIFFICULTY_PRESETS,
        selectedBotDifficulty
      );

      botMatch = BotMatchController.createBotMatch({
        timeline,
        config: botConfig,
        windows: {
          perfectMs: ClientConfig.JUDGEMENT_WINDOWS.PERFECT_MS,
          greatMs: ClientConfig.JUDGEMENT_WINDOWS.GREAT_MS,
          goodMs: ClientConfig.JUDGEMENT_WINDOWS.GOOD_MS,
        },
        scoreValues: ClientConfig.SCORE_VALUES,
        comboMultiplierTiers: ClientConfig.COMBO_MULTIPLIER.TIERS,
        penalties: ClientConfig.PENALTIES,
        // ETAPA 15C-1D: MESMO valor resolvido acima (resolvedMatchDurationMs),
        // repassado adiante -- BotMatchController ja sabia armazenar
        // este campo desde a Etapa 15A (PARTE 1), so ninguem preenchia
        // com um valor de verdade ainda. Nao altera dificuldade/
        // reactionTime/mistakeChance/judgement/PlayerState/score/combo:
        // quem efetivamente encerra a partida por tempo continua sendo
        // SOMENTE o localMatchEndDetector abaixo (ver item 4 do
        // enunciado) -- o Bot so para de agir porque o loop inteiro para
        // quando handleLocalMatchEnd roda, nunca por conta propria.
        durationMs: resolvedMatchDurationMs,
      });

      // Area do Bot (Etapa 14C, item 7): reaproveita a MESMA estrutura
      // visual/mecanismo do player2 (FeedbackRenderer, ja usado para o
      // jogador local) para mostrar "BOT" com score/combo zerados desta
      // nova partida -- nenhum elemento novo, nenhum sistema visual
      // paralelo.
      FeedbackRenderer.reset('player2');
      FeedbackRenderer.updateScore('player2', botMatch.playerState.score);
      FeedbackRenderer.updateCombo('player2', botMatch.playerState.combo);
      // ETAPA 14D — PARTE 2B: garante que o rotulo "BOT — <DIFICULDADE>"
      // (ver UIController.setBotMode) esteja correto mesmo numa
      // revanche (Jogar Novamente), quando este bloco roda de novo sem
      // passar por nenhum clique novo de selecao de dificuldade.
      UIController.setBotMode(true, selectedBotDifficulty);
    }

    InputController.setLaneHandler(handleLanePressed);

    // Etapa 5B-4A: uma instancia nova do detector de fim de partida,
    // ligada a ESTA timeline (a mesma usada acima pelo GameplayEngine).
    // Criar de novo aqui, a cada partida, e o que garante o reset
    // correto entre partidas -- nao ha estado global "encerrado"
    // sobrando de uma partida anterior.
    //
    // ETAPA 15C-1C/15C-1D: `durationMs`/`startTime` agora tambem sao
    // passados (ver matchEndDetector.js, Etapa 15C-1B). `startTime` e
    // `message.startTimestamp` -- o MESMO timestamp, vindo do servidor,
    // que ja monta a timeline acima (MatchTimelineManager.ensureTimeline)
    // -- nunca um segundo relogio. `durationMs` e `resolvedMatchDurationMs`
    // (calculado acima, ANTES do bloco do Bot, e reutilizado por ele) --
    // o MESMO valor para Solo, Bot E, desde a ETAPA 15C-MP — Parte 2,
    // tambem para o Multiplayer real (nesse caso vindo de
    // `message.match.durationMs`, ja resolvido pelo servidor -- ver
    // comentario acima). Quando `resolvedMatchDurationMs` e `null`
    // (Modo Teste/Solo/Bot/Multiplayer sem nenhuma duracao configurada
    // para aquela Match), o detector recebe `durationMs: null` e se
    // comporta exatamente como antes (ver Etapa 15C-1B: sem os tres
    // ingredientes, `hasReachedMatchDuration` sempre devolve `false`).
    // Este UNICO detector encerra a partida local inteira, em QUALQUER
    // modo (Solo, Bot e Multiplayer real rodam sob o MESMO
    // GameplayEngine/loop do jogador humano) -- nenhuma segunda rotina
    // de finalizacao para nenhum deles (ver item 4 do enunciado da
    // Etapa 15C-1D/15C-MP — Parte 2): quando o limite e atingido,
    // handleLocalMatchEnd() e chamado normalmente, que ja para
    // startExpiredNotesLoop (o MESMO loop que chama BotMatchController.tick
    // e processa notas expiradas do jogador humano em qualquer modo) --
    // tudo simplesmente para de avancar, sem nenhum codigo novo por modo.
    localMatchEndDetector = MatchEndDetector.createMatchEndDetector({
      timeline,
      onMatchEnd: handleLocalMatchEnd,
      durationMs: resolvedMatchDurationMs,
      startTime: message.startTimestamp,
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
    // ETAPA 14C: multiplayer real -- garante que nenhum estado de uma
    // tentativa anterior de Bot sobrevive a esta sala nova.
    isBotMode = false;
    UIController.setBotMode(false);
    botMatch = null;
    // ETAPA 14D — PARTE 2B: mesmo motivo -- nenhuma dificuldade de Bot
    // escolhida antes sobrevive a uma sala de multiplayer real.
    selectedBotDifficulty = null;
    // ETAPA 15C-MP — Parte 4: multiplayer real agora TAMBEM usa
    // duracao (transportada pelo servidor, ver Etapa 15C-MP — Parte
    // 1/2) -- mas a escolha e feita depois, quando `room_created`
    // confirmar a sala nova (ver case 'room_created' abaixo), nunca
    // com uma selecao de uma sala anterior.
    selectedMatchDuration = null;
    matchDurationSelectionContext = null;
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
    // ETAPA 14C: mesmo motivo do "Criar sala" acima.
    isBotMode = false;
    UIController.setBotMode(false);
    botMatch = null;
    // ETAPA 14D — PARTE 2B: mesmo motivo do "Criar sala" acima.
    selectedBotDifficulty = null;
    // ETAPA 15B: mesmo motivo do "Criar sala" acima.
    selectedMatchDuration = null;
    // ETAPA 15C-MP — Parte 4: quem ENTRA em uma sala nunca escolhe a
    // duracao -- ela ja foi (ou sera) definida pelo criador da sala
    // (ver matchDurationSelectionFlow.resolveSelectedDuration no
    // servidor); este cliente so recebe o resultado via
    // `match_ready`/`match.durationMs`, exatamente como ja acontece
    // hoje. Nenhum contexto de painel e aberto aqui.
    matchDurationSelectionContext = null;
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
    // ETAPA 14C: "Jogar Sozinho" continua exatamente como antes -- isto
    // so garante que um Bot de uma tentativa anterior nunca sobrevive a
    // uma partida Solo pura (isBotMode e um estado SEPARADO, nunca
    // ligado por este botao).
    isBotMode = false;
    UIController.setBotMode(false);
    botMatch = null;
    // ETAPA 14D — PARTE 2B: mesmo motivo -- nenhuma dificuldade de Bot
    // escolhida antes sobrevive a uma partida Solo pura.
    selectedBotDifficulty = null;
    // ETAPA 15B: a partir desta parte, o clique NAO inicia mais a
    // partida diretamente -- so abre a tela "Escolha a duração da
    // partida" (ver match-duration-panel em client/index.html). O
    // envio da mensagem de rede que de fato inicia a partida continua
    // sem acontecer ate o jogador escolher (ou cancelar) uma duracao
    // logo abaixo -- mesmo padrao ja usado pela tela de dificuldade do
    // Bot (Etapa 14D-2B).
    UIController.showMatchDurationSelection();
  });

  // ETAPA 14C/14D: "Jogar contra Bot" -- botao SEPARADO de "Jogar
  // Sozinho" acima. A partir da ETAPA 14D-2B, o clique NAO inicia mais
  // a partida diretamente: so abre a tela "Escolha a dificuldade"
  // (ver bot-difficulty-panel em client/index.html). `isBotMode`
  // continua false e `start_solo_match` continua sem ser enviado ate
  // o jogador escolher (ou cancelar) uma dificuldade logo abaixo.
  document.getElementById('btn-play-bot').addEventListener('click', () => {
    UIController.showBotDifficultySelection();
  });

  // ETAPA 14D — PARTE 2B: as tres opcoes da tela "Escolha a
  // dificuldade". Cada botao so le seu proprio `data-difficulty`
  // ("EASY"/"MEDIUM"/"HARD", ver ClientConfig.BOT_DIFFICULTY) -- o
  // MESMO identificador estavel que BotController.createConfigForDifficulty
  // (Etapa 14D-2A) ja sabe resolver, nenhuma conversao para outro
  // sistema paralelo. Escolher uma opcao e o que finalmente liga
  // `isBotMode` e envia `start_solo_match` -- por baixo, reutiliza o
  // MESMO pipeline de partida que "Jogar Sozinho"/Modo Teste ja usam
  // (unica forma ja existente de obter seed/timeline sincronizadas),
  // exatamente como a Etapa 14C ja fazia antes desta tela existir.
  document.querySelectorAll('#bot-difficulty-panel [data-difficulty]').forEach((button) => {
    button.addEventListener('click', () => {
      const difficulty = button.dataset.difficulty;
      isBotMode = true;
      selectedBotDifficulty = difficulty;
      UIController.setBotMode(true, difficulty);
      UIController.hideBotDifficultySelection();
      // ETAPA 15B: a partir desta parte, escolher uma dificuldade NAO
      // inicia mais a partida diretamente -- so abre, em seguida, a
      // tela "Escolha a duração da partida" (ver match-duration-panel
      // em client/index.html). O envio da mensagem de rede que de
      // fato inicia a partida continua sem acontecer ate o jogador
      // escolher (ou cancelar) uma duracao logo abaixo.
      UIController.showMatchDurationSelection();
    });
  });

  // ETAPA 14D — PARTE 2B: "Cancelar" na tela "Escolha a dificuldade".
  // So fecha o painel -- nenhuma partida e iniciada, `isBotMode`
  // continua false, `botMatch` continua null e `selectedBotDifficulty`
  // e limpo (nunca sobrevive a um cancelamento).
  document.getElementById('btn-bot-difficulty-cancel').addEventListener('click', () => {
    UIController.hideBotDifficultySelection();
    isBotMode = false;
    UIController.setBotMode(false);
    botMatch = null;
    selectedBotDifficulty = null;
  });

  // ETAPA 15B: as quatro opcoes da tela "Escolha a duração da
  // partida" (ver match-duration-panel em client/index.html), aberta
  // pelos dois pontos de entrada acima ("Jogar Sozinho" e a escolha de
  // dificuldade do Bot). Cada botao so le seu proprio `data-duration`
  // ("30S"/"1M"/"5M"/"10M", ver ClientConfig.MATCH_DURATION_IDS em
  // client/js/config.js) -- o MESMO identificador estavel que
  // MatchDuration.resolveMatchDuration (Etapa 15A) ja sabe resolver,
  // nenhuma conversao para outro sistema paralelo. So aceita um
  // identificador VALIDO (presente em ClientConfig.MATCH_DURATION_MS)
  // -- qualquer outro valor e ignorado silenciosamente, sem guardar
  // nada nem iniciar partida.
  //
  // IMPORTANTE: esta etapa e SOMENTE selecao e armazenamento. Nenhum
  // timer/encerramento por tempo e criado aqui -- `isSoloMode`/
  // `isBotMode`/`selectedBotDifficulty` ja foram definidos por quem
  // abriu este painel (o proprio clique so finalmente libera o envio
  // de `start_solo_match`, reutilizando o MESMO pipeline de partida
  // que Solo/Bot/Modo Teste ja usam).
  // ETAPA 15C-MP — Parte 4: o mesmo clique agora se comporta de forma
  // diferente dependendo de QUEM abriu o painel
  // (`matchDurationSelectionContext`, definido pelos tres pontos de
  // entrada: "Jogar Sozinho", escolha de dificuldade do Bot, ou
  // `room_created` do multiplayer real acima) -- sem duplicar a
  // validacao do `durationId` (continua exatamente a mesma para os
  // dois casos, feita uma unica vez logo abaixo).
  document.querySelectorAll('#match-duration-panel [data-duration]').forEach((button) => {
    button.addEventListener('click', () => {
      const durationId = button.dataset.duration;
      if (!Object.prototype.hasOwnProperty.call(ClientConfig.MATCH_DURATION_MS, durationId)) {
        return;
      }
      UIController.hideMatchDurationSelection();

      if (matchDurationSelectionContext === 'multiplayer') {
        // A sala ja existe (criada por "Criar Sala" antes deste painel
        // abrir, ver case 'room_created' acima) -- nenhuma partida e
        // iniciada por este clique. So envia a escolha pelo fluxo
        // Multiplayer ja preparado (`select_duration`, Etapa 15C-MP —
        // Parte 1); o servidor confirma com `duration_selected` (ja
        // logado, se quisermos, mas nenhum case novo e necessario aqui
        // -- a duracao efetiva chega para os dois jogadores em
        // `match_ready`/`match.durationMs` quando a sala ficar cheia).
        // `selectedMatchDuration` (usado SOMENTE por Solo/Bot dentro de
        // startMatchGameplay) permanece `null`, exatamente como ja
        // documentado la.
        UIController.logMessage(`Duracao selecionada: ${durationId}. Aguardando o oponente...`);
        SocketClient.send('select_duration', { durationId });
        matchDurationSelectionContext = null;
        return;
      }

      selectedMatchDuration = durationId;
      matchDurationSelectionContext = null;
      SocketClient.send('start_solo_match');
    });
  });

  // ETAPA 15B: "Cancelar" na tela "Escolha a duração da partida". So
  // fecha o painel -- nenhuma partida e iniciada. Tambem desfaz
  // qualquer modo otimisticamente ligado por quem abriu este painel
  // (isSoloMode pelo clique em "Jogar Sozinho", ou isBotMode/
  // selectedBotDifficulty pela escolha de dificuldade do Bot) --
  // mesmo espirito do cancelamento da tela de dificuldade do Bot
  // acima: nenhum estado de uma tentativa cancelada sobrevive.
  document.getElementById('btn-match-duration-cancel').addEventListener('click', () => {
    UIController.hideMatchDurationSelection();
    // ETAPA 15C-MP — Parte 4: no contexto multiplayer a sala JA existe
    // no servidor (criada por "Criar Sala" antes deste painel abrir,
    // ver case 'room_created' acima) -- diferente de Solo/Bot (onde
    // cancelar so desfaz um estado otimista local, sem nenhuma sala
    // criada ainda). Cancelar aqui significa desistir da sala tambem,
    // reutilizando o MESMO handshake ja usado pelo botao "Sair da
    // sala" (leaveRoomController.requestLeave -- garante um unico
    // `leave_room`, e handleLeftRoom, chamado quando o servidor
    // confirmar, ja devolve a UI inteira ao lobby). Sem isso, a sala
    // ficaria presa aguardando um oponente sem nenhuma forma de
    // desistir dela.
    const wasMultiplayer = matchDurationSelectionContext === 'multiplayer';
    selectedMatchDuration = null;
    matchDurationSelectionContext = null;
    isSoloMode = false;
    UIController.setSoloMode(false);
    isBotMode = false;
    UIController.setBotMode(false);
    botMatch = null;
    selectedBotDifficulty = null;
    if (wasMultiplayer) {
      leaveRoomController.requestLeave();
    }
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

  // Etapa 13D Parte 2 (item 3 do enunciado): navegadores -- em especial
  // no celular -- so deixam audio tocar depois de um gesto do jogador.
  // Um UNICO listener, removido apos disparar uma vez (`{ once: true }`),
  // cobrindo clique, toque e teclado (o que vier primeiro), tentando
  // destravar o AudioContext dos efeitos sonoros. Se o navegador negar
  // mesmo assim, SoundEffectsController.unlock() so devolve false -- o
  // jogo continua funcionando normalmente, sem som, sem travar nada.
  const unlockAudioOnce = () => SoundEffectsController.unlock();
  document.addEventListener('pointerdown', unlockAudioOnce, { once: true });
  document.addEventListener('keydown', unlockAudioOnce, { once: true });
  document.addEventListener('touchstart', unlockAudioOnce, { once: true, passive: true });

  SocketClient.connect();
})();
