import { ImportProjects } from '@components/dialog/ImportProjects';
import { SidebarProject } from '@components/layout/SidebarProject';
import { UpdateBadge } from '@components/layout/UpdateBadge';
import { ZoomControls } from '@components/layout/ZoomControls';
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
	IconButton,
	Input,
} from '@factorai/ui';
import { useActiveProject } from '@hooks/useActiveProject';
import { formatError } from '@lib/errors';
import { queryKeys } from '@lib/queryKeys';
import { cmd, pickFolder } from '@lib/tauri';
import { useIndexerStore } from '@store/indexerStore';
import { type ProjectSort, useSidebarStore } from '@store/sidebarStore';
import { useTerminalStore } from '@store/terminalStore';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUpDown, FolderPlus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

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
function groupProjects(
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

	// Adding a folder to the workspace (F1). Since ADR-0011 this is the *only*
	// way a project appears — nothing arrives because Claude touched a directory
	// — so it has two entry points: the picker for a folder you browse to, and
	// the import dialog for folders Claude already knows.
	const queryClient = useQueryClient();
	const [adding, setAdding] = useState(false);
	const [addError, setAddError] = useState<string | null>(null);
	const [importOpen, setImportOpen] = useState(false);

	async function addProject() {
		setAddError(null);
		setAdding(true);
		try {
			const path = await pickFolder();
			// Cancelling the picker is an answer, not a failure.
			if (!path) return;
			const project = await cmd.addProject(path);
			// Await the refetch before navigating: the project route reads the same
			// cache, and landing there before the row exists renders "not found"
			// for a beat.
			await queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
			await navigate({ to: '/projects/$id', params: { id: project.id } });
		} catch (e) {
			setAddError(formatError(e));
		} finally {
			setAdding(false);
		}
	}

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
						className="pl-7"
					/>
				</div>
			</div>

			{/* Outside the scroll container, not `position: sticky` inside it: the
			    header then needs an opaque background and a z-index to stop rows
			    showing through as they pass under, and it still scrolls a pixel
			    before it sticks. A sibling above the scroller simply never moves. */}
			<div className="flex shrink-0 items-center gap-1 pt-3 pr-3 pb-2 pl-3">
				<span className="flex-1 font-medium text-muted-foreground text-xs uppercase tracking-wider">
					Projects
				</span>
				{/* Two doors onto one action (ADR-0011): the picker gives
				    `add_project` a path you browsed to, the dialog gives it paths
				    Claude already knows. A menu rather than two more icons — the
				    header is 180px at its narrowest and already carries sort. */}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<IconButton
							aria-label="Add project"
							title="Add a project"
							data-testid="add-project-menu"
							disabled={adding}
						>
							<FolderPlus />
						</IconButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-52">
						<DropdownMenuItem data-testid="add-project" onSelect={() => void addProject()}>
							Add Project…
						</DropdownMenuItem>
						<DropdownMenuItem data-testid="open-import" onSelect={() => setImportOpen(true)}>
							Import from Claude Code…
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<IconButton aria-label="Sort and expand projects" title="Sort and expand projects">
							<ArrowUpDown />
						</IconButton>
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
						<DropdownMenuItem onSelect={() => expandAll(allIds)}>Expand all</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => collapseAll()}>Collapse all</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{/* In the header rather than a toast: it belongs to the button that
			    caused it, and it clears the next time you press that button. */}
			{addError && (
				<div
					role="alert"
					data-testid="add-project-error"
					className="shrink-0 px-3 pb-2 text-destructive text-xs"
				>
					{addError}
				</div>
			)}

			<nav className="min-h-0 flex-1 overflow-y-auto pr-2 pb-3">
				{projectsQ.isLoading && (
					<div className="px-4 py-2 text-muted-foreground text-xs">Loading…</div>
				)}
				{/* An empty workspace has nothing to do with what Claude has. The old
				    copy led with "No projects found in ~/.claude/projects yet", which
				    was true of a mirror and is backwards now that a project is a
				    folder you added (ADR-0011).

				    Both ways in are offered as buttons rather than pointed at from
				    prose: this is the one screen where the way out is the only thing
				    worth saying. */}
				{projectsQ.data && projectsQ.data.length === 0 && (
					<div className="flex flex-col items-start gap-2 px-4 py-2">
						<p className="text-muted-foreground text-xs">
							No projects yet. Add any folder — whether or not you have run Claude in it.
						</p>
						<div className="flex flex-wrap gap-2">
							<Button
								size="sm"
								variant="outline"
								data-testid="empty-add-project"
								disabled={adding}
								onClick={() => void addProject()}
							>
								Add Project…
							</Button>
							<Button
								size="sm"
								variant="outline"
								data-testid="empty-open-import"
								onClick={() => setImportOpen(true)}
							>
								Import from Claude Code…
							</Button>
						</div>
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
				{/* Indexing is transient and worth saying; "Idle" was a label for the
				    absence of news. In its place, the updater — the one background
				    thing whose state you might actually want to poke. */}
				<span className="min-w-0 flex-1 truncate">
					{progress && progress.phase !== 'idle' ? (
						`Indexing… ${progress.processed}/${progress.total}`
					) : (
						<UpdateBadge />
					)}
				</span>
				<ZoomControls />
			</footer>

			{/* Mounted here rather than at the app shell: it is the sidebar's
			    action, and its only two triggers are in this component. */}
			<ImportProjects open={importOpen} onOpenChange={setImportOpen} />
		</>
	);
}
