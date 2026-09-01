import { useEffect, useRef } from 'react';
import {
	attachStream,
	disposeTerminal,
	fitToHost,
	getOrCreateTerm,
	showOnly,
} from '@components/terminal/Terminal';
import { cmd } from '@lib/tauri';
import { useShellStore } from '@store/shellStore';

/**
 * The shells in one session's footer (`specs/05-features.md` § F23).
 *
 * Every shell of this session is a pooled xterm stacked in this one pane, with
 * `visibility` deciding which is on screen — the same arrangement the agent's
 * terminals use in theirs, and for the same reasons: a host that leaves the
 * document loses its wheel events on macOS and measures zero everywhere. See
 * `showOnly` in `Terminal.tsx`, which owns that reasoning.
 */
export function ShellPane({ sessionId }: { sessionId: string }) {
	const containerRef = useRef<HTMLDivElement>(null);
	/** The chip whose dead terminal has already been thrown away — see below. */
	const respawning = useRef<string | null>(null);
	const activeKey = useShellStore((s) => s.activeBySession[sessionId] ?? null);
	// **Primitives, never the tab object.** The store hands out a new object on
	// every title, and a shell retitles itself on every command it runs — so an
	// effect keyed on identity would tear down and re-run mid-build, and its
	// `focus()` would pull the caret out of whatever you were typing in.
	const tab = useShellStore((s) => s.bySession[sessionId]?.find((t) => t.key === activeKey));
	const dead = tab?.dead ?? false;
	const projectId = tab?.projectId ?? null;
	const cwd = tab?.cwd ?? null;

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !activeKey || !projectId || !cwd) return;

		// A dead chip that has just been clicked: throw the finished terminal away
		// so `attachStream` will spawn again. Its scrollback goes with it, which
		// is right — the shell it belonged to is gone, and a prompt that answers
		// nothing is worse than an empty pane.
		//
		// **Once per chip, tracked in a ref**, because this effect re-runs while
		// `dead` is still true: StrictMode invokes it twice on mount, and the
		// store hands out a new tab object on every title. Disposing on the second
		// run would throw away the terminal whose `shell_spawn` is still in
		// flight, and the resolved spawn would then write into a disposed xterm.
		if (dead && respawning.current !== activeKey) {
			respawning.current = activeKey;
			disposeTerminal(activeKey);
		} else if (!dead && respawning.current === activeKey) {
			// Live again: the next death is a new respawn.
			respawning.current = null;
		}

		const entry = getOrCreateTerm(
			activeKey,
			container,
			// Read from the store at call time, not captured: a chip respawned
			// after its process died keeps its key and gets a new PTY (F23).
			() =>
				useShellStore.getState().bySession[sessionId]?.find((t) => t.key === activeKey)
					?.terminalId ?? undefined,
		);
		// True after a collapse: the pane unmounted and took its children with it,
		// while the PTY kept running. The host comes back into a box of a
		// different size, so it is measured again below.
		const adopted = entry.host.parentElement !== container;
		if (adopted) container.appendChild(entry.host);
		showOnly(container, entry);
		// Measure before the spawn so the shell is born at the real width — an
		// 80-column default would wrap every `git log` line until the next resize.
		fitToHost(entry);
		// An adopted host was last measured against a box that no longer exists,
		// so its first paint here is at the old grid until something redraws it.
		if (adopted) {
			requestAnimationFrame(() => {
				fitToHost(entry);
				entry.term.refresh(0, entry.term.rows - 1);
			});
		}

		attachStream(
			entry,
			(cols, rows) =>
				cmd.shellSpawn({ sessionId, projectId, cwd, cols, rows }).then((id) => {
					useShellStore.getState().attach(activeKey, id);
					return id;
				}),
			'Failed to open a shell',
		);

		const focusTimer = setTimeout(() => {
			fitToHost(entry);
			entry.term.scrollToBottom();
			entry.term.focus();
		}, 0);
		const ro = new ResizeObserver(() => fitToHost(entry));
		ro.observe(container);

		return () => {
			clearTimeout(focusTimer);
			ro.disconnect();
			entry.host.style.visibility = 'hidden';
		};
		// `dead` is in the list deliberately: a click on a dead chip has to re-run
		// this effect, and the key alone does not change when it is respawned.
	}, [sessionId, activeKey, dead, projectId, cwd]);

	if (!activeKey) return null;

	// `p-2` and `overflow-hidden` for the reason the agent's pane has them: the
	// 8px is the slack a row's text spills into at a fractional zoom.
	return (
		<div className="h-full w-full overflow-hidden border-border border-t bg-[#0c0e12] p-2">
			<div ref={containerRef} className="relative h-full w-full" data-testid="shell-pane" />
		</div>
	);
}
