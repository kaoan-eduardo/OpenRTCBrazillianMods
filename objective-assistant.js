/**
 * Assistente de Objetivos PT-BR - OpenRCT2
 * Versão 2.1.0
 *
 * Correções principais:
 * - Não identifica montanhas-russas pelo nome.
 * - Usa a categoria oficial de pesquisa do rideType quando disponível.
 * - Fallback para tabela de tipos clássicos do Objective Assistant original.
 * - Interface compacta, sem barras ASCII.
 * - Textos quebrados manualmente em múltiplas linhas.
 * - Atualização automática do progresso.
 */
(function () {
  "use strict";

  var PLUGIN = {
    name: "Assistente de Objetivos PT-BR",
    version: "2.1.0",
    windowId: "objective-assistant-ptbr-v21",
  };

  var UPDATE_MS = 500;

  var win = null;
  var timer = null;

  /*
   * Fallback baseado na tabela de categorias
   * do Objective Assistant original.
   *
   * O caminho preferencial é montar isso
   * dinamicamente via park.research.
   */
  var CLASSIC_ROLLERCOASTER_TYPES = {
    0: true,
    1: true,
    2: true,
    3: true,
    4: true,

    7: true,
    9: true,
    10: true,
    13: true,
    15: true,

    17: true,
    19: true,
    42: true,
    44: true,
    51: true,

    52: true,
    53: true,
    54: true,
    55: true,
    57: true,

    59: true,
    62: true,
    65: true,
    66: true,
    68: true,

    73: true,
    74: true,
    75: true,
    76: true,
    86: true,

    87: true,
    88: true,
    90: true,
    91: true,
    92: true,

    94: true,
    95: true,
    96: true,
    97: true,
    98: true,

    99: true,
    100: true,
    101: true,
    102: true,
  };

  // ============================================================
  // HELPERS
  // ============================================================

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function percent(current, target) {
    if (!target || target <= 0) {
      return 100;
    }

    return clamp(
      (current / target) * 100,

      0,
      100,
    );
  }

  function percentText(value) {
    return value.toFixed(1).replace(".", ",") + "%";
  }

  function money(value) {
    try {
      return context.formatString("{CURRENCY}", value);
    } catch (e) {
      return String(value);
    }
  }

  function wrapText(text, maxChars) {
    if (!text) {
      return [""];
    }

    var words = String(text).split(" ");

    var lines = [];
    var current = "";

    for (var i = 0; i < words.length; i++) {
      var candidate = current ? current + " " + words[i] : words[i];

      if (candidate.length > maxChars && current) {
        lines.push(current);

        current = words[i];
      } else {
        current = candidate;
      }
    }

    if (current) {
      lines.push(current);
    }

    return lines;
  }

  // ============================================================
  // CATEGORIA DAS ATRAÇÕES
  // ============================================================

  function buildRideCategoryMap() {
    var mapByType = {};

    try {
      var research = park.research;

      var items = [];

      if (research && research.inventedItems) {
        items = items.concat(research.inventedItems);
      }

      if (research && research.uninventedItems) {
        items = items.concat(research.uninventedItems);
      }

      for (var i = 0; i < items.length; i++) {
        var item = items[i];

        if (!item || item.type !== "ride") {
          continue;
        }

        mapByType[item.rideType] = item.category;
      }
    } catch (e) {}

    return mapByType;
  }

  function isRollercoasterType(type, categoryMap) {
    if (categoryMap[type]) {
      return categoryMap[type] === "rollercoaster";
    }

    return CLASSIC_ROLLERCOASTER_TYPES[type] === true;
  }

  // ============================================================
  // CONTAGEM DE MONTANHAS-RUSSAS
  // ============================================================

  function coasterStats(excitementTarget, lengthTarget) {
    var rides = map.rides || [];

    var categories = buildRideCategoryMap();

    var seenValidTypes = {};

    var rollercoastersBuilt = 0;

    var openRollercoasters = 0;

    var ratingQualified = 0;

    var lengthQualified = 0;

    for (var i = 0; i < rides.length; i++) {
      var ride = rides[i];

      if (!ride || ride.classification !== "ride") {
        continue;
      }

      if (!isRollercoasterType(ride.type, categories)) {
        continue;
      }

      rollercoastersBuilt++;

      if (ride.status !== "open") {
        continue;
      }

      openRollercoasters++;

      var excitementOk =
        typeof ride.excitement === "number" &&
        ride.excitement >= excitementTarget;

      if (!excitementOk) {
        continue;
      }

      ratingQualified++;

      var lengthOk =
        !lengthTarget ||
        (typeof ride.rideLength === "number" &&
          ride.rideLength >= lengthTarget);

      if (!lengthOk) {
        continue;
      }

      lengthQualified++;

      seenValidTypes[String(ride.type)] = true;
    }

    return {
      built: rollercoastersBuilt,

      open: openRollercoasters,

      excitementQualified: ratingQualified,

      lengthQualified: lengthQualified,

      validDistinctTypes: Object.keys(seenValidTypes).length,
    };
  }

  // ============================================================
  // OBJETIVO DE 5 COASTERS
  // ============================================================

  function finishedPartialCoasters(excitementTarget) {
    var rides = map.rides || [];

    var candidates = [];

    for (var i = 0; i < rides.length; i++) {
      var ride = rides[i];

      if (!ride || ride.classification !== "ride") {
        continue;
      }

      try {
        if (ride.object && ride.object.carsPerFlatRide === 255) {
          candidates.push(ride);
        }
      } catch (e) {}
    }

    candidates = candidates.slice(0, 5);

    var completed = 0;

    for (var j = 0; j < candidates.length; j++) {
      if (
        candidates[j].status === "open" &&
        typeof candidates[j].excitement === "number" &&
        candidates[j].excitement >= excitementTarget
      ) {
        completed++;
      }
    }

    return completed;
  }

  // ============================================================
  // REQUISITOS
  // ============================================================

  function requirement(label, current, target, formatter) {
    var progress = percent(current, target);

    return {
      label: label,

      current: current,

      target: target,

      progress: progress,

      complete: current >= target,

      text:
        (formatter ? formatter(current) : String(current)) +
        " / " +
        (formatter ? formatter(target) : String(target)),
    };
  }

  // ============================================================
  // OBJETIVO
  // ============================================================

  function buildObjectiveState() {
    var objective = scenario.objective || {
      type: "none",
    };

    var requirements = [];

    var description = "Objetivo não reconhecido.";

    var diagnosticLines = [];

    switch (objective.type) {
      // ====================================================
      // VISITANTES ATÉ PRAZO
      // ====================================================

      case "guestsBy":
        description =
          "Tenha pelo menos " +
          objective.guests +
          " visitantes até o prazo do cenário e mantenha a avaliação mínima exigida.";

        requirements.push(
          requirement("Visitantes", park.guests, objective.guests),
        );

        requirements.push(requirement("Avaliação do parque", park.rating, 600));

        break;

      // ====================================================
      // VISITANTES + RATING
      // ====================================================

      case "guestsAndRating":
        description =
          "Tenha pelo menos " +
          objective.guests +
          " visitantes e mantenha a avaliação do parque em pelo menos 700.";

        requirements.push(
          requirement("Visitantes", park.guests, objective.guests),
        );

        requirements.push(requirement("Avaliação do parque", park.rating, 700));

        break;

      // ====================================================
      // VALOR DO PARQUE
      // ====================================================

      case "parkValueBy":
        description =
          "Atingir valor de parque de pelo menos " +
          money(objective.parkValue) +
          ".";

        requirements.push(
          requirement(
            "Valor do parque",
            park.value,
            objective.parkValue,
            money,
          ),
        );

        break;

      // ====================================================
      // EMPRÉSTIMO
      // ====================================================

      case "repayLoanAndParkValue":
        description = "Quite o empréstimo e atinja o valor de parque exigido.";

        requirements.push(
          requirement(
            "Valor do parque",
            park.value,
            objective.parkValue,
            money,
          ),
        );

        requirements.push({
          label: "Empréstimo",

          progress: park.bankLoan <= 0 ? 100 : 0,

          complete: park.bankLoan <= 0,

          text:
            park.bankLoan <= 0
              ? "Quitado"
              : "Restante: " + money(park.bankLoan),
        });

        break;

      // ====================================================
      // 10 MONTANHAS-RUSSAS
      // ====================================================

      case "10Rollercoasters":
        var excitementTarget =
          objective.excitement && objective.excitement > 0
            ? objective.excitement
            : 600;

        var stats = coasterStats(excitementTarget, 0);

        description =
          "Tenha 10 tipos diferentes de montanha-russa funcionando, " +
          "cada uma com emoção de pelo menos " +
          (excitementTarget / 100).toFixed(2).replace(".", ",") +
          ".";

        requirements.push(
          requirement(
            "Tipos válidos de montanha-russa",
            stats.validDistinctTypes,
            10,
          ),
        );

        diagnosticLines.push(
          "Construídas: " +
            stats.built +
            " | Abertas: " +
            stats.open +
            " | Com emoção mínima: " +
            stats.excitementQualified,
        );

        break;

      // ====================================================
      // 10 COASTERS + COMPRIMENTO
      // ====================================================

      case "10RollercoastersLength":
        var excitementLengthTarget =
          objective.excitement && objective.excitement > 0
            ? objective.excitement
            : 700;

        var lengthTarget =
          objective.length && objective.length > 0 ? objective.length : 1200;

        var statsLength = coasterStats(excitementLengthTarget, lengthTarget);

        description =
          "Tenha 10 tipos diferentes de montanha-russa funcionando, " +
          "com emoção e comprimento mínimos exigidos pelo cenário.";

        requirements.push(
          requirement(
            "Tipos válidos de montanha-russa",
            statsLength.validDistinctTypes,
            10,
          ),
        );

        diagnosticLines.push(
          "Abertas: " +
            statsLength.open +
            " | Emoção OK: " +
            statsLength.excitementQualified +
            " | Comprimento OK: " +
            statsLength.lengthQualified,
        );

        break;

      // ====================================================
      // FINALIZAR 5
      // ====================================================

      case "finish5Rollercoasters":
        var targetExcitement =
          objective.excitement && objective.excitement > 0
            ? objective.excitement
            : 600;

        var finished = finishedPartialCoasters(targetExcitement);

        description =
          "Conclua as 5 montanhas-russas parcialmente construídas " +
          "e alcance a emoção mínima exigida.";

        requirements.push(
          requirement("Montanhas-russas concluídas", finished, 5),
        );

        break;

      // ====================================================
      // RENDA ATRAÇÕES
      // ====================================================

      case "monthlyRideIncome":
        description =
          "Atinja a renda mensal exigida com ingressos das atrações.";

        requirements.push({
          label: "Renda mensal das atrações",

          progress: null,

          complete: false,

          text: "Meta: " + money(objective.monthlyIncome),
        });

        break;

      // ====================================================
      // RENDA LOJAS
      // ====================================================

      case "monthlyFoodIncome":
        description =
          "Atinja o lucro mensal exigido com comida, bebida e mercadorias.";

        requirements.push({
          label: "Lucro mensal das lojas",

          progress: null,

          complete: false,

          text: "Meta: " + money(objective.monthlyIncome),
        });

        break;

      // ====================================================
      // ESPECIAIS
      // ====================================================

      case "haveFun":
        description =
          "Este cenário não possui uma meta tradicional de conclusão.";

        break;

      case "buildTheBest":
        description =
          "Este cenário possui um objetivo especial sem percentual simples de conclusão.";

        break;

      case "none":
        description = "Este cenário não possui objetivo definido.";

        break;

      default:
        description =
          "Tipo de objetivo ainda não tratado: " + objective.type + ".";

        break;
    }

    // ========================================================
    // PROGRESSO GERAL
    // ========================================================

    var measurable = requirements.filter(function (req) {
      return typeof req.progress === "number";
    });

    var overall = measurable.length ? 100 : null;

    for (var i = 0; i < measurable.length; i++) {
      overall = Math.min(overall, measurable[i].progress);
    }

    if (scenario.status === "completed") {
      overall = 100;
    }

    return {
      description: description,

      diagnosticLines: diagnosticLines,

      requirements: requirements,

      overall: overall,

      completed: scenario.status === "completed",

      failed: scenario.status === "failed",
    };
  }

  // ============================================================
  // STATUS
  // ============================================================

  function statusText(state) {
    if (state.completed) {
      return "CONCLUÍDO";
    }

    if (state.failed) {
      return "FALHOU";
    }

    return "EM ANDAMENTO";
  }

  // ============================================================
  // UI HELPERS
  // ============================================================

  function safeWidget(name) {
    if (!win) {
      return null;
    }

    try {
      return win.findWidget(name);
    } catch (e) {
      return null;
    }
  }

  function setText(name, text) {
    var w = safeWidget(name);

    if (w) {
      w.text = text;
    }
  }

  // ============================================================
  // ATUALIZAÇÃO
  // ============================================================

  function updateWindow() {
    if (!win) {
      return;
    }

    var state = buildObjectiveState();

    var descLines = wrapText(state.description, 68);

    setText(
      "status",

      "Status: " + statusText(state),
    );

    setText(
      "overall",

      state.overall === null
        ? "Conclusão geral: não calculável"
        : "Conclusão geral: " + percentText(state.overall),
    );

    setText(
      "description",

      descLines.slice(0, 3).join("\n"),
    );

    setText(
      "diagnostic",

      state.diagnosticLines.length ? state.diagnosticLines.join("\n") : "",
    );

    for (var i = 0; i < 4; i++) {
      var req = state.requirements[i];

      var text = "";

      if (req) {
        text = req.label + ": " + req.text;

        if (typeof req.progress === "number") {
          text += " (" + percentText(req.progress) + ")";
        }

        text += "\n" + (req.complete ? "Concluído" : "Pendente");
      }

      setText("req" + i, text);
    }
  }

  // ============================================================
  // JANELA
  // ============================================================

  function openWindow() {
    if (typeof ui === "undefined") {
      return;
    }

    var existing = ui.getWindow(PLUGIN.windowId);

    if (existing) {
      existing.bringToFront();

      return;
    }

    var widgets = [
      {
        type: "groupbox",

        x: 8,

        y: 20,

        width: 500,

        height: 132,

        text: "Objetivo atual",
      },

      {
        type: "label",

        name: "status",

        x: 18,

        y: 42,

        width: 470,

        height: 14,

        text: "",
      },

      {
        type: "label",

        name: "overall",

        x: 18,

        y: 60,

        width: 470,

        height: 14,

        text: "",
      },

      {
        type: "label",

        name: "description",

        x: 18,

        y: 82,

        width: 470,

        height: 44,

        text: "",
      },

      {
        type: "label",

        name: "diagnostic",

        x: 18,

        y: 128,

        width: 470,

        height: 18,

        text: "",
      },

      {
        type: "groupbox",

        x: 8,

        y: 160,

        width: 500,

        height: 150,

        text: "Requisitos",
      },

      {
        type: "label",

        name: "req0",

        x: 18,

        y: 182,

        width: 470,

        height: 28,

        text: "",
      },

      {
        type: "label",

        name: "req1",

        x: 18,

        y: 214,

        width: 470,

        height: 28,

        text: "",
      },

      {
        type: "label",

        name: "req2",

        x: 18,

        y: 246,

        width: 470,

        height: 28,

        text: "",
      },

      {
        type: "label",

        name: "req3",

        x: 18,

        y: 278,

        width: 470,

        height: 28,

        text: "",
      },

      {
        type: "button",

        x: 8,

        y: 320,

        width: 125,

        height: 24,

        text: "Atualizar agora",

        onClick: updateWindow,
      },

      {
        type: "label",

        x: 145,

        y: 326,

        width: 350,

        height: 14,

        text: "Atualização automática a cada 0,5 s",
      },
    ];

    win = ui.openWindow({
      classification: PLUGIN.windowId,

      title: "Assistente de Objetivos PT-BR 2.1",

      width: 516,

      height: 354,

      colours: [3, 4],

      widgets: widgets,

      onClose: function () {
        win = null;

        if (timer !== null) {
          try {
            context.clearInterval(timer);
          } catch (e) {}

          timer = null;
        }
      },
    });

    updateWindow();

    timer = context.setInterval(
      function () {
        if (win) {
          updateWindow();
        }
      },

      UPDATE_MS,
    );
  }

  // ============================================================
  // MAIN
  // ============================================================

  function main() {
    if (typeof ui !== "undefined") {
      ui.registerMenuItem("Assistente de Objetivos PT-BR", openWindow);
    }

    context.subscribe(
      "map.change",

      function () {
        if (win) {
          updateWindow();
        }
      },
    );

    console.log("[Assistente de Objetivos PT-BR 2.1] carregado");
  }

  registerPlugin({
    name: PLUGIN.name,

    version: PLUGIN.version,

    authors: ["OpenAI + Kaoan"],

    type: "local",

    licence: "MIT",

    targetApiVersion: 111,

    minApiVersion: 111,

    main: main,
  });
})();
