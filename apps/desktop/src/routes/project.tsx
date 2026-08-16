import { StatusDot } from '@components/layout/StatusDot';
import { Button } from '@factorai/ui';
import { useStartSession } from '@hooks/useStartSession';
import { formatRelative } from '@lib/format';
import { queryKeys } from '@lib/queryKeys';
import { cmd } from '@lib/tauri';
import { useTerminalStore } from '@store/terminalStore';
import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { Bot, ChevronRight, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { rootRoute } from './__root';

/** The marker on a sub-agent row: an agent run by a session, readable but
 *  not resumable. Small and quiet — it disambiguates, it doesn't shout. */
function SubAgentBadge() {
	return (
		<span
			data-testid="subagent-badge"
			title="Run by an agent inside the session above — readable, not resumable"
			className="inline-flex shrink-0 items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-muted-foreground text-xs"
		>
			<Bot className="size-3" aria-hidden />
			sub-agent
		</span>
	);
}

function ProjectView() {
	const { id } = projectRoute.useParams();
	const sessionsQ = useQuery({
		queryKey: queryKeys.sessions(id),
		queryFn: () => cmd.listSessions(id),
	});
	const projectsQ = useQuery({
		queryKey: queryKeys.projects(),
		queryFn: () => cmd.listProjects(),
	});
	const bySession = useTerminalStore((s) => s.bySession);
	const startSession = useStartSession();

	const project = projectsQ.data?.find((p) => p.id === id);
	// Same rule as the sidebar's +: a folder that is no longer on disk would send
	// claude to $HOME, filing the session under another project.
	const canStart = project ? !project.missing : false;

	// Live sessions this project has that the index hasn't seen. A session gets
	// no `sessions` row until claude writes its transcript and the watcher
	// reindexes, which for a brand-new one is only after the first message —
	// without these rows the session you just started vanishes from the list the
	// moment you navigate away, even though its PTY is very much alive.
	const pending = useMemo(() => {
		// Wait for the real list: treating "not loaded yet" as "not indexed" would
		// flash every live session as a new one.
		if (!sessionsQ.data) return [];
		const indexed = new Set(sessionsQ.data.map((s) => s.id));
		return Object.entries(bySession)
			.filter(([sessionId, t]) => t.projectId === id && !indexed.has(sessionId))
			.map(([sessionId, t]) => ({ sessionId, status: t.status }));
	}, [bySession, sessionsQ.data, id]);

	const isEmpty = sessionsQ.data?.length === 0 && pending.length === 0;

	return (
		// The header stays put and the list scrolls under it. `min-h-0` on the
		// scroller is what makes that work: without it the flex child takes its
		// content's height, grows past the pane, and AppShell's overflow-hidden
		// content region just clips the overflow — with 70 sessions the rows below
		// the fold were unreachable, with no scrollbar anywhere. Same shape as
		// routes/search.tsx.
		<main className="flex h-full flex-col">
			<header className="flex shrink-0 items-start gap-4 px-6 pt-6 pb-4">
				<div className="min-w-0 flex-1">
					<h2 className="text-lg font-semibold">{project?.displayName ?? id}</h2>
					{project?.realPath && (
						<p
							className={`font-mono text-xs ${
								project.missing ? 'text-destructive' : 'text-muted-foreground'
							}`}
						>
							{project.realPath}
							{project.missing && ' — folder not found'}
						</p>
					)}
				</div>
				{/* See Sidebar for why the title sits on a wrapper rather than the
				    Button itself. */}
				<span
					title={canStart ? undefined : 'No project folder on disk — cannot start a session here'}
				>
					<Button
						size="sm"
						className="gap-1.5"
						disabled={!canStart}
						onClick={() => void startSession(id)}
					>
						<Plus className="size-3.5" /> New session
					</Button>
				</span>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
				{sessionsQ.isLoading && <p className="text-muted-foreground text-sm">Loading sessions…</p>}
				{isEmpty && (
					<p className="text-muted-foreground text-sm">
						No sessions in this project yet — start one with <b>New session</b>.
					</p>
				)}

				{(pending.length > 0 || (sessionsQ.data?.length ?? 0) > 0) && (
					<ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
						{pending.map((p) => (
							<li key={p.sessionId}>
								<Link
									to="/projects/$projectId/sessions/$sessionId"
									params={{ projectId: id, sessionId: p.sessionId }}
									className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary"
								>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<StatusDot status={p.status} />
											<span className="truncate font-medium">New session</span>
										</div>
										<div className="text-muted-foreground text-xs">
											Nothing recorded yet — it appears with a title once you send a message.
										</div>
									</div>
									<ChevronRight className="size-4 text-muted-foreground" />
								</Link>
							</li>
						))}
						{sessionsQ.data?.map((s) => (
							<li key={s.id}>
								<Link
									to="/projects/$projectId/sessions/$sessionId"
									params={{ projectId: id, sessionId: s.id }}
									// A sub-agent row indents under its parent and swaps the
									// chevron for the badge that says what it is — it opens
									// a transcript, not a terminal.
									className={`flex items-center gap-3 py-3 pr-4 transition-colors hover:bg-secondary ${
										s.subagentOf ? 'pl-10' : 'pl-4'
									}`}
								>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											{bySession[s.id] && <StatusDot status={bySession[s.id].status} />}
											<span className="truncate font-medium">{s.title || s.id.slice(0, 8)}</span>
											{s.subagentOf && <SubAgentBadge />}
										</div>
										<div className="text-muted-foreground text-xs">
											{s.turnCount} turn{s.turnCount === 1 ? '' : 's'} ·{' '}
											{formatRelative(s.updatedAt)}
										</div>
									</div>
									{s.subagentOf ? (
										// Read-only affordance: no chevron, which everywhere
										// else in this list means "a terminal opens".
										<span className="text-muted-foreground/60 text-xs">read-only</span>
									) : (
										<ChevronRight className="size-4 text-muted-foreground" />
									)}
								</Link>
							</li>
						))}
					</ul>
				)}
			</div>
		</main>
	);
}

export const projectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/projects/$id',
	component: ProjectView,
});
