import { Button } from '@factorai/ui';
import { FolderGit2, PanelRight } from 'lucide-react';
import { usePanelStore } from '@store/panelStore';

/**
 * Full-window header. Deliberately spans above the sidebar too: this is the
 * shape the custom titlebar needs when we drop the OS decorations and
 * reimplement minimise / maximise / close (specs/06-milestones.md M5), so that
 * step becomes "add buttons" rather than "restructure the shell".
 */
export function TopBar() {
	const open = usePanelStore((s) => s.open);
	const toggle = usePanelStore((s) => s.toggle);

	return (
		<header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
			<FolderGit2 className="size-4 text-primary" />
			<span className="font-semibold text-sm tracking-tight">factorai</span>

			{/* Reserved: global search lands here, then window controls to the
			    right of the panel toggle. */}
			<div className="flex-1" />

			<Button
				variant="ghost"
				size="icon"
				className="size-7"
				aria-label="Toggle file tree"
				aria-pressed={open}
				title="Toggle file tree"
				onClick={toggle}
			>
				<PanelRight className={open ? 'text-foreground' : 'text-muted-foreground'} />
			</Button>
		</header>
	);
}
