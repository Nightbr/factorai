import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { base64ToBytes } from '@lib/base64';
import { cmd, events } from '@lib/tauri';
import { useTerminalStore } from '@store/terminalStore';

// Module-level guard: survives React StrictMode double-mount of the same
// component instance. Without this, the first mount initiates a spawn and
// the second mount initiates another before the first resolves — leaving
// us with two orphan claude processes per session.
const spawningSession = new Set<string>();

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
		try {
			term.loadAddon(new WebglAddon());
		} catch (e) {
			console.warn('WebGL addon unavailable; falling back to canvas', e);
		}
		const host = hostRef.current;
		if (!host) return;
		term.open(host);
		setTimeout(() => fit.fit(), 0);

		termRef.current = term;
		fitRef.current = fit;

		return () => {
			term.dispose();
			termRef.current = null;
			fitRef.current = null;
		};
	}, []);

	// Spawn or attach to the PTY for this session. Reads + mutates the
	// terminal store via getState() to avoid re-running on its updates.
	// `spawningSession` (module-level) prevents StrictMode double-spawn.
	useEffect(() => {
		const term = termRef.current;
		const fit = fitRef.current;
		if (!term || !fit) return;

		let cancelled = false;
		let unlistenData: (() => void) | undefined;
		let unlistenExit: (() => void) | undefined;
		const store = useTerminalStore.getState();
		let activeId: string | null = store.bySession[sessionId] ?? null;

		const bootstrap = async () => {
			if (!activeId) {
				if (spawningSession.has(sessionId)) {
					// Another mount is already spawning. Bail; the data/exit
					// listeners installed by the winning mount will receive
					// events, and the store will update terminalId when
					// attach() runs, which triggers a re-render where
					// store.bySession[sessionId] is set.
					return;
				}
				spawningSession.add(sessionId);
				try {
					const cols = term.cols || 80;
					const rows = term.rows || 24;
					const id = await cmd.terminalSpawn({
						resumeSessionId: sessionId,
						cwd: projectCwd ?? undefined,
						cols,
						rows,
					});
					if (cancelled) {
						await cmd.terminalKill(id).catch(() => {});
						spawningSession.delete(sessionId);
						return;
					}
					activeId = id;
					useTerminalStore.getState().attach(sessionId, id);
				} catch (e) {
					term.write(`\r\n\x1b[31mFailed to spawn claude: ${String(e)}\x1b[0m\r\n`);
					spawningSession.delete(sessionId);
					return;
				}
				spawningSession.delete(sessionId);
			}

			const myId = activeId;
			unlistenData = await events.onTerminalData((ev) => {
				if (ev.id === myId) term.write(base64ToBytes(ev.bytesB64));
			});
			unlistenExit = await events.onTerminalExit((ev) => {
				if (ev.id === myId) {
					term.write(
						`\r\n\x1b[90m[process exited${ev.code !== null ? `: ${ev.code}` : ''}]\x1b[0m\r\n`,
					);
					useTerminalStore.getState().detach(sessionId);
				}
			});
		};

		bootstrap();

		return () => {
			cancelled = true;
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
