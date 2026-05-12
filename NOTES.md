# DiffMapper

Visual PR/diff review tool that generates single-page HTML "canvases" from git diffs — spatial card layouts showing files, changes, relationships, and annotations.

## Origin

Luke builds Obsidian JSON Canvas files to review PRs — cards per file with summaries, grouped by category, with arrows showing flow between files. Valuable for understanding complex changes but slow to build manually. This tool automates that.

## Prototype v1

`prototype-v1.html` — generated against PR branch `codex/add-remove-option-for-unused-meters` in the Chargify repo (12 files, +424 −12).

### What's in it

- **Cards** for each changed file with summaries of what changed
- **Color coding**: green border = new file, orange = modified, red = deleted
- **File type badges**: model, controller, serializer, component, spec, config (secondary info, not the border color)
- **Connection lines** (dashed SVG) between related files with labels ("calls destroy", "onMeterRemoved", "tests")
- **Expandable method details** for complex files — collapsible per-method breakdowns
- **Draggable cards** — grab and rearrange on the canvas
- **Group labels** — "Backend", "Frontend Components", "Backend Specs", "Frontend Specs"
- **Context card** (blue) with PR summary, branch name, flow overview
- **Controls**: Reset Layout, Toggle Lines
- **Legend** in bottom-right corner

### How v1 was made

Entirely LLM-generated in one shot:
1. Fetched the branch, ran `git diff --stat` then full `git diff`
2. LLM analyzed all changes — categorized files, summarized each, identified method-level details, mapped relationships
3. LLM wrote the entire HTML file (cards, positions, connections, styles, drag JS)

### What worked

- The spatial layout immediately communicates structure better than a flat diff
- Grouping by backend/frontend/specs mirrors how you think about the changes
- Expandable method details handle complex files without overwhelming the overview
- Connection lines show the flow (route → controller → model, component prop drilling)
- Draggable cards let you refine the layout

### What needs work

- No annotation/note-taking on cards yet (button exists but not wired up)
- Connection lines have no arrowheads (directionality unclear)
- Layout is manually positioned per-card in the HTML (hardcoded `left`/`top` px values)
- Card heights vary with content, spacing isn't responsive to that
- No minimap for large PRs
- Entire thing is LLM-generated each time — slow and inconsistent

## Next direction: tool for LLMs

The goal is to split this into **deterministic template/renderer** + **LLM-provided analysis data**.

### What can be deterministic (no LLM needed)

- HTML/CSS/JS template (the renderer)
- File list, paths, new/modified/deleted status (from `git diff --stat`)
- File type classification (model/controller/spec/etc — pattern matching on paths)
- Line counts (+/−)
- Spec-to-source file mapping (predictable path conventions)
- Card layout algorithm (auto-position by category/group)
- Connection lines rendering
- Drag, toggle, reset UI

### What needs LLM

- Per-file change summaries (what changed and why it matters)
- Method-level breakdowns for complex files
- Relationship detection beyond spec↔source (e.g., "this controller calls this model method")
- Grouping suggestions beyond directory-based defaults
- The context/summary card content
- Annotations, questions, observations

### Architecture idea

```
git diff → parser (deterministic) → structured JSON → LLM enrichment → final JSON → HTML renderer (deterministic)
```

The LLM's job shrinks to: "given this structured diff data, add summaries and relationships." The renderer is a static template that takes JSON and builds the canvas. This makes output faster, more consistent, and the template can be iterated independently.
