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
