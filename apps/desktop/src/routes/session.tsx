import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { EventLog } from '@components/sessions/EventLog';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { rootRoute } from './__root';

const PAGE_LIMIT = 500;

function SessionView() {
	const { sessionId } = sessionRoute.useParams();
	const q = useQuery({
		queryKey: queryKeys.session(sessionId, 0, PAGE_LIMIT),
		queryFn: () => cmd.getSession(sessionId, 0, PAGE_LIMIT),
	});

	return (
		<main className="flex h-full flex-col">
			<header className="border-b border-border bg-card px-6 py-3">
				<h2 className="font-mono text-xs text-muted-foreground">{sessionId}</h2>
				{q.data && (
					<p className="text-muted-foreground text-xs">
						{q.data.events.length} of {q.data.total} turn{q.data.total === 1 ? '' : 's'}
					</p>
				)}
			</header>
			<div className="flex-1 overflow-auto">
				{q.isLoading && <p className="p-6 text-muted-foreground text-sm">Loading…</p>}
				{q.error && (
					<p className="p-6 text-destructive text-sm">
						Failed to load session: {String(q.error)}
					</p>
				)}
				{q.data && <EventLog events={q.data.events} />}
			</div>
		</main>
	);
}

export const sessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/projects/$projectId/sessions/$sessionId',
	component: SessionView,
});
