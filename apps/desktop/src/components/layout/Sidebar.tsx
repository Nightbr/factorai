import { ImportProjects } from '@components/dialog/ImportProjects';
import { SidebarGroup } from '@components/layout/SidebarGroup';
import { SidebarProject } from '@components/layout/SidebarProject';
import { UpdateBadge } from '@components/layout/UpdateBadge';
import { ZoomControls } from '@components/layout/ZoomControls';
import {
	DndContext,
	type DragEndEvent,
	type DragOverEvent,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { SidebarRow } from '@factorai/types';

/** A group row, narrowed once so the dialog and the handlers can name it. */
type GroupRow = Extract<SidebarRow, { kind: 'group' }>;
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	IconButton,
	InlineEdit,
	Input,
} from '@factorai/ui';
import { useActiveProject } from '@hooks/useActiveProject';
import { useDragDwell } from '@hooks/useDragDwell';
import { useOpenSessions } from '@hooks/useOpenSessions';
import { formatError } from '@lib/errors';
import { queryKeys } from '@lib/queryKeys';
import { projectStatus } from '@lib/sessionGroups';
import {
	fileIntoGroup,
	groupsOf,
	parentOf,
	moveRow,
	nudgeRow,
	toOrder,
	unfile,
	viewRows,
	visibleRowIds,
} from '@lib/sidebarTree';
import { cmd, pickFolder } from '@lib/tauri';
import { useIndexerStore } from '@store/indexerStore';
import { type ProjectSort, useSidebarStore } from '@store/sidebarStore';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle, ArrowUpDown, FolderPlus, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

	const queryClient = useQueryClient();
	const groups = useMemo(() => groupsOf(sidebarQ.data ?? []), [sidebarQ.data]);
	// Which group's name is being edited. **Owned here rather than by the row**,
	// because creating a group has to open the editor on a row that has only just
	// appeared — the row cannot know it is new.
	const [editingGroup, setEditingGroup] = useState<string | null>(null);
	const [removingGroup, setRemovingGroup] = useState<GroupRow | null>(null);
	const groupWrites = useGroupWrites();
	const expand = useSidebarStore((s) => s.toggleProject);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: DRAG_START_PX } }),
	);

	/** Make a group holding the two projects the gesture named, and open its name
	 *  editor. The mouse's answer to `Move to group ▸ → New group…`, and it goes
	 *  through the same `create` + `fileIntoGroup` pair so the two cannot drift. */
	const groupFromDrop = useCallback(
		async (activeId: string, overId: string) => {
			const created = await groupWrites.create();
			if (created.kind !== 'group') return;
			expand(created.rowId);
			const tree = queryClient.getQueryData<SidebarRow[]>(queryKeys.sidebar()) ?? [];
			// The row dropped **on** goes in first, so the group reads top-to-bottom
			// in the order the two rows had — the held one landed on it, so it is
			// second.
			applyTree(tree, (t) =>
				fileIntoGroup(fileIntoGroup(t, overId, created.rowId), activeId, created.rowId),
			);
			setEditingGroup(created.rowId);
		},
		[applyTree, expand, groupWrites, queryClient],
	);

	/** Collapse one row, whatever its current state — `toggleProject` would open
	 *  anything already closed. */
	const collapseOne = useCallback((rowId: string) => {
		useSidebarStore.setState((state) => ({
			expanded: state.expanded.filter((id) => id !== rowId),
		}));
	}, []);

	// **Holding still over a row means something a pass over it does not.** Over
	// another project it offers to group the two; over a *collapsed* group it
	// springs the group open so you can drop inside. One timer and one filling
	// ring for both, so there is one thing to learn (F1).
	const dwell = useDragDwell();
	// Groups this drag sprang open, so they can be closed again if the user drags
	// away without dropping — springing one open should not silently rearrange
	// what the user had collapsed.
	const sprungOpen = useRef<Set<string>>(new Set());

	/** Can holding over this row offer to group? Only where a new group could
	 *  actually be made: a loose project, held over another loose project. */
	const canOfferGroup = useCallback(
		(activeId: string, overId: string) => {
			const tree = sidebarQ.data ?? [];
			const overRow = tree.find((r) => r.rowId === overId);
			// Not a group row — that case is the spring-open — and not a project
			// already inside one, which would need nesting. Over a grouped project
			// the drop just files the held row into that group, which is the useful
			// outcome (F1).
			if (!overRow || overRow.kind !== 'project') return false;
			return parentOf(tree, activeId) === null;
		},
		[sidebarQ.data],
	);

	const onDragOver = useCallback(
		(event: DragOverEvent) => {
			const { active, over } = event;
			const overId = over ? String(over.id).replace(/^empty:/, '') : null;
			if (!overId || overId === String(active.id)) {
				dwell.track(null);
				return;
			}
			const tree = sidebarQ.data ?? [];
			const overRow = tree.find((r) => r.rowId === overId);
			const isCollapsedGroup = overRow?.kind === 'group' && !expandedSet.has(overRow.rowId);
			// Only time a hold where the hold would do something.
			dwell.track(isCollapsedGroup || canOfferGroup(String(active.id), overId) ? overId : null);
		},
		[canOfferGroup, dwell, expandedSet, sidebarQ.data],
	);

	// Spring a collapsed group open once its dwell completes. In an effect rather
	// than in `onDragOver` because it is a *consequence* of the timer finishing,
	// and dnd-kit has to re-measure the newly revealed children before they can be
	// dropped on — which it does on the render this triggers.
	useEffect(() => {
		if (!dwell.dwellingOn) return;
		const tree = sidebarQ.data ?? [];
		const row = tree.find((r) => r.rowId === dwell.dwellingOn);
		if (row?.kind !== 'group' || expandedSet.has(row.rowId)) return;
		sprungOpen.current.add(row.rowId);
		expand(row.rowId);
	}, [dwell.dwellingOn, expand, expandedSet, sidebarQ.data]);

	const endDrag = useCallback(() => {
		setDragging(false);
		dwell.track(null);
		sprungOpen.current.clear();
	}, [dwell]);

	const onDragEnd = useCallback(
		(event: DragEndEvent) => {
			const { active, over } = event;
			const activeId = String(active.id);
			// An empty group's hint row is a droppable under `empty:<rowId>` — see
			// `EmptyGroupHint`. Stripping the prefix here is what makes dropping on
			// it resolve to the same `moveRow` call as dropping on the group's own
			// header, rather than a second rule that has to stay in step.
			const overId = over ? String(over.id).replace(/^empty:/, '') : null;
			// **The dwell decides what the drop means**, and it is read before the
			// state is cleared. Held long enough over another project: the drop makes
			// a group of the two rather than inserting beside it.
			const grouping =
				overId !== null && dwell.dwellingOn === overId && canOfferGroup(activeId, overId);
			endDrag();
			if (!overId || activeId === overId) return;
			if (grouping) {
				void groupFromDrop(activeId, overId);
				return;
			}
			applyTree(rows, (tree) => moveRow(tree, activeId, overId));
		},
		[applyTree, canOfferGroup, dwell.dwellingOn, endDrag, groupFromDrop, rows],
	);

	const onDragCancel = useCallback(() => {
		// Re-collapse anything this drag sprang open: the user changed their mind,
		// and their collapsed groups should be as they left them.
		for (const rowId of sprungOpen.current) collapseOne(rowId);
		endDrag();
	}, [collapseOne, endDrag]);

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

	/** Create a group and open its name editor. Both entry points come here — the
	 *  header menu with no project, and `Move to group ▸ → New group…` with one to
	 *  put in it. */
	const createGroup = useCallback(
		async (rowIdToFile?: string) => {
			const created = await groupWrites.create();
			if (created.kind !== 'group') return;
			// Expanded, so a project filed into it is visible rather than landing in
			// a closed box.
			expand(created.rowId);
			if (rowIdToFile) {
				const tree = queryClient.getQueryData<SidebarRow[]>(queryKeys.sidebar()) ?? [];
				applyTree(tree, (t) => fileIntoGroup(t, rowIdToFile, created.rowId));
			}
			setEditingGroup(created.rowId);
		},
		[applyTree, expand, groupWrites, queryClient],
	);

	const moveToGroup = useCallback(
		(rowId: string, groupRowId: string | null) => {
			if (groupRowId === null) {
				void createGroup(rowId);
				return;
			}
			expand(groupRowId);
			applyTree(rows, (tree) => fileIntoGroup(tree, rowId, groupRowId));
		},
		[applyTree, createGroup, expand, rows],
	);

	const removeFromGroup = useCallback(
		(rowId: string) => applyTree(rows, (tree) => unfile(tree, rowId)),
		[applyTree, rows],
	);

	/** Silent for an empty group, a dialog for one holding projects — the same
	 *  rule `remove_project` follows (F1). Nothing on disk is touched either way;
	 *  what a held group has at stake is the arrangement inside it. */
	const requestRemoveGroup = useCallback(
		(row: GroupRow) => {
			if (row.children.length === 0) {
				groupWrites.remove(row.rowId);
				return;
			}
			setRemovingGroup(row);
		},
		[groupWrites],
	);

	// Adding a folder to the workspace (F1). Since ADR-0011 this is the *only*
	// way a project appears — nothing arrives because Claude touched a directory
	// — so it has two entry points: the picker for a folder you browse to, and
	// the import dialog for folders Claude already knows.
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
							aria-label="Add a project or group"
							title="Add a project or group"
							data-testid="add-project-menu"
							disabled={adding}
						>
							<FolderPlus />
						</IconButton>
					</DropdownMenuTrigger>
					{/* **`onCloseAutoFocus` prevented, and it is load-bearing.** Radix
					    returns focus to the trigger as the menu closes, which lands
					    *after* `New Group…` has mounted the inline name editor — and an
					    editor that treats blur as commit closes itself instantly. Nothing
					    in this menu wants focus back on the button: each item either
					    opens a dialog, a picker, or an editor that focuses itself. */}
					<DropdownMenuContent
						align="end"
						className="w-52"
						onCloseAutoFocus={(e) => e.preventDefault()}
					>
						<DropdownMenuItem data-testid="add-project" onSelect={() => void addProject()}>
							Add Project…
						</DropdownMenuItem>
						<DropdownMenuItem data-testid="open-import" onSelect={() => setImportOpen(true)}>
							Import from Claude Code…
						</DropdownMenuItem>
						{/* Below the separator: the two Add doors above it are one action
						    with two sources (ADR-0011), and making a group is a different
						    kind of act rather than a third door onto the same one. */}
						<DropdownMenuSeparator />
						<DropdownMenuItem data-testid="new-group" onSelect={() => void createGroup()}>
							New Group…
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
					onDragOver={onDragOver}
					onDragCancel={onDragCancel}
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
										dwellProgress={dwell.over === row.rowId ? dwell.progress : 0}
										dwelling={dwell.dwellingOn === row.rowId}
										groups={groups}
										onMoveToGroup={moveToGroup}
										onRemoveFromGroup={removeFromGroup}
										onRename={setEditingGroup}
										onRemove={requestRemoveGroup}
										editing={editingGroup === row.rowId}
										renameEditor={
											<InlineEdit
												value={row.name}
												aria-label={`Rename ${row.name}`}
												data-testid={`rename-group-${row.rowId}`}
												className="py-2 font-medium text-xs uppercase tracking-wider"
												onCommit={(name) => groupWrites.rename(row.rowId, name)}
												onCancel={() => setEditingGroup(null)}
											/>
										}
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
										dwellProgress={dwell.over === row.rowId ? dwell.progress : 0}
										dwelling={dwell.dwellingOn === row.rowId}
										groups={groups}
										onMoveToGroup={moveToGroup}
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

			{/* Only reached with projects inside. An empty group goes on the click:
			    it is a container you can remake in two clicks, and a dialog there is
			    friction on the one thing everybody does with this feature. What a
			    held group has at stake is the arrangement, not any project — hence
			    the copy. Same shape as Remove Project's confirm (F1). */}
			<Dialog
				open={removingGroup !== null}
				onOpenChange={(open) => !open && setRemovingGroup(null)}
			>
				<DialogContent data-testid="confirm-remove-group">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<AlertTriangle className="size-5 text-destructive" />
							Remove {removingGroup?.name}?
						</DialogTitle>
						<DialogDescription>
							Its {removingGroup?.children.length} project
							{removingGroup?.children.length === 1 ? '' : 's'} move back to the top level, in this
							group's place. Nothing is deleted.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setRemovingGroup(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							data-testid="confirm-remove-group-yes"
							onClick={() => {
								if (removingGroup) groupWrites.remove(removingGroup.rowId);
								setRemovingGroup(null);
							}}
						>
							Remove group
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
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

/**
 * Create, rename and remove a group.
 *
 * **Not optimistic, unlike the reorder.** Each of these changes the *set* of
 * rows rather than their order, and `reorder_sidebar` rejects a tree whose row
 * set does not match the sidebar — so a locally-invented group would make the
 * very next drag fail until the poll caught up. Awaiting the write and
 * invalidating is both simpler and the only correct order of operations here.
 *
 * `create` returns the row because the caller needs its id immediately: to
 * expand it, to file a project into it, and to open its name editor.
 */
function useGroupWrites(): {
	create: (name?: string) => Promise<SidebarRow>;
	rename: (rowId: string, name: string) => void;
	remove: (rowId: string) => void;
} {
	const queryClient = useQueryClient();
	const invalidate = useCallback(
		() => queryClient.invalidateQueries({ queryKey: queryKeys.sidebar() }),
		[queryClient],
	);

	const create = useCallback(
		async (name?: string) => {
			const row = await cmd.createGroup(name);
			await invalidate();
			return row;
		},
		[invalidate],
	);

	const rename = useCallback(
		(rowId: string, name: string) => {
			void cmd.renameGroup(rowId, name).then(invalidate);
		},
		[invalidate],
	);

	const remove = useCallback(
		(rowId: string) => {
			void cmd.removeGroup(rowId).then(invalidate);
		},
		[invalidate],
	);

	return { create, rename, remove };
}
