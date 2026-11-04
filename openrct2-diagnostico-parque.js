/**
 * Diagnóstico do Parque - OpenRCT2
 * Versão 2.1.0
 *
 * Somente leitura.
 *
 * Novidades 2.1:
 * - nova aba "Mapa de problemas";
 * - localiza regiões com visitantes reclamando de lotação;
 * - localiza visitantes perdidos;
 * - separa perdidos tentando sair;
 * - botão "Localizar" centraliza a câmera no hotspot selecionado;
 * - recomendações da nota consideram lotação como possível causa de baixa felicidade.
 */
(function () {
  "use strict";

  var PLUGIN = {
    name: "Diagnóstico do Parque",
    version: "2.1.0",
    windowId: "diagnostico-parque-ptbr-v21",
  };

  var CONFIG = {
    refreshTicks: 160,
    thoughtFreshness: 5,
    maxNeeds: 8,
    maxAwards: 8,
    ridesPerPage: 7,
    problemsPerPage: 7,
    problemCellTiles: 8,
  };

  var THOUGHT_LABELS = {
    hungry: "Fome",
    thirsty: "Sede",
    toilet: "Banheiro",
    bad_litter: "Lixo",
    path_disgusting: "Caminho nojento",
    vandalism: "Vandalismo",
    lost: "Perdidos",
    cant_find: "Não encontram atração",
    cant_find_exit: "Não encontram saída",
    crowded: "Muito lotado",
    queuing_ages: "Fila longa",
    tired: "Cansaço",
    sick: "Enjoo",
    very_sick: "Muito enjoo",
    bad_value: "Preço ruim",
    not_paying: "Não querem pagar",
    intense: "Intensidade excessiva",
    more_thrilling: "Querem mais emoção",
    scenery: "Elogiam cenário",
    very_clean: "Elogiam limpeza",
    good_value: "Bom custo-benefício",
  };

  var State = {
    window: null,
    tab: 0,
    lastRefresh: 0,
    snapshot: null,
    ridePage: 0,
    selectedRideId: -1,
    problemPage: 0,
    selectedProblemIndex: -1,
    status: "Atualizando diagnóstico...",
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function percent(value, total) {
    return total > 0 ? (value / total) * 100 : 0;
  }

  function pctText(value) {
    return value.toFixed(1).replace(".", ",") + "%";
  }

  function fmtRating(value) {
    if (typeof value !== "number" || value < 0) return "-";
    return (value / 100).toFixed(2).replace(".", ",");
  }

  function money(value) {
    try {
      return context.formatString("{CURRENCY}", value || 0);
    } catch (e) {
      return String(value || 0);
    }
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function intDiv(a, b) {
    return b ? Math.floor(a / b) : 0;
  }

  function signed(value) {
    return value >= 0 ? "+" + value : String(value);
  }

  function freshThought(guest, type) {
    var thoughts = safeArray(guest && guest.thoughts);

    for (var i = 0; i < thoughts.length; i++) {
      var thought = thoughts[i];

      if (
        thought &&
        thought.type === type &&
        thought.freshness <= CONFIG.thoughtFreshness
      ) {
        return true;
      }
    }

    return false;
  }

  function collectThoughts(guests) {
    var counts = {};

    Object.keys(THOUGHT_LABELS).forEach(function (key) {
      counts[key] = 0;
    });

    for (var i = 0; i < guests.length; i++) {
      var thoughts = safeArray(guests[i] && guests[i].thoughts);

      for (var j = 0; j < thoughts.length; j++) {
        var thought = thoughts[j];

        if (!thought || thought.freshness > CONFIG.thoughtFreshness) {
          continue;
        }

        if (counts[thought.type] !== undefined) {
          counts[thought.type]++;
        }
      }
    }

    return counts;
  }

  function isLeavingPark(guest) {
    try {
      return !!guest.getFlag("leavingPark");
    } catch (e) {
      return false;
    }
  }

  function collectGuestStats(guests) {
    var stats = {
      inPark: 0,
      happy: 0,
      sumHappiness: 0,
      lowHappy: 0,
      veryLowHappy: 0,
      lostAny: 0,
      lostLeaving: 0,
      crowdedGuests: 0,
      lowHunger: 0,
      lowThirst: 0,
      highToilet: 0,
      lowEnergy: 0,
    };

    for (var i = 0; i < guests.length; i++) {
      var guest = guests[i];

      if (!guest || !guest.isInPark) {
        continue;
      }

      stats.inPark++;

      var happiness = typeof guest.happiness === "number" ? guest.happiness : 0;

      stats.sumHappiness += happiness;

      if (happiness > 128) {
        stats.happy++;
      } else {
        stats.lowHappy++;
      }

      if (happiness < 80) {
        stats.veryLowHappy++;
      }

      if (guest.isLost) {
        stats.lostAny++;

        if (isLeavingPark(guest)) {
          stats.lostLeaving++;
        }
      }

      if (freshThought(guest, "crowded")) {
        stats.crowdedGuests++;
      }

      if (typeof guest.hunger === "number" && guest.hunger < 80) {
        stats.lowHunger++;
      }

      if (typeof guest.thirst === "number" && guest.thirst < 80) {
        stats.lowThirst++;
      }

      if (typeof guest.toilet === "number" && guest.toilet > 180) {
        stats.highToilet++;
      }

      if (typeof guest.energy === "number" && guest.energy < 64) {
        stats.lowEnergy++;
      }
    }

    stats.happyPct = percent(stats.happy, stats.inPark);

    stats.avgHappiness = stats.inPark ? stats.sumHappiness / stats.inPark : 0;

    return stats;
  }

  // ============================================================
  // MAPA DE PROBLEMAS
  // ============================================================

  function collectProblemRegions(guests) {
    var cells = {};

    var size = CONFIG.problemCellTiles;

    for (var i = 0; i < guests.length; i++) {
      var guest = guests[i];

      if (!guest || !guest.isInPark) {
        continue;
      }

      var crowded = freshThought(guest, "crowded");

      var lost = !!guest.isLost;

      var lostLeaving = lost && isLeavingPark(guest);

      if (!crowded && !lost) {
        continue;
      }

      var tx = Math.floor((guest.x || 0) / 32);

      var ty = Math.floor((guest.y || 0) / 32);

      var cx = Math.floor(tx / size);

      var cy = Math.floor(ty / size);

      var cellKey = cx + "," + cy;

      if (!cells[cellKey]) {
        cells[cellKey] = {
          total: 0,
          crowded: 0,
          lost: 0,
          lostLeaving: 0,
          sumX: 0,
          sumY: 0,
          sumZ: 0,
        };
      }

      var cell = cells[cellKey];

      cell.total++;

      if (crowded) {
        cell.crowded++;
      }

      if (lost) {
        cell.lost++;
      }

      if (lostLeaving) {
        cell.lostLeaving++;
      }

      cell.sumX += guest.x || 0;

      cell.sumY += guest.y || 0;

      cell.sumZ += guest.z || 0;
    }

    var regions = [];

    Object.keys(cells).forEach(function (cellKey) {
      var cell = cells[cellKey];

      var kind = "PERDIDOS";

      if (cell.crowded > 0 && cell.crowded >= cell.lost) {
        kind = "LOTAÇÃO";
      }

      if (cell.lostLeaving > 0) {
        kind = "SAÍDA";
      }

      /*
       * Perdidos tentando sair recebem
       * prioridade alta.
       *
       * Lotação também ganha peso porque
       * costuma derrubar felicidade.
       */
      var score = cell.crowded * 2 + cell.lost * 2 + cell.lostLeaving * 5;

      var worldX = Math.round(cell.sumX / cell.total);

      var worldY = Math.round(cell.sumY / cell.total);

      var worldZ = Math.round(cell.sumZ / cell.total);

      regions.push({
        kind: kind,

        score: score,

        total: cell.total,

        crowded: cell.crowded,

        lost: cell.lost,

        lostLeaving: cell.lostLeaving,

        x: worldX,

        y: worldY,

        z: worldZ,

        tileX: Math.round(worldX / 32),

        tileY: Math.round(worldY / 32),
      });
    });

    regions.sort(function (a, b) {
      return b.score - a.score || b.total - a.total;
    });

    return regions;
  }

  // ============================================================
  // LIXO
  // ============================================================

  function collectLitterStats() {
    var all = [];

    try {
      all = map.getAllEntities("litter") || [];
    } catch (e) {}

    var now = 0;

    try {
      now = date.ticksElapsed || 0;
    } catch (e) {}

    var old = 0;

    for (var i = 0; i < all.length; i++) {
      var litter = all[i];

      if (!litter) {
        continue;
      }

      var age = now - (litter.creationTick || now);

      if (age >= 7680) {
        old++;
      }
    }

    return {
      total: all.length,

      old: old,
    };
  }

  // ============================================================
  // ATRAÇÕES
  // ============================================================

  function collectRideRatingStats(rides) {
    var stats = {
      rideCount: 0,
      ratedCount: 0,
      totalUptime: 0,
      totalExcitement: 0,
      totalIntensity: 0,
      broken: 0,
      highDowntime: 0,
    };

    for (var i = 0; i < rides.length; i++) {
      var ride = rides[i];

      if (!ride) {
        continue;
      }

      stats.rideCount++;

      var downtime =
        typeof ride.downtime === "number" ? clamp(ride.downtime, 0, 100) : 0;

      stats.totalUptime += 100 - downtime;

      if (downtime > 20) {
        stats.highDowntime++;
      }

      if (ride.breakdown && ride.breakdown !== "none") {
        stats.broken++;
      }

      if (
        typeof ride.excitement === "number" &&
        ride.excitement >= 0 &&
        typeof ride.intensity === "number" &&
        ride.intensity >= 0
      ) {
        stats.totalExcitement += intDiv(ride.excitement, 8);

        stats.totalIntensity += intDiv(ride.intensity, 8);

        stats.ratedCount++;
      }
    }

    stats.avgUptime = stats.rideCount
      ? intDiv(stats.totalUptime, stats.rideCount)
      : 0;

    stats.avgExcitement = stats.ratedCount
      ? intDiv(stats.totalExcitement, stats.ratedCount)
      : 0;

    stats.avgIntensity = stats.ratedCount
      ? intDiv(stats.totalIntensity, stats.ratedCount)
      : 0;

    return stats;
  }

  // ============================================================
  // NOTA DO PARQUE
  // ============================================================

  function calculateRatingBreakdown(guestStats, rideStats, litterStats) {
    var difficult = false;

    try {
      difficult = park.getFlag("difficultParkRating");
    } catch (e) {}

    var base = difficult ? 1050 : 1150;

    var guestsNow =
      typeof park.guests === "number" ? park.guests : guestStats.inPark;

    var parts = [];

    parts.push({
      key: "guests",

      label: "Quantidade de visitantes",

      value: -(150 - intDiv(Math.min(2000, guestsNow), 13)),

      detail: guestsNow + " visitantes no parque",
    });

    var happinessPart = -500;

    if (guestsNow > 0) {
      happinessPart +=
        2 *
        Math.min(
          250,

          intDiv(
            guestStats.happy * 300,

            guestsNow,
          ),
        );
    }

    parts.push({
      key: "happiness",

      label: "Felicidade dos visitantes",

      value: happinessPart,

      detail:
        guestStats.happy +
        "/" +
        guestsNow +
        " felizes (>128) • média " +
        guestStats.avgHappiness.toFixed(0) +
        "/255 • " +
        guestStats.crowdedGuests +
        " reclamando de lotação",
    });

    var lostPenalty =
      guestStats.lostLeaving > 25 ? -(guestStats.lostLeaving - 25) * 7 : 0;

    parts.push({
      key: "lost",

      label: "Perdidos tentando sair",

      value: lostPenalty,

      detail:
        guestStats.lostLeaving + " tentando sair perdidos • tolerância: 25",
    });

    var uptimePart = -200;

    if (rideStats.rideCount > 0) {
      uptimePart += rideStats.avgUptime * 2;
    }

    parts.push({
      key: "uptime",

      label: "Disponibilidade das atrações",

      value: uptimePart,

      detail:
        "uptime médio " +
        rideStats.avgUptime +
        "% • " +
        rideStats.broken +
        " quebrada(s)",
    });

    var balancePart = -100;

    if (rideStats.ratedCount > 0) {
      var excitementDeviation = Math.min(
        intDiv(Math.abs(rideStats.avgExcitement - 46), 2),
        50,
      );

      var intensityDeviation = Math.min(
        intDiv(Math.abs(rideStats.avgIntensity - 65), 2),
        50,
      );

      balancePart += 100 - excitementDeviation - intensityDeviation;
    }

    parts.push({
      key: "balance",

      label: "Perfil emoção/intensidade",

      value: balancePart,

      detail:
        rideStats.ratedCount +
        " atrações avaliadas • emoção " +
        rideStats.avgExcitement +
        " • intensidade " +
        rideStats.avgIntensity,
    });

    var cappedExcitement = Math.min(1000, rideStats.totalExcitement);

    var cappedIntensity = Math.min(1000, rideStats.totalIntensity);

    parts.push({
      key: "volume",

      label: "Quantidade/qualidade das atrações",

      value: -200 + intDiv(cappedExcitement + cappedIntensity, 10),

      detail:
        "soma de emoção " +
        cappedExcitement +
        " • intensidade " +
        cappedIntensity,
    });

    parts.push({
      key: "litter",

      label: "Lixo velho no chão",

      value: -(4 * Math.min(150, litterStats.old)),

      detail:
        litterStats.old +
        " item(ns) com ~5 min ou mais • total atual: " +
        litterStats.total,
    });

    parts.push({
      key: "casualty",

      label: "Acidentes recentes",

      value: -(park.casualtyPenalty || 0),

      detail: "penalidade atual: " + (park.casualtyPenalty || 0),
    });

    var raw = base;

    for (var i = 0; i < parts.length; i++) {
      raw += parts[i].value;
    }

    return {
      base: base,

      difficult: difficult,

      parts: parts,

      raw: raw,

      estimated: clamp(raw, 0, 999),

      actual: park.rating,
    };
  }

  function ratingSeverity(part) {
    if (part.value <= -300) {
      return "CRÍTICO";
    }

    if (part.value <= -150) {
      return "MUITO RUIM";
    }

    if (part.value <= -60) {
      return "ATENÇÃO";
    }

    if (part.value < 0) {
      return "LEVE";
    }

    return "OK";
  }

  function buildRatingRecommendations(snapshot) {
    var recommendations = [];

    var parts = snapshot.ratingBreakdown.parts.slice().sort(function (a, b) {
      return a.value - b.value;
    });

    for (var i = 0; i < parts.length && recommendations.length < 4; i++) {
      var part = parts[i];

      if (part.value >= -25) {
        continue;
      }

      if (part.key === "happiness") {
        if (snapshot.guestStats.crowdedGuests > 0) {
          recommendations.push(
            "A felicidade está baixa e " +
              snapshot.guestStats.crowdedGuests +
              " visitante(s) reclamam de lotação. " +
              "Abra “Mapa de problemas” para localizar os congestionamentos.",
          );
        } else {
          recommendations.push(
            "Felicidade baixa: " +
              snapshot.guestStats.lowHappy +
              " visitante(s) estão em 128 ou menos. " +
              "Veja Reclamações para encontrar a causa.",
          );
        }
      } else if (part.key === "litter") {
        recommendations.push(
          "Existem " +
            snapshot.litterStats.old +
            " lixos velhos. Cada um tira 4 pontos, até -600.",
        );
      } else if (part.key === "lost") {
        recommendations.push(
          "Há " +
            snapshot.guestStats.lostLeaving +
            " visitante(s) perdidos tentando sair. " +
            "Abra “Mapa de problemas” para localizar os grupos.",
        );
      } else if (part.key === "uptime") {
        recommendations.push(
          "Uptime médio das atrações: " +
            snapshot.ratingRideStats.avgUptime +
            "%. Priorize atrações quebradas e downtime alto.",
        );
      } else if (part.key === "volume") {
        recommendations.push(
          "O conjunto de atrações ainda contribui pouco para a avaliação.",
        );
      } else if (part.key === "balance") {
        recommendations.push(
          "O perfil médio de emoção/intensidade está longe da faixa que favorece a avaliação.",
        );
      } else if (part.key === "casualty") {
        recommendations.push(
          "Existe penalidade por acidentes de " +
            (park.casualtyPenalty || 0) +
            " pontos.",
        );
      }
    }

    if (!recommendations.length) {
      recommendations.push(
        "Nenhum componente isolado está muito ruim. Veja Reclamações e Mapa de problemas.",
      );
    }

    return recommendations;
  }

  // ============================================================
  // RECLAMAÇÕES
  // ============================================================

  function needSeverity(count, guests) {
    var ratio = count / Math.max(guests, 1);

    if (count === 0) {
      return "OK";
    }

    if (count <= 5 && ratio < 1 / 128) {
      return "OK";
    }

    if (count <= 12 && ratio < 1 / 64) {
      return "ATENÇÃO";
    }

    return "CRÍTICO";
  }

  function buildNeeds(thoughts, guests) {
    var definitions = [
      [
        "crowded",
        "Muito lotado",
        "Abra “Mapa de problemas” para localizar os congestionamentos.",
      ],

      ["hungry", "Fome", "Mais comida ou melhor distribuição das lojas."],

      ["thirsty", "Sede", "Adicione bebidas em áreas movimentadas."],

      [
        "toilet",
        "Banheiros",
        "Adicione banheiros perto das áreas movimentadas.",
      ],

      [
        "queuing_ages",
        "Filas longas",
        "Revise capacidade, trens/carros e tamanho das filas.",
      ],

      ["bad_litter", "Lixo", "Aumente lixeiras e cobertura de zeladores."],

      [
        "path_disgusting",
        "Caminhos nojentos",
        "Há sujeira ou vômito acumulado nos caminhos.",
      ],

      ["vandalism", "Vandalismo", "Revise segurança e objetos quebrados."],

      [
        "lost",
        "Perdidos",
        "Abra “Mapa de problemas” para localizar os grupos.",
      ],

      [
        "cant_find_exit",
        "Não encontram saída",
        "Revise circulação e caminhos até a saída.",
      ],

      ["cant_find", "Não encontram atração", "Revise acessibilidade e layout."],

      [
        "tired",
        "Cansaço",
        "Considere bancos, caminhos menos longos e transporte.",
      ],

      ["sick", "Enjoo", "Revise intensidade e primeiros socorros."],

      ["very_sick", "Muito enjoo", "Há um problema forte de náusea."],

      ["bad_value", "Preço ruim", "Revise preços das atrações ou entrada."],

      [
        "not_paying",
        "Não querem pagar",
        "Alguns preços estão sendo rejeitados.",
      ],

      [
        "intense",
        "Intensidade excessiva",
        "Muitos visitantes podem estar rejeitando atrações intensas.",
      ],

      [
        "more_thrilling",
        "Querem mais emoção",
        "Pode faltar variedade de atrações emocionantes.",
      ],
    ];

    var result = definitions.map(function (d) {
      var count = thoughts[d[0]] || 0;

      return {
        key: d[0],

        label: d[1],

        count: count,

        level: needSeverity(count, guests),

        hint: d[2],
      };
    });

    result.sort(function (a, b) {
      return b.count - a.count;
    });

    return result;
  }

  // ============================================================
  // DIAGNÓSTICO DAS ATRAÇÕES
  // ============================================================

  function diagnoseRide(ride) {
    var problems = [];

    var score = 100;

    if (ride.status !== "open") {
      problems.push("Não está aberta");

      score -= 15;
    }

    if (ride.breakdown && ride.breakdown !== "none") {
      problems.push("Está quebrada");

      score -= 35;
    }

    if (typeof ride.reliability === "number" && ride.reliability < 50) {
      problems.push("Confiabilidade baixa");

      score -= 20;
    }

    if (
      typeof ride.satisfaction === "number" &&
      ride.satisfaction >= 0 &&
      ride.satisfaction < 50
    ) {
      problems.push("Satisfação baixa");

      score -= 20;
    }

    if (
      typeof ride.popularity === "number" &&
      ride.popularity >= 0 &&
      ride.popularity < 40
    ) {
      problems.push("Popularidade baixa");

      score -= 15;
    }

    if (typeof ride.downtime === "number" && ride.downtime > 20) {
      problems.push("Downtime alto");

      score -= 20;
    }

    return {
      id: ride.id,

      name: ride.name || "Atração " + ride.id,

      score: clamp(score, 0, 100),

      problems: problems,

      excitement: ride.excitement,

      intensity: ride.intensity,

      nausea: ride.nausea,

      satisfaction: ride.satisfaction,

      popularity: ride.popularity,

      reliability: ride.reliability,

      downtime: ride.downtime,

      status: ride.status,

      breakdown: ride.breakdown,
    };
  }

  function buildRideDiagnostics(rides) {
    var result = [];

    for (var i = 0; i < rides.length; i++) {
      if (rides[i] && rides[i].classification === "ride") {
        result.push(diagnoseRide(rides[i]));
      }
    }

    result.sort(function (a, b) {
      return a.score - b.score || a.name.localeCompare(b.name);
    });

    return result;
  }

  // ============================================================
  // PRÊMIOS
  // ============================================================

  function buildAwards(snapshot) {
    var guests = Math.max(snapshot.guestStats.inPark, 1);

    var thoughts = snapshot.thoughts;

    var rides = snapshot.rides;

    var untidy =
      (thoughts.bad_litter || 0) +
      (thoughts.path_disgusting || 0) +
      (thoughts.vandalism || 0);

    var lost =
      (thoughts.lost || 0) +
      (thoughts.cant_find || 0) +
      (thoughts.cant_find_exit || 0);

    return [
      {
        name: "Parque mais limpo",

        positive: true,

        eligible: (thoughts.very_clean || 0) > guests / 64 && untidy < 6,

        detail:
          (thoughts.very_clean || 0) +
          " elogios de limpeza; " +
          untidy +
          " reclamações de sujeira.",
      },

      {
        name: "Parque mais sujo",

        positive: false,

        eligible: untidy > guests / 16,

        detail: untidy + " pensamentos sobre lixo/vandalismo/caminhos.",
      },

      {
        name: "Parque mais seguro",

        positive: true,

        eligible: (thoughts.vandalism || 0) <= 2 && park.casualtyPenalty === 0,

        detail:
          (thoughts.vandalism || 0) +
          " reclamações de vandalismo; penalidade de acidentes " +
          park.casualtyPenalty +
          ".",
      },

      {
        name: "Layout mais confuso",

        positive: false,

        eligible: lost >= 10 && lost >= guests / 64,

        detail:
          lost + " pensamentos de pessoas perdidas ou sem encontrar destino.",
      },

      {
        name: "Parque mais decepcionante",

        positive: false,

        eligible:
          park.rating <= 650 &&
          rides.filter(function (ride) {
            return ride.score < 60;
          }).length >= Math.max(1, rides.length / 2),

        detail:
          "Avaliação " +
          park.rating +
          "; " +
          rides.filter(function (ride) {
            return ride.score < 60;
          }).length +
          " atrações críticas.",
      },
    ];
  }

  // ============================================================
  // SNAPSHOT
  // ============================================================

  function createSnapshot() {
    var guests = [];
    var staff = [];
    var rides = map.rides || [];

    try {
      guests = map.getAllEntities("guest") || [];
    } catch (e) {}

    try {
      staff = map.getAllEntities("staff") || [];
    } catch (e) {}

    var guestStats = collectGuestStats(guests);

    var thoughts = collectThoughts(guests);

    var litterStats = collectLitterStats();

    var ratingRideStats = collectRideRatingStats(rides);

    var snapshot = {
      guests: guests,

      staff: staff,

      thoughts: thoughts,

      guestStats: guestStats,

      problemRegions: collectProblemRegions(guests),

      litterStats: litterStats,

      ratingRideStats: ratingRideStats,

      needs: buildNeeds(thoughts, guestStats.inPark),

      rides: buildRideDiagnostics(rides),
    };

    snapshot.ratingBreakdown = calculateRatingBreakdown(
      guestStats,
      ratingRideStats,
      litterStats,
    );

    snapshot.ratingRecommendations = buildRatingRecommendations(snapshot);

    snapshot.awards = buildAwards(snapshot);

    return snapshot;
  }

  // ============================================================
  // UI
  // ============================================================

  var TAB_WIDGETS = {
    0: [
      "grp_rating",
      "rating_head",
      "rating_match",
      "rating0",
      "rating1",
      "rating2",
      "rating3",
      "rating4",
      "rating5",
      "rating6",
      "rating7",
      "rec0",
      "rec1",
      "rec2",
    ],

    1: [
      "grp_needs",
      "needs_summary",
      "need0",
      "need1",
      "need2",
      "need3",
      "need4",
      "need5",
      "need6",
      "need7",
    ],

    2: [
      "grp_map",
      "map_summary",
      "problem0",
      "problem1",
      "problem2",
      "problem3",
      "problem4",
      "problem5",
      "problem6",
      "problem_prev",
      "problem_next",
      "problem_page",
      "problem_detail",
      "problem_locate",
    ],

    3: [
      "grp_rides",
      "rides_summary",
      "rides_prev",
      "rides_next",
      "rides_page",
      "ride0",
      "ride1",
      "ride2",
      "ride3",
      "ride4",
      "ride5",
      "ride6",
      "ride_detail",
    ],

    4: [
      "grp_awards",
      "awards_summary",
      "award0",
      "award1",
      "award2",
      "award3",
      "award4",
      "award5",
      "award6",
      "award7",
    ],
  };

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
    var current = widget(name);

    if (current) {
      current.text = value;
    }
  }

  function setVisible(name, value) {
    var current = widget(name);

    if (current) {
      current.isVisible = value;
    }
  }

  function switchTab(index) {
    State.tab = index;

    if (!State.window) {
      return;
    }

    for (var tab = 0; tab < 5; tab++) {
      var button = widget("tab" + tab);

      if (button) {
        button.isPressed = tab === index;
      }

      var names = TAB_WIDGETS[tab] || [];

      for (var i = 0; i < names.length; i++) {
        setVisible(names[i], tab === index);
      }
    }

    updateUI();
  }

  function refreshSnapshot() {
    State.snapshot = createSnapshot();

    if (State.selectedProblemIndex >= State.snapshot.problemRegions.length) {
      State.selectedProblemIndex = -1;
    }

    State.status = "Diagnóstico atualizado. Nenhuma alteração foi feita.";

    updateUI();
  }

  // ============================================================
  // ATRAÇÕES - PAGINAÇÃO
  // ============================================================

  function ridePageCount() {
    var total = State.snapshot ? State.snapshot.rides.length : 0;

    return Math.max(1, Math.ceil(total / CONFIG.ridesPerPage));
  }

  function currentRideRows() {
    if (!State.snapshot) {
      return [];
    }

    var start = State.ridePage * CONFIG.ridesPerPage;

    return State.snapshot.rides.slice(start, start + CONFIG.ridesPerPage);
  }

  function rideDetailText(ride) {
    if (!ride) {
      return "Selecione uma atração.";
    }

    return (
      ride.name +
      " | Saúde " +
      ride.score +
      "%\n" +
      "Emoção " +
      fmtRating(ride.excitement) +
      " | Intensidade " +
      fmtRating(ride.intensity) +
      " | Náusea " +
      fmtRating(ride.nausea) +
      "\n" +
      "Popularidade " +
      (typeof ride.popularity === "number" ? ride.popularity + "%" : "-") +
      " | Satisfação " +
      (typeof ride.satisfaction === "number" ? ride.satisfaction + "%" : "-") +
      " | Downtime " +
      (typeof ride.downtime === "number" ? ride.downtime + "%" : "-") +
      "\n" +
      "Diagnóstico: " +
      (ride.problems.length
        ? ride.problems.join(", ")
        : "Nenhum problema relevante")
    );
  }

  // ============================================================
  // MAPA DE PROBLEMAS - PAGINAÇÃO
  // ============================================================

  function problemPageCount() {
    var total = State.snapshot ? State.snapshot.problemRegions.length : 0;

    return Math.max(1, Math.ceil(total / CONFIG.problemsPerPage));
  }

  function currentProblemRows() {
    if (!State.snapshot) {
      return [];
    }

    var start = State.problemPage * CONFIG.problemsPerPage;

    return State.snapshot.problemRegions.slice(
      start,
      start + CONFIG.problemsPerPage,
    );
  }

  function selectedProblem() {
    if (
      !State.snapshot ||
      State.selectedProblemIndex < 0 ||
      State.selectedProblemIndex >= State.snapshot.problemRegions.length
    ) {
      return null;
    }

    return State.snapshot.problemRegions[State.selectedProblemIndex];
  }

  function problemDetailText(region) {
    if (!region) {
      return (
        "Selecione uma região.\n" +
        "LOTAÇÃO mostra congestionamentos; SAÍDA mostra perdidos tentando ir embora."
      );
    }

    return (
      region.kind +
      " | tile aproximado X " +
      region.tileX +
      " / Y " +
      region.tileY +
      "\n" +
      "Reclamando de lotação: " +
      region.crowded +
      " | Perdidos: " +
      region.lost +
      " | Perdidos tentando sair: " +
      region.lostLeaving +
      "\n" +
      (region.crowded > 0
        ? "Se houver muita gente aqui, amplie/divida caminhos ou redistribua atrações e lojas."
        : "Revise conexões e caminhos desta região.")
    );
  }

  function locateSelectedProblem() {
    var region = selectedProblem();

    if (!region) {
      State.status = "Selecione uma região primeiro.";

      updateUI();

      return;
    }

    try {
      ui.mainViewport.scrollTo({
        x: region.x,

        y: region.y,

        z: region.z,
      });

      State.status = "Câmera centralizada na região selecionada.";
    } catch (e) {
      State.status = "Não consegui mover a câmera: " + e;
    }

    updateUI();
  }

  // ============================================================
  // UPDATE UI
  // ============================================================

  function updateUI() {
    if (!State.window || !State.snapshot) {
      return;
    }

    var snapshot = State.snapshot;

    var breakdown = snapshot.ratingBreakdown;

    setText("status", State.status);

    setText(
      "rating_head",

      "Avaliação real: " +
        breakdown.actual +
        " / 999" +
        (breakdown.difficult ? " • cenário com avaliação difícil" : ""),
    );

    setText(
      "rating_match",

      "Estimativa pela fórmula: " +
        breakdown.estimated +
        " • diferença: " +
        Math.abs(breakdown.estimated - breakdown.actual) +
        " ponto(s)",
    );

    for (var i = 0; i < 8; i++) {
      var part = breakdown.parts[i];

      setText(
        "rating" + i,

        part
          ? ratingSeverity(part) +
              " | " +
              part.label +
              ": " +
              signed(part.value) +
              " pts\n" +
              part.detail
          : "",
      );
    }

    for (var r = 0; r < 3; r++) {
      setText(
        "rec" + r,

        snapshot.ratingRecommendations[r]
          ? "→ " + snapshot.ratingRecommendations[r]
          : "",
      );
    }

    var complaintTotal = Object.keys(snapshot.thoughts).reduce(
      function (total, key) {
        return total + (snapshot.thoughts[key] || 0);
      },

      0,
    );

    setText(
      "needs_summary",

      "Felizes: " +
        snapshot.guestStats.happy +
        "/" +
        snapshot.guestStats.inPark +
        " (" +
        pctText(snapshot.guestStats.happyPct) +
        ")" +
        " • Lotação: " +
        snapshot.guestStats.crowdedGuests +
        " • Reclamações recentes: " +
        complaintTotal,
    );

    for (var n = 0; n < CONFIG.maxNeeds; n++) {
      var need = snapshot.needs[n];

      setText(
        "need" + n,

        need
          ? need.level +
              " | " +
              need.label +
              ": " +
              need.count +
              "\n" +
              need.hint
          : "",
      );
    }

    // --------------------------------------------------------
    // MAPA
    // --------------------------------------------------------

    setText(
      "map_summary",

      "Regiões problemáticas: " +
        snapshot.problemRegions.length +
        " | Lotação: " +
        snapshot.guestStats.crowdedGuests +
        " | Perdidos: " +
        snapshot.guestStats.lostAny +
        " | Tentando sair: " +
        snapshot.guestStats.lostLeaving,
    );

    var problemRows = currentProblemRows();

    for (var p = 0; p < CONFIG.problemsPerPage; p++) {
      var region = problemRows[p];

      setText(
        "problem" + p,

        region
          ? region.kind +
              " | X " +
              region.tileX +
              " Y " +
              region.tileY +
              " | lotação " +
              region.crowded +
              " | perdidos " +
              region.lost +
              (region.lostLeaving ? " | saída " + region.lostLeaving : "")
          : "",
      );

      setVisible(
        "problem" + p,

        State.tab === 2 && !!region,
      );
    }

    setText(
      "problem_page",

      "Página " + (State.problemPage + 1) + "/" + problemPageCount(),
    );

    setText(
      "problem_detail",

      problemDetailText(selectedProblem()),
    );

    // --------------------------------------------------------
    // ATRAÇÕES
    // --------------------------------------------------------

    setText(
      "rides_summary",

      "Atrações: " +
        snapshot.rides.length +
        " • uptime médio: " +
        snapshot.ratingRideStats.avgUptime +
        "%" +
        " • quebradas: " +
        snapshot.ratingRideStats.broken,
    );

    setText(
      "rides_page",

      "Página " + (State.ridePage + 1) + "/" + ridePageCount(),
    );

    var rows = currentRideRows();

    for (var rideIndex = 0; rideIndex < CONFIG.ridesPerPage; rideIndex++) {
      var ride = rows[rideIndex];

      setText(
        "ride" + rideIndex,

        ride
          ? ride.score +
              "% | " +
              ride.name +
              (ride.problems.length ? " | " + ride.problems[0] : "")
          : "",
      );

      setVisible(
        "ride" + rideIndex,

        State.tab === 3 && !!ride,
      );
    }

    var selectedRide = null;

    if (State.selectedRideId >= 0) {
      for (var s = 0; s < snapshot.rides.length; s++) {
        if (snapshot.rides[s].id === State.selectedRideId) {
          selectedRide = snapshot.rides[s];
        }
      }
    }

    if (!selectedRide && rows.length) {
      selectedRide = rows[0];
    }

    setText(
      "ride_detail",

      rideDetailText(selectedRide),
    );

    // --------------------------------------------------------
    // PRÊMIOS
    // --------------------------------------------------------

    var positive = snapshot.awards.filter(function (award) {
      return award.positive && award.eligible;
    }).length;

    var negative = snapshot.awards.filter(function (award) {
      return !award.positive && award.eligible;
    }).length;

    setText(
      "awards_summary",

      "Elegíveis agora: " +
        positive +
        " positivos | " +
        negative +
        " negativos",
    );

    for (var a = 0; a < CONFIG.maxAwards; a++) {
      var award = snapshot.awards[a];

      setText(
        "award" + a,

        award
          ? (award.positive ? "+ " : "- ") +
              award.name +
              " | " +
              (award.eligible ? "ELEGÍVEL" : "não elegível") +
              "\n" +
              award.detail
          : "",
      );
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

    var widgets = [];

    var tabs = [
      "Nota",
      "Reclamações",
      "Mapa de problemas",
      "Atrações",
      "Prêmios",
    ];

    var tabWidths = [78, 108, 145, 90, 85];

    var tabX = 8;

    for (var t = 0; t < tabs.length; t++) {
      (function (index, x) {
        widgets.push({
          type: "button",

          name: "tab" + index,

          x: x,

          y: 20,

          width: tabWidths[index],

          height: 18,

          text: tabs[index],

          isPressed: index === 0,

          onClick: function () {
            switchTab(index);
          },
        });
      })(t, tabX);

      tabX += tabWidths[t] + 3;
    }

    // ========================================================
    // NOTA
    // ========================================================

    widgets.push({
      type: "groupbox",

      name: "grp_rating",

      x: 8,

      y: 46,

      width: 572,

      height: 410,

      text: "Por que a avaliação está assim?",

      isVisible: true,
    });

    widgets.push({
      type: "label",

      name: "rating_head",

      x: 18,

      y: 66,

      width: 540,

      height: 16,

      text: "",

      isVisible: true,
    });

    widgets.push({
      type: "label",

      name: "rating_match",

      x: 18,

      y: 84,

      width: 540,

      height: 16,

      text: "",

      isVisible: true,
    });

    for (var ri = 0; ri < 8; ri++) {
      widgets.push({
        type: "label",

        name: "rating" + ri,

        x: 18,

        y: 108 + ri * 36,

        width: 540,

        height: 32,

        text: "",

        isVisible: true,
      });
    }

    widgets.push({
      type: "label",

      name: "rec0",

      x: 18,

      y: 398,

      width: 540,

      height: 30,

      text: "",

      isVisible: true,
    });

    widgets.push({
      type: "label",

      name: "rec1",

      x: 18,

      y: 430,

      width: 540,

      height: 30,

      text: "",

      isVisible: true,
    });

    widgets.push({
      type: "label",

      name: "rec2",

      x: 18,

      y: 462,

      width: 540,

      height: 30,

      text: "",

      isVisible: true,
    });

    // ========================================================
    // RECLAMAÇÕES
    // ========================================================

    widgets.push({
      type: "groupbox",

      name: "grp_needs",

      x: 8,

      y: 46,

      width: 572,

      height: 410,

      text: "O que os visitantes estão reclamando?",

      isVisible: false,
    });

    widgets.push({
      type: "label",

      name: "needs_summary",

      x: 18,

      y: 66,

      width: 540,

      height: 18,

      text: "",

      isVisible: false,
    });

    for (var ni = 0; ni < CONFIG.maxNeeds; ni++) {
      widgets.push({
        type: "label",

        name: "need" + ni,

        x: 18,

        y: 92 + ni * 44,

        width: 540,

        height: 40,

        text: "",

        isVisible: false,
      });
    }

    // ========================================================
    // MAPA DE PROBLEMAS
    // ========================================================

    widgets.push({
      type: "groupbox",

      name: "grp_map",

      x: 8,

      y: 46,

      width: 572,

      height: 410,

      text: "Onde estão os problemas?",

      isVisible: false,
    });

    widgets.push({
      type: "label",

      name: "map_summary",

      x: 18,

      y: 66,

      width: 540,

      height: 18,

      text: "",

      isVisible: false,
    });

    for (var pi = 0; pi < CONFIG.problemsPerPage; pi++) {
      (function (index) {
        widgets.push({
          type: "button",

          name: "problem" + index,

          x: 18,

          y: 94 + index * 30,

          width: 540,

          height: 24,

          text: "",

          isVisible: false,

          onClick: function () {
            var absolute = State.problemPage * CONFIG.problemsPerPage + index;

            if (State.snapshot && State.snapshot.problemRegions[absolute]) {
              State.selectedProblemIndex = absolute;

              updateUI();
            }
          },
        });
      })(pi);
    }

    widgets.push({
      type: "button",

      name: "problem_prev",

      x: 18,

      y: 312,

      width: 90,

      height: 22,

      text: "< Anterior",

      isVisible: false,

      onClick: function () {
        if (State.problemPage > 0) {
          State.problemPage--;

          State.selectedProblemIndex = -1;

          updateUI();
        }
      },
    });

    widgets.push({
      type: "button",

      name: "problem_next",

      x: 118,

      y: 312,

      width: 90,

      height: 22,

      text: "Próxima >",

      isVisible: false,

      onClick: function () {
        if (State.problemPage + 1 < problemPageCount()) {
          State.problemPage++;

          State.selectedProblemIndex = -1;

          updateUI();
        }
      },
    });

    widgets.push({
      type: "label",

      name: "problem_page",

      x: 220,

      y: 316,

      width: 90,

      height: 14,

      text: "",

      isVisible: false,
    });

    widgets.push({
      type: "button",

      name: "problem_locate",

      x: 438,

      y: 312,

      width: 120,

      height: 22,

      text: "Localizar no mapa",

      isVisible: false,

      onClick: locateSelectedProblem,
    });

    widgets.push({
      type: "label",

      name: "problem_detail",

      x: 18,

      y: 348,

      width: 540,

      height: 92,

      text: "",

      isVisible: false,
    });

    // ========================================================
    // ATRAÇÕES
    // ========================================================

    widgets.push({
      type: "groupbox",

      name: "grp_rides",

      x: 8,

      y: 46,

      width: 572,

      height: 410,

      text: "Atrações que mais precisam de atenção",

      isVisible: false,
    });

    widgets.push({
      type: "label",

      name: "rides_summary",

      x: 18,

      y: 66,

      width: 540,

      height: 28,

      text: "",

      isVisible: false,
    });

    for (var rwi = 0; rwi < CONFIG.ridesPerPage; rwi++) {
      (function (index) {
        widgets.push({
          type: "button",

          name: "ride" + index,

          x: 18,

          y: 100 + index * 28,

          width: 540,

          height: 23,

          text: "",

          isVisible: false,

          onClick: function () {
            var rows = currentRideRows();

            if (rows[index]) {
              State.selectedRideId = rows[index].id;

              updateUI();
            }
          },
        });
      })(rwi);
    }

    widgets.push({
      type: "button",

      name: "rides_prev",

      x: 18,

      y: 302,

      width: 90,

      height: 22,

      text: "< Anterior",

      isVisible: false,

      onClick: function () {
        if (State.ridePage > 0) {
          State.ridePage--;

          State.selectedRideId = -1;

          updateUI();
        }
      },
    });

    widgets.push({
      type: "button",

      name: "rides_next",

      x: 118,

      y: 302,

      width: 90,

      height: 22,

      text: "Próxima >",

      isVisible: false,

      onClick: function () {
        if (State.ridePage + 1 < ridePageCount()) {
          State.ridePage++;

          State.selectedRideId = -1;

          updateUI();
        }
      },
    });

    widgets.push({
      type: "label",

      name: "rides_page",

      x: 220,

      y: 306,

      width: 90,

      height: 14,

      text: "",

      isVisible: false,
    });

    widgets.push({
      type: "label",

      name: "ride_detail",

      x: 18,

      y: 338,

      width: 540,

      height: 100,

      text: "Selecione uma atração.",

      isVisible: false,
    });

    // ========================================================
    // PRÊMIOS
    // ========================================================

    widgets.push({
      type: "groupbox",

      name: "grp_awards",

      x: 8,

      y: 46,

      width: 572,

      height: 410,

      text: "Prêmios e sinais secundários",

      isVisible: false,
    });

    widgets.push({
      type: "label",

      name: "awards_summary",

      x: 18,

      y: 66,

      width: 540,

      height: 18,

      text: "",

      isVisible: false,
    });

    for (var ai = 0; ai < CONFIG.maxAwards; ai++) {
      widgets.push({
        type: "label",

        name: "award" + ai,

        x: 18,

        y: 92 + ai * 44,

        width: 540,

        height: 40,

        text: "",

        isVisible: false,
      });
    }

    // ========================================================
    // FOOTER
    // ========================================================

    widgets.push({
      type: "button",

      name: "refresh",

      x: 8,

      y: 505,

      width: 120,

      height: 22,

      text: "Atualizar agora",

      onClick: refreshSnapshot,
    });

    widgets.push({
      type: "label",

      name: "status",

      x: 140,

      y: 505,

      width: 440,

      height: 28,

      text: State.status,
    });

    State.window = ui.openWindow({
      classification: PLUGIN.windowId,

      title: "Diagnóstico do Parque 2.1",

      width: 588,

      height: 540,

      colours: [24, 24],

      widgets: widgets,

      onClose: function () {
        State.window = null;
      },
    });

    switchTab(State.tab);

    refreshSnapshot();
  }

  // ============================================================
  // MAIN
  // ============================================================

  function main() {
    if (typeof ui !== "undefined") {
      ui.registerMenuItem("Diagnóstico do Parque", openWindow);
    }

    context.subscribe(
      "interval.tick",

      function () {
        var now = 0;

        try {
          now = date.ticksElapsed || 0;
        } catch (e) {}

        if (now - State.lastRefresh >= CONFIG.refreshTicks) {
          State.lastRefresh = now;

          if (State.window) {
            refreshSnapshot();
          }
        }
      },
    );

    context.subscribe(
      "map.change",

      function () {
        State.snapshot = null;

        State.ridePage = 0;

        State.selectedRideId = -1;

        State.problemPage = 0;

        State.selectedProblemIndex = -1;

        State.status = "Mapa alterado. O diagnóstico será atualizado.";

        if (State.window) {
          refreshSnapshot();
        }
      },
    );

    console.log("[Diagnóstico do Parque 2.1] carregado - somente leitura");
  }

  registerPlugin({
    name: PLUGIN.name,

    version: PLUGIN.version,

    authors: ["OpenAI + Kaoan"],

    type: "local",

    licence: "MIT",

    targetApiVersion: 117,

    minApiVersion: 111,

    main: main,
  });
})();
