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
