import type { SessionSummary, TerminalId } from '@factorai/types';
import { Button, IconButton } from '@factorai/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import {
	BookOpen,
	CornerUpLeft,
	FolderGit2,
	GitBranch,
	Play,
	TriangleAlert,
	X,
} from 'lucide-react';
import { useState } from 'react';
import { CloseSessionConfirm, needsCloseConfirm } from '@components/dialog/CloseSessionConfirm';
import { StatusDot } from '@components/layout/StatusDot';
import { SubAgentTranscript } from '@components/session/SubAgentTranscript';
import { disposeTerminal, restartSession, Terminal } from '@components/terminal/Terminal';
import { useActiveCheckout } from '@hooks/useActiveCheckout';
import { useGitBranch } from '@hooks/useGitBranch';
import { checkoutLabel } from '@hooks/useWorktrees';
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
	const { root, worktree, isLinked } = useActiveCheckout();

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
	const clearWorktree = useTerminalStore((s) => s.clearWorktree);

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
	const navigate = useNavigate();

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
				{branch && (
					<span
						className="flex min-w-0 max-w-[12rem] shrink-0 items-center gap-1 text-muted-foreground text-xs"
						title={`On branch ${branch}`}
						data-testid="session-branch"
					>
						<GitBranch className="size-3 shrink-0" aria-hidden />
						<span className="truncate">{branch}</span>
					</span>
				)}
				{/* **The checkout, beside the branch and never instead of it** (F21).
				    Two facts rather than one: they usually agree, and the cases where
				    they do not — a detached HEAD in a worktree, two checkouts on one
				    branch — are exactly when you need to know. Drawn only when the
				    session is off the project's own checkout, so a single-checkout
				    header is byte-identical to what it was.

				    The badge stays quiet by design, like the branch (F3). The revert
				    beside it is the one clickable thing added, and it is there because
				    the panel moves by itself: without it a signal you did not want
				    leaves you with no way back. */}
				{isLinked && worktree && (
					<span
						className="flex min-w-0 max-w-[12rem] shrink-0 items-center gap-1 text-muted-foreground text-xs"
						title={`Working in the worktree ${worktree.path}`}
						data-testid="session-worktree"
					>
						<FolderGit2 className="size-3 shrink-0" aria-hidden />
						<span className="truncate">{checkoutLabel(worktree)}</span>
						<IconButton
							aria-label="Back to this session's own checkout"
							title="Back to this session's own checkout"
							onClick={revertWorktree}
						>
							<CornerUpLeft />
						</IconButton>
					</span>
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
