import { SearchAddon } from '@xterm/addon-search';
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { createFileLinkProvider } from '@components/terminal/fileLinkProvider';
import { useFileViewer } from '@hooks/useFileViewer';
import { useRevealInTree } from '@hooks/useRevealInTree';
import type { RoutineFireEvent } from '@factorai/types';
import { base64ToBytes } from '@lib/base64';
import { formatError } from '@lib/errors';
import type { ResolveContext, ResolvedLink } from '@lib/fileLinks';
import { cmd, events, homeDir, openExternally } from '@lib/tauri';
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

/** Where a resolved file link goes: the viewer for a file, the tree for a
 *  directory. Passed in rather than imported so this stays testable without a
 *  router, and so the terminal knows nothing about either destination. */
export interface FileLinkTargets {
	openInViewer: (path: string, position: { line?: number; col?: number }) => void;
	revealInTree: (path: string) => void;
}

/**
 * What a modifier-click on a **path** does (F19).
 *
 * The third kind of link in this terminal, and it takes the same gate as the
 * other two on purpose — see `onLinkActivated`. The ambush argument is if
 * anything stronger here: throwing a near-fullscreen viewer over the terminal
 * you were reading is more disruptive than opening a browser beside it.
 *
 * The destination is the only thing that differs. A file the agent touched
 * belongs in the viewer (F7), not in whatever the OS says owns `.ts` — that is
 * the correction roadmap item 15 exists to make.
 */
export function onFileLinkActivated(
	event: MouseEvent,
	link: ResolvedLink,
	targets: FileLinkTargets,
): void {
	if (!event.ctrlKey && !event.metaKey) return;
	if (link.kind === 'directory') {
		targets.revealInTree(link.path);
		return;
	}
	targets.openInViewer(link.path, {
		line: link.line ?? undefined,
		col: link.col ?? undefined,
	});
}

/**
 * What the file-link provider needs from React, per session (F19).
 *
 * The provider has to be registered when the pooled terminal is built — see the
 * ordering note there — but what it needs (the router, the panel store, the
 * session's cwd) only exists inside the component. So the provider is
 * registered once and reads through this, which the component keeps current
 * while it is mounted and clears when it isn't.
 *
 * An unmounted session therefore has no links, which is right: there is nothing
 * on screen to hover, and opening a viewer for a terminal nobody is looking at
 * would be the ambush `onLinkActivated` exists to prevent.
 */
interface FileLinkWiring {
	context: () => ResolveContext;
	activate: (event: MouseEvent, link: ResolvedLink) => void;
}

const fileLinkWiring = new Map<string, FileLinkWiring>();

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
 * That costs something a detached host did not: a background session's rows are
 * laid out (never painted) as its output arrives, where before they were only
 * built. `content-visibility: hidden` would skip that work, and is deliberately
 * not used — it also zeroes descendant geometry, which is the measurement bug
 * above coming back. Worth revisiting only with a profile of a session count
 * that actually hurts.
 */
function showOnly(container: HTMLElement, active: PooledTerm): void {
	for (const entry of pool.values()) {
		if (entry.host.parentElement !== container) continue;
		entry.host.style.visibility = entry === active ? '' : 'hidden';
	}
}

function getOrCreateTerm(sessionId: string, container: HTMLElement): PooledTerm {
	const existing = pool.get(sessionId);
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
					() => fileLinkWiring.get(sessionId)?.context() ?? { bases: [], home: null },
					(event, link) => fileLinkWiring.get(sessionId)?.activate(event, link),
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
	initialPrompt?: string,
): void {
	if (entry.ptyAttached) return;
	entry.ptyAttached = true;

	const { term } = entry;

	ensureTerminal(sessionId, projectId, projectCwd, term.cols, term.rows, initialPrompt)
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
	const entry = getOrCreateTerm(fire.sessionId, getRoutinePane());
	fitToHost(entry);
	attachPty(entry, fire.sessionId, fire.projectId, fire.cwd, fire.prompt);
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
	initialPrompt?: string,
): Promise<string> {
	const existing = useTerminalStore.getState().bySession[sessionId];
	if (existing) return Promise.resolve(existing.terminalId);

	let pending = spawnInFlight.get(sessionId);
	if (!pending) {
		pending = cmd
			.terminalSpawn({
				sessionId,
				projectId,
				cwd: projectCwd ?? undefined,
				cols,
				rows,
				initialPrompt,
			})
			.then((id) => {
				// A prompt means a routine fired this (F22), and a routine's session
				// gets no tab until a human opens it.
				useTerminalStore
					.getState()
					.attach(sessionId, id, projectId, { openTab: initialPrompt === undefined });
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
	/** The cwd recorded in this session's transcript, when there is one. First
	 *  base a relative path in the output resolves against (F19). */
	sessionCwd: string | null;
}

export function Terminal({ sessionId, projectId, projectCwd, sessionCwd }: TerminalProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const { open: openInViewer, path: viewerPath } = useFileViewer();
	const revealInTree = useRevealInTree(projectCwd);

	/** Did the open viewer come from a link in *this* terminal? Decides whether
	 *  closing it hands focus back here — see the effect below. */
	const cameFromHereRef = useRef(false);

	// Read through a ref inside `provideLinks`, which runs on mouse move and
	// must not be re-registered every time a query resolves.
	const targetsRef = useRef<FileLinkTargets>({ openInViewer: () => {}, revealInTree });
	targetsRef.current = {
		openInViewer: (path, position) => {
			cameFromHereRef.current = true;
			openInViewer(path, position);
		},
		revealInTree,
	};

	/**
	 * Closing a viewer that was opened from this terminal puts the caret back in
	 * the terminal.
	 *
	 * Without it the sequence is: ctrl-click a path, read the file, press `Esc`,
	 * type — and the keystrokes go nowhere. The `Dialog` traps focus and Radix's
	 * own restoration does not reach xterm's helper textarea; **measured in the
	 * running app, not assumed** — an `x` typed after `Esc` never reached the
	 * prompt.
	 *
	 * Deferred by a tick because Radix restores focus during its own unmount, so
	 * focusing synchronously here would simply be overwritten. Same reason the
	 * mount effect below defers its first `focus()`.
	 *
	 * Only when the viewer came from here. Opening a file from the tree and
	 * closing it should leave focus where the tree put it, not yank it into a
	 * terminal the reader was not using.
	 */
	useEffect(() => {
		if (viewerPath || !cameFromHereRef.current) return;
		cameFromHereRef.current = false;
		const timer = setTimeout(() => pool.get(sessionId)?.term.focus(), 0);
		return () => clearTimeout(timer);
	}, [viewerPath, sessionId]);

	// The base chain, same shape. `home` is resolved once and cached by the
	// bridge; until it lands, a `~/` path just isn't a link yet.
	const homeRef = useRef<string | null>(null);
	useEffect(() => {
		void homeDir().then((h) => {
			homeRef.current = h;
		});
	}, []);

	const contextRef = useRef<ResolveContext>({ bases: [], home: null });
	contextRef.current = {
		// Session cwd first, then the project root. The same string for a fresh
		// session, and different for a resumed one started in a subdirectory — or
		// in another worktree, which is the case F21 turns on.
		//
		// **The PTY itself is spawned from the session's recorded cwd too**, but
		// that decision is Rust's rather than this component's: `attachPty` passes
		// `projectCwd` and `TerminalManager::resume_cwd` overrides it out of the
		// index. It has to be there, because this component learns `sessionCwd`
		// from a query that resolves after it has already mounted and spawned.
		bases: [sessionCwd, projectCwd].filter((b): b is string => Boolean(b)),
		home: homeRef.current,
	};

	// Hand the provider what it can't reach on its own. The provider itself is
	// registered with the pooled terminal, ahead of `WebLinksAddon`, and cannot
	// move here — see the ordering note at its registration.
	useEffect(() => {
		fileLinkWiring.set(sessionId, {
			context: () => contextRef.current,
			activate: (event, link) => onFileLinkActivated(event, link, targetsRef.current),
		});
		return () => {
			fileLinkWiring.delete(sessionId);
		};
	}, [sessionId]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const entry = getOrCreateTerm(sessionId, container);
		// Only ever true for a terminal built against a *previous* pane — the
		// session route's pane survives a tab switch, so switching session moves
		// nothing. Coming back from the project route does, and there is no way
		// around it: the pane React unmounted took its children with it. A
		// routine's terminal is the third case: it was born in the offscreen pane
		// and this is the first time anybody has looked at it (F22).
		const adopted = entry.host.parentElement !== container;
		if (adopted) container.appendChild(entry.host);
		showOnly(container, entry);
		// **Looking at a session is what opens it.** A routine's session is live
		// with no tab until now (ADR-0026), and `attach` — where a tab otherwise
		// comes from — ran when it spawned. Without this the strip never gains the
		// tab and the session you are looking at is unreachable from it.
		useTerminalStore.getState().openTab(sessionId, projectId);
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
		const ro = new ResizeObserver(() => fitToHost(entry));
		ro.observe(container);

		return () => {
			clearTimeout(focusTimer);
			ro.disconnect();
			// Hide, never detach, and never dispose: the pooled terminal keeps its
			// scrollback and its listeners, and keeping its box in the document is
			// what keeps the wheel working when you come back (see `showOnly`).
			entry.host.style.visibility = 'hidden';
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
