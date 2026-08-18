import type { TerminalStatus } from '@factorai/types';
import { openSessions } from '@lib/sessionGroups';
import { useTerminalStore } from '@store/terminalStore';
import { useMemo } from 'react';

/**
 * The sessions you have **open**, live or not (F16) — the record every session
 * list outside the tab strip is drawn from.
 *
 * A hook rather than a selector because `openSessions` builds a new object each
 * call, and handing zustand a fresh reference on every store read re-renders
 * forever. Same shape as `liveSessionsIn`'s call sites, and for the same reason.
 *
 * **Not every surface wants this.** `pendingSessions`, `UpdateBadge`'s count and
 * the session header's Close-versus-Restart are about running processes and stay
 * on `bySession`; F16 § "Where 'open' shows outside the strip" says which is
 * which and why.
 */
export function useOpenSessions(): Record<string, { projectId: string; status: TerminalStatus }> {
	const tabs = useTerminalStore((s) => s.tabs);
	const bySession = useTerminalStore((s) => s.bySession);
	return useMemo(() => openSessions(tabs, bySession), [tabs, bySession]);
}
