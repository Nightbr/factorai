import { IconButton } from '@factorai/ui';
import { Plus } from 'lucide-react';
import { ShellChip } from '@components/terminal/ShellChip';
import { useShellStore } from '@store/shellStore';

/**
 * The strip along the bottom of a live session (`specs/05-features.md` § F23).
 *
 * **Always present, with no shells open.** It costs the agent one row of its
 * grid and it is the only thing that says the footer exists; a control revealed
 * on hover, or one that only appears once you have already used the feature,
 * cannot be found by somebody who has not.
 *
 * 30px, declared — `DESIGN.md` § "Chrome heights are explicit".
 */
export function ShellFooter({
	sessionId,
	projectId,
	cwd,
}: {
	sessionId: string;
	projectId: string;
	/** Where a new shell starts: the session's checkout when it has one (F21),
	 *  the project root otherwise. */
	cwd: string | null;
}) {
	const open = useShellStore((s) => s.open);
	const close = useShellStore((s) => s.close);
	const setActive = useShellStore((s) => s.setActive);
	const tabs = useShellStore((s) => s.bySession[sessionId]);
	const activeKey = useShellStore((s) => s.activeBySession[sessionId] ?? null);

	return (
		<div
			className="flex h-7.5 shrink-0 items-center gap-1 overflow-x-auto border-border border-t bg-card px-2"
			// A strip of chips is a tab list even when it is empty, and the `+` at
			// the end of it is not one of the tabs.
			role="tablist"
			aria-label="Shells"
			data-testid="shell-footer"
		>
			{tabs?.map((tab) => (
				<ShellChip
					key={tab.key}
					tab={tab}
					active={tab.key === activeKey}
					// **Clicking the chip you are on collapses the split**, leaving the
					// shells running: the agent gets its full height back while a long
					// build finishes, and nothing is lost by looking away.
					//
					// Except a dead chip, where there is nothing to collapse away from
					// and a click means "open a shell here" — collapsing it would make
					// that take two clicks for no reason anyone could infer.
					onSelect={() => setActive(sessionId, tab.key === activeKey && !tab.dead ? null : tab.key)}
					onClose={() => close(tab.key)}
				/>
			))}
			<IconButton
				aria-label="New shell"
				title="New shell"
				// A shell with nowhere to run is refused by the backend anyway; not
				// offering the button at all is the honest version of that.
				disabled={!cwd}
				onClick={() => cwd && open(sessionId, projectId, cwd)}
			>
				<Plus className="size-3.5" />
			</IconButton>
		</div>
	);
}
