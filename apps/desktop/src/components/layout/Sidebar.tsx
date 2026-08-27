import { ImportProjects } from '@components/dialog/ImportProjects';
import { SidebarGroup } from '@components/layout/SidebarGroup';
import { SidebarProject } from '@components/layout/SidebarProject';
import { UpdateBadge } from '@components/layout/UpdateBadge';
import { ZoomControls } from '@components/layout/ZoomControls';
import {
	DndContext,
	type DragEndEvent,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { SidebarRow } from '@factorai/types';
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
import { useOpenSessions } from '@hooks/useOpenSessions';
import { formatError } from '@lib/errors';
import { queryKeys } from '@lib/queryKeys';
import { projectStatus } from '@lib/sessionGroups';
import { moveRow, nudgeRow, toOrder, viewRows, visibleRowIds } from '@lib/sidebarTree';
import { cmd, pickFolder } from '@lib/tauri';
import { useIndexerStore } from '@store/indexerStore';
import { type ProjectSort, useSidebarStore } from '@store/sidebarStore';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUpDown, FolderPlus, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * How far the pointer must travel before a press on a row becomes a drag.
 *
 * Not decoration — it is what keeps a click a click. Without an activation
 * constraint the sensor claims the `pointerdown` and dnd-kit stops propagating
 * the `click` that follows, so opening a project by clicking its row would stop
 * working. The tab strip pays for the same thing at the same distance.
 */
const DRAG_START_PX = 4;

export function Sidebar() {
	const navigate = useNavigate();
	// **The poll stops while you are dragging.** A refetch landing mid-gesture
	// re-renders the list under the pointer, and a row that moves, appears or
	// vanishes while it is being dropped on is a whole class of bug that simply
	// does not exist if nothing arrives until the drag is over.
	const [dragging, setDragging] = useState(false);
	const sidebarQ = useQuery({
		queryKey: queryKeys.sidebar(),
		queryFn: () => cmd.listSidebar(),
		refetchInterval: dragging ? false : 2000,
	});
	const progress = useIndexerStore((s) => s.progress);
	// One dot per project, worst-status-wins over its **open** sessions (F10,
	// F16). Was a Set of "has anything live", which is all the dot could say when
	// a live PTY was one state; then it was the live sessions, until a tab could
	// outlive its process. A project holding open tabs with nothing running now
	// shows grey — `STATUS_RANK` puts `stopped` last, so one waiting session
	// still wins the row.
	const open = useOpenSessions();
	const statusByProject = useMemo(() => {
		const ids = new Set(Object.values(open).map((t) => t.projectId));
		return new Map([...ids].map((id) => [id, projectStatus(open, id)]));
	}, [open]);
	const { projectId: activeProjectId } = useActiveProject();

	const sort = useSidebarStore((s) => s.sort);
	const setSort = useSidebarStore((s) => s.setSort);
	const expanded = useSidebarStore((s) => s.expanded);
	const expandAll = useSidebarStore((s) => s.expandAll);
	const collapseAll = useSidebarStore((s) => s.collapseAll);

	// The tree as this sort mode shows it. `manual` is the tree itself; `name` and
	// `recent` dissolve the groups into one derived list (F1).
	const rows = useMemo(() => viewRows(sidebarQ.data ?? [], sort), [sidebarQ.data, sort]);
	const expandedSet = useMemo(() => new Set(expanded), [expanded]);
	// Every row id in visual order — what `SortableContext` needs, and what
	// `Alt`+arrows walks, so a nudge and a drop agree about "the next row"
	// without either of them knowing about groups.
	const rowIds = useMemo(() => visibleRowIds(rows, expandedSet), [rows, expandedSet]);
	const allExpandableIds = useMemo(
		() =>
			(sidebarQ.data ?? []).flatMap((row) =>
				row.kind === 'group'
					? [row.rowId, ...row.children.map((c) => c.project.id)]
					: [row.project.id],
			),
		[sidebarQ.data],
	);

	// **The drag is live in `manual` only.** Under `name` or `recent` the list is
	// derived, so a drop has nowhere to land: the arrangement it would write is
	// invisible behind a rule that overrides it. Rather than write something the
	// user cannot see, the gesture is not offered — no sensor listeners, no key
	// handler, and no structural rows in the row's menu. Switching to Manual is
	// one click away and says what it does.
	const canReorder = sort === 'manual';
	const applyTree = useApplyTree();
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: DRAG_START_PX } }),
	);

	const onDragEnd = useCallback(
		(event: DragEndEvent) => {
			setDragging(false);
			const { active, over } = event;
			if (!over || active.id === over.id) return;
			// An empty group's hint row is a droppable under `empty:<rowId>` — see
			// `EmptyGroupHint`. Stripping the prefix here is what makes dropping on
			// it resolve to the same `moveRow` call as dropping on the group's own
			// header, rather than a second rule that has to stay in step.
			const overId = String(over.id).replace(/^empty:/, '');
			if (String(active.id) === overId) return;
			applyTree(rows, (tree) => moveRow(tree, String(active.id), overId));
		},
		[applyTree, rows],
	);

	/** One slot up or down, because a drag-only reorder is unreachable without a
	 *  mouse. **`nudgeRow`, not `moveRow` with the neighbour's id** — see that
	 *  function for why: a drag aims at a target, a nudge walks the list, and the
	 *  two disagree about what the slot above a group's first child is. */
	const nudge = useCallback(
		(rowId: string, delta: -1 | 1) => {
			applyTree(rows, (tree) => nudgeRow(tree, rowId, delta, expandedSet));
		},
		[applyTree, expandedSet, rows],
	);

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
					<DropdownMenuContent align="end" className="w-44">
						<DropdownMenuLabel>Sort</DropdownMenuLabel>
						{/* `Manual` first and default: it is the order you built, and the
						    other two are views over it that write nothing. Picking one of
						    them turns the drag off rather than reinterpreting it. */}
						<DropdownMenuRadioGroup
							value={sort}
							onValueChange={(value) => setSort(value as ProjectSort)}
						>
							<DropdownMenuRadioItem value="manual">Manual</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="recent">Recent</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={() => expandAll(allExpandableIds)}>
							Expand all
						</DropdownMenuItem>
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
				{sidebarQ.isLoading && (
					<div className="px-4 py-2 text-muted-foreground text-xs">Loading…</div>
				)}
				{/* An empty workspace has nothing to do with what Claude has. The old
				    copy led with "No projects found in ~/.claude/projects yet", which
				    was true of a mirror and is backwards now that a project is a
				    folder you added (ADR-0011).

				    Both ways in are offered as buttons rather than pointed at from
				    prose: this is the one screen where the way out is the only thing
				    worth saying. */}
				{sidebarQ.data && sidebarQ.data.length === 0 && (
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
				{/* One list, no tiers. The pinned block and its divider lived here
				    until the order became something you write by hand: a boolean was
				    a one-bit approximation of an ordering, and there is nothing left
				    for it to approximate.

				    `restrictToVerticalAxis`: a sidebar has one axis, and a row you
				    can lift sideways out of it suggests it could be dropped there.
				    Auto-scroll is dnd-kit's default and we keep it — the list
				    overflows, so dragging to its edge scrolls it. */}
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					modifiers={[restrictToVerticalAxis]}
					onDragStart={() => setDragging(true)}
					onDragCancel={() => setDragging(false)}
					onDragEnd={onDragEnd}
				>
					<SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
						<ul className="space-y-0.5" data-testid="projects">
							{rows.map((row) =>
								row.kind === 'group' ? (
									<SidebarGroup
										key={row.rowId}
										row={row}
										canReorder={canReorder}
										activeProjectId={activeProjectId}
										statusByProject={statusByProject}
										onNudge={nudge}
									/>
								) : (
									<SidebarProject
										key={row.rowId}
										rowId={row.rowId}
										project={row.project}
										isActive={activeProjectId === row.project.id}
										liveStatus={statusByProject.get(row.project.id)}
										canReorder={canReorder}
										onNudge={nudge}
									/>
								),
							)}
						</ul>
					</SortableContext>
				</DndContext>
			</nav>

			{/* **A fixed height, not `py-*`.** The updater's badge is 24px tall and
			    everything else in this row is 18px or less, so a footer that hugged
			    its content grew by 6px the moment an update staged itself — the whole
			    sidebar shifting under you to announce something the badge was already
			    announcing. `h-9` is the file panel header's height, and it is the
			    badge's 24px plus the padding it wants. */}
			<footer
				data-testid="sidebar-footer"
				className="flex h-9 shrink-0 items-center gap-2 border-t border-border pr-1.5 pl-3 text-muted-foreground text-xs"
			>
				{/* Indexing is transient and worth saying; "Idle" was a label for the
				    absence of news. In its place, the updater — the one background
				    thing whose state you might actually want to poke. */}
				{/* `@container` so the badge inside can drop its label when this cell
				    gets narrow — the sidebar's 180px floor leaves it about 76px, and a
				    pill reading `Upd…` is not a degradation, it is a broken word. */}
				<span className="@container min-w-0 flex-1 truncate">
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

/**
 * Write a new sidebar tree, applied to the cache before it lands.
 *
 * The sidebar polls every 2s, so without the optimistic write the rows would
 * snap back for up to two seconds after the drop — long enough to drag again and
 * fight the poll.
 *
 * **The rollback path is real.** `reorder_sidebar` rejects a tree whose row set
 * no longer matches the sidebar — a project added or removed between the render
 * and the drop — and the previous tree is the only record of what to go back to,
 * since a refetch alone would race the write. So the snapshot is kept and
 * restored, and the invalidate on settle reconciles either way.
 *
 * Takes the tree and a transform rather than a finished tree, so every caller —
 * the drop, the keyboard nudge, the menu — goes through one place that knows
 * about the cache, and none of them can forget the optimistic step.
 */
function useApplyTree(): (
	rows: SidebarRow[],
	transform: (rows: SidebarRow[]) => SidebarRow[],
) => void {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		mutationFn: (next: SidebarRow[]) => cmd.reorderSidebar(toOrder(next)),
		onMutate: () => queryClient.getQueryData<SidebarRow[]>(queryKeys.sidebar()),
		onError: (_error, _next, previous) => {
			if (previous) queryClient.setQueryData(queryKeys.sidebar(), previous);
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.sidebar() }),
	});

	return useCallback(
		(rows, transform) => {
			const next = transform(rows);
			// Same identity means nothing moved — a click that grazed the activation
			// distance, or a nudge off the end of the list.
			if (next === rows) return;
			queryClient.setQueryData(queryKeys.sidebar(), next);
			mutation.mutate(next);
		},
		[mutation, queryClient],
	);
}
