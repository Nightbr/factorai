import { X } from 'lucide-react';
import { FileIcon } from '@components/files/FileIcon';
import type { ViewerTab } from '@store/viewerStore';

/** The file name, which is what a tab is labelled by. */
function baseName(path: string): string {
	const i = path.lastIndexOf('/');
	return i >= 0 ? path.slice(i + 1) : path;
}

interface FileTabsProps {
	tabs: ViewerTab[];
	active: string | null;
	onOpen: (tab: ViewerTab) => void;
	onPin: (path: string) => void;
	onClose: (path: string) => void;
}

/**
 * The viewer's strip of open files (F7, ADR-0037).
 *
 * Deliberately built on `SessionTabs`' shape — `h-7.5`, `rounded`, `px-2`, the
 * `secondary` ground for the active one, the × that appears on hover — because
 * two tab strips in one window that do not match are two strips you have to
 * learn. What it does **not** borrow is the drag-to-reorder: that is dnd-kit
 * plus a keyboard path (ADR-0016), and nobody has asked to order files yet.
 *
 * A **preview** tab is italic, and it is the one a single click in the tree
 * replaces. Italic rather than a second colour: colour in this app means state
 * a human has to act on (DESIGN.md, The One Amber Rule), and a preview tab is
 * not asking for anything.
 */
export function FileTabs({ tabs, active, onOpen, onPin, onClose }: FileTabsProps) {
	if (!tabs.length) return null;

	return (
		<div
			data-testid="file-tabs"
			role="tablist"
			aria-label="Open files"
			// `scrollbar-none`: the strip scrolls when the files outrun it, the same
			// way the session strip does, and a scrollbar inside a 30px row eats the
			// row. The row itself belongs to `ViewerPane`, which shares it with the
			// pane's two controls — one 36px strip rather than two, because the
			// column this sits in can be 400px wide.
			className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1"
		>
			{tabs.map((tab) => {
				const name = baseName(tab.path);
				const isActive = tab.path === active;
				return (
					<div
						key={tab.path}
						role="tab"
						aria-selected={isActive}
						tabIndex={0}
						data-testid="file-tab"
						data-preview={tab.preview}
						data-active={isActive}
						title={tab.path}
						className={`group flex h-7.5 max-w-60 shrink-0 cursor-pointer items-center gap-1.5 rounded px-2 text-sm ${
							isActive
								? 'bg-secondary text-foreground transition-colors'
								: 'text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground'
						}`}
						onClick={() => onOpen(tab)}
						// Double-click pins, on the tab as well as on the tree row, so
						// the gesture that promotes a preview is the same one wherever
						// you happen to be looking.
						onDoubleClick={() => onPin(tab.path)}
						// Middle-click closes, the way every tab strip does.
						onAuxClick={(e) => {
							if (e.button !== 1) return;
							e.preventDefault();
							onClose(tab.path);
						}}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								onOpen(tab);
							}
						}}
					>
						<FileIcon fileName={name} className="size-3.5 shrink-0" />
						<span className={`min-w-0 flex-1 truncate ${tab.preview ? 'italic' : ''}`}>{name}</span>
						{/* Only where the pointer already is, or on the active tab — a row
						    of permanent × buttons is a row of accidents waiting (F16). */}
						<button
							type="button"
							aria-label={`Close ${name}`}
							className={`-mr-1 rounded p-0.5 text-muted-foreground/70 transition-all hover:text-primary focus-visible:opacity-100 ${
								isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
							}`}
							onClick={(e) => {
								e.stopPropagation();
								onClose(tab.path);
							}}
						>
							<X className="size-3.5" />
						</button>
					</div>
				);
			})}
		</div>
	);
}
