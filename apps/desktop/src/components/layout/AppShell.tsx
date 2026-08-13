import type { ReactNode } from 'react';
import { FileTreePanel } from '@components/files/FileTreePanel';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface AppShellProps {
	children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
	return (
		// `rounded-b-xl` matches the window's own corner radius. The WM gives this
		// window a 36px titlebar and no side or bottom frame
		// (_NET_FRAME_EXTENTS = 0,0,36,0), so the bottom corners are ours to draw:
		// it rounds the top two itself and left our square ones showing beneath.
		// Top corners stay square — the titlebar covers them.
		//
		// The existing `overflow-hidden` is what makes this work, clipping the
		// sidebar's border and lighter `bg-card` to the curve instead of letting
		// them run into the corner. Nothing shows through: `body` is `bg-background`,
		// the same colour as this element.
		<div className="flex h-screen flex-col overflow-hidden rounded-b-xl bg-background text-foreground">
			<TopBar />
			<div className="flex min-h-0 flex-1">
				<aside className="flex w-64 flex-col border-r border-border bg-card">
					<Sidebar />
				</aside>
				<section className="min-w-0 flex-1 overflow-hidden">{children}</section>
				{/* Renders nothing when collapsed; follows the route's project. */}
				<FileTreePanel />
			</div>
		</div>
	);
}
