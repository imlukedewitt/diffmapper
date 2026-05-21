const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGrid, worldToGrid, gridToWorld, astar, simplifyPath,
  pickExitSide, sideAnchor, cardEdgePoint, spreadOffset,
  placeLabelOnPath, deconflictLabels, connColor, connMarker,
  buildConnectedComponents, formatGroupHeader, unblockNearPoint, restoreCells
} = require('../../lib/diffmapper/templates/canvas.js');

// --- Grid construction ---

describe('buildGrid', () => {
  const cards = [
    { id: 'a', x: 100, y: 100, w: 200, h: 150 },
    { id: 'b', x: 500, y: 100, w: 200, h: 150 }
  ];

  it('creates a grid with rows and cols', () => {
    const grid = buildGrid(cards, 20);
    assert.ok(grid.rows > 0);
    assert.ok(grid.cols > 0);
    assert.ok(grid.cells instanceof Uint16Array);
  });

  it('marks card areas as blocked (65535)', () => {
    const grid = buildGrid(cards, 20);
    // Center of card 'a' should be blocked
    const cell = worldToGrid(grid, 200, 175);
    const idx = cell.row * grid.cols + cell.col;
    assert.equal(grid.cells[idx], 65535);
  });

  it('leaves space between cards unblocked', () => {
    const grid = buildGrid(cards, 20);
    // Midpoint between the two cards
    const cell = worldToGrid(grid, 380, 175);
    const idx = cell.row * grid.cols + cell.col;
    assert.equal(grid.cells[idx], 0);
  });
});

describe('worldToGrid / gridToWorld', () => {
  const grid = { minX: 0, minY: 0, cs: 10, rows: 100, cols: 100 };

  it('converts world coords to grid coords', () => {
    const cell = worldToGrid(grid, 55, 35);
    assert.equal(cell.col, 6); // round(55/10)
    assert.equal(cell.row, 4); // round(35/10)
  });

  it('converts grid coords back to world', () => {
    const pt = gridToWorld(grid, 6, 4);
    assert.equal(pt.x, 60);
    assert.equal(pt.y, 40);
  });
});

// --- A* pathfinder ---

describe('astar', () => {
  it('finds a straight path with no obstacles', () => {
    const grid = { cells: new Uint16Array(100), rows: 10, cols: 10, minX: 0, minY: 0, cs: 10 };
    const path = astar(grid, 0, 0, 9, 0);
    assert.ok(path);
    assert.equal(path[0].col, 0);
    assert.equal(path[path.length - 1].col, 9);
  });

  it('routes around a blocked cell', () => {
    const grid = { cells: new Uint16Array(25), rows: 5, cols: 5, minX: 0, minY: 0, cs: 10 };
    // Block the middle cell (2,2)
    grid.cells[2 * 5 + 2] = 65535;
    const path = astar(grid, 0, 2, 4, 2);
    assert.ok(path);
    // Path should not pass through (2,2)
    const passesBlocked = path.some(p => p.col === 2 && p.row === 2);
    assert.equal(passesBlocked, false);
  });

  it('returns null when completely blocked', () => {
    const grid = { cells: new Uint16Array(25), rows: 5, cols: 5, minX: 0, minY: 0, cs: 10 };
    // Block entire row 2
    for (let c = 0; c < 5; c++) grid.cells[2 * 5 + c] = 65535;
    const path = astar(grid, 2, 0, 2, 4);
    assert.equal(path, null);
  });

  it('respects maxIter limit', () => {
    const grid = { cells: new Uint16Array(10000), rows: 100, cols: 100, minX: 0, minY: 0, cs: 10 };
    const path = astar(grid, 0, 0, 99, 99, 10);
    assert.equal(path, null);
  });

  it('uses diagonal moves', () => {
    const grid = { cells: new Uint16Array(100), rows: 10, cols: 10, minX: 0, minY: 0, cs: 10 };
    const path = astar(grid, 0, 0, 5, 5);
    assert.ok(path);
    // Diagonal path should be shorter than manhattan
    assert.ok(path.length < 11);
  });
});

// --- Path simplification ---

describe('simplifyPath', () => {
  it('removes collinear points', () => {
    const path = [
      { col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 },
      { col: 3, row: 0 }, { col: 3, row: 1 }, { col: 3, row: 2 }
    ];
    const simplified = simplifyPath(path);
    assert.deepEqual(simplified, [
      { col: 0, row: 0 }, { col: 3, row: 0 }, { col: 3, row: 2 }
    ]);
  });

  it('keeps all points when no collinear', () => {
    const path = [{ col: 0, row: 0 }, { col: 1, row: 1 }, { col: 2, row: 0 }];
    const simplified = simplifyPath(path);
    assert.equal(simplified.length, 3);
  });

  it('handles null/short paths', () => {
    assert.equal(simplifyPath(null), null);
    assert.deepEqual(simplifyPath([{ col: 0, row: 0 }]), [{ col: 0, row: 0 }]);
  });
});

// --- Exit/entry side selection ---

describe('pickExitSide', () => {
  it('picks right when target is to the right', () => {
    const source = { x: 0, y: 0, w: 100, h: 100 };
    const target = { x: 300, y: 0, w: 100, h: 100 };
    assert.equal(pickExitSide(source, target), 'right');
  });

  it('picks left when target is to the left', () => {
    const source = { x: 300, y: 0, w: 100, h: 100 };
    const target = { x: 0, y: 0, w: 100, h: 100 };
    assert.equal(pickExitSide(source, target), 'left');
  });

  it('picks bottom when target is below', () => {
    const source = { x: 0, y: 0, w: 100, h: 100 };
    const target = { x: 0, y: 300, w: 100, h: 100 };
    assert.equal(pickExitSide(source, target), 'bottom');
  });

  it('picks top when target is above', () => {
    const source = { x: 0, y: 300, w: 100, h: 100 };
    const target = { x: 0, y: 0, w: 100, h: 100 };
    assert.equal(pickExitSide(source, target), 'top');
  });
});

describe('sideAnchor', () => {
  const rect = { x: 100, y: 100, w: 200, h: 150 };

  it('returns anchor point outside the card edge', () => {
    const pt = sideAnchor(rect, 'right', 14, 0.5);
    assert.equal(pt.x, 100 + 200 + 14);
    assert.equal(pt.y, 100 + 75);
  });

  it('respects offset along the side', () => {
    const pt = sideAnchor(rect, 'top', 14, 0.25);
    assert.equal(pt.x, 100 + 50); // 25% of 200
    assert.equal(pt.y, 100 - 14);
  });
});

describe('cardEdgePoint', () => {
  const rect = { x: 100, y: 100, w: 200, h: 150 };

  it('returns point on card edge', () => {
    const pt = cardEdgePoint(rect, 'bottom', 0.5);
    assert.equal(pt.x, 200); // center
    assert.equal(pt.y, 250); // bottom
  });
});

// --- Spread offset ---

describe('spreadOffset', () => {
  it('returns 0.5 for single connection', () => {
    assert.equal(spreadOffset(0, 1), 0.5);
  });

  it('distributes two connections at 0.2 and 0.8', () => {
    assert.equal(spreadOffset(0, 2), 0.2);
    assert.equal(spreadOffset(1, 2), 0.8);
  });

  it('distributes three connections evenly', () => {
    assert.equal(spreadOffset(0, 3), 0.2);
    assert.equal(spreadOffset(1, 3), 0.5);
    assert.equal(spreadOffset(2, 3), 0.8);
  });
});

// --- Label placement ---

describe('placeLabelOnPath', () => {
  it('places label at midpoint of a straight line', () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const pos = placeLabelOnPath(points);
    assert.equal(pos.x, 50);
  });

  it('places label at midpoint of total path length', () => {
    // L-shaped path: 100 right, then 100 down. Midpoint at 100 along = the corner
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const pos = placeLabelOnPath(points);
    assert.equal(pos.x, 100);
    assert.ok(Math.abs(pos.y - (-8)) < 1); // at the corner, offset by -8
  });
});

describe('deconflictLabels', () => {
  it('nudges overlapping labels apart', () => {
    const labels = [
      { x: 100, y: 50, text: 'a' },
      { x: 105, y: 52, text: 'b' }
    ];
    deconflictLabels(labels);
    assert.ok(Math.abs(labels[0].y - labels[1].y) >= 18);
  });

  it('leaves non-overlapping labels alone', () => {
    const labels = [
      { x: 100, y: 50, text: 'a' },
      { x: 500, y: 50, text: 'b' }
    ];
    deconflictLabels(labels);
    assert.equal(labels[1].y, 50);
  });
});

// --- Connection colors ---

describe('connColor', () => {
  it('returns correct color for known types', () => {
    assert.equal(connColor('test'), 'var(--conn-test)');
    assert.equal(connColor('calls'), 'var(--conn-calls)');
    assert.equal(connColor('renders'), 'var(--conn-renders)');
    assert.equal(connColor('passes_prop'), 'var(--conn-passes-prop)');
    assert.equal(connColor('styles'), 'var(--conn-styles)');
  });

  it('returns default for unknown type', () => {
    assert.equal(connColor('unknown'), 'var(--connection-color)');
    assert.equal(connColor(undefined), 'var(--connection-color)');
  });
});

describe('connMarker', () => {
  it('returns typed marker for known types', () => {
    assert.equal(connMarker('test'), 'url(#arrowhead-test)');
    assert.equal(connMarker('calls'), 'url(#arrowhead-calls)');
  });

  it('returns default marker for unknown types', () => {
    assert.equal(connMarker('unknown'), 'url(#arrowhead)');
    assert.equal(connMarker(undefined), 'url(#arrowhead)');
  });
});

// --- Format group header ---

describe('formatGroupHeader', () => {
  it('keeps short paths as-is', () => {
    assert.equal(formatGroupHeader('controllers'), 'CONTROLLERS');
  });

  it('keeps two-segment paths as-is', () => {
    assert.equal(formatGroupHeader('services/billing'), 'SERVICES / BILLING');
  });

  it('truncates deep paths to last 2 segments', () => {
    const result = formatGroupHeader('frontend/js/components/Billing/Forms');
    assert.equal(result, '\u2026 / BILLING / FORMS');
  });
});

// --- Grid unblock/restore ---

describe('unblockNearPoint / restoreCells', () => {
  it('unblocks cells around a point and restores them', () => {
    const grid = { cells: new Uint16Array(25), rows: 5, cols: 5, minX: 0, minY: 0, cs: 10 };
    // Block center
    grid.cells[2 * 5 + 2] = 65535;
    grid.cells[1 * 5 + 2] = 65535;

    const saved = unblockNearPoint(grid, 2, 2);
    assert.equal(grid.cells[2 * 5 + 2], 0);
    assert.ok(saved.length > 0);

    restoreCells(grid, saved);
    assert.equal(grid.cells[2 * 5 + 2], 65535);
  });
});
