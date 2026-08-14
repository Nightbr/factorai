import type { SessionSummary, TerminalId } from '@factorai/types';
import { Button } from '@factorai/ui';
import { useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Play, Square } from 'lucide-react';
import { useState } from 'react';
import { StatusDot } from '@components/layout/StatusDot';
import { disposeTerminal, Terminal } from '@components/terminal/Terminal';
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

	// Shares the project route's cache entry, so arriving from the session list
	// costs nothing. Refetched on `sessions:changed`-driven invalidation, which
	// is what swaps "New session" for the derived title.
	const sessionsQ = useQuery({
		queryKey: queryKeys.sessions(projectId),
		queryFn: () => cmd.listSessions(projectId),
	});

	const live = useTerminalStore((s) => s.bySession[sessionId]);
	// Remounting the Terminal (new key) tears down the dead xterm and triggers
	// a fresh spawn — used to restart a stopped session.
	const [restartNonce, setRestartNonce] = useState(0);
	const navigate = useNavigate();

	/**
	 * Stopping a session ends your business with it, so leave rather than
	 * parking on a dead pane reading `[process exited]`.
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
	async function stopSession(terminalId: TerminalId) {
		try {
			await cmd.terminalKill(terminalId);
		} catch (e) {
			// Leaving anyway. A kill that failed means the PTY may still be
			// running, and the project page will say so through its status dot —
			// better than sitting on a page whose button appeared to do nothing.
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
				<StatusDot status={live?.status ?? 'stopped'} />
				<span className="truncate text-foreground text-sm">
					{project?.displayName ?? projectId}
				</span>
				{/* The full id is one hover away rather than spending header width on
				    36 characters nobody reads. */}
				<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs" title={sessionId}>
					{sessionLabel(sessionId, sessionsQ.data)}
				</span>
				{live ? (
					<Button
						size="sm"
						variant="outline"
						className="h-7 gap-1.5"
						onClick={() => void stopSession(live.terminalId)}
					>
						<Square className="size-3" /> Stop
					</Button>
				) : (
					<Button
						size="sm"
						variant="outline"
						className="h-7 gap-1.5"
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
			<div className="min-h-0 flex-1">
				<Terminal
					key={restartNonce}
					sessionId={sessionId}
					projectId={projectId}
					projectCwd={projectCwd}
				/>
			</div>
		</main>
	);
}

export const sessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/projects/$projectId/sessions/$sessionId',
	component: SessionView,
});
