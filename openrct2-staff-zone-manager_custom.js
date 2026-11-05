/**
 * Staff Zone Manager 2.1.1
 * OpenRCT2 - API 117+
 *
 * NOVO:
 * - Fila sequencial de GameActions.
 * - Barra de progresso com percentual.
 * - Cancelamento entre acoes.
 * - Timeout de seguranca.
 * - Registro de sucessos e falhas.
 *
 * PRESERVADO:
 * - Mecanicos: saidas e caminhos, versao 1.9.9.
 * - Zeladores: rondas territoriais por caminhos.
 * - Segurancas: prioridade para vandalismo.
 * - Animadores: prioridade para filas.
 * - Contratacao/demissao manual.
 * - Dimensionamento original.
 * - Sprites frontais.
 * - Reparo opcional.
 */

(function () {
  "use strict";

  var VERSION = "2.1.1";
  var WINDOW = "staff-zone-manager-211";

  var CFG = {
    exitReach: 3,
    connectorLimit: 250,
    transitionRadius: 1,
    securityRadius: 18,
    entertainerRadius: 12,
    hotspotSeparation: 7,

    queueIntervalMs: 120,
    actionTimeoutMs: 10000,

    sampleTicks: 200,
    ticksPerMinute: 2400,
    maxSamples: 360,

    mechanicUtilization: 0.75,
    handymanUtilization: 0.8,
    inspectionMinutes: 3,
    repairMinutes: 8,
    sweepMinutes: 0.7,
    binMinutes: 1.2,
    inspectionPeriods: [10, 20, 30, 45, 60, 120, 0],

    handymanTilesPerWorker: 85,
    handymanGuestsPerWorker: 170,
    handymanLitterPerWorker: 12,
    lowOccupancyThreshold: 100,
    lowOccupancyFraction: 0.5,

    spriteRotation: 2,
    spriteSize: 28,
  };

  var TYPES = {
    mechanic: {
      label: "Mecanicos",
      number: 1,
      orders: 3,
    },
    handyman: {
      label: "Zeladores",
      number: 0,
      orders: 7,
    },
    security: {
      label: "Seguranca",
      number: 2,
      orders: 0,
    },
    entertainer: {
      label: "Animadores",
      number: 3,
      orders: 0,
    },
  };

  var TYPE_NAMES = ["mechanic", "handyman", "security", "entertainer"];

  var TABS = [
    "general",
    "mechanic",
    "handyman",
    "security",
    "entertainer",
    "dimension",
  ];

  var TAB_LABELS = [
    "Geral",
    "Mecanicos",
    "Zeladores",
    "Seguranca",
    "Animadores",
    "Dimensionar",
  ];

  var S = {
    window: null,
    tab: 0,
    analyzed: false,
    hiring: false,
    firing: false,

    paths: [],
    pathMap: {},
    pathsByXY: {},
    adjacency: {},
    networkMode: "nao analisada",
    networkCount: 0,

    totalTiles: 0,
    queueTiles: 0,
    usefulTiles: 0,
    slopeTiles: 0,
    elevatedTiles: 0,
    exits: [],

    demand: {
      security: {},
      entertainer: {},
    },

    diagnostics: {
      broken: 0,
      angry: 0,
      unhappy: 0,
      queuePaths: 0,
    },

    zones: {
      mechanic: [],
      handyman: [],
      security: [],
      entertainer: [],
    },

    personnel: {
      mechanic: [],
      handyman: [],
      security: [],
      entertainer: [],
    },

    selectedId: {
      mechanic: null,
      handyman: null,
      security: null,
      entertainer: null,
    },

    pendingFire: null,

    // NOVO: fila global de operacoes.
    job: null,
    nextJobId: 1,

    progress: {
      active: false,
      title: "Nenhuma operacao em andamento.",
      done: 0,
      total: 0,
      errors: 0,
      percent: 0,
    },

    samples: [],
    previous: null,
    lastSample: 0,
    lastRepair: 0,

    dimension: null,
    status: "Clique em Analisar parque.",

    thumbnails: {},
    thumbnailRange: null,
    spriteCache: {},
  };

  var GROUPS = {
    general: [],
    mechanic: [],
    handyman: [],
    security: [],
    entertainer: [],
    dimension: [],
  };

  // ============================================================
  // UTILITARIOS
  // ============================================================

  function n(value, fallback) {
    return typeof value === "number" && isFinite(value) ? value : fallback || 0;
  }

  function t(value) {
    return Math.floor(n(value) / 32);
  }

  function xy(x, y) {
    return x + "," + y;
  }

  function nid(x, y, index) {
    return x + "," + y + "," + index;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  function fmt(value) {
    return n(value).toFixed(1).replace(".", ",");
  }

  function ticks() {
    return n(date.ticksElapsed);
  }

  function distance(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  function ents(type) {
    try {
      return map.getAllEntities(type) || [];
    } catch (e) {
      return [];
    }
  }

  function staff(type) {
    return ents("staff").filter(function (p) {
      return p.staffType === type;
    });
  }

  function rides() {
    return (map.rides || []).filter(function (r) {
      return r && r.classification === "ride";
    });
  }

  function actionError(result) {
    if (!result) return "Sem resposta do jogo.";

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

  function setting(name, fallback) {
    try {
      var value = context.sharedStorage.get(name);
      return value == null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function saveSetting(name, value) {
    try {
      context.sharedStorage.set(name, value);
    } catch (e) {}
  }

  function status(message) {
    S.status = message;
    render();
  }

  function busy() {
    return !!S.job || S.hiring || S.firing;
  }

  function guestCount() {
    return ents("guest").filter(function (g) {
      return g.isInPark;
    }).length;
  }

  function isPath(point) {
    return !!point && !point.queue;
  }

  // ============================================================
  // CAMINHOS
  // ============================================================

  function scan() {
    S.paths = [];
    S.pathMap = {};
    S.pathsByXY = {};

    var all = {};
    var queues = {};
    var slopes = {};
    var elevated = {};

    for (var y = 0; y < map.size.y; y++) {
      for (var x = 0; x < map.size.x; x++) {
        var cell = map.getTile(x, y);

        if (!cell) continue;

        for (var i = 0; i < cell.numElements; i++) {
          var e = cell.getElement(i);

          if (!e || e.type !== "footpath" || e.isGhost) continue;

          var point = {
            id: nid(x, y, i),
            x: x,
            y: y,
            z: n(e.baseZ),
            index: i,
            queue: !!e.isQueue,
            slope: e.slopeDirection !== null && e.slopeDirection !== undefined,
          };

          S.paths.push(point);
          S.pathMap[point.id] = point;

          var key = xy(x, y);

          if (!S.pathsByXY[key]) {
            S.pathsByXY[key] = [];
          }

          S.pathsByXY[key].push(point);

          all[key] = true;
          if (point.queue) queues[key] = true;
          if (point.slope) slopes[key] = true;
          if (point.z > 0) elevated[key] = true;
        }
      }
    }

    S.totalTiles = Object.keys(all).length;
    S.queueTiles = Object.keys(queues).length;
    S.slopeTiles = Object.keys(slopes).length;
    S.elevatedTiles = Object.keys(elevated).length;
  }

  function navNeighbors(point) {
    if (typeof map.getPathNavigator !== "function") {
      return [];
    }

    try {
      var navigator = map.getPathNavigator(
        { x: point.x, y: point.y },
        point.index,
        {
          respectBanners: false,
          includeGhosts: false,
          includeQueues: true,
          includeWidePaths: true,
        },
      );

      if (!navigator) return [];

      var output = [];

      (navigator.getConnectedPaths() || []).forEach(function (connection) {
        if (!connection || !connection.position) return;

        var other =
          S.pathMap[
            nid(
              t(connection.position.x),
              t(connection.position.y),
              connection.elementIndex,
            )
          ];

        if (other) output.push(other);
      });

      return output;
    } catch (e) {
      return [];
    }
  }

  function approxNeighbors(point) {
    var output = [];

    [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ].forEach(function (delta) {
      var adjacent =
        S.pathsByXY[xy(point.x + delta[0], point.y + delta[1])] || [];

      adjacent.forEach(function (other) {
        if (
          point.z === other.z ||
          ((point.slope || other.slope) && Math.abs(point.z - other.z) <= 16)
        ) {
          output.push(other);
        }
      });
    });

    return output;
  }

  function buildGraph() {
    S.adjacency = {};
    var links = 0;

    S.paths.forEach(function (point) {
      var next = navNeighbors(point);
      S.adjacency[point.id] = next;
      links += next.length;
    });

    if (links === 0) {
      S.networkMode = "aproximada";

      S.paths.forEach(function (point) {
        S.adjacency[point.id] = approxNeighbors(point);
      });
    } else {
      S.networkMode = "PathNavigator";
    }

    S.paths.forEach(function (point) {
      (S.adjacency[point.id] || []).slice().forEach(function (other) {
        var reverse = S.adjacency[other.id] || [];

        if (
          !reverse.some(function (q) {
            return q.id === point.id;
          })
        ) {
          reverse.push(point);
          S.adjacency[other.id] = reverse;
        }
      });
    });

    var visited = {};
    var count = 0;

    S.paths.forEach(function (root) {
      if (visited[root.id]) return;

      count++;

      var queue = [root];
      var head = 0;

      visited[root.id] = true;

      while (head < queue.length) {
        var point = queue[head++];

        (S.adjacency[point.id] || []).forEach(function (other) {
          if (!visited[other.id]) {
            visited[other.id] = true;
            queue.push(other);
          }
        });
      }
    });

    S.networkCount = count;
  }

  // ============================================================
  // MECANICOS - ALGORITMO APROVADO
  // ============================================================

  function collectExits() {
    var output = [];

    rides().forEach(function (ride) {
      (ride.stations || []).forEach(function (station) {
        if (
          !station ||
          !station.exit ||
          !isFinite(station.exit.x) ||
          !isFinite(station.exit.y) ||
          station.exit.x < 0 ||
          station.exit.y < 0
        )
          return;

        output.push({
          x: t(station.exit.x),
          y: t(station.exit.y),
          z: n(station.exit.z),
          rideId: ride.id,
        });
      });
    });

    return output;
  }

  function clusterExits(exits, count) {
    if (!exits.length || !count) return [];

    if (count >= exits.length) {
      var repeated = [];

      for (var i = 0; i < count; i++) {
        repeated.push([exits[i % exits.length]]);
      }

      return repeated;
    }

    var seeds = [exits[0]];

    while (seeds.length < count) {
      var best = null;
      var farthest = -1;

      exits.forEach(function (point) {
        var nearest = Infinity;

        seeds.forEach(function (seed) {
          nearest = Math.min(nearest, distance(point, seed));
        });

        if (nearest > farthest) {
          farthest = nearest;
          best = point;
        }
      });

      if (!best) break;
      seeds.push(best);
    }

    var groups = seeds.map(function () {
      return [];
    });

    exits.forEach(function (point) {
      var best = 0;
      var minimum = Infinity;

      seeds.forEach(function (seed, index) {
        var d = distance(point, seed);

        if (d < minimum) {
          minimum = d;
          best = index;
        }
      });

      groups[best].push(point);
    });

    return groups;
  }

  function exitPathSeeds(exit) {
    var result = [];
    var seen = {};

    for (var radius = 0; radius <= 2; radius++) {
      for (var dx = -radius; dx <= radius; dx++) {
        for (var dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) + Math.abs(dy) !== radius) continue;

          var adjacent = S.pathsByXY[xy(exit.x + dx, exit.y + dy)] || [];

          adjacent.forEach(function (point) {
            if (!isPath(point) || seen[point.id]) return;

            seen[point.id] = true;

            result.push({
              point: point,
              score: distance(point, exit) * 5 + Math.abs(point.z - exit.z),
            });
          });
        }
      }

      if (result.length) break;
    }

    result.sort(function (a, b) {
      return a.score - b.score;
    });

    return result.slice(0, 2).map(function (item) {
      return item.point;
    });
  }

  function bfsFrom(start, limit) {
    var visited = {};
    var queue = [{ point: start, depth: 0 }];
    var result = [];
    var head = 0;

    visited[start.id] = true;

    while (head < queue.length) {
      var item = queue[head++];

      result.push(item.point);

      if (item.depth >= limit) continue;

      (S.adjacency[item.point.id] || []).forEach(function (other) {
        if (!isPath(other) || visited[other.id]) return;

        visited[other.id] = true;

        queue.push({
          point: other,
          depth: item.depth + 1,
        });
      });
    }

    return result;
  }

  function shortestPath(start, goal, limit) {
    if (start.id === goal.id) return [start];

    var visited = {};
    var previous = {};
    var queue = [start];
    var head = 0;

    visited[start.id] = true;

    while (head < queue.length && head < limit) {
      var point = queue[head++];
      var adjacent = S.adjacency[point.id] || [];

      for (var i = 0; i < adjacent.length; i++) {
        var other = adjacent[i];

        if (!isPath(other) || visited[other.id]) continue;

        visited[other.id] = true;
        previous[other.id] = point.id;

        if (other.id === goal.id) {
          var path = [other];
          var current = other.id;

          while (current !== start.id) {
            current = previous[current];
            path.push(S.pathMap[current]);
          }

          return path.reverse();
        }

        queue.push(other);
      }
    }

    return null;
  }

  function mechanicZone(group) {
    var tiles = {};
    var roots = [];
    var missed = 0;
    var unlinked = 0;

    group.forEach(function (exit) {
      tiles[xy(exit.x, exit.y)] = true;

      var seeds = exitPathSeeds(exit);

      if (!seeds.length) {
        missed++;
        return;
      }

      roots.push(seeds[0]);

      seeds.forEach(function (seed) {
        bfsFrom(seed, CFG.exitReach).forEach(function (point) {
          tiles[xy(point.x, point.y)] = true;
        });
      });
    });

    for (var i = 1; i < roots.length; i++) {
      var route = shortestPath(roots[0], roots[i], CFG.connectorLimit);

      if (route) {
        route.forEach(function (point) {
          tiles[xy(point.x, point.y)] = true;
        });
      } else {
        unlinked++;
      }
    }

    return {
      tiles: tiles,
      center: roots.length ? roots[0] : group[0],
      missed: missed,
      unlinked: unlinked,
      mode: "saidas",
    };
  }

  // ============================================================
  // ZELADORES - DISTRIBUICAO PRESERVADA
  // ============================================================

  function chooseSeeds(points, count, people) {
    if (!points.length || !count) return [];

    var selected = [];
    var used = {};

    people.forEach(function (person) {
      if (selected.length >= count) return;

      var best = null;
      var minimum = Infinity;

      points.forEach(function (point) {
        if (used[point.id]) return;

        var d = distance(
          {
            x: t(person.x),
            y: t(person.y),
          },
          point,
        );

        if (d < minimum) {
          minimum = d;
          best = point;
        }
      });

      if (best) {
        used[best.id] = true;
        selected.push(best);
      }
    });

    if (!selected.length) {
      selected.push(points[0]);
      used[points[0].id] = true;
    }

    while (selected.length < count && selected.length < points.length) {
      var farthest = null;
      var maximum = -1;

      points.forEach(function (point) {
        if (used[point.id]) return;

        var nearest = Infinity;

        selected.forEach(function (seed) {
          nearest = Math.min(nearest, distance(point, seed));
        });

        if (nearest > maximum) {
          maximum = nearest;
          farthest = point;
        }
      });

      if (!farthest) break;

      used[farthest.id] = true;
      selected.push(farthest);
    }

    return selected;
  }

  function dividePaths(points, seeds) {
    var owner = {};
    var queue = [];

    var groups = seeds.map(function () {
      return [];
    });

    seeds.forEach(function (seed, index) {
      owner[seed.id] = index;

      queue.push({
        point: seed,
        owner: index,
      });
    });

    var head = 0;

    while (head < queue.length) {
      var current = queue[head++];

      groups[current.owner].push(current.point);

      (S.adjacency[current.point.id] || []).forEach(function (other) {
        if (owner[other.id] !== undefined) return;

        owner[other.id] = current.owner;

        queue.push({
          point: other,
          owner: current.owner,
        });
      });
    }

    points.forEach(function (point) {
      if (owner[point.id] !== undefined) return;

      var best = 0;
      var minimum = Infinity;

      seeds.forEach(function (seed, index) {
        var d = distance(point, seed);

        if (d < minimum) {
          minimum = d;
          best = index;
        }
      });

      owner[point.id] = best;
      groups[best].push(point);
    });

    return groups;
  }

  function tileZone(group, seed) {
    var tiles = {};
    var visited = {};
    var queue = [];

    group.forEach(function (point) {
      tiles[xy(point.x, point.y)] = true;
      visited[point.id] = true;

      queue.push({
        point: point,
        depth: 0,
      });
    });

    var head = 0;

    while (head < queue.length) {
      var current = queue[head++];

      if (current.depth >= CFG.transitionRadius) continue;

      (S.adjacency[current.point.id] || []).forEach(function (other) {
        if (visited[other.id]) return;

        visited[other.id] = true;
        tiles[xy(other.x, other.y)] = true;

        queue.push({
          point: other,
          depth: current.depth + 1,
        });
      });
    }

    return {
      tiles: tiles,
      center: seed,
      missed: 0,
      unlinked: 0,
      mode: "territorial",
    };
  }

  function territorialZones(type, count) {
    var points = S.paths.slice();

    if (!points.length || !count) return [];

    var seeds = chooseSeeds(
      points,
      Math.min(count, points.length),
      staff(type),
    );

    var groups = dividePaths(points, seeds);

    var output = seeds.map(function (seed, index) {
      return tileZone(groups[index].length ? groups[index] : [seed], seed);
    });

    var original = output.length;

    while (output.length < count && original) {
      output.push(output[output.length % original]);
    }

    return output;
  }

  // ============================================================
  // SEGURANCAS E ANIMADORES - BASE 2.1
  // ============================================================

  function addDemand(type, x, y, score) {
    var key = xy(x, y);
    var data = S.demand[type];

    data[key] = (data[key] || 0) + score;
  }

  function guestUnhappy(guest) {
    return typeof guest.happiness === "number" && guest.happiness < 90;
  }

  function guestAngry(guest) {
    return (
      guest.angry === true ||
      (typeof guest.angriness === "number" && guest.angriness > 100)
    );
  }

  function thoughtsContain(guest, names) {
    if (!guest.thoughts) return false;

    for (var i = 0; i < guest.thoughts.length; i++) {
      var thought = guest.thoughts[i];

      if (thought && names.indexOf(thought.type) >= 0) return true;
    }

    return false;
  }

  function inspectDemand() {
    S.demand.security = {};
    S.demand.entertainer = {};

    S.diagnostics = {
      broken: 0,
      angry: 0,
      unhappy: 0,
      queuePaths: 0,
    };

    S.paths.forEach(function (point) {
      if (point.queue) {
        S.diagnostics.queuePaths++;

        addDemand("entertainer", point.x, point.y, 4);
      }

      try {
        var cell = map.getTile(point.x, point.y);

        var element = cell.getElement(point.index);

        if (
          element &&
          element.type === "footpath" &&
          element.isAdditionBroken
        ) {
          S.diagnostics.broken++;

          addDemand("security", point.x, point.y, 14);
        }
      } catch (e) {}
    });

    ents("guest").forEach(function (guest) {
      if (!guest.isInPark) return;

      var x = t(guest.x);
      var y = t(guest.y);

      if (x < 0 || y < 0 || x >= map.size.x || y >= map.size.y) return;

      var angry = guestAngry(guest) || thoughtsContain(guest, ["vandalism"]);

      if (angry) {
        S.diagnostics.angry++;

        addDemand("security", x, y, 5);
      }

      if (guestUnhappy(guest)) {
        S.diagnostics.unhappy++;

        addDemand("entertainer", x, y, 1.5);
      }

      if (thoughtsContain(guest, ["queuing_ages", "queuingAges", "crowded"])) {
        addDemand("entertainer", x, y, 3);
      }
    });
  }

  function pointDemand(type, point) {
    var data = S.demand[type];

    var total = data[xy(point.x, point.y)] || 0;

    [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ].forEach(function (delta) {
      total += 0.5 * (data[xy(point.x + delta[0], point.y + delta[1])] || 0);
    });

    return total;
  }

  function hotspotCandidates(type) {
    var candidates = S.paths
      .filter(function (point) {
        return type === "entertainer" || !point.queue;
      })
      .map(function (point) {
        return {
          point: point,
          score: pointDemand(type, point),
        };
      });

    if (type === "entertainer") {
      candidates.forEach(function (item) {
        if (item.point.queue) {
          item.score += 3;
        }
      });
    }

    candidates.sort(function (a, b) {
      return b.score - a.score;
    });

    return candidates;
  }

  function demandSeeds(type, count) {
    var candidates = hotspotCandidates(type);

    if (!candidates.length || candidates[0].score <= 0) return [];

    var chosen = [];
    var used = {};

    while (chosen.length < count) {
      var best = null;
      var highest = -1;

      candidates.forEach(function (candidate) {
        var point = candidate.point;

        if (used[point.id]) return;

        var nearest = Infinity;

        chosen.forEach(function (seed) {
          nearest = Math.min(nearest, distance(point, seed));
        });

        var separation = chosen.length
          ? Math.min(1, nearest / CFG.hotspotSeparation)
          : 1;

        var score = candidate.score * separation;

        if (score > highest) {
          highest = score;
          best = candidate;
        }
      });

      if (!best || highest <= 0) break;

      used[best.point.id] = true;
      chosen.push(best.point);
    }

    return chosen;
  }

  function focusedZone(type, seed) {
    var radius =
      type === "security" ? CFG.securityRadius : CFG.entertainerRadius;

    var tiles = {};
    var visited = {};

    var queue = [
      {
        point: seed,
        depth: 0,
      },
    ];

    var head = 0;
    visited[seed.id] = true;

    while (head < queue.length) {
      var current = queue[head++];
      var point = current.point;

      tiles[xy(point.x, point.y)] = true;

      if (current.depth >= radius) continue;

      (S.adjacency[point.id] || []).forEach(function (other) {
        if (visited[other.id]) return;

        visited[other.id] = true;

        queue.push({
          point: other,
          depth: current.depth + 1,
        });
      });
    }

    return {
      tiles: tiles,
      center: seed,
      missed: 0,
      unlinked: 0,
      mode: "prioridade",
    };
  }

  function specializedZones(type, count) {
    var seeds = demandSeeds(type, count);

    if (!seeds.length) {
      return territorialZones(type, count);
    }

    var result = seeds.map(function (seed) {
      return focusedZone(type, seed);
    });

    if (result.length < count) {
      result = result.concat(territorialZones(type, count - result.length));
    }

    return result.slice(0, count);
  }

  // ============================================================
  // ANALISE
  // ============================================================

  function analyze() {
    if (busy()) {
      status("Finalize a operacao atual antes de analisar.");
      return;
    }

    try {
      scan();
      buildGraph();
      inspectDemand();

      S.exits = collectExits();
      S.usefulTiles = S.totalTiles;
      S.analyzed = true;

      dimension();

      status(
        "Analisado: " +
          S.totalTiles +
          " caminhos; " +
          S.diagnostics.broken +
          " objetos quebrados; " +
          S.diagnostics.angry +
          " sinais de risco; " +
          S.diagnostics.queuePaths +
          " tiles de fila.",
      );
    } catch (e) {
      status("Erro na analise: " + e);
    }
  }

  // ============================================================
  // NOVO: BARRA DE PROGRESSO
  // ============================================================

  function progressBar(percent) {
    var width = 32;

    var filled = Math.round((clamp(percent, 0, 100) * width) / 100);

    return (
      "[" +
      new Array(filled + 1).join("=") +
      new Array(width - filled + 1).join("-") +
      "]"
    );
  }

  function updateProgress() {
    var p = S.progress;

    p.percent = p.total ? Math.floor((p.done * 100) / p.total) : 0;

    var bar = widget("queue_bar");
    var caption = widget("queue_caption");
    var cancel = widget("queue_cancel");

    if (bar) {
      bar.text = progressBar(p.percent);
    }

    if (caption) {
      caption.text =
        p.title +
        " | " +
        p.percent +
        "% | " +
        p.done +
        "/" +
        p.total +
        " acoes | " +
        p.errors +
        " erros";
    }

    if (cancel) {
      cancel.isDisabled = !S.job || !!S.job.cancelRequested;
    }
  }

  function progressState(title, done, total, errors, active) {
    S.progress.active = active;
    S.progress.title = title;
    S.progress.done = done;
    S.progress.total = total;
    S.progress.errors = errors;

    updateProgress();
  }

  // ============================================================
  // NOVO: PREPARACAO DAS ACOES
  // ============================================================

  function compress(tiles) {
    var rows = {};
    var runs = [];

    Object.keys(tiles).forEach(function (key) {
      var parts = key.split(",");
      var x = +parts[0];
      var y = +parts[1];

      if (!rows[y]) rows[y] = [];
      rows[y].push(x);
    });

    Object.keys(rows).forEach(function (y) {
      var xs = rows[y].sort(function (a, b) {
        return a - b;
      });

      var start = xs[0];
      var previous = xs[0];

      for (var i = 1; i <= xs.length; i++) {
        if (i < xs.length && xs[i] === previous + 1) {
          previous = xs[i];
          continue;
        }

        runs.push({
          x1: start * 32,
          y1: +y * 32,
          x2: previous * 32,
          y2: +y * 32,
        });

        start = xs[i];
        previous = xs[i];
      }
    });

    return runs;
  }

  function buildPatrolTasks(type, zones) {
    var available = staff(type).slice();
    var tasks = [];

    zones.slice(0, available.length).forEach(function (zone) {
      if (!available.length) return;

      var best = 0;
      var nearest = Infinity;

      available.forEach(function (person, index) {
        var d = distance(
          {
            x: t(person.x),
            y: t(person.y),
          },
          zone.center,
        );

        if (d < nearest) {
          nearest = d;
          best = index;
        }
      });

      var selected = available.splice(best, 1)[0];

      tasks.push({
        id: selected.id,
        zone: zone,
        actions: [
          {
            mode: 2,
            x1: 0,
            y1: 0,
            x2: 0,
            y2: 0,
          },
        ].concat(
          compress(zone.tiles).map(function (run) {
            return {
              mode: 0,
              x1: run.x1,
              y1: run.y1,
              x2: run.x2,
              y2: run.y2,
            };
          }),
        ),
      });
    });

    return tasks;
  }

  function buildClearTasks(type) {
    return staff(type).map(function (person) {
      return {
        id: person.id,
        zone: null,
        actions: [
          {
            mode: 2,
            x1: 0,
            y1: 0,
            x2: 0,
            y2: 0,
          },
        ],
      };
    });
  }

  // ============================================================
  // NOVO: MOTOR DE FILA
  // ============================================================

  function startJob(type, operation, tasks) {
    if (busy()) {
      status("Outra operacao ainda esta em andamento.");
      return;
    }

    if (!tasks.length) {
      status("Nenhum funcionario para processar.");
      return;
    }

    var total = 0;

    tasks.forEach(function (task) {
      total += task.actions.length;
    });

    var job = {
      id: S.nextJobId++,
      type: type,
      operation: operation,
      tasks: tasks,

      personIndex: 0,
      actionIndex: 0,

      total: total,
      done: 0,
      errors: 0,
      success: 0,
      failedPeople: 0,

      awaiting: false,
      sentAt: 0,
      cancelRequested: false,

      // So o job ativo pode aceitar callbacks.
      token: 0,

      completedZones: [],
      startedAt: Date.now(),
    };

    S.job = job;

    if (operation === "generate") {
      S.zones[type] = [];
    }

    progressState("Iniciando " + TYPES[type].label, 0, total, 0, true);

    status("Fila iniciada para " + TYPES[type].label + ".");
  }

  function finishJob(job, reason) {
    if (S.job !== job) return;

    job.token++;
    S.job = null;

    if (job.operation === "generate") {
      S.zones[job.type] = job.completedZones.slice();
    } else if (job.operation === "clear" && reason === "complete") {
      S.zones[job.type] = [];
    }

    var title;

    if (reason === "complete") {
      title = "Concluido";
    } else if (reason === "cancel") {
      title = "Cancelado";
    } else {
      title = "Interrompido por falha";
    }

    progressState(
      title + ": " + TYPES[job.type].label,
      job.done,
      job.total,
      job.errors,
      false,
    );

    status(
      title +
        ": " +
        job.done +
        "/" +
        job.total +
        " acoes processadas; " +
        job.success +
        " funcionarios concluidos; " +
        job.errors +
        " erros." +
        (reason === "complete"
          ? ""
          : " Algumas rondas podem estar incompletas."),
    );
  }

  function skipRemainingActions(job, task) {
    /*
     * Se uma acao de um funcionario falhar,
     * nao continuamos aplicando partes da
     * mesma ronda.
     *
     * As acoes puladas contam no total
     * processado para a barra terminar
     * corretamente.
     */
    var remaining = task.actions.length - job.actionIndex;

    job.done += remaining;
    job.actionIndex = task.actions.length;
  }

  function completeAction(job, token, result) {
    if (S.job !== job || !job.awaiting || job.token !== token) {
      // Callback antigo ou recebido apos cancelamento.
      return;
    }

    job.awaiting = false;

    var task = job.tasks[job.personIndex];

    if (!task) {
      finishJob(job, "error");
      return;
    }

    var error = actionError(result);

    job.done++;
    job.actionIndex++;

    if (error) {
      job.errors++;
      job.failedPeople++;

      console.log(
        "[Staff Zone Manager] Acao falhou " +
          "para funcionario " +
          task.id +
          ": " +
          error,
      );

      skipRemainingActions(job, task);
    }

    if (job.actionIndex >= task.actions.length) {
      if (!error) {
        job.success++;

        if (job.operation === "generate" && task.zone) {
          job.completedZones.push({
            id: task.id,
            tiles: Object.keys(task.zone.tiles).length,
            mode: task.zone.mode,
          });
        }

        if (job.operation === "clear") {
          S.zones[job.type] = S.zones[job.type].filter(function (zone) {
            return zone.id !== task.id;
          });
        }
      }

      job.personIndex++;
      job.actionIndex = 0;
    }

    progressState(TYPES[job.type].label, job.done, job.total, job.errors, true);

    if (job.cancelRequested) {
      finishJob(job, "cancel");
      return;
    }

    if (job.personIndex >= job.tasks.length) {
      finishJob(job, "complete");
    }
  }

  function queueTick() {
    var job = S.job;
    if (!job) return;

    if (job.awaiting) {
      if (Date.now() - job.sentAt >= CFG.actionTimeoutMs) {
        /*
         * Nao inicia outra acao depois do
         * timeout. Isso evita sobrepor
         * alteracoes cuja resposta se perdeu.
         *
         * O callback antigo e ignorado.
         */
        job.errors++;

        console.log(
          "[Staff Zone Manager] Timeout " + "de GameAction. Job " + job.id,
        );

        finishJob(job, "timeout");
      }

      return;
    }

    if (job.cancelRequested) {
      finishJob(job, "cancel");
      return;
    }

    if (job.personIndex >= job.tasks.length) {
      finishJob(job, "complete");
      return;
    }

    var task = job.tasks[job.personIndex];
    var operation = task.actions[job.actionIndex];

    if (!operation) {
      job.personIndex++;
      job.actionIndex = 0;
      return;
    }

    var args = {
      id: task.id,
      x1: operation.x1,
      y1: operation.y1,
      x2: operation.x2,
      y2: operation.y2,
      mode: operation.mode,
    };

    job.awaiting = true;
    job.sentAt = Date.now();

    var token = ++job.token;

    try {
      context.executeAction("staffsetpatrolarea", args, function (result) {
        completeAction(job, token, result);
      });
    } catch (e) {
      completeAction(job, token, {
        error: 1,
        errorMessage: String(e),
      });
    }
  }

  function requestCancel() {
    var job = S.job;

    if (!job) {
      status("Nenhuma operacao para cancelar.");
      return;
    }

    job.cancelRequested = true;

    status("Cancelamento solicitado. " + "Aguardando a acao atual.");

    if (!job.awaiting) {
      finishJob(job, "cancel");
    }
  }

  // ============================================================
  // GERAR E LIMPAR RONDAS
  // ============================================================

  function generate(type) {
    if (busy()) {
      status("Aguarde a fila atual terminar.");
      return;
    }

    S.pendingFire = null;

    if (!S.analyzed) {
      status("Analise o parque primeiro.");
      return;
    }

    var count = staff(type).length;

    if (!count) {
      status("Nenhum funcionario contratado.");
      return;
    }

    var zones;

    if (type === "mechanic") {
      var exits = collectExits();

      if (!exits.length) {
        status("Nenhuma saida valida.");
        return;
      }

      // ALGORITMO DOS MECANICOS PRESERVADO.
      zones = clusterExits(exits, count).map(mechanicZone);
    } else if (type === "handyman") {
      // ZELADORES PRESERVADOS.
      zones = territorialZones(type, count);
    } else {
      // SEGURANCAS E ANIMADORES DA 2.1.
      inspectDemand();

      zones = specializedZones(type, count);
    }

    startJob(type, "generate", buildPatrolTasks(type, zones));
  }

  function clearPatrols(type) {
    if (busy()) {
      status("Aguarde a operacao atual terminar.");
      return;
    }

    S.pendingFire = null;

    startJob(type, "clear", buildClearTasks(type));
  }

  // ============================================================
  // CONTRATACAO MANUAL
  // ============================================================

  function hire(type) {
    if (busy()) return;

    S.pendingFire = null;
    S.hiring = true;

    var meta = TYPES[type];
    var costume = 0;

    status("Contratando " + meta.label + "...");

    function attempt() {
      var args = {
        autoPosition: true,
        staffType: meta.number,
        costumeIndex: costume,
        staffOrders: meta.orders,
      };

      try {
        context.queryAction("staffhire", args, function (result) {
          if (actionError(result)) {
            if (type === "entertainer" && costume < 15) {
              costume++;
              attempt();
              return;
            }

            S.hiring = false;

            status("Falha: " + actionError(result));
            return;
          }

          try {
            context.executeAction("staffhire", args, function (response) {
              S.hiring = false;

              refreshPersonnel(type);
              dimension();
              updateSprites();

              status(actionError(response) || "Contratacao executada.");
            });
          } catch (e) {
            S.hiring = false;
            status("Erro: " + e);
          }
        });
      } catch (e) {
        S.hiring = false;
        status("Erro: " + e);
      }
    }

    attempt();
  }

  // ============================================================
  // SELECAO E DEMISSAO
  // ============================================================

  function refreshPersonnel(type) {
    var people = staff(type).slice();

    people.sort(function (a, b) {
      return a.id - b.id;
    });

    S.personnel[type] = people.map(function (person) {
      return {
        id: person.id,
        name: String(person.name || TYPES[type].label + " #" + person.id),
      };
    });

    if (
      !S.personnel[type].some(function (person) {
        return person.id === S.selectedId[type];
      })
    ) {
      S.selectedId[type] = null;
    }

    var dropdown = widget(type + "_personnel");
    if (!dropdown) return;

    dropdown.items = ["Selecione um funcionario"].concat(
      S.personnel[type].map(function (person) {
        return person.name + " [ID " + person.id + "]";
      }),
    );

    var index = S.personnel[type].findIndex(function (person) {
      return person.id === S.selectedId[type];
    });

    dropdown.selectedIndex = index + 1;
  }

  function refreshAllPersonnel() {
    TYPE_NAMES.forEach(refreshPersonnel);
  }

  function selectPerson(type, index) {
    if (busy()) return;

    var people = S.personnel[type];

    var person = index > 0 && index <= people.length ? people[index - 1] : null;

    S.selectedId[type] = person ? person.id : null;

    S.pendingFire = null;

    status(
      person
        ? "Selecionado: " + person.name
        : "Nenhum funcionario selecionado.",
    );
  }

  function fireSelected(type) {
    if (busy()) return;

    var id = S.selectedId[type];

    var person = staff(type).filter(function (p) {
      return p.id === id;
    })[0];

    if (!person) {
      S.pendingFire = null;

      status("Selecione um funcionario para demitir.");
      return;
    }

    var name = String(person.name || "ID " + id);

    if (
      !S.pendingFire ||
      S.pendingFire.type !== type ||
      S.pendingFire.id !== id
    ) {
      S.pendingFire = {
        type: type,
        id: id,
        name: name,
      };

      status(
        "Confirmar demissao de " +
          name +
          "? Clique novamente em CONFIRMAR DEMISSAO.",
      );
      return;
    }

    S.pendingFire = null;
    S.firing = true;

    var args = { id: id };

    try {
      context.queryAction("stafffire", args, function (result) {
        var error = actionError(result);

        if (error) {
          S.firing = false;
          status("Demissao rejeitada: " + error);
          return;
        }

        try {
          context.executeAction("stafffire", args, function (response) {
            S.firing = false;

            var executeError = actionError(response);

            if (executeError) {
              status("Falha: " + executeError);
              return;
            }

            S.zones[type] = S.zones[type].filter(function (zone) {
              return zone.id !== id;
            });

            S.selectedId[type] = null;

            refreshPersonnel(type);
            dimension();
            updateSprites();

            status("Demissao executada: " + name);
          });
        } catch (e) {
          S.firing = false;
          status("Erro: " + e);
        }
      });
    } catch (e) {
      S.firing = false;
      status("Erro: " + e);
    }
  }

  // ============================================================
  // HISTORICO DE PRODUTIVIDADE
  // ============================================================

  function counters(person) {
    if (person.staffType === "mechanic") {
      return {
        a: n(person.ridesInspected),
        b: n(person.ridesFixed),
      };
    }

    return {
      a: n(person.litterSwept),
      b: n(person.binsEmptied),
    };
  }

  function sample() {
    var point = {
      tick: ticks(),
      members: {},
    };

    ents("staff").forEach(function (person) {
      if (person.staffType !== "mechanic" && person.staffType !== "handyman")
        return;

      var counts = counters(person);

      var member = {
        type: person.staffType,
        x: n(person.x),
        y: n(person.y),
        a: counts.a,
        b: counts.b,
        distance: 0,
        elapsed: 0,
      };

      var previous = S.previous && S.previous.members[person.id];

      if (previous && S.previous.tick < point.tick) {
        var delta = point.tick - S.previous.tick;

        var moved =
          (Math.abs(member.x - previous.x) + Math.abs(member.y - previous.y)) /
          32;

        if (delta <= CFG.sampleTicks * 3 && moved <= delta / 12) {
          member.distance = moved;
          member.elapsed = delta;
        }
      }

      point.members[person.id] = member;
    });

    S.previous = point;
    S.samples.push(point);

    while (S.samples.length > CFG.maxSamples) {
      S.samples.shift();
    }
  }

  function observation(type) {
    if (S.samples.length < 2) {
      return {
        minutes: 0,
        a: 0,
        b: 0,
        speed: 0,
      };
    }

    var first = {};
    var last = {};
    var distanceSum = 0;
    var elapsed = 0;

    S.samples.forEach(function (point) {
      Object.keys(point.members).forEach(function (id) {
        var member = point.members[id];

        if (member.type !== type) return;

        if (!first[id]) first[id] = member;
        last[id] = member;

        distanceSum += member.distance;
        elapsed += member.elapsed;
      });
    });

    var a = 0;
    var b = 0;

    Object.keys(last).forEach(function (id) {
      a += Math.max(0, last[id].a - first[id].a);

      b += Math.max(0, last[id].b - first[id].b);
    });

    var minutes =
      (S.samples[S.samples.length - 1].tick - S.samples[0].tick) /
      CFG.ticksPerMinute;

    return {
      minutes: minutes,
      a: minutes >= 5 ? (a * 60) / minutes : 0,
      b: minutes >= 5 ? (b * 60) / minutes : 0,
      speed: elapsed ? distanceSum / (elapsed / CFG.ticksPerMinute) : 0,
    };
  }

  // ============================================================
  // DIMENSIONAMENTO ORIGINAL
  // ============================================================

  function coverageFraction(guests) {
    if (guests <= CFG.lowOccupancyThreshold) {
      return CFG.lowOccupancyFraction;
    }

    var growth =
      (guests - CFG.lowOccupancyThreshold) / (200 - CFG.lowOccupancyThreshold);

    return clamp(
      CFG.lowOccupancyFraction + growth * (1 - CFG.lowOccupancyFraction),
      CFG.lowOccupancyFraction,
      1,
    );
  }

  function dimension() {
    var mechanics = staff("mechanic").length;
    var handymen = staff("handyman").length;

    var mr = observation("mechanic");
    var hr = observation("handyman");

    var guests = guestCount();
    var litter = ents("litter").length;

    var active = rides().filter(function (ride) {
      return ride.status === "open" || ride.status === "testing";
    });

    var inspections = 0;
    var repairs = 0;

    active.forEach(function (ride) {
      var period =
        CFG.inspectionPeriods[Math.floor(n(ride.inspectionInterval, 6))] || 0;

      if (period > 0) {
        inspections += 60 / period;
      }

      var reliability = clamp(n(ride.reliability, 100), 0, 100);

      repairs +=
        0.08 +
        0.007 * (100 - reliability) +
        0.002 * clamp(n(ride.downtime), 0, 100);
    });

    if (mr.minutes >= 10) {
      inspections = Math.max(inspections, mr.a);

      repairs = Math.max(repairs, mr.b);
    }

    var mechanicTravel = mr.speed > 0 ? clamp(12 / mr.speed, 0.15, 4) : 1.5;

    var mechanicWork =
      inspections * CFG.inspectionMinutes +
      repairs * CFG.repairMinutes +
      (inspections + repairs) * mechanicTravel;

    var mechanicNeed = active.length
      ? Math.max(1, Math.ceil(mechanicWork / (60 * CFG.mechanicUtilization)))
      : 0;

    var cleaning = Math.max(
      guests * 0.018,
      litter * 0.5,
      hr.minutes >= 10 ? hr.a : 0,
    );

    var bins = Math.max(guests * 0.004, hr.minutes >= 10 ? hr.b : 0);

    var travel = hr.speed > 0 ? clamp(6 / hr.speed, 0.1, 3) : 1;

    var handWork =
      cleaning * CFG.sweepMinutes +
      bins * CFG.binMinutes +
      (cleaning + bins) * travel;

    var byWork = Math.ceil(handWork / (60 * CFG.handymanUtilization));

    var fraction = coverageFraction(guests);

    var accessible = S.analyzed ? S.usefulTiles : 0;

    var byCoverage = Math.ceil(
      (accessible * fraction) / CFG.handymanTilesPerWorker,
    );

    var byGuests = Math.ceil(guests / CFG.handymanGuestsPerWorker);

    var byLitter = Math.ceil(litter / CFG.handymanLitterPerWorker);

    var handNeed = Math.max(byWork, byCoverage, byGuests, byLitter);

    if (guests || litter) {
      handNeed = Math.max(1, handNeed);
    }

    var minutes = Math.max(mr.minutes, hr.minutes);

    S.dimension = {
      mechanics: mechanics,
      mechanicNeed: mechanicNeed,
      mechanicWork: mechanicWork,
      inspections: inspections,
      repairs: repairs,
      mechanicSpeed: mr.speed,

      handymen: handymen,
      handymanNeed: handNeed,
      handWork: handWork,
      handymanSpeed: hr.speed,

      byCoverage: byCoverage,
      byGuests: byGuests,
      byLitter: byLitter,
      byWork: byWork,

      accessible: accessible,
      fraction: fraction,
      guests: guests,
      litter: litter,
      minutes: minutes,

      confidence: minutes >= 20 ? "MEDIA" : minutes >= 5 ? "BAIXA" : "INICIAL",
    };

    render();
  }

  // ============================================================
  // REPARO OPCIONAL PRESERVADO
  // ============================================================

  function repairTick() {
    if (
      !setting("StaffZoneManager.repairEnabled", false) ||
      !setting("StaffZoneManager.repairhandyman", true)
    )
      return;

    if (typeof network !== "undefined" && network.mode === "client") return;

    staff("handyman").forEach(function (person) {
      var x = t(person.x);
      var y = t(person.y);

      if (x < 0 || y < 0 || x >= map.size.x || y >= map.size.y) return;

      var cell = map.getTile(x, y);
      if (!cell) return;

      for (var i = 0; i < cell.numElements; i++) {
        var element = cell.getElement(i);

        if (
          !element ||
          element.type !== "footpath" ||
          !element.isAdditionBroken ||
          element.addition == null ||
          n(element.baseZ) !== n(person.z)
        )
          continue;

        if (park.getFlag("noMoney")) {
          element.isAdditionBroken = false;
          break;
        }

        var object;

        try {
          object = context.getObject("footpath_addition", element.addition);
        } catch (e) {
          continue;
        }

        if (!object || object.index === undefined) continue;

        context.executeAction(
          "footpathadditionplace",
          {
            x: x * 32,
            y: y * 32,
            z: n(element.baseZ),
            object: object.index,
          },
          function (result) {
            if (actionError(result)) {
              console.log(
                "[Staff Zone Manager] Reparo: " + actionError(result),
              );
            }
          },
        );

        break;
      }
    });
  }

  // ============================================================
  // SPRITES PRESERVADOS
  // ============================================================

  function initThumbnails() {
    if (S.thumbnailRange || typeof ui === "undefined") return;

    try {
      var range = ui.imageManager.allocate(3);
      if (!range) return;

      S.thumbnailRange = range;

      S.thumbnails.handyman = range.start;

      S.thumbnails.security = range.start + 1;

      S.thumbnails.entertainer = range.start + 2;
    } catch (e) {
      console.log("[Staff Zone Manager] Miniaturas: " + e);
    }
  }

  function fixedSprite(type) {
    var people = staff(type);
    if (!people.length) return null;

    try {
      var frames = people[0].getAnimationSpriteIds(
        "walking",
        CFG.spriteRotation,
      );

      if (frames && frames.length && typeof frames[0] === "number") {
        return frames[0];
      }
    } catch (e) {}

    return null;
  }

  function thumbnail(type) {
    initThumbnails();

    var target = S.thumbnails[type];
    var sprite = fixedSprite(type);

    if (target == null || sprite == null) return "guests";

    if (S.spriteCache[type] === sprite) {
      return target;
    }

    try {
      var info = ui.imageManager.getImageInfo(sprite);

      if (!info) return "guests";

      var size = CFG.spriteSize;

      var x = Math.floor((size - info.width) / 2) - info.offset.x;

      var y = Math.floor((size - info.height) / 2) - info.offset.y;

      ui.imageManager.draw(
        target,
        {
          width: size,
          height: size,
        },
        function (graphics) {
          graphics.clear();
          graphics.clip(0, 0, size, size);
          graphics.image(sprite, x, y);
        },
      );

      S.spriteCache[type] = sprite;
      return target;
    } catch (e) {
      return "guests";
    }
  }

  function updateSprites() {
    if (!S.window) return;

    ["handyman", "security", "entertainer"].forEach(function (type) {
      var index = type === "handyman" ? 2 : type === "security" ? 3 : 4;

      var icon = widget("icon" + index);

      if (icon) {
        icon.image = thumbnail(type);
      }
    });

    var hand = widget("dimension_hand_icon");

    if (hand) {
      hand.image = thumbnail("handyman");
    }
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

  function text(name, value) {
    var w = widget(name);

    if (w) w.text = String(value);
  }

  function show(name, visible) {
    var w = widget(name);

    if (w) w.isVisible = visible;
  }

  function verdict(current, required) {
    if (current < required) {
      return "CONTRATAR +" + (required - current);
    }

    if (current > required) {
      return "SOBRAM " + (current - required);
    }

    return "OK";
  }

  function render() {
    if (!S.window) return;

    TABS.forEach(function (tab, index) {
      var button = widget("tab" + index);

      if (button) {
        button.isPressed = S.tab === index;
      }

      GROUPS[tab].forEach(function (id) {
        show(id, S.tab === index);
      });
    });

    text("status", S.status);

    text(
      "general1",
      "Caminhos: " +
        S.totalTiles +
        " | Filas: " +
        S.queueTiles +
        " | Saidas: " +
        collectExits().length,
    );

    text(
      "general2",
      "Objetos quebrados: " +
        S.diagnostics.broken +
        " | Irritados: " +
        S.diagnostics.angry +
        " | Insatisfeitos: " +
        S.diagnostics.unhappy,
    );

    TYPE_NAMES.forEach(function (type) {
      text(
        type + "_count",
        "Contratados: " +
          staff(type).length +
          " | Rondas aplicadas: " +
          S.zones[type].length,
      );

      var total = 0;
      var focused = 0;

      S.zones[type].forEach(function (zone) {
        total += zone.tiles;

        if (zone.mode === "prioridade") focused++;
      });

      text(
        type + "_coverage",
        "Tiles nas rondas: " +
          total +
          (type === "security" || type === "entertainer"
            ? " | Prioritarias: " + focused
            : ""),
      );

      var fire = widget(type + "_fire");

      if (fire) {
        var confirm =
          S.pendingFire &&
          S.pendingFire.type === type &&
          S.pendingFire.id === S.selectedId[type];

        fire.text = confirm ? "CONFIRMAR DEMISSAO" : "Demitir selecionado";

        fire.isDisabled = busy() || S.selectedId[type] === null;
      }

      var dropdown = widget(type + "_personnel");

      if (dropdown) {
        dropdown.isDisabled = busy();
      }

      var generateButton = widget(type + "_generate");

      var clearButton = widget(type + "_clear");

      var hireButton = widget(type + "_hire");

      if (generateButton) {
        generateButton.isDisabled = busy();
      }

      if (clearButton) {
        clearButton.isDisabled = busy();
      }

      if (hireButton) {
        hireButton.isDisabled = busy();
      }
    });

    if (S.dimension) {
      var d = S.dimension;

      text(
        "dim_history",
        "Historico: " + fmt(d.minutes) + " min | Confianca: " + d.confidence,
      );

      text(
        "dim_mech_result",
        "MECANICOS: " + verdict(d.mechanics, d.mechanicNeed),
      );

      text(
        "dim_mech_count",
        d.mechanics + " contratados / " + d.mechanicNeed + " recomendados",
      );

      text(
        "dim_mech_detail",
        "Inspecoes: " +
          fmt(d.inspections) +
          "/h | Reparos: " +
          fmt(d.repairs) +
          "/h | Carga: " +
          fmt(d.mechanicWork) +
          " min/h",
      );

      text(
        "dim_mech_speed",
        "Velocidade: " + fmt(d.mechanicSpeed) + " tiles/min | Meta: 75%",
      );

      text(
        "dim_hand_result",
        "ZELADORES: " + verdict(d.handymen, d.handymanNeed),
      );

      text(
        "dim_hand_count",
        d.handymen + " contratados / " + d.handymanNeed + " recomendados",
      );

      text(
        "dim_hand_detail",
        "Por caminhos: " +
          d.byCoverage +
          " | Visitantes: " +
          d.byGuests +
          " | Sujeira: " +
          d.byLitter +
          " | Carga: " +
          d.byWork,
      );

      text(
        "dim_hand_stats",
        "Visitantes: " +
          d.guests +
          " | Lixo: " +
          d.litter +
          " | Caminhos: " +
          d.accessible +
          " (" +
          Math.round(d.fraction * 100) +
          "% ponderado)",
      );

      text(
        "dim_hand_speed",
        "Velocidade: " +
          fmt(d.handymanSpeed) +
          " tiles/min | Trabalho: " +
          fmt(d.handWork) +
          " min/h",
      );
    }

    updateProgress();
  }

  function add(widgets, tab, definition) {
    definition.isVisible = false;
    widgets.push(definition);
    GROUPS[tab].push(definition.name);
  }

  function label(widgets, tab, name, content, x, y) {
    add(widgets, tab, {
      type: "label",
      name: name,
      x: x,
      y: y,
      width: 640,
      height: 18,
      text: content || "",
    });
  }

  function button(widgets, tab, name, title, x, y, width, callback) {
    add(widgets, tab, {
      type: "button",
      name: name,
      x: x,
      y: y,
      width: width,
      height: 24,
      text: title,
      onClick: callback,
    });
  }

  function switchTab(index) {
    S.pendingFire = null;
    S.tab = index;

    refreshAllPersonnel();
    render();
  }

  function openWindow() {
    if (typeof ui === "undefined") return;

    var previous = ui.getWindow(WINDOW);

    if (previous) {
      previous.bringToFront();
      return;
    }

    Object.keys(GROUPS).forEach(function (name) {
      GROUPS[name] = [];
    });

    initThumbnails();

    var widgets = [];

    var icons = [
      "park",
      "mechanic",
      thumbnail("handyman"),
      thumbnail("security"),
      thumbnail("entertainer"),
      "graph",
    ];

    for (var i = 0; i < TABS.length; i++) {
      (function (index) {
        var x = 9 + index * 111;

        widgets.push({
          type: "button",
          name: "icon" + index,
          x: x,
          y: 23,
          width: 29,
          height: 28,
          image: icons[index],
          tooltip: TAB_LABELS[index],
          onClick: function () {
            switchTab(index);
          },
        });

        widgets.push({
          type: "button",
          name: "tab" + index,
          x: x + 30,
          y: 23,
          width: 79,
          height: 28,
          text: TAB_LABELS[index],
          onClick: function () {
            switchTab(index);
          },
        });
      })(i);
    }

    TABS.forEach(function (tab, index) {
      add(widgets, tab, {
        type: "groupbox",
        name: "group_" + tab,
        x: 10,
        y: 59,
        width: 663,
        height: 327,
        text: TAB_LABELS[index],
      });
    });

    // GERAL

    label(widgets, "general", "general1", "", 25, 92);

    label(widgets, "general", "general2", "", 25, 120);

    button(
      widgets,
      "general",
      "analyze",
      "Analisar parque",
      25,
      165,
      160,
      analyze,
    );

    add(widgets, "general", {
      type: "checkbox",
      name: "repair_on",
      x: 25,
      y: 220,
      width: 350,
      height: 18,
      text: "Ativar reparo de vandalismo",
      isChecked: !!setting("StaffZoneManager.repairEnabled", false),
      onChange: function (value) {
        saveSetting("StaffZoneManager.repairEnabled", !!value);
      },
    });

    add(widgets, "general", {
      type: "checkbox",
      name: "repair_hand",
      x: 25,
      y: 247,
      width: 350,
      height: 18,
      text: "Zeladores reparam vandalismo",
      isChecked: !!setting("StaffZoneManager.repairhandyman", true),
      onChange: function (value) {
        saveSetting("StaffZoneManager.repairhandyman", !!value);
      },
    });

    label(
      widgets,
      "general",
      "general_note",
      "Rondas e contratacoes manuais. Fila sequencial.",
      25,
      306,
    );

    // FUNCIONARIOS

    TYPE_NAMES.forEach(function (type) {
      label(widgets, type, type + "_count", "", 25, 90);

      button(
        widgets,
        type,
        type + "_hire",
        "Contratar +1",
        25,
        130,
        140,
        function () {
          hire(type);
        },
      );

      button(
        widgets,
        type,
        type + "_generate",
        "Gerar rondas",
        175,
        130,
        140,
        function () {
          generate(type);
        },
      );

      button(
        widgets,
        type,
        type + "_clear",
        "Limpar rondas",
        325,
        130,
        140,
        function () {
          clearPatrols(type);
        },
      );

      label(
        widgets,
        type,
        type + "_person_label",
        "Funcionario para demitir:",
        25,
        178,
      );

      add(widgets, type, {
        type: "dropdown",
        name: type + "_personnel",
        x: 25,
        y: 201,
        width: 290,
        height: 22,
        items: ["Selecione um funcionario"],
        selectedIndex: 0,
        onChange: function (index) {
          selectPerson(type, index);
        },
      });

      button(
        widgets,
        type,
        type + "_fire",
        "Demitir selecionado",
        330,
        200,
        185,
        function () {
          fireSelected(type);
        },
      );

      var message =
        type === "mechanic"
          ? "Saidas e caminhos: algoritmo preservado."
          : type === "handyman"
            ? "Distribuicao por caminhos preservada."
            : type === "security"
              ? "Prioridade: vandalismo e irritacao."
              : "Prioridade: filas e satisfacao.";

      label(widgets, type, type + "_tip", message, 25, 247);

      label(widgets, type, type + "_coverage", "", 25, 282);
    });

    // DIMENSIONAMENTO

    label(widgets, "dimension", "dim_history", "", 25, 83);

    add(widgets, "dimension", {
      type: "button",
      name: "dimension_mech_icon",
      x: 25,
      y: 112,
      width: 28,
      height: 28,
      image: "mechanic",
      tooltip: "Mecanicos",
      onClick: function () {
        switchTab(1);
      },
    });

    label(widgets, "dimension", "dim_mech_result", "", 62, 120);

    label(widgets, "dimension", "dim_mech_count", "", 25, 151);

    label(widgets, "dimension", "dim_mech_detail", "", 25, 174);

    label(widgets, "dimension", "dim_mech_speed", "", 25, 197);

    add(widgets, "dimension", {
      type: "button",
      name: "dimension_hand_icon",
      x: 25,
      y: 233,
      width: 28,
      height: 28,
      image: thumbnail("handyman"),
      tooltip: "Zeladores",
      onClick: function () {
        switchTab(2);
      },
    });

    label(widgets, "dimension", "dim_hand_result", "", 62, 241);

    label(widgets, "dimension", "dim_hand_count", "", 25, 272);

    label(widgets, "dimension", "dim_hand_detail", "", 25, 295);

    label(widgets, "dimension", "dim_hand_stats", "", 25, 318);

    label(widgets, "dimension", "dim_hand_speed", "", 25, 341);

    button(
      widgets,
      "dimension",
      "recalculate",
      "Recalcular demanda",
      493,
      394,
      166,
      function () {
        dimension();
      },
    );

    // STATUS E PROGRESSO

    widgets.push({
      type: "label",
      name: "queue_caption",
      x: 13,
      y: 400,
      width: 550,
      height: 18,
      text: S.progress.title,
    });

    widgets.push({
      type: "label",
      name: "queue_bar",
      x: 13,
      y: 424,
      width: 490,
      height: 18,
      text: progressBar(0),
    });

    widgets.push({
      type: "button",
      name: "queue_cancel",
      x: 525,
      y: 415,
      width: 145,
      height: 24,
      text: "Cancelar fila",
      isDisabled: true,
      onClick: requestCancel,
    });

    widgets.push({
      type: "label",
      name: "status",
      x: 13,
      y: 451,
      width: 660,
      height: 36,
      text: S.status,
    });

    S.window = ui.openWindow({
      classification: WINDOW,
      title: "Staff Zone Manager " + VERSION,
      width: 684,
      height: 500,
      colours: [24, 24],
      widgets: widgets,
      onClose: function () {
        S.pendingFire = null;
        S.window = null;
      },
    });

    S.tab = 0;

    refreshAllPersonnel();
    render();
    dimension();
    updateSprites();
  }

  // ============================================================
  // RESET
  // ============================================================

  function reset() {
    if (S.job) {
      // Nao iniciar novas acoes no mapa anterior.
      S.job.token++;
      S.job = null;
    }

    S.analyzed = false;
    S.paths = [];
    S.pathMap = {};
    S.pathsByXY = {};
    S.adjacency = {};

    S.networkMode = "nao analisada";
    S.networkCount = 0;

    S.totalTiles = 0;
    S.queueTiles = 0;
    S.usefulTiles = 0;
    S.slopeTiles = 0;
    S.elevatedTiles = 0;
    S.exits = [];

    S.demand = {
      security: {},
      entertainer: {},
    };

    S.diagnostics = {
      broken: 0,
      angry: 0,
      unhappy: 0,
      queuePaths: 0,
    };

    S.samples = [];
    S.previous = null;
    S.dimension = null;
    S.pendingFire = null;

    S.zones = {
      mechanic: [],
      handyman: [],
      security: [],
      entertainer: [],
    };

    progressState("Mapa alterado", 0, 0, 0, false);

    status("Mapa alterado. Analise o parque novamente.");
  }

  // ============================================================
  // MAIN
  // ============================================================

  function main() {
    if (typeof ui !== "undefined") {
      ui.registerMenuItem("Staff Zone Manager", openWindow);
    }

    S.lastSample = ticks();
    S.lastRepair = ticks();

    /*
     * Fila em tempo real:
     * uma unica GameAction por vez.
     */
    context.setInterval(queueTick, CFG.queueIntervalMs);

    context.subscribe("interval.tick", function () {
      var now = ticks();

      if (now < S.lastSample) {
        S.lastSample = now;
        S.samples = [];
        S.previous = null;
      }

      if (now - S.lastSample >= CFG.sampleTicks) {
        S.lastSample = now;
        sample();

        if (S.window) {
          dimension();
          updateSprites();
        }
      }

      if (now < S.lastRepair) {
        S.lastRepair = now;
      }

      if (now - S.lastRepair >= 200) {
        S.lastRepair = now;
        repairTick();
      }
    });

    context.subscribe("map.change", reset);

    console.log("[Staff Zone Manager " + VERSION + "] carregado");
  }

  registerPlugin({
    name: "Staff Zone Manager",
    version: VERSION,
    authors: ["Kaoan / OpenAI (adaptacao)"],
    type: "local",
    licence: "MIT",
    targetApiVersion: 117,
    minApiVersion: 117,
    main: main,
  });
})();
