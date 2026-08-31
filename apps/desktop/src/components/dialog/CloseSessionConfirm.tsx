import type { TerminalStatus } from '@factorai/types';
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@factorai/ui';
import { AlertTriangle } from 'lucide-react';

/** Which gesture asked to close. They are two rows in the settings page, so
 *  they are two values here (F11). */
export type CloseGesture = 'button' | 'middle-click';

/** The two switches in the Confirmations section, as this function needs them.
 *  Spelled out rather than taking the whole `Prefs`, so the rule below stays
 *  readable and its tests need no store. */
export interface CloseConfirmPrefs {
	confirmCloseSession: boolean;
	confirmCloseMiddleClick: boolean;
}

/**
 * Whether closing a session should ask first — **only while Claude is
 * working**, and only if you have left the question on (F10, F11).
 *
 * This is the ask F10 came from: the dialog below warns that "any work in
 * progress is lost", and until there was a status to consult it said that about
 * a session which finished ten minutes ago. Now it only says it when it is true.
 *
 * `undefined` means no live PTY, so there is nothing to kill and nothing to ask
 * about.
 *
 * **The preference does not contradict the operating model**
 * (AGENTS.md § "Project overview"). "Every irreversible
 * action keeps its confirmation" binds *the app* — it forbids factorai deciding
 * on its own that an ask isn't worth it. A human turning it off is the fourth
 * verb in `00-overview.md` § "The operating model": setting the rules agents run
 * under. The quit dialog is not covered by it and stays mandatory (F5,
 * ADR-0005) — that one is about losing every live session at once.
 *
 * **Two switches, no master switch.** The `×` and middle-click are separate
 * because middle-click has no aim to it: somebody who finds the question tedious
 * on a deliberate `×` may still want it on a stray wheel-click.
 *
 * **Known gap, accepted in F10.** A session parked on a permission prompt reads
 * as `waiting_input`, because Claude's title says idle while a dialog is open —
 * so that one closes without asking. Catching it needs the `needs_permission`
 * state F10 records as considered and not built. What is lost is a dialog, not
 * the transcript.
 *
 * Lives beside the dialog rather than at each call site for the same reason the
 * dialog itself is shared: two surfaces deciding this separately would drift on
 * *when* to ask exactly as they once drifted on whether to.
 */
export function needsCloseConfirm(
	status: TerminalStatus | undefined,
	gesture: CloseGesture,
	prefs: CloseConfirmPrefs,
): boolean {
	if (status !== 'working') return false;
	return gesture === 'middle-click' ? prefs.confirmCloseMiddleClick : prefs.confirmCloseSession;
}

interface CloseSessionConfirmProps {
	/** The session being closed, or `null` when none is — this is the open
	 *  state, so the caller keeps one piece of state rather than two that can
	 *  disagree. */
	sessionName: string | null;
	/** False once the PTY has gone between opening the dialog and confirming
	 *  (it exited on its own, or another surface closed it). The confirm greys
	 *  out rather than firing a kill at a terminal id that no longer exists. */
	canConfirm?: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}

/**
 * The confirm shown before closing a live session, from either surface that
 * offers it: a tab's `×` (and its middle-click shortcut) and the session
 * header's.
 *
 * **Shared on purpose.** It lived inline in `SessionTabs` while the header
 * killed a session with no question at all, so the two controls disagreed about
 * what the act is called, what it looks like, and whether it is worth asking
 * about. Two confirm modals for one act are free to drift; one is not.
 *
 * Controlled rather than self-managing, because the caller owns what happens
 * after: the tab strip only navigates if you were looking at the session it
 * just closed, and the header always does.
 *
 * Not to be confused with `QuitConfirm`, which is about losing *every* live
 * session at once and is mandatory (F5, ADR-0005).
 */
export function CloseSessionConfirm({
	sessionName,
	canConfirm = true,
	onCancel,
	onConfirm,
}: CloseSessionConfirmProps) {
	return (
		<Dialog open={sessionName !== null} onOpenChange={(open) => !open && onCancel()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<AlertTriangle className="size-5 text-destructive" />
						Close this session?
					</DialogTitle>
					<DialogDescription>
						{sessionName ?? ''} is running. Closing it terminates its Claude session — the
						transcript is kept, but any work in progress is lost. This cannot be undone.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						Keep it running
					</Button>
					<Button variant="destructive" disabled={!canConfirm} onClick={onConfirm}>
						Close &amp; kill session
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
