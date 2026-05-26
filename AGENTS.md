# DiffMapper Agent Guidelines

## What This Is

Ruby gem with CLI that generates self-contained interactive HTML canvases from git diffs. Cards for each changed file, color-coded connection lines showing relationships, draggable layout. Used for visual PR review.

Workflow: `diffmapper parse` → JSON → `diffmapper enrich` (agent adds summaries/connections) → `diffmapper render` → HTML.

Key files:
- `lib/diffmapper/templates/canvas.html.erb` — HTML/CSS template
- `lib/diffmapper/templates/canvas.js` — all client-side JS (router, layout, interactions)
- `lib/diffmapper/cli.rb` — CLI entry point
- `lib/diffmapper/enricher.rb` + `enrich_command.rb` — in-place JSON mutation commands
- `lib/diffmapper/workspace.rb` — file output path management
- `NOTES.md` — project memory (architecture, decisions, completed/remaining work)

## Patterns

- Use `Dry::Initializer` for all classes that take constructor arguments
- Keep rubocop happy, rubocop is my wise old friend. Don't disable cops inline — if it complains about method length or ABC complexity, refactor the code instead.
- JS lint should be happy too
- Prefer real objects over mocks/stubs in tests. Build actual data rather than stubbing interfaces.
- No dead code — cleanup is part of feature work, not a separate task. Remove unused functions, stale parameters, and commented-out code as you go.
- Keep `NOTES.md` updated as work completes. It serves as project memory across sessions. Move finished items to the completed section, update remaining ideas, document architectural decisions.
- Run the full test suite (`qrspec` + `node --test`) at logical milestones, not just the changed spec file.

## Testing

- **Ruby specs**: `qrspec` (Capybara + Cuprite for browser integration tests, RSpec for unit tests)
- **JS unit tests**: `node --test spec/js/*.js` — pure Node.js test runner, no extra tooling or build step. Tests live in `spec/js/` and cover the pure logic extracted into `lib/diffmapper/templates/canvas.js` (router, A*, grid, layout algorithms).
- JS unit tests for pure logic (pathfinding, grid construction, layout math), Capybara for integration (visual layout, drag behavior, DOM interactions).

## Output & Visual Testing

- `_diffmapper/` is the workspace directory for generated output (gitignored). Render HTML here to visually verify changes: `ruby bin/diffmapper render tmp/output_layout_data.json --stdout > _diffmapper/output_layout_data.html`
- `tmp/output_layout_data.json` is the standard test fixture (24 files, 23 connections). `tmp/stress_test.json` is the large fixture (45 files, 58 connections) for performance testing.
