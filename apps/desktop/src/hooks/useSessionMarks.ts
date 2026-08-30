import { type SessionMark, sessionMarks } from '@lib/sessionGroups';
import { useTerminalStore } from '@store/terminalStore';
import { useMemo } from 'react';

/**
 * Every session a list should mark: the ones you have **open**, and the ones
 * **running with no tab** (F16, F22).
 *
 * A hook rather than a selector because `sessionMarks` builds a new object each
 * call, and handing zustand a fresh reference on every store read re-renders
 * forever. Same shape as `liveSessionsIn`'s call sites, and for the same reason.
 *
 * **It replaced `useOpenSessions`**, which was a projection of the tab strip: a
 * routine's session is live and tabless, so under that record it had no dot in
 * any list — an agent working invisibly, which `00-overview.md` § "The operating
 * model" rules out. The distinction survives inside the record instead, as
 * `background`, which is what the blue dot draws.
 *
 * **Not every surface wants this.** `pendingSessions`, `UpdateBadge`'s count and
 * the session header's Close-versus-Restart are about running processes and stay
 * on `bySession`; F16 § "Where 'open' shows outside the strip" says which is
 * which and why.
 */
export function useSessionMarks(): Record<string, SessionMark> {
	const tabs = useTerminalStore((s) => s.tabs);
	const bySession = useTerminalStore((s) => s.bySession);
	return useMemo(() => sessionMarks(tabs, bySession), [tabs, bySession]);
}
