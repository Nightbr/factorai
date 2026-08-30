import { ImportProjects } from '@components/dialog/ImportProjects';
import { DragChip } from '@components/layout/DragChip';
import { SidebarGroup } from '@components/layout/SidebarGroup';
import { SidebarProject } from '@components/layout/SidebarProject';
import { UpdateBadge } from '@components/layout/UpdateBadge';
import { ZoomControls } from '@components/layout/ZoomControls';
import {
	DndContext,
	DragOverlay,
	useDroppable,
	type CollisionDetection,
	type DragEndEvent,
	type DragMoveEvent,
	type DragStartEvent,
	PointerSensor,
	closestCenter,
	pointerWithin,
	useSensor,
	useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext } from '@dnd-kit/sortable';
import type { SidebarRow } from '@factorai/types';

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
import { useSessionMarks } from '@hooks/useSessionMarks';
import { formatError } from '@lib/errors';
import { queryKeys } from '@lib/queryKeys';
import { projectStatus } from '@lib/sessionGroups';
import {
	type DropIndicator,
	type DropTarget,
	applyDrop,
	dropTarget,
	fileIntoGroup,
	groupsOf,
	indicatorFor as toIndicator,
	parentOf,
	rowFor,
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

/** A group row, narrowed once so the dialog and the handlers can name it. */
type GroupRow = Extract<SidebarRow, { kind: 'group' }>;

/**
 * A `SortingStrategy` that displaces nothing.
 *
 * dnd-kit still tracks the drag and still gives the *active* item its transform —
 * a strategy only decides what happens to the others, and here the answer is
 * nothing. See the note at the `SortableContext` for why this list cannot use the
 * vertical-list strategy.
 */
const noDisplacement = () => null;

/** The indicator, but only if it belongs to this row. */
function forRow(indicator: DropIndicator, rowId: string): DropIndicator {
	return indicator && indicator.kind !== 'end' && indicator.rowId === rowId ? indicator : null;
}

/** The droppable filling the space below the last row. Its own id rather than a
 *  row's, because it means a position no row can express: the end of the top
 *  level. */
const SIDEBAR_END_ID = 'sidebar-end';

/**
 * How far down the row under the pointer the pointer sits — 0 at its top edge, 1
 * at its bottom. This is what picks the drop zone.
 *
 * **From the pointer, not the dragged row's rect.** The rect was tried first and
 * is wrong for a rule stated as "where the pointer is": a row's rect is as tall as
 * the row, so its centre saturates near the middle and the top and bottom
 * quarters of a same-height target are unreachable. The pointer is also what the
 * `pointerWithin` collision detection uses, so the zone and the target are read
 * from the same place.
 *
 * The activator event holds where the press began; `delta` is how far it has
 * moved since.
 */
function fractionWithin(event: DragMoveEvent | DragEndEvent): number {
	const over = event.over?.rect;
	if (!over || over.height === 0) return 0.5;
	const activator = event.activatorEvent;
	const startY =
		activator instanceof PointerEvent || activator instanceof MouseEvent ? activator.clientY : null;
	if (startY === null) return 0.5;
	const pointerY = startY + event.delta.y;
	return Math.max(0, Math.min(1, (pointerY - over.top) / over.height));
}

/**
 * Where the drop would go, by pointer first.
 *
 * `pointerWithin` before `closestCenter`, because the sidebar's droppables are
 * wildly different sizes: the end zone claims whatever height the list leaves, so
 * its *centre* can be hundreds of pixels from the pointer and `closestCenter`
 * alone never chooses it — which is precisely why a project could not be dropped
 * at the end of the list. `closestCenter` stays as the fallback for the gaps
 * between rows, where the pointer is inside nothing.
 */
/**
 * The drop target for an event, or null when the pointer is over nothing this
 * sidebar owns. Shared by the move handler (which draws the line) and the drop
 * handler (which writes the tree), so the two cannot disagree.
 */
function dropTargetFrom(event: DragMoveEvent | DragEndEvent, rows: SidebarRow[]): DropTarget {
	const activeId = String(event.active.id);
	const rawId = event.over ? String(event.over.id) : null;
	if (!rawId || rawId === activeId) return null;
	if (rawId === SIDEBAR_END_ID) return { kind: 'end' };
	const overId = rawId.replace(/^empty:/, '');
	if (overId === activeId) return null;
	// The placeholder inside an empty group stands in for the group: there is no
	// position to choose there, only the container.
	if (rawId !== overId) return { kind: 'into', rowId: overId };
	return dropTarget(rows, activeId, overId, fractionWithin(event));
}

const collisionDetection: CollisionDetection = (args) => {
	const within = pointerWithin(args);
	return within.length > 0 ? within : closestCenter(args);
};

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
	// **The marks, since F22**, so a project whose only live session is a
	// routine's — tabless — still shows a dot. It was `useOpenSessions`, a
	// projection of the tab strip, and a scheduled agent working in a project you
	// had nothing open in coloured nothing at all.
	const open = useSessionMarks();
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
	// A group collapsed *because* it is the thing being dragged, so it can be
	// re-opened after. (There used to be a mirror of this for groups the dwell
	// sprang open; spring-open is gone — see `onDragOver`.)
	const collapsedForDrag = useRef<Set<string>>(new Set());

	/** Collapse an expanded group as its own drag begins.
	 *
	 *  An expanded group is a header plus its children, and the sortable node is
	 *  the whole `<li>` — so dragging one meant hauling a block four rows tall
	 *  around a list of single rows, which is both hard to aim and what made the
	 *  neighbouring rows draw on top of each other. Collapsed, every draggable
	 *  thing in the sidebar is one row. `endDrag` puts it back. */
	const onDragStart = useCallback(
		(event: DragStartEvent) => {
			setDragging(true);
			const rowId = String(event.active.id);
			// `rowFor`, not `find` — a group's children are not top-level rows, so a
			// plain find left the overlay with nothing to draw for any project inside
			// a group.
			const row = rowFor(sidebarQ.data ?? [], rowId);
			// What the overlay renders. Held in state rather than looked up during
			// render because the tree changes under an optimistic write mid-drag.
			setActiveRow(row ?? null);
			if (row?.kind === 'group' && expandedSet.has(rowId)) {
				collapsedForDrag.current.add(rowId);
				collapseOne(rowId);
			}
		},
		[collapseOne, expandedSet, sidebarQ.data],
	);

	/** Can holding over this row offer to group? Only where a new group could
	 *  actually be made: a loose project, held over another loose project. */
	const canOfferGroup = useCallback(
		(activeId: string, overId: string) => {
			const tree = sidebarQ.data ?? [];
			const overRow = tree.find((r) => r.rowId === overId);
			// The row being **dragged** has to be a loose project too. Without this
			// the guard below passed for a group — groups are always top-level, so
			// `parentOf` is null for them — and dragging a group over a project
			// offered to group the two. Dropping then created a group holding only
			// the project, because `fileIntoGroup` cannot move a group. Found by
			// dragging a group across the sidebar (2026-08-27).
			const activeRow = tree.find((r) => r.rowId === activeId);
			if (!activeRow || activeRow.kind !== 'project') return false;
			// The target must be a *loose* project: a group row is the spring-open
			// case, and one already inside a group would need nesting, so the drop
			// just files the held row into that group instead (F1).
			if (!overRow || overRow.kind !== 'project') return false;
			return parentOf(tree, activeId) === null;
		},
		[sidebarQ.data],
	);

	// Where the drop will land. **One value for the line and the write**, so the
	// mark cannot disagree with the outcome — see `dropTarget`.
	const [target, setTarget] = useState<DropTarget>(null);
	const indicator = useMemo(() => toIndicator(target), [target]);
	const [activeRow, setActiveRow] = useState<SidebarRow | null>(null);

	const onDragMove = useCallback(
		(event: DragMoveEvent) => {
			const { active, over } = event;
			const activeId = String(active.id);
			const overId = over ? String(over.id).replace(/^empty:/, '') : null;
			const next = dropTargetFrom(event, sidebarQ.data ?? []);
			setTarget(next);
			// **The dwell only ever offers to create a group**, so it is timed only
			// where that is what a hold would do. It used to also spring a collapsed
			// group open, which meant the same filling ring appeared over a group and
			// read as "about to create a group" on the one row where that is exactly
			// what will not happen. The three-zone rule made spring-open unnecessary:
			// the middle of a collapsed group row is already "into", and the drop
			// works without expanding anything.
			dwell.track(
				overId !== null && next?.kind !== 'into' && canOfferGroup(activeId, overId) ? overId : null,
			);
		},
		[canOfferGroup, dwell, sidebarQ.data],
	);

	const endDrag = useCallback(() => {
		setDragging(false);
		dwell.track(null);
		setTarget(null);
		setActiveRow(null);
		// **Re-open whatever the drag collapsed.** A group is collapsed for the
		// duration of its own drag so the thing being flung around is one row rather
		// than a four-row block; putting it back is not optional, or a drag would
		// silently close a group the user had open.
		for (const rowId of collapsedForDrag.current) expand(rowId);
		collapsedForDrag.current.clear();
	}, [dwell, expand]);

	const onDragEnd = useCallback(
		(event: DragEndEvent) => {
			const activeId = String(event.active.id);
			const overId = event.over ? String(event.over.id).replace(/^empty:/, '') : null;
			// **The dwell decides what the drop means**, and it is read before the
			// state is cleared. Held long enough over another project: the drop makes
			// a group of the two rather than placing it beside.
			const grouping =
				overId !== null && dwell.dwellingOn === overId && canOfferGroup(activeId, overId);
			// **Recomputed from the drop event, not read off the last move.** dnd-kit
			// reports `over` one move behind — it collides against rects measured on
			// the previous frame — which a continuous drag never notices but a fast
			// release does: move and let go in the same breath and the stored target
			// describes where the pointer was, not where it is. Measured: a test doing
			// single discrete jumps saw the *previous* row every time. The stored value
			// stays as the fallback for a drop with no `over` at all.
			const dropped = dropTargetFrom(event, sidebarQ.data ?? []) ?? target;
			endDrag();
			if (grouping && overId) {
				void groupFromDrop(activeId, overId);
				return;
			}
			if (!dropped) return;
			applyTree(rows, (tree) => applyDrop(tree, activeId, dropped));
		},
		[
			applyTree,
			canOfferGroup,
			dwell.dwellingOn,
			endDrag,
			groupFromDrop,
			rows,
			sidebarQ.data,
			target,
		],
	);

	// Cancelling and dropping tidy up the same way — `endDrag` re-opens whatever
	// the drag collapsed either way.
	const onDragCancel = endDrag;

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

			<nav className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-2 pb-3">
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
					collisionDetection={collisionDetection}
					modifiers={[restrictToVerticalAxis]}
					onDragStart={onDragStart}
					onDragMove={onDragMove}
					onDragCancel={onDragCancel}
					onDragEnd={onDragEnd}
				>
					{/* **No sorting strategy**, which is the deliberate part. dnd-kit's
					    `verticalListSortingStrategy` translates every other row to open a
					    gap where the drop will go — sound for a flat list of equal-height
					    siblings, and this list is neither: a group's children live inside
					    its `<li>`, and a group row with children is several times a project
					    row's height. It drew rows on top of each other and let a dragged
					    row overflow into the group below.

					    It also made the group gesture hard to perform: hovering a project
					    displaced it, so the row you are trying to hold still over moved
					    away from under the cursor. Nothing moves now, and `dropIndicator`
					    draws a line where the drop will land instead. */}
					<SortableContext items={rowIds} strategy={noDisplacement}>
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
										indicator={forRow(indicator, row.rowId)}
										childIndicator={indicator}
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
										indicator={forRow(indicator, row.rowId)}
										groups={groups}
										onMoveToGroup={moveToGroup}
									/>
								),
							)}
						</ul>
					</SortableContext>
					{/* The space below the last row, and what it means. Without it there
					    is no way to express "the end of the top level": the collision
					    detection always resolves to some row, and if the last row is a
					    group — or a project inside one — every drop near the bottom lands
					    inside that group. `flex-1` so it claims whatever height the list
					    leaves, and a floor so it is reachable on a full list. */}
					<SidebarEndZone active={indicator?.kind === 'end'} />
					{/* **The thing in your hand is a chip, not the row.** With rows no
					    longer displacing, a translated full-width row sat exactly on top
					    of the row it was hovering and hid the drop line, the accent ring
					    and the "New group" label — all of which are drawn on the target.
					    The overlay keeps the source row in place, dimmed, and puts a
					    compact chip under the cursor instead. */}
					<DragOverlay dropAnimation={null}>
						{activeRow && <DragChip row={activeRow} />}
					</DragOverlay>
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

/**
 * The drop zone below the last row: "the end of the top level".
 *
 * Its own droppable because that position belongs to no row. dnd-kit's collision
 * detection always resolves to *some* registered target, so without this a drop
 * anywhere under the list snapped to the last row — and when that row was a group,
 * or a project inside one, the project went into the group. Which is exactly the
 * report: a project could not be moved to the bottom, or between groups.
 *
 * `flex-1` so it takes the space the list leaves, plus a floor so it is still
 * reachable when the list fills the pane.
 */
function SidebarEndZone({ active }: { active: boolean }) {
	const { setNodeRef } = useDroppable({ id: SIDEBAR_END_ID });

	return (
		<div ref={setNodeRef} data-testid="sidebar-end-zone" className="relative min-h-6 flex-1">
			{active && (
				<span
					aria-hidden="true"
					data-testid="drop-line-end"
					className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-primary"
				/>
			)}
		</div>
	);
}
