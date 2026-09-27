import { BrandWordmark } from '@components/brand/Brand';
import { FirstRunHero } from '@components/layout/FirstRunHero';
import { queryKeys } from '@lib/queryKeys';
import { cmd } from '@lib/tauri';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';

function IndexView() {
	// The sidebar's own query, read from the same cache: the hero and the list
	// can then never disagree about whether the workspace is empty. The sidebar
	// owns the polling.
	const sidebarQ = useQuery({ queryKey: queryKeys.sidebar(), queryFn: () => cmd.listSidebar() });
	if (sidebarQ.data && sidebarQ.data.length === 0) return <FirstRunHero />;
	return (
		<main className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
			{/* The same lockup as the header, one size up — the name is set one way
			    in this app, not two. */}
			<h2>
				<BrandWordmark className="text-xl" />
			</h2>
			<p className="text-muted-foreground text-sm">
				Select a project from the sidebar to see its sessions.
			</p>
		</main>
	);
}

export const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/',
	component: IndexView,
});
