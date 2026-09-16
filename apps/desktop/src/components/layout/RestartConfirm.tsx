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
import { restart } from '@hooks/useUpdater';
import { quitConfirmSentence } from '@lib/quitConfirm';
import { useTerminalStore } from '@store/terminalStore';
import { useUpdaterStore } from '@store/updaterStore';

/**
 * The one restart confirmation, for every door that can start one
 * (specs/05-features.md F14, ADR-0050).
 *
 * **Restarting is a quit.** `relaunch()` tears the process down and takes every
 * live PTY with it — but it never fires `CloseRequested`, so the quit guard
 * (ADR-0005) never sees it and a working Claude session would die without a
 * word. Hence this, on the same terms as the window's own close: literally the
 * same terms, since `quitConfirmSentence` decides for both (ADR-0020).
 *
 * It was `UpdateBadge`'s own dialog until the About section became a second
 * door (F29). One component now, mounted once by `AppShell` and opened through
 * `updaterStore.confirming`, because the door that gets added later is exactly
 * the one that would forget to ask. Radix portals it, so it stacks correctly
 * over the settings modal when About is what opened it.
 */
export function RestartConfirm() {
	const confirming = useUpdaterStore((s) => s.confirming);
	const setConfirming = useUpdaterStore((s) => s.setConfirming);
	const state = useUpdaterStore((s) => s.state);
	// Two primitive selectors rather than one derived object: each is a number,
	// so neither re-renders on an unrelated store write.
	const live = useTerminalStore((s) => Object.keys(s.bySession).length);
	const working = useTerminalStore(
		(s) => Object.values(s.bySession).filter((t) => t.status === 'working').length,
	);

	const version = state.phase === 'ready' ? state.version : '';

	return (
		<Dialog open={confirming} onOpenChange={setConfirming}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<AlertTriangle className="size-5 text-destructive" />
						Restart to update?
					</DialogTitle>
					<DialogDescription>
						factorai {version} is ready. {quitConfirmSentence({ live, working }, 'Restarting')} This
						cannot be undone — the update will also apply on its own the next time you quit and
						reopen.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={() => setConfirming(false)}>
						Later
					</Button>
					<Button variant="destructive" onClick={restart}>
						Restart &amp; kill sessions
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Start a restart from any surface: ask first when something is working, and go
 * straight there when nothing is. **With nothing working there is no dialog** —
 * including when live sessions are sitting at their prompt, which is the common
 * case for an app left open beside finished work.
 */
export function requestRestart(needsConfirm: boolean): void {
	if (needsConfirm) {
		useUpdaterStore.getState().setConfirming(true);
		return;
	}
	restart();
}
