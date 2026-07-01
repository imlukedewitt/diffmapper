---
name: diffmapper-review
description: Generate a visual PR review canvas using diffmapper. Parses a git diff into JSON, enriches it with summaries/connections/annotations, then renders an interactive HTML canvas. Use when the user asks to review a PR, diff, or branch visually, or says "diffmapper", "visual review", "canvas review".
---

# DiffMapper Visual Review

Generate an interactive visual canvas for reviewing a PR or branch diff.

## Workflow

### 1. Parse the diff

```bash
cd <repo_directory>
diffmapper parse <base>...<branch>
```

- Use `master...origin/<branch>` or `main...origin/<branch>` depending on the repo's default branch.
- If the user provides a diff ref directly, use it as-is.
- Make sure the branch is `git fetch`
- The command saves JSON to `_diffmapper/data/<branch>.json` and prints the path.
- Subsequent commands accept the branch name directly (no need to capture the path).

### 2. Read and understand the diff

Read the JSON file (`_diffmapper/data/<branch>.json`). Study the hunks for each file to understand:
- What each file change does (purpose, not line-by-line)
- How files relate to each other (calls, renders, passes data, styles)
- What a reviewer should pay attention to
- Review the source code and surrounding files for context as needed so you have a thorough understanding of what was changed and why

### 3. Enrich via CLI

Use `diffmapper enrich` commands to add context, summaries, details, annotations, and connections. All commands mutate the JSON file in-place.

**Context:**
```bash
diffmapper enrich <branch> context --summary "One-line summary of the PR"
diffmapper enrich <branch> context --description "2-3 sentence description of what and why."
```

**Per-file enrichment:**
```bash
diffmapper enrich <branch> file <file_id> --summary "Purpose of this file's change"
diffmapper enrich <branch> file <file_id> --detail "updated #method_name" "What changed"
diffmapper enrich <branch> file <file_id> --annotation question "Is this safe?"
diffmapper enrich <branch> file <file_id> --annotation note "Uses legacy API intentionally"
diffmapper enrich <branch> file <file_id> --type service
```

**Connections:**
```bash
diffmapper enrich <branch> connection <from_id> <to_id> --label calls --type calls
```

More misc examples:
```bash
diffmapper enrich <branch> context --summary "Add widget support"
diffmapper enrich <branch> file widget --summary "Core widget model"
diffmapper enrich <branch> file widget --detail "new #initialize" "Sets defaults from config"
diffmapper enrich <branch> connection widget widget_service --label calls --type calls
```

### 4. Render and open

```bash
open $(diffmapper render <branch>)
```

The command saves HTML to `_diffmapper/<branch>.html` (or custom path from `.diffmapper.yml`) and prints the path.

**Custom output location:** If a `.diffmapper.yml` exists in the repo root:
```yaml
output_dir: _luke/code-reviews
```
HTML will be saved there instead.

## Enrichment Guidelines

### Summaries
- The summary answers "what is this file and how does it fit into the picture?"
- Focus on the file's role/purpose in the system, not what lines changed.
- Bad: "Adds 20 lines to copy_clipboard.js"
- Bad: "Updated to support new widget config option"
- Good: "Clipboard utility — handles copy-to-clipboard for all icon buttons"
- Good: "CLI entry point that dispatches subcommands to their handler classes"
- Be brief in your writing style

### Details
- Label = action + target: "new #method_name", "updated #perform", "refactored #build_query"
- Description = short summary of what changed. Include why it matters only if not obvious.
- Suggested actions: new, updated, removed, refactored, renamed, moved (use others if they fit better)
- The reviewer can add/edit/delete details from the canvas.

### Connections
- Only add connections between files that are **both in the diff**.
- Types: `calls` (A invokes B), `renders` (A renders B), `passes_prop` (A passes data to B), `styles` (A styles B)
- **Prioritize frontend prop-threading chains.** These are the hardest to trace from a raw diff — a prop passed 3 components deep across separate files is invisible without explicit connections. Trace every `renders` and `passes_prop` relationship between React/view files in the diff.
- Duplicate connections (same from/to/type) are skipped automatically.

### Annotations
- Use sparingly. Only for things that genuinely deserve reviewer attention.
- `question`: something that seems off, risky, or unclear.
- `note`: context that helps understand the change.
- Don't annotate obvious things.

### File types
The parser may misclassify some files as `other`. You can correct the `type` field to: `model`, `controller`, `service`, `component`, `spec`, `config`, `styles`, `migration`, `job`, `other`.

## Notes

- The rendered HTML uses localStorage keyed by branch name — review progress persists across re-renders.
- For large PRs (20+ files), prioritize enriching the most important/complex files. Simple config changes can get just a summary.
- File IDs are in the parsed JSON — check them before enriching. They are derived from filenames (lowercase, special chars replaced with underscores).
- JSON files are saved per-branch in `_diffmapper/data/` so switching between reviews doesn't lose work.
