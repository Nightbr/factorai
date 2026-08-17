import { Button } from '@factorai/ui';
import { useCallback, useRef, useState } from 'react';
import { CommitDetail } from '@components/graph/CommitDetail';
import { CommitRow } from '@components/graph/CommitRow';
import { PanelResizer } from '@components/layout/PanelResizer';
import { useGitGraph } from '@hooks/useGitGraph';
import { useGitStatus } from '@hooks/useGitStatus';
import { lanePitch, railWidth } from '@lib/gitGraph';
import { clampDetailHeight, usePanelStore } from '@store/panelStore';

/**
 * The panel's Graph tab (specs/05-features.md F18).
 *
 * A rail designed for 288px from the first line, not a wide graph squeezed: the
 * panel is 200–600px, and Q22 chose to ship the narrow picture first with a wide
 * modal deferred. Read-only throughout — nothing here checks out, resets or
 * cherry-picks, and ADR-0009 means the network transport to do so isn't even
 * linked in.
 */
export function GraphView() {
	const { commits, laneCount, graph, isPending, hasMore, isLoadingMore, loadMore, root } =
		useGitGraph();
	const width = usePanelStore((s) => s.width);
	const detailHeight = usePanelStore((s) => s.detailHeight);
	const setDetailHeight = usePanelStore((s) => s.setDetailHeight);

	// The selection carries the project it belongs to, so switching project drops
	// it by derivation rather than by an effect that resets it a render later — a
	// SHA from the old history would open a detail pane for a commit that isn't on
	// screen.
	const [selection, setSelection] = useState<{ root: string; sha: string } | null>(null);
	const selected = selection && selection.root === root ? selection.sha : null;
	const select = useCallback((sha: string) => setSelection(root ? { root, sha } : null), [root]);
	const listRef = useRef<HTMLUListElement>(null);

	// Uncommitted changes sit on top of HEAD, and a graph that showed `main` on a
	// commit while forty files were dirty would read as clean. Free: the Graph tab
	// being open means the panel is open, so this query is already in cache under
	// the key the Changes tab and the tree's decorations share.
	const { status } = useGitStatus();
	const dirtyHead = status?.changes.length ? status.head : null;

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
			if (!keys.includes(event.key) || commits.length === 0) return;
			event.preventDefault();

			const current = commits.findIndex((commit) => commit.sha === selected);
			const next =
				event.key === 'Home'
					? 0
					: event.key === 'End'
						? commits.length - 1
						: event.key === 'ArrowDown'
							? Math.min(commits.length - 1, current + 1)
							: // From nothing selected, Up starts at the top rather than
								// wrapping to the oldest commit in the page.
								Math.max(0, current <= 0 ? 0 : current - 1);

			const sha = commits[next].sha;
			select(sha);
			// Move real DOM focus, not just the selection: with a roving tabindex the
			// focused button *is* the cursor, and `scrollIntoView` handles the row
			// being off-screen after Home/End or a long run of arrows.
			const row = listRef.current?.querySelector<HTMLButtonElement>(`[data-sha="${sha}"]`);
			row?.focus();
			row?.scrollIntoView({ block: 'nearest' });
		},
		[commits, selected, select],
	);

	if (!root) return <Empty>Select a project to see its history.</Empty>;
	if (isPending) return <Empty>Loading…</Empty>;
	// The same string and shape as ChangesView, from the same `repoRoot: null`
	// that is a success rather than an error.
	if (!graph?.repoRoot) return <Empty>Not a git repository.</Empty>;
	if (commits.length === 0) return <Empty>No commits yet.</Empty>;

	const pitch = lanePitch(laneCount, width);
	const rail = railWidth(laneCount, pitch);
	// What is left for refs and subject, which is what decides how many chips fit
	// before the rest becomes `+N`. The 24px covers the row's own right padding
	// and the gaps between its parts.
	const textWidth = Math.max(0, width - rail - 24);

	return (
		<div data-testid="graph-view" className="flex min-h-0 flex-1 flex-col">
			{/* `overflow-x-auto`: past ~14 lanes the rail stops compressing at its 6px
			    floor and grows instead, because below that adjacent lanes aren't
			    separable however good the colours are. The whole row scrolls, rail and
			    text together — one scroll container rather than two that have to be
			    kept in sync. */}
			<div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
				{/* The keydown sits on the list, not on each row: with a roving tabindex
				    the focused row is inside it, so the event bubbles here and one
				    handler owns movement for all 300. */}
				<ul ref={listRef} aria-label="Commits" onKeyDown={onKeyDown}>
					{commits.map((commit, index) => (
						<CommitRow
							key={commit.sha}
							commit={commit}
							pitch={pitch}
							railWidth={rail}
							textWidth={textWidth}
							selected={commit.sha === selected}
							// Tab reaches the list at whichever row you left it on, or the
							// first one before you have chosen anything.
							tabbable={selected ? commit.sha === selected : index === 0}
							dirty={commit.sha === dirtyHead}
							onSelect={() => select(commit.sha)}
						/>
					))}
				</ul>
				{hasMore && (
					<div className="px-3 py-2">
						<Button variant="secondary" size="sm" disabled={isLoadingMore} onClick={loadMore}>
							{isLoadingMore ? 'Loading…' : 'Load more'}
						</Button>
					</div>
				)}
			</div>

			{selected && (
				<>
					<PanelResizer
						size={detailHeight}
						onSize={setDetailHeight}
						// The pane is docked at the bottom and grows upwards, so the handle
						// sits on its top edge and a negative-y drag makes it taller.
						edge="top"
						label="Resize commit detail"
						clamp={clampDetailHeight}
					/>
					<div style={{ height: detailHeight }} className="shrink-0 overflow-hidden">
						<CommitDetail projectPath={root} sha={selected} onSelectSha={select} />
					</div>
				</>
			)}
		</div>
	);
}

function Empty({ children }: { children: string }) {
	return <p className="px-3 py-2 text-muted-foreground text-xs">{children}</p>;
}
