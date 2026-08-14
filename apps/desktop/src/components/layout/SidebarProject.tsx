import type { Project, SessionSummary } from '@factorai/types';
import { Button } from '@factorai/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { ProjectIcon } from '@components/layout/ProjectIcon';
import { StatusDot } from '@components/layout/StatusDot';
import { useStartSession } from '@hooks/useStartSession';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { useSidebarStore } from '@store/sidebarStore';
import { type LiveTerminal, useTerminalStore } from '@store/terminalStore';

/** How many sessions an expanded project shows. Enough to cover "the one I was
 *  just in", short enough that expanding two projects doesn't bury the list. */
export const SIDEBAR_SESSION_LIMIT = 10;

/**
 * Newest-first, but anything with a live PTY first of all.
 *
 * Pure and exported so the ordering — the part with actual rules — is testable
 * without rendering a sidebar.
 */
export function orderSessions(
	sessions: SessionSummary[],
	bySession: Record<string, LiveTerminal>,
	limit = SIDEBAR_SESSION_LIMIT,
): SessionSummary[] {
	return [...sessions]
		.sort((a, b) => {
			const aLive = a.id in bySession ? 1 : 0;
			const bLive = b.id in bySession ? 1 : 0;
			if (aLive !== bLive) return bLive - aLive;
			return b.updatedAt - a.updatedAt;
		})
		.slice(0, limit);
}

interface SidebarProjectProps {
	project: Project;
	isActive: boolean;
	isLive: boolean;
}

export function SidebarProject({ project, isActive, isLive }: SidebarProjectProps) {
	const expanded = useSidebarStore((s) => s.expanded.includes(project.id));
	const toggleProject = useSidebarStore((s) => s.toggleProject);
	const startSession = useStartSession();

	// No resolved cwd means we never found a `cwd` in this project's sessions, so
	// there is nowhere to start one: claude would boot in $HOME and file the new
	// session under a *different* project than the row that was clicked.
	const canStart = project.realPath !== null;

	return (
		<li>
			{/* The row is a flex container, so the hover background covers the
			    chevron, the link and the + alike. Each is a SIBLING of the Link —
			    nesting a button inside an anchor is invalid, and the two would
			    fight over the click. */}
			<div
				className={`group flex items-center pr-1 transition-colors ${
					isActive ? 'bg-secondary' : 'hover:bg-secondary/50'
				}`}
			>
				<button
					type="button"
					aria-label={expanded ? `Collapse ${project.displayName}` : `Expand ${project.displayName}`}
					aria-expanded={expanded}
					className="flex shrink-0 items-center py-2 pr-2 pl-1.5"
					onClick={() => toggleProject(project.id)}
				>
					<ChevronRight
						className={`size-3.5 text-muted-foreground transition-transform ${
							expanded ? 'rotate-90' : ''
						}`}
					/>
				</button>

				<Link
					to="/projects/$id"
					params={{ id: project.id }}
					className={`flex min-w-0 flex-1 items-center gap-2 py-2 text-sm ${
						isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
					}`}
				>
					<ProjectIcon name={project.displayName} path={project.realPath ?? project.id} size={16} />
					<span className="min-w-0 flex-1 truncate">{project.displayName}</span>
					{isLive && <StatusDot status="running" />}
				</Link>

				{/* The title lives on the wrapper: Button sets
				    disabled:pointer-events-none, which suppresses a native tooltip on
				    the element itself — exactly when the explanation matters most. */}
				<span
					// `flex` matters: as a plain inline span this wrapper placed the
					// button on its own line box, floating the + above the session count.
					className="flex items-center"
					title={
						canStart
							? `New session in ${project.displayName}`
							: 'No project folder on disk — cannot start a session here'
					}
				>
					<Button
						variant="ghost"
						size="icon"
						// Deliberately smaller than the standard size-6 icon button: at the
						// end of a dense row its hover box otherwise runs into the count.
						// Hidden until hover to keep the list quiet, but always focusable.
						className="ml-1 size-4 shrink-0 rounded opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
						aria-label={`New session in ${project.displayName}`}
						disabled={!canStart}
						onClick={() => void startSession(project.id)}
					>
						<Plus className="size-3 text-muted-foreground" />
					</Button>
				</span>
			</div>

			{expanded && <SessionList project={project} />}
		</li>
	);
}

function SessionList({ project }: { project: Project }) {
	const bySession = useTerminalStore((s) => s.bySession);

	// Shares the project route's cache entry, so expanding a project you then
	// open costs one fetch, not two. Polled like the project list: a session's
	// title arrives only once claude has written its transcript.
	const sessionsQ = useQuery({
		queryKey: queryKeys.sessions(project.id),
		queryFn: () => cmd.listSessions(project.id),
		refetchInterval: 5000,
	});

	const sessions = useMemo(
		() => orderSessions(sessionsQ.data ?? [], bySession),
		[sessionsQ.data, bySession],
	);

	if (sessionsQ.isPending) return <Row muted>Loading…</Row>;
	if (sessions.length === 0) return <Row muted>No sessions yet</Row>;

	const hidden = (sessionsQ.data?.length ?? 0) - sessions.length;

	return (
		<ul className="mb-1" data-testid={`sidebar-sessions-${project.id}`}>
			{sessions.map((session) => (
				<li key={session.id}>
					<Link
						to="/projects/$projectId/sessions/$sessionId"
						params={{ projectId: project.id, sessionId: session.id }}
						title={session.title || session.id}
						className="flex items-center gap-2 py-1.5 pr-2 pl-8 text-muted-foreground text-xs transition-colors hover:bg-secondary/50 hover:text-foreground [&.active]:text-foreground"
						activeProps={{ className: 'bg-secondary text-foreground' }}
					>
						<span className="min-w-0 flex-1 truncate">
							{session.title.trim() || session.id.slice(0, 8)}
						</span>
						{bySession[session.id] && <StatusDot status={bySession[session.id].status} />}
					</Link>
				</li>
			))}
			{hidden > 0 && (
				// Not a scroll-forever list: the rest live on the project page.
				<li>
					<Link
						to="/projects/$id"
						params={{ id: project.id }}
						className="block py-1.5 pr-2 pl-8 text-muted-foreground/60 text-xs transition-colors hover:text-foreground"
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
		<p className={`py-1.5 pl-8 text-xs ${muted ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}>
			{children}
		</p>
	);
}
