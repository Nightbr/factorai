import type { GitGraphEdge } from '@factorai/types';
import { GraphRail, ROW_HEIGHT } from '@components/graph/GraphRail';

interface WorkingRowProps {
	/** HEAD's lane — the working tree sits directly on top of it. */
	lane: number;
	pitch: number;
	railWidth: number;
	/** How many files are dirty, staged and unstaged together. */
	count: number;
	onOpenChanges: () => void;
}

/**
 * The uncommitted work, as a row above HEAD (specs/05-features.md F18).
 *
 * **This replaced the hollow HEAD node**, which said the same thing in a way you
 * had to already know how to read: a filled dot and a hollow dot differ by a few
 * pixels at 26px, and nothing on the row explained the difference. A row of its
 * own can carry a count and a label, and — the actual point — it can be clicked.
 *
 * Its node is hollow *and dashed*, because this is not a commit. Nothing here is
 * in history yet, and a marker that looked like the commits around it would be
 * claiming otherwise.
 */
export function WorkingRow({ lane, pitch, railWidth, count, onOpenChanges }: WorkingRowProps) {
	// One edge, leaving downwards into HEAD: the working tree has a child-to-parent
	// relationship with the commit below it and nothing above it, which is exactly
	// what `outgoing` draws.
	const edges: GitGraphEdge[] = [{ fromLane: lane, toLane: lane, lane, kind: 'outgoing' }];

	return (
		<li>
			<button
				type="button"
				data-testid="working-row"
				style={{ height: ROW_HEIGHT }}
				className="flex w-full items-center gap-1.5 pr-2 text-left text-sm transition-colors hover:bg-secondary/50"
				// Says where it goes, because a row that navigates elsewhere in the app
				// should say so before it is clicked rather than after.
				title="Show these in the Changes tab"
				onClick={onOpenChanges}
			>
				<GraphRail
					lane={lane}
					edges={edges}
					pitch={pitch}
					width={railWidth}
					node={{ kind: 'working' }}
				/>
				<span className="min-w-0 flex-1 truncate text-muted-foreground italic">
					Working changes
				</span>
				<span className="shrink-0 font-medium text-muted-foreground text-xs tabular-nums">
					{count}
				</span>
			</button>
		</li>
	);
}
