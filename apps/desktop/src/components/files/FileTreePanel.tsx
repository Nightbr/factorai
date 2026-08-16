import type { DirEntry } from '@factorai/types';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronsDownUp, RefreshCw, X } from 'lucide-react';
import { useEffect } from 'react';
import { IconButton } from '@factorai/ui';
import { ChangesView } from '@components/files/ChangesView';
import { FileTreeNode } from '@components/files/FileTreeNode';
import { useActiveProject } from '@hooks/useActiveProject';
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
				width={width}
				onWidth={setWidth}
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
	const { projectId, project, root, isLoading } = useActiveProject();
	const tab = usePanelStore((s) => s.tab);
	const setOpen = usePanelStore((s) => s.setOpen);
	const collapseAll = usePanelStore((s) => s.collapseAll);
	const seedRoot = usePanelStore((s) => s.seedRoot);
	const queryClient = useQueryClient();

	useEffect(() => {
		if (projectId && root) seedRoot(projectId, root);
	}, [projectId, root, seedRoot]);

	return (
		<>
			<header className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
				{/* Two tabs, hardcoded — not a registry (Q18). */}
				<div className="flex flex-1 items-center gap-0.5" role="tablist" aria-label="Panel">
					<TabButton tab="files" label="Files" />
					<TabButton tab="changes" label="Changes" />
				</div>
				{tab === 'files' && (
					<>
						<IconButton
							aria-label="Collapse all"
							title="Collapse all"
							disabled={!projectId}
							onClick={() => projectId && collapseAll(projectId)}
						>
							<ChevronsDownUp />
						</IconButton>
						<IconButton
							aria-label="Refresh tree"
							title="Refresh tree"
							onClick={() => queryClient.invalidateQueries({ queryKey: ['dir'] })}
						>
							<RefreshCw />
						</IconButton>
					</>
				)}
				<IconButton
					aria-label="Close file tree"
					title="Close file tree"
					onClick={() => setOpen(false)}
				>
					<X />
				</IconButton>
			</header>

			{/* `pr-2` is the scrollbar gutter: with a long tree or a big change
			    set, rows would otherwise run under the scrollbar. */}
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
								/>
							</ul>
						)}
					</>
				)}
			</div>
		</>
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
			className={`rounded px-1.5 py-0.5 font-medium text-xs transition-colors ${
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

function Empty({ children }: { children: string }) {
	return <p className="px-3 py-2 text-muted-foreground text-xs">{children}</p>;
}
