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
import { cmd, events } from '@lib/tauri';

/**
 * Listens for `app:quit-requested` (fired from Rust when the user tries to
 * close the window with live PTYs). Shows a mandatory confirm dialog —
 * see ADR-0005, kill-on-quit is non-optional.
 */
export function QuitConfirm() {
	const [open, setOpen] = useState(false);
	const [liveCount, setLiveCount] = useState(0);

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		events
			.onQuitRequested((p) => {
				setLiveCount(p.liveCount);
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
						{liveCount} running Claude session{liveCount === 1 ? '' : 's'} will be
						terminated. This cannot be undone.
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
