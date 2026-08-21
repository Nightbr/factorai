/**
 * When quitting or restarting asks first, and what it says (ADR-0020).
 *
 * **The trigger is an agent at work, not a process being alive.** Until
 * 2026-08-21 both surfaces asked whenever any PTY existed, which meant the app
 * stopped you on the way out to warn about sessions that had finished hours
 * earlier — the same complaint F10 fixed for closing one session, on the two
 * gestures F10 did not cover. `needsCloseConfirm` in
 * `components/dialog/CloseSessionConfirm` is that rule; this is its pair.
 *
 * **Kill-on-quit does not change** (ADR-0005). Every live PTY still dies, asked
 * about or not — what narrowed is the question, not the killing. That is why the
 * sentence below is written from `live` and not from `working`: a quit with one
 * working session and three idle ones ends four processes, and saying "1" would
 * be the honest-sounding version of a lie.
 *
 * Shared between the quit guard and the updater's restart because they are one
 * decision made at two doors. They already drifted once — the restart badge
 * shipped with no confirmation at all until 2026-08-17 — and two copies of a
 * rule about losing work is exactly the thing to only own once.
 */

/** The two counts every caller has: live PTYs, and how many are working. */
export interface LiveCounts {
	/** PTYs that will be terminated. */
	live: number;
	/** PTYs with Claude working in them right now. */
	working: number;
}

/**
 * Whether the gesture should stop and ask.
 *
 * Not configurable, unlike closing a single session: this one is about losing
 * every live session at once, and ADR-0005's "mandatory" survives intact for
 * the case it was written about.
 *
 * **Known gap, inherited from F10.** A session parked on a permission prompt
 * reads as `waiting_input`, because Claude's title says idle while a dialog is
 * open — so that one quits without asking. Same gap, same cause, and the same
 * fix would close both: the `needs_permission` state F10 recorded as considered
 * and not built.
 */
export function needsQuitConfirm({ working }: LiveCounts): boolean {
	return working > 0;
}

/** The verb the dialog is about — the two doors this rule guards. Not exported:
 *  callers pass the literal, and an alias nothing imports is what knip is for. */
type QuitAct = 'Quitting' | 'Restarting';

/**
 * What is at risk, in one sentence: what is working, and what dies.
 *
 * Two shapes rather than one, because when every live session is working the
 * "of N" clause restates the number it just gave — and a dialog that says
 * "1 of 1" reads as a placeholder somebody forgot to finish.
 */
export function quitConfirmSentence({ live, working }: LiveCounts, act: QuitAct): string {
	const working_s = working === 1 ? '' : 's';
	if (working >= live) {
		return `Claude is working in ${working} session${working_s}. ${act} terminates ${working === 1 ? 'it' : 'them'} — work in progress is lost.`;
	}
	return `Claude is working in ${working} of ${live} live sessions. ${act} terminates all ${live} — work in progress is lost.`;
}
