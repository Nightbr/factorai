import { Button, Input } from '@factorai/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ProjectIcon } from '@components/layout/ProjectIcon';
import { StatusDot } from '@components/layout/StatusDot';
import { useActiveProject } from '@hooks/useActiveProject';
import { useStartSession } from '@hooks/useStartSession';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { useIndexerStore } from '@store/indexerStore';
import { useTerminalStore } from '@store/terminalStore';

export function Sidebar() {
	const navigate = useNavigate();
	const projectsQ = useQuery({
		queryKey: queryKeys.projects(),
		queryFn: () => cmd.listProjects(),
		refetchInterval: 2000,
	});
	const progress = useIndexerStore((s) => s.progress);
	const bySession = useTerminalStore((s) => s.bySession);
	const liveProjectIds = useMemo(
		() => new Set(Object.values(bySession).map((t) => t.projectId)),
		[bySession],
	);
	const { projectId: activeProjectId } = useActiveProject();
	const startSession = useStartSession();

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
			{/* The app's brand row lives in TopBar now — the sidebar starts at
			    its search box. */}
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
						// No resolved cwd means we never found a `cwd` in this project's
						// sessions, so there is nowhere to start one: claude would boot in
						// $HOME and file the new session under a *different* project than
						// the row that was clicked.
						const canStart = p.realPath !== null;
						return (
							// The row is the <li>, so the hover background covers both the
							// link and the + beside it. The + is a SIBLING of the Link —
							// nesting a button inside an anchor is invalid, and the two
							// would fight over the click.
							<li
								key={p.id}
								className={`group flex items-center pr-1 transition-colors ${
									isActive ? 'bg-secondary' : 'hover:bg-secondary/50'
								}`}
							>
								<Link
									to="/projects/$id"
									params={{ id: p.id }}
									className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 text-sm ${
										isActive
											? 'text-foreground'
											: 'text-muted-foreground group-hover:text-foreground'
									}`}
								>
									<ProjectIcon name={p.displayName} path={p.realPath ?? p.id} size={16} />
									<span className="min-w-0 flex-1 truncate">{p.displayName}</span>
									{liveProjectIds.has(p.id) && <StatusDot status="running" />}
									<span className="tabular-nums text-muted-foreground text-xs">
										{p.sessionCount}
									</span>
								</Link>
								{/* The title lives on the wrapper: Button sets
								    disabled:pointer-events-none, which suppresses a native
								    tooltip on the element itself — exactly when the
								    explanation matters most. */}
								<span
									// `flex` matters: as a plain inline span this wrapper placed the
									// button on its own line box, floating the + ~4px above the
									// session count beside it. A flex container centers it on the row.
									className="flex items-center"
									title={
										canStart
											? `New session in ${p.displayName}`
											: 'No project folder on disk — cannot start a session here'
									}
								>
									<Button
										variant="ghost"
										size="icon"
										// Deliberately smaller than the standard size-6 icon button:
										// at the end of a dense row its hover/focus box otherwise
										// runs into the session count next to it.
										// Hidden until hover to keep the list quiet, but always
										// focusable: focus-visible brings it back for keyboards.
										className="ml-1 size-4 shrink-0 rounded opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
										aria-label={`New session in ${p.displayName}`}
										disabled={!canStart}
										onClick={() => void startSession(p.id)}
									>
										<Plus className="size-3 text-muted-foreground" />
									</Button>
								</span>
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
