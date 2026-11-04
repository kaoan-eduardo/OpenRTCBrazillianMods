/**
 * Staff Zone Manager 1.9.6 - OpenRCT2 API 117+
 *
 * Correcao:
 * - Sprites dos funcionarios rotacionados 180 graus
 *   em relacao a versao 1.9.5 (rotacao 0 -> 2).
 *
 * Mantido:
 * - Miniaturas estaticas e centralizadas.
 * - Dimensionamento compacto e veredito direto.
 * - Mecanicos por station.exit e area retangular.
 * - Zeladores por caminhos e filas.
 * - Contratacao e rondas manuais.
 *
 * Dimensionamento experimental.
 */

(function () {
  "use strict";

  var VERSION = "1.9.6";

  var CFG = {
    mechanicPadding: 6,
    securityDepth: 22,
    entertainerDepth: 10,

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

    // ALTERACAO DA 1.9.6:
    // 0 mostrava as costas no seu teste.
    // 2 seleciona a direcao oposta.
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

  var TABS = [
    "general",
    "mechanic",
    "handyman",
    "security",
    "entertainer",
    "dimension",
  ];

  var LABELS = [
    "Geral",
    "Mecanicos",
    "Zeladores",
    "Seguranca",
    "Animadores",
    "Dimensionar",
  ];

  var WID = "staff-zone-manager-196";

  var S = {
    window: null,
    tab: 0,
    analyzed: false,
    busy: false,
    hiring: false,

    normalNodes: [],
    normalMap: {},
    handNodes: [],
    handMap: {},

    components: [],
    networkMode: "nao analisada",

    totalTiles: 0,
    queueTiles: 0,
    usefulTiles: 0,

    exits: [],
    hotspots: [],

    zones: {
      mechanic: [],
      handyman: [],
      security: [],
      entertainer: [],
    },

    samples: [],
    previous: null,
    lastSample: 0,
    lastRepair: 0,

    dimension: null,

    status: "Clique em Analisar parque.",

    thumbnails: {},
    thumbnailRange: null,
    sprites: {},
  };

  var TAB_WIDGETS = {
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

  function number(value, fallback) {
    return typeof value === "number" && isFinite(value) ? value : fallback || 0;
  }

  function tile(value) {
    return Math.floor(number(value) / 32);
  }

  function pos(x, y) {
    return x + "," + y;
  }

  function nodeId(x, y, index) {
    return x + "," + y + "," + index;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function fmt(value) {
    return number(value).toFixed(1).replace(".", ",");
  }

  function ticks() {
    return number(date.ticksElapsed);
  }

  function entities(type) {
    try {
      return map.getAllEntities(type) || [];
    } catch (e) {
      return [];
    }
  }

  function staff(type) {
    return entities("staff").filter(function (p) {
      return p.staffType === type;
    });
  }

  function rides() {
    return (map.rides || []).filter(function (r) {
      return r && r.classification === "ride";
    });
  }

  function actionError(result) {
    if (!result) {
      return "";
    }

    return (
      result.errorMessage ||
      result.errorTitle ||
      (result.error ? String(result.error) : "")
    );
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

  function guestCount() {
    return entities("guest").filter(function (p) {
      return p.isInPark;
    }).length;
  }

  // ============================================================
  // CAMINHOS
  // ============================================================

  function scanPaths() {
    S.normalNodes = [];
    S.handNodes = [];
    S.normalMap = {};
    S.handMap = {};

    var allTiles = {};
    var queueTiles = {};

    for (var y = 0; y < map.size.y; y++) {
      for (var x = 0; x < map.size.x; x++) {
        var cell = map.getTile(x, y);

        if (!cell) {
          continue;
        }

        for (var i = 0; i < cell.numElements; i++) {
          var element = cell.getElement(i);

          if (!element || element.type !== "footpath" || element.isGhost) {
            continue;
          }

          var node = {
            x: x,
            y: y,
            z: number(element.baseZ),
            index: i,
            queue: !!element.isQueue,
            id: nodeId(x, y, i),
          };

          S.handNodes.push(node);
          S.handMap[node.id] = node;

          allTiles[pos(x, y)] = true;

          if (element.isQueue) {
            queueTiles[pos(x, y)] = true;
          } else {
            S.normalNodes.push(node);
            S.normalMap[node.id] = node;
          }
        }
      }
    }

    S.totalTiles = Object.keys(allTiles).length;
    S.queueTiles = Object.keys(queueTiles).length;
  }

  function pathNeighbors(node, includeQueues) {
    if (typeof map.getPathNavigator !== "function") {
      return [];
    }

    try {
      var navigator = map.getPathNavigator(
        {
          x: node.x,
          y: node.y,
        },
        node.index,
        {
          respectBanners: false,
          includeGhosts: false,
          includeQueues: includeQueues,
          includeWidePaths: true,
        },
      );

      if (!navigator) {
        return [];
      }

      var lookup = includeQueues ? S.handMap : S.normalMap;

      var output = [];
      var connections = navigator.getConnectedPaths() || [];

      connections.forEach(function (connection) {
        if (!connection || !connection.position) {
          return;
        }

        var neighbor =
          lookup[
            nodeId(
              tile(connection.position.x),
              tile(connection.position.y),
              connection.elementIndex,
            )
          ];

        if (neighbor) {
          output.push(neighbor);
        }
      });

      return output;
    } catch (e) {
      return [];
    }
  }

  function approximateNeighbors(node, includeQueues) {
    var lookup = includeQueues ? S.handMap : S.normalMap;

    var output = [];

    [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ].forEach(function (delta) {
      var x = node.x + delta[0];
      var y = node.y + delta[1];

      if (x < 0 || y < 0 || x >= map.size.x || y >= map.size.y) {
        return;
      }

      var cell = map.getTile(x, y);

      if (!cell) {
        return;
      }

      for (var i = 0; i < cell.numElements; i++) {
        var candidate = lookup[nodeId(x, y, i)];

        if (candidate && candidate.z === node.z) {
          output.push(candidate);
        }
      }
    });

    return output;
  }

  function neighbors(node, includeQueues) {
    if (S.networkMode === "aproximada") {
      return approximateNeighbors(node, includeQueues);
    }

    return pathNeighbors(node, includeQueues);
  }

  function components() {
    var visited = {};
    var result = [];

    S.handNodes.forEach(function (start) {
      if (visited[start.id]) {
        return;
      }

      var queue = [start];
      var head = 0;
      var nodes = [];
      var tiles = {};

      visited[start.id] = true;

      while (head < queue.length) {
        var node = queue[head++];

        nodes.push(node);
        tiles[pos(node.x, node.y)] = true;

        neighbors(node, true).forEach(function (next) {
          if (!visited[next.id]) {
            visited[next.id] = true;
            queue.push(next);
          }
        });
      }

      result.push({
        nodes: nodes,
        tiles: tiles,
        count: Object.keys(tiles).length,
        guests: 0,
        score: 0,
      });
    });

    var guestTiles = {};

    entities("guest").forEach(function (guest) {
      if (!guest.isInPark) {
        return;
      }

      var position = pos(tile(guest.x), tile(guest.y));

      guestTiles[position] = (guestTiles[position] || 0) + 1;
    });

    result.forEach(function (component) {
      Object.keys(component.tiles).forEach(function (position) {
        component.guests += guestTiles[position] || 0;
      });

      component.score = component.count + component.guests * 3;
    });

    result.sort(function (a, b) {
      return b.score - a.score;
    });

    return result;
  }

  function usefulComponents() {
    var useful = S.components.filter(function (component) {
      return component.count >= 3 || component.guests > 0;
    });

    if (useful.length) {
      return useful;
    }

    return S.components.length ? [S.components[0]] : [];
  }

  function usefulTiles() {
    var seen = {};

    usefulComponents().forEach(function (component) {
      Object.keys(component.tiles).forEach(function (position) {
        seen[position] = true;
      });
    });

    return Object.keys(seen).length;
  }

  // ============================================================
  // MECANICOS - STATION.EXIT
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
        ) {
          return;
        }

        output.push({
          x: tile(station.exit.x),
          y: tile(station.exit.y),
          z: number(station.exit.z),
          rideId: ride.id,
        });
      });
    });

    return output;
  }

  function clusterExits(exits, count) {
    if (!exits.length || !count) {
      return [];
    }

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
          nearest = Math.min(
            nearest,
            Math.abs(point.x - seed.x) + Math.abs(point.y - seed.y),
          );
        });

        if (nearest > farthest) {
          farthest = nearest;
          best = point;
        }
      });

      if (!best) {
        break;
      }

      seeds.push(best);
    }

    var groups = seeds.map(function () {
      return [];
    });

    exits.forEach(function (point) {
      var best = 0;
      var minimum = Infinity;

      seeds.forEach(function (seed, index) {
        var distance = Math.abs(point.x - seed.x) + Math.abs(point.y - seed.y);

        if (distance < minimum) {
          minimum = distance;
          best = index;
        }
      });

      groups[best].push(point);
    });

    return groups;
  }

  function mechanicZone(group) {
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -1;
    var maxY = -1;

    group.forEach(function (point) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    });

    minX = clamp(minX - CFG.mechanicPadding, 0, map.size.x - 1);

    minY = clamp(minY - CFG.mechanicPadding, 0, map.size.y - 1);

    maxX = clamp(maxX + CFG.mechanicPadding, 0, map.size.x - 1);

    maxY = clamp(maxY + CFG.mechanicPadding, 0, map.size.y - 1);

    var tiles = {};

    for (var y = minY; y <= maxY; y++) {
      for (var x = minX; x <= maxX; x++) {
        tiles[pos(x, y)] = true;
      }
    }

    return {
      tiles: tiles,
      center: {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        z: group[0].z,
      },
    };
  }

  // ============================================================
  // HOTSPOTS
  // ============================================================

  function hotspots() {
    var cells = {};

    entities("guest").forEach(function (guest) {
      if (!guest.isInPark) {
        return;
      }

      var position = pos(
        Math.floor(tile(guest.x) / 6),
        Math.floor(tile(guest.y) / 6),
      );

      if (!cells[position]) {
        cells[position] = {
          count: 0,
          x: 0,
          y: 0,
        };
      }

      cells[position].count++;
      cells[position].x += guest.x;
      cells[position].y += guest.y;
    });

    S.hotspots = Object.keys(cells)
      .map(function (position) {
        var cell = cells[position];
        var closest = null;
        var minimum = Infinity;

        S.normalNodes.forEach(function (node) {
          var distance =
            Math.abs(node.x - tile(cell.x / cell.count)) +
            Math.abs(node.y - tile(cell.y / cell.count));

          if (distance < minimum) {
            minimum = distance;
            closest = node;
          }
        });

        return {
          node: closest,
          count: cell.count,
        };
      })
      .filter(function (hotspot) {
        return !!hotspot.node;
      })
      .sort(function (a, b) {
        return b.count - a.count;
      });
  }

  function analyze() {
    if (typeof map.getPathNavigator !== "function") {
      status("PathNavigator indisponivel.");
      return;
    }

    try {
      scanPaths();
      S.exits = collectExits();

      var examined = Math.min(S.handNodes.length, 400);
      var links = 0;

      for (var i = 0; i < examined; i++) {
        links += pathNeighbors(S.handNodes[i], true).length;
      }

      S.networkMode =
        examined > 10 && links === 0 ? "aproximada" : "PathNavigator";

      S.components = components();
      S.usefulTiles = usefulTiles();

      hotspots();

      S.analyzed = true;

      status(
        "Analisado: " +
          S.totalTiles +
          " tiles, " +
          S.usefulTiles +
          " relevantes, " +
          S.components.length +
          " redes (" +
          S.networkMode +
          ").",
      );

      dimension();
    } catch (e) {
      status("Erro de analise: " + e);
    }
  }

  // ============================================================
  // RONDAS
  // ============================================================

  function chooseSeeds(nodes, count) {
    if (!nodes.length || count <= 0) {
      return [];
    }

    var selected = [nodes[0]];

    while (selected.length < Math.min(nodes.length, count)) {
      var best = null;
      var farthest = -1;

      nodes.forEach(function (point) {
        if (selected.indexOf(point) >= 0) {
          return;
        }

        var nearest = Infinity;

        selected.forEach(function (seed) {
          var distance =
            Math.abs(point.x - seed.x) +
            Math.abs(point.y - seed.y) +
            Math.abs(point.z - seed.z) / 32;

          nearest = Math.min(nearest, distance);
        });

        if (nearest > farthest) {
          farthest = nearest;
          best = point;
        }
      });

      if (!best) {
        break;
      }

      selected.push(best);
    }

    return selected;
  }

  function splitComponent(component, count) {
    var seeds = chooseSeeds(component.nodes, count);

    var zones = [];
    var owner = {};
    var queue = [];
    var head = 0;

    seeds.forEach(function (point, index) {
      zones.push({});
      zones[index][pos(point.x, point.y)] = true;

      owner[point.id] = index;

      queue.push({
        point: point,
        owner: index,
      });
    });

    while (head < queue.length) {
      var current = queue[head++];

      neighbors(current.point, true).forEach(function (point) {
        if (owner[point.id] !== undefined) {
          return;
        }

        owner[point.id] = current.owner;

        zones[current.owner][pos(point.x, point.y)] = true;

        queue.push({
          point: point,
          owner: current.owner,
        });
      });
    }

    return {
      zones: zones,
      centers: seeds,
    };
  }

  function allocate(components, count) {
    var result = components.map(function () {
      return 0;
    });

    var remaining = count;

    for (var i = 0; i < components.length && remaining > 0; i++) {
      result[i]++;
      remaining--;
    }

    while (remaining > 0 && components.length) {
      var best = 0;
      var maximum = -1;

      components.forEach(function (component, index) {
        var score = component.score / (result[index] + 1);

        if (score > maximum) {
          maximum = score;
          best = index;
        }
      });

      result[best]++;
      remaining--;
    }

    return result;
  }

  function flood(start, limit) {
    var queue = [
      {
        point: start,
        depth: 0,
      },
    ];

    var head = 0;
    var visited = {};
    var tiles = {};

    while (head < queue.length) {
      var current = queue[head++];
      var point = current.point;

      if (visited[point.id]) {
        continue;
      }

      visited[point.id] = true;
      tiles[pos(point.x, point.y)] = true;

      if (current.depth >= limit) {
        continue;
      }

      neighbors(point, false).forEach(function (next) {
        if (!visited[next.id]) {
          queue.push({
            point: next,
            depth: current.depth + 1,
          });
        }
      });
    }

    return tiles;
  }

  function compressRuns(tiles) {
    var rows = {};
    var output = [];

    Object.keys(tiles).forEach(function (position) {
      var parts = position.split(",");
      var x = Number(parts[0]);
      var y = Number(parts[1]);

      if (!rows[y]) {
        rows[y] = [];
      }

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

        output.push({
          x1: start * 32,
          y1: Number(y) * 32,
          x2: previous * 32,
          y2: Number(y) * 32,
        });

        start = xs[i];
        previous = xs[i];
      }
    });

    return output;
  }

  function applyPatrol(id, tiles, done) {
    var runs = compressRuns(tiles);
    var index = 0;

    context.executeAction(
      "staffsetpatrolarea",
      {
        id: id,
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 0,
        mode: 2,
      },
      function (result) {
        if (actionError(result)) {
          done(actionError(result));
          return;
        }

        function next() {
          if (index >= runs.length) {
            done("");
            return;
          }

          var run = runs[index++];

          context.executeAction(
            "staffsetpatrolarea",
            {
              id: id,
              x1: run.x1,
              y1: run.y1,
              x2: run.x2,
              y2: run.y2,
              mode: 0,
            },
            function (response) {
              if (actionError(response)) {
                done(actionError(response));
              } else {
                next();
              }
            },
          );
        }

        next();
      },
    );
  }

  function applyZones(type, zones) {
    if (S.busy) {
      status("Ja existe uma operacao de ronda em andamento.");
      return;
    }

    var available = staff(type).slice();
    var assigned = [];

    zones = zones.slice(0, available.length);

    zones.forEach(function (zone) {
      if (!available.length) {
        return;
      }

      var best = 0;
      var minimum = Infinity;

      available.forEach(function (person, index) {
        var distance =
          Math.abs(tile(person.x) - zone.center.x) +
          Math.abs(tile(person.y) - zone.center.y);

        if (distance < minimum) {
          minimum = distance;
          best = index;
        }
      });

      assigned.push(available.splice(best, 1)[0]);
    });

    if (!assigned.length) {
      status("Nenhum funcionario contratado.");
      return;
    }

    S.busy = true;
    S.zones[type] = [];

    var index = 0;
    var completed = 0;
    var failed = 0;

    function next() {
      if (index >= assigned.length) {
        S.busy = false;

        status(
          TYPES[type].label +
            ": " +
            completed +
            " rondas aplicadas; " +
            failed +
            " erros.",
        );

        return;
      }

      var person = assigned[index];
      var zone = zones[index++];

      applyPatrol(person.id, zone.tiles, function (err) {
        if (err) {
          failed++;

          console.log("[Staff Zone Manager] " + err);
        } else {
          completed++;

          S.zones[type].push({
            id: person.id,
            tiles: Object.keys(zone.tiles).length,
          });
        }

        next();
      });
    }

    next();
  }

  function generate(type) {
    if (!S.analyzed) {
      status("Analise o parque primeiro.");
      return;
    }

    var count = staff(type).length;

    if (!count) {
      status("Nenhum funcionario contratado.");
      return;
    }

    if (type === "mechanic") {
      // Preservado: station.exit + zonas retangulares.

      var exits = collectExits();

      if (!exits.length) {
        status("Nenhuma saida de atracao valida.");
        return;
      }

      applyZones(type, clusterExits(exits, count).map(mechanicZone));

      return;
    }

    if (type === "handyman") {
      var comps = usefulComponents();
      var amounts = allocate(comps, count);
      var zones = [];

      comps.forEach(function (component, index) {
        if (!amounts[index]) {
          return;
        }

        var parts = splitComponent(
          component,
          Math.min(amounts[index], component.nodes.length),
        );

        parts.zones.forEach(function (zone, i) {
          zones.push({
            tiles: zone,
            center: parts.centers[i],
          });
        });
      });

      applyZones(type, zones);
      return;
    }

    var source = S.hotspots.map(function (hotspot) {
      return hotspot.node;
    });

    if (!source.length) {
      source = S.normalNodes;
    }

    if (!source.length) {
      status("Nenhum caminho encontrado.");
      return;
    }

    var selected = chooseSeeds(source, Math.min(count, source.length));

    var otherZones = [];

    for (var i = 0; i < count; i++) {
      var origin = selected[i % selected.length];

      otherZones.push({
        tiles: flood(
          origin,
          type === "security" ? CFG.securityDepth : CFG.entertainerDepth,
        ),
        center: origin,
      });
    }

    applyZones(type, otherZones);
  }

  function clearPatrols(type) {
    if (S.busy) {
      return;
    }

    var people = staff(type);
    var remaining = people.length;
    var failed = 0;

    if (!remaining) {
      status("Nenhum funcionario.");
      return;
    }

    S.busy = true;

    people.forEach(function (person) {
      context.executeAction(
        "staffsetpatrolarea",
        {
          id: person.id,
          x1: 0,
          y1: 0,
          x2: 0,
          y2: 0,
          mode: 2,
        },
        function (result) {
          if (actionError(result)) {
            failed++;
          }

          remaining--;

          if (remaining === 0) {
            S.busy = false;
            S.zones[type] = [];

            status("Rondas removidas. Erros: " + failed);
          }
        },
      );
    });
  }

  // ============================================================
  // CONTRATACAO
  // ============================================================

  function hire(type) {
    if (S.hiring) {
      return;
    }

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

      context.queryAction("staffhire", args, function (query) {
        if (actionError(query)) {
          if (type === "entertainer" && costume < 15) {
            costume++;
            attempt();
            return;
          }

          S.hiring = false;

          status("Falha: " + actionError(query));

          return;
        }

        context.executeAction("staffhire", args, function (result) {
          S.hiring = false;

          status(actionError(result) || "Contratacao executada: " + meta.label);

          dimension();
          updateSprites();
        });
      });
    }

    attempt();
  }

  // ============================================================
  // AMOSTRAGEM
  // ============================================================

  function counters(person) {
    if (person.staffType === "mechanic") {
      return {
        a: number(person.ridesInspected),
        b: number(person.ridesFixed),
      };
    }

    return {
      a: number(person.litterSwept),
      b: number(person.binsEmptied),
    };
  }

  function sample() {
    var point = {
      tick: ticks(),
      members: {},
    };

    entities("staff").forEach(function (person) {
      if (person.staffType !== "mechanic" && person.staffType !== "handyman") {
        return;
      }

      var counts = counters(person);

      var member = {
        type: person.staffType,
        x: number(person.x),
        y: number(person.y),
        a: counts.a,
        b: counts.b,
        distance: 0,
        elapsed: 0,
      };

      var previous = S.previous && S.previous.members[person.id];

      if (previous && S.previous.tick < point.tick) {
        var deltaTicks = point.tick - S.previous.tick;

        var distance =
          (Math.abs(member.x - previous.x) + Math.abs(member.y - previous.y)) /
          32;

        if (deltaTicks <= CFG.sampleTicks * 3 && distance <= deltaTicks / 12) {
          member.distance = distance;
          member.elapsed = deltaTicks;
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

    var totalDistance = 0;
    var elapsed = 0;

    S.samples.forEach(function (point) {
      Object.keys(point.members).forEach(function (id) {
        var member = point.members[id];

        if (member.type !== type) {
          return;
        }

        if (!first[id]) {
          first[id] = member;
        }

        last[id] = member;

        totalDistance += member.distance;
        elapsed += member.elapsed;
      });
    });

    var completedA = 0;
    var completedB = 0;

    Object.keys(last).forEach(function (id) {
      completedA += Math.max(0, last[id].a - first[id].a);

      completedB += Math.max(0, last[id].b - first[id].b);
    });

    var minutes =
      (S.samples[S.samples.length - 1].tick - S.samples[0].tick) /
      CFG.ticksPerMinute;

    return {
      minutes: minutes,

      a: minutes >= 5 ? (completedA * 60) / minutes : 0,

      b: minutes >= 5 ? (completedB * 60) / minutes : 0,

      speed: elapsed ? totalDistance / (elapsed / CFG.ticksPerMinute) : 0,
    };
  }

  // ============================================================
  // DIMENSIONAMENTO
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

    var mechanicObservation = observation("mechanic");

    var handymanObservation = observation("handyman");

    var guests = guestCount();
    var litter = entities("litter").length;

    var activeRides = rides().filter(function (ride) {
      return ride.status === "open" || ride.status === "testing";
    });

    var inspections = 0;
    var repairs = 0;

    activeRides.forEach(function (ride) {
      var period =
        CFG.inspectionPeriods[Math.floor(number(ride.inspectionInterval, 6))] ||
        0;

      if (period) {
        inspections += 60 / period;
      }

      var reliability = clamp(number(ride.reliability, 100), 0, 100);

      repairs +=
        0.08 +
        0.007 * (100 - reliability) +
        0.002 * clamp(number(ride.downtime), 0, 100);
    });

    if (mechanicObservation.minutes >= 10) {
      inspections = Math.max(inspections, mechanicObservation.a);

      repairs = Math.max(repairs, mechanicObservation.b);
    }

    var mechanicTravel =
      mechanicObservation.speed > 0
        ? clamp(12 / mechanicObservation.speed, 0.15, 4)
        : 1.5;

    var mechanicWork =
      inspections * CFG.inspectionMinutes +
      repairs * CFG.repairMinutes +
      (inspections + repairs) * mechanicTravel;

    var mechanicNeed = activeRides.length
      ? Math.max(1, Math.ceil(mechanicWork / (60 * CFG.mechanicUtilization)))
      : 0;

    var cleaning = Math.max(
      guests * 0.018,
      litter * 0.5,
      handymanObservation.minutes >= 10 ? handymanObservation.a : 0,
    );

    var bins = Math.max(
      guests * 0.004,
      handymanObservation.minutes >= 10 ? handymanObservation.b : 0,
    );

    var travel =
      handymanObservation.speed > 0
        ? clamp(6 / handymanObservation.speed, 0.1, 3)
        : 1;

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

    var minutes = Math.max(
      mechanicObservation.minutes,
      handymanObservation.minutes,
    );

    S.dimension = {
      mechanics: mechanics,
      mechanicNeed: mechanicNeed,
      mechanicWork: mechanicWork,

      inspections: inspections,
      repairs: repairs,
      mechanicSpeed: mechanicObservation.speed,

      handymen: handymen,
      handymanNeed: handNeed,
      handWork: handWork,

      cleaning: cleaning,
      bins: bins,
      handymanSpeed: handymanObservation.speed,

      byCoverage: byCoverage,
      byGuests: byGuests,
      byWork: byWork,
      byLitter: byLitter,

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
  // REPARO OPCIONAL DE VANDALISMO
  // ============================================================

  function repairTick() {
    if (!setting("StaffZoneManager.repairEnabled", false)) {
      return;
    }

    if (typeof network !== "undefined" && network.mode === "client") {
      return;
    }

    if (!setting("StaffZoneManager.repairhandyman", true)) {
      return;
    }

    staff("handyman").forEach(function (person) {
      var x = tile(person.x);
      var y = tile(person.y);

      if (x < 0 || y < 0 || x >= map.size.x || y >= map.size.y) {
        return;
      }

      var cell = map.getTile(x, y);

      if (!cell) {
        return;
      }

      for (var i = 0; i < cell.numElements; i++) {
        var element = cell.getElement(i);

        if (
          !element ||
          element.type !== "footpath" ||
          !element.isAdditionBroken ||
          element.addition == null ||
          number(element.baseZ) !== number(person.z)
        ) {
          continue;
        }

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

        if (!object || object.index === undefined) {
          continue;
        }

        context.executeAction(
          "footpathadditionplace",
          {
            x: x * 32,
            y: y * 32,
            z: number(element.baseZ),
            object: object.index,
          },
          function (result) {
            if (actionError(result)) {
              console.log(actionError(result));
            }
          },
        );

        break;
      }
    });
  }

  // ============================================================
  // SPRITES ESTATICOS CENTRALIZADOS
  // ============================================================

  function initThumbnails() {
    if (S.thumbnailRange) {
      return;
    }

    try {
      var range = ui.imageManager.allocate(3);

      if (range) {
        S.thumbnailRange = range;

        S.thumbnails.handyman = range.start;
        S.thumbnails.security = range.start + 1;
        S.thumbnails.entertainer = range.start + 2;
      }
    } catch (e) {
      console.log("[Staff Zone Manager] Miniaturas: " + e);
    }
  }

  function fixedSprite(type) {
    var people = staff(type);

    if (!people.length) {
      return null;
    }

    var person = people[0];
    var frames;

    try {
      frames = person.getAnimationSpriteIds(
        "walking",

        // VERSAO 1.9.6:
        // Frente oposta a direcao anterior (0).
        CFG.spriteRotation,
      );
    } catch (e) {
      return null;
    }

    if (!frames || !frames.length) {
      return null;
    }

    return typeof frames[0] === "number" && frames[0] >= 0 ? frames[0] : null;
  }

  function thumbnail(type) {
    initThumbnails();

    var target = S.thumbnails[type];
    var sprite = fixedSprite(type);

    if (target == null || sprite == null) {
      return "guests";
    }

    if (S.sprites[type] === sprite) {
      return target;
    }

    try {
      var info = ui.imageManager.getImageInfo(sprite);

      if (!info) {
        return "guests";
      }

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

      S.sprites[type] = sprite;

      return target;
    } catch (e) {
      console.log("[Staff Zone Manager] Sprite " + type + ": " + e);

      return "guests";
    }
  }

  function updateSprites() {
    if (!S.window) {
      return;
    }

    ["handyman", "security", "entertainer"].forEach(function (type) {
      var index = type === "handyman" ? 2 : type === "security" ? 3 : 4;

      var icon = widget("icon" + index);

      if (icon) {
        icon.image = thumbnail(type);
      }
    });

    var dimensionIcon = widget("dimension_hand_icon");

    if (dimensionIcon) {
      dimensionIcon.image = thumbnail("handyman");
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

  function setText(name, value) {
    var current = widget(name);

    if (current) {
      current.text = String(value);
    }
  }

  function show(name, visible) {
    var current = widget(name);

    if (current) {
      current.isVisible = visible;
    }
  }

  function verdict(current, wanted) {
    if (current < wanted) {
      return "CONTRATAR +" + (wanted - current);
    }

    if (current > wanted) {
      return "SOBRAM " + (current - wanted);
    }

    return "OK";
  }

  function render() {
    if (!S.window) {
      return;
    }

    TABS.forEach(function (name, index) {
      var current = widget("tab" + index);

      if (current) {
        current.isPressed = S.tab === index;
      }

      TAB_WIDGETS[name].forEach(function (id) {
        show(id, S.tab === index);
      });
    });

    setText("status", S.status);

    setText(
      "general1",
      "Caminhos: " +
        S.totalTiles +
        " | Filas: " +
        S.queueTiles +
        " | Saidas: " +
        collectExits().length,
    );

    setText(
      "general2",
      "Caminhos relevantes: " +
        S.usefulTiles +
        " | Redes: " +
        S.components.length +
        " | " +
        S.networkMode,
    );

    Object.keys(TYPES).forEach(function (type) {
      setText(
        type + "_count",
        "Contratados: " +
          staff(type).length +
          " | Rondas aplicadas: " +
          S.zones[type].length,
      );
    });

    var data = S.dimension;

    if (!data) {
      return;
    }

    setText(
      "dim_history",
      "Historico: " +
        fmt(data.minutes) +
        " min simulados | Confianca: " +
        data.confidence,
    );

    setText(
      "dim_mech_result",
      "MECANICOS: " + verdict(data.mechanics, data.mechanicNeed),
    );

    setText(
      "dim_mech_count",
      data.mechanics + " contratados / " + data.mechanicNeed + " recomendados",
    );

    setText(
      "dim_mech_detail",
      "Inspecoes: " +
        fmt(data.inspections) +
        "/h | Reparos: " +
        fmt(data.repairs) +
        "/h | Carga: " +
        fmt(data.mechanicWork) +
        " min/h",
    );

    setText(
      "dim_mech_speed",
      "Velocidade: " + fmt(data.mechanicSpeed) + " tiles/min | Meta: 75%",
    );

    setText(
      "dim_hand_result",
      "ZELADORES: " + verdict(data.handymen, data.handymanNeed),
    );

    setText(
      "dim_hand_count",
      data.handymen + " contratados / " + data.handymanNeed + " recomendados",
    );

    setText(
      "dim_hand_detail",
      "Por caminhos: " +
        data.byCoverage +
        " | Visitantes: " +
        data.byGuests +
        " | Sujeira: " +
        data.byLitter +
        " | Carga: " +
        data.byWork,
    );

    setText(
      "dim_hand_stats",
      "Visitantes: " +
        data.guests +
        " | Lixo: " +
        data.litter +
        " | Caminhos: " +
        data.accessible +
        " (" +
        Math.round(data.fraction * 100) +
        "% ponderado)",
    );

    setText(
      "dim_hand_speed",
      "Velocidade: " +
        fmt(data.handymanSpeed) +
        " tiles/min | Trabalho: " +
        fmt(data.handWork) +
        " min/h",
    );

    setText(
      "handyman_coverage",
      "Cobertura: " +
        fmt(data.accessible * data.fraction) +
        " tiles ponderados de " +
        data.accessible,
    );
  }

  function add(widgets, tab, definition) {
    definition.isVisible = false;

    widgets.push(definition);

    TAB_WIDGETS[tab].push(definition.name);
  }

  function label(widgets, tab, id, content, x, y, width) {
    add(widgets, tab, {
      type: "label",
      name: id,
      x: x,
      y: y,
      width: width || 630,
      height: 18,
      text: content || "",
    });
  }

  function button(widgets, tab, id, title, x, y, width, callback) {
    add(widgets, tab, {
      type: "button",
      name: id,
      x: x,
      y: y,
      width: width,
      height: 24,
      text: title,
      onClick: callback,
    });
  }

  function openWindow() {
    if (typeof ui === "undefined") {
      return;
    }

    var existing = ui.getWindow(WID);

    if (existing) {
      existing.bringToFront();
      return;
    }

    Object.keys(TAB_WIDGETS).forEach(function (name) {
      TAB_WIDGETS[name] = [];
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

    // ========================================================
    // ABAS
    // ========================================================

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
          tooltip: LABELS[index],
          onClick: function () {
            S.tab = index;
            render();
          },
        });

        widgets.push({
          type: "button",
          name: "tab" + index,
          x: x + 30,
          y: 23,
          width: 79,
          height: 28,
          text: LABELS[index],
          onClick: function () {
            S.tab = index;
            render();
          },
        });
      })(i);
    }

    TABS.forEach(function (name, index) {
      add(widgets, name, {
        type: "groupbox",
        name: "group_" + name,
        x: 10,
        y: 59,
        width: 663,
        height: 327,
        text: LABELS[index],
      });
    });

    // ========================================================
    // GERAL
    // ========================================================

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
      "Contratacoes e rondas so acontecem quando voce clicar.",
      25,
      306,
    );

    // ========================================================
    // FUNCIONARIOS
    // ========================================================

    ["mechanic", "handyman", "security", "entertainer"].forEach(
      function (type) {
        label(widgets, type, type + "_count", "", 25, 96);

        button(
          widgets,
          type,
          type + "_hire",
          "Contratar +1",
          25,
          145,
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
          145,
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
          145,
          140,
          function () {
            clearPatrols(type);
          },
        );

        var hint;

        if (type === "mechanic") {
          hint = "Mecanicos usam saidas das atracoes.";
        } else if (type === "handyman") {
          hint = "Zeladores cobrem caminhos e filas.";
        } else {
          hint = "Rondas baseadas nas areas movimentadas.";
        }

        label(widgets, type, type + "_hint", hint, 25, 211);

        label(
          widgets,
          type,
          type + "_tip",
          "Consulte Dimensionar para comparar contratados e recomendados.",
          25,
          247,
        );
      },
    );

    label(widgets, "handyman", "handyman_coverage", "", 25, 282);

    // ========================================================
    // DIMENSIONAMENTO
    // ========================================================

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
        S.tab = 1;
        render();
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
        S.tab = 2;
        render();
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
      dimension,
    );

    // ========================================================
    // STATUS
    // ========================================================

    widgets.push({
      type: "label",
      name: "status",
      x: 13,
      y: 435,
      width: 660,
      height: 32,
      text: S.status,
    });

    S.window = ui.openWindow({
      classification: WID,
      title: "Staff Zone Manager " + VERSION,
      width: 684,
      height: 475,
      colours: [24, 24],
      widgets: widgets,
      onClose: function () {
        S.window = null;
      },
    });

    S.tab = 0;

    render();
    dimension();
    updateSprites();
  }

  // ============================================================
  // RESET
  // ============================================================

  function reset() {
    S.analyzed = false;

    S.normalNodes = [];
    S.normalMap = {};
    S.handNodes = [];
    S.handMap = {};
    S.components = [];
    S.hotspots = [];
    S.exits = [];

    S.usefulTiles = 0;
    S.totalTiles = 0;
    S.queueTiles = 0;

    S.networkMode = "nao analisada";

    S.samples = [];
    S.previous = null;
    S.dimension = null;

    S.zones = {
      mechanic: [],
      handyman: [],
      security: [],
      entertainer: [],
    };

    status("Mapa alterado. Clique em Analisar parque.");
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
