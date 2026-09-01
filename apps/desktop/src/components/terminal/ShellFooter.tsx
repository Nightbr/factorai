import { IconButton } from '@factorai/ui';
import { Plus } from 'lucide-react';
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

	return (
		<div className="flex h-7.5 shrink-0 items-center gap-1 border-border border-t bg-card px-2">
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
