/**
 * Finance Advisor PT-BR 2.3.0
 * OpenRCT2 Scripting API 117+
 *
 * NOVO:
 * - Referencias de valor e custo dos itens do OpenRCT2.
 * - Recomendacoes de aumento E reducao.
 * - Reclamações recentes dos visitantes por produto.
 * - Historico de vendas entre observacoes.
 * - Protecao absoluta contra ALTERACOES de guarda-chuva.
 * - Sem alteracoes automaticas.
 *
 * IMPORTANTE:
 * - totalCustomers representa vendas da BARRACA, nao
 *   necessariamente de cada produto separadamente.
 * - Os pensamentos sao agregados por produto no parque.
 * - A referencia de valor e do jogo, nao uma garantia
 *   do preco ideal no cenario.
 * - O guarda-chuva (ShopItem 4) nunca entra na fila
 *   de aplicacao, mesmo em "Aplicar todos".
 */

(function () {
  "use strict";

  var VERSION = "2.3.0";
  var WINDOW = "finance-advisor-ptbr-v23";

  var CFG = {
    maxRidePrice: 2000,
    maxShopPrice: 5000,

    // Incrementos monetarios de 0,10.
    priceStep: 10,

    // Amostras de vendas a cada ~30 segundos de jogo.
    sampleTicks: 960,

    // Exigir pelo menos ~2 minutos de observacao.
    minObservationTicks: 3840,

    maxHistory: 24,

    // Referencia para testar aumentos.
    minObservedSales: 4,

    // Limitar a intensidade de uma reducao unica.
    maxReductionFraction: 0.25,

    // O preco de 20,00 e uma preferencia do usuario.
    // Nao significa que o plugin vai altera-lo.
    umbrellaId: 4,
    umbrellaTarget: 2000,
  };

  var STRATEGIES = [
    {
      name: "Equilibrado",
      rideFactor: 0.9,
      shopTarget: 1.0,
      maxIncrease: 0.1,
    },
    {
      name: "Bom valor",
      rideFactor: 0.25,
      shopTarget: 0.9,
      maxIncrease: 0.05,
    },
  ];

  /*
   * ID: [nome, valor-base, custo-base, pensamento caro]
   *
   * Valores em unidades monetarias internas do OpenRCT2.
   * Referencias extraidas do ShopItem.cpp do jogo.
   *
   * Valores de referencia, nao precos obrigatorios.
   */
  var ITEMS = {
    0: ["Balao", 140, 30, "balloon_much"],
    1: ["Brinquedo", 300, 150, "toy_much"],
    2: ["Mapa", 70, 10, "map_much"],
    3: ["Fotografia", 300, 20, "photo_much"],
    4: ["Guarda-chuva", 350, 200, "umbrella_much"],
    5: ["Refrigerante", 120, 30, "drink_much"],
    6: ["Hamburguer", 190, 50, "burger_much"],
    7: ["Batata frita", 160, 40, "chips_much"],
    8: ["Sorvete", 100, 40, "ice_cream_much"],
    9: ["Algodao-doce", 90, 30, "candyfloss_much"],
    13: ["Pizza", 210, 60, "pizza_much"],
    15: ["Pipoca", 130, 50, "popcorn_much"],
    16: ["Cachorro-quente", 170, 50, "hot_dog_much"],
    17: ["Tentaculo", 220, 110, "tentacle_much"],
    18: ["Chapeu", 270, 90, "hat_much"],
    19: ["Maca do amor", 100, 40, "toffee_apple_much"],
    20: ["Camiseta", 370, 200, "tshirt_much"],
    21: ["Rosquinha", 80, 40, "doughnut_much"],
    22: ["Cafe", 110, 30, "coffee_much"],
    24: ["Frango", 190, 50, "chicken_much"],
    25: ["Limonada", 110, 40, "lemonade_much"],
    32: ["Fotografia 2", 300, 20, "photo2_much"],
    33: ["Fotografia 3", 300, 20, "photo3_much"],
    34: ["Fotografia 4", 300, 20, "photo4_much"],
    35: ["Pretzel", 110, 50, "pretzel_much"],
    36: ["Chocolate quente", 130, 40, "hot_chocolate_much"],
    37: ["Cha gelado", 100, 30, "iced_tea_much"],
    38: ["Bolo funil", 130, 50, "funnel_cake_much"],
    39: ["Oculos de sol", 150, 80, "sunglasses_much"],
    40: ["Macarrao com carne", 170, 70, "beef_noodles_much"],
    41: ["Macarrao de arroz", 170, 60, "fried_rice_noodles_much"],
    42: ["Sopa de wonton", 130, 40, "wonton_soup_much"],
    43: ["Sopa de almondegas", 140, 50, "meatball_soup_much"],
    44: ["Suco de frutas", 110, 40, "fruit_juice_much"],
    45: ["Leite de soja", 100, 40, "soybean_milk_much"],
    46: ["Sujeonggwa", 110, 30, "sujongkwa_much"],
    47: ["Sanduiche", 190, 50, "sub_sandwich_much"],
    48: ["Biscoito", 80, 40, "cookie_much"],
    52: ["Linguica assada", 160, 50, "roast_sausage_much"],
  };

  var S = {
    window: null,
    tab: 0,
    strategy: 0,
    busy: false,

    analyzed: [false, false],
    rows: [[], []],
    selected: [-1, -1],

    // Historico em memoria para a partida atual.
    history: {},
    lastSampleTick: -1,

    status: "Analise os precos para comecar.",
  };

  // ============================================================
  // BASICOS
  // ============================================================

  function valid(value) {
    return typeof value === "number" && isFinite(value);
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function roundPrice(value) {
    return Math.round(value / CFG.priceStep) * CFG.priceStep;
  }

  function money(value) {
    try {
      return context.formatString("{CURRENCY2DP}", value);
    } catch (e) {
      return (value / 100).toFixed(2).replace(".", ",");
    }
  }

  function log(message) {
    console.log("[Finance Advisor " + VERSION + "] " + message);
  }

  function errorOf(result) {
    if (!result) {
      return "Sem resposta do jogo.";
    }

    if (
      result.error !== undefined &&
      result.error !== null &&
      result.error !== 0 &&
      result.error !== false &&
      result.error !== ""
    ) {
      return result.errorMessage || result.errorTitle || String(result.error);
    }

    return result.errorMessage || result.errorTitle || "";
  }

  function getRide(id) {
    try {
      return map.getRide(id);
    } catch (e) {
      return null;
    }
  }

  function getPrice(ride, slot) {
    if (!ride || !ride.price || !valid(ride.price[slot])) {
      return null;
    }

    return ride.price[slot];
  }

  function strategy() {
    return STRATEGIES[S.strategy];
  }

  function key(row) {
    return row.rideId + ":" + row.slot;
  }

  function currentRows() {
    return S.rows[S.tab];
  }

  function currentRow() {
    var index = S.selected[S.tab];

    if (index < 0 || index >= currentRows().length) {
      return null;
    }

    return currentRows()[index];
  }

  function isUmbrella(itemId) {
    return itemId === CFG.umbrellaId;
  }

  function protectedRow(row) {
    return row && row.kind === "stall" && isUmbrella(row.itemId);
  }

  function pending(row) {
    return (
      !!row &&
      !protectedRow(row) &&
      row.current !== row.recommended &&
      (row.action === "SUBIR" || row.action === "BAIXAR")
    );
  }

  function setStatus(message) {
    S.status = message;
    updateUI();
  }

  // ============================================================
  // HISTORICO DE VENDAS
  // ============================================================

  function sampleSales() {
    var tick = date.ticksElapsed;

    if (!valid(tick)) return;

    if (
      S.lastSampleTick >= 0 &&
      tick >= S.lastSampleTick &&
      tick - S.lastSampleTick < CFG.sampleTicks
    ) {
      return;
    }

    if (S.lastSampleTick >= 0 && tick < S.lastSampleTick) {
      S.history = {};
    }

    S.lastSampleTick = tick;

    (map.rides || []).forEach(function (ride) {
      if (
        !ride ||
        ride.classification !== "stall" ||
        !valid(ride.totalCustomers)
      ) {
        return;
      }

      var id = String(ride.id);
      var record = S.history[id];

      if (!record || record.buildDate !== ride.buildDate) {
        record = {
          buildDate: ride.buildDate,
          samples: [],
        };

        S.history[id] = record;
      }

      var sample = {
        tick: tick,
        customers: ride.totalCustomers,
        primary: getPrice(ride, 0),
        secondary: getPrice(ride, 1),
        status: ride.status,
      };

      record.samples.push(sample);

      while (record.samples.length > CFG.maxHistory) {
        record.samples.shift();
      }
    });
  }

  function salesObservation(ride) {
    var record = S.history[String(ride.id)];

    if (!record || record.samples.length < 2) {
      return null;
    }

    var samples = record.samples;
    var latest = samples[samples.length - 1];

    /*
     * O numero total de clientes e da loja inteira.
     * Se houver dois produtos, nao podemos atribuir
     * essas compras a um produto especifico.
     *
     * Apenas intervalos com a loja aberta
     * e precos inalterados sao considerados.
     */
    var first = latest;

    for (var i = samples.length - 2; i >= 0; i--) {
      var candidate = samples[i];

      if (
        candidate.primary !== latest.primary ||
        candidate.secondary !== latest.secondary ||
        candidate.status !== "open" ||
        candidate.customers > latest.customers
      ) {
        break;
      }

      first = candidate;
    }

    var elapsed = latest.tick - first.tick;

    if (elapsed < CFG.minObservationTicks) {
      return null;
    }

    var sold = Math.max(0, latest.customers - first.customers);

    return {
      sold: sold,
      ticks: elapsed,
      // Estimativa de vendas por hora de jogo.
      perHour: elapsed > 0 ? (sold * 2400 * 60) / elapsed : 0,
    };
  }

  // ============================================================
  // PENSAMENTOS SOBRE PRECO
  // ============================================================

  function collectComplaints() {
    var counts = {};

    try {
      map.getAllEntities("guest").forEach(function (guest) {
        if (!guest.isInPark || !guest.thoughts) {
          return;
        }

        var alreadySeen = {};

        guest.thoughts.forEach(function (thought) {
          if (!thought || typeof thought.type !== "string") {
            return;
          }

          /*
           * So pensamentos relativamente
           * recentes. Um visitante pode
           * manter lembrancas antigas.
           */
          if (valid(thought.freshness) && thought.freshness > 20) {
            return;
          }

          var type = thought.type;

          if (alreadySeen[type]) {
            return;
          }

          alreadySeen[type] = true;

          counts[type] = (counts[type] || 0) + 1;
        });
      });
    } catch (e) {
      log("Falha ao ler pensamentos: " + e);
    }

    return counts;
  }

  // ============================================================
  // ATRACOES - LOGICA APROVADA
  // ============================================================

  function rideRecommendation(ride, current) {
    var value = ride.value;

    if (!valid(value) || value < 0) {
      return {
        price: current,
        action: "SEM DADOS",
        reason: "Valor da atracao indisponivel.",
      };
    }

    var factor = strategy().rideFactor;

    var suggested = clamp(roundPrice(value * factor), 0, CFG.maxRidePrice);

    if (factor >= 0.5) {
      if (
        valid(ride.popularity) &&
        ride.popularity >= 0 &&
        ride.popularity < 25
      ) {
        suggested = roundPrice(suggested * 0.85);
      }

      if (
        valid(ride.satisfaction) &&
        ride.satisfaction >= 0 &&
        ride.satisfaction < 45
      ) {
        suggested = roundPrice(suggested * 0.85);
      }
    }

    if (Math.abs(suggested - current) < CFG.priceStep) {
      suggested = current;
    }

    return {
      price: suggested,
      action:
        suggested > current ? "SUBIR" : suggested < current ? "BAIXAR" : "OK",
      reason: "Calculado pelo valor da atracao.",
    };
  }

  function buildRides() {
    var rows = [];

    (map.rides || []).forEach(function (ride) {
      if (!ride || ride.classification !== "ride") {
        return;
      }

      var current = getPrice(ride, 0);

      if (current === null) return;

      var recommendation = rideRecommendation(ride, current);

      rows.push({
        kind: "ride",
        rideId: ride.id,
        slot: 0,
        itemId: null,

        name: ride.name,

        current: current,
        recommended: recommendation.price,

        action: recommendation.action,
        reason: recommendation.reason,

        base: null,
        cost: null,
        complaints: 0,
        observation: null,

        popularity: ride.popularity,
        satisfaction: ride.satisfaction,
        value: ride.value,
      });
    });

    return rows;
  }

  // ============================================================
  // LOJAS - NOVO ALGORITMO
  // ============================================================

  function shopRecommendation(ride, itemId, current, complaints, observation) {
    /*
     * REGRA INVIOLAVEL:
     * guarda-chuva jamais recebe alteracao.
     */
    if (isUmbrella(itemId)) {
      return {
        price: current,
        action: "PROTEGIDO",
        reason:
          "Guarda-chuva bloqueado. " +
          "Preco desejado: " +
          money(CFG.umbrellaTarget) +
          ". O plugin nunca altera este item.",
      };
    }

    var item = ITEMS[itemId];

    if (!item) {
      return {
        price: current,
        action: "MANUAL",
        reason: "Produto sem referencia conhecida.",
      };
    }

    if (ride.status !== "open") {
      return {
        price: current,
        action: "AGUARDAR",
        reason: "Loja fechada. Sem recomendacao.",
      };
    }

    if (current <= 0) {
      return {
        price: current,
        action: "MANUAL",
        reason: "Preco zero. Revisao manual necessaria.",
      };
    }

    var base = item[1];
    var cost = item[2];

    var target = roundPrice(base * strategy().shopTarget);

    // Evitar precos de referencia abaixo do custo.
    target = Math.max(target, roundPrice(cost + CFG.priceStep));

    var reason = "";

    /*
     * PRIORIDADE 1:
     * reclamacões de preco excessivo.
     *
     * Reclamações sao por produto no parque.
     * O jogo nao as atribui diretamente a uma
     * barraca especifica.
     */
    if (complaints >= 1) {
      target = Math.min(target, roundPrice(current * 0.9));

      reason =
        complaints +
        " visitante(s) reclamaram do " +
        "preco deste produto no parque.";
    }

    /*
     * PRIORIDADE 2:
     * acima da referencia de valor.
     *
     * Exemplo:
     * pizza 3,00, valor-base 2,10.
     * Agora a recomendacao pode BAIXAR.
     */
    if (current > target) {
      var minimumNext = roundPrice(current * (1 - CFG.maxReductionFraction));

      var reduced = Math.max(target, minimumNext);

      reduced = Math.max(reduced, roundPrice(cost + CFG.priceStep));

      reduced = Math.min(current, roundPrice(reduced));

      if (!reason) {
        reason = "Preco acima do valor de " + "referencia do produto.";
      }

      return {
        price: reduced,

        action: reduced < current ? "BAIXAR" : "OK",

        reason: reason,
      };
    }

    /*
     * PRIORIDADE 3:
     * abaixo da referencia.
     *
     * Nunca aumentar apenas porque o
     * preco esta baixo. Exigir vendas
     * observadas e nenhuma reclamacao.
     */
    if (
      current < target &&
      complaints === 0 &&
      observation &&
      observation.sold >= CFG.minObservedSales
    ) {
      var maximumNext = roundPrice(current * (1 + strategy().maxIncrease));

      var increased = Math.min(target, maximumNext);

      increased = Math.max(current, roundPrice(increased));

      return {
        price: increased,

        action: increased > current ? "SUBIR" : "OK",

        reason:
          observation.sold +
          " clientes atendidos no periodo, " +
          "sem reclamacoes recentes de preco. " +
          "Aumento experimental.",
      };
    }

    return {
      price: current,
      action: "MANTER",
      reason: observation
        ? "Preco aceitavel ou evidencia " + "insuficiente para aumento."
        : "Aguardando historico de " + "vendas para validar aumento.",
    };
  }

  function buildShops() {
    var rows = [];
    var complaints = collectComplaints();

    (map.rides || []).forEach(function (ride) {
      if (!ride || ride.classification !== "stall" || !ride.object) {
        return;
      }

      var productIds = [ride.object.shopItem, ride.object.shopItemSecondary];

      var observation = salesObservation(ride);

      for (var slot = 0; slot < 2; slot++) {
        var itemId = productIds[slot];

        if (!valid(itemId) || itemId === 255 || itemId < 0) {
          continue;
        }

        var current = getPrice(ride, slot);

        if (current === null) {
          continue;
        }

        var item = ITEMS[itemId];

        // Nao atribuir nomes ou custos ficticios.
        var name = item ? item[0] : "Produto ID " + itemId;

        var count = item ? complaints[item[3]] || 0 : 0;

        var recommendation = shopRecommendation(
          ride,
          itemId,
          current,
          count,
          observation,
        );

        rows.push({
          kind: "stall",
          rideId: ride.id,
          slot: slot,
          itemId: itemId,

          name: ride.name + " - " + name,

          current: current,
          recommended: recommendation.price,

          action: recommendation.action,
          reason: recommendation.reason,

          base: item ? item[1] : null,
          cost: item ? item[2] : null,

          complaints: count,
          observation: observation,

          popularity: null,
          satisfaction: null,
          value: null,
        });
      }
    });

    return rows;
  }

  // ============================================================
  // ANALISE
  // ============================================================

  function analyze(keepStatus, preferred, tabOverride) {
    if (S.busy) return;

    sampleSales();

    var tab = tabOverride === undefined ? S.tab : tabOverride;

    if (preferred === undefined) {
      var previous = S.rows[tab][S.selected[tab]];

      preferred = previous ? key(previous) : null;
    }

    var rows = tab === 0 ? buildRides() : buildShops();

    var rank = {
      BAIXAR: 0,
      SUBIR: 1,
      OK: 2,
      MANTER: 3,
      AGUARDAR: 4,
      PROTEGIDO: 5,
      MANUAL: 6,
      "SEM DADOS": 7,
    };

    rows.sort(function (a, b) {
      var difference = rank[a.action] - rank[b.action];

      if (difference) return difference;

      return (
        Math.abs(b.recommended - b.current) -
        Math.abs(a.recommended - a.current)
      );
    });

    S.rows[tab] = rows;
    S.analyzed[tab] = true;

    var index = rows.length ? 0 : -1;

    if (preferred) {
      rows.forEach(function (row, i) {
        if (key(row) === preferred) {
          index = i;
        }
      });
    }

    S.selected[tab] = index;

    if (!keepStatus) {
      S.status =
        rows.length + " itens analisados. Nenhum " + "preco foi alterado.";
    }

    updateUI();
  }

  // ============================================================
  // APLICAR PRECO - SEGURANCA
  // ============================================================

  function applyPrice(row, done) {
    /*
     * GUARDA-CHUVA:
     * bloqueio antes de qualquer GameAction.
     */
    if (protectedRow(row)) {
      done(false, "Guarda-chuva protegido.");
      return;
    }

    var ride = getRide(row.rideId);

    if (!ride) {
      done(false, "Atracao ou loja inexistente.");
      return;
    }

    // Verificar se o produto ainda e o mesmo.
    if (row.kind === "stall") {
      if (ride.classification !== "stall" || !ride.object) {
        done(false, "A loja mudou.");
        return;
      }

      var itemId =
        row.slot === 0 ? ride.object.shopItem : ride.object.shopItemSecondary;

      /*
       * SEGUNDO BLOQUEIO:
       * impede mudar guarda-chuva mesmo
       * se a lista estiver desatualizada.
       */
      if (isUmbrella(itemId)) {
        done(false, "Guarda-chuva protegido na execucao.");
        return;
      }

      if (itemId !== row.itemId) {
        done(false, "O produto da loja mudou.");
        return;
      }
    }

    var before = getPrice(ride, row.slot);

    if (before === null) {
      done(false, "Preco indisponivel.");
      return;
    }

    if (before !== row.current) {
      done(false, "Preco alterado desde a analise.");
      return;
    }

    if (
      !valid(row.recommended) ||
      row.recommended < 0 ||
      row.recommended >
        (row.kind === "ride" ? CFG.maxRidePrice : CFG.maxShopPrice)
    ) {
      done(false, "Preco recomendado invalido.");
      return;
    }

    if (before === row.recommended) {
      done(true, "Preco ja aplicado.", true);
      return;
    }

    var args = {
      ride: row.rideId,
      price: row.recommended,
      isPrimaryPrice: row.slot === 0,
    };

    try {
      context.queryAction("ridesetprice", args, function (queryResult) {
        var error = errorOf(queryResult);

        if (error) {
          done(false, "Consulta: " + error);
          return;
        }

        try {
          context.executeAction("ridesetprice", args, function (result) {
            var executionError = errorOf(result);

            if (executionError) {
              done(false, executionError);
              return;
            }

            var updated = getRide(row.rideId);

            var after = getPrice(updated, row.slot);

            if (after === row.recommended) {
              /*
               * Nao misturar dados de
               * vendas de precos antigos
               * com a nova observacao.
               */
              if (row.kind === "stall") {
                delete S.history[String(row.rideId)];
              }

              done(true, money(before) + " -> " + money(after), false);
            } else {
              done(false, "O jogo nao confirmou " + "o novo preco.");
            }
          });
        } catch (e) {
          done(false, String(e));
        }
      });
    } catch (e) {
      done(false, String(e));
    }
  }

  // ============================================================
  // APLICAR SELECIONADO
  // ============================================================

  function applySelected() {
    if (S.busy) return;

    var tab = S.tab;
    var row = currentRow();

    if (!pending(row)) {
      setStatus("Nenhuma alteracao disponivel " + "para este item.");
      return;
    }

    S.busy = true;

    setStatus("Aplicando: " + row.name);

    applyPrice(row, function (success, message) {
      S.busy = false;

      analyze(true, key(row), tab);

      S.status = success
        ? "Confirmado: " + row.name + " | " + message
        : "Falha: " + row.name + " | " + message;

      updateUI();
    });
  }

  // ============================================================
  // APLICAR TODOS
  // ============================================================

  function applyAll() {
    if (S.busy) return;

    if (!S.analyzed[S.tab]) {
      setStatus("Analise primeiro.");
      return;
    }

    var tab = S.tab;

    /*
     * GUARDA-CHUVA NUNCA ENTRA AQUI.
     */
    var work = currentRows().filter(function (row) {
      return pending(row) && !protectedRow(row);
    });

    if (!work.length) {
      setStatus("Nenhum preco pendente nesta aba.");
      return;
    }

    S.busy = true;

    var index = 0;
    var changed = 0;
    var failed = 0;
    var skipped = 0;
    var firstFailure = "";

    function next() {
      if (index >= work.length) {
        S.busy = false;

        analyze(true, null, tab);

        S.status =
          "Concluido: " +
          changed +
          " alterados, " +
          skipped +
          " ja atualizados, " +
          failed +
          " falhas.";

        if (firstFailure) {
          S.status += " Primeira falha: " + firstFailure;
        }

        updateUI();
        return;
      }

      var row = work[index++];

      S.status = "Aplicando " + index + "/" + work.length + ": " + row.name;

      updateUI();

      applyPrice(row, function (success, message, already) {
        if (success && already) {
          skipped++;
        } else if (success) {
          changed++;
        } else {
          failed++;

          if (!firstFailure) {
            firstFailure = row.name + ": " + message;
          }

          log(row.name + ": " + message);
        }

        next();
      });
    }

    next();
  }

  // ============================================================
  // INTERFACE
  // ============================================================

  function widget(name) {
    try {
      return S.window && S.window.findWidget(name);
    } catch (e) {
      return null;
    }
  }

  function setText(name, value) {
    var w = widget(name);

    if (w) {
      w.text = String(value);
    }
  }

  function detail(row) {
    if (!row) {
      return "Selecione um item da tabela.";
    }

    if (protectedRow(row)) {
      return (
        row.name +
        "\n" +
        "Atual: " +
        money(row.current) +
        " | Desejado: " +
        money(CFG.umbrellaTarget) +
        "\n" +
        "PROTEGIDO: nunca sera alterado " +
        "pelo plugin."
      );
    }

    if (row.kind === "ride") {
      return (
        row.name +
        "\n" +
        "Atual: " +
        money(row.current) +
        " | Sugerido: " +
        money(row.recommended) +
        "\n" +
        "Valor da atracao: " +
        (valid(row.value) ? money(row.value) : "-") +
        " | Popularidade: " +
        (valid(row.popularity) ? row.popularity + "%" : "-") +
        "\n" +
        row.action +
        ": " +
        row.reason
      );
    }

    var sales = row.observation
      ? row.observation.sold + " compras na barraca no periodo"
      : "Historico de vendas insuficiente";

    return (
      row.name +
      "\n" +
      "Atual: " +
      money(row.current) +
      " | Sugerido: " +
      money(row.recommended) +
      "\n" +
      "Valor-base: " +
      (row.base !== null ? money(row.base) : "-") +
      " | Custo-base: " +
      (row.cost !== null ? money(row.cost) : "-") +
      " | Reclamacoes: " +
      row.complaints +
      "\n" +
      sales +
      "\n" +
      row.action +
      ": " +
      row.reason
    );
  }

  function updateUI() {
    if (!S.window) return;

    var rows = currentRows();
    var selected = currentRow();

    var changes = rows.filter(pending).length;

    for (var i = 0; i < 2; i++) {
      var tab = widget("tab" + i);

      if (tab) {
        tab.isPressed = S.tab === i;
      }
    }

    var list = widget("items");

    if (list) {
      list.items = rows.map(function (row) {
        return [
          row.name,
          money(row.current),
          protectedRow(row) ? "TRAVADO" : money(row.recommended),
          row.action,
        ];
      });

      try {
        list.selectedCell =
          S.selected[S.tab] >= 0
            ? {
                row: S.selected[S.tab],
                column: 0,
              }
            : null;
      } catch (e) {}
    }

    setText(
      "summary",
      (S.tab === 0 ? "Atracoes: " : "Produtos: ") +
        rows.length +
        " | Mudancas: " +
        changes +
        " | Estrategia: " +
        strategy().name,
    );

    setText(
      "help",
      S.tab === 0
        ? "Precos por valor da atracao."
        : "Valor-base + opinioes + vendas observadas.",
    );

    setText("details", detail(selected));

    setText("status", S.status);

    var dropdown = widget("strategy");

    if (dropdown) {
      dropdown.selectedIndex = S.strategy;

      dropdown.isDisabled = S.busy;
    }

    var analyzeButton = widget("analyze");
    var oneButton = widget("apply_one");
    var allButton = widget("apply_all");

    if (analyzeButton) {
      analyzeButton.isDisabled = S.busy;
    }

    if (oneButton) {
      oneButton.isDisabled = S.busy || !pending(selected);
    }

    if (allButton) {
      allButton.isDisabled = S.busy || changes === 0;
    }
  }

  function switchTab(index) {
    if (S.busy) return;

    S.tab = index;

    if (!S.analyzed[index]) {
      analyze(false, null, index);
    } else {
      updateUI();
    }
  }

  function openWindow() {
    if (typeof ui === "undefined") return;

    var existing = ui.getWindow(WINDOW);

    if (existing) {
      existing.bringToFront();
      return;
    }

    var widgets = [
      {
        type: "button",
        name: "tab0",
        x: 10,
        y: 22,
        width: 125,
        height: 25,
        text: "Atracoes",
        onClick: function () {
          switchTab(0);
        },
      },
      {
        type: "button",
        name: "tab1",
        x: 143,
        y: 22,
        width: 155,
        height: 25,
        text: "Lojas e barraquinhas",
        onClick: function () {
          switchTab(1);
        },
      },
      {
        type: "button",
        name: "analyze",
        x: 308,
        y: 22,
        width: 155,
        height: 25,
        text: "Analisar precos",
        onClick: function () {
          analyze(false);
        },
      },
      {
        type: "label",
        name: "strategy_label",
        x: 10,
        y: 60,
        width: 83,
        height: 18,
        text: "Estrategia:",
      },
      {
        type: "dropdown",
        name: "strategy",
        x: 99,
        y: 55,
        width: 160,
        height: 22,
        items: STRATEGIES.map(function (s) {
          return s.name;
        }),
        selectedIndex: S.strategy,
        onChange: function (index) {
          if (S.busy || index < 0 || index >= STRATEGIES.length) {
            return;
          }

          S.strategy = index;
          analyze(false);
        },
      },
      {
        type: "label",
        name: "help",
        x: 270,
        y: 60,
        width: 330,
        height: 18,
        text: "",
      },
      {
        type: "label",
        name: "summary",
        x: 10,
        y: 89,
        width: 590,
        height: 18,
        text: "",
      },
      {
        type: "listview",
        name: "items",
        x: 10,
        y: 115,
        width: 600,
        height: 235,
        isStriped: true,
        showColumnHeaders: true,
        canSelect: true,
        scrollbars: "vertical",
        columns: [
          {
            header: "Atracao / Produto",
            width: 305,
          },
          {
            header: "Atual",
            width: 85,
          },
          {
            header: "Sugerido",
            width: 100,
          },
          {
            header: "Acao",
            width: 85,
          },
        ],
        items: [],
        onClick: function (index) {
          if (
            S.busy ||
            typeof index !== "number" ||
            index < 0 ||
            index >= currentRows().length
          ) {
            return;
          }

          S.selected[S.tab] = index;
          updateUI();
        },
      },
      {
        type: "groupbox",
        name: "details_group",
        x: 10,
        y: 360,
        width: 600,
        height: 135,
        text: "Detalhes e diagnostico",
      },
      {
        type: "label",
        name: "details",
        x: 23,
        y: 383,
        width: 570,
        height: 105,
        text: "",
      },
      {
        type: "button",
        name: "apply_one",
        x: 10,
        y: 505,
        width: 190,
        height: 26,
        text: "Aplicar selecionado",
        onClick: applySelected,
      },
      {
        type: "button",
        name: "apply_all",
        x: 211,
        y: 505,
        width: 190,
        height: 26,
        text: "Aplicar todos da aba",
        onClick: applyAll,
      },
      {
        type: "label",
        name: "umbrella_warning",
        x: 10,
        y: 542,
        width: 600,
        height: 18,
        text: "Guarda-chuva protegido: " + "o plugin nunca modifica seu preco.",
      },
      {
        type: "label",
        name: "status",
        x: 10,
        y: 571,
        width: 600,
        height: 55,
        text: S.status,
      },
    ];

    S.window = ui.openWindow({
      classification: WINDOW,
      title: "Finance Advisor PT-BR " + VERSION,
      width: 620,
      height: 640,
      colours: [24, 24],
      widgets: widgets,
      onClose: function () {
        S.window = null;
      },
    });

    S.tab = 0;

    sampleSales();
    analyze(false);
  }

  // ============================================================
  // MAIN
  // ============================================================

  function main() {
    if (typeof ui !== "undefined") {
      ui.registerMenuItem("Finance Advisor PT-BR", openWindow);
    }

    context.subscribe("interval.tick", function () {
      var now = date.ticksElapsed;

      if (
        S.lastSampleTick < 0 ||
        now < S.lastSampleTick ||
        now - S.lastSampleTick >= CFG.sampleTicks
      ) {
        sampleSales();
      }
    });

    context.subscribe("map.change", function () {
      S.analyzed = [false, false];
      S.rows = [[], []];
      S.selected = [-1, -1];
      S.history = {};
      S.lastSampleTick = -1;

      S.status = "Mapa alterado. Analise novamente.";

      updateUI();
    });

    log("Plugin carregado.");
  }

  registerPlugin({
    name: "Finance Advisor PT-BR",
    version: VERSION,
    authors: ["Kaoan / OpenAI (adaptacao)"],
    type: "local",
    licence: "MIT",
    targetApiVersion: 117,
    minApiVersion: 117,
    main: main,
  });
})();
