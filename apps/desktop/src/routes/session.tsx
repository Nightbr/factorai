import type { SessionSummary, TerminalId } from '@factorai/types';
import { Button, IconButton } from '@factorai/ui';
import { useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { BookOpen, GitBranch, Play, X } from 'lucide-react';
import { useState } from 'react';
import { CloseSessionConfirm } from '@components/dialog/CloseSessionConfirm';
import { StatusDot } from '@components/layout/StatusDot';
import { SubAgentTranscript } from '@components/session/SubAgentTranscript';
import { disposeTerminal, Terminal } from '@components/terminal/Terminal';
import { useGitBranch } from '@hooks/useGitBranch';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
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

	const projectsQ = useQuery({
		queryKey: queryKeys.projects(),
		queryFn: () => cmd.listProjects(),
	});
	const project = projectsQ.data?.find((p) => p.id === projectId);
	const projectCwd = project?.realPath ?? null;

	// The header's branch badge. `projectCwd` rather than the active project, so
	// the badge always names this session's repository (F3).
	const branch = useGitBranch(projectCwd);

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

	const live = useTerminalStore((s) => s.bySession[sessionId]);
	const detach = useTerminalStore((s) => s.detach);
	// Remounting the Terminal (new key) tears down the dead xterm and triggers
	// a fresh spawn — used to restart a stopped session.
	const [restartNonce, setRestartNonce] = useState(0);
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
				{/* The full id is one hover away rather than spending header width on
				    36 characters nobody reads. */}
				<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs" title={sessionId}>
					{isSubAgent ? 'sub-agent' : sessionLabel(sessionId, sessionsQ.data)}
				</span>
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
						onClick={() => setClosing(true)}
					>
						<X />
					</IconButton>
				) : (
					<Button
						size="sm"
						variant="outline"
						className="gap-1.5"
						onClick={() => {
							// Drop the dead pooled terminal, then remount to spawn fresh.
							disposeTerminal(sessionId);
							setRestartNonce((n) => n + 1);
						}}
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
						key={restartNonce}
						sessionId={sessionId}
						projectId={projectId}
						projectCwd={projectCwd}
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
