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
│   │   ├── AppShell.tsx     # sidebar + main split
│   │   ├── Sidebar.tsx      # projects, search input, status dots
│   │   └── StatusBar.tsx
│   ├── sessions/
│   │   ├── SessionList.tsx
│   │   ├── SessionRow.tsx
│   │   └── EventLog.tsx     # JSONL turn viewer
│   ├── terminal/
│   │   ├── Terminal.tsx     # xterm host
│   │   └── TerminalToolbar.tsx
│   ├── viewer/
│   │   ├── FilePreview.tsx          # CodeMirror read-only
│   │   ├── DiffView.tsx             # CodeMirror @merge inline/side-by-side
│   │   └── ViewerToolbar.tsx
│   └── plans/
│       ├── ClaudeMdEditor.tsx
│       └── PlanList.tsx
├── store/
│   ├── projectsStore.ts
│   ├── sessionStore.ts      # active session + side-panel state
│   ├── terminalStore.ts     # terminal handle ↔ session mapping
│   └── prefsStore.ts        # persisted via tauri-plugin-store
├── lib/
│   ├── tauri.ts             # typed invoke + listen wrappers
│   ├── queryKeys.ts
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

```
┌────────────────────────────────────────────────────────────────────┐
│  Sidebar (220px)         │   Main                                  │
│                          │  ┌──────────────────────────────────┐   │
│  Projects                │  │ Terminal (xterm)                 │   │
│  ├ factorai            • │  │                                  │   │
│  ├ heypearl              │  ├──────────────────────────────────┤   │
│  └ ...                   │  │ Side panel: viewer | diff | plan │   │
│                          │  │                                  │   │
│  Sessions (current proj) │  │ (collapsible / resizable)        │   │
│  ┌ session-a    busy •   │  └──────────────────────────────────┘   │
│  └ session-b             │                                          │
│                          │                                          │
│  [search input]          │                                          │
└────────────────────────────────────────────────────────────────────┘
```

The side panel is toggled by the JSONL viewer's "open file" links, by
clicking a tool_use event that touched a file, or manually. Split via
panel-resizing primitives (probably a tiny custom hook + CSS grid; no need
to pull in `react-resizable-panels` for MVP).

## State stores (Zustand)

### `projectsStore`

```ts
type ProjectsState = {
  list: Project[];
  activeId: string | null;
  setActive: (id: string) => void;
  refresh: () => Promise<void>;
};
```

Subscribes to `sessions:changed` events and bumps a counter to refetch.

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

Owns the mapping of (sessionId → terminalId). When the user navigates to a
session that already has a live PTY, the Terminal component reattaches by
listening to its `terminal:data` event and writing to xterm. On unmount we
do **not** kill the PTY — only an explicit "close terminal" action does.

### `prefsStore`

Persisted via `tauri-plugin-store` (`prefs.json`). Keys:
- `theme`: 'system' | 'light' | 'dark'
- `diffMode`: 'inline' | 'split'
- `fontFamily`, `fontSize`
- `lastProjectId`
- `sidebarWidth`, `sidePanelWidth`

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

## File preview & diff

CodeMirror 6 host components live in `components/viewer/`. Language
selection uses `@codemirror/language-data` (lazy-loads extensions). For
diffs we use `@codemirror/merge` with the prefs-driven mode toggle.

For MVP both are read-only. "Accept / reject" of diffs ships in v2 alongside
the MCP/IDE emulator.

## Session content rendering

There is **no** chronological JSONL viewer. M1's `EventLog` / `EventCard`
were removed in `c6374d6` (mounting 100+ React cards in one paint froze the
Linux webview); the session view is terminal-only (see 05-features.md F3).

The only surface that renders session content is the **search results**
view (`/search`, F4). It lists `search_sessions` hits, each a small row:
project + session title, the matched role, and a `snippet()` excerpt
(highlighted match). Rows are bounded (≤ `limit`, default 200) so no
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
