import type { SessionSummary, TerminalStatus } from '@factorai/types';

export interface SessionGroup {
	/** The row that leads the group — a real session, or an orphaned sub-agent. */
	session: SessionSummary;
	/** Sub-agents this session spawned, in the order the backend returned them. */
	agents: SessionSummary[];
}

/**
 * Fold a flat session list into parents with their sub-agents (F2).
 *
 * `list_sessions` already returns them in the right order — groups by the
 * parent's recency, parent first, siblings by their own recency — so this only
 * has to nest, never sort.
 *
 * **An orphan leads its own group.** A sub-agent whose parent transcript has
 * been deleted still has `subagentOf` set, pointing at a session that is no
 * longer in the list. Filing it under a parent that isn't there would hide it
 * entirely, and it is still readable, so it becomes a top-level row that
 * happens to be marked as an agent.
 *
 * Two passes rather than one, deliberately: a single pass only works while the
 * backend guarantees a parent precedes its children, and an agent that arrived
 * first would be dropped on the floor with no way to notice.
 */
export function groupSessions(sessions: SessionSummary[]): SessionGroup[] {
	const present = new Set(sessions.map((s) => s.id));
	const isOrphan = (s: SessionSummary) => s.subagentOf !== null && !present.has(s.subagentOf);

	const groups: SessionGroup[] = [];
	const byParent = new Map<string, SessionGroup>();
	for (const session of sessions) {
		if (session.subagentOf === null || isOrphan(session)) {
			const group: SessionGroup = { session, agents: [] };
			groups.push(group);
			byParent.set(session.id, group);
		}
	}
	for (const session of sessions) {
		if (session.subagentOf === null || isOrphan(session)) continue;
		byParent.get(session.subagentOf)?.agents.push(session);
	}
	return groups;
}

/** A live session the index has never heard of. `sessionId` rather than a
 *  `SessionSummary`: there is no row to summarise, which is the whole point.
 *  Not exported — both call sites infer it, and a named export nothing imports
 *  is what knip is for. */
interface PendingSession {
	sessionId: string;
	status: TerminalStatus;
}

/**
 * Live sessions in one project that `list_sessions` doesn't return yet (F6).
 *
 * A session gets no `sessions` row until claude writes its transcript and the
 * watcher reindexes it, which for a brand-new one is only after the first
 * message. Every list that shows only indexed rows therefore says "no sessions
 * yet" about a project whose PTY is very much alive — so the sidebar and the
 * project page both union this in.
 *
 * `indexed` being undefined means "not fetched yet", not "nothing indexed", and
 * returns nothing: treating the two the same would flash every live session as
 * a new one on first paint.
 *
 * Takes the store's map structurally rather than importing `LiveTerminal`, so
 * this file stays free of store imports like the rest of `lib/`.
 */
export function pendingSessions(
	bySession: Record<string, { projectId: string; status: TerminalStatus }>,
	projectId: string,
	indexed: SessionSummary[] | undefined,
): PendingSession[] {
	if (!indexed) return [];
	const known = new Set(indexed.map((s) => s.id));
	return Object.entries(bySession)
		.filter(([sessionId, live]) => live.projectId === projectId && !known.has(sessionId))
		.map(([sessionId, live]) => ({ sessionId, status: live.status }));
}
