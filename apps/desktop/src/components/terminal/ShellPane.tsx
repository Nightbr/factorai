import { useEffect, useRef } from 'react';
import { attachStream, fitToHost, getOrCreateTerm, showOnly } from '@components/terminal/Terminal';
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
	const shells = useShellStore((s) => s.bySession[sessionId]);
	const activeKey = useShellStore((s) => s.activeBySession[sessionId] ?? null);
	const active = shells?.find((t) => t.key === activeKey) ?? null;

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !active) return;

		const entry = getOrCreateTerm(
			active.key,
			container,
			// Read from the store at call time, not captured: a chip respawned
			// after its process died keeps its key and gets a new PTY (F23).
			() =>
				useShellStore.getState().bySession[sessionId]?.find((t) => t.key === active.key)
					?.terminalId ?? undefined,
		);
		if (entry.host.parentElement !== container) container.appendChild(entry.host);
		showOnly(container, entry);
		// Measure before the spawn so the shell is born at the real width — an
		// 80-column default would wrap every `git log` line until the next resize.
		fitToHost(entry);

		attachStream(
			entry,
			(cols, rows) =>
				cmd
					.shellSpawn({
						sessionId,
						projectId: active.projectId,
						cwd: active.cwd,
						cols,
						rows,
					})
					.then((id) => {
						useShellStore.getState().attach(active.key, id);
						return id;
					}),
			'Failed to open a shell',
			// `exit` closes the chip. A shell killed by the app quitting is the
			// other way this fires, and slice 4 is what tells the two apart.
			() => useShellStore.getState().close(active.key),
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
	}, [sessionId, active]);

	if (!active) return null;

	// `p-2` and `overflow-hidden` for the reason the agent's pane has them: the
	// 8px is the slack a row's text spills into at a fractional zoom.
	return (
		<div className="h-full w-full overflow-hidden border-border border-t bg-[#0c0e12] p-2">
			<div ref={containerRef} className="relative h-full w-full" data-testid="shell-pane" />
		</div>
	);
}
