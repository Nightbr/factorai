# Frontend (React 19 + TanStack)

## Layout

```
apps/desktop/src/
├── main.tsx
├── App.tsx                  # router boot
├── routes/
│   ├── __root.tsx           # shell layout
│   ├── index.tsx            # redirect → /projects/<lastOpened> or empty state
│   ├── projects.tsx         # all-projects view
│   ├── project.$id.tsx      # sessions list for one project
│   ├── session.$id.tsx      # main split view: terminal | side panel
│   ├── search.tsx           # global search
│   └── settings.tsx
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx     # top bar + sidebar | content | panel
│   │   ├── TopBar.tsx       # brand, session tabs, settings gear, panel toggle
│   │   ├── Sidebar.tsx      # projects, search input, status dots, new-session +
│   │   ├── PanelResizer.tsx # drag handle for the right panel
│   │   ├── PanelEmpty.tsx   # the one line a panel tab shows instead of a list
│   │   └── StatusBar.tsx
│   ├── sessions/
│   │   ├── SessionList.tsx
│   │   ├── SessionRow.tsx
│   │   └── EventLog.tsx     # JSONL turn viewer
│   ├── terminal/
│   │   ├── Terminal.tsx     # xterm host
│   │   └── TerminalToolbar.tsx
│   ├── files/
│   │   ├── FileTreePanel.tsx        # right panel: header + root node
│   │   ├── FileTreeNode.tsx         # one row, recursive, lazy list_dir
│   │   └── FileIcon.tsx             # icon-key → SVG (ADR-0006)
│   ├── settings/
│   │   ├── SettingsModal.tsx        # the shell, the nav and Save (F11)
│   │   └── ClaudeSection.tsx        # detected binary + the override field
│   ├── viewer/
│   │   ├── monaco.ts                # sole Monaco import site + theme
│   │   ├── FileView.tsx             # one file, read-only, host-agnostic
│   │   ├── FileViewerModal.tsx      # V0 host (tabs replace it later)
│   │   └── DiffView.tsx             # Monaco diff editor (F8, not built)
│   └── plans/
│       ├── ClaudeMdEditor.tsx
│       └── PlanList.tsx
├── store/
│   ├── projectsStore.ts
│   ├── sessionStore.ts      # active session + side-panel state
│   ├── terminalStore.ts     # open tabs (persisted) + live PTYs per session
│   └── prefsStore.ts        # user preferences, localStorage (ADR-0013)
├── hooks/
│   ├── useActiveProject.ts  # project the current route is about
│   ├── useFileViewer.ts     # ?file= &line= — what the viewer shows, and where
│   └── useSettingsModal.ts  # ?settings= — which settings section is open (F11)
├── lib/
│   ├── tauri.ts             # typed invoke + listen wrappers
│   ├── queryKeys.ts
│   ├── fileIcon.ts          # filename → icon key (pure)
│   ├── fileLinks.ts         # terminal text → an openable path (F19, pure + cache)
│   ├── settingsDraft.ts     # which sections hold an edit (F11, pure)
│   └── format.ts
└── styles/
    └── globals.css          # imports @factorai/ui/styles
```

## Routes

| Path                       | Component             | Notes                                       |
| -------------------------- | --------------------- | ------------------------------------------- |
| `/`                        | redirect              | → `/projects` or empty state                |
| `/projects`                | ProjectsView          | grid of project cards                       |
| `/projects/$id`            | ProjectView           | session list, opens last session by default |
| `/projects/$id/sessions/$sessionId` | SessionView  | terminal-only (header + xterm)              |
| `/search?q=...`            | SearchView            | global FTS; a hit opens its session         |
| `/settings`                | SettingsView          | theme, font, paths                          |

Hash history (same as factorai-v0) — no server-side routes needed.

## Layout pattern

`AppShell` is a column: a full-window top bar, then a row of sidebar,
route content, and the right-hand panel.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ◱ factorai [DEV]  (reserved: search, window controls)          [▣]   │  TopBar, 42px
├───────────────┬──────────────────────────────────┬───────────────────┤
│ [search]      │  Route content                   │ Files       ⇕ ⟳ ✕ │
│               │                                  │ ▾ factorai        │
│ Projects      │  session list, or terminal,      │   ▸ apps          │
│ ├ factorai  • │  or search results               │   ▸ specs         │
│ ├ heypearl    │                                  │     Cargo.toml    │
│ └ ...         │                                  │     README.md     │
│               │                                  │                   │
│ Indexing…     │                                  │                   │
└───────────────┴──────────────────────────────────┴───────────────────┘
   w-64                                              200–600px, draggable
```

## Starting a session

`useStartSession()` is the single entry point behind both new-session buttons
(the sidebar row's hover `+` and the project header's button): it calls
`start_session(projectId)` and navigates to the returned id. Nothing else is
needed to get a terminal — the session route mounts `Terminal`, which spawns
the PTY for whatever id is in the URL, so "new" and "resume" are one path. The
id is minted in Rust rather than by `crypto.randomUUID()` here, because the
reuse rule needs the filesystem; see ADR-0008 and F6.

Two presentation consequences, both because a new session has no `sessions`
row until Claude writes its transcript:

- `ProjectView` unions `list_sessions` with the live terminals for that
  project that have no row yet, rendering them first as `New session`. It
  waits for `sessionsQ.data` before deciding — treating "not loaded" as "not
  indexed" would flash every live session as new.
- `SessionView`'s header names the session by its indexed title, falling back
  to `New session` when there is no row and to the short id when a row has no
  derived title. The full uuid moved to the element's `title`.

The sidebar's per-project session count stays index-derived — it counts what's
on disk, not what's running.

The shell draws its own border on the sides and the bottom — the titlebar
caps the top — and **rounds the bottom corners on macOS only**, via `isMacOS()`
in `lib/platform.ts`. There the OS clips the window to its own radius, so the
curve lands on pixels it has already discarded. Linux clips nothing, an opaque
window keeps painting behind the curve, and the corner comes out as a wedge;
transparency fixes the geometry and exposes the compositor's shadow instead.
Q21 has the measurements and the rejected alternative.

The top bar spans the **full window width** deliberately: that's the shape
the custom titlebar needs when we drop the OS decorations (M5), so that
step adds buttons instead of restructuring the shell. The app's brand row
lives there rather than at the top of the sidebar.

Next to the wordmark, a **`DEV` badge** on development builds only —
`DevBadge` renders `null` unless `import.meta.env.DEV`, which a
`pnpm tauri build` bundle never is (it goes through `vite:build`). The
window title gains the same marker, in `setup()` under
`#[cfg(debug_assertions)]`: `factorai DEV`. Both exist because a release
factorai runs beside the dev one all day with live Claude sessions in it,
and the pair must be told apart from the window switcher as readily as from
the screen. The badge is violet — a hue reserved for exactly this, so it
can't be read as session status or as the amber brand. It is shaped like
F18's ref chips (`CHIP_SHAPE` plus a `--dev` tint), not as a solid block:
the hue is what distinguishes the window, so the shape can be the app's
ordinary one. `scripts/qa/`
matches on both markers to make sure an agent's screenshots and kills land
on the dev build; see `scripts/qa/README.md`.

The right panel holds the **project file tree** (F12) and lives in the
shell, not a route, so it survives navigating from a project into one of
its sessions. Which project it shows follows the route params.
`PanelResizer` is a plain pointer-capture drag on the panel's left edge —
no `react-resizable-panels` dependency. Resizing on the session route
shrinks xterm, and the terminal's `ResizeObserver` → `fit()` → `onResize`
chain pushes the new geometry to the PTY.

The file *preview / diff* panel (F7, F8) is a separate surface, opened from
"open file" links, and is not built yet.

## State stores (Zustand)

### Projects and sessions: no store

Both are **server state**, so they live in TanStack Query under
`queryKeys.projects()` / `queryKeys.sessions(projectId)` rather than in a
`projectsStore` this spec used to describe. Which project the route is about is
a route param, read through `useActiveProject`.

Freshness is event-driven. `useSessionsSync`, mounted once in `__root.tsx`,
listens for `sessions:changed` and invalidates that project's session list plus
`projects` — whose `sessionCount` and `lastSessionAt` are aggregates over the
same rows, and the sidebar's default sort. It is mounted at the root and not per
route on purpose: the lists that most need the refetch are the ones *not*
currently mounted and polling.

The `refetchInterval`s the sidebar sets (2s projects, 5s sessions) are the net
under a missed event, not the mechanism. They are also only half a net — they
cover an expanded project row and nothing else, which is why the tab strip's
titles went stale for a whole session before the listener existed.

### `sessionStore`

```ts
type SessionState = {
  activeId: string | null;
  page: SessionPage | null;         // current JSONL window
  sidePanel:
    | { kind: 'closed' }
    | { kind: 'file'; path: string }
    | { kind: 'diff'; path: string; original: string; modified: string }
    | { kind: 'plan'; path: string };
  open: (id: string) => Promise<void>;
  openFile: (path: string) => void;
  openDiff: (path: string, a: string, b: string) => void;
  closeSidePanel: () => void;
};
```

### `terminalStore`

Two fields with different jobs, and keeping them apart is load-bearing (F16).

```ts
type TerminalState = {
  tabs: Array<{ sessionId: string; projectId: string }>;  // persisted, tab order
  bySession: Record<string, LiveTerminal>;                // NOT persisted
  attach / detach / reorder / setStatus / removeByTerminal: …
};
```

`tabs` is **what you have open**; `bySession` is **what is running**. A tab
outlives its process — it survives an exit and a quit, and only closing removes
it — so `tabs` is always a superset of `bySession`'s keys. Nine surfaces read
`bySession` to mean "running" and go on meaning exactly that; F16 §
"Where 'open' shows outside the strip" lists which of them moved to the derived
open record and which did not.

Persisted as `factorai.terminals` v1, `partialize`d down to `tabs` alone. A
`terminalId` from a previous run names nothing, and a persisted status would be a
claim about a process that is gone; restored entries come back with neither, which
is what makes them `stopped` by construction rather than by a rule someone has to
remember.

When the user navigates to a session that already has a live PTY, the Terminal
component reattaches by listening to its `terminal:data` event and writing to
xterm. On unmount we do **not** kill the PTY — only an explicit close does.

### `panelStore`

The right-hand panel (F12 file tree). Built — see
`store/panelStore.ts`.

```ts
type PanelState = {
  open: boolean;                                    // persisted
  width: number;                                    // persisted, 200–600
  expandedByProject: Record<string, Set<string>>;   // NOT persisted
  selectedPath: string | null;
  toggle / setOpen / setWidth: …
  toggleExpanded / seedRoot / collapseAll: (projectId, …) => void;
};
```

`open`, `width` and the tab round-trip through zustand's `persist` middleware
into localStorage, so browser-only dev and the Playwright suite exercise the same
code path.

**They do not move to `prefsStore`** — corrected 2026-08-17. This used to say they
migrate "when that lands", and F11 drew the line differently: a width you *dragged*
is layout, not something you set in a settings page (ADR-0013). What leaves is
`diffInline`, which is a genuine preference that was parked here.

Expanded paths are per project and deliberately not persisted: a path that
existed last session may be gone, and rehydrating a tree of stale paths is
worse than starting collapsed. `seedRoot` expands the root the *first* time
a project's tree renders, distinguishing "never seeded" (`undefined`) from
"collapsed everything" (empty set) so collapse-all isn't undone.

**F21 re-keys `expandedByProject` to the checkout**, not the project. The map
holds *absolute* paths, so a project with more than one worktree currently seeds
one tree with paths belonging to another — every one of which is missing. The
project id stops being enough as an identity the moment the panel's root can move
without the route changing, and the checkout path is the thing the paths inside
are actually relative to. Same "never seeded" vs "collapsed everything"
distinction, one key deeper.

### Which checkout the panel is rooted at (F21)

Not a store of its own. The resolution is a hook over three sources, first match
wins — `session_worktrees` for this session (re-validated against
`git_worktrees`), the checkout containing `sessions.cwd`, then
`projects.real_path`. See `05-features.md` F21 for why in that order and what
happens when the first two go stale.

The **live** part lands in `terminalStore` beside `ideIssues`, from the
`session:worktree` event: `worktreeBySession: Record<string, LiveWorktree>` —
path and branch — **not persisted**, exactly as `bySession` isn't. The branch
rides along rather than being looked up, so the header badge renders from one
event instead of the badge and the panel resolving it separately and briefly
disagreeing. Rust already wrote the row before
emitting, so the durable copy is in SQLite — arriving on `SessionSummary.worktree`
— and this is only the in-flight value that saves a refetch.

**The resolution itself is a hook, not a store**: `useActiveCheckout`, three steps
with first-match-wins, and every consumer reads `root` from it rather than from
`useActiveProject`. One place decides which tree the app is showing. A signal for a session in another project is dropped on
arrival — the route owns which project the panel shows, and `FileTreePanel`'s
"which project it shows follows the route" is not up for negotiation by an event.


### `prefsStore`

**User preferences only**, persisted to localStorage as `factorai.prefs` — the
things a human chose in the settings modal, as opposed to layout they dragged
(ADR-0013, F11).

Rewritten 2026-08-17. The earlier key list was written before any of it existed and
has not survived contact: `theme` is deferred to its own roadmap item (nothing sets
`data-theme` yet), `fontFamily`/`fontSize` were never specced anywhere else,
`lastProjectId` is not a preference and no feature asked for it, and the two widths
stay in their layout stores.

Keys, as shipped with F11:

- `diffInline: boolean` — default `false`. The diff viewer's default, arriving
  from `panelStore` with a one-time read-across.
- `confirmCloseSession: boolean` — default `true`. Ask before closing a working
  session with the `×`.
- `confirmCloseMiddleClick: boolean` — default `true`. The same question for a
  middle-click, which is its own switch because a wheel-click has no aim to it.
- `frontmatterOpen: boolean` — default `true`. Whether a markdown document's
  frontmatter panel starts expanded (F7). Same reasoning as `restoreTabs`: the
  fields were already on screen before the panel existed, so the switch arriving
  after the behaviour must not take information away. It decides the state a
  document *opens* in — the panel's own chevron is a peek and is deliberately not
  written back, unlike `diffInline`.
- `restoreTabs: boolean` — default `true`, and that default is settled by history
  rather than taste: F16's restore shipped unconditionally, so the switch must not
  change what people already have.

The store exposes `applyPrefs(next)` — one write for a whole Save, so a
half-applied save cannot exist — plus `setDiffInline`, because the diff footer's
own toggle sets the same value.

**The `diffInline` read-across is its own module** (`store/diffInlineHandover.ts`),
imported by *both* stores. Both hydrate at import time and `panelStore`'s v3
migration rewrites `factorai.panel` without the key, so which one touches storage
first is decided by module order — a snapshot taken lazily inside `prefsStore`
would read the value or read nothing depending on which file Vite loaded first.
Thirty lines to protect one boolean, because silently resetting a choice somebody
made is not the kind of small that is fine.

Settings Rust must read are **not** here; they go through `get_setting` /
`set_setting` into the SQLite `settings` table.

## TanStack Query usage

Pure read-only queries are cached via Query; writes invalidate keys.

```ts
const projectsKey = ['projects'] as const;
const sessionsKey = (projectId: string) => ['sessions', projectId] as const;
const sessionPageKey = (sessionId: string, offset: number, limit: number) =>
  ['session', sessionId, offset, limit] as const;
const searchKey = (q: string, projectId: string | null) => ['search', q, projectId] as const;
```

Terminal output is **not** TanStack Query data — it streams via events
straight to xterm, bypassing React reconciliation.

`path_kinds` (F19) is the one file-system read that is **not** a Query either.
It is called from inside xterm's `provideLinks` callback, on mouse move, outside
React entirely — so it gets a plain `Map` cache in `lib/fileLinks.ts` rather than
a query key. Nothing renders from it: the answer decides whether a range becomes
a link, and xterm owns that painting.

## Search params on the root route

`?file=` is the open path (F7). `&diff=` turns it into a diff (F13). **`&line=`
and `&col=` place the cursor** (F19) — validated on the root route with the
other two, so a hand-edited URL cannot reach Monaco with a negative line, and
dropped whenever `file` is absent, since a position in no file is not a state.

Both position params are 1-based, matching what `foo.ts:42:7` means to everyone
who writes it and what Monaco's `setPosition` expects.

**`?settings=claude|editor|confirmations|sessions`** opens the settings modal at
one section (F11), validated the same way — a section nobody has built is not a
section, so `?settings=appearance` opens nothing. It is a modal *and* a URL
deliberately: the URL is where deep links, reload survival and browser-back-closes
come from, and none of them needed a route. `hooks/useSettingsModal.ts` reads and
writes it, exactly as `useFileViewer` does for `?file=`.

Both modals are mounted on the **root** route, beside `QuitConfirm`, because both
are app-level rather than route-level — which is also what lets a hook update the
param without knowing which route is showing.

## Terminal component

```tsx
function Terminal({ sessionId }: { sessionId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const terminalId = useTerminalStore(s => s.terminals[sessionId]);

  // bootstrap xterm once
  useEffect(() => {
    const term = new XTerm({ allowProposedApi: true, /* theme, font ... */ });
    term.loadAddon(new FitAddon());
    term.loadAddon(new WebglAddon());
    term.loadAddon(new SearchAddon());
    term.loadAddon(new WebLinksAddon(/* OSC 8 handler */));
    term.open(ref.current!);
    termRef.current = term;
    return () => term.dispose();
  }, []);

  // spawn or attach
  useEffect(() => {
    let unlistenData: (() => void) | undefined;
    (async () => {
      const id = terminalId ?? await invoke<TerminalId>('terminal_spawn', { /* ... */ });
      unlistenData = await listen<{ id: string; bytes: string }>('terminal:data', e => {
        if (e.payload.id === id) {
          termRef.current?.write(base64ToUint8(e.payload.bytes));
        }
      });
    })();
    return () => unlistenData?.();
  }, [sessionId, terminalId]);

  // forward input
  useEffect(() => {
    const t = termRef.current;
    if (!t || !terminalId) return;
    const sub = t.onData(d => invoke('terminal_write', { id: terminalId, data: d }));
    return () => sub.dispose();
  }, [terminalId]);

  return <div ref={ref} className="h-full w-full" />;
}
```

Resize: a `ResizeObserver` calls `FitAddon.fit()` then sends the new
`cols`/`rows` to `terminal_resize`.

## File viewer & diff

**Monaco**, not CodeMirror 6 — see ADR-0007 for why the spec's original
choice was superseded (the diff editor F8 needs, mainly).

`components/viewer/` holds all of it, and nothing outside that directory
imports Monaco:

- `monaco.ts` — the only Monaco import site. Pulls `editor.api` plus
  `basic-languages/monaco.contribution`, which is every Monarch grammar with
  **no** web-worker requirement (the workers back language services, i.e.
  IntelliSense, which a read-only viewer doesn't want). Also owns the
  `factorai-dark` theme and language resolution via Monaco's own registry.
- `FileView.tsx` — one file, read-only, modal-agnostic. Runs the `read_file`
  query, renders the editor / binary card / empty state, and the footer.
- `FileViewerModal.tsx` — V0 host. `React.lazy`-loads `FileView`, so Monaco
  lands in a chunk fetched on first open and the initial bundle is unchanged.

`vite.config.ts` lists both Monaco entry points in `optimizeDeps.include`;
without that, Vite discovers them the first time a file is opened and reloads
the page mid-interaction.

For MVP the viewer is read-only, with no edit affordance at all — editing
arrives with F9's CLAUDE.md editor. "Accept / reject" of diffs ships in v2
alongside the MCP/IDE emulator.

## Session content rendering

There is **no** chronological JSONL viewer. M1's `EventLog` / `EventCard`
were removed in `c6374d6` (mounting 100+ React cards in one paint froze the
Linux webview); the session view is terminal-only (see 05-features.md F3).

The only surface that renders session content is the **search results**
view (`/search`, F4). It lists `search_sessions` hits, each a small row: the
project's icon and name, the session title, the matched role, and a `snippet()`
excerpt (highlighted match). Rows are bounded (≤ `limit`, default 200) so no
virtualization is needed. Click a row → navigate to that session (opens its
terminal). No "fork" action — fork was cut from the MVP.

## @factorai/ui components used

Re-exported from `packages/ui` (Radix-based, shadcn shape):

`Button`, `Input`, `Textarea`, `Label`, `Dialog`, `DropdownMenu`, `Tabs`,
`ScrollArea`, `Separator`, `Tooltip`, `Card`, `Badge`, `Select`, `Avatar`.

Same exact list as factorai-v0. No new primitives needed for MVP.

## Theming

Tailwind v4 with CSS variables for colors (light + dark). Theme is applied
by toggling `data-theme="dark"` on `<html>`. Initial value from
`prefsStore.theme` (default `system`).

xterm theme follows the same palette via a tiny mapper in
`components/terminal/themes.ts`.
