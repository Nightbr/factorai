import type { DirEntry } from '@factorai/types';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronsDownUp, RefreshCw, X } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@factorai/ui';
import { FileTreeNode } from '@components/files/FileTreeNode';
import { useActiveProject } from '@hooks/useActiveProject';
import { PanelResizer } from '@components/layout/PanelResizer';
import { usePanelStore } from '@store/panelStore';

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
			<PanelResizer width={width} onWidth={setWidth} />
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
				{/* A tab strip goes here when "Changes" lands next to "Files". */}
				<span className="flex-1 px-1 font-medium text-foreground text-xs">Files</span>
				<Button
					variant="ghost"
					size="icon"
					className="size-6"
					aria-label="Collapse all"
					title="Collapse all"
					disabled={!projectId}
					onClick={() => projectId && collapseAll(projectId)}
				>
					<ChevronsDownUp className="size-3.5 text-muted-foreground" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="size-6"
					aria-label="Refresh tree"
					title="Refresh tree"
					onClick={() => queryClient.invalidateQueries({ queryKey: ['dir'] })}
				>
					<RefreshCw className="size-3.5 text-muted-foreground" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="size-6"
					aria-label="Close file tree"
					title="Close file tree"
					onClick={() => setOpen(false)}
				>
					<X className="size-3.5 text-muted-foreground" />
				</Button>
			</header>

			<div className="min-h-0 flex-1 overflow-auto py-1">
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
			</div>
		</>
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
