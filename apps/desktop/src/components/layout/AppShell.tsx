import type { ReactNode } from 'react';
import { FileTreePanel } from '@components/files/FileTreePanel';
import { isMacOS } from '@lib/platform';
import { clampSidebarWidth, useSidebarStore } from '@store/sidebarStore';
import { PanelResizer } from './PanelResizer';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface AppShellProps {
	children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
	const sidebarWidth = useSidebarStore((s) => s.width);
	const setSidebarWidth = useSidebarStore((s) => s.setWidth);

	return (
		// The border is what gives the app a defined silhouette against the
		// desktop: sides and bottom only, since the titlebar already caps the top
		// and a border there would just double its edge. `overflow-hidden` keeps
		// the children (the sidebar's own border, its lighter background) inside
		// it.
		//
		// The bottom corners are rounded on macOS only. There the OS clips the
		// window to its own radius, so the curve we draw lands on transparent
		// pixels and the two agree. On Linux nothing clips: the WM gives us a
		// titlebar and no side or bottom frame (_NET_FRAME_EXTENTS = 0,0,36,0),
		// the window stays a hard rectangle, and `rounded-b-*` only carves the
		// fill away — leaving a dark wedge outside the arc with the border curving
		// off into it. Square there is the honest shape: the border then runs
		// unbroken into the corner the WM actually draws.
		<div
			className={`flex h-screen flex-col overflow-hidden border-border border-x border-b bg-background text-foreground ${
				isMacOS() ? 'rounded-b-xl' : ''
			}`}
		>
			<TopBar />
			<div className="flex min-h-0 flex-1">
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
					width={sidebarWidth}
					onWidth={setSidebarWidth}
					edge="right"
					label="Resize sidebar"
					clamp={clampSidebarWidth}
				/>
				<section className="min-w-0 flex-1 overflow-hidden">{children}</section>
				{/* Renders nothing when collapsed; follows the route's project. */}
				<FileTreePanel />
			</div>
		</div>
	);
}
