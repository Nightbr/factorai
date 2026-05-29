import { Input } from '@factorai/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { FolderGit2, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ProjectIcon } from '@components/layout/ProjectIcon';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { useIndexerStore } from '@store/indexerStore';

export function Sidebar() {
	const navigate = useNavigate();
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

	// Debounced search: typing navigates to /search?q=… (the route runs the
	// query). Empty input doesn't navigate, so clearing the box is harmless.
	const [term, setTerm] = useState('');
	useEffect(() => {
		const q = term.trim();
		if (!q) return;
		const t = setTimeout(() => navigate({ to: '/search', search: { q } }), 250);
		return () => clearTimeout(t);
	}, [term, navigate]);

	return (
		<>
			<header className="flex items-center gap-2 border-b border-border px-4 py-3">
				<FolderGit2 className="size-4 text-primary" />
				<span className="font-semibold tracking-tight">factorai</span>
			</header>

			<div className="border-b border-border px-3 py-2">
				<div className="relative">
					<Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 size-3.5 text-muted-foreground" />
					<Input
						type="search"
						value={term}
						onChange={(e) => setTerm(e.target.value)}
						placeholder="Search sessions…"
						className="h-8 pl-7 text-sm"
					/>
				</div>
			</div>

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
