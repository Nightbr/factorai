import { disposeTerminal } from '@components/terminal/Terminal';
import { cmd } from '@lib/tauri';
import { type ShellPaneTab, type ShellTab, useShellStore } from '@store/shellStore';

/**
 * Tear down every shell in a project's footer (`specs/05-features.md` § F23,
 * ADR-0032).
 *
 * **One caller: `Remove project`.** A shell's lifetime is the project's, so
 * nothing about a session reaches this — not the header's `×`, not the tab
 * strip's, not deleting the session, not a restart. Each of those is a gesture
 * about the agent, and F23's first version killed a running build on every one
 * of them.
 *
 * The kill is one command rather than one per pane because Rust owns the
 * question of which PTYs belong to a project, and a renderer that had a stale
 * list would leave one running (ADR-0031).
 *
 * Nothing is confirmed here and nothing is asked, which is the trade ADR-0031
 * records — `Remove project` has its own confirm, and it is the surface that
 * should carry one.
 */
export function closeProjectShells(projectId: string): void {
	const chips = useShellStore.getState().byProject[projectId] ?? [];
	// Dispose before the store forgets them: the pooled xterm is keyed by the
	// pane's key, and once the entry is gone there is nothing left to name it.
	for (const chip of chips) for (const pane of chip.panes) disposeTerminal(pane.key);
	useShellStore.getState().closeProject(projectId);
	// The PTYs outlive the renderer's state, so a failure here is a real leak —
	// but the project is already going and there is no surface left to say so on.
	void cmd.shellKillForProject(projectId).catch((e) => {
		console.error('shell_kill_for_project failed', e);
	});
}

/**
 * Close one pane — the corner `×` (F24). Kills its process, throws its xterm
 * away, and drops it from its chip; the chip goes too when this was its last.
 *
 * **The kill is here and not implied.** F23's chip `×` only dropped the store
 * entry, and the PTY ran on, invisible, until the session closed. A `×` that
 * leaves a process behind is the leak ADR-0005 exists to forbid, and the
 * no-dialog trade ADR-0031 records covers the kill: nothing is asked.
 */
export function closePane(pane: ShellPaneTab): void {
	killPane(pane);
	useShellStore.getState().closePane(pane.key);
}

/** Close a chip — its `×` — and every pane in it, the same way. A three-pane
 *  chip kills three shells without asking (F24). */
export function closeChip(chip: ShellTab): void {
	for (const pane of chip.panes) killPane(pane);
	useShellStore.getState().close(chip.key);
}

function killPane(pane: ShellPaneTab): void {
	disposeTerminal(pane.key);
	// A dead pane has no process to kill; a live one's exit event will find no
	// pane to mark, which is the normal case for `markDead`, not a lost one.
	if (pane.terminalId) {
		void cmd.terminalKill(pane.terminalId).catch((e) => {
			console.error('terminal_kill failed', e);
		});
	}
}
