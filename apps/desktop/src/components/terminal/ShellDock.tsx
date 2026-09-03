import { PanelResizer } from '@components/layout/PanelResizer';
import { ShellFooter } from '@components/terminal/ShellFooter';
import { ShellPane } from '@components/terminal/ShellPane';
import { useActiveCheckout } from '@hooks/useActiveCheckout';
import { clampShellHeight, usePanelStore } from '@store/panelStore';
import { useShellStore } from '@store/shellStore';

/**
 * The project's shell footer and the split above it
 * (`specs/05-features.md` § F23, F24; ADR-0032).
 *
 * **It lives here, under the app shell's content column, and not in a route.**
 * The terminals belong to the project, so the strip is drawn on every view that
 * has one — the project page, a session, a sub-agent transcript — and rendering
 * it per route would tear every pane's host out of the document on each
 * navigation. That costs a remeasure and, on macOS, one click before the wheel
 * works, on panes that never went anywhere. Here the row is the same element
 * across a session switch, which is what lets it genuinely follow you.
 *
 * **Nothing is drawn where there is no project** — `/` and `/search`. There is
 * no directory a shell could start in, so the bottom band there is the sidebar
 * footer alone, exactly as it was.
 *
 * The split is docked at the bottom and grows upwards, so the handle is on its
 * top edge — the same arrangement the graph's commit detail uses. One global
 * height (ADR-0013): a height you dragged is layout, not a preference.
 */
export function ShellDock() {
	// The same hook that roots the file panel beside this one, and the reason no
	// plumbing is needed: it reads the route's project whatever the parameter is
	// called, and resolves the session's checkout when the route has a session
	// (F21). On the project page that falls through to the project's own folder,
	// which is where a shell opened from there should start.
	const { projectId, root, projectRoot } = useActiveCheckout();
	// `hasChip` rather than the chip: this only decides whether the pane and its
	// handle are rendered, and subscribing to the array would re-render the dock
	// on every split. **The active chip, not the list** — a collapsed footer
	// keeps its shells running with no pane on screen (F23), so "is the split
	// showing" is a question about which chip is selected.
	const shellOpen = useShellStore((s) =>
		Boolean(projectId ? s.activeByProject[projectId] : undefined),
	);
	const shellHeight = usePanelStore((s) => s.shellHeight);
	const setShellHeight = usePanelStore((s) => s.setShellHeight);

	if (!projectId) return null;

	return (
		<>
			{shellOpen && (
				<>
					<PanelResizer
						size={shellHeight}
						onSize={setShellHeight}
						edge="top"
						label="Resize shell"
						clamp={clampShellHeight}
					/>
					<div style={{ height: shellHeight }} className="shrink-0 overflow-hidden">
						<ShellPane projectId={projectId} />
					</div>
				</>
			)}
			<ShellFooter
				projectId={projectId}
				// The session's checkout when the route has one (F21), the project
				// root otherwise: a shell beside an agent working in a worktree is
				// useless pointed at a different tree.
				cwd={root ?? projectRoot}
				projectRoot={projectRoot}
			/>
		</>
	);
}
