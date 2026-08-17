import { BrandWordmark } from '@components/brand/Brand';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';

function IndexView() {
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
