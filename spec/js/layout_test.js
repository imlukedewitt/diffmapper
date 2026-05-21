const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  routeEdge, buildGrid, buildConnectedComponents,
  buildLayoutComponents, buildComponentZones, measureZone,
  compareLayoutComponents, layoutZoneForComponent,
  primaryIdForUnit, componentPrimaryId, spreadOffset
} = require('../../lib/diffmapper/templates/canvas.js');

// --- routeEdge ---

describe('routeEdge', () => {
  const fromRect = { x: 0, y: 0, w: 100, h: 80 };
  const toRect = { x: 300, y: 0, w: 100, h: 80 };

  it('returns points array with start and end on card edges', () => {
    const grid = buildGrid([fromRect, toRect], 20);
    const result = routeEdge(fromRect, toRect, grid, 'right', 'left', 0.5, 0.5);
    assert.ok(result.points.length >= 2);
    // First point should be on fromRect right edge
    assert.equal(result.points[0].x, fromRect.x + fromRect.w);
    // Last point should be on toRect left edge
    assert.equal(result.points[result.points.length - 1].x, toRect.x);
  });

  it('routes around obstacles between cards', () => {
    // Tall obstacle that forces path to go wide around it
    const obstacle = { x: 150, y: -50, w: 80, h: 200 };
    const grid = buildGrid([fromRect, toRect, obstacle], 10);
    const result = routeEdge(fromRect, toRect, grid, 'right', 'left', 0.5, 0.5);
    // Path should have more than 2 points (not a straight line)
    assert.ok(result.points.length > 2, `Expected >2 points, got ${result.points.length}`);
  });

  it('falls back to straight line when path not found', () => {
    // Use maxIter=1 to force failure
    const grid = buildGrid([fromRect, toRect], 20);
    const result = routeEdge(fromRect, toRect, grid, 'right', 'left', 0.5, 0.5, 1);
    // Should still return 2 points (straight line fallback)
    assert.equal(result.points.length, 2);
  });

  it('respects exit/entry offsets', () => {
    const grid = buildGrid([fromRect, toRect], 20);
    const result025 = routeEdge(fromRect, toRect, grid, 'right', 'left', 0.25, 0.75);
    const result075 = routeEdge(fromRect, toRect, grid, 'right', 'left', 0.75, 0.25);
    // Start y positions should differ due to offset
    assert.notEqual(result025.points[0].y, result075.points[0].y);
  });

  it('marks used cells with soft cost for lane spacing', () => {
    const grid = buildGrid([fromRect, toRect], 20);
    const allZeroBefore = Array.from(grid.cells).every(c => c === 0 || c === 65535);
    assert.ok(allZeroBefore);
    routeEdge(fromRect, toRect, grid, 'right', 'left', 0.5, 0.5);
    // Some cells should now have soft cost (> 0 but < 65535)
    const hasSoftCost = Array.from(grid.cells).some(c => c > 0 && c < 65535);
    assert.ok(hasSoftCost, 'Expected soft cost cells for lane spacing');
  });

  it('restores unblocked anchor cells after routing', () => {
    const grid = buildGrid([fromRect, toRect], 20);
    // Count blocked cells before
    const blockedBefore = Array.from(grid.cells).filter(c => c === 65535).length;
    routeEdge(fromRect, toRect, grid, 'right', 'left', 0.5, 0.5);
    const blockedAfter = Array.from(grid.cells).filter(c => c === 65535).length;
    // Blocked count should be the same (unblock/restore cycle)
    assert.equal(blockedAfter, blockedBefore);
  });
});

// --- buildConnectedComponents ---

describe('buildConnectedComponents', () => {
  it('assigns same ID to connected units', () => {
    const a = { primaryId: 'a' };
    const b = { primaryId: 'b' };
    const c = { primaryId: 'c' };
    const edges = [{ source: a, target: b }];
    const ids = buildConnectedComponents([a, b, c], edges);
    assert.equal(ids.get(a), ids.get(b));
    assert.notEqual(ids.get(a), ids.get(c));
  });

  it('handles fully disconnected units', () => {
    const a = { primaryId: 'a' };
    const b = { primaryId: 'b' };
    const c = { primaryId: 'c' };
    const ids = buildConnectedComponents([a, b, c], []);
    const uniqueIds = new Set(ids.values());
    assert.equal(uniqueIds.size, 3);
  });

  it('handles chain connections', () => {
    const a = { primaryId: 'a' };
    const b = { primaryId: 'b' };
    const c = { primaryId: 'c' };
    const edges = [{ source: a, target: b }, { source: b, target: c }];
    const ids = buildConnectedComponents([a, b, c], edges);
    assert.equal(ids.get(a), ids.get(b));
    assert.equal(ids.get(b), ids.get(c));
  });

  it('handles bidirectional edges', () => {
    const a = { primaryId: 'a' };
    const b = { primaryId: 'b' };
    const edges = [{ source: a, target: b }];
    const ids = buildConnectedComponents([a, b], edges);
    assert.equal(ids.get(a), ids.get(b));
  });
});

// --- buildLayoutComponents ---

describe('buildLayoutComponents', () => {
  it('groups units into components by connectivity', () => {
    const a = { primaryId: 'a', dir: 'app/', layoutType: 'service' };
    const b = { primaryId: 'b', dir: 'app/', layoutType: 'service' };
    const c = { primaryId: 'c', dir: 'app/', layoutType: 'service' };
    const edges = [{ source: a, target: b, type: 'calls' }];
    const components = buildLayoutComponents([a, b, c], edges);
    assert.equal(components.length, 2); // one connected (a,b), one solo (c)
    const big = components.find(comp => comp.units.length === 2);
    assert.ok(big);
    assert.equal(big.edges.length, 1);
  });

  it('sorts components by zone then size', () => {
    const backend = { primaryId: 'x', dir: 'app/', layoutType: 'service' };
    const frontend = { primaryId: 'y', dir: 'frontend/js', layoutType: 'component' };
    const spec = { primaryId: 'z', dir: 'spec/', layoutType: 'spec' };
    const components = buildLayoutComponents([backend, frontend, spec], []);
    // Backend (zone 0), frontend (zone 1), spec (zone 2)
    assert.equal(components[0].units[0].primaryId, 'x');
    assert.equal(components[1].units[0].primaryId, 'y');
    assert.equal(components[2].units[0].primaryId, 'z');
  });
});

// --- layoutZoneForComponent ---

describe('layoutZoneForComponent', () => {
  it('assigns zone 0 to backend components', () => {
    const comp = { units: [{ dir: 'app/services', layoutType: 'service' }] };
    assert.equal(layoutZoneForComponent(comp), 0);
  });

  it('assigns zone 1 to frontend components', () => {
    const comp = { units: [{ dir: 'frontend/js/Components', layoutType: 'component' }] };
    assert.equal(layoutZoneForComponent(comp), 1);
  });

  it('assigns zone 2 to all-spec components', () => {
    const comp = { units: [
      { dir: 'spec/services', layoutType: 'spec' },
      { dir: 'spec/models', layoutType: 'spec' }
    ]};
    assert.equal(layoutZoneForComponent(comp), 2);
  });

  it('assigns zone 0 to mixed components', () => {
    const comp = { units: [
      { dir: 'app/services', layoutType: 'service' },
      { dir: 'spec/services', layoutType: 'spec' }
    ]};
    assert.equal(layoutZoneForComponent(comp), 0);
  });
});

// --- buildComponentZones ---

describe('buildComponentZones', () => {
  it('separates connected and solo components into zones', () => {
    const connected = { id: 0, units: [{ dir: 'app/', layoutType: 'service' }], edges: [{}] };
    const solo = { id: 1, units: [{ dir: 'app/', layoutType: 'model' }], edges: [] };
    const zones = buildComponentZones([connected, solo]);
    assert.equal(zones.length, 2);
    const connZone = zones.find(z => z.id === 0);
    const soloZone = zones.find(z => z.id === 0.5);
    assert.ok(connZone);
    assert.ok(soloZone);
  });

  it('groups by zone type', () => {
    const backend = { units: [{ dir: 'app/', layoutType: 'service' }], edges: [] };
    const frontend = { units: [{ dir: 'frontend/js', layoutType: 'component' }], edges: [] };
    const zones = buildComponentZones([backend, frontend]);
    assert.equal(zones.length, 2);
    // Zone IDs: backend solo = 0.5, frontend solo = 1.5
    assert.ok(zones.some(z => z.id === 0.5));
    assert.ok(zones.some(z => z.id === 1.5));
  });
});

// --- measureZone ---

describe('measureZone', () => {
  it('computes zone width as max component width', () => {
    const zone = {
      components: [
        { w: 200, h: 100 },
        { w: 300, h: 150 }
      ],
      w: 0, h: 0
    };
    measureZone(zone);
    assert.equal(zone.w, 300);
  });

  it('computes zone height as sum of component heights plus gaps', () => {
    const zone = {
      components: [
        { w: 200, h: 100 },
        { w: 300, h: 150 }
      ],
      w: 0, h: 0
    };
    measureZone(zone);
    // 100 + 120 (gap) + 150 = 370
    assert.equal(zone.h, 100 + 120 + 150);
  });
});

// --- compareLayoutComponents ---

describe('compareLayoutComponents', () => {
  it('sorts by zone first', () => {
    const backend = { units: [{ dir: 'app/', layoutType: 'service', primaryId: 'a' }], edges: [] };
    const frontend = { units: [{ dir: 'frontend/js', layoutType: 'component', primaryId: 'b' }], edges: [] };
    assert.ok(compareLayoutComponents(backend, frontend) < 0);
    assert.ok(compareLayoutComponents(frontend, backend) > 0);
  });

  it('sorts by unit count when same zone', () => {
    const big = { units: [
      { dir: 'app/', layoutType: 'service', primaryId: 'a' },
      { dir: 'app/', layoutType: 'service', primaryId: 'b' }
    ], edges: [{}] };
    const small = { units: [{ dir: 'app/', layoutType: 'service', primaryId: 'c' }], edges: [] };
    assert.ok(compareLayoutComponents(big, small) < 0); // bigger first
  });

  it('sorts alphabetically as tiebreaker', () => {
    const a = { units: [{ dir: 'app/', layoutType: 'service', primaryId: 'alpha' }], edges: [] };
    const b = { units: [{ dir: 'app/', layoutType: 'service', primaryId: 'beta' }], edges: [] };
    assert.ok(compareLayoutComponents(a, b) < 0);
  });
});

// --- primaryIdForUnit / componentPrimaryId ---

describe('primaryIdForUnit', () => {
  it('returns the primaryId field', () => {
    assert.equal(primaryIdForUnit({ primaryId: 'foo' }), 'foo');
  });

  it('returns empty string when missing', () => {
    assert.equal(primaryIdForUnit({}), '');
  });
});

describe('componentPrimaryId', () => {
  it('returns the alphabetically first unit ID', () => {
    const comp = { units: [{ primaryId: 'zebra' }, { primaryId: 'alpha' }] };
    assert.equal(componentPrimaryId(comp), 'alpha');
  });
});
