import { Brand } from '@components/brand/Brand';
import { DevBadge } from '@components/layout/DevBadge';
import { SessionTabs } from '@components/layout/SessionTabs';
import { IconButton } from '@factorai/ui';
import { useSettingsModal } from '@hooks/useSettingsModal';
import { usePanelStore } from '@store/panelStore';
import { PanelRight, Settings } from 'lucide-react';

/**
 * Full-window header. Deliberately spans above the sidebar too: this is the
 * shape the custom titlebar needs when we drop the OS decorations and
 * reimplement minimise / maximise / close (specs/06-milestones.md M5), so that
 * step becomes "add buttons" rather than "restructure the shell".
 */
export function TopBar() {
	const open = usePanelStore((s) => s.open);
	const toggle = usePanelStore((s) => s.toggle);
	const settings = useSettingsModal();

	return (
		<header className="flex h-10.5 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
			<Brand />
			<DevBadge />

			{/* Tabs take the middle. They render nothing when no session is live, so
			    the bar looks exactly as it did before the first one starts. Window
			    controls land right of the panel toggle when M5 drops the OS
			    decorations; the drag region will have to share this row with them. */}
			{/* The middle is always this one flex-1 box, whether or not there are
			    tabs in it. A bare <SessionTabs /> renders nothing with no session
			    live, which left the panel toggle sitting against the wordmark; a
			    sibling spacer instead would split the row with the strip and halve
			    the width it can scroll within. One element does both jobs. */}
			<div className="flex min-w-0 flex-1 items-center">
				<SessionTabs />
			</div>

			{/* Settings is app-level chrome, so it lives here rather than in the
			    sidebar footer — which is also already over-full (F14). Left of the
			    panel toggle, and item 6's window controls sit at the window's outer
			    edge, so this moves once by a fixed offset when they land rather than
			    competing for the same pixels. */}
			<IconButton
				size="md"
				aria-label="Settings"
				title="Settings"
				data-testid="open-settings"
				onClick={() => settings.open()}
			>
				<Settings />
			</IconButton>

			{/* **One colour for both, changed 2026-08-20 on user feedback.** This
			    button used to take full `foreground` while the panel was open, on the
			    reasoning that open is a state rather than a hover. The rule is right
			    for a list row and wrong here: the 288px panel is either on screen or
			    it is not, so the colour was restating something impossible to miss —
			    and it made two neighbouring icons in the same row disagree about what
			    a header icon looks like. `aria-pressed` still carries the state where
			    it is not otherwise visible. */}
			<IconButton
				size="md"
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
