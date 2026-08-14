import type { Project } from '@factorai/types';
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Input,
} from '@factorai/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUpDown, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SidebarProject } from '@components/layout/SidebarProject';
import { ZoomControls } from '@components/layout/ZoomControls';
import { useActiveProject } from '@hooks/useActiveProject';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { useIndexerStore } from '@store/indexerStore';
import { type ProjectSort, useSidebarStore } from '@store/sidebarStore';
import { useTerminalStore } from '@store/terminalStore';

/**
 * Order projects for display (specs/05-features.md F1).
 *
 * `recent` keeps the backend's order — `last_session_at DESC` — rather than
 * re-sorting client-side, so the list matches what the indexer decided.
 * Pure and exported so the rule is testable without a render.
 */
export function sortProjects(projects: Project[], sort: ProjectSort): Project[] {
	if (sort === 'recent') return projects;
	return [...projects].sort((a, b) =>
		a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
	);
}

/**
 * Split into the pinned block and everything else, each in the chosen order.
 *
 * The sort applies **inside both groups**, so the control means one thing
 * wherever you look. `list_projects` already returns `pinned DESC` first, but
 * the split is done here rather than relied upon: under `name` we re-sort the
 * whole list anyway, which would otherwise interleave the two.
 */
export function groupProjects(
	projects: Project[],
	sort: ProjectSort,
): { pinned: Project[]; rest: Project[] } {
	const ordered = sortProjects(projects, sort);
	return {
		pinned: ordered.filter((p) => p.pinned),
		rest: ordered.filter((p) => !p.pinned),
	};
}

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

	const sort = useSidebarStore((s) => s.sort);
	const setSort = useSidebarStore((s) => s.setSort);
	const expandAll = useSidebarStore((s) => s.expandAll);
	const collapseAll = useSidebarStore((s) => s.collapseAll);

	const { pinned, rest } = useMemo(
		() => groupProjects(projectsQ.data ?? [], sort),
		[projectsQ.data, sort],
	);
	const allIds = useMemo(() => [...pinned, ...rest].map((p) => p.id), [pinned, rest]);

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
			<div className="border-b border-border px-3 py-2.5">
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

			<nav className="flex-1 overflow-y-auto py-3 pr-2">
				<div className="flex items-center gap-1 pb-2 pl-3 pr-1">
					<span className="flex-1 font-medium text-muted-foreground text-xs uppercase tracking-wider">
						Projects
					</span>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="size-5"
								aria-label="Sort and expand projects"
								title="Sort and expand projects"
							>
								<ArrowUpDown className="size-3.5 text-muted-foreground" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-40">
							<DropdownMenuLabel>Sort</DropdownMenuLabel>
							<DropdownMenuRadioGroup
								value={sort}
								onValueChange={(value) => setSort(value as ProjectSort)}
							>
								<DropdownMenuRadioItem value="recent">Recent</DropdownMenuRadioItem>
								<DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
							</DropdownMenuRadioGroup>
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={() => expandAll(allIds)}>
								Expand all
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => collapseAll()}>Collapse all</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				{projectsQ.isLoading && (
					<div className="px-4 py-2 text-muted-foreground text-xs">Loading…</div>
				)}
				{projectsQ.data && projectsQ.data.length === 0 && (
					<div className="px-4 py-2 text-muted-foreground text-xs">
						No projects found in ~/.claude/projects yet.
					</div>
				)}
				{pinned.length > 0 && (
					<>
						<ul className="space-y-0.5" data-testid="pinned-projects">
							{pinned.map((p) => (
								<SidebarProject
									key={p.id}
									project={p}
									isActive={activeProjectId === p.id}
									isLive={liveProjectIds.has(p.id)}
								/>
							))}
						</ul>
						{/* No header, by choice — the divider plus the filled pin on each
						    row is what says "these are pinned". */}
						<div className="my-2 border-border border-t" />
					</>
				)}
				<ul className="space-y-0.5">
					{rest.map((p) => (
						<SidebarProject
							key={p.id}
							project={p}
							isActive={activeProjectId === p.id}
							isLive={liveProjectIds.has(p.id)}
						/>
					))}
				</ul>
			</nav>

			<footer className="flex items-center gap-2 border-t border-border py-1.5 pr-1.5 pl-3 text-muted-foreground text-xs">
				<span className="min-w-0 flex-1 truncate">
					{progress && progress.phase !== 'idle' ? (
						`Indexing… ${progress.processed}/${progress.total}`
					) : (
						<span className="text-muted-foreground/60">Idle</span>
					)}
				</span>
				<ZoomControls />
			</footer>
		</>
	);
}
