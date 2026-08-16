import type { DirEntry } from '@factorai/types';
import { ContextMenu, ContextMenuTrigger } from '@factorai/ui';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, Link2, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { FileIcon } from '@components/files/FileIcon';
import { type CopyOutcome, FileRowMenu } from '@components/files/FileRowMenu';
import { useFileViewer } from '@hooks/useFileViewer';
import { DECORATION_CLASSES, useGitDecorations } from '@hooks/useGitDecorations';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { expandedFor, usePanelStore } from '@store/panelStore';

/** px of indent per level. Tight — the panel is narrow. */
const INDENT = 12;

/** Rows go stale as claude edits files; 15s plus refetch-on-focus keeps them
 *  honest without a watcher (specs/05-features.md F12). */
const DIR_STALE_MS = 15_000;

function errorText(e: unknown): string {
	// Tauri rejects with the serialised AppError: { kind, message }.
	if (e && typeof e === 'object' && 'message' in e) {
		return String((e as { message: unknown }).message);
	}
	return String(e);
}

interface FileTreeNodeProps {
	entry: DirEntry;
	/** Project root, passed to list_dir so it can flag escaping symlinks. */
	root: string;
	projectId: string;
	depth: number;
}

export function FileTreeNode({ entry, root, projectId, depth }: FileTreeNodeProps) {
	const expanded = usePanelStore((s) => expandedFor(s, projectId).has(entry.path));
	const selected = usePanelStore((s) => s.selectedPath === entry.path);
	const toggleExpanded = usePanelStore((s) => s.toggleExpanded);
	const select = usePanelStore((s) => s.select);
	const { open: openViewer } = useFileViewer();
	const decorations = useGitDecorations();
	const decoration = decorations.get(entry.path);
	const [menuOpen, setMenuOpen] = useState(false);
	// The menu has closed by the time a copy resolves, so the acknowledgement
	// belongs on the row that was acted on — the transient tick the viewer's
	// copy-path button already uses. A toast would be the other answer and
	// there still isn't one (roadmap item 7).
	const [copied, setCopied] = useState<CopyOutcome | null>(null);

	function reportCopy(outcome: CopyOutcome) {
		setCopied(outcome);
		setTimeout(() => setCopied(null), 1400);
	}

	// A symlink pointing out of the project is shown but not walked.
	const canExpand = entry.isDir && !entry.symlinkOutsideRoot;

	const listing = useQuery({
		queryKey: queryKeys.dir(entry.path),
		queryFn: () => cmd.listDir(entry.path, root),
		enabled: canExpand && expanded,
		staleTime: DIR_STALE_MS,
		refetchOnWindowFocus: true,
	});

	function activate() {
		select(entry.path);
		if (canExpand) {
			toggleExpanded(projectId, entry.path);
		} else if (!entry.isDir) {
			// Single click opens the viewer (F7). "Open in default app" lives in
			// the viewer's header rather than on a double-click: the first click of
			// a double-click already opens the modal, and the second would land on
			// its overlay.
			openViewer(entry.path);
		}
	}

	const hint = entry.symlinkOutsideRoot
		? `${entry.path} — symlink outside the project, not expandable`
		: entry.path;

	return (
		<li>
			<ContextMenu onOpenChange={setMenuOpen}>
				<ContextMenuTrigger asChild>
					<button
						type="button"
						title={hint}
						aria-expanded={canExpand ? expanded : undefined}
						style={{ paddingLeft: depth * INDENT + 6 }}
						className={`group flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-sm transition-colors ${
							selected
								? 'bg-secondary text-foreground'
								: 'text-muted-foreground hover:bg-secondary/50'
						}`}
						onClick={activate}
						// The menu acts on one row — `panelStore` has a single
						// `selectedPath` and the tree has no multi-select — so the row it
						// acts on has to be the one you can see it acting on.
						onContextMenu={() => select(entry.path)}
					>
						{entry.isDir ? (
							<ChevronRight
								className={`size-3.5 shrink-0 text-muted-foreground transition-all group-hover:text-primary ${
									expanded ? 'rotate-90' : ''
								} ${canExpand ? '' : 'opacity-30'}`}
							/>
						) : (
							<FileIcon fileName={entry.name} />
						)}
						<span
							className={`min-w-0 flex-1 truncate ${
								decoration && !entry.isDir ? DECORATION_CLASSES[decoration] : ''
							} ${entry.ignored ? 'opacity-45' : ''}`}
						>
							{entry.name}
						</span>
						{entry.isSymlink && <Link2 className="size-3 shrink-0 text-muted-foreground/60" />}
						{copied === 'yes' && (
							<Check data-testid="row-copied" className="size-3.5 shrink-0 text-primary" />
						)}
						{copied === 'failed' && (
							<X data-testid="row-copy-failed" className="size-3.5 shrink-0 text-destructive" />
						)}
						{/* A directory says "there is something in here" with a dot rather than
				    a colour: at depth, a coloured folder name reads as a changed file. */}
						{decoration && entry.isDir && (
							<span
								aria-hidden="true"
								data-testid="git-dot"
								className={`size-1.5 shrink-0 rounded-full bg-current ${DECORATION_CLASSES[decoration]}`}
							/>
						)}
					</button>
				</ContextMenuTrigger>
				<FileRowMenu
					entry={entry}
					root={root}
					onOpen={entry.isDir ? undefined : () => openViewer(entry.path)}
					onCopied={reportCopy}
					menuOpen={menuOpen}
				/>
			</ContextMenu>

			{canExpand && expanded && (
				<ul>
					{listing.isPending && <Placeholder depth={depth + 1}>…</Placeholder>}
					{listing.isError && (
						<Placeholder depth={depth + 1} tone="error">
							{errorText(listing.error)}
						</Placeholder>
					)}
					{listing.data?.entries.length === 0 && <Placeholder depth={depth + 1}>empty</Placeholder>}
					{listing.data?.entries.map((child) => (
						<FileTreeNode
							key={child.path}
							entry={child}
							root={root}
							projectId={projectId}
							depth={depth + 1}
						/>
					))}
					{listing.data?.truncated && (
						<Placeholder depth={depth + 1}>
							… {listing.data.total - listing.data.entries.length} more entries
						</Placeholder>
					)}
				</ul>
			)}
		</li>
	);
}

interface PlaceholderProps {
	depth: number;
	tone?: 'muted' | 'error';
	children: ReactNode;
}

/** Non-interactive row: loading, empty, truncated, or an unreadable directory. */
function Placeholder({ depth, tone = 'muted', children }: PlaceholderProps) {
	return (
		<li
			style={{ paddingLeft: depth * INDENT + 6 + 20 }}
			className={`py-[3px] pr-2 text-xs ${
				tone === 'error' ? 'text-destructive' : 'text-muted-foreground/60'
			}`}
		>
			{children}
		</li>
	);
}
