import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { base64ToBytes } from '@lib/base64';
import { cmd, events } from '@lib/tauri';
import { useTerminalStore } from '@store/terminalStore';

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
	fit: FitAddon;
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
	});
	const fit = new FitAddon();
	term.loadAddon(fit);
	term.loadAddon(new SearchAddon());
	term.loadAddon(new WebLinksAddon());
	term.loadAddon(new UnicodeGraphemesAddon());
	// WebGL addon is deliberately not loaded: it crashes WebKitGTK on some
	// Linux setups (the user's Zorin OS being one). DOM rendering is slower
	// but reliable.
	term.open(host);

	const entry: PooledTerm = { host, term, fit, cleanup: [], ptyAttached: false };
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
			term.write(`\r\n\x1b[31mFailed to spawn claude: ${String(e)}\x1b[0m\r\n`);
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
			.terminalSpawn({ resumeSessionId: sessionId, cwd: projectCwd ?? undefined, cols, rows })
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
		entry.fit.fit();
		attachPty(entry, sessionId, projectId, projectCwd);

		const focusTimer = setTimeout(() => {
			entry.fit.fit();
			// Reattaching a pooled terminal: jump to the latest output (the live
			// prompt) rather than wherever the buffer was last scrolled.
			entry.term.scrollToBottom();
			entry.term.focus();
		}, 0);

		// `fit()` is all this needs to do — the terminal's `onResize` handler
		// pushes the new geometry to the PTY.
		const ro = new ResizeObserver(() => entry.fit.fit());
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
