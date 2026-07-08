const CARD_WIDTH = 420;
const GAP = 40;
const PAIR_GAP = 60;
const FILES_BY_ID = typeof GROUPS !== 'undefined' ? buildFileLookup() : new Map();
const LAYOUT_SETTINGS = Object.freeze({
  nodesep: 120,
  ranksep: 120,
  edgesep: 120,
  zoneGap: 120
});

function buildFileLookup() {
  const files = [
    ...GROUPS.paired.flatMap(([source, spec]) => [source, spec]),
    ...GROUPS.unpaired_sources,
    ...GROUPS.unpaired_specs
  ];

  return new Map(files.map(file => [file.id, file]));
}

function fileMeta(id) {
  return FILES_BY_ID.get(id) || { id: id, type: 'other', dir: 'other' };
}

// Drag & drop
let dragCard = null, dragOffsetX = 0, dragOffsetY = 0, topZ = 10;

if (typeof document !== 'undefined') {
document.querySelectorAll('.card').forEach(card => {
  card.addEventListener('mousedown', (e) => {
    topZ++;
    card.style.zIndex = topZ;
    if (['SUMMARY','BUTTON','TEXTAREA','INPUT'].includes(e.target.tagName) || e.target.isContentEditable) return;
    // Don't start drag if clicking the resize handle (bottom-right 18x18 area)
    const rect = card.getBoundingClientRect();
    if (e.clientX > rect.right - 18 && e.clientY > rect.bottom - 18) return;
    dragCard = card;
    dragCard.classList.add('dragging');
    focusCard(card.id.replace('card-', ''));
    const cardLeft = parseFloat(card.style.left) || 0;
    const cardTop = parseFloat(card.style.top) || 0;
    const canvas = document.getElementById('canvas');
    const canvasRect = canvas.getBoundingClientRect();
    dragOffsetX = (e.clientX - canvasRect.left + canvas.scrollLeft) / currentZoom - cardLeft;
    dragOffsetY = (e.clientY - canvasRect.top + canvas.scrollTop) / currentZoom - cardTop;
  });
});

document.querySelectorAll('.card').forEach(card => {
  const fileId = card.id.replace('card-', '');
  card.addEventListener('mouseenter', () => focusCard(fileId));
  card.addEventListener('mouseleave', () => unfocusCards());
});

let dragRAF = null;

document.addEventListener('mousemove', (e) => {
  if (!dragCard) return;
  const canvas = document.getElementById('canvas');
  const canvasRect = canvas.getBoundingClientRect();
  dragCard.style.left = ((e.clientX - canvasRect.left + canvas.scrollLeft) / currentZoom - dragOffsetX) + 'px';
  dragCard.style.top = ((e.clientY - canvasRect.top + canvas.scrollTop) / currentZoom - dragOffsetY) + 'px';
  if (!dragRAF) {
    dragRAF = requestAnimationFrame(() => {
      drawConnectionsForDrag(dragCard ? dragCard.id.replace('card-', '') : '');
      focusCard(dragCard ? dragCard.id.replace('card-', '') : '');
      dragRAF = null;
    });
  }
});

document.addEventListener('mouseup', () => {
  if (dragCard) {
    dragCard.classList.remove('dragging');
    unfocusCards();
    topZ++;
    dragCard.style.zIndex = topZ;
    dragCard = null;
    // Defer full reroute so the drop feels instant
    setTimeout(() => { drawConnections(); saveState(); }, 10);
  }
});
} // end if (typeof document !== 'undefined')

// === Edge Router ===
// Grid-based A* orthogonal router.
// - Minimum gap from card edges (padding)
// - Turn penalty to prefer straight runs
// - Incremental soft-cost so parallel paths get lane spacing
// - Label deconfliction

const ROUTER = {
  cellSize: 10,
  cardPadding: 14,
  turnPenalty: 3,
  usedCellCost: 5,
  margin: 60
};

let connectionsVisible = true;

function toggleConnections() {
  connectionsVisible = !connectionsVisible;
  drawConnections();
}

function connMarker(type) {
  const known = ['test', 'calls', 'renders', 'passes_prop', 'styles'];
  if (known.includes(type)) return 'url(#arrowhead-' + type + ')';
  return 'url(#arrowhead)';
}

function connColor(type) {
  switch (type) {
    case 'test':       return 'var(--conn-test)';
    case 'calls':      return 'var(--conn-calls)';
    case 'renders':    return 'var(--conn-renders)';
    case 'passes_prop': return 'var(--conn-passes-prop)';
    case 'styles':     return 'var(--conn-styles)';
    default:           return 'var(--connection-color)';
  }
}

function focusCard(fileId) {
  const svg = document.getElementById('connections');
  svg.classList.add('has-focus');
  svg.querySelectorAll('path, text, rect').forEach(el => {
    if (el.dataset.from === fileId || el.dataset.to === fileId) {
      el.classList.add('focused');
    }
  });
}

function unfocusCards() {
  const svg = document.getElementById('connections');
  svg.classList.remove('has-focus');
  svg.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
}

// --- Grid construction ---

function getCardRects() {
  const rects = [];
  document.querySelectorAll('.card').forEach(el => {
    if (el.style.display === 'none') return;
    rects.push({
      id: el.id.replace('card-', ''),
      x: parseFloat(el.style.left) || 0,
      y: parseFloat(el.style.top) || 0,
      w: el.offsetWidth,
      h: el.offsetHeight
    });
  });
  return rects;
}

function buildGrid(cardRects, cellSize) {
  const cs = cellSize || ROUTER.cellSize;
  const pad = ROUTER.cardPadding;
  const margin = ROUTER.margin;

  // Compute bounds from all cards
  let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
  cardRects.forEach(r => {
    minX = Math.min(minX, r.x - pad - margin);
    minY = Math.min(minY, r.y - pad - margin);
    maxX = Math.max(maxX, r.x + r.w + pad + margin);
    maxY = Math.max(maxY, r.y + r.h + pad + margin);
  });
  minX = Math.floor(minX / cs) * cs;
  minY = Math.floor(minY / cs) * cs;

  const cols = Math.ceil((maxX - minX) / cs);
  const rows = Math.ceil((maxY - minY) / cs);

  // cost array: 0 = free, -1 = blocked, >0 = soft cost
  const cells = new Uint16Array(rows * cols);

  // Mark card interiors + padding as blocked
  cardRects.forEach(r => {
    const left = Math.floor((r.x - pad - minX) / cs);
    const top = Math.floor((r.y - pad - minY) / cs);
    const right = Math.ceil((r.x + r.w + pad - minX) / cs);
    const bottom = Math.ceil((r.y + r.h + pad - minY) / cs);
    for (let row = Math.max(0, top); row < Math.min(rows, bottom); row++) {
      for (let col = Math.max(0, left); col < Math.min(cols, right); col++) {
        cells[row * cols + col] = 65535; // blocked
      }
    }
  });

  return { cells, rows, cols, minX, minY, cs };
}

function worldToGrid(grid, x, y) {
  return {
    col: Math.round((x - grid.minX) / grid.cs),
    row: Math.round((y - grid.minY) / grid.cs)
  };
}

function gridToWorld(grid, col, row) {
  return {
    x: grid.minX + col * grid.cs,
    y: grid.minY + row * grid.cs
  };
}

// --- A* pathfinder ---

function astar(grid, startCol, startRow, endCol, endRow, maxIter) {
  const { cells, rows, cols } = grid;
  if (startCol === endCol && startRow === endRow) return [{ col: startCol, row: startRow }];

  // Clamp to grid bounds
  startCol = Math.max(0, Math.min(cols - 1, startCol));
  startRow = Math.max(0, Math.min(rows - 1, startRow));
  endCol = Math.max(0, Math.min(cols - 1, endCol));
  endRow = Math.max(0, Math.min(rows - 1, endRow));

  const key = (col, row) => row * cols + col;
  const heuristic = (c, r) => Math.abs(c - endCol) + Math.abs(r - endRow);

  // 0-3: orthogonal, 4-7: diagonal
  const DIRS = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]];
  const DIR_COST = [1, 1, 1, 1, 1.4, 1.4, 1.4, 1.4];
  const startKey = key(startCol, startRow);
  const endKey = key(endCol, endRow);

  const gScore = new Map();
  const cameFrom = new Map();
  const dirFrom = new Map(); // direction used to reach this cell
  gScore.set(startKey, 0);

  // Binary heap priority queue (simple array-based)
  const open = [{ col: startCol, row: startRow, f: heuristic(startCol, startRow) }];
  const inOpen = new Set([startKey]);
  const closed = new Set();
  const maxIterations = maxIter || Infinity;
  let iterations = 0;

  while (open.length > 0) {
    if (++iterations > maxIterations) return null; // bail out, use straight line
    // Find lowest f (linear scan is fine for our grid sizes)
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open[bestIdx];
    open[bestIdx] = open[open.length - 1];
    open.pop();

    const ck = key(current.col, current.row);
    if (ck === endKey) {
      // Reconstruct path
      const path = [];
      let k = endKey;
      while (k !== undefined) {
        const r = Math.floor(k / cols);
        const c = k % cols;
        path.push({ col: c, row: r });
        k = cameFrom.get(k);
      }
      path.reverse();
      return path;
    }

    inOpen.delete(ck);
    closed.add(ck);
    const currentG = gScore.get(ck);
    const currentDir = dirFrom.get(ck);

    for (let d = 0; d < 8; d++) {
      const nc = current.col + DIRS[d][0];
      const nr = current.row + DIRS[d][1];
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;

      const nk = key(nc, nr);
      if (closed.has(nk)) continue;

      const cellCost = cells[nk];
      if (cellCost === 65535 && nk !== endKey) continue; // blocked (allow end cell)

      let moveCost = DIR_COST[d] + (cellCost < 65535 ? cellCost : 0);
      if (currentDir !== undefined && currentDir !== d) {
        moveCost += ROUTER.turnPenalty;
      }

      const tentativeG = currentG + moveCost;
      if (tentativeG < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, tentativeG);
        cameFrom.set(nk, ck);
        dirFrom.set(nk, d);
        const f = tentativeG + heuristic(nc, nr);
        if (!inOpen.has(nk)) {
          open.push({ col: nc, row: nr, f });
          inOpen.add(nk);
        } else {
          // Update f score in open list
          for (let i = 0; i < open.length; i++) {
            if (key(open[i].col, open[i].row) === nk) { open[i].f = f; break; }
          }
        }
      }
    }
  }

  // No path found — fall back to straight line
  return null;
}

// --- Path simplification ---

function simplifyPath(path) {
  if (!path || path.length <= 2) return path;
  const result = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = path[i];
    const next = path[i + 1];
    // Keep point if not collinear (cross product != 0)
    const dx1 = curr.col - prev.col;
    const dy1 = curr.row - prev.row;
    const dx2 = next.col - prev.col;
    const dy2 = next.row - prev.row;
    if (dx1 * dy2 - dy1 * dx2 !== 0) result.push(curr);
  }
  result.push(path[path.length - 1]);
  return result;
}

// --- Exit/entry point selection ---

function pickExitSide(sourceRect, targetRect) {
  const scx = sourceRect.x + sourceRect.w / 2;
  const scy = sourceRect.y + sourceRect.h / 2;
  const tcx = targetRect.x + targetRect.w / 2;
  const tcy = targetRect.y + targetRect.h / 2;
  const dx = tcx - scx;
  const dy = tcy - scy;

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left';
  }
  return dy > 0 ? 'bottom' : 'top';
}

function sideAnchor(rect, side, padding, offset) {
  // offset is 0..1 along the side (0.5 = center)
  switch (side) {
    case 'top':    return { x: rect.x + rect.w * offset, y: rect.y - padding };
    case 'bottom': return { x: rect.x + rect.w * offset, y: rect.y + rect.h + padding };
    case 'left':   return { x: rect.x - padding,         y: rect.y + rect.h * offset };
    case 'right':  return { x: rect.x + rect.w + padding, y: rect.y + rect.h * offset };
  }
}

function cardEdgePoint(rect, side, offset) {
  switch (side) {
    case 'top':    return { x: rect.x + rect.w * offset, y: rect.y };
    case 'bottom': return { x: rect.x + rect.w * offset, y: rect.y + rect.h };
    case 'left':   return { x: rect.x,              y: rect.y + rect.h * offset };
    case 'right':  return { x: rect.x + rect.w,     y: rect.y + rect.h * offset };
  }
}

// --- Route a single edge ---

function routeEdge(fromRect, toRect, grid, exitSide, entrySide, exitOffset, entryOffset, maxIter) {
  const pad = ROUTER.cardPadding;

  const startWorld = sideAnchor(fromRect, exitSide, pad + 2, exitOffset);
  const endWorld = sideAnchor(toRect, entrySide, pad + 2, entryOffset);

  const startEdge = cardEdgePoint(fromRect, exitSide, exitOffset);
  const endEdge = cardEdgePoint(toRect, entrySide, entryOffset);

  // Temporarily unblock cells near the start/end anchors
  const startCell = worldToGrid(grid, startWorld.x, startWorld.y);
  const endCell = worldToGrid(grid, endWorld.x, endWorld.y);

  const savedCells = unblockNearPoint(grid, startCell.col, startCell.row);
  const savedCells2 = unblockNearPoint(grid, endCell.col, endCell.row);

  const rawPath = astar(grid, startCell.col, startCell.row, endCell.col, endCell.row, maxIter);

  // Restore blocked cells
  restoreCells(grid, savedCells);
  restoreCells(grid, savedCells2);

  if (!rawPath) {
    // Fallback: straight line
    return { points: [startEdge, endEdge], exitSide, entrySide };
  }

  const simplified = simplifyPath(rawPath);
  const worldPoints = simplified.map(p => gridToWorld(grid, p.col, p.row));

  // Prepend card edge, append card edge
  const points = [startEdge, ...worldPoints, endEdge];

  // Mark used cells with soft cost for lane spacing
  rawPath.forEach(p => {
    const idx = p.row * grid.cols + p.col;
    if (grid.cells[idx] < 65535) {
      grid.cells[idx] = Math.min(grid.cells[idx] + ROUTER.usedCellCost, 65534);
    }
  });

  return { points, exitSide, entrySide };
}

function unblockNearPoint(grid, col, row) {
  // Unblock a small 3x3 area around the anchor point
  const saved = [];
  const radius = 1;
  for (let r = row - radius; r <= row + radius; r++) {
    for (let c = col - radius; c <= col + radius; c++) {
      if (r < 0 || r >= grid.rows || c < 0 || c >= grid.cols) continue;
      const idx = r * grid.cols + c;
      if (grid.cells[idx] === 65535) {
        saved.push({ idx, val: 65535 });
        grid.cells[idx] = 0;
      }
    }
  }
  return saved;
}

function restoreCells(grid, saved) {
  saved.forEach(s => { grid.cells[s.idx] = s.val; });
}

// --- Label placement ---

function placeLabelOnPath(points) {
  // Place label at the midpoint of total path length (center of the route)
  let totalLen = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    totalLen += Math.sqrt(dx * dx + dy * dy);
  }

  const targetDist = totalLen / 2;
  let walked = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (walked + segLen >= targetDist) {
      const t = (targetDist - walked) / segLen;
      return {
        x: points[i].x + dx * t,
        y: points[i].y + dy * t - 8
      };
    }
    walked += segLen;
  }
  // Fallback
  const mid = Math.floor(points.length / 2);
  return { x: points[mid].x, y: points[mid].y - 8 };
}

function deconflictLabels(labels) {
  // Simple greedy nudge: if two labels overlap, push them apart vertically
  const gap = 18;
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const dx = Math.abs(labels[i].x - labels[j].x);
      const dy = Math.abs(labels[i].y - labels[j].y);
      if (dx < 70 && dy < gap) {
        labels[j].y += gap - dy;
      }
    }
  }
}

// --- Main draw function ---

// Cached route data for partial updates during drag
let cachedRoutes = [];
let cachedLabels = [];

function drawConnections() {
  const result = computeAllRoutes(ROUTER.cellSize);
  cachedRoutes = result.routes;
  cachedLabels = result.labels;
  renderRoutes(cachedRoutes, cachedLabels);
}

function drawConnectionsForDrag(draggedId) {
  const cardRects = getCardRects();
  const rectMap = new Map(cardRects.map(r => [r.id, r]));
  const grid = buildGrid(cardRects, ROUTER.cellSize * 3);

  // Only reroute edges touching the dragged card
  const updatedRoutes = cachedRoutes.map(route => {
    if (route.from !== draggedId && route.to !== draggedId) return route;

    const fromRect = rectMap.get(route.from);
    const toRect = rectMap.get(route.to);
    if (!fromRect || !toRect) return route;

    const exitSide = pickExitSide(fromRect, toRect);
    const entrySide = pickExitSide(toRect, fromRect);
    const result = routeEdge(fromRect, toRect, grid, exitSide, entrySide, route.exitOffset, route.entryOffset, 2000);
    return { ...route, points: result.points };
  });

  // Recompute labels only for affected edges
  const updatedLabels = updatedRoutes
    .filter(r => r.label)
    .map(r => ({ ...placeLabelOnPath(r.points), text: r.label, from: r.from, to: r.to }));

  renderRoutes(updatedRoutes, updatedLabels);
}

function computeAllRoutes(cellSize) {
  const cardRects = getCardRects();
  const rectMap = new Map(cardRects.map(r => [r.id, r]));

  // Pre-compute sides and assign spread offsets
  const edgeInfos = [];
  const portCounts = new Map();

  CONNECTIONS.forEach(conn => {
    const fromRect = rectMap.get(conn.from);
    const toRect = rectMap.get(conn.to);
    if (!fromRect || !toRect) return;

    const exitSide = pickExitSide(fromRect, toRect);
    const entrySide = pickExitSide(toRect, fromRect);

    const exitKey = conn.from + ':' + exitSide;
    const entryKey = conn.to + ':' + entrySide;
    portCounts.set(exitKey, (portCounts.get(exitKey) || 0) + 1);
    portCounts.set(entryKey, (portCounts.get(entryKey) || 0) + 1);

    edgeInfos.push({ conn, fromRect, toRect, exitSide, entrySide, exitKey, entryKey });
  });

  // Assign slot indices per port, sorted by opposite endpoint position
  const portGroups = new Map();
  edgeInfos.forEach((info, idx) => {
    if (!portGroups.has(info.exitKey)) portGroups.set(info.exitKey, []);
    portGroups.get(info.exitKey).push({ idx, role: 'exit' });
    if (!portGroups.has(info.entryKey)) portGroups.set(info.entryKey, []);
    portGroups.get(info.entryKey).push({ idx, role: 'entry' });
  });

  portGroups.forEach((members, portKey) => {
    const side = portKey.split(':')[1];
    const isHorizontal = (side === 'top' || side === 'bottom');

    members.sort((a, b) => {
      const infoA = edgeInfos[a.idx];
      const infoB = edgeInfos[b.idx];
      const rectA = a.role === 'exit' ? infoA.toRect : infoA.fromRect;
      const rectB = b.role === 'exit' ? infoB.toRect : infoB.fromRect;
      if (isHorizontal) {
        return (rectA.x + rectA.w / 2) - (rectB.x + rectB.w / 2);
      }
      return (rectA.y + rectA.h / 2) - (rectB.y + rectB.h / 2);
    });

    members.forEach((member, slot) => {
      if (member.role === 'exit') {
        edgeInfos[member.idx].exitSlot = slot;
      } else {
        edgeInfos[member.idx].entrySlot = slot;
      }
    });
  });

  const grid = buildGrid(cardRects, cellSize);
  const routes = [];
  const labels = [];

  edgeInfos.forEach(info => {
    const { conn, fromRect, toRect, exitSide, entrySide, exitKey, entryKey } = info;
    const exitTotal = portCounts.get(exitKey);
    const entryTotal = portCounts.get(entryKey);
    const exitOffset = spreadOffset(info.exitSlot, exitTotal);
    const entryOffset = spreadOffset(info.entrySlot, entryTotal);

    const route = routeEdge(fromRect, toRect, grid, exitSide, entrySide, exitOffset, entryOffset);

    routes.push({
      from: conn.from,
      to: conn.to,
      type: conn.type,
      label: conn.label,
      points: route.points,
      exitOffset,
      entryOffset
    });

    if (conn.label) {
      labels.push({ ...placeLabelOnPath(route.points), text: conn.label, from: conn.from, to: conn.to });
    }
  });

  return { routes, labels };
}

function renderRoutes(routes, labels) {
  const svg = document.getElementById('connections');
  const defs = svg.querySelector('defs');
  svg.innerHTML = '';
  if (defs) svg.appendChild(defs);
  if (!connectionsVisible) return;

  routes.forEach(route => {
    const pathData = route.points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ',' + p.y).join(' ');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', connColor(route.type));
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('marker-end', connMarker(route.type));
    path.dataset.from = route.from;
    path.dataset.to = route.to;
    svg.appendChild(path);
  });

  deconflictLabels(labels);
  labels.forEach(lbl => {
    const textW = lbl.text.length * 6 + 8;
    const textH = 16;
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', lbl.x - textW / 2);
    bg.setAttribute('y', lbl.y - textH + 2);
    bg.setAttribute('width', textW);
    bg.setAttribute('height', textH);
    bg.setAttribute('class', 'conn-label-bg');
    bg.dataset.from = lbl.from;
    bg.dataset.to = lbl.to;
    svg.appendChild(bg);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', lbl.x);
    text.setAttribute('y', lbl.y);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'conn-label');
    text.dataset.from = lbl.from;
    text.dataset.to = lbl.to;
    text.textContent = lbl.text;
    svg.appendChild(text);
  });
}

function spreadOffset(slot, total) {
  // Distribute connections in the middle 60% of the side (0.2 to 0.8)
  if (total === 1) return 0.5;
  return 0.2 + (slot / (total - 1)) * 0.6;
}

// Reset
function resetLayout() {
  layoutCards();
  drawConnections();
  saveState();
}

function clearSavedState() {
  if (!confirm('Clear all review progress (notes, details, reviewed files, positions)?')) return;
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  location.reload();
}

// Layout
function layoutCards() {
  document.querySelectorAll('.card').forEach(card => {
    card.style.visibility = 'visible';
  });

  const settings = LAYOUT_SETTINGS;
  const nodeMap = buildMeasuredNodeMap();
  const units = buildLayoutUnits(nodeMap);
  const edges = buildLayoutEdges(nodeMap, units);
  const components = buildLayoutComponents(units, edges);
  const zones = buildComponentZones(components);

  zones.forEach(zone => {
    zone.components.forEach(component => {
      layoutComponentWithDagre(component, settings);
    });
    measureZone(zone);
  });

  packZones(zones, settings);
}

function layoutComponentWithDagre(component, settings) {
  if (component.units.length === 1) {
    component.units[0].x = 0;
    component.units[0].y = 0;
    component.w = component.units[0].w;
    component.h = component.units[0].h;
    return;
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'TB',
    nodesep: settings.nodesep,
    ranksep: settings.ranksep,
    edgesep: settings.edgesep,
    marginx: 0,
    marginy: 0
  });
  g.setDefaultEdgeLabel(function() { return {}; });

  const unitById = new Map();
  component.units.forEach(unit => {
    const id = primaryIdForUnit(unit);
    unitById.set(id, unit);
    g.setNode(id, { width: unit.w, height: unit.h });
  });

  component.edges.forEach(edge => {
    const sourceId = primaryIdForUnit(edge.source);
    const targetId = primaryIdForUnit(edge.target);
    if (unitById.has(sourceId) && unitById.has(targetId)) {
      g.setEdge(sourceId, targetId);
    }
  });

  dagre.layout(g);

  let minX = Infinity;
  let minY = Infinity;
  g.nodes().forEach(nodeId => {
    const pos = g.node(nodeId);
    const unit = unitById.get(nodeId);
    if (!unit) return;
    unit.x = pos.x - unit.w / 2;
    unit.y = pos.y - unit.h / 2;
    minX = Math.min(minX, unit.x);
    minY = Math.min(minY, unit.y);
  });

  component.units.forEach(unit => {
    unit.x -= minX;
    unit.y -= minY;
  });

  component.w = Math.max(...component.units.map(u => u.x + u.w));
  component.h = Math.max(...component.units.map(u => u.y + u.h));
}

function packZones(zones, settings) {
  const maxLayoutWidth = preferredLayoutWidth();
  const zoneGap = settings.zoneGap;

  let rowX = GAP;
  let rowY = GAP;
  let rowHeight = 0;
  let maxX = 0;
  let maxY = 0;

  zones.forEach(zone => {
    if (rowX > GAP && rowX + zone.w > maxLayoutWidth) {
      rowX = GAP;
      rowY += rowHeight + zoneGap;
      rowHeight = 0;
    }

    placeZone(zone, rowX, rowY, zoneGap);
    maxX = Math.max(maxX, rowX + zone.w);
    maxY = Math.max(maxY, rowY + zone.h);
    rowHeight = Math.max(rowHeight, zone.h);
    rowX += zone.w + zoneGap;
  });

  const viewportWidth = Math.max(window.innerWidth - GAP * 2, 0);
  document.getElementById('canvasInner').style.minHeight = (maxY + 400) + 'px';
  document.getElementById('canvasInner').style.minWidth = Math.max(viewportWidth, maxX + GAP * 2) + 'px';
}

function placeZone(zone, x, y, zoneGap) {
  let componentY = y;
  zone.components.forEach(component => {
    offsetComponent(component, x, componentY);
    component.units.forEach(unit => applyUnitPosition(unit));
    componentY += component.h + zoneGap;
  });
}

function buildMeasuredNodeMap() {
  const cards = Array.from(document.querySelectorAll('.card'));

  return new Map(cards.map(el => {
    const id = el.id.replace('card-', '');
    const meta = fileMeta(id);

    return [id, {
      el: el,
      id: id,
      x: 0,
      y: 0,
      w: el.offsetWidth,
      h: el.offsetHeight,
      type: meta.type,
      dir: meta.dir
    }];
  }));
}


function buildLayoutComponents(units, edges) {
  const componentIds = buildConnectedComponents(units, edges);
  const grouped = new Map();

  units.forEach(unit => {
    const componentId = componentIds.get(unit);
    if (!grouped.has(componentId)) {
      grouped.set(componentId, { id: componentId, units: [], edges: [] });
    }

    grouped.get(componentId).units.push(unit);
  });

  edges.forEach(edge => {
    const componentId = componentIds.get(edge.source);
    grouped.get(componentId).edges.push(edge);
  });

  return Array.from(grouped.values()).sort(compareLayoutComponents);
}

function buildComponentZones(components) {
  const byZone = new Map();

  components.forEach(component => {
    const zoneId = layoutZoneForComponent(component);
    if (!byZone.has(zoneId)) byZone.set(zoneId, []);
    byZone.get(zoneId).push(component);
  });

  const zones = [];
  [0, 1, 2].filter(zoneId => byZone.has(zoneId)).forEach(zoneId => {
    const all = byZone.get(zoneId);
    const connected = all.filter(c => c.edges.length > 0);
    const solo = all.filter(c => c.edges.length === 0);

    if (connected.length > 0) {
      zones.push({ id: zoneId, components: connected, w: 0, h: 0 });
    }
    if (solo.length > 0) {
      zones.push({ id: zoneId + 0.5, components: solo, w: 0, h: 0 });
    }
  });

  return zones;
}

function measureZone(zone) {
  const zoneGap = LAYOUT_SETTINGS.zoneGap;
  zone.w = Math.max(...zone.components.map(c => c.w));
  zone.h = zone.components.reduce((sum, c, i) => sum + (i > 0 ? zoneGap : 0) + c.h, 0);
}

function preferredLayoutWidth() {
  const sidebarWidth = 320;
  return Math.max(1200, window.innerWidth - sidebarWidth - GAP * 2);
}

function buildConnectedComponents(units, edges) {
  const adjacency = new Map(units.map(unit => [unit, new Set()]));
  edges.forEach(edge => {
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  });

  const componentIds = new Map();
  let nextId = 0;

  units.forEach(unit => {
    if (componentIds.has(unit)) return;

    const stack = [unit];
    while (stack.length > 0) {
      const current = stack.pop();
      if (componentIds.has(current)) continue;

      componentIds.set(current, nextId);
      adjacency.get(current).forEach(neighbor => {
        if (!componentIds.has(neighbor)) stack.push(neighbor);
      });
    }

    nextId += 1;
  });

  return componentIds;
}

function compareLayoutComponents(a, b) {
  const zoneDelta = layoutZoneForComponent(a) - layoutZoneForComponent(b);
  if (zoneDelta !== 0) return zoneDelta;

  if (a.units.length !== b.units.length) return b.units.length - a.units.length;
  if (a.edges.length !== b.edges.length) return b.edges.length - a.edges.length;

  return componentPrimaryId(a).localeCompare(componentPrimaryId(b));
}

function layoutZoneForComponent(component) {
  const dirs = component.units.map(unit => unit.dir || '');
  const allSpecs = component.units.every(unit => unit.layoutType === 'spec');

  if (dirs.some(dir => dir.startsWith('frontend/'))) return 1;
  if (allSpecs) return 2;
  return 0;
}

function componentPrimaryId(component) {
  return component.units
    .map(unit => primaryIdForUnit(unit))
    .sort()[0] || '';
}


function offsetComponent(component, offsetX, offsetY) {
  component.units.forEach(unit => {
    unit.x += offsetX;
    unit.y += offsetY;
  });
}

function primaryIdForUnit(unit) {
  return unit.primaryId || '';
}



function buildLayoutUnits(nodeMap) {
  const units = [];
  const paired = new Set();

  // Test connections become rigid pairs
  CONNECTIONS.filter(c => c.type === 'test').forEach(c => {
    const source = nodeMap.get(c.to);  // the source file
    const spec = nodeMap.get(c.from);  // the spec file
    if (!source || !spec) return;

    paired.add(source.id);
    paired.add(spec.id);

    units.push({
      type: 'pair',
      source: source,
      spec: spec,
      primaryId: source.id,
      layoutType: source.type,
      dir: source.dir,
      x: Math.min(source.x, spec.x),
      y: Math.min(source.y, spec.y),
      w: source.w + PAIR_GAP + spec.w,
      h: Math.max(source.h, spec.h)
    });
  });

  // Unpaired nodes are their own units
  nodeMap.forEach((node, id) => {
    if (paired.has(id)) return;
    units.push({
      type: 'single',
      node: node,
      primaryId: node.id,
      layoutType: node.type,
      dir: node.dir,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h
    });
  });

  return units;
}

function buildLayoutEdges(nodeMap, units) {
  const unitForNode = new Map();
  units.forEach(u => {
    if (u.type === 'pair') {
      unitForNode.set(u.source.id, u);
      unitForNode.set(u.spec.id, u);
    } else {
      unitForNode.set(u.node.id, u);
    }
  });

  // Only non-test connections (test connections are already rigid pairs)
  return CONNECTIONS
    .filter(c => c.type !== 'test')
    .map(c => ({
      source: unitForNode.get(c.from),
      target: unitForNode.get(c.to),
      type: c.type
    }))
    .filter(e => e.source && e.target && e.source !== e.target);
}

function applyUnitPosition(unit) {
  if (unit.type === 'pair') {
    unit.source.el.style.left = Math.round(unit.x) + 'px';
    unit.source.el.style.top = Math.round(unit.y) + 'px';
    unit.spec.el.style.left = Math.round(unit.x + unit.source.w + PAIR_GAP) + 'px';
    unit.spec.el.style.top = Math.round(unit.y) + 'px';
  } else {
    unit.node.el.style.left = Math.round(unit.x) + 'px';
    unit.node.el.style.top = Math.round(unit.y) + 'px';
  }
}



function tidyLayout() {
  resetLayout();
}

// Diff panel
let diffPanelFileId = null;

function getDiffFileIds() {
  const els = document.querySelectorAll('#diffStore .diff-content');
  return Array.from(els).map(el => el.id.replace('diff-data-', ''));
}

function openDiffPanel(fileId) {
  const diffEl = document.getElementById('diff-data-' + fileId);
  const panel = document.getElementById('diffPanel');
  const body = document.getElementById('diffPanelBody');
  const pathEl = document.getElementById('diffPanelPath');
  if (!diffEl || !panel) return;

  const file = FILES_BY_ID.get(fileId);
  pathEl.textContent = file ? file.path : fileId;
  body.innerHTML = '<pre class="diff-content">' + diffEl.innerHTML + '</pre>';
  diffPanelFileId = fileId;
  panel.style.width = getDiffPanelWidth() + 'px';
  panel.classList.add('open');
  navigateToCard(fileId);
}

function closeDiffPanel() {
  const panel = document.getElementById('diffPanel');
  if (panel) panel.classList.remove('open');
  diffPanelFileId = null;
}

function diffPanelNav(direction) {
  if (!diffPanelFileId) return;
  const ids = getDiffFileIds();
  const idx = ids.indexOf(diffPanelFileId);
  if (idx === -1) return;
  const next = idx + direction;
  if (next >= 0 && next < ids.length) openDiffPanel(ids[next]);
}

function diffPanelPrev() { diffPanelNav(-1); }
function diffPanelNext() { diffPanelNav(1); }

function copyDiffPath() {
  const pathEl = document.getElementById('diffPanelPath');
  if (!pathEl) return;
  navigator.clipboard.writeText(pathEl.textContent);
  const original = pathEl.textContent;
  pathEl.textContent = 'Copied!';
  setTimeout(() => { pathEl.textContent = original; }, 1200);
}

// Diff panel resize
const DIFF_PANEL_MIN = 360;
const DIFF_PANEL_MAX_RATIO = 0.8;
const DIFF_PANEL_STORAGE = 'diffmapper:diffPanelWidth';

function getDiffPanelWidth() {
  const stored = localStorage.getItem(DIFF_PANEL_STORAGE);
  return stored ? parseInt(stored, 10) : 560;
}

function setDiffPanelWidth(width) {
  const panel = document.getElementById('diffPanel');
  if (!panel) return;
  const clamped = Math.max(DIFF_PANEL_MIN, Math.min(width, window.innerWidth * DIFF_PANEL_MAX_RATIO));
  panel.style.width = clamped + 'px';
  localStorage.setItem(DIFF_PANEL_STORAGE, clamped);
}

function initDiffPanelResize() {
  const handle = document.getElementById('diffPanelResize');
  if (!handle) return;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = document.getElementById('diffPanel').offsetWidth;
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', onDragEnd);
  });

  function onDrag(e) {
    const delta = startX - e.clientX;
    setDiffPanelWidth(startWidth + delta);
  }

  function onDragEnd() {
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', onDragEnd);
  }
}

// Details (editable sections)
function addDetail(btn) {
  const card = btn.closest('.card');
  const list = card.querySelector('.card-details-list');
  const wrapper = document.createElement('div');
  wrapper.className = 'card-details';

  const header = document.createElement('div');
  header.className = 'detail-header';
  const label = document.createElement('span');
  label.className = 'detail-label';
  label.contentEditable = 'true';
  label.textContent = 'New detail';
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'detail-delete';
  deleteBtn.textContent = '\u00d7';
  deleteBtn.onclick = () => { deleteDetail(deleteBtn); };
  header.appendChild(label);
  header.appendChild(deleteBtn);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'detail-content';
  content.contentEditable = 'true';
  wrapper.appendChild(content);

  list.appendChild(wrapper);
  label.focus();
  document.execCommand('selectAll', false, null);
  saveState();
}

function deleteDetail(btn) {
  btn.closest('.card-details').remove();
  saveState();
}

// Annotations (unified: LLM + user)
function showAnnotationInput(btn) {
  const area = btn.nextElementSibling;
  area.style.display = 'block';
  btn.style.display = 'none';
  area.querySelector('.annotation-input').focus();
}

function cancelAnnotation(btn) {
  const area = btn.closest('.annotation-input-area');
  const addBtn = area.previousElementSibling;
  area.querySelector('.annotation-input').value = '';
  area.style.display = 'none';
  addBtn.style.display = '';
}

function deleteAnnotation(btn) {
  btn.closest('.annotation-item').remove();
  updateQuestionCount();
  updateSidebar();
  saveState();
}

function toggleResolved(btn) {
  const item = btn.closest('.annotation-item');
  item.classList.toggle('resolved');
  btn.title = item.classList.contains('resolved') ? 'Mark as open' : 'Mark as resolved';
  updateQuestionCount();
  updateSidebar();
  saveState();
}

function saveAnnotation(btn) {
  const area = btn.closest('.annotation-input-area');
  const input = area.querySelector('.annotation-input');
  const typeSelect = area.querySelector('.annotation-type-select');
  const text = input.value.trim();
  if (!text) return;

  const annType = typeSelect.value;
  const container = area.closest('.card-annotations');
  const list = container.querySelector('.annotations-list');

  const item = document.createElement('div');
  item.className = 'annotation-item ' + annType;
  item.setAttribute('data-annotation-type', annType);

  const textSpan = document.createElement('span');
  textSpan.className = 'annotation-text';
  textSpan.contentEditable = 'true';
  textSpan.textContent = text;
  item.appendChild(textSpan);

  if (annType === 'question') {
    const resolveBtn = document.createElement('button');
    resolveBtn.className = 'annotation-resolve';
    resolveBtn.textContent = '\u2713';
    resolveBtn.title = 'Mark as resolved';
    resolveBtn.onclick = () => { toggleResolved(resolveBtn); };
    item.appendChild(resolveBtn);
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'annotation-delete';
  deleteBtn.textContent = '\u00d7';
  deleteBtn.onclick = () => { deleteAnnotation(deleteBtn); };
  item.appendChild(deleteBtn);

  list.appendChild(item);
  input.value = '';
  typeSelect.value = 'note';
  cancelAnnotation(btn);
  updateQuestionCount();
  updateSidebar();
  saveState();
}

function updateQuestionCount() {
  const allQuestions = document.querySelectorAll('.annotation-item.question');
  const openQuestions = Array.from(allQuestions).filter(el => !el.classList.contains('resolved'));
  const counter = document.getElementById('openQuestions');
  const total = openQuestions.length;
  if (total > 0) {
    counter.textContent = total + ' open question' + (total > 1 ? 's' : '');
    counter.style.display = '';
    counter.style.cursor = 'pointer';
    counter.onclick = () => { toggleSidebar('questions'); };
  } else {
    counter.style.display = 'none';
  }
}

// Sidebar
let sidebarTab = 'files';
const reviewedFiles = new Set();
const hiddenTypes = new Set();

function toggleSidebar(tab) {
  sidebarTab = tab || 'files';
  updateSidebarTabs();
  updateSidebar();
}

function switchSidebarTab(tab) {
  sidebarTab = tab;
  updateSidebarTabs();
  updateSidebar();
}

function updateSidebarTabs() {
  document.querySelectorAll('.sidebar-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === sidebarTab);
  });
}

function updateSidebar() {
  const content = document.getElementById('sidebarContent');
  if (!content) return;
  renderFilterPills();
  if (sidebarTab === 'files') {
    renderFilesList(content);
  } else {
    renderQuestionsList(content);
  }
  updateSidebarTabCounts();
}

function updateSidebarTabCounts() {
  const fileCount = FILES_BY_ID.size;
  const questionCount = document.querySelectorAll('.annotation-item.question:not(.resolved)').length;
  const tabFiles = document.getElementById('tabFiles');
  const tabQuestions = document.getElementById('tabQuestions');
  if (tabFiles) tabFiles.textContent = 'Files (' + fileCount + ')';
  if (tabQuestions) tabQuestions.textContent = 'Questions' + (questionCount > 0 ? ' (' + questionCount + ')' : '');
}

function renderFilterPills() {
  const container = document.getElementById('sidebarFilters');
  if (!container) return;
  const allFiles = Array.from(FILES_BY_ID.values());
  const types = [...new Set(allFiles.map(f => f.type || 'other'))].sort();
  let html = '';
  types.forEach(type => {
    const active = !hiddenTypes.has(type);
    html += `<button class="sidebar-filter-pill ${active ? 'active' : ''}" onclick="toggleTypeFilter('${type}')">${type}</button>`;
  });
  container.innerHTML = html;
}

function toggleTypeFilter(type) {
  if (hiddenTypes.has(type)) {
    hiddenTypes.delete(type);
  } else {
    hiddenTypes.add(type);
  }
  applyTypeFilters();
  updateSidebar();
  saveState();
}

function applyTypeFilters() {
  document.querySelectorAll('.card').forEach(card => {
    const fileId = card.id.replace('card-', '');
    const file = FILES_BY_ID.get(fileId);
    const type = file ? (file.type || 'other') : 'other';
    card.style.display = hiddenTypes.has(type) ? 'none' : '';
  });
  drawConnections();
}

function formatGroupHeader(dir) {
  const parts = dir.split('/');
  if (parts.length <= 2) return dir.toUpperCase().replace(/\//g, ' / ');
  return ('\u2026 / ' + parts.slice(-2).join(' / ')).toUpperCase();
}

function renderFilesList(container) {
  const allFiles = Array.from(FILES_BY_ID.values());
  const visibleFiles = allFiles.filter(f => !hiddenTypes.has(f.type || 'other'));
  const reviewedCount = visibleFiles.filter(f => reviewedFiles.has(f.id)).length;

  let html = `<div class="sidebar-progress">`;
  html += `<span>${reviewedCount}/${visibleFiles.length} reviewed</span>`;
  html += `<button class="sidebar-check-all" onclick="toggleAllReviewed()">${reviewedCount === visibleFiles.length ? 'Uncheck all' : 'Check all'}</button>`;
  html += `</div>`;

  // Group by directory
  const groups = new Map();
  visibleFiles.forEach(file => {
    const dir = file.dir || 'other';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(file);
  });

  groups.forEach((files, dir) => {
    html += `<div class="sidebar-group-header">${formatGroupHeader(dir)}</div>`;
    files.forEach(file => {
      const reviewed = reviewedFiles.has(file.id);
      const card = document.getElementById('card-' + file.id);
      const questions = card ? card.querySelectorAll('.annotation-item.question:not(.resolved)') : [];
      const statusClass = file.status === 'new' ? 'has-new' : file.status === 'deleted' ? 'has-deleted' : 'has-modified';
      const filePath = file.path || file.id;
      const fileName = filePath.split('/').pop();
      html += `<div class="sidebar-file-item ${statusClass} ${reviewed ? 'reviewed' : ''}" onclick="navigateToCard('${file.id}')">`;
      html += `<input type="checkbox" class="file-check" ${reviewed ? 'checked' : ''} onclick="event.stopPropagation(); toggleReviewed('${file.id}', this.checked)">`;
      html += `<div class="file-info">`;
      html += `<span class="file-name">${fileName}</span>`;
      html += `<span class="file-path">${filePath}</span>`;
      html += `</div>`;
      if (questions.length > 0) {
        html += `<span class="question-indicator">${questions.length}?</span>`;
      }
      html += `</div>`;
    });
  });
  container.innerHTML = html;
}

function toggleAllReviewed() {
  const allFiles = Array.from(FILES_BY_ID.values());
  const visibleFiles = allFiles.filter(f => !hiddenTypes.has(f.type || 'other'));
  const allReviewed = visibleFiles.every(f => reviewedFiles.has(f.id));

  visibleFiles.forEach(f => {
    if (allReviewed) {
      reviewedFiles.delete(f.id);
    } else {
      reviewedFiles.add(f.id);
    }
    syncReviewedState(f.id);
  });
  updateSidebar();
  saveState();
}

function renderQuestionsList(container) {
  const cards = document.querySelectorAll('.card');
  let html = '';
  cards.forEach(card => {
    const questions = card.querySelectorAll('.annotation-item.question');
    if (questions.length === 0) return;
    const fileId = card.id.replace('card-', '');
    const file = FILES_BY_ID.get(fileId);
    const fileName = file ? file.path : fileId;
    questions.forEach(q => {
      const text = q.querySelector('.annotation-text')?.textContent || '';
      const resolved = q.classList.contains('resolved');
      html += `<div class="sidebar-question-item ${resolved ? 'resolved' : ''}" onclick="navigateToCard('${fileId}')">`;
      html += `<div class="sq-file">${fileName}</div>`;
      html += `<div class="sq-text">${resolved ? '✓ ' : '? '}${text}</div>`;
      html += `</div>`;
    });
  });
  if (!html) {
    html = '<div style="padding: 12px; color: var(--text-dim);">No questions yet</div>';
  }
  container.innerHTML = html;
}

function toggleReviewed(fileId, checked) {
  if (checked) {
    reviewedFiles.add(fileId);
  } else {
    reviewedFiles.delete(fileId);
  }
  syncReviewedState(fileId);
  updateSidebar();
  saveState();
}

function syncReviewedState(fileId) {
  const card = document.getElementById('card-' + fileId);
  if (!card) return;
  const checked = reviewedFiles.has(fileId);
  card.classList.toggle('reviewed', checked);
  const checkbox = card.querySelector('.card-reviewed-check');
  if (checkbox) checkbox.checked = checked;
}

function copyFilename(el, path) {
  navigator.clipboard.writeText(path).then(() => {
    const badge = el.querySelector('.filename-copied');
    badge.classList.add('show');
    setTimeout(() => badge.classList.remove('show'), 1200);
  });
}

function navigateToCard(fileId) {
  const card = document.getElementById('card-' + fileId);
  if (!card) return;
  const canvas = document.getElementById('canvas');
  const cardLeft = parseFloat(card.style.left) || 0;
  const cardTop = parseFloat(card.style.top) || 0;
  canvas.scrollTo({
    left: cardLeft * currentZoom - 100,
    top: cardTop * currentZoom - 100,
    behavior: 'smooth'
  });
  card.style.outline = '2px solid var(--blue)';
  card.style.outlineOffset = '4px';
  setTimeout(() => {
    card.style.outline = '';
    card.style.outlineOffset = '';
  }, 2000);
}

// Persistence
function saveState() {
  try {
    const annotations = {};
    const summaries = {};
    const details = {};
    document.querySelectorAll('.card').forEach(card => {
      const fileId = card.id.replace('card-', '');
      const items = card.querySelectorAll('.annotation-item');
      if (items.length > 0) {
        annotations[fileId] = Array.from(items).map(el => ({
          type: el.getAttribute('data-annotation-type') || 'note',
          text: el.querySelector('.annotation-text')?.textContent || '',
          resolved: el.classList.contains('resolved')
        }));
      }

      const summaryEl = card.querySelector('.card-summary');
      if (summaryEl && summaryEl.textContent.trim()) {
        summaries[fileId] = summaryEl.textContent;
      }

      const detailEls = card.querySelectorAll('.card-details');
      if (detailEls.length > 0) {
        details[fileId] = Array.from(detailEls).map(d => ({
          label: d.querySelector('.detail-label')?.textContent || '',
          description: d.querySelector('.detail-content')?.textContent || ''
        }));
      }
    });

    const positions = {};
    const sizes = {};
    document.querySelectorAll('.card').forEach(card => {
      const left = card.style.left;
      const top = card.style.top;
      if (left && top) {
        positions[card.id] = { left, top };
      }
      const w = card.style.width;
      const h = card.style.height;
      if (w || h) {
        sizes[card.id] = { width: w, height: h };
      }
    });

    const state = {
      reviewed: Array.from(reviewedFiles),
      annotations: annotations,
      summaries: summaries,
      details: details,
      positions: positions,
      sizes: sizes,
      hiddenTypes: Array.from(hiddenTypes)
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // localStorage may be unavailable
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);

    if (state.reviewed) {
      state.reviewed.forEach(id => {
        reviewedFiles.add(id);
        syncReviewedState(id);
      });
    }

    if (state.annotations) {
      Object.entries(state.annotations).forEach(([fileId, saved]) => {
        const card = document.getElementById('card-' + fileId);
        if (!card) return;
        const list = card.querySelector('.annotations-list');
        if (!list) return;

        const existing = Array.from(list.querySelectorAll('.annotation-item')).map(el => ({
          type: el.getAttribute('data-annotation-type') || 'note',
          text: el.querySelector('.annotation-text')?.textContent || ''
        }));

        saved.forEach(ann => {
          const alreadyExists = existing.some(e => e.type === ann.type && e.text === ann.text);
          if (!alreadyExists) {
            addAnnotationToDOM(list, ann.type, ann.text, ann.resolved);
          } else if (ann.resolved) {
            const match = Array.from(list.querySelectorAll('.annotation-item')).find(el =>
              el.getAttribute('data-annotation-type') === ann.type &&
              el.querySelector('.annotation-text')?.textContent === ann.text
            );
            if (match && !match.classList.contains('resolved')) {
              match.classList.add('resolved');
              const btn = match.querySelector('.annotation-resolve');
              if (btn) btn.title = 'Mark as open';
            }
          }
        });
      });
    }

    if (state.summaries) {
      Object.entries(state.summaries).forEach(([fileId, text]) => {
        const card = document.getElementById('card-' + fileId);
        if (!card) return;
        const summaryEl = card.querySelector('.card-summary');
        if (summaryEl) summaryEl.textContent = text;
      });
    }

    if (state.details) {
      Object.entries(state.details).forEach(([fileId, saved]) => {
        const card = document.getElementById('card-' + fileId);
        if (!card) return;
        const list = card.querySelector('.card-details-list');
        if (!list) return;

        list.innerHTML = '';
        saved.forEach(d => {
          const wrapper = document.createElement('div');
          wrapper.className = 'card-details';

          const header = document.createElement('div');
          header.className = 'detail-header';
          const label = document.createElement('span');
          label.className = 'detail-label';
          label.contentEditable = 'true';
          label.textContent = d.label;
          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'detail-delete';
          deleteBtn.textContent = '\u00d7';
          deleteBtn.onclick = () => { deleteDetail(deleteBtn); };
          header.appendChild(label);
          header.appendChild(deleteBtn);
          wrapper.appendChild(header);

          const content = document.createElement('div');
          content.className = 'detail-content';
          content.contentEditable = 'true';
          content.textContent = d.description;
          wrapper.appendChild(content);

          list.appendChild(wrapper);
        });
      });
    }

    if (state.positions) {
      Object.entries(state.positions).forEach(([cardId, pos]) => {
        const card = document.getElementById(cardId);
        if (card) {
          card.style.left = pos.left;
          card.style.top = pos.top;
        }
      });
    }

    if (state.sizes) {
      Object.entries(state.sizes).forEach(([cardId, size]) => {
        const card = document.getElementById(cardId);
        if (card) {
          if (size.width) card.style.width = size.width;
          if (size.height) card.style.height = size.height;
        }
      });
    }

    if (state.hiddenTypes) {
      state.hiddenTypes.forEach(type => hiddenTypes.add(type));
      applyTypeFilters();
    }
  } catch (e) {
    // localStorage may be unavailable
  }
}

function addAnnotationToDOM(list, annType, text, resolved) {
  const item = document.createElement('div');
  item.className = 'annotation-item ' + annType + (resolved ? ' resolved' : '');
  item.setAttribute('data-annotation-type', annType);

  const textSpan = document.createElement('span');
  textSpan.className = 'annotation-text';
  textSpan.contentEditable = 'true';
  textSpan.textContent = text;
  item.appendChild(textSpan);

  if (annType === 'question') {
    const resolveBtn = document.createElement('button');
    resolveBtn.className = 'annotation-resolve';
    resolveBtn.textContent = '\u2713';
    resolveBtn.title = resolved ? 'Mark as open' : 'Mark as resolved';
    resolveBtn.onclick = () => { toggleResolved(resolveBtn); };
    item.appendChild(resolveBtn);
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'annotation-delete';
  deleteBtn.textContent = '\u00d7';
  deleteBtn.onclick = () => { deleteAnnotation(deleteBtn); };
  item.appendChild(deleteBtn);

  list.appendChild(item);
}

// Init
function adjustCanvasTop() {
  const bar = document.getElementById('contextBar');
  const canvas = document.getElementById('canvas');
  if (bar && !bar.classList.contains('empty')) {
    canvas.style.top = (46 + bar.offsetHeight) + 'px';
  } else {
    canvas.style.top = '46px';
  }
}

function toggleContext() {
  const bar = document.getElementById('contextBar');
  const btn = document.getElementById('contextToggle');
  bar.classList.toggle('open');
  btn.textContent = bar.classList.contains('open') ? '▾ Details' : '▸ Details';
  setTimeout(adjustCanvasTop, 220);
}

// Theme management
// Zoom controls
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
let currentZoom = 1;

function applyZoom() {
  const inner = document.getElementById('canvasInner');
  if (!inner) return;
  inner.style.transform = currentZoom === 1 ? '' : 'scale(' + currentZoom + ')';
  const label = document.getElementById('zoomLevel');
  if (label) label.textContent = Math.round(currentZoom * 100) + '%';
}

function zoomAtPoint(direction, clientX, clientY) {
  const canvas = document.getElementById('canvas');
  const rect = canvas.getBoundingClientRect();
  const mouseX = clientX - rect.left;
  const mouseY = clientY - rect.top;

  const contentX = (canvas.scrollLeft + mouseX) / currentZoom;
  const contentY = (canvas.scrollTop + mouseY) / currentZoom;

  const oldZoom = currentZoom;
  if (direction > 0) {
    const nextIdx = ZOOM_LEVELS.findIndex(z => z > oldZoom);
    if (nextIdx >= 0) currentZoom = ZOOM_LEVELS[nextIdx];
  } else {
    let prevIdx = -1;
    for (let i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
      if (ZOOM_LEVELS[i] < oldZoom) { prevIdx = i; break; }
    }
    if (prevIdx >= 0) currentZoom = ZOOM_LEVELS[prevIdx];
  }
  if (currentZoom === oldZoom) return;

  applyZoom();
  canvas.scrollLeft = contentX * currentZoom - mouseX;
  canvas.scrollTop = contentY * currentZoom - mouseY;
}

function zoomIn() {
  const nextIdx = ZOOM_LEVELS.findIndex(z => z > currentZoom);
  if (nextIdx >= 0) currentZoom = ZOOM_LEVELS[nextIdx];
  applyZoom();
}

function zoomOut() {
  let prevIdx = -1;
  for (let i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
    if (ZOOM_LEVELS[i] < currentZoom) { prevIdx = i; break; }
  }
  if (prevIdx >= 0) currentZoom = ZOOM_LEVELS[prevIdx];
  applyZoom();
}

function zoomReset() {
  currentZoom = 1;
  applyZoom();
}

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  updateThemeButton(theme);
}

function updateThemeButton(theme) {
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = theme === 'light' ? '\u2600' : '\u263e';
}

function cycleTheme() {
  const stored = localStorage.getItem('diffmapper:theme');
  const system = getSystemTheme();
  let next;

  if (!stored) {
    next = system === 'dark' ? 'light' : 'dark';
  } else if (stored !== system) {
    next = null;
  } else {
    next = system === 'dark' ? 'light' : 'dark';
  }

  if (next) {
    localStorage.setItem('diffmapper:theme', next);
    applyTheme(next);
  } else {
    localStorage.removeItem('diffmapper:theme');
    applyTheme(system);
  }
}

function initTheme() {
  const stored = localStorage.getItem('diffmapper:theme');
  const theme = stored || getSystemTheme();
  applyTheme(theme);
}

if (typeof document !== 'undefined') {
initTheme();
adjustCanvasTop();
layoutCards();
loadState();
drawConnections();
updateQuestionCount();
updateSidebar();
initDiffPanelResize();
window.addEventListener('resize', drawConnections);
document.getElementById('canvas').addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    zoomAtPoint(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
  }
}, { passive: false });

// Keyboard shortcuts for diff panel
document.addEventListener('keydown', (e) => {
  if (!diffPanelFileId) return;
  if (e.target.matches && e.target.matches('input, textarea, [contenteditable]')) return;
  if (e.key === 'Escape') { closeDiffPanel(); e.preventDefault(); }
  else if (e.key === 'ArrowUp' || e.key === 'k') { diffPanelPrev(); e.preventDefault(); }
  else if (e.key === 'ArrowDown' || e.key === 'j') { diffPanelNext(); e.preventDefault(); }
});

// Redraw connections when cards are resized
const cardResizeObserver = new ResizeObserver(() => { drawConnections(); saveState(); });
document.querySelectorAll('.card').forEach(card => cardResizeObserver.observe(card));

// Save state when contenteditable fields are edited; toggle spellcheck on focus
document.getElementById('canvas').addEventListener('focus', (e) => {
  if (e.target.matches && e.target.matches('[contenteditable]')) {
    e.target.spellcheck = true;
  }
}, true);
document.getElementById('canvas').addEventListener('blur', (e) => {
  if (e.target.matches && e.target.matches('[contenteditable]')) {
    e.target.spellcheck = false;
    saveState();
  }
}, true);
}

// Export pure functions for testing (Node.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildGrid, worldToGrid, gridToWorld, astar, simplifyPath,
    pickExitSide, sideAnchor, cardEdgePoint, spreadOffset,
    placeLabelOnPath, deconflictLabels, connColor, connMarker,
    buildConnectedComponents, formatGroupHeader, unblockNearPoint, restoreCells,
    routeEdge, buildLayoutUnits, buildLayoutEdges,
    buildComponentZones, compareLayoutComponents, measureZone,
    buildLayoutComponents, primaryIdForUnit, componentPrimaryId,
    layoutZoneForComponent
  };
}
