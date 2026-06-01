# DiffMapper

Visual PR/diff review tool - generates spatial HTML canvases from git diffs. Cards for each changed file, color-coded by status, with connection lines showing relationships. Draggable canvas layout.

## Origin

Luke builds Obsidian JSON Canvas files to review PRs - cards per file with summaries, arrows showing flow. Valuable but slow to build manually. This tool automates that.

## Architecture

```
git diff → Parser (deterministic) → JSON → [Agent enrichment] → Renderer (deterministic) → HTML
```

**Ruby gem** with CLI. No framework. The tool is fully deterministic - LLM intelligence lives outside it, in an agent skill.

### Parser (`diffmapper parse`)

- Splits raw git diff into per-file data
- `DiffParser` - extracts paths, status (new/modified/deleted/renamed), line counts, raw hunks
- `FileClassifier` - regex on paths → type (model, controller, service, component, spec, config, styles, migration, job, other)
- `ConnectionDetector` - matches specs to source files by path convention (Rails `spec/` → `app/`, JS `.test.js` → `.js`), including collapsed nested specs (`spec/services/foo/foo_spec.rb` → `app/services/foo.rb`)

### Renderer (`diffmapper render`)

- Takes JSON, produces self-contained HTML file via ERB template
- Uses **dagre** (CDN) for directed graph layout within each connected component
- Test pairs (source+spec) treated as single wide nodes - dagre positions them, renderer places spec to the right of source
- Zone packing arranges connected components and solo files across the canvas
- Draggable cards, SVG connection lines, expandable details
- Layout tuning panel for adjusting dagre settings live (nodesep, ranksep, edgesep, zoneGap)
- Top bar with title, stats, collapsible context description
- Tokyo Night color scheme

### CLI

```bash
diffmapper master...feature                  # Default: preview (parse + render → stdout HTML)
diffmapper parse master...feature            # Save JSON to _diffmapper/data/, print path
diffmapper parse master...feature --stdout   # Output JSON to stdout (for piping)
diffmapper enrich data.json context --summary "..."  # Enrich in-place
diffmapper enrich data.json file <id> --summary "..." --detail "label" "desc"
diffmapper enrich data.json connection <from> <to> --label calls --type calls
diffmapper render data.json                  # Save HTML to _diffmapper/, print path
diffmapper render data.json --stdout         # Output HTML to stdout
cat diff.patch | diffmapper                  # Piped input works too
```

Auto-detects branch name, base, generates title (strips ticket prefixes like `PLS-1519`).

Workspace: files go to `_diffmapper/` by default. Override with `.diffmapper.yml`:
```yaml
output_dir: _luke/code-reviews
```

## JSON Schema

```jsonc
{
  "meta": {
    "title": "Hide include trial on primary reactivation",
    "branch": "PLS-1519-hide-include-trial-on-primary-reactivation",
    "base": "master",
    "generated_at": "2026-05-12T...",
    "stats": { "files": 13, "additions": 147, "deletions": 12 }
  },
  "context": {
    "summary": "Short summary",          // LLM-provided
    "description": "Longer description"  // LLM-provided
  },
  "files": [
    {
      "id": "archiver",
      "path": "app/services/tasks/archiver.rb",
      "status": "modified",              // new|modified|deleted|renamed
      "type": "service",                 // model|controller|service|component|spec|config|styles|migration|job|other
      "additions": 17,
      "deletions": 1,
      "hunks": "@@ ...",                 // raw diff - for LLM to analyze, renderer ignores
      "summary": "...",                  // LLM-provided
      "details": [                       // LLM-provided
        { "label": "method name", "description": "what it does" }
      ],
      "annotations": [                   // LLM-provided
        { "type": "note|question", "text": "..." }
      ]
    }
  ],
  "connections": [
    {
      "from": "archiver_spec",
      "to": "archiver",
      "label": "tests",
      "type": "test"                     // test|calls|renders|passes_prop|styles
    }
  ]
}
```

Parser fills in everything except LLM-provided fields. Those are optional - the renderer works without them (you just get cards with paths and line counts).

## LLM Enrichment: Agent Skill Approach

The LLM enrichment step lives **outside** the tool, as an agent skill. The tool stays fully deterministic. The agent is the intelligence.

### Flow

1. `diffmapper parse master...branch` → saves to `_diffmapper/data/<branch>.json`, prints path
2. Agent reads JSON, analyzes hunks
3. Agent runs `diffmapper enrich` commands to add summaries/details/connections/annotations in-place
4. `diffmapper render _diffmapper/data/<branch>.json` → saves to `_diffmapper/<branch>.html`, prints path
5. `open <path>`

### Why JSON, not HTML enrichment

- Hunks (raw diff content) live in the JSON - that's what the agent reads to understand changes. The HTML doesn't include them.
- JSON is small and structured - easy for the agent to read/modify. HTML is 15-20KB of templates/CSS/JS noise.
- Clear schema contract - agent knows exactly what to fill in. HTML editing is fragile.
- The user never sees or thinks about JSON files. The skill handles it invisibly.

## Testing

- **RSpec** for all Ruby code (parser, renderer, CLI)
- **Capybara + Cuprite** for browser tests of generated HTML
- Fixtures in `spec/fixtures/diffs/`
- Browser specs cover: no overlapping cards, connected files layered top-to-bottom, test pairs horizontal, tuner panel presence

## Prototype

`prototype-v1.html` - the original LLM-one-shot proof of concept that inspired this tool. Kept for reference.

## Spatial Layout Algorithm

### How it works (dagre-based)

Layout is fully deterministic - same input always produces the same output.

**Step 1: Build layout units**
- Source+spec pairs become single wide nodes (source left, spec right with PAIR_GAP between)
- Unpaired files are their own units
- Each unit carries metadata: `primaryId`, `layoutType`, `dir`

**Step 2: Build layout edges**
- Non-test connections (`calls`, `passes_prop`, etc.) become directed edges between units
- Test connections are already encoded as rigid pairs, not edges

**Step 3: Group into connected components**
- Flood-fill on the edge graph to find connected components
- Each component gets its own dagre layout (isolated graphs don't interfere)

**Step 4: Dagre layout per component**
- Each component is fed to dagre as a directed graph
- dagre assigns ranks (vertical layers) and positions nodes to minimize edge crossings
- Settings: `rankdir: TB`, `nodesep: 120`, `ranksep: 120`, `edgesep: 120`
- Single-unit components skip dagre (just placed at 0,0)

**Step 5: Zone assignment**
- Components are grouped by type: backend (0), frontend (1), orphan-spec (2)
- Within each type, connected components and solo components are split into separate zones
- This prevents a wide connected graph from forcing narrow solo files into the same column

**Step 6: Zone packing**
- Zones are placed left-to-right in rows
- When a zone won't fit horizontally, it wraps to a new row
- `preferredLayoutWidth` uses `window.innerWidth` (min 1600) so zones can sit side by side
- `zoneGap` (default 120) controls spacing between zones and between stacked components

**Step 7: Connection lines**
- SVG connection lines drawn between card edges (not centers)

### Layout tuning panel
Fixed panel at bottom-left of canvas. Controls:
- **Node spacing** (`nodesep`) - horizontal gap between nodes in same rank
- **Rank spacing** (`ranksep`) - vertical gap between ranks
- **Edge spacing** (`edgesep`) - gap between parallel edges
- **Zone gap** (`zoneGap`) - space between zones and stacked components

Apply button re-runs layout. Copy Settings button copies current values as JSON for pasting back.

### Key files
- `lib/diffmapper/templates/canvas.html.erb` - all JS layout code (dagre integration, zone packing, tuner panel)
- `lib/diffmapper/renderer.rb` - `grouped_files_json` and `file_layout_data` provide metadata to JS
- `spec/browser/canvas_spec.rb` - browser tests for layout correctness
- `spec/support/browser_helper.rb` - `count_card_overlaps` and `card_positions` helpers

### ELK experiment (reverted)
- Tried replacing dagre with ELK.js for layered layout + orthogonal routed edges
- Initial layouts looked better and routed lines were much cleaner
- Main problem: ELK couples node placement and edge routing, which clashes with manual drag as a first-class interaction
- After drag, either cards snapped back to ELK-owned positions or routing had to fall back to a second non-ELK method
- Decision: revert to dagre as the baseline and revisit routing separately with an independent post-layout router

## Completed Features

- Expandable inline diffs (click "View diff" on any card)
- Directory clustering in sidebar file list
- Editable notes/annotations (Note and Question types)
- LLM-generated summaries, details, annotations (contenteditable)
- Open questions count in top bar (clickable → opens sidebar)
- Resolvable questions (mark as resolved, dims + strikethrough)
- Expand All Diffs toggle with re-layout
- Dagre-based spatial layout (replaced custom force simulation)
- Always-visible review sidebar with Files and Questions tabs (with counts)
- File review checkboxes (on card header + sidebar, synced)
- Sidebar file list with directory grouping, hover-to-show path, and progress counter
- Check all / Uncheck all button for bulk review marking
- File type filter pills in sidebar (hide/show cards by type)
- localStorage persistence (reviewed files, annotations, positions, sizes, filters)
- Clear Progress button to reset localStorage for current PR
- Connection line arrowheads
- Editable details sections (add/delete/rename from UI, persisted to localStorage)
- Always-present summary field with placeholder (editable even without LLM enrichment)
- localStorage persistence for summaries and details (edits survive page reload)
- Drag bugfix (cards no longer teleport when scrolled down)
- Agent enrichment skill (`~/.pi/agent/skills/diffmapper-review`)
- `diffmapper` symlinked to PATH (`~/bin/diffmapper`)
- ERB view spec connection detection (`_spec.rb` → `.html.erb`)
- A* grid-based edge router (8-direction, obstacle-aware, with lane spacing)
- Port spreading (multiple connections on same card side get distinct anchor points)
- Port ordering (slots sorted by opposite endpoint position to minimize crossings)
- Connection labels with background pills, placed at path midpoint, deconflicted
- Resizable cards (both axes, persisted to localStorage)
- Diff area expands with card, notes area gets extra space
- Click-to-copy filename in card headers
- Card header two-row layout (badge row + filename row)
- Toolbar button grouping with separators
- `diffmapper enrich` CLI subcommand (atomic in-place mutations, no JSON editing)
- Workspace file management (`_diffmapper/` dir, per-branch JSON/HTML, `.diffmapper.yml` config)
- Connection line color by type (test=pink, calls=blue, renders=green, passes_prop=orange, styles=purple)
- Focus mode on card hover/drag (connected lines highlighted, others dimmed)
- Colored arrowheads matching connection type
- Light/dark theme toggle (defaults to system preference, persists to localStorage)
- Zoom controls (Ctrl+scroll, +/− buttons, click percentage to reset, drag works at any zoom)
- Removed layout tuner panel and legend (dead UI)
- Drag performance optimizations (see below)
- JS extracted from ERB into `canvas.js` with 75 unit tests (Node.js)
- `simplifyPath` collinearity bug fixed (cross product check)

## Performance Enhancements (Connection Routing)

Baseline: 632ms per full redraw on 45-file/58-connection stress test.

### 1. requestAnimationFrame throttle
- Mousemove events during drag are coalesced to one redraw per frame (max 60fps)
- Without this, multiple mousemoves per frame each triggered a full redraw

### 2. Scoped rerouting during drag (`drawConnectionsForDrag`)
- Only reroutes edges connected to the dragged card (~3-5 paths instead of 58)
- Cached routes for unaffected edges are reused as-is
- Result: drag redraw dropped from 632ms to ~1ms (626x faster)

### 3. Coarser grid during drag
- Cell size tripled (3x) during drag = 9x fewer cells in the grid
- Reduces A* search space dramatically
- Full-resolution grid used on drop for final clean routes

### 4. A* iteration cap during drag
- `maxIter=2000` passed only during drag rerouting
- If path is too complex, falls back to straight line temporarily
- Full redraw on drop has no cap — always finds optimal path

### 5. Deferred full redraw on drop
- `setTimeout(() => drawConnections(), 10)` on mouseup
- Drop feels instant; full reroute happens in next frame
- User sees drag-quality routes for ~10ms, then clean routes appear

## Remaining Ideas

### Connection line routing performance (further)
- Full redraw still takes ~630ms on 45-file canvas (acceptable on load, not for interactive)
- Further ideas if needed:
  - Binary heap priority queue for A* (currently linear scan for open set)
  - Web Worker for background full reroute on drop
  - Incremental grid patching (only update moved card's cells)
  - Visibility graph instead of grid A* (fewer nodes for open spaces)

### Context files (not in diff)
- Agent can add files to the map that weren't changed in the PR
- Shown as grey cards (vs green/orange/red for changed files)
- Useful for "painting pictures" — showing how changed code relates to unchanged code
- Low priority

### Risk/blast radius indicators
- Agent can set a `risk` field on files during enrichment (`low`, `medium`, `high`)
- Show as a subtle icon/badge on card and in sidebar file list
- Absent = unassessed (no indicator shown)
- Design challenge: must not be confused with git status indicators (green/orange/red)
- Could use a different visual language: shield icon, text label, or separate axis entirely

### Other
- Difftastic integration for richer diff display
- Minimap for large PRs
- Extract layout JS from ERB into standalone module for unit testing
