import { RefreshCw } from 'lucide-react';
import { requestRestart } from '@components/layout/RestartConfirm';
import { updateLabel, useUpdater } from '@hooks/useUpdater';
import { needsQuitConfirm } from '@lib/quitConfirm';
import { useTerminalStore } from '@store/terminalStore';

/**
 * The updater's surface in the sidebar footer (specs/05-features.md F14).
 *
 * At rest it is a quiet "Check for updates" — a label that happens to be
 * clickable, so the updater is observable rather than a thing that silently
 * might be working. Checking and downloading stay understated; only a staged
 * version earns the accent.
 *
 * **It owns nothing.** The phase, the poll and the one-install-per-run guard
 * live in `updaterStore` (ADR-0050), and the restart confirmation is
 * `RestartConfirm`, shared with the About section's copy of this control (F29).
 * This component is mounted twice — here and inside the rail's overflow menu —
 * and while it owned its own state, opening that menu started a fresh check
 * with a fresh guard and re-downloaded a release already staged.
 */
export function UpdateBadge() {
	const { state, checkNow } = useUpdater();
	// Two primitive selectors rather than one derived object: each is a number,
	// so neither re-renders the footer on an unrelated store write.
	const live = useTerminalStore((s) => Object.keys(s.bySession).length);
	const working = useTerminalStore(
		(s) => Object.values(s.bySession).filter((t) => t.status === 'working').length,
	);

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
				{updateLabel(state.phase)}
			</button>
		);
	}

	/**
	 * **Three things keep this inside the footer**, and F14 has been carrying
	 * the reasoning since 2026-08-17 while the code carried the bug. The
	 * label is `Update ready` — the version lives in the tooltip, where it
	 * cannot set a min-content width the footer has no room for, and where
	 * a channel suffix (`v0.10.0-alpha.2`, roadmap item 31) costs nothing.
	 * `· Restart` is gone for the same reason, and because a glowing button
	 * and the tooltip both already say it. `inline-flex` + `max-w-full` +
	 * `truncate` are what make it *degrade* rather than clip: it wants
	 * ~175px beside `ZoomControls` and has ~48px at the 180px sidebar floor,
	 * so left to hug its content it pushed its neighbour out of the row —
	 * which is what a 120% zoom looked like. Now the label shortens and, at
	 * the very narrow end, it is the mark alone.
	 */
	return (
		<button
			type="button"
			data-testid="update-badge"
			title={`Version ${state.version} is installed and starts on the next launch — click to restart`}
			onClick={() => requestRestart(needsQuitConfirm({ live, working }))}
			className="inline-flex h-6 max-w-full items-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-2 text-primary text-xs transition-colors hover:bg-primary/20"
		>
			<RefreshCw className="size-3 shrink-0" />
			{/* Icon-only under ~120px of footer cell, which is the 180px sidebar
				    floor: `Update ready` needs about 114px with its mark and padding,
				    and what is left below that is the mark — which is F14's "degrade to
				    the icon", and is why the tooltip carries the whole sentence. */}
			<span className="@max-[7.5rem]:hidden truncate font-medium">Update ready</span>
		</button>
	);
}
