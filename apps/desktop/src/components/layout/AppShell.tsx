import type { ReactNode } from 'react';
import { FileTreePanel } from '@components/files/FileTreePanel';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface AppShellProps {
	children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
	return (
		<div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
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
