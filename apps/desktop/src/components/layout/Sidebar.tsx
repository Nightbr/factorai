import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { FolderGit2 } from 'lucide-react';
import { ProjectIcon } from '@components/layout/ProjectIcon';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { useIndexerStore } from '@store/indexerStore';

export function Sidebar() {
	const projectsQ = useQuery({
		queryKey: queryKeys.projects(),
		queryFn: () => cmd.listProjects(),
		refetchInterval: 2000,
	});
	const progress = useIndexerStore((s) => s.progress);
	const params = useParams({ strict: false });
	const activeProjectId =
		(params as { id?: string; projectId?: string }).id ??
		(params as { id?: string; projectId?: string }).projectId;

	return (
		<>
			<header className="flex items-center gap-2 border-b border-border px-4 py-3">
				<FolderGit2 className="size-4 text-primary" />
				<span className="font-semibold tracking-tight">factorai</span>
			</header>

			<nav className="flex-1 overflow-y-auto py-2">
				<div className="px-3 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wider">
					Projects
				</div>
				{projectsQ.isLoading && (
					<div className="px-4 py-2 text-muted-foreground text-xs">Loading…</div>
				)}
				{projectsQ.data && projectsQ.data.length === 0 && (
					<div className="px-4 py-2 text-muted-foreground text-xs">
						No projects found in ~/.claude/projects yet.
					</div>
				)}
				<ul>
					{projectsQ.data?.map((p) => {
						const isActive = activeProjectId === p.id;
						return (
							<li key={p.id}>
								<Link
									to="/projects/$id"
									params={{ id: p.id }}
									className={`flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
										isActive
											? 'bg-secondary text-foreground'
											: 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
									}`}
								>
									<ProjectIcon
										name={p.displayName}
										path={p.realPath ?? p.id}
										size={16}
									/>
									<span className="min-w-0 flex-1 truncate">{p.displayName}</span>
									<span className="tabular-nums text-muted-foreground text-xs">
										{p.sessionCount}
									</span>
								</Link>
							</li>
						);
					})}
				</ul>
			</nav>

			<footer className="border-t border-border px-3 py-2 text-muted-foreground text-xs">
				{progress && progress.phase !== 'idle' ? (
					<span>
						Indexing… {progress.processed}/{progress.total}
					</span>
				) : (
					<span className="text-muted-foreground/60">Idle</span>
				)}
			</footer>
		</>
	);
}
