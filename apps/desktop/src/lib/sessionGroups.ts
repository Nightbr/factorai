import type { SessionSummary } from '@factorai/types';

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
