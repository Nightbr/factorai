import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';

function IndexView() {
	return (
		<main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
			<h1 className="text-4xl font-bold tracking-tight">factorai</h1>
			<p className="text-muted-foreground text-sm">
				Command center for Claude Code sessions
			</p>
			<p className="text-xs text-muted-foreground/70">M0 scaffold — nothing wired up yet</p>
		</main>
	);
}

export const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/',
	component: IndexView,
});
