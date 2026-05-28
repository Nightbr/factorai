import { createRootRoute, Outlet } from '@tanstack/react-router';

function RootLayout() {
	return (
		<div className="min-h-screen bg-background text-foreground font-sans">
			<Outlet />
		</div>
	);
}

export const rootRoute = createRootRoute({ component: RootLayout });
