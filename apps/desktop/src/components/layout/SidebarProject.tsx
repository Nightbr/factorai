import { ProjectIcon } from '@components/layout/ProjectIcon';
import { StatusDot } from '@components/layout/StatusDot';
import type { GitWorktree, Project, SessionSummary, TerminalStatus } from '@factorai/types';
import {
	Button,
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	IconButton,
} from '@factorai/ui';
import { useOpenSessions } from '@hooks/useOpenSessions';
import { liveSessionsIn, useRemoveProject } from '@hooks/useRemoveProject';
import { useStartSession } from '@hooks/useStartSession';
import { queryKeys } from '@lib/queryKeys';
import { pendingSessions } from '@lib/sessionGroups';
import { cmd, openExternally } from '@lib/tauri';
import { checkoutContaining, checkoutLabel, useWorktrees } from '@hooks/useWorktrees';
import { useSidebarStore } from '@store/sidebarStore';
import { useTerminalStore } from '@store/terminalStore';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, ChevronRight, FolderOpen, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

/** How many sessions an expanded project shows. Enough to cover "the one I was
 *  just in", short enough that expanding two projects doesn't bury the list. */
export const SIDEBAR_SESSION_LIMIT = 10;

/**
 * Newest-first, but anything with a live PTY first of all.
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
	return sessions
		.filter((s) => s.subagentOf === null)
		.sort((a, b) => {
			const aOpen = a.id in open ? 1 : 0;
			const bOpen = b.id in open ? 1 : 0;
			if (aOpen !== bOpen) return bOpen - aOpen;
			return b.updatedAt - a.updatedAt;
		})
		.slice(0, limit);
}

interface SidebarProjectProps {
	project: Project;
	isActive: boolean;
	/** Worst-status-wins roll-up of this project's live sessions, or undefined
	 *  when it has none (F10). Was `isLive: boolean` while a live PTY was one
	 *  state and the dot could only mean "connected". */
	liveStatus?: TerminalStatus;
}

export function SidebarProject({ project, isActive, liveStatus }: SidebarProjectProps) {
	const expanded = useSidebarStore((s) => s.expanded.includes(project.id));
	const toggleProject = useSidebarStore((s) => s.toggleProject);
	const startSession = useStartSession();
	const togglePin = usePinProject(project);
	const removeProject = useRemoveProject();
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
	// Pinned and selected projects keep their controls on show: both are rows you
	// act on repeatedly, so the affordance shouldn't need hunting for. Everything
	// else stays quiet until hovered.
	const alwaysShowControls = project.pinned || isActive;

	return (
		<li>
			{/* F1 once rejected a right-click menu here, on the grounds that one
			    action (pin) didn't justify building the system. That reasoning has
			    expired: there are three now, and one of them — Remove — has nowhere
			    else sane to live. A fifth hover target in a 180px row would be a
			    misclick waiting to happen, and this row has no undo. */}
			<ContextMenu>
				<ContextMenuTrigger asChild>
					{/* The row is a flex container, so the hover background covers the
					    chevron, the link and the + alike. Each is a SIBLING of the Link —
					    nesting a button inside an anchor is invalid, and the two would
					    fight over the click. */}
					<div
						className={`group flex items-center pr-1 transition-colors ${
							isActive ? 'bg-secondary' : 'hover:bg-secondary/50'
						}`}
						data-testid={`project-row-${project.id}`}
					>
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

						<IconButton
							// `group/pin` scopes the glyph swap below to THIS icon's hover, not
							// the row's — the row already owns the bare `group`.
							className={`group/pin transition-all focus-visible:opacity-100 ${
								alwaysShowControls ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
							}`}
							aria-label={
								project.pinned ? `Unpin ${project.displayName}` : `Pin ${project.displayName}`
							}
							title={project.pinned ? 'Unpin' : 'Pin to top'}
							onClick={() => togglePin()}
						>
							{project.pinned ? (
								<>
									{/* Filled at rest says "pinned"; slashed under the cursor says
									    what the click will do. */}
									<Pin className="fill-current group-hover/pin:hidden" />
									<PinOff className="hidden group-hover/pin:block" />
								</>
							) : (
								<Pin />
							)}
						</IconButton>

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
								// Always there on a pinned or selected project: those are the ones
								// you start work in, so the affordance shouldn't need hunting for.
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
				<ContextMenuContent className="w-56">
					<ContextMenuItem onSelect={() => togglePin()}>
						{project.pinned ? <PinOff /> : <Pin />}
						{project.pinned ? 'Unpin' : 'Pin to top'}
					</ContextMenuItem>
					<ContextMenuItem
						disabled={project.missing}
						onSelect={() => void openExternally(project.realPath)}
					>
						<FolderOpen />
						Reveal in file manager
					</ContextMenuItem>
					<ContextMenuSeparator />
					{/* Below the separator and nowhere near Pin: this one has no undo,
					    and the two are otherwise a slip apart. */}
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

/**
 * Pin/unpin, applied to the cached list before the write lands.
 *
 * The projects query polls every 2s, so without the optimistic write the row
 * would sit still for up to two seconds after a click — long enough to click
 * again and toggle it straight back. `list_projects` re-derives the true order
 * on the next fetch, so a failed write self-corrects rather than needing a
 * rollback path.
 */
function usePinProject(project: Project): () => void {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		mutationFn: (pinned: boolean) => cmd.pinProject(project.id, pinned),
		onMutate: (pinned: boolean) => {
			queryClient.setQueryData<Project[]>(queryKeys.projects(), (previous) =>
				previous?.map((p) => (p.id === project.id ? { ...p, pinned } : p)),
			);
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.projects() }),
	});

	return () => mutation.mutate(!project.pinned);
}

function SessionList({ project }: { project: Project }) {
	// The repository's checkouts, for the per-row mark below (F21). Shares the
	// panel's 30s query for this path, so an expanded project costs no new poll.
	const worktrees = useWorktrees(project.realPath);
	// `open` for what you have on the strip, `bySession` for what is running.
	// `pendingSessions` needs the latter: a never-messaged session that is not
	// running has no transcript and no process, so a permanent "New session" row
	// for it would be a ghost no reindex ever clears (F16).
	const open = useOpenSessions();
	const bySession = useTerminalStore((s) => s.bySession);

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
						title="New session — it takes its title from your first message"
						className="flex items-center gap-2 py-1.5 pr-2 pl-8 text-muted-foreground text-sm transition-colors hover:bg-secondary/50 hover:text-foreground [&.active]:text-foreground"
						activeProps={{ className: 'bg-secondary text-foreground' }}
					>
						<span className="min-w-0 flex-1 truncate">New session</span>
						<StatusDot status={p.status} className="size-1.5" />
					</Link>
				</li>
			))}
			{sessions.map((session) => (
				<li key={session.id}>
					<Link
						to="/projects/$projectId/sessions/$sessionId"
						params={{ projectId: project.id, sessionId: session.id }}
						title={session.title || session.id}
						className="flex items-center gap-2 py-1.5 pr-2 pl-8 text-muted-foreground text-sm transition-colors hover:bg-secondary/50 hover:text-foreground [&.active]:text-foreground"
						activeProps={{ className: 'bg-secondary text-foreground' }}
					>
						<span className="min-w-0 flex-1 truncate">
							{session.title.trim() || session.id.slice(0, 8)}
						</span>
						{/* **Which checkout this session ran in** (F21), when it is not the
						    project's own. The roll-up mixes worktrees into one list, so
						    without this two rows of the same project are indistinguishable
						    and you resume the wrong one. `text-xs` metadata, the same voice
						    as the project row's `missing`.

						    The directory's own name rather than its branch: no query, and
						    the folder name is what tells two worktrees apart anyway — the
						    branch is on the session header once you are in it. */}
						{checkoutMark(session, worktrees, project.realPath) && (
							<span
								className="shrink-0 text-muted-foreground/70 text-xs"
								data-testid="sidebar-session-checkout"
							>
								{checkoutMark(session, worktrees, project.realPath)}
							</span>
						)}
						{open[session.id] && (
							// Smaller than the standalone dot: down a column of nested rows the
							// full-size dot is the loudest thing on screen. It stayed at 6px when
							// the rows went to 14px — it marks which session is open, and a mark
							// that grows with its label starts competing with it.
							<StatusDot status={open[session.id].status} className="size-1.5" />
						)}
					</Link>
				</li>
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

function Row({ children, muted }: { children: string; muted?: boolean }) {
	return (
		<p
			className={`py-1.5 pl-8 text-sm ${muted ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}
		>
			{children}
		</p>
	);
}

/**
 * The checkout a session ran in, when it is not the project's own folder (F21).
 *
 * `null` for the ordinary case, which draws nothing. A session attaches to a
 * project by exact path *or* by being a checkout of its repository, so a
 * directory that is not the project folder is another checkout — no query needed
 * to know that, only to name its branch, which the session header does instead.
 *
 * **The same resolution the panel uses**, and it has to be: keying on "the
 * session's directory differs from the project's" alone marks every row whose
 * agent left its shell in a subdirectory — `apps/desktop/src-tauri` is a
 * different string from the project root and is not a different checkout.
 * Containment against the real checkout list is what tells those apart.
 *
 * `lastCwd` before `cwd` for the reason `useActiveCheckout` has: an agent that
 * moved into a worktree mid-session leaves the *first* cwd pointing at the
 * project, so reading that alone left the row unmarked for exactly the sessions
 * this mark exists to distinguish.
 */
function checkoutMark(
	session: SessionSummary,
	worktrees: readonly GitWorktree[],
	projectRoot: string,
): string | null {
	const resolved =
		checkoutContaining(worktrees, session.lastCwd) ?? checkoutContaining(worktrees, session.cwd);
	if (!resolved || resolved.path === projectRoot) return null;
	return checkoutLabel(resolved);
}
