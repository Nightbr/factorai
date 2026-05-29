import { useQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { rootRoute } from './__root';

function SearchView() {
	const { q } = searchRoute.useSearch();
	const query = q.trim();

	const hitsQ = useQuery({
		queryKey: queryKeys.search(query, null),
		queryFn: () => cmd.searchSessions(query),
		enabled: query.length > 0,
	});

	const hits = hitsQ.data;

	return (
		<main className="flex h-full flex-col bg-background">
			<header className="flex items-baseline gap-2 border-b border-border px-4 py-3">
				<h2 className="font-semibold text-sm">Search</h2>
				{query && <span className="truncate text-muted-foreground text-sm">"{query}"</span>}
				{hits && (
					<span className="ml-auto tabular-nums text-muted-foreground text-xs">
						{hits.length} {hits.length === 1 ? 'result' : 'results'}
					</span>
				)}
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto">
				{!query && (
					<p className="p-4 text-muted-foreground text-sm">
						Type a query in the sidebar to search across all session content.
					</p>
				)}
				{query && hitsQ.isLoading && (
					<p className="p-4 text-muted-foreground text-sm">Searching…</p>
				)}
				{query && hits && hits.length === 0 && (
					<p className="p-4 text-muted-foreground text-sm">No matches for "{query}".</p>
				)}

				<ul className="divide-y divide-border">
					{hits?.map((h) => (
						<li key={`${h.sessionId}::${h.role}::${h.snippet}`}>
							<Link
								to="/projects/$projectId/sessions/$sessionId"
								params={{ projectId: h.projectId, sessionId: h.sessionId }}
								className="block px-4 py-3 transition-colors hover:bg-secondary/50"
							>
								<div className="flex items-center gap-2">
									<span className="min-w-0 flex-1 truncate font-medium text-sm">
										{h.title || h.sessionId}
									</span>
									<span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-muted-foreground text-xs">
										{h.role}
									</span>
								</div>
								<p className="mt-1 line-clamp-2 text-muted-foreground text-xs">{h.snippet}</p>
							</Link>
						</li>
					))}
				</ul>
			</div>
		</main>
	);
}

export const searchRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/search',
	validateSearch: (search: Record<string, unknown>): { q: string } => ({
		q: typeof search.q === 'string' ? search.q : '',
	}),
	component: SearchView,
});
