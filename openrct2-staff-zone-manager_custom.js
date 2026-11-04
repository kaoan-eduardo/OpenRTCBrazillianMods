/**
 * Staff Zone Manager 1.9.2
 * OpenRCT2 - API 117+
 *
 * CORRECOES:
 * - Zeladores dimensionados por cobertura + visitantes + trabalho.
 * - Remove recomendacao de um zelador por rede.
 * - Calcula caminhos relevantes para o parque.
 * - Identifica quando a conectividade e apenas aproximada.
 * - Mantem mecanicos por station.exit.
 * - Mantem os icones Geral, Mecanicos e Dimensionar.
 * - Substitui icones confusos por Z, S e A.
 * - Contratacao e rondas sempre manuais.
 *
 * Dimensionamento experimental. Nao e formula oficial do jogo.
 */

(function () {
  "use strict";

  var VERSION = "1.9.2";
  var WINDOW = "staff-zone-manager-192";

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

    // Cobertura geografica: parametros experimentais.
    handymanTilesPerWorker: 85,
    handymanGuestsPerWorker: 170,
    handymanLitterPerWorker: 12,

    minUsefulComponent: 3,
  };

  var TYPES = {
    mechanic: {
      title: "Mecanicos",
      api: 1,
      orders: 3,
    },
    handyman: {
      title: "Zeladores",
      api: 0,
      orders: 7,
    },
    security: {
      title: "Seguranca",
      api: 2,
      orders: 0,
    },
    entertainer: {
      title: "Animadores",
      api: 3,
      orders: 0,
    },
  };

  var TAB_NAMES = [
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
    busy: false,
    hiring: false,

    normalNodes: [],
    normalMap: {},

    handNodes: [],
    handMap: {},

    components: [],
    networkMode: "nao analisada",
    pathLinks: 0,

    usefulTiles: 0,
    totalTiles: 0,
    queueTiles: 0,

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

  function num(v, fallback) {
    return typeof v === "number" && isFinite(v) ? v : fallback || 0;
  }

  function tile(v) {
    return Math.floor(num(v) / 32);
  }

  function key(x, y) {
    return x + "," + y;
  }

  function nodeKey(x, y, i) {
    return x + "," + y + "," + i;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(v, max));
  }

  function format(v) {
    return num(v).toFixed(1).replace(".", ",");
  }

  function ticks() {
    return num(date.ticksElapsed);
  }

  function getEntities(type) {
    try {
      return map.getAllEntities(type) || [];
    } catch (e) {
      return [];
    }
  }

  function getStaff(type) {
    return getEntities("staff").filter(function (p) {
      return p.staffType === type;
    });
  }

  function getRides() {
    return (map.rides || []).filter(function (r) {
      return r && r.classification === "ride";
    });
  }

  function getError(result) {
    return (
      result &&
      (result.errorMessage ||
        result.errorTitle ||
        (result.error ? String(result.error) : ""))
    );
  }

  function getSetting(name, fallback) {
    try {
      var value = context.sharedStorage.get(name);
      return value == null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function setSetting(name, value) {
    try {
      context.sharedStorage.set(name, value);
    } catch (e) {}
  }

  function setStatus(message) {
    S.status = message;
    render();
  }

  function guestCount() {
    return getEntities("guest").filter(function (g) {
      return g.isInPark;
    }).length;
  }

  // ============================================================
  // ANALISE DOS CAMINHOS
  // ============================================================

  function scanPaths() {
    S.normalNodes = [];
    S.normalMap = {};
    S.handNodes = [];
    S.handMap = {};

    var allTiles = {};
    var queueTiles = {};

    for (var y = 0; y < map.size.y; y++) {
      for (var x = 0; x < map.size.x; x++) {
        var cell = map.getTile(x, y);

        if (!cell) continue;

        for (var i = 0; i < cell.numElements; i++) {
          var e = cell.getElement(i);

          if (!e || e.type !== "footpath" || e.isGhost) {
            continue;
          }

          var p = {
            x: x,
            y: y,
            z: num(e.baseZ),
            index: i,
            queue: !!e.isQueue,
            id: nodeKey(x, y, i),
          };

          S.handNodes.push(p);
          S.handMap[p.id] = p;

          allTiles[key(x, y)] = true;

          if (e.isQueue) {
            queueTiles[key(x, y)] = true;
          } else {
            S.normalNodes.push(p);
            S.normalMap[p.id] = p;
          }
        }
      }
    }

    S.totalTiles = Object.keys(allTiles).length;
    S.queueTiles = Object.keys(queueTiles).length;
  }

  function pathNeighbors(p, includeQueues) {
    if (typeof map.getPathNavigator !== "function") {
      return [];
    }

    var nav;

    try {
      nav = map.getPathNavigator({ x: p.x, y: p.y }, p.index, {
        respectBanners: false,
        includeGhosts: false,
        includeQueues: includeQueues,
        includeWidePaths: true,
      });
    } catch (e) {
      return [];
    }

    if (!nav) return [];

    var connections;

    try {
      connections = nav.getConnectedPaths() || [];
    } catch (e) {
      return [];
    }

    var lookup = includeQueues ? S.handMap : S.normalMap;

    var result = [];

    connections.forEach(function (c) {
      if (!c || !c.position) return;

      var p2 =
        lookup[nodeKey(tile(c.position.x), tile(c.position.y), c.elementIndex)];

      if (p2) result.push(p2);
    });

    return result;
  }

  /*
   * Fallback por adjacencia:
   * apenas diagnostico aproximado de conectividade.
   *
   * Nao representa necessariamente as conexoes reais
   * entre rampas ou caminhos com restricoes especiais.
   */
  function fallbackNeighbors(p, includeQueues) {
    var lookup = includeQueues ? S.handMap : S.normalMap;

    var result = [];

    [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ].forEach(function (delta) {
      var x = p.x + delta[0];
      var y = p.y + delta[1];

      if (x < 0 || y < 0 || x >= map.size.x || y >= map.size.y) {
        return;
      }

      var cell = map.getTile(x, y);
      if (!cell) return;

      for (var i = 0; i < cell.numElements; i++) {
        var q = lookup[nodeKey(x, y, i)];

        if (q && q.z === p.z) {
          result.push(q);
        }
      }
    });

    return result;
  }

  function neighbors(p, hand) {
    if (S.networkMode === "aproximada") {
      return fallbackNeighbors(p, hand);
    }

    return pathNeighbors(p, hand);
  }

  function buildComponents() {
    var visited = {};
    var result = [];

    S.handNodes.forEach(function (start) {
      if (visited[start.id]) return;

      var queue = [start];
      var index = 0;
      var nodes = [];
      var tiles = {};

      visited[start.id] = true;

      while (index < queue.length) {
        var p = queue[index++];

        nodes.push(p);
        tiles[key(p.x, p.y)] = true;

        neighbors(p, true).forEach(function (next) {
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

    getEntities("guest").forEach(function (g) {
      if (!g.isInPark) return;

      var k = key(tile(g.x), tile(g.y));
      guestTiles[k] = (guestTiles[k] || 0) + 1;
    });

    result.forEach(function (c) {
      Object.keys(c.tiles).forEach(function (k) {
        c.guests += guestTiles[k] || 0;
      });

      c.score = c.count + c.guests * 3;
    });

    result.sort(function (a, b) {
      return b.score - a.score;
    });

    return result;
  }

  /*
   * Define caminhos relevantes para os zeladores.
   *
   * Redes com visitantes sao relevantes.
   * Redes grandes tambem sao consideradas.
   *
   * O numero de redes NAO determina a
   * quantidade de funcionarios.
   */
  function usefulComponents() {
    var components = S.components.filter(function (c) {
      return c.guests > 0 || c.count >= CFG.minUsefulComponent;
    });

    if (!components.length && S.components.length) {
      components = [S.components[0]];
    }

    return components;
  }

  function countUsefulTiles() {
    var unique = {};

    usefulComponents().forEach(function (c) {
      Object.keys(c.tiles).forEach(function (k) {
        unique[k] = true;
      });
    });

    return Object.keys(unique).length;
  }

  // ============================================================
  // MECANICOS - SAIDAS DAS ATRACOES
  // ============================================================

  function collectExits() {
    var exits = [];

    getRides().forEach(function (ride) {
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

        exits.push({
          x: tile(station.exit.x),
          y: tile(station.exit.y),
          z: num(station.exit.z),
          rideId: ride.id,
        });
      });
    });

    return exits;
  }

  function clusterExits(exits, count) {
    if (!count || !exits.length) return [];

    if (count >= exits.length) {
      var repeated = [];

      for (var i = 0; i < count; i++) {
        repeated.push([exits[i % exits.length]]);
      }

      return repeated;
    }

    var selected = [exits[0]];

    while (selected.length < count) {
      var best = null;
      var maxDistance = -1;

      exits.forEach(function (p) {
        var distance = Infinity;

        selected.forEach(function (s) {
          distance = Math.min(
            distance,
            Math.abs(p.x - s.x) + Math.abs(p.y - s.y),
          );
        });

        if (distance > maxDistance) {
          maxDistance = distance;
          best = p;
        }
      });

      if (!best) break;

      selected.push(best);
    }

    var groups = selected.map(function () {
      return [];
    });

    exits.forEach(function (p) {
      var best = 0;
      var distance = Infinity;

      selected.forEach(function (s, i) {
        var d = Math.abs(p.x - s.x) + Math.abs(p.y - s.y);

        if (d < distance) {
          distance = d;
          best = i;
        }
      });

      groups[best].push(p);
    });

    return groups;
  }

  function mechanicZone(group) {
    /*
     * Mantem o metodo aprovado:
     * saida real + padding + area retangular.
     */
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -1;
    var maxY = -1;

    group.forEach(function (p) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });

    minX = clamp(minX - CFG.mechanicPadding, 0, map.size.x - 1);

    minY = clamp(minY - CFG.mechanicPadding, 0, map.size.y - 1);

    maxX = clamp(maxX + CFG.mechanicPadding, 0, map.size.x - 1);

    maxY = clamp(maxY + CFG.mechanicPadding, 0, map.size.y - 1);

    var tiles = {};

    for (var y = minY; y <= maxY; y++) {
      for (var x = minX; x <= maxX; x++) {
        tiles[key(x, y)] = true;
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

  function findHotspots() {
    var cells = {};

    getEntities("guest").forEach(function (g) {
      if (!g.isInPark) return;

      var k = key(Math.floor(tile(g.x) / 6), Math.floor(tile(g.y) / 6));

      if (!cells[k]) {
        cells[k] = {
          count: 0,
          x: 0,
          y: 0,
        };
      }

      cells[k].count++;
      cells[k].x += g.x;
      cells[k].y += g.y;
    });

    S.hotspots = Object.keys(cells)
      .map(function (k) {
        var cell = cells[k];
        var best = null;
        var distance = Infinity;

        S.normalNodes.forEach(function (p) {
          var d =
            Math.abs(p.x - tile(cell.x / cell.count)) +
            Math.abs(p.y - tile(cell.y / cell.count));

          if (d < distance) {
            distance = d;
            best = p;
          }
        });

        return {
          node: best,
          count: cell.count,
        };
      })
      .filter(function (h) {
        return !!h.node;
      })
      .sort(function (a, b) {
        return b.count - a.count;
      });
  }

  function analyze() {
    if (typeof map.getPathNavigator !== "function") {
      setStatus("PathNavigator indisponivel.");
      return;
    }

    try {
      scanPaths();
      S.exits = collectExits();

      // Verifica se o navegador devolve ligacoes.
      var links = 0;

      var samples = Math.min(S.handNodes.length, 400);

      for (var i = 0; i < samples; i++) {
        links += pathNeighbors(S.handNodes[i], true).length;
      }

      S.pathLinks = links;

      S.networkMode =
        samples > 10 && links === 0 ? "aproximada" : "PathNavigator";

      S.components = buildComponents();
      S.usefulTiles = countUsefulTiles();

      findHotspots();

      S.analyzed = true;

      setStatus(
        "Analise concluida: " +
          S.totalTiles +
          " tiles; " +
          S.usefulTiles +
          " relevantes; " +
          S.components.length +
          " redes (" +
          S.networkMode +
          ").",
      );

      dimension();
    } catch (e) {
      setStatus("Erro na analise: " + e);
    }
  }

  // ============================================================
  // DISTRIBUICAO DOS ZELADORES
  // ============================================================

  function chooseSeeds(nodes, count) {
    if (!nodes.length || count <= 0) return [];

    var selected = [nodes[0]];

    while (selected.length < Math.min(nodes.length, count)) {
      var best = null;
      var maxDistance = -1;

      nodes.forEach(function (p) {
        if (selected.indexOf(p) >= 0) return;

        var distance = Infinity;

        selected.forEach(function (q) {
          var d =
            Math.abs(p.x - q.x) +
            Math.abs(p.y - q.y) +
            Math.abs(p.z - q.z) / 32;

          distance = Math.min(distance, d);
        });

        if (distance > maxDistance) {
          maxDistance = distance;
          best = p;
        }
      });

      if (!best) break;
      selected.push(best);
    }

    return selected;
  }

  function splitComponent(component, count) {
    var selected = chooseSeeds(component.nodes, count);

    var zones = [];
    var owner = {};
    var queue = [];
    var head = 0;

    selected.forEach(function (p, i) {
      zones.push({});
      zones[i][key(p.x, p.y)] = true;
      owner[p.id] = i;

      queue.push({
        node: p,
        owner: i,
      });
    });

    while (head < queue.length) {
      var cur = queue[head++];

      neighbors(cur.node, true).forEach(function (p) {
        if (owner[p.id] !== undefined) return;

        owner[p.id] = cur.owner;

        zones[cur.owner][key(p.x, p.y)] = true;

        queue.push({
          node: p,
          owner: cur.owner,
        });
      });
    }

    return {
      zones: zones,
      centers: selected,
    };
  }

  function allocate(components, workers) {
    var result = components.map(function () {
      return 0;
    });

    var left = workers;

    for (var i = 0; i < components.length && left > 0; i++) {
      result[i]++;
      left--;
    }

    while (left > 0 && components.length) {
      var best = 0;
      var bestScore = -1;

      components.forEach(function (c, i) {
        var score = c.score / (result[i] + 1);

        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      });

      result[best]++;
      left--;
    }

    return result;
  }

  function flood(start, depth) {
    var queue = [
      {
        node: start,
        depth: 0,
      },
    ];

    var visited = {};
    var result = {};
    var head = 0;

    while (head < queue.length) {
      var cur = queue[head++];
      var p = cur.node;

      if (visited[p.id]) continue;

      visited[p.id] = true;
      result[key(p.x, p.y)] = true;

      if (cur.depth >= depth) continue;

      neighbors(p, false).forEach(function (next) {
        if (!visited[next.id]) {
          queue.push({
            node: next,
            depth: cur.depth + 1,
          });
        }
      });
    }

    return result;
  }

  // ============================================================
  // EXECUCAO DAS RONDAS
  // ============================================================

  function compressRuns(tiles) {
    var rows = {};
    var runs = [];

    Object.keys(tiles).forEach(function (k) {
      var parts = k.split(",");
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
      var prev = xs[0];

      for (var i = 1; i <= xs.length; i++) {
        if (i < xs.length && xs[i] === prev + 1) {
          prev = xs[i];
          continue;
        }

        runs.push({
          x1: start * 32,
          y1: +y * 32,
          x2: prev * 32,
          y2: +y * 32,
        });

        start = xs[i];
        prev = xs[i];
      }
    });

    return runs;
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
        if (getError(result)) {
          done(getError(result));
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
            function (r) {
              if (getError(r)) {
                done(getError(r));
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
      setStatus("Ja existe uma operacao em andamento.");
      return;
    }

    var available = getStaff(type).slice();
    var assigned = [];

    zones = zones.slice(0, available.length);

    zones.forEach(function (z) {
      if (!available.length) return;

      var best = 0;
      var bestDistance = Infinity;

      available.forEach(function (p, i) {
        var d =
          Math.abs(tile(p.x) - z.center.x) + Math.abs(tile(p.y) - z.center.y);

        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      });

      assigned.push(available.splice(best, 1)[0]);
    });

    if (!assigned.length) {
      setStatus("Nenhum funcionario contratado.");
      return;
    }

    S.busy = true;
    S.zones[type] = [];

    var i = 0;
    var ok = 0;
    var failures = 0;

    function next() {
      if (i >= assigned.length) {
        S.busy = false;

        setStatus(
          TYPES[type].title +
            ": " +
            ok +
            " rondas aplicadas; " +
            failures +
            " erros.",
        );

        return;
      }

      var worker = assigned[i];
      var zone = zones[i];

      i++;

      applyPatrol(worker.id, zone.tiles, function (err) {
        if (err) {
          failures++;
          console.log("[Staff Zone Manager] " + err);
        } else {
          ok++;

          S.zones[type].push({
            id: worker.id,
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
      setStatus("Analise o parque primeiro.");
      return;
    }

    var count = getStaff(type).length;

    if (!count) {
      setStatus("Nenhum funcionario contratado.");
      return;
    }

    if (type === "mechanic") {
      /*
       * MECANICOS:
       * algoritmo por station.exit preservado.
       */
      var exits = collectExits();

      if (!exits.length) {
        setStatus("Nenhuma saida valida.");
        return;
      }

      applyZones(type, clusterExits(exits, count).map(mechanicZone));

      return;
    }

    if (type === "handyman") {
      var components = usefulComponents();
      var amounts = allocate(components, count);
      var zones = [];

      components.forEach(function (c, i) {
        if (!amounts[i]) return;

        var result = splitComponent(c, Math.min(amounts[i], c.nodes.length));

        result.zones.forEach(function (tiles, j) {
          zones.push({
            tiles: tiles,
            center: result.centers[j],
          });
        });
      });

      applyZones(type, zones);
      return;
    }

    var sources = S.hotspots.map(function (h) {
      return h.node;
    });

    if (!sources.length) {
      sources = S.normalNodes;
    }

    if (!sources.length) {
      setStatus("Nenhum caminho encontrado.");
      return;
    }

    var chosen = chooseSeeds(sources, Math.min(count, sources.length));

    var zonesOther = [];

    for (var j = 0; j < count; j++) {
      var seed = chosen[j % chosen.length];

      zonesOther.push({
        tiles: flood(
          seed,
          type === "security" ? CFG.securityDepth : CFG.entertainerDepth,
        ),
        center: seed,
      });
    }

    applyZones(type, zonesOther);
  }

  function clearPatrols(type) {
    if (S.busy) return;

    var workers = getStaff(type);
    var left = workers.length;
    var errors = 0;

    if (!left) {
      setStatus("Nenhum funcionario.");
      return;
    }

    S.busy = true;

    workers.forEach(function (p) {
      context.executeAction(
        "staffsetpatrolarea",
        {
          id: p.id,
          x1: 0,
          y1: 0,
          x2: 0,
          y2: 0,
          mode: 2,
        },
        function (result) {
          if (getError(result)) errors++;

          left--;

          if (!left) {
            S.busy = false;
            S.zones[type] = [];

            setStatus("Rondas removidas. Erros: " + errors);
          }
        },
      );
    });
  }

  function hire(type) {
    if (S.hiring) return;

    S.hiring = true;

    var meta = TYPES[type];
    var costume = 0;

    function attempt() {
      var args = {
        autoPosition: true,
        staffType: meta.api,
        costumeIndex: costume,
        staffOrders: meta.orders,
      };

      context.queryAction("staffhire", args, function (result) {
        if (getError(result)) {
          if (type === "entertainer" && costume < 15) {
            costume++;
            attempt();
            return;
          }

          S.hiring = false;

          setStatus("Falha: " + getError(result));
          return;
        }

        context.executeAction("staffhire", args, function (r) {
          S.hiring = false;

          setStatus(getError(r) || "Contratacao executada.");

          dimension();
        });
      });
    }

    setStatus("Contratando " + meta.title + "...");
    attempt();
  }

  // ============================================================
  // PRODUTIVIDADE
  // ============================================================

  function counters(p) {
    if (p.staffType === "mechanic") {
      return {
        a: num(p.ridesInspected),
        b: num(p.ridesFixed),
      };
    }

    return {
      a: num(p.litterSwept),
      b: num(p.binsEmptied),
    };
  }

  function sample() {
    var point = {
      tick: ticks(),
      members: {},
    };

    getEntities("staff").forEach(function (p) {
      if (p.staffType !== "mechanic" && p.staffType !== "handyman") {
        return;
      }

      var c = counters(p);

      var m = {
        type: p.staffType,
        x: num(p.x),
        y: num(p.y),
        a: c.a,
        b: c.b,
        distance: 0,
        elapsed: 0,
      };

      var prev = S.previous && S.previous.members[p.id];

      if (prev && S.previous.tick < point.tick) {
        var dt = point.tick - S.previous.tick;

        var dist = (Math.abs(m.x - prev.x) + Math.abs(m.y - prev.y)) / 32;

        // Descarta grandes reposicionamentos.
        if (dt <= CFG.sampleTicks * 3 && dist <= dt / 12) {
          m.distance = dist;
          m.elapsed = dt;
        }
      }

      point.members[p.id] = m;
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
        var m = point.members[id];

        if (m.type !== type) return;

        if (!first[id]) first[id] = m;

        last[id] = m;

        totalDistance += m.distance;
        elapsed += m.elapsed;
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

      speed: elapsed > 0 ? totalDistance / (elapsed / CFG.ticksPerMinute) : 0,
    };
  }

  // ============================================================
  // DIMENSIONAMENTO 1.9.2
  // ============================================================

  function dimension() {
    var mechanics = getStaff("mechanic").length;
    var handymen = getStaff("handyman").length;

    var mr = observation("mechanic");
    var hr = observation("handyman");

    var guests = guestCount();
    var litter = getEntities("litter").length;

    var activeRides = getRides().filter(function (r) {
      return r.status === "open" || r.status === "testing";
    });

    // MECANICOS - nao altera suas rondas.
    var inspections = 0;
    var repairs = 0;

    activeRides.forEach(function (r) {
      var index = Math.floor(num(r.inspectionInterval, 6));

      var period = CFG.inspectionPeriods[index] || 0;

      if (period > 0) {
        inspections += 60 / period;
      }

      var reliability = clamp(num(r.reliability, 100), 0, 100);

      repairs +=
        0.08 +
        0.007 * (100 - reliability) +
        0.002 * clamp(num(r.downtime), 0, 100);
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

    var mechanicNeed = activeRides.length
      ? Math.max(1, Math.ceil(mechanicWork / (60 * CFG.mechanicUtilization)))
      : 0;

    // ZELADORES - demanda de servicos.
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

    // NOVO: cobertura de caminhos relevantes.
    var accessibleTiles = S.analyzed ? S.usefulTiles : 0;

    var byCoverage =
      accessibleTiles > 0
        ? Math.ceil(accessibleTiles / CFG.handymanTilesPerWorker)
        : 0;

    var byGuests = Math.ceil(guests / CFG.handymanGuestsPerWorker);

    var byLitter = Math.ceil(litter / CFG.handymanLitterPerWorker);

    /*
     * Nunca usar o numero de redes como
     * numero minimo de zeladores.
     */
    var handNeed = Math.max(byWork, byCoverage, byGuests, byLitter);

    if (guests > 0 || litter > 0) {
      handNeed = Math.max(1, handNeed);
    }

    var observedMinutes = Math.max(mr.minutes, hr.minutes);

    S.dimension = {
      mechanicCount: mechanics,
      mechanicNeed: mechanicNeed,
      mechanicWork: mechanicWork,
      inspections: inspections,
      repairs: repairs,
      mechanicSpeed: mr.speed,

      handymanCount: handymen,
      handymanNeed: handNeed,
      handymanWork: handWork,
      cleaning: cleaning,
      bins: bins,
      handymanSpeed: hr.speed,

      byWork: byWork,
      byCoverage: byCoverage,
      byGuests: byGuests,
      byLitter: byLitter,

      accessibleTiles: accessibleTiles,
      totalTiles: S.totalTiles,

      guests: guests,
      litter: litter,

      minutes: observedMinutes,

      confidence:
        observedMinutes >= 20
          ? "MEDIA"
          : observedMinutes >= 5
            ? "BAIXA"
            : "INICIAL",
    };

    render();
  }

  // ============================================================
  // VANDALISMO OPCIONAL
  // ============================================================

  function repairTick() {
    if (!getSetting("StaffZoneManager.repairEnabled", false)) {
      return;
    }

    if (typeof network !== "undefined" && network.mode === "client") {
      return;
    }

    getEntities("staff").forEach(function (p) {
      if (
        p.staffType !== "handyman" ||
        !getSetting("StaffZoneManager.repairhandyman", true)
      ) {
        return;
      }

      var x = tile(p.x);
      var y = tile(p.y);

      if (x < 0 || y < 0 || x >= map.size.x || y >= map.size.y) {
        return;
      }

      var cell = map.getTile(x, y);

      if (!cell) return;

      for (var i = 0; i < cell.numElements; i++) {
        var e = cell.getElement(i);

        if (
          !e ||
          e.type !== "footpath" ||
          !e.isAdditionBroken ||
          e.addition == null
        ) {
          continue;
        }

        if (num(e.baseZ) !== num(p.z)) continue;

        if (park.getFlag("noMoney")) {
          e.isAdditionBroken = false;
          break;
        }

        var object;

        try {
          object = context.getObject("footpath_addition", e.addition);
        } catch (err) {
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
            z: num(e.baseZ),
            object: object.index,
          },
          function (result) {
            if (getError(result)) {
              console.log("Reparo: " + getError(result));
            }
          },
        );

        break;
      }
    });
  }

  // ============================================================
  // INTERFACE
  // ============================================================

  function getWidget(name) {
    try {
      return S.window && S.window.findWidget(name);
    } catch (e) {
      return null;
    }
  }

  function text(name, value) {
    var widget = getWidget(name);

    if (widget) {
      widget.text = String(value);
    }
  }

  function visible(name, value) {
    var widget = getWidget(name);

    if (widget) {
      widget.isVisible = value;
    }
  }

  function verdict(current, expected) {
    if (current < expected) {
      return "FALTAM " + (expected - current);
    }

    if (current > expected) {
      return "EXCEDENTE " + (current - expected);
    }

    return "ADEQUADO";
  }

  function render() {
    if (!S.window) return;

    TAB_NAMES.forEach(function (tab, i) {
      var selected = S.tab === i;

      var tabButton = getWidget("tab" + i);

      if (tabButton) {
        tabButton.isPressed = selected;
      }

      TAB_WIDGETS[tab].forEach(function (name) {
        visible(name, selected);
      });
    });

    text("status", S.status);

    text(
      "general1",
      "Caminhos: " +
        S.totalTiles +
        "  |  Filas: " +
        S.queueTiles +
        "  |  Saidas: " +
        collectExits().length,
    );

    text(
      "general2",
      "Caminhos relevantes: " +
        S.usefulTiles +
        "  |  Redes: " +
        S.components.length +
        "  |  Conectividade: " +
        S.networkMode,
    );

    Object.keys(TYPES).forEach(function (type) {
      text(
        type + "_count",
        "Contratados: " +
          getStaff(type).length +
          "  |  Rondas aplicadas: " +
          S.zones[type].length,
      );
    });

    if (!S.dimension) return;

    var d = S.dimension;

    text(
      "dim_observation",
      "Historico: " +
        format(d.minutes) +
        " min simulados  |  Confianca: " +
        d.confidence,
    );

    text(
      "dim_mech1",
      d.mechanicCount +
        " contratados / " +
        d.mechanicNeed +
        " recomendados  |  " +
        verdict(d.mechanicCount, d.mechanicNeed),
    );

    text(
      "dim_mech2",
      "Inspecoes: " +
        format(d.inspections) +
        "/h  |  Reparos: " +
        format(d.repairs) +
        "/h",
    );

    text(
      "dim_mech3",
      "Trabalho: " +
        format(d.mechanicWork) +
        " min/h  |  Velocidade: " +
        format(d.mechanicSpeed) +
        " tiles/min",
    );

    text(
      "dim_hand1",
      d.handymanCount +
        " contratados / " +
        d.handymanNeed +
        " recomendados  |  " +
        verdict(d.handymanCount, d.handymanNeed),
    );

    text(
      "dim_hand2",
      "Por caminhos: " +
        d.byCoverage +
        "  |  Por visitantes: " +
        d.byGuests +
        "  |  Por sujeira: " +
        d.byLitter,
    );

    text(
      "dim_hand3",
      "Por carga de trabalho: " +
        d.byWork +
        "  |  Trabalho: " +
        format(d.handymanWork) +
        " min/h",
    );

    text(
      "dim_hand4",
      "Caminhos relevantes: " +
        d.accessibleTiles +
        "  |  Visitantes: " +
        d.guests +
        "  |  Lixo: " +
        d.litter,
    );

    text(
      "dim_hand5",
      "Velocidade observada: " +
        format(d.handymanSpeed) +
        " tiles/min  |  Meta: 80%",
    );

    text(
      "dim_note",
      "85 tiles/zelador e 170 visitantes/zelador: " +
        "parametros experimentais.",
    );

    text(
      "handyman_coverage",
      "Cobertura: " +
        S.usefulTiles +
        " tiles relevantes  |  Meta: " +
        CFG.handymanTilesPerWorker +
        " tiles/zelador",
    );
  }

  function add(widgets, tab, widget) {
    widget.isVisible = false;
    widgets.push(widget);
    TAB_WIDGETS[tab].push(widget.name);
  }

  function label(widgets, tab, name, content, x, y, width) {
    add(widgets, tab, {
      type: "label",
      name: name,
      x: x,
      y: y,
      width: width || 620,
      height: 19,
      text: content || "",
    });
  }

  function button(widgets, tab, name, content, x, y, width, callback) {
    add(widgets, tab, {
      type: "button",
      name: name,
      x: x,
      y: y,
      width: width,
      height: 24,
      text: content,
      onClick: callback,
    });
  }

  function openWindow() {
    if (typeof ui === "undefined") return;

    var old = ui.getWindow(WINDOW);

    if (old) {
      old.bringToFront();
      return;
    }

    Object.keys(TAB_WIDGETS).forEach(function (name) {
      TAB_WIDGETS[name] = [];
    });

    var widgets = [];

    /*
     * Icones aprovados: Geral, Mecanicos, Dimensionar.
     * Outros: letras Z, S, A para evitar sprites errados.
     */
    var icons = ["park", "mechanic", null, null, null, "graph"];

    var initials = ["", "", "Z", "S", "A", ""];

    for (var i = 0; i < TAB_NAMES.length; i++) {
      (function (index) {
        var x = 10 + index * 110;

        var iconButton = {
          type: "button",
          name: "icon" + index,
          x: x,
          y: 22,
          width: 23,
          height: 23,
          tooltip: TAB_LABELS[index],
          onClick: function () {
            S.tab = index;
            render();
          },
        };

        if (icons[index]) {
          iconButton.image = icons[index];
        } else {
          iconButton.text = initials[index];
        }

        widgets.push(iconButton);

        widgets.push({
          type: "button",
          name: "tab" + index,
          x: x + 25,
          y: 22,
          width: 81,
          height: 23,
          text: TAB_LABELS[index],
          onClick: function () {
            S.tab = index;
            render();
          },
        });
      })(i);
    }

    TAB_NAMES.forEach(function (tab, index) {
      add(widgets, tab, {
        type: "groupbox",
        name: "group_" + tab,
        x: 10,
        y: 55,
        width: 656,
        height: 340,
        text: TAB_LABELS[index],
      });
    });

    // VISAO GERAL

    label(widgets, "general", "general1", "", 25, 87);
    label(widgets, "general", "general2", "", 25, 115);

    button(
      widgets,
      "general",
      "analyze",
      "Analisar parque",
      25,
      160,
      160,
      analyze,
    );

    add(widgets, "general", {
      type: "checkbox",
      name: "repair_enabled",
      x: 25,
      y: 214,
      width: 350,
      height: 18,
      text: "Ativar reparo de vandalismo",
      isChecked: !!getSetting("StaffZoneManager.repairEnabled", false),
      onChange: function (value) {
        setSetting("StaffZoneManager.repairEnabled", !!value);
      },
    });

    add(widgets, "general", {
      type: "checkbox",
      name: "repair_handyman",
      x: 25,
      y: 240,
      width: 350,
      height: 18,
      text: "Zeladores reparam vandalismo",
      isChecked: !!getSetting("StaffZoneManager.repairhandyman", true),
      onChange: function (value) {
        setSetting("StaffZoneManager.repairhandyman", !!value);
      },
    });

    label(
      widgets,
      "general",
      "general_info",
      "As contratacoes e rondas sao manuais.",
      25,
      295,
    );

    // ABAS DE FUNCIONARIOS

    ["mechanic", "handyman", "security", "entertainer"].forEach(
      function (type) {
        label(widgets, type, type + "_count", "", 25, 94);

        button(
          widgets,
          type,
          type + "_hire",
          "Contratar +1",
          25,
          144,
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
          144,
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
          144,
          140,
          function () {
            clearPatrols(type);
          },
        );

        var info =
          type === "mechanic"
            ? "Rondas pelas saidas das atracoes."
            : type === "handyman"
              ? "Rondas por caminhos e filas."
              : "Rondas nas areas movimentadas.";

        label(widgets, type, type + "_info", info, 25, 207);

        label(
          widgets,
          type,
          type + "_help",
          "Consulte Dimensionar para a equipe recomendada.",
          25,
          246,
        );
      },
    );

    label(widgets, "handyman", "handyman_coverage", "", 25, 280);

    // DIMENSIONAMENTO

    label(widgets, "dimension", "dim_observation", "", 25, 80);

    add(widgets, "dimension", {
      type: "button",
      name: "dim_mechanic_icon",
      x: 25,
      y: 108,
      width: 23,
      height: 23,
      image: "mechanic",
      tooltip: "Mecanicos",
      onClick: function () {
        S.tab = 1;
        render();
      },
    });

    label(widgets, "dimension", "dim_mechanic_title", "MECANICOS", 55, 112);

    label(widgets, "dimension", "dim_mech1", "", 25, 140);

    label(widgets, "dimension", "dim_mech2", "", 25, 163);

    label(widgets, "dimension", "dim_mech3", "", 25, 186);

    add(widgets, "dimension", {
      type: "button",
      name: "dim_handyman_icon",
      x: 25,
      y: 224,
      width: 23,
      height: 23,
      text: "Z",
      tooltip: "Zeladores",
      onClick: function () {
        S.tab = 2;
        render();
      },
    });

    label(widgets, "dimension", "dim_handyman_title", "ZELADORES", 55, 228);

    label(widgets, "dimension", "dim_hand1", "", 25, 254);

    label(widgets, "dimension", "dim_hand2", "", 25, 277);

    label(widgets, "dimension", "dim_hand3", "", 25, 300);

    label(widgets, "dimension", "dim_hand4", "", 25, 323);

    label(widgets, "dimension", "dim_hand5", "", 25, 346);

    label(widgets, "dimension", "dim_note", "", 25, 380);

    button(
      widgets,
      "dimension",
      "recalculate",
      "Recalcular",
      510,
      375,
      135,
      dimension,
    );

    // STATUS PERMANENTE

    widgets.push({
      type: "label",
      name: "status",
      x: 12,
      y: 427,
      width: 650,
      height: 35,
      text: S.status,
    });

    S.window = ui.openWindow({
      classification: WINDOW,
      title: "Staff Zone Manager " + VERSION,
      width: 676,
      height: 468,
      colours: [24, 24],
      widgets: widgets,
      onClose: function () {
        S.window = null;
      },
    });

    S.tab = 0;

    render();
    dimension();
  }

  // ============================================================
  // CICLO DE VIDA
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

    setStatus("Mapa alterado. Clique em Analisar parque.");
  }

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
