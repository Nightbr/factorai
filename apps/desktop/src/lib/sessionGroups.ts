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

/**
 * Precedence for rolling several sessions up into one dot (F10). Lower wins.
 *
 * **Attention first, not activity first.** `waiting_input` beats `working`
 * because the aggregate dot's job is to surface what you cannot otherwise see: a
 * working session resolves itself and a waiting one never does. Ranking
 * `working` first — which this did until a screenshot showed it — makes a project
 * with four blocked sessions and one busy one read as "busy", hiding every
 * session that wants you. The reverse mistake is milder: a project shown amber
 * while four sessions hammer away still points at the one to act on.
 *
 * Same shape as F13's folder dots — a parent row has one dot and several
 * children — but note "worst" means a different thing here. For a changed file
 * it is severity; for a session it is who is blocked, and the answer is you.
 */
const STATUS_RANK: readonly TerminalStatus[] = ['waiting_input', 'working', 'stopped'];

/**
 * The single status to show for a project, from its live sessions.
 *
 * `undefined` when the project has no live session at all — which is not a
 * state, it is the absence of one, and renders as no dot rather than a grey one.
 * A grey dot on every project you have ever opened is noise; F10's `stopped` is
 * for a session whose process died while you were watching it.
 */
export function projectStatus(
	bySession: Record<string, { projectId: string; status: TerminalStatus }>,
	projectId: string,
): TerminalStatus | undefined {
	let best: TerminalStatus | undefined;
	for (const live of Object.values(bySession)) {
		if (live.projectId !== projectId) continue;
		if (best === undefined || STATUS_RANK.indexOf(live.status) < STATUS_RANK.indexOf(best)) {
			best = live.status;
		}
	}
	return best;
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

/**
 * The sessions you have **open**, live or not (F16).
 *
 * A projection of the tab list, not a merge: `tabs` decides membership and
 * `bySession` only colours it in, so a session with no live PTY comes out
 * `stopped`. That is the whole of the "restored tabs are stopped" rule — there
 * is nothing to remember to apply, because a rehydrated store has an empty
 * `bySession` by construction.
 *
 * Shaped to be a drop-in for the `bySession` these functions already take, so
 * `projectStatus` and the session rows change the argument they are handed
 * rather than their signatures. Which surfaces switched and which deliberately
 * did not is in F16 § "Where 'open' shows outside the strip" — `pendingSessions`
 * is the interesting one that did not.
 *
 * Structural parameters, like the rest of this file: `lib/` stays free of store
 * imports.
 */
export function openSessions(
	tabs: ReadonlyArray<{ sessionId: string; projectId: string }>,
	bySession: Record<string, { projectId: string; status: TerminalStatus }>,
): Record<string, { projectId: string; status: TerminalStatus }> {
	const out: Record<string, { projectId: string; status: TerminalStatus }> = {};
	for (const tab of tabs) {
		out[tab.sessionId] = {
			projectId: tab.projectId,
			status: bySession[tab.sessionId]?.status ?? 'stopped',
		};
	}
	return out;
}

/**
 * Restored tabs whose project still exists — the staleness filter (F16).
 *
 * A persisted `projectId` can name a project that has since been removed, and a
 * tab for one is not merely useless: F6 refuses a spawn with no `realPath`
 * precisely because `portable_pty` would otherwise start `claude` in `$HOME` and
 * file the session under a different project than the tab names.
 *
 * Dropped silently, following `sidebarStore`'s v1→v2 precedent — persisted ids
 * that stop matching anything are dropped rather than remapped or reported.
 *
 * `undefined` projects means "not fetched yet" and yields nothing, so the strip
 * paints once rather than painting stale tabs and then dropping some. Unlike a
 * sidebar width there is no default state to flash, which is why this one can
 * afford to wait where `sidebarStore` could not.
 */
export function tabsInKnownProjects<T extends { projectId: string }>(
	tabs: readonly T[],
	projects: ReadonlyArray<{ id: string }> | undefined,
): T[] {
	if (!projects) return [];
	const known = new Set(projects.map((p) => p.id));
	return tabs.filter((t) => known.has(t.projectId));
}
