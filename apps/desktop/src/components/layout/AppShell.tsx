import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { FileTreePanel } from '@components/files/FileTreePanel';
import { ShellDock } from '@components/terminal/ShellDock';
import { ViewerPane } from '@components/viewer/ViewerPane';
import { useActiveCheckout } from '@hooks/useActiveCheckout';
import { useFileViewer } from '@hooks/useFileViewer';
import { isMacOS } from '@lib/platform';
import {
	clampViewerWidth,
	maxViewerWidth,
	resolveViewerHost,
	type ViewerHost,
} from '@lib/viewerLayout';
import { usePanelStore } from '@store/panelStore';
import { clampSidebarWidth, useSidebarStore } from '@store/sidebarStore';
import { tabsFor, useViewerStore } from '@store/viewerStore';
import { PanelResizer } from './PanelResizer';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface AppShellProps {
	children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
	const sidebarWidth = useSidebarStore((s) => s.width);
	const setSidebarWidth = useSidebarStore((s) => s.setWidth);
	const panelOpen = usePanelStore((s) => s.open);
	const panelWidth = usePanelStore((s) => s.width);
	const viewerWidth = usePanelStore((s) => s.viewerWidth);
	const setViewerWidth = usePanelStore((s) => s.setViewerWidth);
	const viewer = useFileViewer();

	const shellWidth = useViewerStore((s) => s.shellWidth);
	const setShellWidth = useViewerStore((s) => s.setShellWidth);
	const host = useViewerStore((s) => s.host);
	const setHost = useViewerStore((s) => s.setHost);
	const setCheckout = useViewerStore((s) => s.setCheckout);

	// **Which checkout the open files belong to** (F21, ADR-0037). Set from here
	// rather than from the panel because the panel can be closed, and a file
	// opened from a terminal link with no panel showing still belongs to a tree.
	const { root } = useActiveCheckout();
	useEffect(() => {
		setCheckout(root ?? null);
	}, [root, setCheckout]);

	// The shell row measures itself, because the host rule is about the room
	// there actually is (ADR-0037) — the window's own size says nothing once the
	// sidebar has been dragged to 480.
	const row = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = row.current;
		if (!el) return;
		setShellWidth(el.getBoundingClientRect().width);
		const observer = new ResizeObserver(([entry]) => setShellWidth(entry.contentRect.width));
		observer.observe(el);
		return () => observer.disconnect();
	}, [setShellWidth]);

	// A closed panel is not a 288px panel: with the tree hidden the column has
	// that much more room, and the rule has to see it.
	const effectivePanelWidth = panelOpen ? panelWidth : 0;
	const nextHost: ViewerHost = resolveViewerHost({
		shellWidth,
		sidebarWidth,
		columnPanelWidth: effectivePanelWidth,
		current: host,
	});
	useEffect(() => {
		setHost(nextHost);
	}, [nextHost, setHost]);

	// **Restore what was open, once per checkout** (ADR-0037). `?file=` does not
	// persist — it is the live answer — so the last file read in this checkout is
	// what re-seeds it on launch and when you come back to a project. A URL that
	// already names a file wins: a deep link, a terminal click and the IDE
	// bridge all arrive that way and must not be overwritten by history.
	const restored = useRef(new Set<string>());
	useEffect(() => {
		if (!root || viewer.path || restored.current.has(root)) return;
		restored.current.add(root);
		const state = useViewerStore.getState();
		const last = state.activeByCheckout[root];
		if (!last) return;
		const tab = tabsFor(state, root).find((t) => t.path === last);
		viewer.open(last, { diff: tab?.diff ?? undefined });
	}, [root, viewer.path, viewer.open]);

	// **A closed panel leaves only one host.** The split lives inside the panel,
	// so with the panel collapsed a `split` answer would render the viewer
	// nowhere at all — a file opened from a terminal link with no tree showing
	// would look like a broken link, which is the failure ADR-0037 names.
	const showColumn = viewer.path !== null && (host === 'column' || !panelOpen);

	return (
		// The border is what gives the app a defined silhouette against the
		// desktop: sides and bottom only, since the titlebar already caps the top
		// and a border there would just double its edge. `overflow-hidden` keeps
		// the children (the sidebar's own border, its lighter background) inside
		// it.
		//
		// The bottom corners are rounded on macOS only, where the OS clips the
		// window to its own radius and the curve we carve lands on pixels it has
		// already discarded. Linux clips nothing: `border-radius` there takes a
		// bite out of the shell and whatever paints behind it fills the gap, so
		// the corner comes out as a wedge of background sitting over the arc the
		// WM draws on its frame — worse than no curve at all. Making the window
		// transparent does fix the geometry, and was tried; it exposes the
		// compositor's drop shadow through the notch instead, which is a smudge
		// where the wedge was. Square, with the border running unbroken into the
		// corner, is the least-bad shape there. See Q21.
		<div
			className={`flex h-screen flex-col overflow-hidden border-border border-x border-b bg-background text-foreground ${
				isMacOS() ? 'rounded-b-xl' : ''
			}`}
		>
			<TopBar />
			<div ref={row} className="flex min-h-0 flex-1">
				<aside
					data-testid="sidebar"
					style={{ width: sidebarWidth }}
					className="flex shrink-0 flex-col border-r border-border bg-card"
				>
					<Sidebar />
				</aside>
				{/* Mirror of the file panel's handle: this one is on the sidebar's
				    right edge, so dragging right widens it. */}
				<PanelResizer
					size={sidebarWidth}
					onSize={setSidebarWidth}
					edge="right"
					label="Resize sidebar"
					clamp={clampSidebarWidth}
				/>
				{/* The route above, the project's shell footer below (F23, ADR-0032).
				    Inside this column and not spanning the window, so the file panel
				    keeps its full height and the footer is the width of the thing it
				    belongs to. The dock renders nothing where the route has no
				    project. */}
				<section className="flex min-w-0 flex-1 flex-col overflow-hidden">
					<div className="min-h-0 flex-1 overflow-hidden">{children}</div>
					<ShellDock />
				</section>
				{/* **The viewer's own column** (ADR-0037), between the session and the
				    tree. Only where the shell can hold four columns — under that
				    width the same pane is rendered by `FileTreePanel`, split under the
				    tree — and only with a file open, so nothing open gives the
				    session the width back. */}
				{showColumn && (
					<>
						<PanelResizer
							size={viewerWidth}
							onSize={(width) =>
								setViewerWidth(width, maxViewerWidth(shellWidth, sidebarWidth, effectivePanelWidth))
							}
							edge="left"
							label="Resize file viewer"
							clamp={(width) =>
								clampViewerWidth(
									width,
									maxViewerWidth(shellWidth, sidebarWidth, effectivePanelWidth),
								)
							}
						/>
						<aside
							data-testid="viewer-column"
							style={{ width: viewerWidth }}
							className="flex shrink-0 flex-col overflow-hidden border-l border-border"
						>
							<ViewerPane />
						</aside>
					</>
				)}
				{/* Renders nothing when collapsed; follows the route's project. */}
				<FileTreePanel />
			</div>
		</div>
	);
}
