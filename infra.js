/**
 * Infraestrutura de Caminhos - OpenRCT2
 * Versão 1.1.0
 *
 * - Corrige alternância banco/lixeira com espaçamento > 1.
 * - Analisa antes de construir em massa.
 * - Mostra plano e custo estimado.
 * - Só constrói após confirmação.
 * - Pode automatizar mobiliário em novos caminhos.
 */
(function () {
  "use strict";

  var PLUGIN = {
    name: "Infraestrutura de Caminhos",

    version: "1.1.0",

    windowId: "infraestrutura-caminhos-ptbr-v11",
  };

  var STORAGE = {
    bench: "PathInfrastructure.bench",

    bin: "PathInfrastructure.bin",

    queueTv: "PathInfrastructure.queueTv",

    preserveExisting: "PathInfrastructure.preserveExisting",

    autoBuild: "PathInfrastructure.autoBuild",

    normalBenches: "PathInfrastructure.normalBenches",

    normalBins: "PathInfrastructure.normalBins",

    slopedBins: "PathInfrastructure.slopedBins",

    queueTvs: "PathInfrastructure.queueTvs",

    normalSpacing: "PathInfrastructure.normalSpacing",

    slopeSpacing: "PathInfrastructure.slopeSpacing",

    queueSpacing: "PathInfrastructure.queueSpacing",
  };

  var DEFAULTS = {
    preserveExisting: true,

    autoBuild: false,

    normalBenches: true,

    normalBins: true,

    slopedBins: true,

    queueTvs: true,

    normalSpacing: 2,

    slopeSpacing: 2,

    queueSpacing: 1,
  };

  var SPACING_OPTIONS = [1, 2, 3, 4, 5, 6];

  var State = {
    window: null,

    tab: 0,

    objects: {
      benches: [],
      bins: [],
      queueTvs: [],
    },

    plan: [],

    analysis: null,

    analysisGeneration: 0,

    buildRunning: false,

    status: "Clique em Analisar parque para preparar um plano.",

    sessionBuilt: 0,

    sessionFailures: 0,
  };

  function isSpacingTile(x, y, spacing) {
    spacing = Math.max(1, Number(spacing) || 1);

    return (x + y) % spacing === 0;
  }

  function pickAlternating(benchValue, binValue, x, y, spacing) {
    if (benchValue == null && binValue == null) {
      return null;
    }

    if (benchValue == null) {
      return binValue;
    }

    if (binValue == null) {
      return benchValue;
    }

    spacing = Math.max(1, Number(spacing) || 1);

    /*
     * CORREÇÃO:
     *
     * Antes:
     *   spacing = 2
     *   só passavam x+y pares
     *   depois (x+y)%2 sempre era 0
     *   => sempre banco.
     *
     * Agora alternamos pelo "slot lógico".
     */
    var slot = Math.floor((x + y) / spacing);

    return slot % 2 === 0 ? benchValue : binValue;
  }

  function canBuildOnPath(surface, path) {
    if (!surface || !path) {
      return false;
    }

    if (surface.hasOwnership) {
      return true;
    }

    if (
      surface.hasConstructionRights &&
      surface.baseHeight !== path.baseHeight
    ) {
      return true;
    }

    return false;
  }

  function money(value) {
    try {
      return context.formatString("{CURRENCY2DP}", value || 0);
    } catch (e) {
      return String(value || 0);
    }
  }

  function getSetting(key, fallback) {
    var value = context.sharedStorage.get(key);

    return value === null || value === undefined ? fallback : value;
  }

  function setSetting(key, value) {
    context.sharedStorage.set(key, value);
  }

  function getBool(key, fallback) {
    return !!getSetting(key, fallback);
  }

  function getNumber(key, fallback) {
    var number = Number(getSetting(key, fallback));

    return isFinite(number) ? number : fallback;
  }

  function loadObjects() {
    var all = context.getAllObjects("footpath_addition") || [];

    State.objects.benches = all.filter(function (object) {
      var id = String((object && object.identifier) || "").toLowerCase();

      return id.indexOf("bench") >= 0;
    });

    State.objects.bins = all.filter(function (object) {
      var id = String((object && object.identifier) || "").toLowerCase();

      return id.indexOf("litter") >= 0 || id.indexOf("bin") >= 0;
    });

    State.objects.queueTvs = all.filter(function (object) {
      var id = String((object && object.identifier) || "").toLowerCase();

      return (
        id.indexOf("qtv") >= 0 ||
        (id.indexOf("queue") >= 0 && id.indexOf("tv") >= 0)
      );
    });

    ensureStoredObject(STORAGE.bench, State.objects.benches);

    ensureStoredObject(STORAGE.bin, State.objects.bins);

    ensureStoredObject(STORAGE.queueTv, State.objects.queueTvs);
  }

  function ensureStoredObject(storageKey, list) {
    if (!list.length) {
      return;
    }

    var stored = getSetting(storageKey, null);

    var exists = list.some(function (object) {
      return object.index === stored;
    });

    if (!exists) {
      setSetting(storageKey, list[0].index);
    }
  }

  function selectedObject(storageKey) {
    return getSetting(storageKey, null);
  }

  function objectPosition(list, objectIndex) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].index === objectIndex) {
        return i;
      }
    }

    return 0;
  }

  function objectItems(list) {
    return list.map(function (object) {
      return (
        (object.name || "Objeto") + " [" + (object.identifier || "?") + "]"
      );
    });
  }

  function isSloped(path) {
    return (
      path && path.slopeDirection !== null && path.slopeDirection !== undefined
    );
  }

  function desiredAdditionForPath(x, y, path) {
    if (!path) {
      return null;
    }

    if (path.isQueue) {
      if (!getBool(STORAGE.queueTvs, DEFAULTS.queueTvs)) {
        return null;
      }

      var queueSpacing = getNumber(STORAGE.queueSpacing, DEFAULTS.queueSpacing);

      if (!isSpacingTile(x, y, queueSpacing)) {
        return null;
      }

      return selectedObject(STORAGE.queueTv);
    }

    if (isSloped(path)) {
      if (!getBool(STORAGE.slopedBins, DEFAULTS.slopedBins)) {
        return null;
      }

      var slopeSpacing = getNumber(STORAGE.slopeSpacing, DEFAULTS.slopeSpacing);

      if (!isSpacingTile(x, y, slopeSpacing)) {
        return null;
      }

      return selectedObject(STORAGE.bin);
    }

    var normalSpacing = getNumber(
      STORAGE.normalSpacing,
      DEFAULTS.normalSpacing,
    );

    if (!isSpacingTile(x, y, normalSpacing)) {
      return null;
    }

    var bench = getBool(STORAGE.normalBenches, DEFAULTS.normalBenches)
      ? selectedObject(STORAGE.bench)
      : null;

    var bin = getBool(STORAGE.normalBins, DEFAULTS.normalBins)
      ? selectedObject(STORAGE.bin)
      : null;

    return pickAlternating(bench, bin, x, y, normalSpacing);
  }

  function classifyPlanItem(path) {
    if (path.isQueue) {
      return "queueTv";
    }

    if (isSloped(path)) {
      return "slopedBin";
    }

    return "normal";
  }

  function buildPlan() {
    var preserve = getBool(STORAGE.preserveExisting, DEFAULTS.preserveExisting);

    var plan = [];

    var counters = {
      normalPaths: 0,
      slopedPaths: 0,
      queuePaths: 0,
      existingAdditions: 0,
      benches: 0,
      bins: 0,
      queueTvs: 0,
      replacements: 0,
      skippedRights: 0,
    };

    for (var y = 0; y < map.size.y; y++) {
      for (var x = 0; x < map.size.x; x++) {
        var tile = map.getTile(x, y);

        if (!tile) {
          continue;
        }

        var surface = null;

        var paths = [];

        for (var i = 0; i < tile.numElements; i++) {
          var element = tile.getElement(i);

          if (!element) {
            continue;
          }

          if (element.type === "surface") {
            surface = element;
          }

          if (element.type === "footpath") {
            paths.push(element);
          }
        }

        for (var p = 0; p < paths.length; p++) {
          var path = paths[p];

          if (path.isQueue) {
            counters.queuePaths++;
          } else if (isSloped(path)) {
            counters.slopedPaths++;
          } else {
            counters.normalPaths++;
          }

          var hasAddition =
            path.addition !== null && path.addition !== undefined;

          if (hasAddition) {
            counters.existingAdditions++;
          }

          if (!canBuildOnPath(surface, path)) {
            counters.skippedRights++;

            continue;
          }

          var desired = desiredAdditionForPath(x, y, path);

          if (desired === null || desired === undefined) {
            continue;
          }

          if (hasAddition && preserve) {
            continue;
          }

          if (hasAddition && path.addition === desired) {
            continue;
          }

          var kind = classifyPlanItem(path);

          if (kind === "queueTv") {
            counters.queueTvs++;
          } else if (kind === "slopedBin") {
            counters.bins++;
          } else {
            if (desired === selectedObject(STORAGE.bench)) {
              counters.benches++;
            } else {
              counters.bins++;
            }
          }

          if (hasAddition) {
            counters.replacements++;
          }

          plan.push({
            x: x,

            y: y,

            z: path.baseZ,

            object: desired,

            existing: hasAddition,

            previousObject: hasAddition ? path.addition : null,

            estimatedCost: null,
          });
        }
      }
    }

    return {
      plan: plan,

      counters: counters,
    };
  }

  function analyzePark() {
    State.analysisGeneration++;

    var generation = State.analysisGeneration;

    State.status = "Analisando parque...";

    updateUI();

    var result = buildPlan();

    State.plan = result.plan;

    State.analysis = {
      counters: result.counters,

      estimatedCost: 0,

      done: 0,

      total: result.plan.length,

      complete: false,
    };

    var index = 0;

    function next() {
      if (generation !== State.analysisGeneration) {
        return;
      }

      if (index >= State.plan.length) {
        State.analysis.complete = true;

        State.status = State.plan.length
          ? "Plano pronto. Revise e confirme."
          : "Nada precisa ser construído.";

        updateUI();

        return;
      }

      var item = State.plan[index++];

      if (item.existing) {
        State.analysis.done++;

        next();

        return;
      }

      context.queryAction(
        "footpathadditionplace",

        {
          x: item.x * 32,

          y: item.y * 32,

          z: item.z,

          object: item.object,
        },

        function (result) {
          if (result && typeof result.cost === "number") {
            State.analysis.estimatedCost += result.cost;
          }

          State.analysis.done++;

          updateUI();

          next();
        },
      );
    }

    next();
  }

  function executePlacement(item, done) {
    context.executeAction(
      "footpathadditionplace",

      {
        x: item.x * 32,

        y: item.y * 32,

        z: item.z,

        object: item.object,
      },

      function (result) {
        done(!(result && (result.error || result.errorMessage)));
      },
    );
  }

  function executePlanItem(item, done) {
    if (!item.existing) {
      executePlacement(item, done);

      return;
    }

    context.executeAction(
      "footpathadditionremove",

      {
        x: item.x * 32,

        y: item.y * 32,

        z: item.z,
      },

      function (result) {
        if (result && (result.error || result.errorMessage)) {
          done(false);

          return;
        }

        executePlacement(item, done);
      },
    );
  }

  function confirmBuild() {
    if (!State.analysis || !State.analysis.complete) {
      State.status = "Analise o parque primeiro.";

      updateUI();

      return;
    }

    if (!State.plan.length) {
      State.status = "Não há itens para construir.";

      updateUI();

      return;
    }

    if (State.buildRunning) {
      return;
    }

    State.buildRunning = true;

    var queue = State.plan.slice();

    var index = 0;
    var ok = 0;
    var fail = 0;

    function next() {
      if (index >= queue.length) {
        State.buildRunning = false;

        State.sessionBuilt += ok;

        State.sessionFailures += fail;

        State.plan = [];

        State.analysis = null;

        State.status = "Concluído: " + ok + " item(ns). Falhas: " + fail + ".";

        updateUI();

        return;
      }

      var item = queue[index++];

      State.status = "Construindo " + index + " / " + queue.length + "...";

      updateUI();

      executePlanItem(
        item,

        function (success) {
          if (success) {
            ok++;
          } else {
            fail++;
          }

          next();
        },
      );
    }

    next();
  }

  function chooseAutoObject(args) {
    var x = Math.floor(args.x / 32);

    var y = Math.floor(args.y / 32);

    var isQueue = ((args.constructFlags || 0) & 1) !== 0;

    if (isQueue) {
      return getBool(STORAGE.queueTvs, DEFAULTS.queueTvs)
        ? selectedObject(STORAGE.queueTv)
        : null;
    }

    var slope = args.slope || args.slopeType;

    if (slope) {
      return getBool(STORAGE.slopedBins, DEFAULTS.slopedBins)
        ? selectedObject(STORAGE.bin)
        : null;
    }

    var spacing = getNumber(STORAGE.normalSpacing, DEFAULTS.normalSpacing);

    if (!isSpacingTile(x, y, spacing)) {
      return null;
    }

    return pickAlternating(
      getBool(STORAGE.normalBenches, DEFAULTS.normalBenches)
        ? selectedObject(STORAGE.bench)
        : null,

      getBool(STORAGE.normalBins, DEFAULTS.normalBins)
        ? selectedObject(STORAGE.bin)
        : null,

      x,
      y,
      spacing,
    );
  }

  function onActionExecute(event) {
    if (!event || event.action !== "footpathplace") {
      return;
    }

    if (!getBool(STORAGE.autoBuild, DEFAULTS.autoBuild)) {
      return;
    }

    if (network.mode === "client" || event.isClientOnly) {
      return;
    }

    var args = event.args || {};

    var addition = chooseAutoObject(args);

    if (addition === null || addition === undefined) {
      return;
    }

    context.executeAction(
      "footpathadditionplace",

      {
        x: args.x,

        y: args.y,

        z: args.z,

        object: addition,
      },

      function () {},
    );
  }

  function widget(name) {
    if (!State.window) {
      return null;
    }

    try {
      return State.window.findWidget(name);
    } catch (e) {
      return null;
    }
  }

  function setText(name, value) {
    var w = widget(name);

    if (w) {
      w.text = value;
    }
  }

  function setVisible(name, value) {
    var w = widget(name);

    if (w) {
      w.isVisible = value;
    }
  }

  function setChecked(name, value) {
    var w = widget(name);

    if (w) {
      w.isChecked = value;
    }
  }

  function setSelected(name, index) {
    var w = widget(name);

    if (w) {
      w.selectedIndex = index;
    }
  }

  function setStatus(text) {
    State.status = text;

    updateUI();
  }

  var TAB_WIDGETS = {
    0: ["g_overview", "overview_stats", "overview_plan", "analyze", "confirm"],

    1: [
      "g_config",
      "bench_label",
      "bench_dd",
      "bin_label",
      "bin_dd",
      "qtv_label",
      "qtv_dd",
      "normal_benches",
      "normal_bins",
      "sloped_bins",
      "queue_tvs",
      "preserve_existing",
      "normal_spacing_label",
      "normal_spacing",
    ],

    2: ["g_auto", "auto_enabled", "auto_help", "auto_summary"],
  };

  function switchTab(index) {
    State.tab = index;

    for (var t = 0; t < 3; t++) {
      var button = widget("tab" + t);

      if (button) {
        button.isPressed = t === index;
      }

      var names = TAB_WIDGETS[t] || [];

      for (var i = 0; i < names.length; i++) {
        setVisible(names[i], t === index);
      }
    }

    updateUI();
  }

  function analysisText() {
    if (!State.analysis) {
      return "Nenhum plano preparado.";
    }

    var c = State.analysis.counters;

    var text =
      "Caminhos: " +
      c.normalPaths +
      " normais | " +
      c.slopedPaths +
      " inclinados | " +
      c.queuePaths +
      " filas\n" +
      "Plano: " +
      State.plan.length +
      " itens | Bancos: " +
      c.benches +
      " | Lixeiras: " +
      c.bins +
      " | TVs: " +
      c.queueTvs;

    if (!State.analysis.complete) {
      text +=
        "\nCalculando custo: " +
        State.analysis.done +
        "/" +
        State.analysis.total;
    } else {
      text += "\nCusto estimado: " + money(State.analysis.estimatedCost);
    }

    return text;
  }

  function updateUI() {
    if (!State.window) {
      return;
    }

    setText("status", State.status);

    setText(
      "overview_stats",

      "Construídos nesta sessão: " +
        State.sessionBuilt +
        " | Falhas: " +
        State.sessionFailures,
    );

    setText("overview_plan", analysisText());

    setChecked(
      "normal_benches",
      getBool(STORAGE.normalBenches, DEFAULTS.normalBenches),
    );

    setChecked("normal_bins", getBool(STORAGE.normalBins, DEFAULTS.normalBins));

    setChecked("sloped_bins", getBool(STORAGE.slopedBins, DEFAULTS.slopedBins));

    setChecked("queue_tvs", getBool(STORAGE.queueTvs, DEFAULTS.queueTvs));

    setChecked(
      "preserve_existing",
      getBool(STORAGE.preserveExisting, DEFAULTS.preserveExisting),
    );

    setChecked("auto_enabled", getBool(STORAGE.autoBuild, DEFAULTS.autoBuild));

    setText(
      "auto_summary",

      "Caminho normal: bancos e lixeiras alternados.\n" +
        "Inclinado: lixeira | Fila: TV de fila",
    );
  }

  function openWindow() {
    if (typeof ui === "undefined") {
      return;
    }

    var old = ui.getWindow(PLUGIN.windowId);

    if (old) {
      old.bringToFront();

      return;
    }

    loadObjects();

    var widgets = [];

    var tabs = ["Visão geral", "Configuração", "Automação"];

    tabs.forEach(function (name, index) {
      widgets.push({
        type: "button",

        name: "tab" + index,

        x: 8 + index * 150,

        y: 20,

        width: 145,

        height: 18,

        text: name,

        isPressed: index === 0,

        onClick: function () {
          switchTab(index);
        },
      });
    });

    widgets.push({
      type: "groupbox",

      name: "g_overview",

      x: 8,

      y: 46,

      width: 452,

      height: 220,

      text: "Planejamento",

      isVisible: true,
    });

    widgets.push({
      type: "label",

      name: "overview_stats",

      x: 18,

      y: 68,

      width: 420,

      height: 30,

      text: "",

      isVisible: true,
    });

    widgets.push({
      type: "button",

      name: "analyze",

      x: 18,

      y: 108,

      width: 130,

      height: 24,

      text: "Analisar parque",

      isVisible: true,

      onClick: analyzePark,
    });

    widgets.push({
      type: "button",

      name: "confirm",

      x: 158,

      y: 108,

      width: 155,

      height: 24,

      text: "Confirmar construção",

      isVisible: true,

      onClick: confirmBuild,
    });

    widgets.push({
      type: "label",

      name: "overview_plan",

      x: 18,

      y: 146,

      width: 420,

      height: 90,

      text: "",

      isVisible: true,
    });

    widgets.push({
      type: "groupbox",

      name: "g_config",

      x: 8,

      y: 46,

      width: 452,

      height: 250,

      text: "Configuração",

      isVisible: false,
    });

    function dropdown(name, labelName, label, y, list, storageKey) {
      widgets.push({
        type: "label",

        name: labelName,

        x: 18,

        y: y + 3,

        width: 85,

        height: 14,

        text: label,

        isVisible: false,
      });

      widgets.push({
        type: "dropdown",

        name: name,

        x: 105,

        y: y,

        width: 325,

        height: 18,

        items: objectItems(list),

        selectedIndex: objectPosition(list, selectedObject(storageKey)),

        isVisible: false,

        onChange: function (index) {
          if (list[index]) {
            setSetting(storageKey, list[index].index);
          }
        },
      });
    }

    dropdown(
      "bench_dd",
      "bench_label",
      "Banco:",
      68,
      State.objects.benches,
      STORAGE.bench,
    );

    dropdown(
      "bin_dd",
      "bin_label",
      "Lixeira:",
      94,
      State.objects.bins,
      STORAGE.bin,
    );

    dropdown(
      "qtv_dd",
      "qtv_label",
      "TV de fila:",
      120,
      State.objects.queueTvs,
      STORAGE.queueTv,
    );

    widgets.push({
      type: "checkbox",

      name: "normal_benches",

      x: 18,

      y: 154,

      width: 180,

      height: 16,

      text: "Bancos em caminhos normais",

      isVisible: false,

      onChange: function (value) {
        setSetting(STORAGE.normalBenches, value);
      },
    });

    widgets.push({
      type: "checkbox",

      name: "normal_bins",

      x: 220,

      y: 154,

      width: 180,

      height: 16,

      text: "Lixeiras em caminhos normais",

      isVisible: false,

      onChange: function (value) {
        setSetting(STORAGE.normalBins, value);
      },
    });

    widgets.push({
      type: "checkbox",

      name: "sloped_bins",

      x: 18,

      y: 178,

      width: 190,

      height: 16,

      text: "Lixeiras em caminhos inclinados",

      isVisible: false,

      onChange: function (value) {
        setSetting(STORAGE.slopedBins, value);
      },
    });

    widgets.push({
      type: "checkbox",

      name: "queue_tvs",

      x: 220,

      y: 178,

      width: 180,

      height: 16,

      text: "TVs nas filas",

      isVisible: false,

      onChange: function (value) {
        setSetting(STORAGE.queueTvs, value);
      },
    });

    widgets.push({
      type: "checkbox",

      name: "preserve_existing",

      x: 18,

      y: 202,

      width: 250,

      height: 16,

      text: "Preservar objetos existentes",

      isVisible: false,

      onChange: function (value) {
        setSetting(STORAGE.preserveExisting, value);
      },
    });

    widgets.push({
      type: "label",

      name: "normal_spacing_label",

      x: 18,

      y: 230,

      width: 150,

      height: 14,

      text: "Espaçamento normal:",

      isVisible: false,
    });

    widgets.push({
      type: "dropdown",

      name: "normal_spacing",

      x: 170,

      y: 226,

      width: 90,

      height: 18,

      items: SPACING_OPTIONS.map(function (n) {
        return n + (n === 1 ? " tile" : " tiles");
      }),

      selectedIndex: SPACING_OPTIONS.indexOf(
        getNumber(STORAGE.normalSpacing, DEFAULTS.normalSpacing),
      ),

      isVisible: false,

      onChange: function (index) {
        setSetting(STORAGE.normalSpacing, SPACING_OPTIONS[index]);
      },
    });

    widgets.push({
      type: "groupbox",

      name: "g_auto",

      x: 8,

      y: 46,

      width: 452,

      height: 180,

      text: "Automação",

      isVisible: false,
    });

    widgets.push({
      type: "checkbox",

      name: "auto_enabled",

      x: 18,

      y: 70,

      width: 310,

      height: 16,

      text: "Adicionar itens ao construir novos caminhos",

      isVisible: false,

      onChange: function (value) {
        setSetting(STORAGE.autoBuild, value);

        setStatus(value ? "Automação ativada." : "Automação desativada.");
      },
    });

    widgets.push({
      type: "label",

      name: "auto_help",

      x: 18,

      y: 100,

      width: 420,

      height: 40,

      text:
        "Usa a configuração escolhida para caminhos novos.\n" +
        "Não faz nova varredura no parque inteiro.",

      isVisible: false,
    });

    widgets.push({
      type: "label",

      name: "auto_summary",

      x: 18,

      y: 150,

      width: 420,

      height: 36,

      text: "",

      isVisible: false,
    });

    widgets.push({
      type: "label",

      name: "status",

      x: 10,

      y: 315,

      width: 448,

      height: 42,

      text: State.status,
    });

    State.window = ui.openWindow({
      classification: PLUGIN.windowId,

      title: "Infraestrutura de Caminhos 1.1",

      width: 468,

      height: 365,

      colours: [24, 24],

      widgets: widgets,

      onClose: function () {
        State.window = null;
      },
    });

    switchTab(State.tab);

    updateUI();
  }

  function main() {
    loadObjects();

    if (typeof ui !== "undefined" && network.mode !== "client") {
      ui.registerMenuItem("Infraestrutura de Caminhos", openWindow);
    }

    context.subscribe("action.execute", onActionExecute);

    console.log("[Infraestrutura de Caminhos 1.1] carregado");
  }

  registerPlugin({
    name: PLUGIN.name,

    version: PLUGIN.version,

    authors: ["OpenAI + Kaoan", "Tom Scott <tubbo@psychedeli.ca>"],

    type: "local",

    licence: "MIT",

    minApiVersion: 77,

    targetApiVersion: 111,

    main: main,
  });
})();
