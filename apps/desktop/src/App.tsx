import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHashHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { indexRoute } from './routes/index';
import { projectRoute } from './routes/project';
import { rootRoute } from './routes/__root';
import { searchRoute } from './routes/search';
import { sessionRoute } from './routes/session';

const routeTree = rootRoute.addChildren([indexRoute, projectRoute, sessionRoute, searchRoute]);

const router = createRouter({ routeTree, history: createHashHistory() });

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			staleTime: 1000,
		},
	},
});

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
}
