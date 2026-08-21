import { Button } from '@factorai/ui';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@factorai/ui';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type LiveCounts, quitConfirmSentence } from '@lib/quitConfirm';
import { cmd, events } from '@lib/tauri';

/**
 * Listens for `app:quit-requested` (fired from Rust when the user tries to
 * close the window **with Claude working in one of them**). Shows a mandatory
 * confirm dialog — see ADR-0005, kill-on-quit is non-optional.
 *
 * The gate is Rust's, not this component's: a close with live-but-idle sessions
 * never emits the event at all, and Rust kills those PTYs itself on the way out
 * (ADR-0020). So there is no `needsQuitConfirm` call here — by the time this
 * hears anything, the answer was yes.
 */
export function QuitConfirm() {
	const [open, setOpen] = useState(false);
	const [counts, setCounts] = useState<LiveCounts>({ live: 0, working: 0 });

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		events
			.onQuitRequested((p) => {
				setCounts({ live: p.liveCount, working: p.workingCount });
				setOpen(true);
			})
			.then((fn) => {
				unlisten = fn;
			});
		return () => unlisten?.();
	}, []);

	const confirm = async () => {
		setOpen(false);
		await cmd.appQuitConfirmed();
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<AlertTriangle className="size-5 text-destructive" />
						Quit factorai?
					</DialogTitle>
					<DialogDescription>
						{quitConfirmSentence(counts, 'Quitting')} This cannot be undone.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button variant="destructive" onClick={confirm}>
						Quit &amp; kill sessions
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
