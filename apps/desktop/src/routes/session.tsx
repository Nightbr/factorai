import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { EventLog } from '@components/sessions/EventLog';
import { Terminal } from '@components/terminal/Terminal';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { rootRoute } from './__root';

const PAGE_LIMIT = 500;

function SessionView() {
	const { sessionId, projectId } = sessionRoute.useParams();

	const sessionQ = useQuery({
		queryKey: queryKeys.session(sessionId, 0, PAGE_LIMIT),
		queryFn: () => cmd.getSession(sessionId, 0, PAGE_LIMIT),
	});

	const projectsQ = useQuery({
		queryKey: queryKeys.projects(),
		queryFn: () => cmd.listProjects(),
	});
	const projectCwd = projectsQ.data?.find((p) => p.id === projectId)?.realPath ?? null;

	return (
		<main className="flex h-full flex-col">
			<header className="border-b border-border bg-card px-6 py-3">
				<h2 className="font-mono text-xs text-muted-foreground">{sessionId}</h2>
				{sessionQ.data && (
					<p className="text-muted-foreground text-xs">
						{sessionQ.data.events.length} of {sessionQ.data.total} turn
						{sessionQ.data.total === 1 ? '' : 's'}
					</p>
				)}
			</header>
			<div className="grid flex-1 grid-rows-[1fr_320px] overflow-hidden">
				<div className="overflow-auto">
					{sessionQ.isLoading && (
						<p className="p-6 text-muted-foreground text-sm">Loading…</p>
					)}
					{sessionQ.error && (
						<p className="p-6 text-destructive text-sm">
							Failed to load session: {String(sessionQ.error)}
						</p>
					)}
					{sessionQ.data && <EventLog events={sessionQ.data.events} />}
				</div>
				<div className="border-t border-border bg-[#0c0e12]">
					<Terminal sessionId={sessionId} projectCwd={projectCwd} />
				</div>
			</div>
		</main>
	);
}

export const sessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/projects/$projectId/sessions/$sessionId',
	component: SessionView,
});
