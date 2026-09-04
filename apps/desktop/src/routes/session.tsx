import type { SessionSummary, TerminalId } from '@factorai/types';
import { Button, IconButton } from '@factorai/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import {
	BookOpen,
	GitBranch,
	IdCard,
	GitCommitHorizontal,
	Pin,
	PinOff,
	Play,
	TriangleAlert,
	X,
} from 'lucide-react';
import { useState } from 'react';
import { CloseSessionConfirm, needsCloseConfirm } from '@components/dialog/CloseSessionConfirm';
import { StatusDot } from '@components/layout/StatusDot';
import { CheckoutMenu } from '@components/session/CheckoutMenu';
import { SubAgentTranscript } from '@components/session/SubAgentTranscript';
import { disposeTerminal, restartSession, Terminal } from '@components/terminal/Terminal';
import { useActiveCheckout } from '@hooks/useActiveCheckout';
import { useGitBranch } from '@hooks/useGitBranch';
import { useSetSessionPinned } from '@hooks/useSetSessionPinned';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { usePrefsStore } from '@store/prefsStore';
import { useTerminalStore } from '@store/terminalStore';
import { rootRoute } from './__root';

/**
 * What to call this session in the header.
 *
 * A session factorai just started has no index row until claude writes its
 * transcript and the watcher reindexes, so it gets a name rather than the raw
 * uuid it is routed by. An indexed session with no derived title falls back to
 * its short id, matching the session list.
 */
function sessionLabel(sessionId: string, sessions: SessionSummary[] | undefined): string {
	if (!sessions) return sessionId.slice(0, 8);
	const session = sessions.find((s) => s.id === sessionId);
	if (!session) return 'New session';
	return session.title.trim() || sessionId.slice(0, 8);
}

function SessionView() {
	const { sessionId, projectId } = sessionRoute.useParams();

	const queryClient = useQueryClient();

	const projectsQ = useQuery({
		queryKey: queryKeys.projects(),
		queryFn: () => cmd.listProjects(),
	});
	const project = projectsQ.data?.find((p) => p.id === projectId);
	const projectCwd = project?.realPath ?? null;

	// **Which checkout this session is working in** (F21). Absent for a
	// single-checkout project, which is the 95% case — so that header renders
	// exactly as it did before any of this existed.
	const { root, projectRoot, isLinked, worktrees } = useActiveCheckout();

	// The header's branch badge. **The checkout's branch, not the project's**
	// (F21) — corrected 2026-08-21, having shipped for one commit saying `main`
	// beside a worktree that was on `demo/worktree`. A badge naming a branch you
	// are not looking at is worse than no badge, and it made the two facts beside
	// each other contradict rather than complement.
	//
	// `root` rather than `projectCwd`, so it still always names *this session's*
	// tree (F3) — and it shares `gitStatus`'s cache entry for that path, which is
	// the one the panel is already polling.
	const branch = useGitBranch(root);
	// The commit a branchless checkout is sitting on. Null unless the checkout is
	// one git knows and is really on disk — a folder that is not a repository has
	// no branch *and* no commit, and that case still draws nothing at all.
	const detachedAt = branch ? null : (worktrees.find((w) => w.path === root)?.head ?? null);
	const clearWorktree = useTerminalStore((s) => s.clearWorktree);
	const pinWorktree = useTerminalStore((s) => s.pinWorktree);

	/**
	 * Root the panel on a checkout the human picked (F21).
	 *
	 * The store first, then the row: the pick is a gesture, and a panel that
	 * waits for a round trip before acknowledging one reads as a panel that
	 * ignored it. The write is what makes it survive a reload, and a failure is
	 * logged rather than raised for the same reason the revert's is — the panel
	 * has already moved, and what is lost is only tomorrow's memory of it.
	 */
	function pickWorktree(path: string) {
		const branchOf = worktrees.find((w) => w.path === path)?.branch ?? null;
		pinWorktree(sessionId, path, branchOf);
		if (!projectRoot) return;
		void cmd
			.setSessionWorktree(sessionId, projectRoot, path)
			.then(() => queryClient.invalidateQueries({ queryKey: queryKeys.sessions(projectId) }))
			.catch((e) => console.error('set_session_worktree failed', e));
	}

	/**
	 * Back to the checkout this session's own cwd is in.
	 *
	 * **An undo of a move the agent made by itself, not a picker.** It clears the
	 * record as well as the live signal, because leaving the row would resolve
	 * straight back to the checkout you just left. It takes no lock either: the
	 * next signal moves the panel again, which is what makes it an undo.
	 */
	function revertWorktree() {
		clearWorktree(sessionId);
		void cmd
			.clearSessionWorktree(sessionId)
			.then(() => queryClient.invalidateQueries({ queryKey: queryKeys.sessions(projectId) }))
			// The in-memory half already happened, so the panel has moved; this only
			// means it will come back on the next reload. Worth a log, not a dialog.
			.catch((e) => console.error('clear_session_worktree failed', e));
	}

	// Shares the project route's cache entry, so arriving from the session list
	// costs nothing. Refetched on `sessions:changed`-driven invalidation, which
	// is what swaps "New session" for the derived title.
	const sessionsQ = useQuery({
		queryKey: queryKeys.sessions(projectId),
		queryFn: () => cmd.listSessions(projectId),
	});

	// A sub-agent's transcript can be read but never resumed: `claude --resume`
	// probes for a top-level `<id>.jsonl` and an agent id has none, so opening
	// one as a terminal would spawn a fresh claude under the agent's id. The
	// index row is the authority — it says where the transcript actually lives.
	const session = sessionsQ.data?.find((s) => s.id === sessionId);
	const isSubAgent = session?.subagentOf != null;

	// Which Claude identity this session is (F25). Named in the header only when
	// it is *not* the default: a badge on every session in a single-profile
	// install would be a label that never varies, and this one has to mean
	// "not what you would assume".
	const profilesQ = useQuery({
		queryKey: queryKeys.profiles(),
		queryFn: () => cmd.listProfiles(),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
	const profileName =
		session?.profileName &&
		!profilesQ.data?.some((p) => p.isDefault && p.name === session.profileName)
			? session.profileName
			: null;

	// Why this session's IDE bridge is unusable, if it is (F20). Undefined is
	// the normal case and draws nothing.
	const ideIssue = useTerminalStore((s) => s.ideIssues[sessionId]);

	const live = useTerminalStore((s) => s.bySession[sessionId]);
	const detach = useTerminalStore((s) => s.detach);
	// Remounting the Terminal (new key) tears down the dead xterm and triggers a
	// fresh spawn — used to restart a stopped session. The counter lives in the
	// store rather than here because the tab strip restarts sessions too (F16),
	// and it cannot reach a `useState` in this component.
	const restartEpoch = useTerminalStore((s) => s.restartEpoch[sessionId] ?? 0);
	// Read as two scalars and assembled in the handler, not through a selector
	// that builds an object — that would hand zustand a new reference on every
	// store read.
	const confirmCloseSession = usePrefsStore((s) => s.confirmCloseSession);
	const confirmCloseMiddleClick = usePrefsStore((s) => s.confirmCloseMiddleClick);
	const confirmPrefs = { confirmCloseSession, confirmCloseMiddleClick };
	// The confirm is open while this is true. Killing a live agent is
	// irreversible, and this header used to do it on one unguarded click —
	// see `00-overview.md` § "The operating model".
	const [closing, setClosing] = useState(false);
	// A pin that failed colours the button for a moment. The alternative is a
	// header that says the session is pinned while the list disagrees.
	const [pinFailed, setPinFailed] = useState(false);
	const setPinned = useSetSessionPinned();
	const navigate = useNavigate();

	async function togglePin() {
		if (!session) return;
		setPinFailed(false);
		try {
			await setPinned(session.id, projectId, !session.pinned);
		} catch {
			setPinFailed(true);
			setTimeout(() => setPinFailed(false), 1400);
		}
	}

	/**
	 * Closing a session ends your business with it, so leave rather than
	 * parking on a dead pane reading `[process exited]`.
	 *
	 * "Close", not "stop": this kills the PTY, disposes the pooled xterm and
	 * navigates away. The header said `Stop` behind a `Square` icon, which reads
	 * as halting a process you stay parked on.
	 *
	 * The pooled xterm is disposed too, not just killed: terminals survive
	 * navigation by design (they live in `terminalStore`, not in this
	 * component), so keeping it would mean coming back to this URL later and
	 * finding that same exit message instead of a working session. Disposed, the
	 * next visit spawns fresh against the same session id and resumes the
	 * transcript — F6's rule that opening a session view *is* starting it.
	 *
	 * A process that exits on its own is deliberately NOT redirected: then the
	 * exit message is the thing you came to read, and Restart is right there.
	 */
	async function closeSession(terminalId: TerminalId) {
		setClosing(false);
		try {
			await cmd.terminalKill(terminalId);
			// Drop it from the store now rather than waiting for `terminal:exit`,
			// exactly as the tab strip does: we know what we just did, and a tab
			// that lingers until an event arrives is a tab that lingers forever if
			// the event is ever missed. This header used to leave that to the
			// event and so left its own tab behind.
			detach(sessionId);
		} catch (e) {
			// Leaving anyway, and deliberately *not* detaching: a kill that failed
			// means the PTY may still be running, and the project page will say so
			// through its status dot — better than sitting on a page whose button
			// appeared to do nothing, and better than a tab quietly disappearing
			// off a process that is still alive.
			console.error('terminal_kill failed', e);
		}
		disposeTerminal(sessionId);
		// **The project's shells are left running** (ADR-0032). Closing a session
		// is a gesture about the agent above the footer, and F23's first version
		// killed a build in it on every one of those.
		//
		// The project route names its param `id`; only the session route calls it
		// `projectId` (see useActiveProject, which reads both).
		void navigate({ to: '/projects/$id', params: { id: projectId } });
	}

	return (
		<main className="flex h-full flex-col bg-[#0c0e12]">
			<header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
				{/* The only animated dot in the app: one per screen, describing the
				    session you are actually looking at (see StatusDot). A sub-agent
				    has no process to describe, so it gets the marker instead. */}
				{isSubAgent ? (
					<BookOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
				) : (
					<StatusDot status={live?.status ?? 'stopped'} pulse />
				)}
				<span className="truncate text-foreground text-sm">
					{project?.displayName ?? projectId}
				</span>
				{/* Quiet by design: muted, no border, no background — it says where you
				    are, it is not a control. Absent entirely when the project is not a
				    repository, so a non-git project's header looks exactly as it did.
				    `max-w-[12rem]` so a long branch name truncates instead of pushing
				    the Close button around; the full name is on hover, following the
				    session id below it. */}
				{branch ? (
					<span
						className="flex min-w-0 max-w-[12rem] shrink-0 items-center gap-1 text-muted-foreground text-xs"
						title={`On branch ${branch}`}
						data-testid="session-branch"
					>
						<GitBranch className="size-3 shrink-0" aria-hidden />
						<span className="truncate">{branch}</span>
					</span>
				) : (
					/* **A detached HEAD is a state, not a missing fact.** The badge used
					   to be absent for it, which is right when the folder is not a
					   repository at all and wrong here: beside a checkout mark that is
					   present, the gap reads as "this app has nothing to say about the
					   branch" rather than "there is no branch". The commit icon is the
					   distinction — this is a position in history, not a name for one —
					   and the short SHA is what you would have run `git status` for. */
					detachedAt && (
						<span
							className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs"
							title={`Detached HEAD at ${detachedAt}`}
							data-testid="session-branch"
						>
							<GitCommitHorizontal className="size-3 shrink-0" aria-hidden />
							<span>{detachedAt.slice(0, 7)}</span>
						</span>
					)
				)}
				{/* **Which Claude identity this session is** (F25). Where the branch and
				    the checkout are said, and for the same reason: it is a fact about
				    what you are looking at, so it is quiet — muted, no border, not a
				    control. There is nothing to click, because a session's profile
				    cannot change: `CLAUDE_CONFIG_DIR` is read at spawn and the
				    transcript lives under the directory it was written in.

				    **Drawn only when it is not the default**, so a single-profile
				    install's header is byte-identical to what it was, and the badge
				    means "not the identity you would assume" rather than being a label
				    every session carries. */}
				{profileName && (
					<span
						className="flex min-w-0 max-w-[10rem] shrink-0 items-center gap-1 text-muted-foreground text-xs"
						title={`Running as the ${profileName} Claude profile`}
						data-testid="session-profile"
					>
						<IdCard className="size-3 shrink-0" aria-hidden />
						<span className="truncate">{profileName}</span>
					</span>
				)}
				{/* **The checkout, beside the branch and never instead of it** (F21).
				    Two facts rather than one: they usually agree, and the cases where
				    they do not — a detached HEAD in a worktree, two checkouts on one
				    branch — are exactly when you need to know.

				    Drawn only when the repository *has* a second checkout, so a
				    single-checkout header is byte-identical to what it was. It is the
				    picker's trigger as well as the mark, and that is the whole
				    control: the revert moved inside it when it shipped, rather than
				    leaving two clickable things in the header for one subject. */}
				{worktrees.length > 1 && root && (
					<CheckoutMenu
						worktrees={worktrees}
						current={root}
						onSelect={pickWorktree}
						onRevert={isLinked ? revertWorktree : null}
					/>
				)}
				{/* **The pin's control, and its mark** (F2). The session you are looking
				    at is the one you know you want kept, so this is where the decision
				    is made — and the sidebar shows ten rows, so a pin made three days
				    ago is otherwise a fact only the list holds.

				    **At rest it shows the state; on hover it shows the action.** A filled
				    pin means pinned, an outline pin means not, so the glyph is readable
				    without hovering and without leaning on colour alone. Point at it and
				    it becomes what the click will do: `PinOff` over a pinned session,
				    the filled pin over an unpinned one — a preview of the result rather
				    than a repeat of the state.

				    The swap is CSS on the button's own `group`, not a React hover state:
				    a re-render per pointer entry, for two glyphs whose only difference is
				    which one is `hidden`, is state nobody needs.

				    Absent for a sub-agent — not a session you go back into, and the
				    backend refuses to pin one — and absent until the index has a row,
				    which is what a pin hangs off (ADR-0008). */}
				{session && !isSubAgent && (
					<IconButton
						data-testid="session-pin"
						aria-label={session.pinned ? 'Unpin session' : 'Pin session'}
						aria-pressed={session.pinned}
						title={
							pinFailed
								? 'Could not change the pin'
								: session.pinned
									? 'Unpin — stop keeping it at the top of this project'
									: 'Pin to the top of this project'
						}
						onClick={() => void togglePin()}
						className={`group ${pinFailed ? 'text-destructive' : session.pinned ? 'text-primary' : ''}`}
					>
						{session.pinned ? (
							<>
								{/* lucide draws outlines, so "filled" is `fill-current` rather
								    than a second icon. */}
								<Pin className="fill-current group-hover:hidden" aria-hidden />
								<PinOff className="hidden group-hover:block" aria-hidden />
							</>
						) : (
							<>
								<Pin className="group-hover:hidden" aria-hidden />
								<Pin className="hidden fill-current group-hover:block" aria-hidden />
							</>
						)}
					</IconButton>
				)}
				{/* The full id is one hover away rather than spending header width on
				    36 characters nobody reads. */}
				<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs" title={sessionId}>
					{isSubAgent ? 'sub-agent' : sessionLabel(sessionId, sessionsQ.data)}
				</span>
				{/* **The bridge is broken for this session** (F20). Nothing is drawn
				    while it works: a badge for a healthy bridge is a label that is
				    always on, and that is a label you stop reading. This is the one
				    state worth a pixel, because an agent that *cannot* open a file
				    looks exactly like an agent that chose not to.

				    Immediately before the close control rather than out among the
				    project and branch names: those say where you are, this says
				    something is wrong, and the right-hand end is where this header
				    already keeps the things you act on. */}
				{ideIssue && (
					<span
						data-testid="session-ide-issue"
						title={`Claude cannot open files in this window — ${ideIssue}`}
						className="flex shrink-0 items-center gap-1 text-destructive text-xs"
					>
						<TriangleAlert className="size-3.5 shrink-0" aria-hidden />
						<span>Bridge</span>
					</span>
				)}
				{isSubAgent ? (
					// No Stop/Restart: there is no process to stop, and restarting
					// is the resume that cannot work (see isSubAgent above).
					<span className="text-muted-foreground text-xs">read-only</span>
				) : live ? (
					// An icon, not a labelled button: it does what a tab's × does, and
					// the two surfaces should not disagree about the gesture any more
					// than they do about the confirm (F16, F3).
					<IconButton
						aria-label="Close session"
						title="Close session"
						// Asks only while Claude is working, and only if you left the
						// question on (F10, F11). `needsCloseConfirm` is shared with the
						// tab strip so the two cannot disagree about when — and this is
						// the `×` gesture, the same one a tab's close button is.
						onClick={() =>
							needsCloseConfirm(live.status, 'button', confirmPrefs)
								? setClosing(true)
								: void closeSession(live.terminalId)
						}
					>
						<X />
					</IconButton>
				) : (
					<Button
						size="sm"
						variant="outline"
						className="gap-1.5"
						// The same call a click on this session's stopped tab makes, so the
						// two surfaces cannot drift about what a restart is.
						onClick={() => restartSession(sessionId)}
					>
						<Play className="size-3" /> Restart
					</Button>
				)}
			</header>
			{/* The project's shell footer is not here — it is in `AppShell`, so it
			    is drawn on this route, the project page and a sub-agent transcript
			    alike, and a pane's host survives a session switch instead of being
			    torn out of the document (F23, ADR-0032). */}
			{isSubAgent ? (
				<SubAgentTranscript sessionId={sessionId} />
			) : (
				<div className="min-h-0 flex-1">
					<Terminal
						key={restartEpoch}
						sessionId={sessionId}
						projectId={projectId}
						projectCwd={projectCwd}
						// Where a relative path in the output resolves from (F19).
						// Recorded in the transcript, so it is only ever different from
						// the project root for a resumed session started in a
						// subdirectory — which is exactly the case the fallback exists
						// for.
						sessionCwd={session?.cwd ?? null}
					/>
				</div>
			)}
			{/* The same dialog the tab strip opens — one component, so the two
			    call sites cannot drift apart. A dead session needs no confirm, so
			    only the live branch above can open it. */}
			<CloseSessionConfirm
				sessionName={closing ? sessionLabel(sessionId, sessionsQ.data) : null}
				canConfirm={Boolean(live)}
				onCancel={() => setClosing(false)}
				onConfirm={() => live && void closeSession(live.terminalId)}
			/>
		</main>
	);
}

export const sessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/projects/$projectId/sessions/$sessionId',
	component: SessionView,
});
