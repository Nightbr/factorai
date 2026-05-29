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

// Module-level map of in-flight spawn promises, keyed by session. React
// StrictMode mounts every effect twice (mount → cleanup → mount); without a
// shared promise the two mounts would each kick off a `terminal_spawn`,
// leaving an orphan claude. By memoising the spawn here, both mounts await
// the SAME spawn and the second reuses the first's terminal id.
//
// Critically, we do NOT kill the terminal on effect cleanup. Terminals live
// in `terminalStore` keyed by session and are meant to persist across
// navigation; the only teardown path is `kill_all()` on app quit (ADR-0005).
// The previous code killed on the StrictMode cleanup, which — once the
// backend `kill()` deadlock was fixed — actually tore the terminal down and
// left an empty pane on every open in dev.
const spawnInFlight = new Map<string, Promise<string>>();

function ensureTerminal(
	sessionId: string,
	projectCwd: string | null,
	cols: number,
	rows: number,
): Promise<string> {
	const existing = useTerminalStore.getState().bySession[sessionId];
	if (existing) return Promise.resolve(existing);

	let pending = spawnInFlight.get(sessionId);
	if (!pending) {
		pending = cmd
			.terminalSpawn({ resumeSessionId: sessionId, cwd: projectCwd ?? undefined, cols, rows })
			.then((id) => {
				useTerminalStore.getState().attach(sessionId, id);
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
	projectCwd: string | null;
}

export function Terminal({ sessionId, projectCwd }: TerminalProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<XTerm | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const terminalId = useTerminalStore((s) => s.bySession[sessionId]);

	// Bootstrap xterm once.
	useEffect(() => {
		const term = new XTerm({
			fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
			fontSize: 13,
			cursorBlink: true,
			allowProposedApi: true,
			theme: {
				background: '#0c0e12',
				foreground: '#d4d4d8',
				cursor: '#e5b455',
			},
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.loadAddon(new SearchAddon());
		term.loadAddon(new WebLinksAddon());
		term.loadAddon(new UnicodeGraphemesAddon());
		// WebGL addon is deliberately not loaded: it crashes WebKitGTK on
		// some Linux setups (the user's Zorin OS being one). Default DOM
		// rendering is slower but reliable. Revisit if we add a setting.
		const host = hostRef.current;
		if (!host) return;
		term.open(host);
		setTimeout(() => {
			fit.fit();
			term.focus();
		}, 0);

		termRef.current = term;
		fitRef.current = fit;

		return () => {
			term.dispose();
			termRef.current = null;
			fitRef.current = null;
		};
	}, []);

	// Spawn (or reuse) the PTY for this session and attach data/exit
	// listeners. The spawn is shared via `ensureTerminal` so StrictMode's
	// double-mount can't create two PTYs. On cleanup we only drop the
	// listeners — we never kill the terminal (see `spawnInFlight` above).
	useEffect(() => {
		const term = termRef.current;
		const fit = fitRef.current;
		if (!term || !fit) return;

		let disposed = false;
		let unlistenData: (() => void) | undefined;
		let unlistenExit: (() => void) | undefined;

		ensureTerminal(sessionId, projectCwd, term.cols || 80, term.rows || 24)
			.then(async (id) => {
				if (disposed) return;
				unlistenData = await events.onTerminalData((ev) => {
					if (ev.id === id) term.write(base64ToBytes(ev.bytesB64));
				});
				unlistenExit = await events.onTerminalExit((ev) => {
					if (ev.id === id) {
						term.write(
							`\r\n\x1b[90m[process exited${ev.code !== null ? `: ${ev.code}` : ''}]\x1b[0m\r\n`,
						);
						useTerminalStore.getState().detach(sessionId);
					}
				});
			})
			.catch((e) => {
				if (!disposed) {
					term.write(`\r\n\x1b[31mFailed to spawn claude: ${String(e)}\x1b[0m\r\n`);
				}
			});

		return () => {
			disposed = true;
			unlistenData?.();
			unlistenExit?.();
		};
	}, [sessionId, projectCwd]);

	// Forward xterm input to the PTY.
	useEffect(() => {
		const term = termRef.current;
		if (!term || !terminalId) return;
		const sub = term.onData((d) => {
			void cmd.terminalWrite(terminalId, d);
		});
		return () => sub.dispose();
	}, [terminalId]);

	// ResizeObserver → fit + backend resize.
	useEffect(() => {
		const host = hostRef.current;
		const fit = fitRef.current;
		if (!host || !fit) return;
		const ro = new ResizeObserver(() => {
			fit.fit();
			const term = termRef.current;
			if (term && terminalId) {
				void cmd.terminalResize(terminalId, term.cols, term.rows);
			}
		});
		ro.observe(host);
		return () => ro.disconnect();
	}, [terminalId]);

	return <div ref={hostRef} className="h-full w-full bg-[#0c0e12] p-2" />;
}
