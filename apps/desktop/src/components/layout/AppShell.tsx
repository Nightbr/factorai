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
import {
	clampSidebarWidth,
	effectiveSidebarWidth,
	SIDEBAR_RAIL_WIDTH,
	useSidebarStore,
} from '@store/sidebarStore';
import { tabsFor, useViewerStore } from '@store/viewerStore';
import { PanelResizer } from './PanelResizer';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface AppShellProps {
	children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
	const storedSidebarWidth = useSidebarStore((s) => s.width);
	const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
	const setSidebarWidth = useSidebarStore((s) => s.setWidth);
	// **What the layout is told**, which is the rail's 48 while collapsed (F1,
	// ADR-0038). Every rule below asks how much room the sidebar is taking, and
	// a collapsed sidebar answering 256 makes the shell believe it has less than
	// it has — the viewer's column would then refuse to appear at a width where
	// it now fits. Same shape as `effectivePanelWidth` two lines down.
	const sidebarWidth = effectiveSidebarWidth(storedSidebarWidth, sidebarCollapsed);
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

	// **The URL and the strip, kept agreed for the checkout in front**
	// (ADR-0037). Two rules in one effect because they are two halves of the
	// same invariant and they fight if they run apart — on a checkout change the
	// second has to win before the first sees a path belonging to the checkout
	// we just left (ADR-0042).
	//
	// **Re-seed `?file=` from this checkout's history** on launch and whenever
	// the checkout changes. `?file=` survives a navigation now — the root
	// route's retain middleware, ADR-0042 — but it cannot survive a *switch of
	// subject*: a session working in a linked worktree has its own strip
	// (F21), and the file the last one was reading is not in its tree. On
	// launch a URL that already names a file wins — a deep link, a terminal
	// click and the IDE bridge all arrive that way and must not be overwritten
	// by history.
	//
	// A checkout with no history of its own leaves whatever is showing alone
	// rather than closing the viewer. `root` resolves in two steps for a session
	// in a worktree — the project's folder first, the worktree once
	// `gitWorktrees` answers — so closing here would shut a deep link the moment
	// the second step landed.
	//
	// **The strip always holds the file that is showing.** `?file=` can arrive
	// without passing through `open()` — a reload restores it from the URL, and
	// a deep link starts the app with it — and the checkout it belongs to is not
	// known until the route resolves, so an `openTab` at that moment would have
	// had nowhere to put it. Both cases end with a file in the viewer and no tab
	// for it, which reads as a strip that has lost track of what you are looking
	// at. Found in the dev app, after a reload (ADR-0037). A preview tab,
	// because nothing about restoring a URL says the file was pinned.
	const seen = useRef<string | null>(null);
	useEffect(() => {
		if (!root) return;
		const state = useViewerStore.getState();
		// `setCheckout` above runs first, so this only holds on the render the
		// route resolved on — and re-seeding against the old checkout's tabs is
		// exactly what it is here to prevent.
		if (state.checkout !== root) return;

		const first = seen.current === null;
		const switched = !first && seen.current !== root;
		seen.current = root;

		if (switched || (first && !viewer.path)) {
			const last = state.activeByCheckout[root];
			if (last && last !== viewer.path) {
				const tab = tabsFor(state, root).find((t) => t.path === last);
				// Restored **as it was left**, preview included: reopening it as a
				// pinned tab would silently promote it, and the next click in the
				// tree would then append beside it instead of replacing it.
				viewer.open(last, { diff: tab?.diff ?? undefined, preview: tab?.preview });
				return;
			}
		}

		if (!viewer.path) return;
		if (tabsFor(state, root).some((t) => t.path === viewer.path)) return;
		state.openTab(viewer.path, { preview: true, diff: viewer.diff });
	}, [root, viewer.path, viewer.diff, viewer.open]);

	// **The stored width is clamped on every render, not only on drag.** A width
	// dragged wide in a big window, or restored from a previous launch, would
	// otherwise be applied verbatim in a smaller one and take the columns out of
	// the session — which is the floor the whole rule exists to protect
	// (ADR-0037). At the threshold this resolves to exactly `MIN_VIEWER_WIDTH`.
	const appliedViewerWidth = clampViewerWidth(
		viewerWidth,
		maxViewerWidth(shellWidth, sidebarWidth, effectivePanelWidth),
	);

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
					style={{ width: sidebarCollapsed ? SIDEBAR_RAIL_WIDTH : storedSidebarWidth }}
					className="flex shrink-0 flex-col border-r border-border bg-card"
				>
					<Sidebar />
				</aside>
				{/* Mirror of the file panel's handle: this one is on the sidebar's
				    right edge, so dragging right widens it.

				    **Not rendered while collapsed** (F1, ADR-0038). The rail is a
				    fixed width, and a handle that resizes nothing is a handle that
				    lies. There is no drag-to-collapse either: the clamp keeps its
				    180px floor, because a width and a collapse are different
				    questions. */}
				{!sidebarCollapsed && (
					<PanelResizer
						size={storedSidebarWidth}
						onSize={setSidebarWidth}
						edge="right"
						label="Resize sidebar"
						clamp={clampSidebarWidth}
					/>
				)}
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
							size={appliedViewerWidth}
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
							style={{ width: appliedViewerWidth }}
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
