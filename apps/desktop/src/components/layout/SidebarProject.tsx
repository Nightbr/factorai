import { DropLine } from '@components/layout/DropLine';
import { DwellRing } from '@components/layout/DwellRing';
import { ProjectIcon } from '@components/layout/ProjectIcon';
import { StatusDot } from '@components/layout/StatusDot';
import { RoutineOrigin } from '@components/routines/RoutineOrigin';
import { useSortable } from '@dnd-kit/sortable';
// Aliased for the same reason `SessionTabs` aliases it: dnd-kit's `CSS` helper
// shadows the global one at module scope, and a file that ever calls
// `CSS.escape` gets a runtime error instead of a transform.
import { CSS as DndCss } from '@dnd-kit/utilities';
import type { Project, SessionSummary, TerminalStatus } from '@factorai/types';
import {
	Button,
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	IconButton,
} from '@factorai/ui';
import { useDeleteSession } from '@hooks/useDeleteSession';
import { useSetSessionPinned } from '@hooks/useSetSessionPinned';
import { useSessionMarks } from '@hooks/useSessionMarks';
import { liveSessionsIn, useRemoveProject } from '@hooks/useRemoveProject';
import { useStartSession } from '@hooks/useStartSession';
import { queryKeys } from '@lib/queryKeys';
import { formatStamp, routineSessionLabel } from '@lib/cron';
import { formatError } from '@lib/errors';
import { type SessionMark, pendingSessions } from '@lib/sessionGroups';
import { cmd, openExternally } from '@lib/tauri';
import type { DropIndicator } from '@lib/sidebarTree';
import { useSidebarStore } from '@store/sidebarStore';
import { usePrefsStore } from '@store/prefsStore';
import { useTerminalStore } from '@store/terminalStore';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
	AlertTriangle,
	ArrowDown,
	ArrowUp,
	Check,
	ChevronRight,
	FolderInput,
	FolderOpen,
	FolderOutput,
	FolderPlus,
	ClockFading,
	Pin,
	PinOff,
	Plus,
	Route,
	Trash2,
	X,
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';

/** How many sessions an expanded project shows. Enough to cover "the one I was
 *  just in", short enough that expanding two projects doesn't bury the list. */
export const SIDEBAR_SESSION_LIMIT = 10;

/**
 * Pinned first, then anything with a live PTY, then newest-first (F2).
 *
 * **Three keys, and the pin is the outermost one.** A pin says "exempt this row
 * from recency", so a live session cannot displace it — the status dot still
 * says which session is working, and it says so from wherever the pin put the
 * row. Ranking `open` first instead would take the pin's top slot away exactly
 * when the project is busy, which is when you need a bookmark most.
 *
 * **Pinned rows are never what the cap drops.** A pin you can be pushed out of
 * view by is not a pin, so the limit caps the unpinned remainder and a project
 * with more pins than slots shows all of them. That is the user's own doing and
 * visible on screen, unlike a mark that silently stopped working.
 *
 * Sub-agents are left out: they belong to the session that spawned them, and
 * the sidebar's ten slots are for sessions you can actually go back into.
 * They stay reachable from the project page, nested under their parent.
 *
 * Pure and exported so the ordering — the part with actual rules — is testable
 * without rendering a sidebar.
 */
export function orderSessions(
	sessions: SessionSummary[],
	open: Record<string, unknown>,
	limit = SIDEBAR_SESSION_LIMIT,
): SessionSummary[] {
	const ordered = sessions
		.filter((s) => s.subagentOf === null)
		.sort((a, b) => {
			if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
			const aOpen = a.id in open ? 1 : 0;
			const bOpen = b.id in open ? 1 : 0;
			if (aOpen !== bOpen) return bOpen - aOpen;
			return b.updatedAt - a.updatedAt;
		});
	const pinnedCount = ordered.filter((s) => s.pinned).length;
	return ordered.slice(0, Math.max(limit, pinnedCount));
}

/**
 * Sub-agents per parent session id.
 *
 * Pure and exported for the reason `orderSessions` is: the delete dialog names
 * this number before you commit to it, and a count that is wrong is worse than
 * no count — it is a promise about what is being destroyed.
 */
export function countSubagents(sessions: SessionSummary[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const session of sessions) {
		if (session.subagentOf === null) continue;
		counts[session.subagentOf] = (counts[session.subagentOf] ?? 0) + 1;
	}
	return counts;
}

interface SidebarProjectProps {
	/** The **sidebar row's** id, not the project's. What the drag and the nudge
	 *  address, because since ADR-0025 a project's position belongs to its row —
	 *  the same project would have a different row if it were filed into a group. */
	rowId: string;
	project: Project;
	isActive: boolean;
	/** Worst-status-wins roll-up of this project's live sessions, or undefined
	 *  when it has none (F10). Was `isLive: boolean` while a live PTY was one
	 *  state and the dot could only mean "connected". */
	liveStatus?: TerminalStatus;
	/** False under the `name` and `recent` sorts, where the displayed order is
	 *  derived and a drop has nowhere to land. It switches off the drag, the
	 *  keyboard nudge and the structural menu rows together — a gesture that is
	 *  only half unavailable is worse than one that is plainly off. */
	canReorder: boolean;
	onNudge: (rowId: string, delta: -1 | 1) => void;
	/** 0 → 1 while a drag is resting on this row and the group offer is filling.
	 *  0 for every other row, including while the drag passes over. */
	dwellProgress?: number;
	/** The dwell has completed on this row: the drop now makes a group of the two
	 *  projects rather than inserting beside this one. */
	dwelling?: boolean;
	/** Set when the drop will land on this row's edge — drawn as a line, since
	 *  nothing displaces to show the gap any more. */
	indicator?: DropIndicator;
	/** The row id of the group holding this project, if any. Indents the row, adds
	 *  `Remove from group` to its menu, and greys that group out in
	 *  `Move to group ▸` — an enabled row there would be a no-op the user paid a
	 *  click for. */
	parentGroupRowId?: string;
	/** Every group, for `Move to group ▸`. Empty when there are none, which is
	 *  what hides the submenu rather than showing an empty one. */
	groups?: { rowId: string; name: string }[];
	/** File this row into a group, or — with `null` — into a brand-new one. The
	 *  `null` case is the keyboard's answer to the dwell gesture. */
	onMoveToGroup?: (rowId: string, groupRowId: string | null) => void;
	onRemoveFromGroup?: (rowId: string) => void;
}

export function SidebarProject({
	rowId,
	project,
	isActive,
	liveStatus,
	canReorder,
	onNudge,
	dwellProgress = 0,
	dwelling = false,
	indicator = null,
	parentGroupRowId,
	groups = [],
	onMoveToGroup,
	onRemoveFromGroup,
}: SidebarProjectProps) {
	const expanded = useSidebarStore((s) => s.expanded.includes(project.id));
	const toggleProject = useSidebarStore((s) => s.toggleProject);
	const startSession = useStartSession();
	const navigate = useNavigate();
	const removeProject = useRemoveProject();
	// `disabled` rather than a conditional hook: `useSortable` has to be called on
	// every render, and dnd-kit's own switch is what stops it claiming pointer
	// events under a derived sort.
	const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
		id: rowId,
		disabled: !canReorder,
	});
	// Removing is silent when nothing is running: it touches nothing on disk and
	// re-adding rebuilds, so a dialog on every tidy-up is friction on the action
	// you will do thirty times. A live PTY is the exception — see the dialog.
	// Subscribe to `bySession` and derive: `liveSessionsIn` builds a new array
	// each call, so selecting it directly would hand zustand a fresh reference
	// on every store read and re-render forever.
	const bySession = useTerminalStore((s) => s.bySession);
	const liveHere = useMemo(() => liveSessionsIn(bySession, project.id), [bySession, project.id]);
	const [confirmRemove, setConfirmRemove] = useState(false);

	function remove() {
		if (liveHere.length > 0) {
			setConfirmRemove(true);
			return;
		}
		void removeProject(project.id);
	}

	// A `missing` folder has a known path that is no longer on disk, so claude
	// would boot in $HOME and file the new session under a *different* project
	// than the row that was clicked. The gate says so before the click rather
	// than after it.
	//
	// There is no longer an "unresolved path" case to gate on as well: a project
	// is a folder you added, so it always has one (ADR-0011).
	const canStart = !project.missing;
	// The selected project keeps its controls on show: it is the row you act on
	// repeatedly, so the affordance shouldn't need hunting for. Everything else
	// stays quiet until hovered. This used to read `project.pinned || isActive`,
	// and dropping the pin left `isActive` as the whole of the rule — which is
	// what it always meant.
	const alwaysShowControls = isActive;

	return (
		// **The sortable node is the whole `<li>`, session list included.** An
		// expanded project lifts as one block and its neighbours slide under it,
		// which is honest about what is moving. Translating the row alone would leave
		// its sessions sitting under whatever row took its place.
		//
		// `Translate`, not `Transform` — the difference is `scaleX`, which dnd-kit
		// publishes so a `DragOverlay` can morph into the target's box. We drag the
		// element itself, so on rows of different heights that scale is pure
		// distortion. Learnt on the tab strip, where it read as a tab that zoomed.
		<li
			// **No transform while dragging.** The motion belongs to the overlay's
			// chip now; the row stays where it is so the rows around it — and the
			// affordances drawn on them — stay put and stay visible. `transform` is
			// still applied when dnd-kit has something to say outside a drag.
			style={
				isDragging ? undefined : { transform: DndCss.Translate.toString(transform), transition }
			}
		>
			{/* F1 once rejected a right-click menu here, on the grounds that one
			    action (pin) didn't justify building the system. That reasoning has
			    expired: Remove has nowhere else sane to live, and Move up / Move down
			    are the keyboard's complete answer to a drag. A fifth hover target in
			    a 180px row would be a misclick waiting to happen, and this row has no
			    undo. */}
			<ContextMenu>
				<ContextMenuTrigger asChild>
					{/* The row is a flex container, so the hover background covers the
					    chevron, the link and the + alike. Each is a SIBLING of the Link —
					    nesting a button inside an anchor is invalid, and the two would
					    fight over the click.

					    **The drag starts anywhere on the row**, not from a grip: F1 already
					    called this row "reading as a toolbar" at five elements, and a
					    sixth to grab would be worse than the gesture is good. The 4px
					    activation distance is what keeps a press a click. */}
					{/* **`setNodeRef` is on the row, not the `<li>`.** For an expanded row the
					    `<li>` is the header *plus its children* — a group with three projects,
					    or a project with ten sessions — so the droppable rect was several
					    rows tall and the drop-zone fractions were measured against a box the
					    user is not aiming at: the bottom quarter of a group *header* is only
					    a fifth of the way down that rect, which put "into" and "after" out of
					    reach entirely. Measured while six drag tests failed together. */}
					<div
						ref={setNodeRef}
						{...listeners}
						// `Alt`+arrows rather than dnd-kit's `KeyboardSensor`: that sensor
						// takes the space bar to lift, and space on a project row means
						// *open this project*. On the row rather than the Link so it fires
						// wherever focus sits inside the row — the event bubbles up from
						// the chevron and the `+` too — which is also why the row itself is
						// not a tab stop.
						onKeyDown={
							canReorder
								? (e) => {
										if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
										e.preventDefault();
										onNudge(rowId, e.key === 'ArrowUp' ? -1 : 1);
									}
								: undefined
						}
						aria-keyshortcuts={canReorder ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
						// **Tonal lift plus a hairline, no shadow** (DESIGN.md): the
						// elevation model is four lightness steps and a 1px line, and
						// shadows are reserved for surfaces that will be dismissed. A
						// `ring` rather than a `border` because a border appearing would
						// change the row's height in the middle of the gesture.
						//
						// `touch-none` so a drag on a trackpad or touchscreen is a drag
						// rather than a scroll, and **`select-none` because otherwise the
						// browser selects the project name instead of dragging the row.**
						// Found by dragging it: `draggable={false}` on the Link stops the
						// native anchor drag, and native *text selection* is what takes the
						// gesture next — dnd-kit's pointer sensor never claims it, so the
						// row does not move and five rows of grey highlight appear instead.
						// dnd-kit adds neither property; `touch-action` is only the touch
						// half of the same problem.
						className={`group relative flex items-center pr-1 transition-colors ${
							// Indented by the chevron's width, so a project inside a group
							// lines up under the group's name rather than under its chevron.
							parentGroupRowId ? 'pl-4' : ''
						} ${canReorder ? 'touch-none select-none' : ''} ${
							isDragging
								? // **The source row is a placeholder now, not the lift.** The
									// chip in the overlay is what is being carried, so this marks
									// only where it came from — dimmed, no ring, no tone, so it
									// competes with nothing. It used to carry the tonal step and
									// hairline ring, which made sense while the row itself was
									// what you dragged.
									'opacity-40'
								: // **The completed dwell changes what the drop means, so it has
									// to change how the row looks.** An accent ring plus the label
									// below, on the *target* — which is only visible because the
									// row in your hand is a chip that does not cover it.
									dwelling
									? 'bg-secondary ring-1 ring-primary'
									: isActive
										? 'bg-secondary'
										: 'hover:bg-secondary/50'
						}`}
						data-testid={`project-row-${project.id}`}
					>
						<DropLine indicator={indicator} />
						<IconButton
							aria-label={
								expanded ? `Collapse ${project.displayName}` : `Expand ${project.displayName}`
							}
							aria-expanded={expanded}
							className="my-1 mr-1 ml-1"
							onClick={() => toggleProject(project.id)}
						>
							<ChevronRight className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
						</IconButton>

						<Link
							to="/projects/$id"
							params={{ id: project.id }}
							// **A native anchor is draggable by default**, and that drag is
							// the HTML5 one — dead on macOS in this shell (§ 4). Without this
							// the browser starts it on the project name and dnd-kit never
							// sees the gesture at all.
							draggable={false}
							data-missing={project.missing || undefined}
							// Dimmed rather than struck through or badged: the row is still
							// worth opening — its transcripts are all still there — it just
							// can't start anything. Half-opacity says "less" without saying
							// "broken".
							className={`flex min-w-0 flex-1 items-center gap-2 py-2 text-sm ${
								isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
							} ${project.missing ? 'opacity-50' : ''}`}
							// The decoded path, because when a folder has moved the question
							// is always "moved from where?" and the name alone can't answer it.
							title={project.missing ? `Folder not found: ${project.realPath}` : undefined}
						>
							<ProjectIcon
								name={project.displayName}
								path={project.realPath}
								size={16}
								status={liveStatus}
							/>
							<span className="min-w-0 flex-1 truncate">{project.displayName}</span>
							{project.missing && (
								<span className="shrink-0 text-muted-foreground/70 text-xs">missing</span>
							)}
						</Link>

						{/* The hover pin stood here, with its state-at-rest / action-on-hover
						    glyph swap. Where a project sits is now the whole answer to what
						    the pin was asking, so the row is back to four elements.

						    What appears here instead is transient: the dwell's ring while a
						    drag is being timed on this row, then the label once it has
						    completed. Both take the slot rather than adding one, so the row
						    does not change width mid-gesture. */}
						{dwelling ? (
							<span
								data-testid="new-group-hint"
								// `pl-2` so the label does not sit flush against the name it just
								// truncated — measured in the real window, where "zack-health-…"
								// and "NEW GROUP" ran together into one string.
								className="shrink-0 pr-1 pl-2 font-medium text-primary text-xs uppercase tracking-wider"
							>
								New group
							</span>
						) : (
							dwellProgress > 0 && <DwellRing progress={dwellProgress} />
						)}

						{/* The title lives on the wrapper: a disabled button sets
						    pointer-events-none, which suppresses a native tooltip on the
						    element itself — exactly when the explanation matters most. */}
						<span
							className="flex items-center"
							title={
								canStart
									? `New session in ${project.displayName}`
									: 'No project folder on disk — cannot start a session here'
							}
						>
							<IconButton
								// Always there on the selected project: it is the one you start
								// work in, so the affordance shouldn't need hunting for.
								className={`transition-all focus-visible:opacity-100 ${
									alwaysShowControls ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
								}`}
								aria-label={`New session in ${project.displayName}`}
								disabled={!canStart}
								onClick={() => void startSession(project.id)}
							>
								<Plus />
							</IconButton>
						</span>
					</div>
				</ContextMenuTrigger>
				{/* Same reason as the group row's: `Move to group ▸ → New group…`
				    mounts an inline editor that focuses itself, and Radix's close-time
				    refocus would blur it away before you could type. */}
				<ContextMenuContent className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
					{/* The two things you come to a project to start (F22), at the top
					    and away from the arranging below. Both say "New …" because the
					    project page's own button does — two verbs on two adjacent items
					    reads as a difference that is not there. */}
					<ContextMenuItem
						disabled={project.missing}
						data-testid={`new-session-${project.id}`}
						onSelect={() => void startSession(project.id)}
					>
						<Plus />
						New session
					</ContextMenuItem>
					<ContextMenuItem
						data-testid={`new-routine-${project.id}`}
						onSelect={() =>
							void navigate({
								to: '/projects/$id',
								params: { id: project.id },
								search: { tab: 'routines', new: true },
							})
						}
					>
						<ClockFading />
						New routine
					</ContextMenuItem>
					<ContextMenuSeparator />
					{/* Present only where they work. Under a derived sort these are
					    absent rather than greyed: a disabled row invites you to hunt for
					    the thing blocking it, and the thing blocking it is a sort mode
					    two clicks away in another menu. */}
					{canReorder && (
						<>
							<ContextMenuItem onSelect={() => onNudge(rowId, -1)}>
								<ArrowUp />
								Move up
							</ContextMenuItem>
							<ContextMenuItem onSelect={() => onNudge(rowId, 1)}>
								<ArrowDown />
								Move down
							</ContextMenuItem>
							{/* **The complete keyboard path for changing level.** `Alt`+arrows
							    only walk one slot, so filing into a named group — or making one
							    — needs a target you can pick rather than step to. `New group…`
							    here is what the dwell gesture is for the mouse. */}
							{onMoveToGroup && (
								<ContextMenuSub>
									<ContextMenuSubTrigger>
										<FolderInput />
										Move to group
									</ContextMenuSubTrigger>
									<ContextMenuSubContent>
										{groups.map((group) => (
											<ContextMenuItem
												key={group.rowId}
												disabled={group.rowId === parentGroupRowId}
												onSelect={() => onMoveToGroup(rowId, group.rowId)}
											>
												{group.name}
											</ContextMenuItem>
										))}
										{groups.length > 0 && <ContextMenuSeparator />}
										<ContextMenuItem
											data-testid={`new-group-from-${project.id}`}
											onSelect={() => onMoveToGroup(rowId, null)}
										>
											<FolderPlus />
											New group…
										</ContextMenuItem>
									</ContextMenuSubContent>
								</ContextMenuSub>
							)}
							{/* Only where there is a group to leave. A greyed row would invite
							    a hunt for what is blocking it, and nothing is. */}
							{parentGroupRowId && onRemoveFromGroup && (
								<ContextMenuItem onSelect={() => onRemoveFromGroup(rowId)}>
									<FolderOutput />
									Remove from group
								</ContextMenuItem>
							)}
							<ContextMenuSeparator />
						</>
					)}
					<ContextMenuItem
						disabled={project.missing}
						onSelect={() => void openExternally(project.realPath)}
					>
						<FolderOpen />
						Reveal in file manager
					</ContextMenuItem>
					<ContextMenuSeparator />
					{/* Below the separator and away from everything else: this one has no
					    undo, and it is otherwise a slip from Reveal. */}
					<ContextMenuItem
						variant="destructive"
						data-testid={`remove-project-${project.id}`}
						onSelect={remove}
					>
						<Trash2 />
						Remove Project
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			{expanded && <SessionList project={project} />}

			{/* Only reached with something running. Removing is otherwise silent:
			    it touches nothing on disk (ADR-0004) and re-adding rebuilds the
			    index, so a dialog every time would be friction on the action this
			    whole item exists to make possible. What a live PTY changes is that
			    the alternative to killing it is leaving `claude` running with no row
			    and no tab — the invisible-agent state ADR-0005 forbids. */}
			<Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
				<DialogContent data-testid="confirm-remove-project">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<AlertTriangle className="size-5 text-destructive" />
							Remove {project.displayName}?
						</DialogTitle>
						<DialogDescription>
							{liveHere.length} running session{liveHere.length === 1 ? '' : 's'} in this project
							will be stopped. Nothing on disk is deleted — your transcripts stay where they are,
							and adding the folder back restores them.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmRemove(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							data-testid="confirm-remove-project-yes"
							onClick={() => {
								setConfirmRemove(false);
								void removeProject(project.id);
							}}
						>
							Stop &amp; remove
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</li>
	);
}

function SessionList({ project }: { project: Project }) {
	// `open` for what you have on the strip, `bySession` for what is running.
	// `pendingSessions` needs the latter: a never-messaged session that is not
	// running has no transcript and no process, so a permanent "New session" row
	// for it would be a ghost no reindex ever clears (F16).
	// The marks rather than the open record, for F22's reason: a routine's
	// session is live with no tab, and this is where you look for it.
	const open = useSessionMarks();
	const bySession = useTerminalStore((s) => s.bySession);
	// Which of these a routine started (F22) — from the store, because a routine's
	// session is live long before the indexer has a row with `routineId` on it.
	const routineOrigins = useTerminalStore((s) => s.routineBySession);
	const clock24 = usePrefsStore((s) => s.clock24);

	// Shares the project route's cache entry, so expanding a project you then
	// open costs one fetch, not two. `sessions:changed` is what actually keeps
	// this current (see useSessionsSync); the poll is the net under a missed
	// event, not the mechanism.
	const sessionsQ = useQuery({
		queryKey: queryKeys.sessions(project.id),
		queryFn: () => cmd.listSessions(project.id),
		refetchInterval: 5000,
	});

	const sessions = useMemo(() => orderSessions(sessionsQ.data ?? [], open), [sessionsQ.data, open]);
	// A session you started ten seconds ago has no index row yet, and this list
	// is where you look for it (F6). Same union the project page does — without
	// it the row you clicked `+` on reads "No sessions yet".
	const pending = useMemo(
		() => pendingSessions(bySession, project.id, sessionsQ.data),
		[bySession, project.id, sessionsQ.data],
	);
	// How many sub-agents each listed session spawned, for its delete dialog.
	// From the unfiltered response, because `orderSessions` drops sub-agent rows
	// — they are not sessions you can go back into — and the count is exactly
	// what is about to go with the parent.
	const subagentCounts = useMemo(() => countSubagents(sessionsQ.data ?? []), [sessionsQ.data]);

	if (sessionsQ.isPending) return <Row muted>Loading…</Row>;
	if (sessions.length === 0 && pending.length === 0) return <Row muted>No sessions yet</Row>;

	const hidden = (sessionsQ.data?.length ?? 0) - sessions.length;

	return (
		<ul className="mb-1" data-testid={`sidebar-sessions-${project.id}`}>
			{/* Above the indexed rows: it is the newest thing here by definition,
			    and it is the one you are looking at. */}
			{pending.map((p) => (
				<li key={p.sessionId}>
					<Link
						to="/projects/$projectId/sessions/$sessionId"
						params={{ projectId: project.id, sessionId: p.sessionId }}
						title={
							routineOrigins[p.sessionId]
								? `Started by routine — ${routineOrigins[p.sessionId].routineName}`
								: 'New session — it takes its title from your first message'
						}
						className="flex items-center gap-2 py-1.5 pr-2 pl-8 text-muted-foreground text-sm transition-colors hover:bg-secondary/50 hover:text-foreground [&.active]:text-foreground"
						activeProps={{ className: 'bg-secondary text-foreground' }}
					>
						{routineOrigins[p.sessionId] && (
							<RoutineOrigin
								name={routineOrigins[p.sessionId].routineName}
								startedAt={routineOrigins[p.sessionId].startedAt}
								clock24={clock24}
							/>
						)}
						<span className="min-w-0 flex-1 truncate">
							{routineOrigins[p.sessionId]
								? routineSessionLabel(routineOrigins[p.sessionId], clock24)
								: 'New session'}
						</span>
						<StatusDot
							status={p.status}
							background={open[p.sessionId]?.background ?? true}
							className="size-1.5"
						/>
					</Link>
				</li>
			))}
			{sessions.map((session, i) => (
				<Fragment key={session.id}>
					{/* **The divider is the mark, not a per-row icon.** Two pins in a
					    list read as a broken sort unless something says where the
					    exemption from recency ends, and a rule costs one row of height
					    where a pin glyph on every pinned row costs a column on all of
					    them. Only drawn between the two blocks: no pins, or nothing but
					    pins, and there is no boundary to show. */}
					{session.pinned === false && i > 0 && sessions[i - 1]?.pinned === true && (
						<li aria-hidden className="mx-2 my-1 border-border/60 border-t" />
					)}
					<SessionRow
						session={session}
						projectId={project.id}
						mark={open[session.id]}
						subagentCount={subagentCounts[session.id] ?? 0}
						clock24={clock24}
					/>
				</Fragment>
			))}
			{hidden > 0 && (
				// Not a scroll-forever list: the rest live on the project page.
				<li>
					<Link
						to="/projects/$id"
						params={{ id: project.id }}
						className="block py-1.5 pr-2 pl-8 text-muted-foreground/60 text-sm transition-colors hover:text-foreground"
					>
						{hidden} more…
					</Link>
				</li>
			)}
		</ul>
	);
}

interface SessionRowProps {
	session: SessionSummary;
	projectId: string;
	/** This session's entry in the marks record, when it has one — open, or
	 *  running with no tab (F16, F22). Undefined for every other row. */
	mark?: SessionMark;
	/** Sub-agents that go with it, named in the confirm dialog. */
	subagentCount: number;
	clock24: boolean;
}

/**
 * One indexed session in the sidebar's inline list, with its delete menu (F2).
 *
 * Its own component because the menu brings state — a dialog, an in-flight
 * request, an error to show — and `SessionList` renders three kinds of row.
 * Holding ten rows' worth of that in the list would mean keying every piece of
 * it by session id.
 *
 * **The pending rows above it deliberately do not have this menu.** A session
 * that has been spawned but never messaged has no transcript (ADR-0008) and so
 * no index row; there is nothing to delete, and closing its tab is what disposes
 * of it.
 */
function SessionRow({ session, projectId, mark, subagentCount, clock24 }: SessionRowProps) {
	const deleteSession = useDeleteSession();
	const setPinned = useSetSessionPinned();
	// A pin that failed says so on the row, the same way a failed copy does: the
	// menu has closed by the time the command returns, and the alternative is a
	// list that quietly did not reorder.
	const [pinFailed, setPinFailed] = useState(false);

	const [confirming, setConfirming] = useState(false);
	// In flight: the button says so and neither button can be pressed again. A
	// delete stops a PTY and then waits for it to actually exit, which is a
	// second or two on a busy agent — long enough for a second click.
	const [deleting, setDeleting] = useState(false);
	// **Shown in the dialog, which stays open.** The trash can legitimately
	// refuse — a store on a filesystem that has none — and the one thing the user
	// must not be left believing is that a delete which failed succeeded. A
	// closed dialog and an unchanged list says exactly that.
	const [error, setError] = useState<string | null>(null);
	// Whether the last copy worked, shown on the row for a moment: the menu has
	// closed by the time the clipboard write returns, so it cannot report
	// anything itself. Same transient mark the file tree's rows use, and for the
	// same missing toast (roadmap item 7).
	const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);

	const title = session.title.trim() || session.id.slice(0, 8);
	const running = mark !== undefined && mark.status !== 'stopped';

	async function togglePin() {
		setPinFailed(false);
		try {
			await setPinned(session.id, projectId, !session.pinned);
		} catch {
			setPinFailed(true);
			setTimeout(() => setPinFailed(false), 1400);
		}
	}

	async function copyTranscriptPath() {
		try {
			await navigator.clipboard.writeText(await cmd.sessionTranscriptPath(session.id));
			setCopied('yes');
		} catch {
			// Either half can refuse — the session may not be in the index any more,
			// and a clipboard write can be turned down by the platform. A tick for
			// something that didn't happen is worse than a cross: you would paste a
			// stale path into a bug report and not know why it was wrong.
			setCopied('failed');
		}
		setTimeout(() => setCopied(null), 1400);
	}

	async function confirmDelete() {
		setDeleting(true);
		setError(null);
		try {
			await deleteSession(session.id, projectId);
			setConfirming(false);
		} catch (e) {
			setError(formatError(e));
		} finally {
			setDeleting(false);
		}
	}

	return (
		<li>
			{/* Three items. Clicking the row is still what opens the session, so this
			    stays the menu of things the row itself cannot do: pinning it, where
			    the transcript is, and deleting it. Anything beyond those would be a
			    decoy around the only entry here that cannot be undone from inside
			    the app, which is why the destructive one sits below a separator. */}
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<Link
						to="/projects/$projectId/sessions/$sessionId"
						params={{ projectId, sessionId: session.id }}
						// The stamp is in the row too, but a long title truncates it
						// away — so the tooltip carries it as well (2026-08-29, user
						// report). Same reason the origin icon's own tooltip does.
						title={
							session.routineStartedAt !== null
								? `${title} · ran ${formatStamp(new Date(session.routineStartedAt), clock24)}`
								: title
						}
						className="flex items-center gap-2 py-1.5 pr-2 pl-8 text-muted-foreground text-sm transition-colors hover:bg-secondary/50 hover:text-foreground [&.active]:text-foreground"
						activeProps={{ className: 'bg-secondary text-foreground' }}
					>
						{session.routineId && (
							<RoutineOrigin
								name={session.routineName}
								startedAt={session.routineStartedAt}
								clock24={clock24}
							/>
						)}
						<span className="min-w-0 flex-1 truncate">
							{title}
							{/* The moment it ran, kept after Claude has titled the
							    session: it is the only thing telling two runs of a daily
							    routine apart, and it used to vanish on the agent's first
							    answer (2026-08-29, user report). */}
							{session.routineStartedAt !== null && (
								<span className="text-muted-foreground/60">
									{' · '}
									{formatStamp(new Date(session.routineStartedAt), clock24)}
								</span>
							)}
						</span>
						{copied === 'yes' && (
							<Check data-testid="session-path-copied" className="size-3.5 shrink-0 text-primary" />
						)}
						{copied === 'failed' && (
							<X
								data-testid="session-path-copy-failed"
								className="size-3.5 shrink-0 text-destructive"
							/>
						)}
						{pinFailed && (
							<X
								data-testid={`pin-session-failed-${session.id}`}
								className="size-3.5 shrink-0 text-destructive"
							/>
						)}
						{mark && (
							// Smaller than the standalone dot: down a column of nested rows the
							// full-size dot is the loudest thing on screen. It stayed at 6px when
							// the rows went to 14px — it marks which session is open, and a mark
							// that grows with its label starts competing with it.
							<StatusDot status={mark.status} background={mark.background} className="size-1.5" />
						)}
					</Link>
				</ContextMenuTrigger>
				{/* No `w-56` here, unlike the project row's. That width exists to stop
				    a menu of eight items of different lengths ragging; two short items
				    in a 224px box just read as a mis-sized menu. */}
				<ContextMenuContent>
					{/* First, because it is the only reversible thing here you would
					    reach for twice. */}
					<ContextMenuItem
						data-testid={`pin-session-${session.id}`}
						onSelect={() => void togglePin()}
					>
						{session.pinned ? <PinOff /> : <Pin />}
						{session.pinned ? 'Unpin session' : 'Pin session'}
					</ContextMenuItem>
					{/* The transcript file, not the session id. It is what you hand to
					    another agent, to `jq`, or to a bug report, and finding it by
					    hand means knowing how Claude encodes a project path into a
					    directory name. */}
					<ContextMenuItem
						data-testid={`copy-session-path-${session.id}`}
						onSelect={() => void copyTranscriptPath()}
					>
						<Route />
						Copy transcript path
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem
						variant="destructive"
						data-testid={`delete-session-${session.id}`}
						onSelect={() => {
							setError(null);
							setConfirming(true);
						}}
					>
						<Trash2 />
						Delete session
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			{/* Always asks. This is the only action in the app that removes the
			    user's own work, and the row it starts from is one pixel of travel
			    from the row that merely opens the session. */}
			<Dialog
				open={confirming}
				onOpenChange={(next) => {
					// Not dismissible mid-flight: the PTY is being stopped and the
					// transcript moved, and a dialog that vanishes halfway leaves you
					// guessing which half happened.
					if (deleting) return;
					setConfirming(next);
				}}
			>
				<DialogContent data-testid="confirm-delete-session">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<AlertTriangle className="size-5 text-destructive" />
							Delete {title}?
						</DialogTitle>
						<DialogDescription>
							{running
								? 'This session is running. It will be stopped first, and its transcript moved to the trash — '
								: 'Its transcript moves to the trash — '}
							{/* Where it went, not "this cannot be undone": the sentence is
							    true, and a true sentence that names the way back is less
							    frightening than a warning that overstates the loss. */}
							you can restore it from there, and factorai will list the session again when you do.
							{subagentCount > 0 &&
								` ${subagentCount} sub-agent transcript${subagentCount === 1 ? '' : 's'} go with it.`}
						</DialogDescription>
					</DialogHeader>
					{error && (
						// The dialog stays open behind this. Nothing was deleted, and the
						// row is still in the list to try again from.
						<p
							data-testid="delete-session-error"
							className="rounded-sm bg-destructive/10 px-3 py-2 text-destructive text-sm"
						>
							{error}
						</p>
					)}
					<DialogFooter>
						<Button variant="outline" disabled={deleting} onClick={() => setConfirming(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={deleting}
							data-testid="confirm-delete-session-yes"
							onClick={() => void confirmDelete()}
						>
							{deleting ? 'Deleting…' : running ? 'Stop & delete' : 'Delete'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</li>
	);
}

function Row({ children, muted }: { children: string; muted?: boolean }) {
	return (
		<p
			className={`py-1.5 pl-8 text-sm ${muted ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}
		>
			{children}
		</p>
	);
}
