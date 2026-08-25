/**
 * Camada visual das notas (Etapa 5B-2B).
 *
 * Este modulo NAO gera notas, NAO julga notas, NAO calcula pontuacao/combo
 * e NAO decide PERFECT/GOOD/MISS. Ele apenas LE a timeline que ja existe
 * (gerada por NoteEngine/MatchTimelineManager nas etapas anteriores) e
 * desenha/move elementos visuais no DOM com base nela.
 *
 * Fluxo de dados (nenhuma posicao trafega pela rede):
 *
 *   seed + startTimestamp
 *     -> MatchTimelineManager (ja existente)
 *     -> timeline local (ja existente)
 *     -> NoteRenderer (este arquivo): apenas LE note.id/note.lane/note.time
 *        e calcula a posicao visual localmente, com base no relogio
 *        sincronizado da partida (mesma tecnica de clockOffset usada por
 *        MatchController: offset = serverTime_do_servidor - Date.now()
 *        no momento em que o offset foi capturado). Dois clientes com o
 *        mesmo (seed, startTimestamp) e um clockOffset calculado da mesma
 *        forma chegam a mesma posicao para a mesma nota no mesmo instante.
 *
 * O julgamento (PERFECT/GOOD/MISS) continua inteiramente a cargo do
 * GameplayEngine ja existente, que le/muta a MESMA timeline por fora
 * deste modulo. Este modulo so LE `note.state` (nunca escreve) para
 * decidir quando e seguro remover o elemento visual de uma nota.
 *
 * Cada nota gerada e desenhada nas DUAS colunas (.player1-playfield e
 * .player2-playfield): a timeline e unica por cliente (mesma seed +
 * mesmo startTimestamp para os dois jogadores), entao a mesma sequencia
 * de notas "cai" visualmente nos dois lados da tela, exatamente como
 * definido pela Etapa 5A-1 (layout ja existente, 3 lanes por jogador).
 * Isso e so exibicao -- GameplayEngine.handleKeyPress continua avaliando
 * apenas o input do jogador LOCAL contra a mesma timeline unica.
 */
const NoteRenderer = (() => {
  const isNode = typeof module !== 'undefined' && module.exports;
  const isBrowser = typeof document !== 'undefined';
  const NoteEngineRef = isNode ? require('../match/noteEngine') : NoteEngine;
  const ClientConfigRef = isNode ? require('../config') : ClientConfig;

  // ---- Constantes puramente visuais (nao afetam julgamento nenhum) ----
  // Quanto tempo (ms) antes do tempo exato da nota ela comeca a "cair"
  // visualmente, do topo da lane ate o final do percurso. ETAPA 13B:
  // deixou de ser uma constante local -- agora vem de ClientConfig
  // (NOTE_TRAVEL_MS), a MESMA usada pela janela de julgamento
  // (ClientConfig.NOTE_HIT_WINDOW_MS/JUDGEMENT_WINDOWS.GOOD_MS), para
  // garantir que a seta so pode ser considerada "acertavel" exatamente
  // durante o trecho em que ela esta visivelmente caindo na tela.
  const NOTE_TRAVEL_MS = ClientConfigRef.NOTE_TRAVEL_MS;
  // Posicao (em % da altura da lane-track) onde fica o final do
  // percurso. ETAPA 13B: a nota agora desce ate perto do limite
  // inferior da lane (nao mais uma "linha de julgamento" no meio do
  // caminho) -- ela pode ser acertada em QUALQUER ponto da queda, e so
  // e considerada perdida ao chegar aqui, no note.time.
  const HIT_LINE_PERCENT = 96;
  // Margem extra (ms), somada a janela de julgamento (hitWindowMs), antes
  // de remover do DOM uma nota que por algum motivo ainda nao virou
  // hit/missed -- garante que o GameplayEngine sempre teve chance de
  // processa-la antes do elemento visual sumir.
  const REMOVE_BUFFER_MS = 250;
  // Quanto antes do "spawn" comecamos a procurar/criar o elemento (evita
  // recalcular a cada frame antes da hora sem necessidade nenhuma).
  const PRE_SPAWN_MS = 50;

  const PLAYER_SLOTS = ['player1', 'player2'];

  let animationFrameId = null;
  let renderToken = 0;
  let activeTimeline = null;
  let clockOffsetMs = 0;
  let hitWindowMs = 0;
  let laneTracksByPlayer = null; // { player1: {1:el,2:el,3:el}, player2: {...} }
  let noteElements = new Map(); // noteId -> { player1: el|null, player2: el|null }

  // ---------------------------------------------------------------------
  // Funcoes PURAS (sem DOM) -- testaveis em Node isoladamente.
  // ---------------------------------------------------------------------

  /**
   * "Agora", no mesmo relogio de referencia do servidor usado pelo
   * startTimestamp da timeline (mesma ideia do MatchController).
   */
  function estimateSyncedNow(localNow, offsetMs) {
    return localNow + offsetMs;
  }

  /**
   * Progresso da queda da nota: 0 = acabou de nascer (topo da lane),
   * 1 = exatamente na linha de julgamento (note.time). Pode passar de 1
   * enquanto a nota ainda nao foi removida.
   */
  function computeProgress(note, syncedNow, travelMs) {
    const spawnTime = note.time - travelMs;
    return (syncedNow - spawnTime) / travelMs;
  }

  /**
   * Posicao vertical (top, em % da altura da lane-track) de uma nota no
   * instante `syncedNow`. Nunca negativa (uma nota nao criada antes do
   * spawn nao deveria ser posicionada acima do topo) e NUNCA maior que
   * hitLinePercent -- a nota para visualmente no "quadrado"/hit-zone
   * (note.time) mesmo que syncedNow continue avancando enquanto o
   * elemento ainda nao foi removido (ver REMOVE_BUFFER_MS/
   * shouldRemoveNote acima, que da uma margem antes de tirar do DOM).
   */
  function computeTopPercent(note, syncedNow, travelMs, hitLinePercent) {
    const progress = computeProgress(note, syncedNow, travelMs);
    return Math.min(hitLinePercent, Math.max(0, progress * hitLinePercent));
  }

  /**
   * Uma nota so pode ser removida do DOM quando:
   * - ja esta em estado final (hit/missed) -- o GameplayEngine ja a
   *   processou, entao remover agora nao afeta o julgamento; OU
   * - o tempo ja passou da janela de julgamento + uma margem de
   *   seguranca -- ou seja, o GameplayEngine.processExpiredNotes ja
   *   teve tempo de sobra para marca-la como "missed" (isso e feito em
   *   outro lugar do codigo, nao aqui).
   *
   * Nunca decide isso ANTES da nota ter tido chance de ser julgada.
   */
  function shouldRemoveNote(note, syncedNow, hitWindowMs_, removeBufferMs, isTerminalFn) {
    if (isTerminalFn(note.state)) return true;
    return syncedNow > note.time + hitWindowMs_ + removeBufferMs;
  }

  /**
   * Se, no instante atual, essa nota ja deveria ter um elemento visual
   * criado (esta perto o suficiente do seu horario de nascer).
   */
  function shouldSpawnNote(note, syncedNow, travelMs, preSpawnMs) {
    return syncedNow >= note.time - travelMs - preSpawnMs;
  }

  // ---------------------------------------------------------------------
  // Funcoes de DOM -- so existem/rodam no navegador.
  // ---------------------------------------------------------------------

  function queryLaneTracks() {
    const result = {};
    PLAYER_SLOTS.forEach((slot) => {
      const playfield = document.getElementById(`${slot}-playfield`);
      result[slot] = { 1: null, 2: null, 3: null };
      if (!playfield) return;

      [1, 2, 3].forEach((lane) => {
        result[slot][lane] = playfield.querySelector(`[data-lane-track="${lane}"]`);
      });
    });
    return result;
  }

  /**
   * Cria (se ainda nao existir) a faixa/area de julgamento dentro de
   * cada lane-track. E so um marcador visual -- nenhuma logica de
   * PERFECT/GOOD/MISS mora aqui.
   */
  function ensureHitZones(laneTracks) {
    PLAYER_SLOTS.forEach((slot) => {
      [1, 2, 3].forEach((lane) => {
        const trackEl = laneTracks[slot][lane];
        if (!trackEl) return;
        if (trackEl.querySelector('.hit-zone')) return;

        const hitZone = document.createElement('div');
        hitZone.className = 'hit-zone';
        hitZone.style.top = `${HIT_LINE_PERCENT}%`;
        trackEl.appendChild(hitZone);
      });
    });
  }

  function createNoteElement(note) {
    const els = {};
    PLAYER_SLOTS.forEach((slot) => {
      const trackEl = laneTracksByPlayer[slot] && laneTracksByPlayer[slot][note.lane];
      if (!trackEl) {
        els[slot] = null;
        return;
      }
      const div = document.createElement('div');
      div.className = 'falling-note';
      div.dataset.noteId = note.id;
      div.dataset.lane = String(note.lane);
      trackEl.appendChild(div);
      els[slot] = div;
    });
    return els;
  }

  function positionNoteElement(els, topPercent) {
    PLAYER_SLOTS.forEach((slot) => {
      const el = els[slot];
      if (!el) return;
      el.style.top = `${topPercent}%`;
    });
  }

  function removeNoteElement(noteId) {
    const els = noteElements.get(noteId);
    if (!els) return;
    PLAYER_SLOTS.forEach((slot) => {
      const el = els[slot];
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
      }
    });
    noteElements.delete(noteId);
  }

  function clearAllNoteElements() {
    Array.from(noteElements.keys()).forEach(removeNoteElement);
    noteElements.clear();
  }

  // ---------------------------------------------------------------------
  // Loop de animacao.
  // ---------------------------------------------------------------------

  function tick(token) {
    // Se um stop()/start() mais recente ja invalidou este loop, para
    // silenciosamente. Isso, somado ao cancelAnimationFrame em stop(),
    // e o que garante que nunca existam dois loops rodando ao mesmo
    // tempo para a mesma partida (ou uma partida antiga "vazando" para
    // a proxima).
    if (token !== renderToken || !activeTimeline) return;

    const syncedNow = estimateSyncedNow(Date.now(), clockOffsetMs);

    for (const note of activeTimeline) {
      const remove = shouldRemoveNote(note, syncedNow, hitWindowMs, REMOVE_BUFFER_MS, NoteEngineRef.isTerminal);

      if (remove) {
        if (noteElements.has(note.id)) {
          removeNoteElement(note.id);
        }
        continue;
      }

      let els = noteElements.get(note.id);
      if (!els) {
        if (!shouldSpawnNote(note, syncedNow, NOTE_TRAVEL_MS, PRE_SPAWN_MS)) continue;
        // Lane invalida (fora de 1..3): nunca cria elemento nenhum --
        // e assim que garantimos que nenhuma nota aparece "na lane 4".
        if (!laneTracksByPlayer[PLAYER_SLOTS[0]][note.lane]) continue;
        els = createNoteElement(note);
        noteElements.set(note.id, els);
      }

      const topPercent = computeTopPercent(note, syncedNow, NOTE_TRAVEL_MS, HIT_LINE_PERCENT);
      positionNoteElement(els, topPercent);
    }

    animationFrameId = requestAnimationFrame(() => tick(token));
  }

  /**
   * Comeca a renderizar/mover a timeline de uma partida.
   *
   * @param {object} options
   * @param {Array} options.timeline - timeline ja existente (MatchTimelineManager.ensureTimeline)
   * @param {number} [options.clockOffsetMs] - offset (ms) entre o relogio
   *   deste navegador e o relogio do servidor, calculado da MESMA forma
   *   que MatchController (serverTime - Date.now() no momento em que o
   *   servidor informou o horario). Default 0 (assume relogios iguais).
   * @param {number} options.hitWindowMs - mesma janela de julgamento usada
   *   pelo NoteEngine/GameplayEngine (ex: ClientConfig.NOTE_HIT_WINDOW_MS),
   *   usada aqui apenas para saber quando e seguro remover uma nota da
   *   tela, nunca para julgar nada.
   */
  function start({ timeline, clockOffsetMs: offsetMs = 0, hitWindowMs: hitWindowMs_ }) {
    // stop() primeiro, sempre -- garante que iniciar uma partida nova
    // nunca deixa um loop antigo (de uma partida anterior) rodando
    // junto, mesmo se quem chamou esquecer de parar antes.
    stop();

    if (!isBrowser) return; // seguranca: nao ha nada pra desenhar fora do navegador
    if (!Array.isArray(timeline)) return;

    activeTimeline = timeline;
    clockOffsetMs = Number.isFinite(offsetMs) ? offsetMs : 0;
    hitWindowMs = Number.isFinite(hitWindowMs_) ? hitWindowMs_ : 0;

    laneTracksByPlayer = queryLaneTracks();
    ensureHitZones(laneTracksByPlayer);

    renderToken += 1;
    const myToken = renderToken;
    animationFrameId = requestAnimationFrame(() => tick(myToken));
  }

  /**
   * Para o loop de renderizacao, remove todas as notas visuais e limpa
   * as referencias. Chamado quando a partida termina ou e cancelada, e
   * internamente no inicio de todo start() (ver acima).
   */
  function stop() {
    // Invalida qualquer loop em voo, mesmo que cancelAnimationFrame nao
    // tenha efeito imediato por algum motivo.
    renderToken += 1;

    if (isBrowser && animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
    }
    animationFrameId = null;

    if (isBrowser) {
      clearAllNoteElements();
    } else {
      noteElements.clear();
    }

    activeTimeline = null;
    laneTracksByPlayer = null;
    clockOffsetMs = 0;
    hitWindowMs = 0;
  }

  const api = {
    start,
    stop,
    // Expostas para teste automatizado (funcoes puras, sem DOM):
    _internal: {
      estimateSyncedNow,
      computeProgress,
      computeTopPercent,
      shouldRemoveNote,
      shouldSpawnNote,
      NOTE_TRAVEL_MS,
      HIT_LINE_PERCENT,
      REMOVE_BUFFER_MS,
      PRE_SPAWN_MS,
    },
  };

  if (isNode) {
    module.exports = api;
  }

  return api;
})();
