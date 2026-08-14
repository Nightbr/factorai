import { IconButton } from '@factorai/ui';
import { FolderGit2, PanelRight } from 'lucide-react';
import { SessionTabs } from '@components/layout/SessionTabs';
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

			{/* Tabs take the middle. They render nothing when no session is live, so
			    the bar looks exactly as it did before the first one starts. Window
			    controls land right of the panel toggle when M5 drops the OS
			    decorations; the drag region will have to share this row with them. */}
			<SessionTabs />
			<div className="flex-1" />

			<IconButton
				size="md"
				// Open is a state, not a hover: it keeps full foreground colour so the
				// panel's visibility is readable without reaching for the mouse.
				className={open ? 'text-foreground' : undefined}
				aria-label="Toggle file tree"
				aria-pressed={open}
				title="Toggle file tree"
				onClick={toggle}
			>
				<PanelRight />
			</IconButton>
		</header>
	);
}
