import { createHashHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { indexRoute } from './routes/index';
import { rootRoute } from './routes/__root';

const routeTree = rootRoute.addChildren([indexRoute]);

const router = createRouter({ routeTree, history: createHashHistory() });

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}

export function App() {
	return <RouterProvider router={router} />;
}
