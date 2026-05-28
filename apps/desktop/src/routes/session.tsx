import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { Terminal } from '@components/terminal/Terminal';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { rootRoute } from './__root';

function SessionView() {
	const { sessionId, projectId } = sessionRoute.useParams();

	const projectsQ = useQuery({
		queryKey: queryKeys.projects(),
		queryFn: () => cmd.listProjects(),
	});
	const project = projectsQ.data?.find((p) => p.id === projectId);
	const projectCwd = project?.realPath ?? null;

	return (
		<main className="flex h-full flex-col bg-[#0c0e12]">
			<header className="flex items-baseline gap-3 border-b border-border bg-card px-4 py-2">
				<span className="truncate text-foreground text-sm">
					{project?.displayName ?? projectId}
				</span>
				<span className="truncate font-mono text-muted-foreground text-xs">{sessionId}</span>
			</header>
			<div className="min-h-0 flex-1">
				<Terminal sessionId={sessionId} projectCwd={projectCwd} />
			</div>
		</main>
	);
}

export const sessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/projects/$projectId/sessions/$sessionId',
	component: SessionView,
});
