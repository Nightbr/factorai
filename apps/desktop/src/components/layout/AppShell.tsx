import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';

interface AppShellProps {
	children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
	return (
		<div className="flex h-screen overflow-hidden bg-background text-foreground">
			<aside className="flex w-64 flex-col border-r border-border bg-card">
				<Sidebar />
			</aside>
			<section className="flex-1 overflow-hidden">{children}</section>
		</div>
	);
}
