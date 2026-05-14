# DiffMapper

Visual PR/diff review tool — generates spatial HTML canvases from git diffs. Cards for each changed file, color-coded by status, with connection lines showing relationships. Draggable canvas layout.

## Origin

Luke builds Obsidian JSON Canvas files to review PRs — cards per file with summaries, arrows showing flow. Valuable but slow to build manually. This tool automates that.

## Architecture

```
git diff → Parser (deterministic) → JSON → [Agent enrichment] → Renderer (deterministic) → HTML
```

**Ruby gem** with CLI. No framework. The tool is fully deterministic — LLM intelligence lives outside it, in an agent skill.

### Parser (`diffmapper parse`)

- Splits raw git diff into per-file data
- `DiffParser` — extracts paths, status (new/modified/deleted/renamed), line counts, raw hunks
- `FileClassifier` — regex on paths → type (model, controller, service, component, spec, config, styles, migration, job, other)
- `ConnectionDetector` — matches specs to source files by path convention (Rails `spec/` → `app/`, JS `.test.js` → `.js`), including collapsed nested specs (`spec/services/foo/foo_spec.rb` → `app/services/foo.rb`)

### Renderer (`diffmapper render`)

- Takes JSON, produces self-contained HTML file via ERB template
- Uses **dagre** (CDN) for directed graph layout within each connected component
- Test pairs (source+spec) treated as single wide nodes — dagre positions them, renderer places spec to the right of source
- Zone packing arranges connected components and solo files across the canvas
- Draggable cards, SVG connection lines, expandable details
- Layout tuning panel for adjusting dagre settings live (nodesep, ranksep, edgesep, zoneGap)
- Top bar with title, stats, collapsible context description
- Tokyo Night color scheme

### CLI

```bash
diffmapper master...feature                  # Default: preview (parse + render → HTML)
diffmapper parse master...feature            # Output base JSON
diffmapper render enriched.json              # Render JSON → HTML
cat diff.patch | diffmapper                  # Piped input works too
```

Auto-detects branch name, base, generates title (strips ticket prefixes like `PLS-1519`).

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
      "hunks": "@@ ...",                 // raw diff — for LLM to analyze, renderer ignores
      "summary": "...",                  // LLM-provided
      "details": [                       // LLM-provided
        { "label": "method name", "description": "what it does" }
      ],
      "annotations": [                   // LLM-provided
        { "type": "observation|question|concern", "text": "..." }
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

Parser fills in everything except LLM-provided fields. Those are optional — the renderer works without them (you just get cards with paths and line counts).

## LLM Enrichment: Agent Skill Approach

The LLM enrichment step lives **outside** the tool, as an agent skill. The tool stays fully deterministic. The agent is the intelligence.

### Flow

1. `diffmapper parse master...branch > /tmp/dm_base.json`
2. Agent reads JSON, analyzes hunks, enriches with summaries/details/connections/annotations
3. Agent writes enriched JSON to `/tmp/dm_enriched.json`
4. `diffmapper render /tmp/dm_enriched.json > /tmp/review.html`
5. `open /tmp/review.html`

### Why JSON, not HTML enrichment

- Hunks (raw diff content) live in the JSON — that's what the agent reads to understand changes. The HTML doesn't include them.
- JSON is small and structured — easy for the agent to read/modify. HTML is 15-20KB of templates/CSS/JS noise.
- Clear schema contract — agent knows exactly what to fill in. HTML editing is fragile.
- The user never sees or thinks about JSON files. The skill handles it invisibly.

## Testing

- **RSpec** for all Ruby code (parser, renderer, CLI)
- **Capybara + Cuprite** for browser tests of generated HTML
- Fixtures in `spec/fixtures/diffs/`
- Browser specs cover: no overlapping cards, connected files layered top-to-bottom, test pairs horizontal, tuner panel presence

## Prototype

`prototype-v1.html` — the original LLM-one-shot proof of concept that inspired this tool. Kept for reference.

## Spatial Layout Algorithm

### How it works (dagre-based)

Layout is fully deterministic — same input always produces the same output.

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

**Step 7: Cluster labels + connection lines**
- SVG connection lines drawn between card edges (not centers)

### Layout tuning panel
Fixed panel at bottom-left of canvas. Controls:
- **Node spacing** (`nodesep`) — horizontal gap between nodes in same rank
- **Rank spacing** (`ranksep`) — vertical gap between ranks
- **Edge spacing** (`edgesep`) — gap between parallel edges
- **Zone gap** (`zoneGap`) — space between zones and stacked components

Apply button re-runs layout. Copy Settings button copies current values as JSON for pasting back.

### Key files
- `lib/diffmapper/templates/canvas.html.erb` — all JS layout code (dagre integration, zone packing, cluster labels, tuner panel)
- `lib/diffmapper/renderer.rb` — `grouped_files_json` and `file_layout_data` provide metadata to JS
- `spec/browser/canvas_spec.rb` — browser tests for layout correctness
- `spec/support/browser_helper.rb` — `count_card_overlaps` and `card_positions` helpers

## Completed Features

- Expandable inline diffs (click "View diff" on any card)
- Directory clustering in sidebar file list
- Editable notes/annotations (Note and Question types)
- LLM-generated summaries, details, annotations (contenteditable)
- Open questions count in top bar (clickable → opens sidebar)
- Resolvable questions (mark as resolved, dims + strikethrough)
- Tidy Layout button re-runs layout
- Expand All Diffs toggle with re-layout
- Dagre-based spatial layout (replaced custom force simulation)
- Layout tuning panel (collapsible, collapsed by default)
- Always-visible review sidebar with Files and Questions tabs
- File review checkboxes (on card header + sidebar, synced)
- Sidebar file list with directory grouping, full path, and progress counter
- Check all / Uncheck all button for bulk review marking
- File type filter pills in sidebar (hide/show cards by type)
- localStorage persistence (reviewed files, annotations, positions, filters)
- Clear Progress button to reset localStorage for current PR
- Connection line arrowheads
- Drag bugfix (cards no longer teleport when scrolled down)
- Agent enrichment skill (`~/.pi/agent/skills/diffmapper-review`)
- `diffmapper` symlinked to PATH (`~/bin/diffmapper`)
- ERB view spec connection detection (`_spec.rb` → `.html.erb`)

## Remaining Ideas

### Pathfinding connection lines
- Lines currently draw straight between cards, going behind other cards
- Want "train tracks" style routing — lines path-find around obstacles
- Orthogonal routing (right angles) or spline routing that avoids card rects
- Could use a simple A* or visibility graph on card bounding boxes

### Zoom controls
- Ability to adjust zoom level of the canvas
- Could be CSS transform scale on the canvas container
- Needs to coordinate with scroll position and card interactions

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
