# 67. The empty workspace is a centred hero with two breathing amber doors

Date: 2026-09-27

Status: Accepted. Amends DESIGN.md § Elevation & Depth with one named exception
(§ First-Run Halo). F1 § "The empty state" is rewritten to match.

## Context

Until now, a fresh install opened on:

- **A sidebar** with a muted sentence and two small `outline` buttons, *Add
  Project…* and *Import from Claude Code…*. They turned amber only on hover.
- **A main pane** showing the wordmark and "Select a project from the sidebar
  to see its sessions", which says nothing useful when there is no project to
  select.

So the only way forward on the first screen anyone sees was 28px tall, in a
256px column, in the least prominent style the app has. DESIGN.md § Empty Hero
already names the failure: "Not a grey sentence in the top-left".

On 2026-09-27 the user asked for the first-run buttons to be redesigned:

- the two should be the same size
- they should be amber, "or some glowing amber style to incite the user"
- they should probably move to the middle of the window

The user also noted that Import should cover both agents now that Codex is one
(F30).

Three rules stood in the way:

- **"Colour is spent, not applied"** and the One Amber Rule. These allow amber
  where the human must act. An empty workspace is the purest case: nothing else
  can happen until the human acts.
- **"No glows on resting surfaces"** (§ Elevation & Depth) bans a glow outright.
- **"Don't animate more than one thing at a time in a list."** It is about
  lists, but its spirit is that motion is scarce.

## Decision

1. **The empty state moves to the main pane.**
   - At zero projects the index route renders `FirstRunHero`:
     - the wordmark
     - **No projects yet**
     - one line: *Add any folder, or bring in the ones Claude Code or Codex
       already knows.*
     - two buttons, **Add Project…** and **Import from… ▾**
   - The sidebar keeps a muted *No projects yet.* and no buttons.
   - The collapsed rail keeps its single `FolderPlus`.
2. **Both buttons are solid amber at `lg`, in a two-track grid**, so they are
   one width.
   - Both are primary because neither is secondary: which door is right depends
     on whether an agent has already worked in the folder.
   - The user chose this over a primary with an outline beside it.
3. **Import is one door per agent.**
   - `list_import_candidates` takes an `agent`, which defaults to `'claude'`.
   - Codex's rows are the `cwd` of each rollout, counted per folder with
     sub-agent threads left out.
   - The same agent items appear in the header's `FolderPlus` menu and under
     the hero's *Import from…*.
   - An agent that is not installed is marked but stays enabled, because the
     dialog reads the store on disk and not the binary.
   - The add/import state, and the dialog itself, moved from the sidebar to a
     store and the app shell. The collapsed rail replaces the sidebar
     component, so a dialog mounted there did not exist while the rail showed.
4. **The First-Run Halo: the one glow, on this screen only.**
   - An amber `box-shadow` breathes on a 3s loop, on a layer behind each button.
   - The animation never restarts. Hovering or focusing a button fades only its
     own layer, so the two stay in phase.
   - Under `prefers-reduced-motion` the halo holds still at a resting glow.
   - DESIGN.md names it as the exception to the no-glow rule, and forbids
     copying it.
5. **No agent found** adds a muted line under the buttons that links to
   Settings → Agents. Adding a project stays enabled. This settles roadmap item
   7's "no `~/.claude/projects/`" empty state.

## Consequences

1. The first screen has a single focal point, and it is the right one.
2. A glow now exists in the design system. The rule that permits it is written
   to be hard to extend: a second glowing surface means superseding this ADR,
   not citing it.
3. **The hero's buttons use `data-testid`s the sidebar used to own**
   (`empty-add-project`, `empty-open-import`). A test that clicked
   `empty-open-import` now gets a menu, not the dialog.
4. `open-import` stays Claude's test id. Codex's is `open-import-codex`.
5. A Codex candidate list reads one line per rollout. That is slower than
   Claude's `read_dir` + `stat` on a large store, but it is still off the main
   thread (PERF-07) and still reads no transcript in full.
6. The guide's `first-run-empty` image is now the whole window, taken under
   reduced motion so the halo is at rest. `first-run-import-menu` and
   `first-run-import-codex` are new.
