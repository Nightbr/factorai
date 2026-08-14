import type { SessionSummary } from '@factorai/types';
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@factorai/ui';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ProjectIcon } from '@components/layout/ProjectIcon';
import { disposeTerminal } from '@components/terminal/Terminal';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { type LiveTerminal, useTerminalStore } from '@store/terminalStore';

/**
 * Tabs for the live sessions, in the top bar (specs/05-features.md F16).
 *
 * **A tab is a running PTY**, not an "open document": the strip is driven
 * straight off `terminalStore`, so it appears when a session spawns and goes
 * when the process exits, however it exited. That keeps the header an honest
 * picture of what is running rather than a second thing to keep in sync.
 *
 * Renders nothing when nothing is live, so the header looks exactly as it did
 * before the first session starts.
 */
export function SessionTabs() {
	const bySession = useTerminalStore((s) => s.bySession);
	const order = useTerminalStore((s) => s.order);
	const reorder = useTerminalStore((s) => s.reorder);
	const detach = useTerminalStore((s) => s.detach);
	const { sessionId: activeId } = useParams({ strict: false }) as { sessionId?: string };
	const navigate = useNavigate();

	const [closing, setClosing] = useState<string | null>(null);
	const [dragging, setDragging] = useState<string | null>(null);
	const stripRef = useRef<HTMLDivElement>(null);

	// `order` is the source of truth for sequence, `bySession` for existence —
	// filter by the latter so a tab can never outlive its PTY.
	const tabs = useMemo(
		() => order.filter((id) => bySession[id]).map((id) => ({ id, live: bySession[id] })),
		[order, bySession],
	);

	const titles = useSessionTitles(tabs.map((t) => t.live));
	// Every tab is a live PTY by definition, so a status dot on each would be a
	// row of green telling you nothing. The project avatar answers the question
	// you actually have with several sessions open: which project is this one?
	const projectsQ = useQuery({ queryKey: queryKeys.projects(), queryFn: () => cmd.listProjects() });
	const projectById = useMemo(
		() => new Map((projectsQ.data ?? []).map((p) => [p.id, p])),
		[projectsQ.data],
	);

	// Switching sessions from the sidebar (or a keyboard, later) must not leave
	// you looking at the wrong end of a scrolled strip.
	useEffect(() => {
		if (!activeId) return;
		stripRef.current
			?.querySelector(`[data-session-id="${CSS.escape(activeId)}"]`)
			?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}, [activeId]);

	if (tabs.length === 0) return null;

	function closeSession(sessionId: string) {
		const live = bySession[sessionId];
		setClosing(null);
		if (!live) return;
		void (async () => {
			try {
				await cmd.terminalKill(live.terminalId);
				// Drop it now rather than waiting for `terminal:exit`. We know what we
				// just did, and a tab that lingers until an event arrives is a tab
				// that lingers forever if the event is ever missed. The later event
				// finds nothing to remove, which is fine.
				detach(sessionId);
			} catch (e) {
				// The kill failed, so the PTY may well still be running: keep the tab,
				// where its status dot keeps telling the truth.
				console.error('terminal_kill failed', e);
				return;
			}
			disposeTerminal(sessionId);
			// Only navigate if you were looking at the session you just closed.
			if (activeId === sessionId) {
				void navigate({ to: '/projects/$id', params: { id: live.projectId } });
			}
		})();
	}

	const closingLive = closing ? bySession[closing] : undefined;

	return (
		<>
			<div
				ref={stripRef}
				role="tablist"
				aria-label="Open sessions"
				data-testid="session-tabs"
				// `overflow-x-auto` with the bar hidden: at 40px tall a scrollbar would
				// eat a third of the strip. The wheel handler below is what makes it
				// reachable without one.
				className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1"
				onWheel={(e) => {
					// A vertical wheel over a horizontal strip does nothing by default,
					// which reads as "these tabs are stuck".
					if (e.deltaY !== 0 && stripRef.current) {
						stripRef.current.scrollLeft += e.deltaY;
					}
				}}
			>
				{tabs.map(({ id, live }, index) => {
					const isActive = id === activeId;
					return (
						<div
							key={id}
							role="tab"
							aria-selected={isActive}
							data-session-id={id}
							draggable
							onDragStart={(e) => {
								// Setting data is what actually starts a native drag — without
								// it the browser treats the gesture as a text selection and no
								// drop target ever fires. This is why reordering did nothing.
								e.dataTransfer.setData('text/plain', id);
								e.dataTransfer.effectAllowed = 'move';
								setDragging(id);
							}}
							onDragEnd={() => setDragging(null)}
							onDragOver={(e) => {
								// Without preventDefault the element is "not a drop target" and
								// the drop is refused.
								e.preventDefault();
								e.dataTransfer.dropEffect = 'move';
							}}
							onDrop={(e) => {
								e.preventDefault();
								const dragged = dragging ?? e.dataTransfer.getData('text/plain');
								if (dragged && dragged !== id) reorder(dragged, index);
								setDragging(null);
							}}
							className={`group flex h-7 max-w-44 shrink-0 cursor-pointer items-center gap-1.5 rounded px-2 text-xs transition-colors ${
								isActive
									? 'bg-secondary text-foreground'
									: 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
							} ${dragging === id ? 'opacity-40' : ''}`}
							onClick={() =>
								void navigate({
									to: '/projects/$projectId/sessions/$sessionId',
									params: { projectId: live.projectId, sessionId: id },
								})
							}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									void navigate({
										to: '/projects/$projectId/sessions/$sessionId',
										params: { projectId: live.projectId, sessionId: id },
									});
								}
							}}
							tabIndex={0}
							title={`${projectById.get(live.projectId)?.displayName ?? live.projectId} — ${
								titles.get(id) ?? id
							}`}
						>
							<ProjectIcon
								name={projectById.get(live.projectId)?.displayName ?? live.projectId}
								path={projectById.get(live.projectId)?.realPath ?? live.projectId}
								size={14}
							/>
							<span className="min-w-0 flex-1 truncate">{titles.get(id) ?? shortId(id)}</span>
							{/* Only where the pointer already is, or on the active tab: a row
							    of permanent × buttons is a row of accidents waiting. */}
							<button
								type="button"
								aria-label={`Close ${titles.get(id) ?? shortId(id)}`}
								className={`-mr-1 rounded p-0.5 text-muted-foreground/70 transition-all hover:text-primary focus-visible:opacity-100 ${
									isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
								}`}
								onClick={(e) => {
									e.stopPropagation();
									setClosing(id);
								}}
							>
								<X className="size-3" />
							</button>
						</div>
					);
				})}
			</div>

			<Dialog open={closing !== null} onOpenChange={(open) => !open && setClosing(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<AlertTriangle className="size-5 text-destructive" />
							Close this session?
						</DialogTitle>
						<DialogDescription>
							{closing ? (titles.get(closing) ?? shortId(closing)) : ''} is running. Closing the
							tab terminates its Claude session — the transcript is kept, but any work in
							progress is lost. This cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setClosing(null)}>
							Keep it running
						</Button>
						<Button
							variant="destructive"
							disabled={!closingLive}
							onClick={() => closing && closeSession(closing)}
						>
							Close &amp; kill session
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

function shortId(sessionId: string): string {
	return sessionId.slice(0, 8);
}

/**
 * Titles for the live sessions, looked up per project.
 *
 * One query per distinct project rather than per session — they share the cache
 * entry the sidebar and project page already fill, so an open project costs
 * nothing extra. A session too new to be indexed has no title yet and falls
 * back to its short id, matching the session header.
 */
function useSessionTitles(live: LiveTerminal[]): Map<string, string> {
	const projectIds = useMemo(() => [...new Set(live.map((t) => t.projectId))].sort(), [live]);

	// `combine` rather than a useMemo over the results array: useQueries hands
	// back a fresh array on every render, so a memo would either lie about its
	// dependencies or recompute constantly. This is the option built for it.
	return useQueries({
		queries: projectIds.map((projectId) => ({
			queryKey: queryKeys.sessions(projectId),
			queryFn: () => cmd.listSessions(projectId),
		})),
		combine: (results) => {
			const map = new Map<string, string>();
			for (const result of results) {
				for (const session of (result.data ?? []) as SessionSummary[]) {
					const title = session.title.trim();
					if (title) map.set(session.id, title);
				}
			}
			return map;
		},
	});
}
