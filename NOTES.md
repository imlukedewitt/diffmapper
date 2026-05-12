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
- JS-based layout: cards rendered hidden, measured, then positioned absolutely
- Paired source+spec files placed side by side
- Draggable cards, SVG connection lines, expandable details
- Top bar with title, stats, collapsible context description
- Tokyo Night color scheme

### CLI

```bash
diffmapper master...feature                  # Default: preview (parse + render → HTML)
diffmapper parse master...feature            # Output base JSON
diffmapper render enriched.json              # Render enriched JSON → HTML
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
- **Capybara + Cuprite** for browser tests of generated HTML (planned)
- Fixtures in `spec/fixtures/diffs/`

## Prototype

`prototype-v1.html` — the original LLM-one-shot proof of concept that inspired this tool. Kept for reference.

## Feature Ideas

### ~~Expandable inline diffs~~ ✅
Done. Click "View diff" on any card. Color-coded +/- lines, scrollable within the card.

### ~~Directory clustering~~ ✅
Done. Cards are grouped by directory with cluster labels (e.g., "Controllers / Team Projects", "Services / Tasks").

### ~~Notes / annotations (editable)~~ ✅
Done. Each card has "+ Add note" button. Notes can be typed as Note, Question, or Concern. LLM-generated summaries, details, and annotations are also contenteditable.

### ~~Open questions in summary~~ ✅
Done. Question and concern counts appear in the top bar. Updates live as notes are added/deleted.

### ~~Hunk headers on cards~~ ✅
Done. Merged into `details` field — parser extracts them, LLM can enrich/replace with better descriptions.

### ~~Re-layout after resize~~ ✅
Done. "Tidy Layout" button re-runs the layout algorithm.

### ~~Expand all diffs + re-layout~~ ✅
Done. "Expand All Diffs" button toggles all diffs open/closed and triggers tidy layout.

### Remaining ideas
- Difftastic integration for richer diff display
- localStorage persistence for notes and card positions
- Minimap for large PRs
- Connection line arrowheads for directionality
