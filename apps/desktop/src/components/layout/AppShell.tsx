import type { ReactNode } from 'react';
import { FileTreePanel } from '@components/files/FileTreePanel';
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
		// The WM gives this window a 36px titlebar and no side or bottom frame
		// (_NET_FRAME_EXTENTS = 0,0,36,0): it rounds the two corners it draws, and
		// the bottom two are ours. `rounded-b-xl` is 12px, measured off the
		// titlebar's own arc so the two ends of the window agree.
		//
		// The border is what makes that curve legible. Rounding alone only bends
		// the fill, and at these values (`bg-card` 18% against `bg-background` 16%)
		// the result is invisible — the corner still reads as unfinished, with the
		// footer's border-t running out to nothing. A stroke along the rounded edge
		// gives the app a defined silhouette instead.
		//
		// Sides and bottom only: the titlebar already caps the top, so a border
		// there would just double its edge. `overflow-hidden` keeps the children
		// (the sidebar's own border, its lighter background) inside the curve.
		<div className="flex h-screen flex-col overflow-hidden rounded-b-xl border-border border-x border-b bg-background text-foreground">
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
