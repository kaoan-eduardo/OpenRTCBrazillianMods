/**
 * Gerenciador de Fluxo de Visitantes para OpenRCT2
 * Versão 1.0.0
 *
 * OBJETIVO
 * -------
 * Analisar o fluxo dos visitantes e ajudar a identificar:
 *
 * - Visitantes perdidos
 * - Congestionamentos
 * - Becos sem saída problemáticos
 * - Regiões onde o caminho pode estar mal planejado
 *
 * FILOSOFIA
 * ---------
 * O plugin NÃO constrói caminhos.
 * O plugin NÃO muda o parque sozinho.
 * O plugin NÃO redireciona visitantes automaticamente por padrão.
 *
 * Ele analisa, recomenda e deixa você decidir.
 *
 * Existe uma opção de resgate automático de visitantes perdidos,
 * mas ela vem DESATIVADA por padrão.
 */

(function () {
  "use strict";

  // ============================================================
  // CONFIGURAÇÃO
  // ============================================================

  var CONFIG = {
    enabled: true,

    debugMode: false,

    // --------------------------------------------------------
    // Análise do mapa
    // --------------------------------------------------------

    autoAnalyze: true,

    /*
     * Intervalo entre atualizações leves.
     *
     * Não fazemos uma análise pesada completa toda hora.
     */
    analysisIntervalTicks: 320,

    /*
     * Quantos tiles analisamos por bloco.
     */
    analysisChunkSize: 900,

    /*
     * Tempo máximo aproximado por bloco.
     */
    analysisBudgetMs: 4,

    // --------------------------------------------------------
    // Congestionamento
    // --------------------------------------------------------

    /*
     * Dividimos o parque em pequenas regiões.
     *
     * Isso funciona melhor que olhar apenas um quadrado,
     * principalmente em caminhos duplos.
     */
    crowdCellSize: 3,

    /*
     * A partir daqui consideramos que há atenção.
     */
    crowdWarningGuests: 12,

    /*
     * A partir daqui consideramos congestionamento crítico.
     */
    crowdCriticalGuests: 22,

    /*
     * Quantos problemas mostrar na janela.
     */
    maxIssuesShown: 6,

    // --------------------------------------------------------
    // Visitantes perdidos
    // --------------------------------------------------------

    /*
     * IMPORTANTE:
     *
     * Vem desligado.
     *
     * Você continua no controle.
     */
    autoRescueLostGuests: false,

    lostCountdownThreshold: 15,

    /*
     * Se resgate automático for ativado,
     * nunca tenta mexer em centenas de visitantes de uma vez.
     */
    maxRescuesPerCycle: 4,

    /*
     * Distância para encontrar caminho próximo a uma atração.
     */
    destinationSearchRadius: 5,

    /*
     * Evita mandar visitante recuperado diretamente para
     * regiões que parecem ser a entrada do parque.
     */
    parkEntranceAvoidRadius: 6,
  };

  // ============================================================
  // DIREÇÕES
  // ============================================================

  var DIRECTIONS = [
    {
      x: 0,
      y: -1,
    },

    {
      x: 1,
      y: 0,
    },

    {
      x: 0,
      y: 1,
    },

    {
      x: -1,
      y: 0,
    },
  ];

  // ============================================================
  // FUNÇÕES BÁSICAS
  // ============================================================

  function key(x, y) {
    return x + "," + y;
  }

  function tileCoord(value) {
    return Math.floor((value || 0) / 32);
  }

  function manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  function getTick() {
    try {
      return date.ticksElapsed || 0;
    } catch (e) {
      return 0;
    }
  }

  // ============================================================
  // REDE / MULTIPLAYER
  // ============================================================

  var NetworkHelper = {
    canModifyGameState: function () {
      try {
        return network.mode === "none" || network.mode === "server";
      } catch (e) {
        return true;
      }
    },

    modeText: function () {
      try {
        if (network.mode === "server") {
          return "Multiplayer (Host)";
        }

        if (network.mode === "client") {
          return "Multiplayer (Cliente)";
        }
      } catch (e) {}

      return "Single Player";
    },
  };

  // ============================================================
  // ESTADO GLOBAL
  // ============================================================

  var State = {
    status: 'Clique em "Analisar agora" para começar.',

    lastAnalysisTick: 0,

    lastAutoAnalysisTick: 0,
  };

  // ============================================================
  // ANALISADOR DO MAPA
  // ============================================================

  var MapAnalyzer = {
    width: 0,

    height: 0,

    totalTiles: 0,

    progress: 0,

    analyzed: false,

    analyzing: false,

    /*
     * {
     *   "x,y": {
     *      walkable: true,
     *      wide: false,
     *      queue: false
     *   }
     * }
     */
    tiles: {},

    walkableList: [],

    deadEnds: [],

    parkEntrances: [],

    /*
     * Caminhos próximos de atrações.
     *
     * São usados como destino seguro para visitantes perdidos.
     */
    poiPaths: [],

    // ========================================================
    // INICIAR ANÁLISE
    // ========================================================

    start: function () {
      try {
        this.width = map.size.x;

        this.height = map.size.y;
      } catch (e) {
        this.width = 128;

        this.height = 128;
      }

      this.totalTiles = this.width * this.height;

      this.progress = 0;

      this.analyzed = false;

      this.analyzing = true;

      this.tiles = {};

      this.walkableList = [];

      this.deadEnds = [];

      this.parkEntrances = [];

      this.poiPaths = [];

      State.status = "Analisando o mapa...";

      updateUI();
    },

    // ========================================================
    // PROCESSAR BLOCO
    // ========================================================

    analyzeStep: function () {
      if (!this.analyzing || this.analyzed) {
        return true;
      }

      var startedAt = Date.now();

      var processed = 0;

      while (this.progress < this.totalTiles) {
        var x = this.progress % this.width;

        var y = Math.floor(this.progress / this.width);

        this.analyzeTile(x, y);

        this.progress++;

        processed++;

        if (processed >= CONFIG.analysisChunkSize) {
          break;
        }

        if (
          processed % 150 === 0 &&
          Date.now() - startedAt >= CONFIG.analysisBudgetMs
        ) {
          break;
        }
      }

      if (this.progress >= this.totalTiles) {
        this.finish();

        return true;
      }

      updateUI();

      return false;
    },

    // ========================================================
    // ANALISAR TILE
    // ========================================================

    analyzeTile: function (x, y) {
      var data = {
        walkable: false,

        wide: false,

        queue: false,

        edges: 0,

        entrance: false,
      };

      try {
        var tile = map.getTile(x, y);

        if (!tile) {
          return;
        }

        for (var i = 0; i < tile.numElements; i++) {
          var element = tile.getElement(i);

          if (!element) {
            continue;
          }

          if (element.type === "footpath") {
            data.walkable = true;

            data.wide = !!element.isWide;

            data.queue = !!element.isQueue;

            data.edges = typeof element.edges === "number" ? element.edges : 0;
          } else if (element.type === "entrance") {
            data.entrance = true;
          }
        }
      } catch (e) {}

      if (data.walkable) {
        this.tiles[key(x, y)] = data;

        this.walkableList.push({
          x: x,

          y: y,
        });
      }

      if (data.entrance) {
        this.parkEntrances.push({
          x: x,

          y: y,
        });
      }
    },

    // ========================================================
    // FINALIZAR
    // ========================================================

    finish: function () {
      this.computeDeadEnds();

      this.buildPoiPaths();

      this.analyzed = true;

      this.analyzing = false;

      GuestAnalyzer.update();

      IssueAnalyzer.update();

      State.status =
        "Análise concluída.\n" + "Nenhuma alteração foi feita automaticamente.";

      State.lastAnalysisTick = getTick();

      updateUI();
    },

    // ========================================================
    // O TILE É CAMINHO?
    // ========================================================

    isWalkable: function (x, y) {
      return !!this.tiles[key(x, y)];
    },

    // ========================================================
    // O CAMINHO É LARGO?
    // ========================================================

    isWide: function (x, y) {
      var data = this.tiles[key(x, y)];

      return !!(data && data.wide);
    },

    // ========================================================
    // BECOS SEM SAÍDA
    // ========================================================

    computeDeadEnds: function () {
      this.deadEnds = [];

      for (var i = 0; i < this.walkableList.length; i++) {
        var point = this.walkableList[i];

        var connections = 0;

        for (var d = 0; d < DIRECTIONS.length; d++) {
          var nx = point.x + DIRECTIONS[d].x;

          var ny = point.y + DIRECTIONS[d].y;

          if (this.isWalkable(nx, ny)) {
            connections++;
          }
        }

        /*
         * Zero ou uma conexão = fim de caminho.
         */
        if (connections <= 1) {
          this.deadEnds.push({
            x: point.x,

            y: point.y,
          });
        }
      }
    },

    // ========================================================
    // CAMINHO MAIS PRÓXIMO
    // ========================================================

    findNearestWalkable: function (origin, radius) {
      var best = null;

      var bestDistance = Infinity;

      for (var dx = -radius; dx <= radius; dx++) {
        for (var dy = -radius; dy <= radius; dy++) {
          var distance = Math.abs(dx) + Math.abs(dy);

          if (distance > radius) {
            continue;
          }

          var x = origin.x + dx;

          var y = origin.y + dy;

          if (this.isWalkable(x, y) && distance < bestDistance) {
            best = {
              x: x,

              y: y,
            };

            bestDistance = distance;
          }
        }
      }

      return best;
    },

    // ========================================================
    // PONTOS INTERESSANTES
    // ========================================================

    buildPoiPaths: function () {
      this.poiPaths = [];

      var seen = {};

      try {
        var rides = map.rides || [];

        for (var i = 0; i < rides.length; i++) {
          var ride = rides[i];

          if (!ride || !ride.stations) {
            continue;
          }

          for (var s = 0; s < ride.stations.length; s++) {
            var station = ride.stations[s];

            if (!station) {
              continue;
            }

            var rawPoints = [];

            if (station.entrance) {
              rawPoints.push(station.entrance);
            }

            if (station.exit) {
              rawPoints.push(station.exit);
            }

            for (var p = 0; p < rawPoints.length; p++) {
              var position = {
                x: tileCoord(rawPoints[p].x),

                y: tileCoord(rawPoints[p].y),
              };

              var nearest = this.findNearestWalkable(
                position,

                CONFIG.destinationSearchRadius,
              );

              if (!nearest) {
                continue;
              }

              var locationKey = key(nearest.x, nearest.y);

              if (!seen[locationKey]) {
                seen[locationKey] = true;

                this.poiPaths.push(nearest);
              }
            }
          }
        }
      } catch (e) {
        if (CONFIG.debugMode) {
          console.log("[Fluxo] Erro ao montar destinos: " + e);
        }
      }
    },

    // ========================================================
    // PROXIMIDADE DA ENTRADA
    // ========================================================

    isNearParkEntrance: function (x, y, radius) {
      for (var i = 0; i < this.parkEntrances.length; i++) {
        if (
          manhattan(
            {
              x: x,
              y: y,
            },

            this.parkEntrances[i],
          ) <= radius
        ) {
          return true;
        }
      }

      return false;
    },

    // ========================================================
    // PROGRESSO
    // ========================================================

    progressPercent: function () {
      if (!this.totalTiles) {
        return 0;
      }

      return Math.floor((this.progress / this.totalTiles) * 100);
    },
  };

  // ============================================================
  // ANALISADOR DE VISITANTES
  // ============================================================

  var GuestAnalyzer = {
    totalGuests: 0,

    lostGuests: [],

    crowdCells: [],

    tileGuestCount: {},

    update: function () {
      this.totalGuests = 0;

      this.lostGuests = [];

      this.crowdCells = [];

      this.tileGuestCount = {};

      var cells = {};

      var guests = [];

      try {
        guests = map.getAllEntities("guest") || [];
      } catch (e) {}

      this.totalGuests = guests.length;

      for (var i = 0; i < guests.length; i++) {
        var guest = guests[i];

        if (
          !guest ||
          typeof guest.x !== "number" ||
          typeof guest.y !== "number"
        ) {
          continue;
        }

        var tileX = tileCoord(guest.x);

        var tileY = tileCoord(guest.y);

        var tileKey = key(tileX, tileY);

        this.tileGuestCount[tileKey] = (this.tileGuestCount[tileKey] || 0) + 1;

        /*
         * Regiões de 3x3 por padrão.
         *
         * Isso ajuda a entender avenidas e caminhos duplos
         * como uma região de fluxo, e não tiles isolados.
         */
        var cellX = Math.floor(tileX / CONFIG.crowdCellSize);

        var cellY = Math.floor(tileY / CONFIG.crowdCellSize);

        var cellKey = key(cellX, cellY);

        if (!cells[cellKey]) {
          cells[cellKey] = {
            count: 0,

            sumX: 0,

            sumY: 0,

            wideCount: 0,

            pathCount: 0,
          };
        }

        cells[cellKey].count++;

        cells[cellKey].sumX += tileX;

        cells[cellKey].sumY += tileY;

        if (MapAnalyzer.isWalkable(tileX, tileY)) {
          cells[cellKey].pathCount++;

          if (MapAnalyzer.isWide(tileX, tileY)) {
            cells[cellKey].wideCount++;
          }
        }

        /*
         * Visitante realmente marcado como perdido.
         */
        if (
          guest.isLost &&
          (typeof guest.lostCountdown !== "number" ||
            guest.lostCountdown <= CONFIG.lostCountdownThreshold)
        ) {
          this.lostGuests.push(guest);
        }
      }

      var output = [];

      Object.keys(cells).forEach(function (cellKey) {
        var cell = cells[cellKey];

        output.push({
          x: Math.round(cell.sumX / cell.count),

          y: Math.round(cell.sumY / cell.count),

          count: cell.count,

          mostlyWide:
            cell.pathCount > 0 &&
            cell.wideCount >= Math.ceil(cell.pathCount / 2),
        });
      });

      output.sort(function (a, b) {
        return b.count - a.count;
      });

      this.crowdCells = output;
    },

    // ========================================================
    // QUANTOS VISITANTES PRÓXIMOS?
    // ========================================================

    guestsNear: function (point, radius) {
      var total = 0;

      for (var tileKey in this.tileGuestCount) {
        if (!this.tileGuestCount.hasOwnProperty(tileKey)) {
          continue;
        }

        var parts = tileKey.split(",");

        var current = {
          x: parseInt(parts[0], 10),

          y: parseInt(parts[1], 10),
        };

        if (manhattan(point, current) <= radius) {
          total += this.tileGuestCount[tileKey];
        }
      }

      return total;
    },
  };

  // ============================================================
  // ANALISADOR DE PROBLEMAS
  // ============================================================

  var IssueAnalyzer = {
    issues: [],

    congestionCount: 0,

    deadEndProblemCount: 0,

    update: function () {
      this.issues = [];

      this.congestionCount = 0;

      this.deadEndProblemCount = 0;

      // ----------------------------------------------------
      // VISITANTES PERDIDOS
      // ----------------------------------------------------

      if (GuestAnalyzer.lostGuests.length > 0) {
        this.issues.push({
          severity: 3,

          text: "Visitantes perdidos: " + GuestAnalyzer.lostGuests.length,

          hint: 'Use "Resgatar perdidos" ou simplifique os cruzamentos.',
        });
      }

      // ----------------------------------------------------
      // CONGESTIONAMENTO
      // ----------------------------------------------------

      for (var i = 0; i < GuestAnalyzer.crowdCells.length; i++) {
        var cell = GuestAnalyzer.crowdCells[i];

        if (cell.count < CONFIG.crowdWarningGuests) {
          continue;
        }

        this.congestionCount++;

        var severity = cell.count >= CONFIG.crowdCriticalGuests ? 3 : 2;

        var recommendation;

        if (cell.mostlyWide) {
          recommendation =
            "O caminho já é largo. Considere criar uma segunda rota.";
        } else {
          recommendation =
            "Considere alargar o caminho ou criar uma rota paralela.";
        }

        this.issues.push({
          severity: severity,

          text:
            "Congestionamento: " +
            cell.count +
            " visitantes perto de (" +
            cell.x +
            ", " +
            cell.y +
            ")",

          hint: recommendation,
        });
      }

      // ----------------------------------------------------
      // BECOS SEM SAÍDA
      // ----------------------------------------------------

      for (var d = 0; d < MapAnalyzer.deadEnds.length; d++) {
        var deadEnd = MapAnalyzer.deadEnds[d];

        var nearby = GuestAnalyzer.guestsNear(deadEnd, 2);

        /*
         * Um beco vazio não é necessariamente problema.
         *
         * Só alertamos quando visitantes realmente estão
         * circulando naquela região.
         */
        if (nearby >= 3) {
          this.deadEndProblemCount++;

          this.issues.push({
            severity: nearby >= 8 ? 3 : 2,

            text:
              "Beco sem saída movimentado perto de (" +
              deadEnd.x +
              ", " +
              deadEnd.y +
              ")",

            hint:
              nearby +
              " visitantes por perto. " +
              "Conecte o caminho ou limite o acesso.",
          });
        }
      }

      // ----------------------------------------------------
      // NENHUM PROBLEMA
      // ----------------------------------------------------

      if (this.issues.length === 0) {
        this.issues.push({
          severity: 1,

          text: "Fluxo aparentemente saudável.",

          hint: "Nenhum problema relevante foi encontrado nesta análise.",
        });
      }

      // ----------------------------------------------------
      // ORDENAR
      // ----------------------------------------------------

      this.issues.sort(function (a, b) {
        return b.severity - a.severity;
      });

      this.issues = this.issues.slice(
        0,

        CONFIG.maxIssuesShown,
      );
    },

    // ========================================================
    // SAÚDE GERAL
    // ========================================================

    healthText: function () {
      if (GuestAnalyzer.lostGuests.length >= 10 || this.congestionCount >= 3) {
        return "CRÍTICO";
      }

      if (
        GuestAnalyzer.lostGuests.length > 0 ||
        this.congestionCount > 0 ||
        this.deadEndProblemCount > 0
      ) {
        return "ATENÇÃO";
      }

      return "SAUDÁVEL";
    },
  };

  // ============================================================
  // RESGATE DE VISITANTES PERDIDOS
  // ============================================================

  var RescueManager = {
    rescuedTotal: 0,

    lastCycleRescued: 0,

    // ========================================================
    // PROCURAR DESTINO SEGURO
    // ========================================================

    findSafeDestination: function (guest) {
      if (!MapAnalyzer.poiPaths.length) {
        return null;
      }

      var guestTile = {
        x: tileCoord(guest.x),

        y: tileCoord(guest.y),
      };

      var best = null;

      var bestDistance = Infinity;

      for (var i = 0; i < MapAnalyzer.poiPaths.length; i++) {
        var point = MapAnalyzer.poiPaths[i];

        /*
         * Evitamos selecionar destino muito próximo
         * da entrada.
         */
        if (
          MapAnalyzer.isNearParkEntrance(
            point.x,

            point.y,

            CONFIG.parkEntranceAvoidRadius,
          )
        ) {
          continue;
        }

        var distance = manhattan(guestTile, point);

        /*
         * Também não faz sentido mandá-lo apenas
         * três quadrados para frente.
         */
        if (distance < bestDistance && distance > 3) {
          best = point;

          bestDistance = distance;
        }
      }

      return best;
    },

    // ========================================================
    // RESGATAR UM VISITANTE
    // ========================================================

    rescueGuest: function (guest) {
      if (!NetworkHelper.canModifyGameState()) {
        return false;
      }

      var destination = this.findSafeDestination(guest);

      if (!destination) {
        return false;
      }

      try {
        guest.destination = {
          x: destination.x * 32 + 16,

          y: destination.y * 32 + 16,
        };

        return true;
      } catch (e) {
        if (CONFIG.debugMode) {
          console.log("[Fluxo] Falha ao redirecionar visitante: " + e);
        }

        return false;
      }
    },

    // ========================================================
    // RESGATAR VISITANTES
    // ========================================================

    rescueLostGuests: function (manual) {
      if (!MapAnalyzer.analyzed) {
        State.status = "Analise o parque antes de resgatar visitantes.";

        updateUI();

        return;
      }

      if (!NetworkHelper.canModifyGameState()) {
        State.status =
          "Sem permissão para alterar visitantes neste modo de rede.";

        updateUI();

        return;
      }

      GuestAnalyzer.update();

      var lost = GuestAnalyzer.lostGuests.slice();

      /*
       * Clique manual:
       * pode tentar todos.
       *
       * Automático:
       * limite pequeno.
       */
      var limit = manual
        ? lost.length
        : Math.min(
            lost.length,

            CONFIG.maxRescuesPerCycle,
          );

      var rescued = 0;

      for (var i = 0; i < limit; i++) {
        if (this.rescueGuest(lost[i])) {
          rescued++;
        }
      }

      this.lastCycleRescued = rescued;

      this.rescuedTotal += rescued;

      /*
       * Atualiza diagnóstico depois.
       */
      GuestAnalyzer.update();

      IssueAnalyzer.update();

      if (rescued > 0) {
        State.status =
          "Resgate concluído.\n" +
          "Visitantes redirecionados: " +
          rescued +
          ".";
      } else {
        State.status = "Nenhum visitante perdido precisou ser redirecionado.";
      }

      updateUI();
    },
  };

  // ============================================================
  // EXECUTAR ANÁLISE MANUAL
  // ============================================================

  function runManualAnalysis() {
    MapAnalyzer.start();
  }

  // ============================================================
  // ATUALIZAR SOMENTE VISITANTES
  // ============================================================

  function refreshDiagnosticsOnly() {
    if (!MapAnalyzer.analyzed) {
      State.status = "Analise o mapa primeiro.";

      updateUI();

      return;
    }

    GuestAnalyzer.update();

    IssueAnalyzer.update();

    State.status =
      "Dados dos visitantes atualizados.\n" +
      "O mapa não precisou ser reanalisado.";

    updateUI();
  }

  // ============================================================
  // INTERFACE
  // ============================================================

  var WINDOW_ID = "guest-flow-manager-ptbr";

  var mainWindow = null;

  // ============================================================
  // ALTERAR TEXTO
  // ============================================================

  function setText(name, text) {
    if (!mainWindow) {
      return;
    }

    try {
      var widget = mainWindow.findWidget(name);

      if (widget) {
        widget.text = text;
      }
    } catch (e) {}
  }

  // ============================================================
  // ALTERAR CHECKBOX
  // ============================================================

  function setChecked(name, checked) {
    if (!mainWindow) {
      return;
    }

    try {
      var widget = mainWindow.findWidget(name);

      if (widget) {
        widget.isChecked = checked;
      }
    } catch (e) {}
  }

  // ============================================================
  // ATUALIZAR INTERFACE
  // ============================================================

  function updateUI() {
    if (!mainWindow) {
      return;
    }

    var mapText;

    if (MapAnalyzer.analyzing) {
      mapText = "Mapa: analisando... " + MapAnalyzer.progressPercent() + "%";
    } else if (MapAnalyzer.analyzed) {
      mapText =
        "Mapa: pronto" +
        " | Caminhos: " +
        MapAnalyzer.walkableList.length +
        " | Becos: " +
        MapAnalyzer.deadEnds.length;
    } else {
      mapText = "Mapa: ainda não analisado";
    }

    setText("lbl_map", mapText);

    setText(
      "lbl_guests",

      "Visitantes: " +
        GuestAnalyzer.totalGuests +
        "\nPerdidos: " +
        GuestAnalyzer.lostGuests.length,
    );

    setText(
      "lbl_health",

      "Saúde do fluxo: " + IssueAnalyzer.healthText(),
    );

    setText(
      "lbl_stats",

      "Congestionamentos: " +
        IssueAnalyzer.congestionCount +
        "\nBecos problemáticos: " +
        IssueAnalyzer.deadEndProblemCount +
        "\nResgatados no total: " +
        RescueManager.rescuedTotal,
    );

    setText("lbl_status", State.status);

    setText(
      "lbl_network",

      "Modo: " + NetworkHelper.modeText(),
    );

    // --------------------------------------------------------
    // PROBLEMAS
    // --------------------------------------------------------

    for (var i = 0; i < CONFIG.maxIssuesShown; i++) {
      var issue = IssueAnalyzer.issues[i];

      if (issue) {
        setText(
          "issue_" + i,

          issue.text + "\n" + issue.hint,
        );
      } else {
        setText("issue_" + i, "");
      }
    }

    setChecked(
      "chk_auto_analysis",

      CONFIG.autoAnalyze,
    );

    setChecked(
      "chk_auto_rescue",

      CONFIG.autoRescueLostGuests,
    );
  }

  // ============================================================
  // ABRIR JANELA
  // ============================================================

  function openWindow() {
    if (typeof ui === "undefined") {
      return;
    }

    var existing = ui.getWindow(WINDOW_ID);

    if (existing) {
      existing.bringToFront();

      return;
    }

    var widgets = [
      // ====================================================
      // VISÃO GERAL
      // ====================================================

      {
        type: "groupbox",

        name: "grp_summary",

        x: 8,

        y: 18,

        width: 454,

        height: 104,

        text: "Visão geral",
      },

      {
        type: "label",

        name: "lbl_map",

        x: 18,

        y: 36,

        width: 430,

        height: 14,

        text: "Mapa: ainda não analisado",
      },

      {
        type: "label",

        name: "lbl_guests",

        x: 18,

        y: 54,

        width: 140,

        height: 30,

        text: "Visitantes: 0\n" + "Perdidos: 0",
      },

      {
        type: "label",

        name: "lbl_health",

        x: 170,

        y: 54,

        width: 200,

        height: 14,

        text: "Saúde do fluxo: -",
      },

      {
        type: "label",

        name: "lbl_network",

        x: 170,

        y: 72,

        width: 200,

        height: 14,

        text: "Modo: -",
      },

      // ====================================================
      // BOTÕES
      // ====================================================

      {
        type: "button",

        name: "btn_analyze",

        x: 18,

        y: 92,

        width: 128,

        height: 22,

        text: "Analisar agora",

        onClick: function () {
          runManualAnalysis();
        },
      },

      {
        type: "button",

        name: "btn_refresh",

        x: 156,

        y: 92,

        width: 128,

        height: 22,

        text: "Atualizar dados",

        onClick: function () {
          refreshDiagnosticsOnly();
        },
      },

      {
        type: "button",

        name: "btn_rescue",

        x: 294,

        y: 92,

        width: 150,

        height: 22,

        text: "Resgatar perdidos",

        onClick: function () {
          RescueManager.rescueLostGuests(true);
        },
      },

      // ====================================================
      // PROBLEMAS
      // ====================================================

      {
        type: "groupbox",

        name: "grp_issues",

        x: 8,

        y: 130,

        width: 454,

        height: 222,

        text: "Problemas encontrados",
      },

      {
        type: "label",

        name: "issue_0",

        x: 18,

        y: 148,

        width: 430,

        height: 30,

        text: "",
      },

      {
        type: "label",

        name: "issue_1",

        x: 18,

        y: 180,

        width: 430,

        height: 30,

        text: "",
      },

      {
        type: "label",

        name: "issue_2",

        x: 18,

        y: 212,

        width: 430,

        height: 30,

        text: "",
      },

      {
        type: "label",

        name: "issue_3",

        x: 18,

        y: 244,

        width: 430,

        height: 30,

        text: "",
      },

      {
        type: "label",

        name: "issue_4",

        x: 18,

        y: 276,

        width: 430,

        height: 30,

        text: "",
      },

      {
        type: "label",

        name: "issue_5",

        x: 18,

        y: 308,

        width: 430,

        height: 30,

        text: "",
      },

      // ====================================================
      // AUTOMAÇÃO
      // ====================================================

      {
        type: "groupbox",

        name: "grp_settings",

        x: 8,

        y: 360,

        width: 454,

        height: 94,

        text: "Automação e segurança",
      },

      {
        type: "checkbox",

        name: "chk_auto_analysis",

        x: 18,

        y: 380,

        width: 210,

        height: 14,

        text: "Atualizar análise automaticamente",

        isChecked: CONFIG.autoAnalyze,

        onChange: function (checked) {
          CONFIG.autoAnalyze = checked;

          State.status = checked
            ? "Atualização automática ativada.\n" +
              "Isso apenas atualiza o diagnóstico."
            : "Atualização automática desativada.";

          updateUI();
        },
      },

      {
        type: "checkbox",

        name: "chk_auto_rescue",

        x: 238,

        y: 380,

        width: 210,

        height: 14,

        text: "Resgatar perdidos automaticamente",

        isChecked: CONFIG.autoRescueLostGuests,

        onChange: function (checked) {
          CONFIG.autoRescueLostGuests = checked;

          if (checked) {
            State.status =
              "Resgate automático ativado.\n" +
              "Máximo de " +
              CONFIG.maxRescuesPerCycle +
              " visitantes por ciclo.";
          } else {
            State.status =
              "Resgate automático desativado.\n" + "Você continua no controle.";
          }

          updateUI();
        },
      },

      // ====================================================
      // ESTATÍSTICAS
      // ====================================================

      {
        type: "label",

        name: "lbl_stats",

        x: 18,

        y: 402,

        width: 210,

        height: 42,

        text:
          "Congestionamentos: 0\n" +
          "Becos problemáticos: 0\n" +
          "Resgatados no total: 0",
      },

      {
        type: "label",

        name: "lbl_help",

        x: 238,

        y: 402,

        width: 210,

        height: 42,

        text:
          "O plugin não constrói caminhos.\n" +
          "Ele diagnostica e, se você mandar,\n" +
          "redireciona visitantes perdidos.",
      },

      // ====================================================
      // STATUS
      // ====================================================

      {
        type: "label",

        name: "lbl_status",

        x: 10,

        y: 462,

        width: 450,

        height: 36,

        text: State.status,
      },
    ];

    mainWindow = ui.openWindow({
      classification: WINDOW_ID,

      title: "Gerenciador de Fluxo de Visitantes 1.0",

      width: 470,

      height: 506,

      colours: [24, 24],

      widgets: widgets,

      onClose: function () {
        mainWindow = null;
      },
    });

    updateUI();
  }

  // ============================================================
  // LOOP
  // ============================================================

  function onTick() {
    if (!CONFIG.enabled) {
      return;
    }

    /*
     * Se uma análise completa está acontecendo,
     * processamos pequenos blocos.
     */
    if (MapAnalyzer.analyzing) {
      MapAnalyzer.analyzeStep();

      return;
    }

    var tick = getTick();

    /*
     * Atualização automática LEVE.
     *
     * Não varre o mapa inteiro de novo.
     *
     * Apenas atualiza visitantes e diagnóstico.
     */
    if (CONFIG.autoAnalyze && MapAnalyzer.analyzed) {
      if (tick - State.lastAutoAnalysisTick >= CONFIG.analysisIntervalTicks) {
        State.lastAutoAnalysisTick = tick;

        GuestAnalyzer.update();

        IssueAnalyzer.update();

        /*
         * Só mexe nos visitantes se o usuário
         * ATIVOU explicitamente esta função.
         */
        if (
          CONFIG.autoRescueLostGuests &&
          GuestAnalyzer.lostGuests.length > 0
        ) {
          RescueManager.rescueLostGuests(false);
        } else {
          updateUI();
        }
      }
    }
  }

  // ============================================================
  // TROCA DE MAPA
  // ============================================================

  function resetForMapChange() {
    MapAnalyzer.width = 0;

    MapAnalyzer.height = 0;

    MapAnalyzer.totalTiles = 0;

    MapAnalyzer.progress = 0;

    MapAnalyzer.analyzed = false;

    MapAnalyzer.analyzing = false;

    MapAnalyzer.tiles = {};

    MapAnalyzer.walkableList = [];

    MapAnalyzer.deadEnds = [];

    MapAnalyzer.parkEntrances = [];

    MapAnalyzer.poiPaths = [];

    GuestAnalyzer.totalGuests = 0;

    GuestAnalyzer.lostGuests = [];

    GuestAnalyzer.crowdCells = [];

    GuestAnalyzer.tileGuestCount = {};

    IssueAnalyzer.issues = [];

    IssueAnalyzer.congestionCount = 0;

    IssueAnalyzer.deadEndProblemCount = 0;

    State.status = "Mapa alterado.\n" + 'Clique em "Analisar agora".';

    State.lastAnalysisTick = 0;

    State.lastAutoAnalysisTick = 0;

    updateUI();
  }

  // ============================================================
  // MAIN
  // ============================================================

  function main() {
    if (typeof ui !== "undefined") {
      ui.registerMenuItem(
        "Gerenciador de Fluxo",

        function () {
          openWindow();
        },
      );
    }

    context.subscribe(
      "interval.tick",

      function () {
        try {
          onTick();
        } catch (e) {
          if (CONFIG.debugMode) {
            console.log("[Fluxo] Erro: " + e);
          }
        }
      },
    );

    context.subscribe(
      "map.change",

      function () {
        resetForMapChange();
      },
    );

    console.log("[Gerenciador de Fluxo 1.0] Carregado - PT-BR");
  }

  // ============================================================
  // REGISTRO DO PLUGIN
  // ============================================================

  registerPlugin({
    name: "Gerenciador de Fluxo de Visitantes",

    version: "1.0.0",

    authors: ["OpenAI + Kaoan"],

    type: "local",

    licence: "MIT",

    targetApiVersion: 77,

    minApiVersion: 34,

    main: main,
  });
})();
