import type { DirEntry } from '@factorai/types';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { ChevronsDownUp, FolderGit2, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IconButton } from '@factorai/ui';
import { ChangesView } from '@components/files/ChangesView';
import { FileTreeNode } from '@components/files/FileTreeNode';
import { GraphView } from '@components/graph/GraphView';
import { useActiveCheckout } from '@hooks/useActiveCheckout';
import { checkoutLabel } from '@hooks/useWorktrees';
import { useActiveProject } from '@hooks/useActiveProject';
import { PanelEmpty as Empty } from '@components/layout/PanelEmpty';
import { PanelResizer } from '@components/layout/PanelResizer';
import { clampPanelWidth, type PanelTab, usePanelStore } from '@store/panelStore';

/**
 * Right-hand file tree for the active project (specs/05-features.md F12).
 *
 * Lives in the app shell rather than a route so it survives navigating from a
 * project's session list into a session — the tree is most useful next to a
 * running terminal. Which project it shows follows the route.
 */
export function FileTreePanel() {
	const open = usePanelStore((s) => s.open);
	const width = usePanelStore((s) => s.width);
	const setWidth = usePanelStore((s) => s.setWidth);

	if (!open) return null;

	return (
		<>
			<PanelResizer
				size={width}
				onSize={setWidth}
				edge="left"
				label="Resize file tree"
				clamp={clampPanelWidth}
			/>
			<aside
				data-testid="file-tree-panel"
				style={{ width }}
				// `select-none`: dragging the resizer sweeps the cursor across these
				// rows, and double-click-to-open would otherwise select the filename.
				className="flex shrink-0 select-none flex-col overflow-hidden border-l border-border bg-card"
			>
				<PanelBody />
			</aside>
		</>
	);
}

function PanelBody() {
	const { project } = useActiveProject();
	// **The checkout, not the project folder** (F21): the tree roots where the
	// agent is working, and every cache below keys on that path rather than on the
	// project id, which no longer identifies one tree.
	const { projectId, root, worktree, isLinked, isLoading } = useActiveCheckout();
	const tab = usePanelStore((s) => s.tab);
	const setOpen = usePanelStore((s) => s.setOpen);
	const collapseAll = usePanelStore((s) => s.collapseAll);
	const seedRoot = usePanelStore((s) => s.seedRoot);

	useEffect(() => {
		if (root) seedRoot(root);
	}, [root, seedRoot]);

	return (
		<>
			<header className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
				{/* Three tabs, hardcoded — not a registry (Q18, amended when the graph
				    took a third slot). Appended rather than reordered, so Files and
				    Changes keep the positions muscle memory already has. */}
				<div className="flex flex-1 items-center gap-0.5" role="tablist" aria-label="Panel">
					<TabButton tab="files" label="Files" />
					<TabButton tab="changes" label="Changes" />
					<TabButton tab="graph" label="Graph" />
				</div>
				{tab === 'files' && (
					<>
						<IconButton
							aria-label="Collapse all"
							title="Collapse all"
							disabled={!projectId}
							onClick={() => root && collapseAll(root)}
						>
							<ChevronsDownUp />
						</IconButton>
						<RefreshButton label="Refresh tree" queryKey={['dir']} />
					</>
				)}
				{tab === 'graph' && (
					// The graph polls at 30s, not the Changes tab's 3s, so an explicit
					// refresh is the answer for a commit that just landed while you were
					// looking at it (F18).
					<RefreshButton label="Refresh graph" queryKey={['git-graph']} />
				)}
				<IconButton
					aria-label="Close file tree"
					title="Close file tree"
					onClick={() => setOpen(false)}
				>
					<X />
				</IconButton>
			</header>

			{/* The graph owns its own scrolling and docks a detail pane at the
			    bottom, so it sits outside the shared scroll wrapper rather than
			    inside it — a pane docked to the bottom of a scroll container scrolls
			    away with the content. */}
			{tab === 'graph' ? (
				<GraphView />
			) : (
				/* `pr-2` is the scrollbar gutter: with a long tree or a big change
				   set, rows would otherwise run under the scrollbar. */
				<div className="min-h-0 flex-1 overflow-auto py-1 pr-2">
					{tab === 'changes' && <ChangesView />}
					{tab === 'files' && (
						<>
							{!projectId && <Empty>Select a project to browse its files.</Empty>}
							{projectId && isLoading && <Empty>Loading…</Empty>}
							{projectId && !isLoading && !root && <Empty>Project folder not found on disk.</Empty>}
							{projectId && root && (
								<ul>
									<FileTreeNode
										entry={rootEntry(root, project?.displayName ?? root)}
										root={root}
										projectId={projectId}
										depth={0}
										// **Which checkout this tree is** (F21), beside the root
										// folder's name — moved here from the panel header on user
										// feedback: that row already holds three tabs and two icons
										// at 288px, and a fourth thing in it is a fourth thing
										// competing for the same width.
										//
										// The cost, accepted: the Changes and Graph tabs have no root
										// row, so they carry no mark. The session header names the
										// checkout too, and it is visible from all three — a mark can
										// only appear when a session is in front, since a project
										// route always resolves to the project's own checkout.
										trailing={
											isLinked && worktree ? (
												<span
													data-testid="panel-checkout"
													title={`Showing the worktree ${worktree.path}`}
													className="flex shrink-0 items-center gap-1 text-muted-foreground/70 text-xs"
												>
													<FolderGit2 className="size-3 shrink-0" aria-hidden />
													{checkoutLabel(worktree)}
												</span>
											) : undefined
										}
									/>
								</ul>
							)}
						</>
					)}
				</div>
			)}
		</>
	);
}

/**
 * A refresh affordance that spins while the data it refetches is in flight.
 *
 * The panel's two refresh buttons used to invalidate and look identical
 * afterwards, so on a repository large enough for the walk to take a moment the
 * only feedback was rows changing — or not, if nothing had. `useIsFetching` on
 * the same key the click invalidates is what makes the spin *report* rather than
 * merely reassure: it turns for exactly as long as there is work.
 *
 * **It stops on a rotation boundary**, via `animationiteration` rather than a
 * timer. A refetch that resolves in 20ms would otherwise flash a spinner for one
 * frame and stop the icon at whatever angle it reached, which reads as a glitch;
 * letting the current turn finish means the shortest possible refresh is one
 * clean rotation and a long one is a whole number of them. 600ms is that turn —
 * fast enough to look like a response to the click, slow enough to be a rotation
 * and not a blur.
 *
 * The spin is deliberately **not** behind `motion-safe:`, which would be the
 * house instinct: with the animation suppressed no `animationiteration` ever
 * fires, so the state that the event clears would latch on forever. A spinner is
 * also the essential-feedback case rather than decoration, and like
 * `StatusDot`'s pulse it moves only while something is actually happening.
 */
function RefreshButton({ label, queryKey }: { label: string; queryKey: readonly unknown[] }) {
	const queryClient = useQueryClient();
	const fetching = useIsFetching({ queryKey }) > 0;
	const [spinning, setSpinning] = useState(false);

	return (
		<IconButton
			aria-label={label}
			title={label}
			aria-busy={spinning}
			onClick={() => {
				setSpinning(true);
				void queryClient.invalidateQueries({ queryKey });
			}}
		>
			{/* The handler is re-attached every render, so it closes over the current
			    `fetching` — no ref needed to read it from inside the animation. */}
			<RefreshCw
				className={spinning ? 'animate-spin [animation-duration:600ms]' : undefined}
				onAnimationIteration={() => {
					if (!fetching) setSpinning(false);
				}}
			/>
		</IconButton>
	);
}

function TabButton({ tab, label }: { tab: PanelTab; label: string }) {
	const active = usePanelStore((s) => s.tab === tab);
	const setTab = usePanelStore((s) => s.setTab);

	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			className={`rounded px-1.5 py-0.5 font-medium text-sm transition-colors ${
				active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
			}`}
			onClick={() => setTab(tab)}
		>
			{label}
		</button>
	);
}

/** The project directory as a tree node, so the root row behaves like any
 *  other directory (chevron, expand, refetch). */
function rootEntry(root: string, name: string): DirEntry {
	return {
		name,
		path: root,
		isDir: true,
		isSymlink: false,
		symlinkOutsideRoot: false,
		size: 0,
		modifiedAt: null,
		// The project root itself is never dimmed, whatever git thinks of it.
		ignored: false,
	};
}
