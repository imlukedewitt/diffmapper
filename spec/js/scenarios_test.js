const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGrid, astar, routeEdge, spreadOffset,
  pickExitSide, worldToGrid, simplifyPath
} = require('../../lib/diffmapper/templates/canvas.js');

// --- Parallel paths get lane spacing ---

describe('parallel path lane spacing', () => {
  // Two cards on the left, one card on the right. Both left cards connect to the right card.
  // The paths should not overlap — soft cost should push the second path to adjacent cells.
  const cardA = { x: 0, y: 0, w: 100, h: 80 };
  const cardB = { x: 0, y: 150, w: 100, h: 80 };
  const cardC = { x: 400, y: 75, w: 100, h: 80 };

  it('second path avoids cells used by first path', () => {
    const grid = buildGrid([cardA, cardB, cardC], 10);

    // Route first edge
    const route1 = routeEdge(cardA, cardC, grid, 'right', 'left', 0.5, 0.3);
    // Route second edge (grid now has soft costs from first)
    const route2 = routeEdge(cardB, cardC, grid, 'right', 'left', 0.5, 0.7);

    assert.ok(route1.points.length >= 2);
    assert.ok(route2.points.length >= 2);

    // The midpoints of the two paths should not be at the same y
    const mid1y = route1.points[Math.floor(route1.points.length / 2)].y;
    const mid2y = route2.points[Math.floor(route2.points.length / 2)].y;
    assert.notEqual(Math.round(mid1y), Math.round(mid2y));
  });

  it('paths through same corridor are offset from each other', () => {
    // Two cards on the left, both need to reach same point on right
    const left1 = { x: 0, y: 0, w: 80, h: 60 };
    const left2 = { x: 0, y: 80, w: 80, h: 60 };
    const right = { x: 300, y: 40, w: 80, h: 60 };
    const grid = buildGrid([left1, left2, right], 10);

    const route1 = routeEdge(left1, right, grid, 'right', 'left', 0.5, 0.4);
    const route2 = routeEdge(left2, right, grid, 'right', 'left', 0.5, 0.6);

    // Collect all x,y points from both paths (excluding endpoints)
    const inner1 = route1.points.slice(1, -1);
    const inner2 = route2.points.slice(1, -1);

    // No inner point should be at the exact same position in both paths
    const overlaps = inner1.filter(p1 =>
      inner2.some(p2 => Math.abs(p1.x - p2.x) < 5 && Math.abs(p1.y - p2.y) < 5)
    );
    // Some overlap is acceptable near endpoints, but should be minimal
    assert.ok(overlaps.length < inner1.length * 0.5,
      `Too much overlap: ${overlaps.length}/${inner1.length} points`);
  });
});

// --- Port ordering prevents crossings ---

describe('port ordering prevents crossings', () => {
  it('connections to spatially ordered targets get ordered slots', () => {
    // Source card at center top, two targets below: one left, one right
    const source = { x: 200, y: 0, w: 100, h: 80 };
    const targetLeft = { x: 50, y: 300, w: 100, h: 80 };
    const targetRight = { x: 350, y: 300, w: 100, h: 80 };

    // Exit side should be bottom for both (targets are below)
    assert.equal(pickExitSide(source, targetLeft), 'bottom');
    assert.equal(pickExitSide(source, targetRight), 'bottom');

    // Left target should get lower offset (leftward slot)
    // Right target should get higher offset (rightward slot)
    const leftOffset = spreadOffset(0, 2); // 0.2
    const rightOffset = spreadOffset(1, 2); // 0.8

    // The exit x for left target should be further left than for right target
    const exitXLeft = source.x + source.w * leftOffset;
    const exitXRight = source.x + source.w * rightOffset;
    assert.ok(exitXLeft < exitXRight);

    // This means the left-going line starts from the left slot,
    // the right-going line starts from the right slot — no crossing
  });
});

// --- A* with soft costs ---

describe('A* soft cost avoidance', () => {
  it('prefers cells without soft cost', () => {
    const grid = { cells: new Uint16Array(100), rows: 10, cols: 10, minX: 0, minY: 0, cs: 10 };

    // Add soft cost along row 5 (the direct path from (0,5) to (9,5))
    for (let c = 1; c < 9; c++) grid.cells[5 * 10 + c] = 5;

    const path = astar(grid, 0, 5, 9, 5);
    assert.ok(path);

    // Path should avoid row 5 for most of its length (go around via row 4 or 6)
    const onRow5 = path.filter(p => p.row === 5).length;
    assert.ok(onRow5 < path.length * 0.5,
      `Path spent ${onRow5}/${path.length} cells on costly row 5`);
  });

  it('still uses costly cells if no better option', () => {
    const grid = { cells: new Uint16Array(25), rows: 5, cols: 5, minX: 0, minY: 0, cs: 10 };

    // Soft cost everywhere except start and end
    for (let i = 0; i < 25; i++) grid.cells[i] = 3;
    grid.cells[0] = 0;
    grid.cells[4] = 0;

    const path = astar(grid, 0, 0, 4, 0);
    assert.ok(path);
    assert.equal(path[0].col, 0);
    assert.equal(path[path.length - 1].col, 4);
  });
});

// --- Edge cases ---

describe('edge cases', () => {
  it('handles cards with zero gap between them', () => {
    const cardA = { x: 0, y: 0, w: 100, h: 80 };
    const cardB = { x: 100, y: 0, w: 100, h: 80 }; // touching
    const grid = buildGrid([cardA, cardB], 10);
    const result = routeEdge(cardA, cardB, grid, 'right', 'left', 0.5, 0.5);
    // Should still produce a path (even if fallback straight line)
    assert.ok(result.points.length >= 2);
  });

  it('handles overlapping cards', () => {
    const cardA = { x: 0, y: 0, w: 100, h: 80 };
    const cardB = { x: 50, y: 20, w: 100, h: 80 }; // overlapping
    const grid = buildGrid([cardA, cardB], 10);
    const result = routeEdge(cardA, cardB, grid, 'right', 'left', 0.5, 0.5);
    assert.ok(result.points.length >= 2);
  });

  it('handles very distant cards', () => {
    const cardA = { x: 0, y: 0, w: 100, h: 80 };
    const cardB = { x: 2000, y: 1500, w: 100, h: 80 };
    const grid = buildGrid([cardA, cardB], 20);
    const result = routeEdge(cardA, cardB, grid, 'right', 'left', 0.5, 0.5);
    assert.ok(result.points.length >= 2);
  });

  it('handles single card (self-loop would have no target)', () => {
    const card = { x: 100, y: 100, w: 200, h: 150 };
    const grid = buildGrid([card], 10);
    assert.ok(grid.rows > 0);
    assert.ok(grid.cols > 0);
  });

  it('routes between cards with many obstacles', () => {
    const source = { x: 0, y: 200, w: 100, h: 80 };
    const target = { x: 600, y: 200, w: 100, h: 80 };
    const obstacles = [];
    // Wall of obstacles between them
    for (let i = 0; i < 5; i++) {
      obstacles.push({ x: 250, y: i * 100, w: 80, h: 80 });
    }
    const allCards = [source, target, ...obstacles];
    const grid = buildGrid(allCards, 10);
    const result = routeEdge(source, target, grid, 'right', 'left', 0.5, 0.5);
    assert.ok(result.points.length >= 2);
    // Should route around the wall (more than just start+end)
    assert.ok(result.points.length > 2,
      `Expected path around wall, got ${result.points.length} points`);
  });

  it('path does not pass through obstacle interiors', () => {
    const source = { x: 0, y: 0, w: 80, h: 60 };
    const target = { x: 400, y: 0, w: 80, h: 60 };
    const obstacle = { x: 180, y: -30, w: 100, h: 120 };
    const grid = buildGrid([source, target, obstacle], 10);
    const result = routeEdge(source, target, grid, 'right', 'left', 0.5, 0.5);

    // Check no intermediate point is inside the obstacle (with some tolerance)
    const pad = 10; // allow points near edge
    const inner = result.points.slice(1, -1);
    const insideObstacle = inner.filter(p =>
      p.x > obstacle.x + pad && p.x < obstacle.x + obstacle.w - pad &&
      p.y > obstacle.y + pad && p.y < obstacle.y + obstacle.h - pad
    );
    assert.equal(insideObstacle.length, 0,
      `${insideObstacle.length} points inside obstacle`);
  });
});

// --- simplifyPath with real A* output ---

describe('simplifyPath with A* output', () => {
  it('reduces a long straight diagonal to 2 points', () => {
    // Simulate A* returning many diagonal steps
    const path = [];
    for (let i = 0; i <= 10; i++) path.push({ col: i, row: i });
    const simplified = simplifyPath(path);
    assert.equal(simplified.length, 2);
    assert.deepEqual(simplified[0], { col: 0, row: 0 });
    assert.deepEqual(simplified[1], { col: 10, row: 10 });
  });

  it('keeps corners in an L-shaped path', () => {
    const path = [
      { col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 },
      { col: 3, row: 0 }, { col: 3, row: 1 }, { col: 3, row: 2 },
      { col: 3, row: 3 }
    ];
    const simplified = simplifyPath(path);
    assert.deepEqual(simplified, [
      { col: 0, row: 0 }, { col: 3, row: 0 }, { col: 3, row: 3 }
    ]);
  });

  it('handles zigzag paths', () => {
    const path = [
      { col: 0, row: 0 }, { col: 1, row: 0 },
      { col: 1, row: 1 }, { col: 2, row: 1 },
      { col: 2, row: 2 }, { col: 3, row: 2 }
    ];
    const simplified = simplifyPath(path);
    // Every direction change should be kept
    assert.equal(simplified.length, 6);
  });
});
