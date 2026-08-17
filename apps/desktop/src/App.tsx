import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHashHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
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

/**
 * The boundary sits **outside** the providers, not inside them. A crash while
 * constructing the router or the query client is exactly the kind this has to
 * catch, and a boundary nested under them would go down with them.
 */
export function App() {
	return (
		<ErrorBoundary>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</ErrorBoundary>
	);
}
