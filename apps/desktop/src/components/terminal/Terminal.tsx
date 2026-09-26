import { SearchAddon } from '@xterm/addon-search';
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { createFileLinkProvider } from '@components/terminal/fileLinkProvider';
import { activateFileLink, fileLinkContext } from '@components/terminal/fileLinkWiring';
import { useFileLinks } from '@hooks/useFileLinks';
import type { RoutineFireEvent } from '@factorai/types';
import { matchesKeyboardEvent } from '@tanstack/react-hotkeys';
import { base64ToBytes } from '@lib/base64';
import { formatError } from '@lib/errors';
import { isPanelDragging, onPanelDragEnd } from '@lib/panelDrag';
import { hotkeysOverTerminal, mergeKeymap } from '@lib/keymap';
import { cmd, copyText, events, openExternally } from '@lib/tauri';
import { isMacOS } from '@lib/platform';
import { usePrefsStore } from '@store/prefsStore';
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
export function fitToHost(entry: PooledTerm): void {
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
// `disposeTerminal`). The component never disposes the xterm. This is what
// makes reopening a session show its full scrollback: the terminal keeps its
// buffer AND keeps consuming PTY output via listeners even while it isn't on
// screen. Recreating xterm on every navigation (the old approach) showed an
// empty pane because a fresh terminal can't replay a live PTY's history.
//
// **Every pooled host stays in the document once it has been shown, stacked in
// the pane; switching session toggles `visibility`, it does not reparent.**
// That is a bug fix, not a tidy-up — see `showOnly` for the macOS report it
// came from and for what detaching cost even where the wheel kept working.
//
// Terminals are NEVER killed on unmount — they live in `terminalStore` and are
// torn down only by `kill_all()` on quit (ADR-0005) or an explicit restart.

export interface PooledTerm {
	host: HTMLDivElement;
	term: XTerm;
	cleanup: Array<() => void>;
	/** Set once `attachPty` has run, so the spawn + output listeners are wired
	 *  exactly once per pooled terminal. */
	ptyAttached: boolean;
	/** `disposeTerminal` has thrown this xterm away.
	 *
	 *  A spawn is async and a dispose is not, so the two race: a restart, or a
	 *  click on a dead shell chip (F23), can dispose a terminal whose
	 *  `shell_spawn` is still in flight — and the `.then` would then write into a
	 *  disposed xterm, which surfaces as
	 *  `undefined is not an object (evaluating 'this._renderer.value.dimensions')`
	 *  from xterm's own viewport. Checked after every await in `attachStream`. */
	disposed: boolean;
	/** Which PTY this terminal's keystrokes and resizes go to, read at call time
	 *  rather than captured.
	 *
	 *  A function because the id changes underneath a pooled xterm — a restart
	 *  gives a session a new PTY, and a dead shell chip respawns into one (F23) —
	 *  and because the two kinds read it from different stores. */
	terminalId: () => string | undefined;
}

/** Keyed by session id for an agent, and by a `shell:<uuid>` for a footer shell
 *  (F23). Two key spaces in one map because everything below this line is about
 *  an xterm and a host element, and neither cares which it is; the prefix is
 *  what keeps them from ever colliding. */
const pool = new Map<string, PooledTerm>();

// Memoises the spawn so StrictMode's double-invoke (and any concurrent caller)
// shares ONE `terminal_spawn` rather than racing two.
const spawnInFlight = new Map<string, Promise<string>>();

/** Push a window size to the PTY, ignoring the `NotFound` a terminal that has
 *  already exited returns — a resize losing that race is not worth surfacing. */
function pushSize(terminalId: string, cols: number, rows: number): void {
	void cmd.terminalResize(terminalId, cols, rows).catch(() => undefined);
}

/** The PTY a session's agent is running in, or `undefined` between a restart's
 *  dispose and the next spawn. */
function agentTerminalId(sessionId: string): string | undefined {
	return useTerminalStore.getState().bySession[sessionId]?.terminalId;
}

/**
 * Show this session's pooled host and hide every other one in the same pane.
 *
 * **The terminal scrolls with the wheel straight after a tab switch, on macOS**
 * (reported 2026-08-28: the wheel did nothing over the new session's output
 * until you clicked into it, and Linux could not reproduce it).
 *
 * The strip and the session route share one pane element — switching tab
 * re-renders `SessionView` rather than remounting it — so the only thing that
 * moved was the xterm host, which the old code `removeChild`'d on unmount and
 * `appendChild`'d on mount. Measured in the browser lane: six disconnections
 * from the document per switch, every one of them a subtree that leaves the
 * document and comes back.
 *
 * That is the one thing WebKit-on-macOS treats differently from WebKitGTK.
 * Wheel events there are routed on the scrolling thread against the document's
 * *wheel event region*, which is built from the nodes that have wheel handlers
 * registered while connected; a subtree that leaves the document is dropped
 * from it. xterm's own wheel listener sits on `.xterm` inside the host, so a
 * re-inserted terminal is outside the region and the scrolling thread never
 * hands the event to the page. A click forces the main-thread hit test that
 * rebuilds it, which is exactly the workaround the report describes. Linux has
 * no scrolling thread and no region, so the same DOM churn is invisible there.
 *
 * Hiding rather than detaching also fixes two things that were wrong on every
 * platform, quietly. A detached element measures `offsetHeight` 0, and xterm's
 * `Viewport._innerRefresh` runs while output keeps arriving in the background:
 * it records that 0 as the viewport height and then tries to set `scrollTop`,
 * which a detached element ignores — leaving `_ignoreNextScrollEvent` latched
 * `true`, so the first wheel tick after you come back is swallowed. Both are
 * gone once the host keeps a real box.
 *
 * `visibility` and not `display: none`: a hidden box still has layout, which is
 * the whole point — the background terminal stays the pane's size, so it is
 * already correct when you switch to it. It is also not hit-testable and not
 * focusable, so the hidden terminals underneath cannot take a click or a
 * keystroke meant for this one.
 *
 * **And the hidden host is moved off screen as well as hidden**, which is what
 * stops a background session rendering at all (PERF-04,
 * `specs/10-performance.md`). This block used to say a hidden terminal's rows
 * were "laid out, never painted" — they were also *written*. xterm pauses its
 * renderer from an `IntersectionObserver` on the screen element, and
 * `visibility: hidden` changes nothing about where an element is, so every
 * background terminal kept rewriting its rows on every chunk of output, for as
 * many sessions as had ever been opened. A translation takes it out of the
 * viewport — so the observer reports it as not intersecting and xterm's
 * `refreshRows` becomes a flag — while leaving the layout box exactly where it
 * was, because a transform does not affect layout. `clientWidth` and
 * `clientHeight` are unchanged, so `fitToHost` still measures the pane, and the
 * host never leaves the document, so the wheel-region bug above cannot come
 * back. xterm does one full refresh of its own when the observer reports it
 * visible again.
 *
 * **Leftwards, not rightwards.** Overflow past the left edge is clipped;
 * overflow past the right would be scrollable, and would give an ancestor a
 * horizontal scrollbar for a terminal nobody can see.
 *
 * `content-visibility: hidden` would also stop the work and is still not used —
 * it zeroes descendant geometry, which is the measurement bug above coming
 * back.
 */
const OFFSCREEN = 'translateX(-200vw)';

/**
 * The terminal's copy chord (F5): `Cmd+C` on macOS, `Ctrl+Shift+C` elsewhere,
 * because a Linux `Ctrl+C` is the interrupt the agent's prompt is waiting for.
 */
export function isCopyChord(event: KeyboardEvent): boolean {
	if (event.key.toLowerCase() !== 'c' || event.altKey) return false;
	return isMacOS()
		? event.metaKey && !event.ctrlKey && !event.shiftKey
		: event.ctrlKey && event.shiftKey && !event.metaKey;
}

/**
 * Put the selection on the clipboard and clear it, so the grid shows the copy
 * happened. Through `copyText`, never the web API, which WebKitGTK refuses.
 */
function copySelection(term: XTerm): void {
	const text = term.getSelection();
	term.clearSelection();
	void copyText(text).catch((e) => console.error('terminal copy failed', e));
}

export function showOnly(container: HTMLElement, active: PooledTerm): void {
	for (const entry of pool.values()) {
		if (entry.host.parentElement !== container) continue;
		const hidden = entry !== active;
		// Both, and each for its own reason: `visibility` keeps a hidden terminal
		// out of hit-testing and out of the focus order, the transform stops it
		// rendering.
		entry.host.style.visibility = hidden ? 'hidden' : '';
		entry.host.style.transform = hidden ? OFFSCREEN : '';
	}
}

export function getOrCreateTerm(
	key: string,
	container: HTMLElement,
	terminalId: () => string | undefined,
): PooledTerm {
	const existing = pool.get(key);
	if (existing) return existing;

	const host = document.createElement('div');
	// Stacked, so every pooled terminal in this pane is exactly the pane's size
	// whether or not it is the visible one. `inset-0` of the container rather
	// than `h-full w-full` of a padded box: the 8px is on the wrapper, so the
	// geometry `fitToHost` measures is unchanged.
	host.className = 'absolute inset-0';
	// Appended *before* `term.open`, so xterm's first measurement — char size,
	// scrollbar width, the initial render dimensions — is taken on an element
	// that has a layout. It used to open on a detached div and correct itself
	// on the first `fitToHost`.
	container.appendChild(host);

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

	// **The app's own bindings, let past xterm on purpose** (F28, ADR-0046).
	//
	// xterm owns every chord while it has focus, which is the rule that keeps
	// typing to Claude working. A handful of actions have to reach the app
	// anyway — settings, the sidebar search, a new session, the file panel — or
	// they are unreachable from the one surface you spend the day in. Returning
	// `false` means "xterm does not handle this": the key is not written to the
	// PTY and not defaulted, so it bubbles to the document listener the hotkey
	// manager registered.
	//
	// The list is **derived from the keymap**, read at the keystroke rather than
	// captured, because this terminal outlives every rebind: the pool keeps it
	// for the app's life (see below), and a snapshot taken at construction would
	// pass the chord the user has since moved away from.
	term.attachCustomKeyEventHandler((event) => {
		if (event.type !== 'keydown') return true;
		// Nothing without a modifier can be one of ours, and this runs on every
		// keystroke typed into the terminal.
		if (!event.ctrlKey && !event.metaKey) return true;
		// **Copy the selection** (F5). Only with one, so a bare `Cmd+C` or
		// `Ctrl+Shift+C` still reaches the PTY when nothing is selected.
		if (isCopyChord(event) && term.hasSelection()) {
			event.preventDefault();
			copySelection(term);
			return false;
		}
		const keymap = mergeKeymap(usePrefsStore.getState().keymapOverrides);
		for (const hotkey of hotkeysOverTerminal(keymap)) {
			if (matchesKeyboardEvent(event, hotkey)) return false;
		}
		return true;
	});

	// **Registration order is load-bearing, and getting it wrong is silent.**
	// xterm's `Linkifier._checkLinkProviderResult` only shows provider N's links
	// once every provider before it has replied *with nothing* — and it tests
	// that reply for falsiness. `WebLinksAddon` always calls back with an array,
	// `[]` when it found no URLs, and `[]` is truthy. So anything registered
	// after it can never produce a visible link, with no error anywhere: the
	// text simply doesn't underline, and a click falls through to the TUI's
	// mouse reporting. Found exactly that way (F19).
	//
	// Ours goes first, which is safe in both directions: it excludes URL spans
	// before it tokenises, so it never claims a link that belongs to
	// `WebLinksAddon`, and it calls back with `undefined` rather than `[]` when
	// it has none — which is what lets the addon behind it still work. That
	// `undefined` is not a style choice; it is this contract.
	term.loadAddon({
		activate: (t) =>
			t.registerLinkProvider(
				createFileLinkProvider(
					t,
					() => fileLinkContext(key),
					(event, link) => activateFileLink(key, event, link),
				),
			),
		dispose: () => undefined,
	});
	term.loadAddon(new WebLinksAddon(onLinkActivated));
	term.loadAddon(new UnicodeGraphemesAddon());
	// WebGL addon is deliberately not loaded: it crashes WebKitGTK on some
	// Linux setups (the user's Zorin OS being one). DOM rendering is slower
	// but reliable.
	term.open(host);

	const entry: PooledTerm = {
		host,
		term,
		cleanup: [],
		ptyAttached: false,
		disposed: false,
		terminalId,
	};
	pool.set(key, entry);

	// Forward keystrokes to the live PTY. Reads the terminal id from the store
	// at call time so it follows the current PTY even after a restart.
	const dataSub = term.onData((d) => {
		const tid = entry.terminalId();
		if (tid) void cmd.terminalWrite(tid, d);
	});
	entry.cleanup.push(() => dataSub.dispose());

	// xterm's geometry is the source of truth for the PTY's window size: every
	// dimension change (a `fit()` after reattaching, a window resize) is
	// forwarded here. Keeping this in ONE place means callers only ever have to
	// call `fit()` — they never compute cols/rows or talk to the PTY themselves.
	const resizeSub = term.onResize(({ cols, rows }) => {
		const tid = entry.terminalId();
		if (tid) pushSize(tid, cols, rows);
	});
	entry.cleanup.push(() => resizeSub.dispose());

	// **Right-click copies when something is selected** (F5). WebKitGTK's own
	// menu greys `Copy` out, because the selection lives in xterm's rendered
	// layer rather than its textarea, so that menu could only ever paste. With
	// no selection the native menu is left alone and still pastes.
	const onContextMenu = (e: MouseEvent) => {
		if (!term.hasSelection()) return;
		e.preventDefault();
		copySelection(term);
	};
	host.addEventListener('contextmenu', onContextMenu);
	entry.cleanup.push(() => host.removeEventListener('contextmenu', onContextMenu));

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
	initialPrompt?: string,
): void {
	attachStream(
		entry,
		(cols, rows) => ensureTerminal(sessionId, projectId, projectCwd, cols, rows, initialPrompt),
		// Not named after an agent: Rust decides which one runs, and its error
		// already says which CLI it could not find (F30).
		'Could not start the session',
	);
}

/**
 * Wire a pooled terminal to a PTY: spawn it, then pipe `terminal:data` in and
 * announce `terminal:exit`.
 *
 * Shared by the agent above and the footer shell (F23), which differ only in
 * which command mints the id — everything after that is one byte stream and one
 * exit, keyed by terminal id on both sides of the bridge.
 *
 * Call this only AFTER the host is in the DOM and `fit()` has run, for the
 * reason in `attachPty`'s note.
 */
export function attachStream(
	entry: PooledTerm,
	spawn: (cols: number, rows: number) => Promise<string>,
	failLabel: string,
	onExit?: (code: number | null) => void,
): void {
	if (entry.ptyAttached) return;
	entry.ptyAttached = true;

	const { term } = entry;

	spawn(term.cols, term.rows)
		.then(async (id) => {
			// The spawn was awaited; the terminal may not have survived it. Writing
			// into a disposed xterm throws from inside its own viewport, and the
			// dispose is exactly what a restart or a dead-chip respawn does.
			if (entry.disposed) return;
			// Reconcile once the id is known. The PTY can be out of sync already: it
			// may predate this terminal (reused across a hot reload or a remount), or
			// a `fit()` may have landed while the spawn was in flight, when the store
			// had no id yet for `onResize` to push to.
			pushSize(id, term.cols, term.rows);
			const unData = await events.onTerminalData((ev) => {
				if (!entry.disposed && ev.id === id) term.write(base64ToBytes(ev.bytesB64));
			});
			const unExit = await events.onTerminalExit((ev) => {
				if (!entry.disposed && ev.id === id) {
					term.write(
						`\r\n\x1b[90m[process exited${ev.code !== null ? `: ${ev.code}` : ''}]\x1b[0m\r\n`,
					);
					onExit?.(ev.code);
				}
			});
			// Registering a listener is itself awaited, so check once more before
			// handing it to a cleanup list nothing will run — otherwise a disposed
			// terminal leaves two live subscriptions behind.
			if (entry.disposed) {
				unData();
				unExit();
				return;
			}
			entry.cleanup.push(unData, unExit);
		})
		.catch((e) => {
			if (entry.disposed) return;
			term.write(`\r\n\x1b[31m${failLabel}: ${formatError(e)}\x1b[0m\r\n`);
		});
}

/**
 * Re-key a pooled terminal from the id a session started under to the one its
 * agent gave it (F30, ADR-0062). The xterm, its scrollback and its listeners
 * are untouched — they are filtered by *terminal* id, which does not change —
 * only the map entry moves, so the session route mounting under the new id
 * finds the same terminal. The store is re-keyed by the caller in the same
 * breath (`rebindSession`).
 */
export function rebindTerminal(from: string, to: string): void {
	const entry = pool.get(from);
	if (!entry || from === to) return;
	pool.delete(from);
	pool.set(to, entry);
	// **Keystrokes follow the id too.** `terminalId` is a closure over the
	// session id the terminal was created for, read on every `onData` and
	// `onResize`; with the store re-keyed to `to`, a lookup by `from` answers
	// `undefined` and every key after the first turn is silently dropped — which
	// is how a Codex approval prompt sat unanswerable on 2026-09-22.
	entry.terminalId = () => agentTerminalId(to);
	const inFlight = spawnInFlight.get(from);
	if (inFlight) {
		spawnInFlight.delete(from);
		spawnInFlight.set(to, inFlight);
	}
}

/** Dispose the pooled terminal for a session (used by restart). Does not kill
 *  the PTY — callers do that separately if needed. */
export function disposeTerminal(sessionId: string): void {
	const entry = pool.get(sessionId);
	if (!entry) return;
	entry.disposed = true;
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

/**
 * The pane a routine's terminal lives in until somebody opens it (F22).
 *
 * Offscreen rather than `display: none`: xterm measures its host to decide the
 * grid, and a box with no layout is born 80×24 — so `claude` would render at 80
 * columns and stay there until the session was opened and resized. A real box
 * parked off the left edge has a real size and never paints.
 *
 * One element for the app's lifetime, and hosts move out of it exactly once,
 * when the session is first opened. That is the same move the pool already
 * makes coming back from the project route, which is why it is safe here — see
 * the note at the `<Terminal>` mount effect.
 */
let routinePane: HTMLDivElement | null = null;

function getRoutinePane(): HTMLDivElement {
	if (routinePane?.isConnected) return routinePane;
	const pane = document.createElement('div');
	pane.dataset.testid = 'routine-pane';
	pane.setAttribute('aria-hidden', 'true');
	// Sized like a comfortable terminal so the PTY is born with a usable grid,
	// and pushed out of the viewport rather than hidden, for the reason above.
	pane.style.cssText =
		'position:fixed;left:-10000px;top:0;width:900px;height:600px;pointer-events:none;';
	document.body.appendChild(pane);
	routinePane = pane;
	return pane;
}

/**
 * Start the session a routine came due for (F22, ADR-0026 § 2).
 *
 * The runner decided *when* and wrote every row before emitting; this only
 * spawns. It is the one spawn in the app that no route asked for, which is why
 * it lives beside the pool rather than in a component: there is no component.
 *
 * Idempotent — a fire for a session that already has a terminal does nothing,
 * so a re-emitted event cannot start a second `claude`.
 */
export function startRoutineSession(fire: RoutineFireEvent): void {
	if (useTerminalStore.getState().bySession[fire.sessionId]) return;
	useTerminalStore
		.getState()
		.setRoutineOrigin(fire.sessionId, fire.routineId, fire.routineName, Date.now());
	const entry = getOrCreateTerm(fire.sessionId, getRoutinePane(), () =>
		agentTerminalId(fire.sessionId),
	);
	fitToHost(entry);
	attachPty(entry, fire.sessionId, fire.projectId, fire.cwd, fire.prompt);
}

function ensureTerminal(
	sessionId: string,
	projectId: string,
	projectCwd: string | null,
	cols: number,
	rows: number,
	initialPrompt?: string,
): Promise<string> {
	const existing = useTerminalStore.getState().bySession[sessionId];
	if (existing) return Promise.resolve(existing.terminalId);

	let pending = spawnInFlight.get(sessionId);
	if (!pending) {
		// The launch override, if the `+` menu set one for this id (F30). Taken,
		// not read: a restart of the same session resolves the agent from its
		// row like any resume, which is what the override was for one click of.
		const agent = useTerminalStore.getState().takeLaunchAgent(sessionId);
		pending = cmd
			.terminalSpawn({
				sessionId,
				projectId,
				cwd: projectCwd ?? undefined,
				cols,
				rows,
				initialPrompt,
				agent,
			})
			.then(({ id, agent }) => {
				// A prompt means a routine fired this (F22), and a routine's session
				// gets no tab until a human opens it.
				useTerminalStore
					.getState()
					.attach(sessionId, id, projectId, { openTab: initialPrompt === undefined, agent });
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
	/** The project's folder. **Three states, and the third one matters**
	 *  (PERF-09): a path, `null` for a project that has none, and `undefined`
	 *  while `list_projects` has not answered yet. This is in the mount effect's
	 *  dependency list, so without the distinction a cold switch ran that effect
	 *  twice — once with no cwd, reaching `attachPty` and spawning without one,
	 *  then again with the real value — and the cleanup in between hid the host
	 *  the first run had just shown. */
	projectCwd: string | null | undefined;
	/** The cwd recorded in this session's transcript, when there is one. First
	 *  base a relative path in the output resolves against (F19). */
	sessionCwd: string | null;
}

export function Terminal({ sessionId, projectId, projectCwd, sessionCwd }: TerminalProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	// File links in the agent's output (F19). **Session cwd first, then the
	// project root**: the same string for a fresh session, and different for a
	// resumed one started in a subdirectory — or in another worktree, which is
	// the case F21 turns on.
	//
	// **The PTY itself is spawned from the session's recorded cwd too**, but that
	// decision is Rust's rather than this component's: `attachPty` passes
	// `projectCwd` and `TerminalManager::resume_cwd` overrides it out of the
	// index. It has to be here as well, because this component learns
	// `sessionCwd` from a query that resolves after it has already mounted and
	// spawned.
	useFileLinks({
		termKey: sessionId,
		bases: [sessionCwd, projectCwd ?? null],
		treeRoot: projectCwd ?? null,
		focus: () => pool.get(sessionId)?.term.focus(),
	});

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		// Wait for the answer rather than spawning against a guess (PERF-09).
		// `undefined` is "`list_projects` has not said yet"; `null` is "it said,
		// and there is no folder", which is a real answer and does run.
		if (projectCwd === undefined) return;

		// **Looking at a session is what opens it.** A routine's session is live
		// with no tab until now (ADR-0026), and `attach` — where a tab otherwise
		// comes from — ran when it spawned. Without this the strip never gains the
		// tab and the session you are looking at is unreachable from it.
		useTerminalStore.getState().openTab(sessionId, projectId);

		// **A terminal built for the first time waits for the frame after this
		// one** (PERF-09). Constructing an xterm and fitting it is 55-160ms of
		// main thread on WebKitGTK, and run here it held back the header the same
		// commit had just rendered: a first open painted its chrome at 78-164ms
		// against a 100ms budget. The rAF lands before the next paint and the
		// timeout after it, so the header and the tab reach the screen first and
		// the body follows — which is what the budget allows it to do, since it
		// waits on the PTY either way. A pooled terminal has nothing to build and
		// is still shown in the same frame, which is the 33ms budget.
		let teardown: (() => void) | undefined;
		const mount = () => {
			const entry = getOrCreateTerm(sessionId, container, () => agentTerminalId(sessionId));
			// Only ever true for a terminal built against a *previous* pane — the
			// session route's pane survives a tab switch, so switching session moves
			// nothing. Coming back from the project route does, and there is no way
			// around it: the pane React unmounted took its children with it. A
			// routine's terminal is the third case: it was born in the offscreen pane
			// and this is the first time anybody has looked at it (F22).
			const adopted = entry.host.parentElement !== container;
			if (adopted) container.appendChild(entry.host);
			showOnly(container, entry);
			// Size the terminal to its container before the PTY exists, so the spawn
			// carries the real cols/rows. `fit()` reads layout synchronously, and the
			// host has a layout by now, so this measures the final width. If the
			// container has none yet (zero-sized during a route transition) fit() is a
			// no-op and the timer below catches up — `onResize` then forwards the
			// corrected size to the PTY.
			fitToHost(entry);
			attachPty(entry, sessionId, projectId, projectCwd);

			// An adopted terminal was measured against a different box — the routine
			// pane's fixed 900×600, or a pane that has since unmounted — so the first
			// paint in this one is at the old grid until something redraws it. Fit and
			// force a repaint on the next frame, when the new layout is real.
			if (adopted) {
				requestAnimationFrame(() => {
					fitToHost(entry);
					entry.term.refresh(0, entry.term.rows - 1);
				});
			}

			const focusTimer = setTimeout(() => {
				fitToHost(entry);
				// Coming back to a pooled terminal: jump to the latest output (the live
				// prompt) rather than wherever the buffer was last scrolled.
				entry.term.scrollToBottom();
				entry.term.focus();
			}, 0);

			// `fit()` is all this needs to do — the terminal's `onResize` handler
			// pushes the new geometry to the PTY.
			// Held for the length of a panel drag and fitted once at its end
			// (PERF-30): a refit per frame is a PTY resize per frame, and the agent
			// redraws its whole screen for each one.
			const ro = new ResizeObserver(() => {
				if (!isPanelDragging()) fitToHost(entry);
			});
			ro.observe(container);
			const offDragEnd = onPanelDragEnd(() => fitToHost(entry));

			teardown = () => {
				clearTimeout(focusTimer);
				ro.disconnect();
				offDragEnd();
				// Hide, never detach, and never dispose: the pooled terminal keeps its
				// scrollback and its listeners, and keeping its box in the document is
				// what keeps the wheel working when you come back (see `showOnly`).
				// Off screen for the same reason `showOnly` moves it: a terminal nobody
				// is looking at should not be rendering.
				entry.host.style.visibility = 'hidden';
				entry.host.style.transform = OFFSCREEN;
			};
		};
		if (pool.has(sessionId)) {
			mount();
			return () => teardown?.();
		}
		let deferred: ReturnType<typeof setTimeout> | undefined;
		const frame = requestAnimationFrame(() => {
			deferred = setTimeout(mount, 0);
		});
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(deferred);
			teardown?.();
		};
	}, [sessionId, projectId, projectCwd]);

	// `p-2` is also the slack the rows paint into at a fractional zoom — see the
	// last-column rule in the desktop app's stylesheet, which is written against
	// this 8px — and `overflow-hidden` is what keeps that spill inside the pane.
	// The inner element is the hosts' positioning parent, so the padding stays in
	// one place and `fitToHost` measures exactly the box it used to.
	return (
		<div className="h-full w-full overflow-hidden bg-[#0c0e12] p-2">
			<div ref={containerRef} className="relative h-full w-full" />
		</div>
	);
}
