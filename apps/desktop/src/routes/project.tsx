import { EmptyHero } from '@components/layout/EmptyHero';
import { StatusDot } from '@components/layout/StatusDot';
import { RoutineOrigin } from '@components/routines/RoutineOrigin';
import { RoutinesView } from '@components/routines/RoutinesView';
import { Button, IconButton } from '@factorai/ui';
import type { SessionSummary } from '@factorai/types';
import { useSessionMarks } from '@hooks/useSessionMarks';
import { useStartSession } from '@hooks/useStartSession';
import { formatStamp, routineSessionLabel } from '@lib/cron';
import { formatRelative } from '@lib/format';
import { queryKeys } from '@lib/queryKeys';
import { type SessionGroup, groupSessions, pendingSessions } from '@lib/sessionGroups';
import { cmd } from '@lib/tauri';
import { usePrefsStore } from '@store/prefsStore';
import { useTerminalStore } from '@store/terminalStore';
import { useQuery } from '@tanstack/react-query';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Bot, ChevronRight, MessagesSquare, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { rootRoute } from './__root';

/**
 * The one leading column on every row: 16px, centring whichever mark the row
 * has — the disclosure chevron when a session spawned sub-agents, the status
 * dot otherwise.
 *
 * **Reserved even when there is no mark**, which is the whole point: the titles
 * line up in one column, and a gutter that appears only sometimes moves every
 * title beside it.
 *
 * **32px: the 8px dot with 12px of air on each side.** The width was narrowed
 * four times in one afternoon of user feedback — 72px in front of every title,
 * then 40, 32, 20, 16 — and then widened twice, to 24 and to 32, because the
 * narrow ones read as cramped between the card's border and the title however
 * the arithmetic came out. The number that mattered was never the total: it was
 * how much air the mark has on each side, which is why this column centres its
 * contents and nothing else on the row adds space beside it. The step that made
 * it one column merged the dot's own slot into this one — two reserved columns cost the list the width of both, and no row
 * draws both marks: a session with sub-agents shows its chevron here, and if it
 * is also running its dot rides with the badges on the right.
 */
const GUTTER = 'flex w-8 shrink-0 justify-center';

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

/** Turn count and recency — the same second line on every row in this list.
 *
 *  A routine's session also says **when it ran**, and keeps saying it once
 *  Claude has given the session a title of its own: that moment is the only
 *  thing telling two runs of a daily routine apart, and it must not disappear
 *  the first time the agent answers (2026-08-29, user report). */
function RowMeta({ session }: { session: SessionSummary }) {
	const clock24 = usePrefsStore((s) => s.clock24);
	return (
		<div className="text-muted-foreground text-xs">
			{session.turnCount} turn{session.turnCount === 1 ? '' : 's'} ·{' '}
			{formatRelative(session.updatedAt)}
			{session.routineStartedAt !== null && (
				<> · ran {formatStamp(new Date(session.routineStartedAt), clock24)}</>
			)}
		</div>
	);
}

/** The two lists a project has (F22). In the URL rather than component state so
 *  the context menu's `New routine` — and later the MCP tool — can land you on
 *  the right one. */
type ProjectTab = 'sessions' | 'routines';

function ProjectView() {
	const { id } = projectRoute.useParams();
	const { tab, new: startCreating } = projectRoute.useSearch();
	const navigate = useNavigate();
	const sessionsQ = useQuery({
		queryKey: queryKeys.sessions(id),
		queryFn: () => cmd.listSessions(id),
	});
	const projectsQ = useQuery({
		queryKey: queryKeys.projects(),
		queryFn: () => cmd.listProjects(),
	});
	const bySession = useTerminalStore((s) => s.bySession);
	// A routine's session is live before the indexer has ever seen it, and the
	// only thing that knows it is a routine's is the store (F22).
	const routineOrigins = useTerminalStore((s) => s.routineBySession);
	const marks = useSessionMarks();
	const clock24 = usePrefsStore((s) => s.clock24);
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
				{/* **One button, in one place, whichever list you are on.** The action
				    a project page offers is "make another one of these", so it
				    follows the tab rather than moving to the list below it.
				    See Sidebar for why the title sits on a wrapper rather than the
				    Button itself. */}
				{tab === 'routines' ? (
					<Button
						size="sm"
						className="gap-1.5"
						data-testid="new-routine"
						onClick={() =>
							void navigate({
								to: '/projects/$id',
								params: { id },
								search: { tab: 'routines', new: true },
								replace: true,
							})
						}
					>
						<Plus /> New routine
					</Button>
				) : (
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
				)}
			</header>

			{/* Two tabs, hardcoded for the same reason the panel's three are (Q18):
			    this is a project's two lists, not a registry. */}
			<div
				className="flex shrink-0 items-center gap-1.5 px-6 pb-3"
				role="tablist"
				aria-label="Project"
			>
				<ProjectTabButton tab="sessions" label="Sessions" current={tab} projectId={id} />
				<ProjectTabButton tab="routines" label="Routines" current={tab} projectId={id} />
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
				{tab === 'routines' && (
					<RoutinesView
						projectId={id}
						canRun={canStart}
						startCreating={startCreating === true}
						onCreatingOpened={() =>
							void navigate({
								to: '/projects/$id',
								params: { id },
								search: { tab: 'routines' },
								replace: true,
							})
						}
					/>
				)}
				{tab !== 'routines' && sessionsQ.isLoading && (
					<p className="text-muted-foreground text-sm">Loading sessions…</p>
				)}
				{tab !== 'routines' && isEmpty && (
					<EmptyHero
						icon={<MessagesSquare />}
						title="No sessions yet"
						description={
							<>
								Start one with <b>New session</b>, and it appears here the moment Claude writes its
								first message.
							</>
						}
					/>
				)}

				{tab !== 'routines' && (pending.length > 0 || groups.length > 0) && (
					<ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
						{pending.map((p) => (
							<li key={p.sessionId}>
								{/* The gutter sits *outside* the link, exactly as it does on an
								    indexed row. Inside it, the link's `gap-3` landed on the dot's
								    right and nothing on its left, so the mark was off-centre in
								    its own column and the two row kinds did not agree. */}
								<div className="flex items-center transition-colors hover:bg-secondary">
									<span className={GUTTER} aria-hidden>
										{/* A pending session has no index row yet; a routine's has no
										    tab either, which is what the blue says. */}
										<StatusDot
											status={p.status}
											background={marks[p.sessionId]?.background ?? true}
										/>
									</span>
									<Link
										to="/projects/$projectId/sessions/$sessionId"
										params={{ projectId: id, sessionId: p.sessionId }}
										className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-4"
									>
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2">
												<span className="truncate font-medium">
													{routineOrigins[p.sessionId]
														? routineSessionLabel(routineOrigins[p.sessionId], clock24)
														: 'New session'}
												</span>
											</div>
											<div className="text-muted-foreground text-xs">
												Nothing recorded yet — it appears with a title once you send a message.
											</div>
										</div>
										{routineOrigins[p.sessionId] && (
											<RoutineOrigin
												name={routineOrigins[p.sessionId].routineName}
												startedAt={routineOrigins[p.sessionId].startedAt}
												clock24={clock24}
											/>
										)}
										<ChevronRight className="size-4 text-muted-foreground" />
									</Link>
								</div>
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
	// The marks, not the open record: a routine's session runs with no tab and
	// would otherwise have no dot at all here — an agent working invisibly, which
	// is the one thing the operating model rules out (F22). The sidebar's list is
	// read the same way, so the two panes cannot disagree about a dot.
	const open = useSessionMarks();
	const clock24 = usePrefsStore((s) => s.clock24);
	const live = open[session.id];
	const hasAgents = agents.length > 0;
	const label = session.title || session.id.slice(0, 8);

	return (
		<li>
			<div className="group flex items-center transition-colors hover:bg-secondary">
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
					<span className={GUTTER} aria-hidden>
						{live && <StatusDot status={live.status} background={live.background} />}
					</span>
				)}
				<Link
					to="/projects/$projectId/sessions/$sessionId"
					params={{ projectId, sessionId: session.id }}
					title={
						session.routineStartedAt !== null
							? `${label} · ran ${formatStamp(new Date(session.routineStartedAt), clock24)}`
							: undefined
					}
					className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-4"
				>
					{/* **The dot has a column of its own, always reserved.** Inline
					    before the title it moved every name beside it by 16px, so a
					    list read as ragged and the eye could not run down the names.
					    Same reasoning as `GUTTER` above, one level in. */}
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<span className="truncate font-medium">{label}</span>
						</div>
						<RowMeta session={session} />
					</div>
					{/* The origin icon rides with the badges rather than before the
					    title, for the same alignment reason the dot moved out of it.
					    So does the dot itself on the one row that cannot show it on
					    the left: a session with sub-agents, whose gutter holds the
					    disclosure chevron. */}
					{hasAgents && live && <StatusDot status={live.status} background={live.background} />}
					{session.routineId && (
						<RoutineOrigin
							name={session.routineName}
							startedAt={session.routineStartedAt}
							clock24={clock24}
						/>
					)}
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
								className="flex items-center gap-3 border-border/50 border-t py-2.5 pr-4 pl-8 transition-colors hover:bg-secondary"
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

/** The tab strip's button. Same shape as the file panel's, deliberately: two
 *  tab strips that look different are two mechanisms to learn. */
function ProjectTabButton({
	tab,
	label,
	current,
	projectId,
}: {
	tab: ProjectTab;
	label: string;
	current: ProjectTab | undefined;
	projectId: string;
}) {
	const active = (current ?? 'sessions') === tab;
	return (
		// A chip, not a text tab: two words with nothing around them read as a
		// heading rather than a control, and this row sits directly under one.
		// `rounded-md` is the card's radius — the same corner as the box the list
		// is in, so the two do not disagree at 6px vs 4px.
		<Link
			to="/projects/$id"
			params={{ id: projectId }}
			search={{ tab }}
			role="tab"
			aria-selected={active}
			data-testid={`project-tab-${tab}`}
			className={`rounded-md border px-2 py-0.5 font-medium text-xs transition-colors ${
				active
					? 'border-border bg-secondary text-foreground'
					: 'border-border/50 text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
			}`}
		>
			{label}
		</Link>
	);
}

export const projectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/projects/$id',
	// `?tab=routines` selects the Routines list. Anything else — including a
	// hand-edited URL — is the sessions list, which is the one a project is
	// mostly about.
	// **Optional**, so the sidebar's and the tab strip's plain `to="/projects/$id"`
	// links stay plain: absent means the sessions list, which is what a project
	// is mostly about. Anything unrecognised — including a hand-edited URL —
	// falls back to the same place rather than rendering nothing.
	// `new` is the context menu's `New routine`: it lands on the tab *and* opens
	// the editor, because the menu item promised a routine rather than a list.
	// The route clears it as soon as the editor is open, so a reload or a
	// browser-back does not reopen an editor you cancelled.
	validateSearch: (search: Record<string, unknown>): { tab?: ProjectTab; new?: true } => ({
		tab: search.tab === 'routines' ? 'routines' : undefined,
		new: search.new === true || search.new === 'true' ? true : undefined,
	}),
	component: ProjectView,
});
