import { StatusDot } from '@components/layout/StatusDot';
import { Button, IconButton } from '@factorai/ui';
import type { SessionSummary } from '@factorai/types';
import { useStartSession } from '@hooks/useStartSession';
import { formatRelative } from '@lib/format';
import { queryKeys } from '@lib/queryKeys';
import { type SessionGroup, groupSessions, pendingSessions } from '@lib/sessionGroups';
import { cmd } from '@lib/tauri';
import { useTerminalStore } from '@store/terminalStore';
import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { Bot, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { rootRoute } from './__root';

/**
 * Width of the disclosure gutter at the left of every row.
 *
 * Reserved on rows that have nothing to disclose too, so the titles line up in
 * one column whether or not a session spawned agents — a gutter that appears
 * only sometimes moves every title beside it.
 */
const GUTTER = 'w-7 shrink-0';

/** The marker on a sub-agent row: an agent run by a session, readable but
 *  not resumable. Small and quiet — it disambiguates, it doesn't shout.
 *
 *  Right-aligned beside `read-only` rather than inline after the title, which
 *  is where it used to sit: a title truncates, so the badge landed at a
 *  different x on every row and the column read as ragged. */
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

/** How many agents a collapsed session is hiding. This is the only thing that
 *  says they exist while the group is shut, so it carries the count rather
 *  than being a decoration on the toggle. */
function AgentCountBadge({ count }: { count: number }) {
	return (
		<span
			data-testid="agent-count"
			title={`${count} sub-agent${count === 1 ? '' : 's'} ran inside this session`}
			className="inline-flex shrink-0 items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-muted-foreground text-xs"
		>
			<Bot className="size-3" aria-hidden />
			{count}
		</span>
	);
}

/** Turn count and recency — the same second line on every row in this list. */
function RowMeta({ session }: { session: SessionSummary }) {
	return (
		<div className="text-muted-foreground text-xs">
			{session.turnCount} turn{session.turnCount === 1 ? '' : 's'} ·{' '}
			{formatRelative(session.updatedAt)}
		</div>
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

	// Which groups are open, by parent id. Local and unpersisted, the same
	// stance F12 takes for the file tree: an expanded set is cheap to rebuild
	// and stale entries would point at sessions that may be gone.
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
	function toggle(sessionId: string) {
		setExpanded((current) => {
			const next = new Set(current);
			if (!next.delete(sessionId)) next.add(sessionId);
			return next;
		});
	}

	const project = projectsQ.data?.find((p) => p.id === id);
	// Same rule as the sidebar's +: a folder that is no longer on disk would send
	// claude to $HOME, filing the session under another project.
	const canStart = project ? !project.missing : false;

	const groups = useMemo(() => groupSessions(sessionsQ.data ?? []), [sessionsQ.data]);

	// Live sessions this project has that the index hasn't seen — without these
	// rows the session you just started vanishes from the list the moment you
	// navigate away, even though its PTY is very much alive. Shared with the
	// sidebar's list, which shows the same rows for the same reason.
	const pending = useMemo(
		() => pendingSessions(bySession, id, sessionsQ.data),
		[bySession, sessionsQ.data, id],
	);

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
					<h2 className="font-semibold text-lg">{project?.displayName ?? id}</h2>
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
						<Plus /> New session
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

				{(pending.length > 0 || groups.length > 0) && (
					<ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
						{pending.map((p) => (
							<li key={p.sessionId}>
								<Link
									to="/projects/$projectId/sessions/$sessionId"
									params={{ projectId: id, sessionId: p.sessionId }}
									className="flex items-center gap-3 py-3 pr-4 pl-4 transition-colors hover:bg-secondary"
								>
									<span className={GUTTER} aria-hidden />
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
						{groups.map((group) => (
							<SessionRow
								key={group.session.id}
								group={group}
								projectId={id}
								expanded={expanded.has(group.session.id)}
								onToggle={() => toggle(group.session.id)}
							/>
						))}
					</ul>
				)}
			</div>
		</main>
	);
}

interface SessionRowProps {
	group: SessionGroup;
	projectId: string;
	expanded: boolean;
	onToggle: () => void;
}

/**
 * One session and, folded under it, the agents it spawned.
 *
 * **Collapsed by default.** A session that spawned six agents used to put seven
 * rows in this list, so a project's real sessions were buried under runs you
 * open once, if ever. The count badge is what says they are there.
 *
 * The toggle is a **sibling** of the `Link`, not a child: a button inside an
 * anchor is invalid, and the two would fight over the click. The row is a flex
 * container so the hover background still covers both.
 */
function SessionRow({ group, projectId, expanded, onToggle }: SessionRowProps) {
	const { session, agents } = group;
	const bySession = useTerminalStore((s) => s.bySession);
	const live = bySession[session.id];
	const hasAgents = agents.length > 0;
	const label = session.title || session.id.slice(0, 8);

	return (
		<li>
			<div className="group flex items-center pl-4 transition-colors hover:bg-secondary">
				{hasAgents ? (
					<IconButton
						className={GUTTER}
						aria-expanded={expanded}
						aria-label={expanded ? `Hide sub-agents of ${label}` : `Show sub-agents of ${label}`}
						title={expanded ? 'Hide sub-agents' : 'Show sub-agents'}
						onClick={onToggle}
					>
						<ChevronRight className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
					</IconButton>
				) : (
					<span className={GUTTER} aria-hidden />
				)}
				<Link
					to="/projects/$projectId/sessions/$sessionId"
					params={{ projectId, sessionId: session.id }}
					className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-4"
				>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							{live && <StatusDot status={live.status} />}
							<span className="truncate font-medium">{label}</span>
						</div>
						<RowMeta session={session} />
					</div>
					{/* Right-aligned and fixed-width-by-content, so the badges and
					    affordances of every row in the list share one column. */}
					{session.subagentOf && <SubAgentBadge />}
					{hasAgents && <AgentCountBadge count={agents.length} />}
					{session.subagentOf ? (
						// Read-only affordance: no chevron, which everywhere else in this
						// list means "a terminal opens".
						<span className="shrink-0 text-muted-foreground/60 text-xs">read-only</span>
					) : (
						<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
					)}
				</Link>
			</div>

			{expanded && (
				<ul data-testid={`subagents-of-${session.id}`}>
					{agents.map((agent) => (
						<li key={agent.id}>
							<Link
								to="/projects/$projectId/sessions/$sessionId"
								params={{ projectId, sessionId: agent.id }}
								// Indented past where the parent's title starts (the gutter
								// plus the row's own padding, 44px), not level with it:
								// nesting you cannot see is not nesting.
								className="flex items-center gap-3 border-border/50 border-t py-2.5 pr-4 pl-16 transition-colors hover:bg-secondary"
							>
								<div className="min-w-0 flex-1">
									<span className="block truncate text-sm">
										{agent.title || agent.id.slice(0, 8)}
									</span>
									<RowMeta session={agent} />
								</div>
								<SubAgentBadge />
								<span className="shrink-0 text-muted-foreground/60 text-xs">read-only</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</li>
	);
}

export const projectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/projects/$id',
	component: ProjectView,
});
