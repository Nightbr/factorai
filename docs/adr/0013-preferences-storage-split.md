# ADR-0013 — Preferences split across localStorage and SQLite; `tauri-plugin-store` removed

**Status.** Accepted (2026-08-17). Supersedes the storage note in
[`02-data-model.md`](../../specs/02-data-model.md) § `settings`. Arises from
[F11](../../specs/05-features.md) (settings).

## Context

`02-data-model.md` has said since the first planning pass that the app has two
stores for configuration: the SQLite `settings` table "for things that need ACID
and queries", and `tauri-plugin-store` for UI preferences, "file-backed JSON,
simpler".

Both halves were prepared and neither was used. `settings` exists in migration
`0001` with a comment naming `claude.binary` and `claude.version`, and has never
been read or written. `tauri-plugin-store` is a dependency in **both**
`apps/desktop/package.json` and `src-tauri/Cargo.toml`, and is registered in
`lib.rs` — and has never had a caller on either side.

Meanwhile the app grew three persisted zustand stores, all on **localStorage**,
because that is what `zustand/middleware`'s `persist` does by default:
`factorai.panel`, `factorai.sidebar` and `factorai.zoom`.

So by the time F11 arrived there were three candidate stores, one documented
answer, and a working practice that matched none of it. F11 also arrived with the
first genuine need for the Rust-readable half — the claude binary path override —
and, via roadmap item 31, a second one queued behind it.

## Decision

**Three places, split by who reads the value and how fast it is needed.**

1. **Layout state stays where it is** — `panelStore`, `sidebarStore`, `zoomStore`,
   localStorage. Widths, open/closed, which tab is showing, which directories are
   expanded.
2. **User preferences the renderer alone reads** go in a new `prefsStore`
   (`factorai.prefs`), also localStorage.
3. **Anything Rust must read** goes in the SQLite `settings` table, through
   `get_setting` / `set_setting`.

**`tauri-plugin-store` is removed** from both manifests and from `lib.rs`.

### Why not the plugin, which was the documented answer

**It is asynchronous, and that is not a detail here.** Its JS API is
promise-based: `await load(...)`, `await store.get(...)`. `persist` supports an
async storage adapter, but the store then hydrates a tick *after* first paint. So
every persisted value shows its default for a frame:

- the file panel paints at its default width and jumps to yours,
- the sidebar does the same,
- zoom renders at 100% before correcting — and zoom applies to the **webview**
  (F15), so the correction reflows the terminal and refits the PTY.

localStorage is synchronous, so none of that happens today. Moving working state
onto an async store would buy nothing and cost a visible flash on every launch.

**And the thing it was chosen for turned out not to be needed.** Its advantage
over localStorage is a real file on disk that Rust can also read. But once
Rust-readable settings go to SQLite — where Rust already has a pool, and where the
table already exists — nothing is left that wants a JSON file. A dependency in two
manifests and a registered plugin with no callers is not free: it is a thing every
reader of `lib.rs` has to account for, and a thing `deps:check` and `deps:unused`
carry.

### Why SQLite for the Rust-readable half rather than a file

`02-data-model.md` already assigned that table "things that need ACID and
queries", and a setting Rust reads at spawn time is exactly that. Rust has the
pool open already; a second file format would be a second thing to parse, lock and
migrate.

### Why `prefsStore` is a fourth store and not a merger

The line is **layout versus preference**: nobody sets a panel width in a settings
page, they drag it. Keeping them apart means a future "reset settings" or "export
settings" does not also reset your window layout, and it keeps each store's
`version`/`migrate` about one kind of thing.

The one value that moves is `diffInline`, which is a real preference that was
parked in `panelStore` for want of anywhere better — with a one-time read-across so
nobody's choice silently resets.

This **reverses F12's note** that `panelStore`'s `open`/`width` migrate "when F11
lands". That note was written when `prefsStore` was going to be the only persisted
store.

## Consequences

**Good.**

- No hydration flash, because the fast path stays synchronous.
- One dependency, two manifest entries and one plugin registration removed, in
  exchange for two commands over a table that already exists.
- The three working stores are not touched, so this ships without a migration for
  anything except one boolean.
- "Who reads this?" is now the question that decides where a value goes, which is
  answerable without knowing any history.

**Bad.**

- **localStorage is webview-owned, and Rust cannot read it.** If a preference later
  needs to be read by Rust it does not "move down a level" — it moves stores, which
  means a migration. The mitigation is that the question is asked up front, and the
  answer is usually obvious.
- **It is not a file a human can inspect, back up or hand-edit.** The plugin's JSON
  file would have been. Nothing currently wants that, and if something does, the
  honest answer then is an export/import in the settings surface rather than
  changing where the values live.
- **We keep a documented decision that has been reversed**, which is the cost of
  having recorded it early. `02-data-model.md` is corrected to point here.

**What this does not decide.** The *shape* of the settings surface — modal, URL,
Save semantics, entry point — is Q24 and F11, not this. Nor does it decide the key
namespace beyond noting that `SettingKey` is a mirrored union rather than a free
string, which is § IPC's existing rule rather than a new one.
