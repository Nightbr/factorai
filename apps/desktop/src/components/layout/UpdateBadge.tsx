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
import { needsQuitConfirm, quitConfirmSentence } from '@lib/quitConfirm';
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
 * a word. Hence the same confirmation here, on the same terms — literally the
 * same terms: `needsQuitConfirm` decides for both doors (ADR-0020).
 */
export function UpdateBadge() {
	const { state, checkNow, restart } = useUpdater();
	// Two primitive selectors rather than one derived object: each is a number,
	// so neither re-renders the footer on an unrelated store write.
	const live = useTerminalStore((s) => Object.keys(s.bySession).length);
	const working = useTerminalStore(
		(s) => Object.values(s.bySession).filter((t) => t.status === 'working').length,
	);
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
		if (needsQuitConfirm({ live, working })) {
			setConfirming(true);
			return;
		}
		restart();
	}

	return (
		<>
			{/* **Three things keep this inside the footer**, and F14 has been carrying
			    the reasoning since 2026-08-17 while the code carried the bug. The
			    label is `Update ready` — the version lives in the tooltip, where it
			    cannot set a min-content width the footer has no room for, and where
			    a channel suffix (`v0.10.0-alpha.2`, roadmap item 31) costs nothing.
			    `· Restart` is gone for the same reason, and because a glowing button
			    and the tooltip both already say it. `inline-flex` + `max-w-full` +
			    `truncate` are what make it *degrade* rather than clip: it wants
			    ~175px beside `ZoomControls` and has ~48px at the 180px sidebar floor,
			    so left to hug its content it pushed its neighbour out of the row —
			    which is what a 120% zoom looked like. Now the label shortens and, at
			    the very narrow end, it is the mark alone. */}
			<button
				type="button"
				data-testid="update-badge"
				title={`Version ${state.version} is installed and starts on the next launch — click to restart`}
				onClick={onRestart}
				className="inline-flex h-6 max-w-full items-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-2 text-primary text-xs transition-colors hover:bg-primary/20"
			>
				<RefreshCw className="size-3 shrink-0" />
				{/* Icon-only under ~120px of footer cell, which is the 180px sidebar
				    floor: `Update ready` needs about 114px with its mark and padding,
				    and what is left below that is the mark — which is F14's "degrade to
				    the icon", and is why the tooltip carries the whole sentence. */}
				<span className="@max-[7.5rem]:hidden truncate font-medium">Update ready</span>
			</button>

			<Dialog open={confirming} onOpenChange={setConfirming}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<AlertTriangle className="size-5 text-destructive" />
							Restart to update?
						</DialogTitle>
						<DialogDescription>
							factorai {state.version} is ready.{' '}
							{quitConfirmSentence({ live, working }, 'Restarting')} This cannot be undone — the
							update will also apply on its own the next time you quit and reopen.
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
