import { useQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { StatusDot } from '@components/layout/StatusDot';
import { formatRelative } from '@lib/format';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { useTerminalStore } from '@store/terminalStore';
import { rootRoute } from './__root';

function ProjectView() {
	const { id } = projectRoute.useParams();
	const sessionsQ = useQuery({
		queryKey: queryKeys.sessions(id),
		queryFn: () => cmd.listSessions(id),
	});
	const projectsQ = useQuery({
		queryKey: queryKeys.projects(),
		queryFn: () => cmd.listProjects(),
	});
	const bySession = useTerminalStore((s) => s.bySession);

	const project = projectsQ.data?.find((p) => p.id === id);

	return (
		<main className="flex h-full flex-col gap-4 p-6">
			<header>
				<h2 className="text-lg font-semibold">{project?.displayName ?? id}</h2>
				{project?.realPath && (
					<p className="font-mono text-muted-foreground text-xs">{project.realPath}</p>
				)}
			</header>

			{sessionsQ.isLoading && <p className="text-muted-foreground text-sm">Loading sessions…</p>}
			{sessionsQ.data && sessionsQ.data.length === 0 && (
				<p className="text-muted-foreground text-sm">No sessions in this project yet.</p>
			)}

			<ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
				{sessionsQ.data?.map((s) => (
					<li key={s.id}>
						<Link
							to="/projects/$projectId/sessions/$sessionId"
							params={{ projectId: id, sessionId: s.id }}
							className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary"
						>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									{bySession[s.id] && <StatusDot status={bySession[s.id].status} />}
									<span className="truncate font-medium">{s.title || s.id.slice(0, 8)}</span>
								</div>
								<div className="text-muted-foreground text-xs">
									{s.turnCount} turn{s.turnCount === 1 ? '' : 's'} · {formatRelative(s.updatedAt)}
								</div>
							</div>
							<ChevronRight className="size-4 text-muted-foreground" />
						</Link>
					</li>
				))}
			</ul>
		</main>
	);
}

export const projectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/projects/$id',
	component: ProjectView,
});
