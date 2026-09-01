import { disposeTerminal } from '@components/terminal/Terminal';
import { cmd } from '@lib/tauri';
import { useShellStore } from '@store/shellStore';

/**
 * Tear down every shell in a session's footer (`specs/05-features.md` § F23).
 *
 * **A shell's whole lifetime is the footer it is drawn in**, so every gesture
 * that ends a session calls this: the header's `×`, the tab strip's, deleting
 * the session, and removing its project. Deliberately *not* called by a
 * restart — that replaces the agent above the footer and has nothing to say
 * about the shells under it.
 *
 * The kill is one command rather than one per chip because Rust owns the
 * question of which PTYs belong to a session, and a renderer that had a stale
 * list would leave one running (ADR-0031).
 *
 * Nothing is confirmed and nothing is asked, which is the trade ADR-0031
 * records: a build running in a shell dies with the session that hosted it.
 */
export function closeSessionShells(sessionId: string): void {
	const tabs = useShellStore.getState().bySession[sessionId] ?? [];
	// Dispose before the store forgets them: the pooled xterm is keyed by the
	// chip's key, and once the entry is gone there is nothing left to name it.
	for (const tab of tabs) disposeTerminal(tab.key);
	useShellStore.getState().closeSession(sessionId);
	// The PTYs outlive the renderer's state, so a failure here is a real leak —
	// but the session is already going and there is no surface left to say so on.
	void cmd.shellKillForSession(sessionId).catch((e) => {
		console.error('shell_kill_for_session failed', e);
	});
}
