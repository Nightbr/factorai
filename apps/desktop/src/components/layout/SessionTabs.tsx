import { CloseSessionConfirm, needsCloseConfirm } from '@components/dialog/CloseSessionConfirm';
import { ProjectIcon } from '@components/layout/ProjectIcon';
import { disposeTerminal, restartSession } from '@components/terminal/Terminal';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
// Aliased, and it has to be: this file also calls the *global* `CSS.escape`
// below, and dnd-kit's `CSS` helper would shadow it at module scope — a
// `CSS.escape is not a function` the moment you switch session.
import { CSS as DndCss } from '@dnd-kit/utilities';
import type { Project, SessionSummary, TerminalStatus } from '@factorai/types';
import { queryKeys } from '@lib/queryKeys';
import { tabsInKnownProjects } from '@lib/sessionGroups';
import { cmd } from '@lib/tauri';
import { useTerminalStore } from '@store/terminalStore';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * How far the pointer must travel before a press on a tab becomes a drag.
 *
 * Not decoration — it is what keeps a click a click. Without an activation
 * constraint the sensor claims the `pointerdown`, and dnd-kit stops propagating
 * the `click` that follows (core.esm.js § `AbstractPointerSensor`), so switching
 * session by clicking its tab would stop working. Above the threshold that same
 * suppression is what we want: a drag must not also navigate.
 */
const DRAG_START_PX = 4;

/**
 * Tabs for the open sessions, in the top bar (specs/05-features.md F16).
 *
 * **A tab is an open session. The dot says whether it is running. A tab goes
 * when you close it, and only then.** This used to say the opposite — "a tab is
 * a running PTY, not an open document" — with the strip driven straight off
 * `bySession`, so a tab went the moment its process exited. Now the strip is
 * driven off `tabs`, which is persisted, and `bySession` only colours it in.
 *
 * Renders nothing when nothing is open, so the header looks exactly as it did
 * before the first session — which is now "the first session ever" rather than
 * "the first one today".
 *
 * **Reordering is dnd-kit, and it is pointer-based — that is the whole point.**
 * This strip used native HTML5 drag-and-drop until 2026-08-18, when it turned
 * out not to work on macOS at all: Tauri's own drag-drop handler returns
 * "handled" for every drag session on the window, and wry only forwards
 * `draggingUpdated` / `performDragOperation` to WKWebView when it returns
 * "not handled" — so the page never saw `dragover` and the tab just dimmed. See
 * ADR-0016; the short version is that the OS drag session is not ours to use in
 * this shell, and dnd-kit does not use it.
 */
export function SessionTabs() {
	const bySession = useTerminalStore((s) => s.bySession);
	const openTabs = useTerminalStore((s) => s.tabs);
	const reorder = useTerminalStore((s) => s.reorder);
	const detach = useTerminalStore((s) => s.detach);
	const { sessionId: activeId } = useParams({ strict: false }) as { sessionId?: string };
	const navigate = useNavigate();

	const [closing, setClosing] = useState<string | null>(null);
	const stripRef = useRef<HTMLDivElement>(null);

	// The avatar answers "which project is this one?", and it carries the
	// session's status as a corner badge (F10). It did not until 2026-08-18, on
	// the reasoning that every tab is a live PTY by definition so a dot on each
	// would be a row of green telling you nothing — true while a live PTY was one
	// state. Now the row says which session wants you, and which are not running
	// at all, on the surface you are already looking at.
	//
	// This query is also the staleness gate: a persisted tab naming a project that
	// no longer exists must not paint, so nothing renders until it resolves. There
	// is no default state to flash, which is why waiting is free here and was not
	// for `sidebarStore` (F16).
	const projectsQ = useQuery({ queryKey: queryKeys.projects(), queryFn: () => cmd.listProjects() });

	// `tabs` is the source of truth for what is open and in what order;
	// `bySession` only says which of them are running. A tab with no entry there
	// is stopped — that is the whole of the restore rule, and it needs no branch.
	const tabs = useMemo(
		() =>
			tabsInKnownProjects(openTabs, projectsQ.data).map((t) => ({
				id: t.sessionId,
				projectId: t.projectId,
				status: bySession[t.sessionId]?.status ?? ('stopped' as const),
			})),
		[openTabs, projectsQ.data, bySession],
	);
	// `SortableContext` wants the ids, and it wants the same array identity across
	// renders it doesn't change in.
	const tabIds = useMemo(() => tabs.map((t) => t.id), [tabs]);

	const titles = useSessionTitles(tabs);
	const projectById = useMemo(
		() => new Map((projectsQ.data ?? []).map((p) => [p.id, p])),
		[projectsQ.data],
	);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: DRAG_START_PX } }),
	);

	// Switching sessions from the sidebar (or a keyboard, later) must not leave
	// you looking at the wrong end of a scrolled strip.
	useEffect(() => {
		if (!activeId) return;
		stripRef.current
			?.querySelector(`[data-session-id="${CSS.escape(activeId)}"]`)
			?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}, [activeId]);

	const openSession = useCallback(
		(sessionId: string, projectId: string) => {
			// **A stopped tab is a restart** (F16). Without this you would land on the
			// pooled xterm's dead pane — or, for a tab restored from a previous run,
			// on nothing at all — and a navigate to the route you are already on does
			// not remount, so the tab you are looking at would do nothing whatever.
			// `restartSession` is the same call the session header's Restart makes.
			if (!useTerminalStore.getState().bySession[sessionId]) restartSession(sessionId);
			void navigate({
				to: '/projects/$projectId/sessions/$sessionId',
				params: { projectId, sessionId },
			});
		},
		[navigate],
	);

	const closeSession = useCallback(
		(sessionId: string, projectId: string) => {
			const live = bySession[sessionId];
			setClosing(null);
			void (async () => {
				if (live) {
					try {
						await cmd.terminalKill(live.terminalId);
					} catch (e) {
						// The kill failed, so the PTY may well still be running: keep the
						// tab, where its status dot keeps telling the truth.
						console.error('terminal_kill failed', e);
						return;
					}
				}
				// Closing is the only thing that removes a tab (F16). Done here rather
				// than on `terminal:exit`: we know what we just did, and a tab that
				// waits for an event is a tab that lingers forever if the event is
				// missed — and that event now keeps the tab anyway.
				detach(sessionId);
				disposeTerminal(sessionId);
				// Only navigate if you were looking at the session you just closed.
				if (activeId === sessionId) {
					void navigate({ to: '/projects/$id', params: { id: projectId } });
				}
			})();
		},
		[activeId, bySession, detach, navigate],
	);

	/** The × and middle-click both come through here: ask while Claude is
	 *  working, close outright otherwise (F10). A stopped tab has no process to
	 *  kill, so `needsCloseConfirm` says no and it closes on the click. */
	const requestClose = useCallback(
		(sessionId: string, projectId: string) => {
			if (needsCloseConfirm(bySession[sessionId]?.status)) setClosing(sessionId);
			else closeSession(sessionId, projectId);
		},
		[bySession, closeSession],
	);

	/** `arrayMove` semantics, which is what `terminalStore.reorder` already does:
	 *  lift the tab out, then insert it at the index the drop landed on. */
	const onDragEnd = useCallback(
		(event: DragEndEvent) => {
			const { active, over } = event;
			if (!over || active.id === over.id) return;
			const to = tabIds.indexOf(String(over.id));
			if (to < 0) return;
			reorder(String(active.id), to);
		},
		[reorder, tabIds],
	);

	/**
	 * One place left or right with the keyboard, because a drag-only reorder is
	 * unreachable without a mouse.
	 *
	 * `Alt`+arrows rather than dnd-kit's `KeyboardSensor`: that sensor takes the
	 * space bar to lift an item, and space on a `role="tab"` means *activate this
	 * tab*. Trading a gesture everybody knows for a lift-move-drop mode nobody
	 * discovers is the wrong way round, and a nudge needs no mode at all.
	 */
	const nudge = useCallback(
		(sessionId: string, delta: -1 | 1) => {
			const from = tabIds.indexOf(sessionId);
			const to = from + delta;
			if (from < 0 || to < 0 || to >= tabIds.length) return;
			reorder(sessionId, to);
		},
		[reorder, tabIds],
	);

	if (tabs.length === 0) {
		// Nothing open, but the row still needs something between the brand and the
		// panel toggle: the strip is the only flexible element in that flex line,
		// so returning null slides the toggle across to sit beside the app name.
		// A spacer keeps the toggle on the right without a second `flex-1` sibling,
		// which is what made the strip half-width in the first place.
		return <div className="flex-1" aria-hidden />;
	}

	const closingTab = closing ? tabs.find((t) => t.id === closing) : undefined;

	return (
		<>
			{/* `restrictToHorizontalAxis`: a tab strip has one axis, and a tab you can
			    lift into the middle of the window suggests it can be dropped there.
			    Auto-scroll is dnd-kit's default and we keep it — the strip overflows,
			    so dragging to its edge scrolls it, which the old implementation could
			    not do at all. */}
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				modifiers={[restrictToHorizontalAxis]}
				onDragEnd={onDragEnd}
			>
				<SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
					<div
						ref={stripRef}
						role="tablist"
						aria-label="Open sessions"
						data-testid="session-tabs"
						// `overflow-x-auto` with the bar hidden: at 42px tall a scrollbar
						// would eat a third of the strip. The wheel handler below is what
						// makes it reachable without one.
						className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1"
						onWheel={(e) => {
							// A vertical wheel over a horizontal strip does nothing by default,
							// which reads as "these tabs are stuck".
							if (e.deltaY !== 0 && stripRef.current) {
								stripRef.current.scrollLeft += e.deltaY;
							}
						}}
					>
						{tabs.map(({ id, projectId, status }) => (
							<SessionTab
								key={id}
								id={id}
								projectId={projectId}
								status={status}
								project={projectById.get(projectId)}
								title={titles.get(id) ?? shortId(id)}
								isActive={id === activeId}
								onOpen={openSession}
								onRequestClose={requestClose}
								onNudge={nudge}
							/>
						))}
					</div>
				</SortableContext>
			</DndContext>

			<CloseSessionConfirm
				sessionName={closing ? (titles.get(closing) ?? shortId(closing)) : null}
				canConfirm={Boolean(closing && bySession[closing])}
				onCancel={() => setClosing(null)}
				onConfirm={() => closingTab && closeSession(closingTab.id, closingTab.projectId)}
			/>
		</>
	);
}

interface SessionTabProps {
	id: string;
	projectId: string;
	/** `stopped` when nothing is running — which is every restored tab, and every
	 *  session whose process has exited since. */
	status: TerminalStatus;
	project: Project | undefined;
	title: string;
	isActive: boolean;
	onOpen: (sessionId: string, projectId: string) => void;
	onRequestClose: (sessionId: string, projectId: string) => void;
	onNudge: (sessionId: string, delta: -1 | 1) => void;
}

/**
 * One tab: project avatar, title, close control — and the drag itself.
 *
 * Its own component because `useSortable` is a hook, so every sortable item is
 * one. That is the whole of the refactor the library asked for.
 *
 * **dnd-kit's `attributes` are deliberately not spread here.** They set
 * `role="button"` and an `aria-describedby` pointing at "press space bar to pick
 * up" instructions — wrong on both counts: this is a `role="tab"`, and the
 * keyboard path is `Alt`+arrows rather than a lift-and-drop mode (see `nudge`).
 * `aria-keyshortcuts` says so in the one place a screen reader will read it.
 */
function SessionTab({
	id,
	projectId,
	status,
	project,
	title,
	isActive,
	onOpen,
	onRequestClose,
	onNudge,
}: SessionTabProps) {
	const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id });

	return (
		<div
			ref={setNodeRef}
			role="tab"
			aria-selected={isActive}
			aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
			data-session-id={id}
			{...listeners}
			// **`Translate`, not `Transform`** — the difference is `scaleX`, and tabs
			// are not all the same width. dnd-kit publishes the active item's transform
			// through `adjustScale(translate, over.rect, activeNodeRect)`
			// (core.esm.js:2997), so `scaleX` is the ratio of the tab you are over to
			// the tab you are holding: drag a short title onto a long one and it zooms
			// up, drag a long one onto a short one and it shrinks. That scale is there
			// for a `DragOverlay` that morphs into the target's box; we drag the
			// element itself, so it is pure distortion. Reported 2026-08-18 as a tab
			// that "zooms weirdly" mid-drag, and it did.
			style={{ transform: DndCss.Translate.toString(transform), transition }}
			// **The tab you are dragging is the tab, not a snapshot of it.** The old
			// implementation dimmed the source and dragged a cloned drag image,
			// because the browser snapshots the element *after* `dragstart` and the
			// dimming landed on the snapshot. dnd-kit translates the real element, so
			// the ghost, the clone and the dimming all go away: it lifts (shadow,
			// above its neighbours) and the others slide under it.
			className={`group flex h-7.5 max-w-60 shrink-0 cursor-pointer touch-none items-center gap-1.5 rounded px-2 text-sm ${
				isDragging
					? 'z-10 bg-secondary text-foreground shadow-lg'
					: isActive
						? 'bg-secondary text-foreground transition-colors'
						: 'text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground'
			}`}
			onClick={() => onOpen(id, projectId)}
			// Middle-click closes, the way every tab strip does. It goes through the
			// same path as the × — a shortcut to the action, not a way around the
			// question it may ask.
			onAuxClick={(e) => {
				if (e.button !== 1) return;
				e.preventDefault();
				onRequestClose(id, projectId);
			}}
			onKeyDown={(e) => {
				if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
					e.preventDefault();
					onNudge(id, e.key === 'ArrowLeft' ? -1 : 1);
					return;
				}
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onOpen(id, projectId);
				}
			}}
			tabIndex={0}
			title={`${project?.displayName ?? projectId} — ${title}`}
		>
			{/* The badge is the only thing that says whether this session is running.
			    No dimming, no italics: at 14px a second treatment says the same thing
			    twice and makes the strip harder to read, not easier (F16). */}
			<ProjectIcon
				name={project?.displayName ?? projectId}
				path={project?.realPath ?? projectId}
				size={16}
				status={status}
			/>
			<span className="min-w-0 flex-1 truncate">{title}</span>
			{/* Only where the pointer already is, or on the active tab: a row of
			    permanent × buttons is a row of accidents waiting. */}
			<button
				type="button"
				aria-label={`Close ${title}`}
				className={`-mr-1 rounded p-0.5 text-muted-foreground/70 transition-all hover:text-primary focus-visible:opacity-100 ${
					isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
				}`}
				// The sensor listens on the tab, so a press on the × is a press on the
				// tab: stop it here or a slightly draggy click on the close button
				// starts a drag instead of closing anything.
				onPointerDown={(e) => e.stopPropagation()}
				onClick={(e) => {
					e.stopPropagation();
					onRequestClose(id, projectId);
				}}
			>
				<X className="size-3.5" />
			</button>
		</div>
	);
}

function shortId(sessionId: string): string {
	return sessionId.slice(0, 8);
}

/**
 * Titles for the open sessions, looked up per project.
 *
 * One query per distinct project rather than per session — they share the cache
 * entry the sidebar and project page already fill, so an open project costs
 * nothing extra. A session too new to be indexed has no title yet and falls
 * back to its short id, matching the session header — as does a restored tab
 * whose transcript has since been deleted, since the index row goes with it.
 */
function useSessionTitles(tabs: Array<{ projectId: string }>): Map<string, string> {
	const projectIds = useMemo(() => [...new Set(tabs.map((t) => t.projectId))].sort(), [tabs]);

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
