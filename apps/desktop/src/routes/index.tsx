import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';

function IndexView() {
	return (
		<main className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
			<h2 className="text-xl font-semibold tracking-tight">factorai</h2>
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
