import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@factorai/ui';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useUpdater } from '@hooks/useUpdater';
import { useTerminalStore } from '@store/terminalStore';

/**
 * The updater's whole surface, in the sidebar footer (specs/05-features.md
 * F14).
 *
 * At rest it is a quiet "Check for updates" — a label that happens to be
 * clickable, so the updater is observable rather than a thing that silently
 * might be working. Checking and downloading stay understated; only a staged
 * version earns the accent.
 *
 * **Restarting is a quit.** `relaunch()` tears the process down, and with it
 * every live PTY — but it never fires `CloseRequested`, so the quit guard
 * (ADR-0005) doesn't see it and would let a running Claude session die without
 * a word. Hence the same confirmation here, on the same terms.
 */
export function UpdateBadge() {
	const { state, checkNow, restart } = useUpdater();
	const liveCount = useTerminalStore((s) => Object.keys(s.bySession).length);
	const [confirming, setConfirming] = useState(false);

	if (state.phase !== 'ready') {
		return (
			<button
				type="button"
				data-testid="update-check"
				className="truncate text-muted-foreground/60 text-xs transition-colors hover:text-foreground disabled:hover:text-muted-foreground/60"
				disabled={state.phase === 'checking' || state.phase === 'downloading'}
				title="Check for updates now"
				onClick={checkNow}
			>
				{LABELS[state.phase]}
			</button>
		);
	}

	function onRestart() {
		if (liveCount > 0) {
			setConfirming(true);
			return;
		}
		restart();
	}

	return (
		<>
			<button
				type="button"
				data-testid="update-badge"
				title={`Version ${state.version} is installed and starts on the next launch`}
				onClick={onRestart}
				className="flex h-6 items-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-2 text-primary text-xs transition-colors hover:bg-primary/20"
			>
				<RefreshCw className="size-3" />
				<span className="font-medium">v{state.version} ready</span>
				<span className="text-primary/70">· Restart</span>
			</button>

			<Dialog open={confirming} onOpenChange={setConfirming}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<AlertTriangle className="size-5 text-destructive" />
							Restart to update?
						</DialogTitle>
						<DialogDescription>
							factorai {state.version} is ready. Restarting terminates {liveCount} running Claude
							session{liveCount === 1 ? '' : 's'}. This cannot be undone — the update will also
							apply on its own the next time you quit and reopen.
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
		</>
	);
}

const LABELS: Record<'idle' | 'checking' | 'upToDate' | 'downloading' | 'error', string> = {
	idle: 'Check for updates',
	checking: 'Checking…',
	upToDate: 'Up to date',
	downloading: 'Downloading update…',
	// Deliberately not the error text: a failed check means the app is simply
	// not the newest, which is not worth a red line in the footer forever.
	error: 'Check for updates',
};
