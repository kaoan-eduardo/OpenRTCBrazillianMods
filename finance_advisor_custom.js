/**
 * Finance Advisor PT-BR - OpenRCT2
 * Version 2.0.0
 *
 * Interface simples:
 * - tabela única;
 * - atração;
 * - preço atual;
 * - preço sugerido;
 * - ação;
 * - detalhes abaixo;
 * - aplicação manual.
 *
 * Nenhum preço é alterado automaticamente.
 */
(function () {
  "use strict";

  var PLUGIN = {
    name: "Finance Advisor PT-BR",

    version: "2.0.0",

    windowId: "finance-advisor-ptbr-v2",
  };

  var STRATEGIES = [
    {
      name: "Equilibrado",

      factor: 0.9,

      description:
        "Busca boa receita sem encostar totalmente no valor calculado da atração.",
    },

    {
      name: "Bom valor",

      factor: 0.25,

      description:
        "Mantém o ingresso mais barato para favorecer custo-benefício.",
    },
  ];

  var CFG = {
    minDifference: 10,

    maxPrice: 2000,
  };

  var State = {
    rows: [],

    strategyIndex: 0,

    selectedIndex: -1,

    status: "Clique em Analisar preços.",

    analyzed: false,
  };

  var win = null;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function round10(value) {
    return Math.round(value / 10) * 10;
  }

  function money(value) {
    try {
      return context.formatString("{CURRENCY2DP}", value || 0);
    } catch (e) {
      return "$" + ((value || 0) / 10).toFixed(2);
    }
  }

  function actionErrorText(result) {
    if (!result) {
      return "";
    }

    return result.errorMessage || result.error || result.errorTitle || "";
  }

  function recommendation(current, value, popularity, satisfaction, factor) {
    if (typeof value !== "number" || value < 0) {
      return {
        recommended: current,

        action: "SEM DADOS",

        reason:
          "O jogo ainda não calculou um valor confiável para esta atração.",
      };
    }

    var recommended = round10(value * factor);

    recommended = clamp(recommended, 0, CFG.maxPrice);

    if (factor >= 0.5) {
      if (
        typeof popularity === "number" &&
        popularity >= 0 &&
        popularity < 25
      ) {
        recommended = round10(recommended * 0.85);
      }

      if (
        typeof satisfaction === "number" &&
        satisfaction >= 0 &&
        satisfaction < 45
      ) {
        recommended = round10(recommended * 0.85);
      }
    }

    if (Math.abs(recommended - current) < CFG.minDifference) {
      recommended = current;
    }

    if (recommended > current) {
      return {
        recommended: recommended,

        action: "SUBIR",

        reason: "O preço atual está abaixo da faixa sugerida.",
      };
    }

    if (recommended < current) {
      return {
        recommended: recommended,

        action: "BAIXAR",

        reason: "O preço atual está acima da faixa sugerida.",
      };
    }

    return {
      recommended: current,

      action: "OK",

      reason: "O preço atual já está próximo da faixa sugerida.",
    };
  }

  function buildRow(ride) {
    var current =
      ride.price && typeof ride.price[0] === "number" ? ride.price[0] : 0;

    var value =
      typeof ride.value === "number" && ride.value >= 0 ? ride.value : null;

    var strategy = STRATEGIES[State.strategyIndex];

    var rec = recommendation(
      current,
      value,
      ride.popularity,
      ride.satisfaction,
      strategy.factor,
    );

    return {
      id: ride.id,

      name: ride.name || "Atração " + ride.id,

      current: current,

      value: value,

      recommended: rec.recommended,

      action: rec.action,

      reason: rec.reason,

      popularity: ride.popularity,

      satisfaction: ride.satisfaction,

      profit: ride.profit,

      incomePerHour: ride.incomePerHour,
    };
  }

  function analyze() {
    var rides = map.rides || [];

    var rows = [];

    for (var i = 0; i < rides.length; i++) {
      var ride = rides[i];

      if (!ride || ride.classification !== "ride") {
        continue;
      }

      rows.push(buildRow(ride));
    }

    rows.sort(function (a, b) {
      var priority = {
        BAIXAR: 0,
        SUBIR: 1,
        OK: 2,
        "SEM DADOS": 3,
      };

      var p = priority[a.action] - priority[b.action];

      if (p !== 0) {
        return p;
      }

      return (
        Math.abs(b.recommended - b.current) -
        Math.abs(a.recommended - a.current)
      );
    });

    State.rows = rows;

    State.selectedIndex = rows.length ? 0 : -1;

    State.analyzed = true;

    State.status = rows.length
      ? "Análise concluída. Nenhum preço foi alterado."
      : "Nenhuma atração encontrada.";

    updateUI();
  }

  function selectedRow() {
    if (State.selectedIndex < 0 || State.selectedIndex >= State.rows.length) {
      return null;
    }

    return State.rows[State.selectedIndex];
  }

  function rideSetPriceCandidates(row) {
    return [
      {
        ride: row.id,

        price: row.recommended,
      },

      {
        ride: row.id,

        price: row.recommended,

        isPrimaryPrice: true,
      },

      {
        ride: row.id,

        price: row.recommended,

        isPrimary: true,
      },

      {
        ride: row.id,

        price: row.recommended,

        priceType: 0,
      },
    ];
  }

  function applyRow(row, done) {
    if (!row || row.current === row.recommended) {
      done(true, "Nada para alterar.");

      return;
    }

    var candidates = rideSetPriceCandidates(row);

    var index = 0;

    var lastError = "";

    function tryNext() {
      if (index >= candidates.length) {
        done(false, lastError || "A ação de preço não foi aceita.");

        return;
      }

      var args = candidates[index++];

      context.queryAction(
        "ridesetprice",

        args,

        function (queryResult) {
          var queryError = actionErrorText(queryResult);

          if (queryError) {
            lastError = queryError;

            tryNext();

            return;
          }

          context.executeAction(
            "ridesetprice",

            args,

            function (result) {
              var error = actionErrorText(result);

              if (error) {
                lastError = error;

                tryNext();

                return;
              }

              done(true, "Preço alterado.");
            },
          );
        },
      );
    }

    tryNext();
  }

  function applySelected() {
    var row = selectedRow();

    if (!row) {
      State.status = "Selecione uma atração.";

      updateUI();

      return;
    }

    if (row.action === "OK" || row.action === "SEM DADOS") {
      State.status = "Não há alteração recomendada para esta atração.";

      updateUI();

      return;
    }

    State.status = "Aplicando preço em " + row.name + "...";

    updateUI();

    applyRow(
      row,

      function (success, message) {
        State.status = success
          ? row.name + ": preço atualizado."
          : row.name + ": falha. " + message;

        analyze();
      },
    );
  }

  function applyAll() {
    var pending = State.rows.filter(function (row) {
      return row.action === "SUBIR" || row.action === "BAIXAR";
    });

    if (!pending.length) {
      State.status = "Não há recomendações pendentes.";

      updateUI();

      return;
    }

    var index = 0;
    var ok = 0;
    var fail = 0;

    function next() {
      if (index >= pending.length) {
        State.status =
          "Concluído: " + ok + " alterado(s), " + fail + " falha(s).";

        analyze();

        return;
      }

      var row = pending[index++];

      applyRow(
        row,

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

  function widget(name) {
    if (!win) {
      return null;
    }

    try {
      return win.findWidget(name);
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

  function updateList() {
    var list = widget("rides");

    if (!list) {
      return;
    }

    list.items = State.rows.map(function (row) {
      return [row.name, money(row.current), money(row.recommended), row.action];
    });
  }

  function detailText(row) {
    if (!row) {
      return "Selecione uma atração para ver os detalhes.";
    }

    var pop = typeof row.popularity === "number" ? row.popularity + "%" : "-";

    var sat =
      typeof row.satisfaction === "number" ? row.satisfaction + "%" : "-";

    var value = row.value === null ? "-" : money(row.value);

    var profit = typeof row.profit === "number" ? money(row.profit) : "-";

    return (
      row.name +
      "\n" +
      "Atual: " +
      money(row.current) +
      " | Sugerido: " +
      money(row.recommended) +
      " | Valor: " +
      value +
      "\n" +
      "Popularidade: " +
      pop +
      " | Satisfação: " +
      sat +
      " | Lucro: " +
      profit +
      "\n" +
      "Motivo: " +
      row.reason
    );
  }

  function updateUI() {
    if (!win) {
      return;
    }

    var strategy = STRATEGIES[State.strategyIndex];

    setText(
      "summary",

      State.analyzed
        ? "Atrações analisadas: " +
            State.rows.length +
            " | Estratégia: " +
            strategy.name
        : "Ainda não analisado.",
    );

    setText("strategy_help", strategy.description);

    setText("detail", detailText(selectedRow()));

    setText("status", State.status);

    var dd = widget("strategy");

    if (dd) {
      dd.selectedIndex = State.strategyIndex;
    }

    updateList();
  }

  function open() {
    if (typeof ui === "undefined") {
      return;
    }

    var old = ui.getWindow(PLUGIN.windowId);

    if (old) {
      old.bringToFront();

      return;
    }

    var widgets = [
      {
        type: "button",

        name: "analyze",

        x: 10,

        y: 22,

        width: 110,

        height: 24,

        text: "Analisar preços",

        onClick: analyze,
      },

      {
        type: "label",

        x: 135,

        y: 27,

        width: 65,

        height: 14,

        text: "Estratégia:",
      },

      {
        type: "dropdown",

        name: "strategy",

        x: 202,

        y: 23,

        width: 130,

        height: 20,

        items: STRATEGIES.map(function (s) {
          return s.name;
        }),

        selectedIndex: State.strategyIndex,

        onChange: function (index) {
          State.strategyIndex = index;

          if (State.analyzed) {
            analyze();
          } else {
            updateUI();
          }
        },
      },

      {
        type: "label",

        name: "summary",

        x: 10,

        y: 54,

        width: 500,

        height: 14,

        text: "",
      },

      {
        type: "label",

        name: "strategy_help",

        x: 10,

        y: 72,

        width: 500,

        height: 28,

        text: "",
      },

      {
        type: "listview",

        name: "rides",

        x: 10,

        y: 106,

        width: 500,

        height: 210,

        isStriped: true,

        canSelect: true,

        columns: [
          {
            header: "Atração",

            width: 250,
          },

          {
            header: "Atual",

            width: 75,
          },

          {
            header: "Sugerido",

            width: 85,
          },

          {
            header: "Ação",

            width: 75,
          },
        ],

        items: [],

        onClick: function (row) {
          if (typeof row === "number" && row >= 0 && row < State.rows.length) {
            State.selectedIndex = row;

            updateUI();
          }
        },
      },

      {
        type: "groupbox",

        x: 10,

        y: 324,

        width: 500,

        height: 102,

        text: "Detalhes",
      },

      {
        type: "label",

        name: "detail",

        x: 20,

        y: 344,

        width: 480,

        height: 72,

        text: "",
      },

      {
        type: "button",

        x: 10,

        y: 436,

        width: 150,

        height: 24,

        text: "Aplicar esta sugestão",

        onClick: applySelected,
      },

      {
        type: "button",

        x: 170,

        y: 436,

        width: 180,

        height: 24,

        text: "Aplicar todas",

        onClick: applyAll,
      },

      {
        type: "label",

        name: "status",

        x: 10,

        y: 470,

        width: 500,

        height: 34,

        text: State.status,
      },
    ];

    win = ui.openWindow({
      classification: PLUGIN.windowId,

      title: "Finance Advisor PT-BR 2.0",

      width: 520,

      height: 510,

      colours: [24, 24],

      widgets: widgets,

      onClose: function () {
        win = null;
      },
    });

    updateUI();
  }

  function main() {
    if (typeof ui !== "undefined") {
      ui.registerMenuItem("Finance Advisor PT-BR", open);
    }

    context.subscribe(
      "map.change",

      function () {
        State.rows = [];

        State.selectedIndex = -1;

        State.analyzed = false;

        State.status = "Mapa alterado. Clique em Analisar preços.";

        updateUI();
      },
    );

    console.log("[Finance Advisor PT-BR 2.0] loaded");
  }

  registerPlugin({
    name: PLUGIN.name,

    version: PLUGIN.version,

    authors: ["OpenAI + Kaoan"],

    type: "local",

    licence: "MIT",

    targetApiVersion: 111,

    minApiVersion: 77,

    main: main,
  });
})();
