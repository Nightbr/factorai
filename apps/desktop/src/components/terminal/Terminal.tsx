import { SearchAddon } from '@xterm/addon-search';
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { base64ToBytes } from '@lib/base64';
import { formatError } from '@lib/errors';
import { cmd, events, openExternally } from '@lib/tauri';
import { useTerminalStore } from '@store/terminalStore';

/**
 * What a click on a URL in the terminal does (specs/05-features.md F5).
 *
 * `WebLinksAddon`'s default handler is `window.open`, which a Tauri webview has
 * no use for: nothing happens, or the page navigates away from the app. It has
 * to go through the shell plugin (`shell:allow-open`, whose scope regex is
 * guarded by `tests/shell_open_scope.rs`).
 *
 * **Modifier-click, not plain click.** That is the terminal convention, and
 * Claude Code is a TUI: a bare click lands on interactive output often enough
 * that opening a browser on one would be an ambush.
 *
 * **Both kinds of link come through here** — see `linkHandler` at the terminal's
 * construction for why that took a second wiring, and what it cost not to have
 * it.
 *
 * Exported so the gate is testable — the addon itself can't be driven from the
 * browser-only test lane.
 */
export function onLinkActivated(
	event: MouseEvent,
	uri: string,
	open: (uri: string) => void = openExternally,
): void {
	if (!event.ctrlKey && !event.metaKey) return;
	open(uri);
}

/**
 * xterm's `ILinkHandler` for **OSC 8** hyperlinks — a link the program declared,
 * rather than one `WebLinksAddon` found by regex. The two paths are separate in
 * xterm and this one has to be wired explicitly; see the note at the terminal's
 * construction for what leaving it unset did.
 *
 * Deliberately the *same* gate as a regex link: two kinds of link in one
 * terminal behaving differently would be worse than either rule on its own, and
 * the ambush argument does not weaken just because the program marked the text.
 *
 * A factory so a test can inject `open`, matching `onLinkActivated`.
 */
export function createOscLinkHandler(open: (uri: string) => void = openExternally): {
	activate: (event: MouseEvent, uri: string) => void;
} {
	return { activate: (event, uri) => onLinkActivated(event, uri, open) };
}

// ── Sizing the grid ────────────────────────────────────────────────────────
//
// **This replaces `@xterm/addon-fit`, which reserved 14px we never used.** That
// addon computes `available = parentWidth - padding -
// (options.overviewRuler?.width || 14)`, holding a gutter open for the overview
// ruler — the minimap decorations can be drawn into. We register no decorations
// and never set `overviewRulerWidth`, so nothing is ever drawn there.
//
// It cannot be turned off. xterm 5.5.0 spells that option `overviewRulerWidth`,
// a flat number on `ITerminalOptions`; the nested `overviewRuler.width` the
// addon reads belongs to a later core and is always `undefined` here, so `|| 14`
// fires every time. Setting it to `0` would not help either — `0 || 14` is 14.
// The addon declares no peer range, so nothing flagged the pairing.
//
// Downgrading is not the way out: addon-fit 0.10.0 subtracts the scrollbar
// instead, read from xterm's own viewport, which ends `|| 15` — so a hidden
// scrollbar measures 0 and falls back to 15. Both versions insist on a gutter.
//
// The cost was about two columns of every terminal on every platform, and a
// visible strip of dead background down the right of the session. With the
// scrollbar gone (see the desktop app's stylesheet) nothing overlays that strip
// any more, so it is simply the terminal's to use.

/** xterm's own floor: below this the renderer has no grid to draw into. */
const MIN_COLS = 2;
const MIN_ROWS = 1;

/**
 * The grid that exactly fills `host`, reserving nothing.
 *
 * Pure, and exported, because the arithmetic is the whole point of the change
 * above — a regression here is two silently-lost columns, which is precisely the
 * kind of thing that survives a screenshot.
 *
 * Returns `null` rather than a guess when it has nothing to measure: a detached
 * or not-yet-rendered terminal reports zero, and `floor(x / 0)` is `Infinity`.
 * Callers leave the size alone and the next fit corrects it.
 */
export function proposeGeometry(
	hostWidth: number,
	hostHeight: number,
	cellWidth: number,
	cellHeight: number,
): { cols: number; rows: number } | null {
	if (!(cellWidth > 0) || !(cellHeight > 0)) return null;
	if (!(hostWidth > 0) || !(hostHeight > 0)) return null;
	return {
		cols: Math.max(MIN_COLS, Math.floor(hostWidth / cellWidth)),
		rows: Math.max(MIN_ROWS, Math.floor(hostHeight / cellHeight)),
	};
}

/**
 * Resize the terminal to its host — the same contract `fit()` had, so callers
 * still never compute cols/rows or talk to the PTY themselves (`onResize`
 * forwards the result).
 *
 * **Cell metrics come from what the renderer actually drew**, not from
 * `_core._renderService`: `.xterm-screen` is exactly `cols x rows` cells, so
 * dividing its box by the terminal's current dimensions gives the cell size
 * through public API alone. It also self-corrects — when "JetBrains Mono"
 * finishes loading and every glyph changes width, the next fit sees the new
 * number with nothing to invalidate.
 *
 * No `_renderService.clear()` before the resize, which is the one thing the
 * addon did that this drops. That guards against stale glyphs left in a canvas;
 * we run the DOM renderer deliberately (see the WebGL note at construction),
 * whose rows are re-rendered elements rather than a painted surface.
 */
function fitToHost(entry: PooledTerm): void {
	const { term, host } = entry;
	const screen = host.querySelector('.xterm-screen');
	if (!(screen instanceof HTMLElement)) return;

	const rect = screen.getBoundingClientRect();
	const next = proposeGeometry(
		host.clientWidth,
		host.clientHeight,
		rect.width / term.cols,
		rect.height / term.rows,
	);
	if (!next) return;
	if (next.cols !== term.cols || next.rows !== term.rows) term.resize(next.cols, next.rows);
}

// ── Persistent xterm pool ──────────────────────────────────────────────────
//
// One xterm instance per session, kept alive for the app's lifetime (or until
// `disposeTerminal`). The component reparents the instance's host element into
// its container on mount and detaches it on unmount — it never disposes the
// xterm. This is what makes reopening a session show its full scrollback: the
// terminal keeps its buffer AND keeps consuming PTY output via listeners even
// while it isn't on screen. Recreating xterm on every navigation (the old
// approach) showed an empty pane because a fresh terminal can't replay a live
// PTY's history.
//
// Terminals are NEVER killed on unmount — they live in `terminalStore` and are
// torn down only by `kill_all()` on quit (ADR-0005) or an explicit restart.

interface PooledTerm {
	host: HTMLDivElement;
	term: XTerm;
	cleanup: Array<() => void>;
	/** Set once `attachPty` has run, so the spawn + output listeners are wired
	 *  exactly once per pooled terminal. */
	ptyAttached: boolean;
}

const pool = new Map<string, PooledTerm>();

/** Push a window size to the PTY, ignoring the `NotFound` a terminal that has
 *  already exited returns — a resize losing that race is not worth surfacing. */
function pushSize(terminalId: string, cols: number, rows: number): void {
	void cmd.terminalResize(terminalId, cols, rows).catch(() => undefined);
}

function getOrCreateTerm(sessionId: string): PooledTerm {
	const existing = pool.get(sessionId);
	if (existing) return existing;

	const host = document.createElement('div');
	host.className = 'h-full w-full';

	const term = new XTerm({
		fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
		fontSize: 13,
		cursorBlink: true,
		allowProposedApi: true,
		scrollback: 10_000,
		theme: { background: '#0c0e12', foreground: '#d4d4d8', cursor: '#e5b455' },
		// **OSC 8 hyperlinks are a second, separate link path, and leaving this
		// unset crashed the app.** `WebLinksAddon` only handles URLs it finds by
		// regex; a link the program *declared* with OSC 8 goes to
		// `options.linkHandler` instead. Unset, xterm falls back to its own
		// default, which calls `window.confirm` — and the dialog plugin's init
		// script replaces `window.confirm` with `invoke('plugin:dialog|confirm')`,
		// a command plugin-dialog 2.7.1 does not register (only open/save/message).
		// So it rejected with "not allowed by ACL", which the old window-level
		// handler turned into a blanked window (F17). Even had it resolved, the
		// default then calls `window.open`, which is the wrong destination here.
		//
		// Claude Code emits OSC 8 for its login URL — which is how this was found,
		// and which answers the question roadmap item 15 had left open about
		// whether the CLI emits them at all. It does.
		linkHandler: createOscLinkHandler(),
	});
	term.loadAddon(new SearchAddon());
	term.loadAddon(new WebLinksAddon(onLinkActivated));
	term.loadAddon(new UnicodeGraphemesAddon());
	// WebGL addon is deliberately not loaded: it crashes WebKitGTK on some
	// Linux setups (the user's Zorin OS being one). DOM rendering is slower
	// but reliable.
	term.open(host);

	const entry: PooledTerm = { host, term, cleanup: [], ptyAttached: false };
	pool.set(sessionId, entry);

	// Forward keystrokes to the live PTY. Reads the terminal id from the store
	// at call time so it follows the current PTY even after a restart.
	const dataSub = term.onData((d) => {
		const tid = useTerminalStore.getState().bySession[sessionId]?.terminalId;
		if (tid) void cmd.terminalWrite(tid, d);
	});
	entry.cleanup.push(() => dataSub.dispose());

	// xterm's geometry is the source of truth for the PTY's window size: every
	// dimension change (a `fit()` after reattaching, a window resize) is
	// forwarded here. Keeping this in ONE place means callers only ever have to
	// call `fit()` — they never compute cols/rows or talk to the PTY themselves.
	const resizeSub = term.onResize(({ cols, rows }) => {
		const tid = useTerminalStore.getState().bySession[sessionId]?.terminalId;
		if (tid) pushSize(tid, cols, rows);
	});
	entry.cleanup.push(() => resizeSub.dispose());

	return entry;
}

/**
 * Spawn (or reuse) the PTY for this session and pipe its output into the pooled
 * terminal. The listeners live with the pooled term, not the React component,
 * so output keeps flowing while the session isn't on screen.
 *
 * Call this only AFTER the host is in the DOM and `fit()` has run: `term.open()`
 * measures a detached element, so before the first fit the terminal is still at
 * xterm's 80x24 default and the PTY would be born 80 columns wide — claude then
 * renders narrow until the next window resize.
 */
function attachPty(
	entry: PooledTerm,
	sessionId: string,
	projectId: string,
	projectCwd: string | null,
): void {
	if (entry.ptyAttached) return;
	entry.ptyAttached = true;

	const { term } = entry;

	ensureTerminal(sessionId, projectId, projectCwd, term.cols, term.rows)
		.then(async (id) => {
			// Reconcile once the id is known. The PTY can be out of sync already: it
			// may predate this terminal (reused across a hot reload or a remount), or
			// a `fit()` may have landed while the spawn was in flight, when the store
			// had no id yet for `onResize` to push to.
			pushSize(id, term.cols, term.rows);
			const unData = await events.onTerminalData((ev) => {
				if (ev.id === id) term.write(base64ToBytes(ev.bytesB64));
			});
			const unExit = await events.onTerminalExit((ev) => {
				if (ev.id === id) {
					term.write(
						`\r\n\x1b[90m[process exited${ev.code !== null ? `: ${ev.code}` : ''}]\x1b[0m\r\n`,
					);
				}
			});
			entry.cleanup.push(unData, unExit);
		})
		.catch((e) => {
			term.write(`\r\n\x1b[31mFailed to spawn claude: ${formatError(e)}\x1b[0m\r\n`);
		});
}

/** Dispose the pooled terminal for a session (used by restart). Does not kill
 *  the PTY — callers do that separately if needed. */
export function disposeTerminal(sessionId: string): void {
	const entry = pool.get(sessionId);
	if (!entry) return;
	for (const fn of entry.cleanup) fn();
	entry.term.dispose();
	entry.host.remove();
	pool.delete(sessionId);
}

/**
 * Restart a session: throw the pooled xterm away, then ask the mounted
 * `<Terminal>` to tear down and spawn a fresh one against the same session id.
 *
 * **One function because two surfaces ask for it** — the session header's
 * `Restart` and a click on a stopped tab (F16). A restart that disposed the pool
 * on one path and not the other would reattach to the dead pane reading
 * `[process exited]` instead of starting anything, and the two surfaces have
 * already been made to agree about closing for exactly this reason.
 *
 * The epoch lives in the store rather than in a component because the tab strip
 * has no way to reach the session route's state — and because clicking the
 * stopped tab you are *already on* navigates nowhere, so nothing would remount.
 *
 * Kills nothing: it is only reachable for a session with no live PTY.
 */
export function restartSession(sessionId: string): void {
	disposeTerminal(sessionId);
	useTerminalStore.getState().requestRestart(sessionId);
}

// Memoises the spawn so StrictMode's double-invoke (and any concurrent caller)
// shares ONE `terminal_spawn` rather than racing two.
const spawnInFlight = new Map<string, Promise<string>>();

function ensureTerminal(
	sessionId: string,
	projectId: string,
	projectCwd: string | null,
	cols: number,
	rows: number,
): Promise<string> {
	const existing = useTerminalStore.getState().bySession[sessionId];
	if (existing) return Promise.resolve(existing.terminalId);

	let pending = spawnInFlight.get(sessionId);
	if (!pending) {
		pending = cmd
			.terminalSpawn({ sessionId, projectId, cwd: projectCwd ?? undefined, cols, rows })
			.then((id) => {
				useTerminalStore.getState().attach(sessionId, id, projectId);
				spawnInFlight.delete(sessionId);
				return id;
			})
			.catch((e) => {
				spawnInFlight.delete(sessionId);
				throw e;
			});
		spawnInFlight.set(sessionId, pending);
	}
	return pending;
}

interface TerminalProps {
	sessionId: string;
	projectId: string;
	projectCwd: string | null;
}

export function Terminal({ sessionId, projectId, projectCwd }: TerminalProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const entry = getOrCreateTerm(sessionId);
		container.appendChild(entry.host);
		// Size the terminal to its container before the PTY exists, so the spawn
		// carries the real cols/rows. `fit()` reads layout synchronously, and the
		// host has just been appended to a laid-out container, so this measures
		// the final width. If the container has no layout yet (zero-sized during a
		// route transition) fit() is a no-op and the timer below catches up —
		// `onResize` then forwards the corrected size to the PTY.
		fitToHost(entry);
		attachPty(entry, sessionId, projectId, projectCwd);

		const focusTimer = setTimeout(() => {
			fitToHost(entry);
			// Reattaching a pooled terminal: jump to the latest output (the live
			// prompt) rather than wherever the buffer was last scrolled.
			entry.term.scrollToBottom();
			entry.term.focus();
		}, 0);

		// `fit()` is all this needs to do — the terminal's `onResize` handler
		// pushes the new geometry to the PTY.
		const ro = new ResizeObserver(() => fitToHost(entry));
		ro.observe(container);

		return () => {
			clearTimeout(focusTimer);
			ro.disconnect();
			// Detach (don't dispose) — the pooled terminal keeps its scrollback
			// and listeners so reopening this session shows its history.
			if (container.contains(entry.host)) container.removeChild(entry.host);
		};
	}, [sessionId, projectId, projectCwd]);

	return <div ref={containerRef} className="h-full w-full bg-[#0c0e12] p-2" />;
}
