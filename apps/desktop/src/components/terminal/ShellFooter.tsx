import { Button } from '@factorai/ui';
import { Columns2, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ShellChip } from '@components/terminal/ShellChip';
import { closeChip } from '@components/terminal/shells';
import { splitDisabledReason } from '@lib/shellLayout';
import { useShellStore } from '@store/shellStore';

/**
 * The strip along the bottom of a live session (`specs/05-features.md` § F23,
 * F24).
 *
 * **Always present, with no shells open.** It costs the agent a row of its grid
 * and it is the only thing that says the footer exists; a control revealed on
 * hover, or one that only appears once you have already used the feature,
 * cannot be found by somebody who has not. Both controls are **labelled** for
 * the same reason — a bare `+` in a strip is a control you have to already
 * know, and so is a bare split glyph.
 *
 * 36px, declared — `DESIGN.md` § "Chrome heights are explicit". The same height
 * as the sidebar footer it sits level with: the two are one band across the
 * bottom of the window, and 6px of disagreement between them reads as a
 * misalignment rather than as two separate surfaces.
 */
export function ShellFooter({
	sessionId,
	projectId,
	cwd,
}: {
	sessionId: string;
	projectId: string;
	/** Where a new shell starts: the session's checkout when it has one (F21),
	 *  the project root otherwise. A split pane starts there too (F24). */
	cwd: string | null;
}) {
	const stripRef = useRef<HTMLDivElement>(null);
	// The strip is as wide as the row above it — both fill the session column —
	// so its own width is the row's, and `Split` can know whether another pane
	// fits without the row telling it.
	const [rowWidth, setRowWidth] = useState<number | null>(null);
	const open = useShellStore((s) => s.open);
	const split = useShellStore((s) => s.split);
	const setActive = useShellStore((s) => s.setActive);
	const chips = useShellStore((s) => s.bySession[sessionId]);
	const activeKey = useShellStore((s) => s.activeBySession[sessionId] ?? null);
	const shellName = useShellStore((s) => s.shellName);
	const active = chips?.find((c) => c.key === activeKey) ?? null;

	useEffect(() => {
		const strip = stripRef.current;
		if (!strip) return;
		setRowWidth(strip.clientWidth);
		const ro = new ResizeObserver(() => setRowWidth(strip.clientWidth));
		ro.observe(strip);
		return () => ro.disconnect();
	}, []);

	// A shell with nowhere to run is refused by the backend anyway; not offering
	// the control at all is the honest version of that. And a chip opened before
	// `shell_name` has answered would be a chip with no label, whose width steps
	// when the name lands — the answer arrives at boot, so that half is a guard
	// nobody sees.
	const canOpen = Boolean(cwd && shellName);
	const splitReason = splitDisabledReason(active ? active.panes.length : null, rowWidth);

	return (
		<div
			ref={stripRef}
			className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-border border-t bg-card px-2"
			// A strip of chips is a tab list even when it is empty, and the
			// controls at the end of it are not tabs.
			role="tablist"
			aria-label="Shells"
			data-testid="shell-footer"
		>
			{chips?.map((chip) => (
				<ShellChip
					key={chip.key}
					tab={chip}
					active={chip.key === activeKey}
					// **Clicking the chip you are on collapses the split**, leaving the
					// shells running: the agent gets its full height back while a long
					// build finishes, and nothing is lost by looking away.
					//
					// Except a dead chip, where there is nothing to collapse away from
					// and a click means "open the shells here again" — collapsing it
					// would make that take two clicks for no reason anyone could infer.
					onSelect={() =>
						setActive(
							sessionId,
							chip.key === activeKey && !chip.panes.every((p) => p.dead) ? null : chip.key,
						)
					}
					onClose={() => closeChip(chip)}
				/>
			))}
			{/* Labelled, so `Button` rather than `IconButton` — the house rule is
			    that `IconButton` is for icon-*only* controls. `quiet` is the
			    labelled sibling of that rule: nothing paints behind it and the text
			    takes colour on hover, because a filled block in a chrome strip
			    outweighs the chips beside it. No `aria-label`: the visible word is
			    the accessible name.

			    **`size-3` on the glyph, matching the 12px label, and not lifted.**
			    The scale's 3.5 is sized for a 14px label. F23 lifted the `+` by a
			    pixel from a measurement of it alone; once `Split` put a second
			    glyph beside a second word (F24) both read high, and measuring the
			    line box against the font's metrics said why: with a 12px face on a
			    16px line the flex centre already sits 0.3px above the cap centre,
			    so the lift moved the glyph 1.3px above the letters it belongs to.
			    The chip's glyphs never had the lift, and they were the ones that
			    read right. */}
			<Button
				variant="quiet"
				size="sm"
				className="shrink-0 gap-1.5 font-normal text-xs [&_svg]:size-3"
				disabled={!canOpen}
				onClick={() => cwd && open(sessionId, projectId, cwd)}
			>
				<Plus /> Terminal
			</Button>
			{/* The reason rides on a wrapper because a disabled button gets no
			    pointer events in WebKit, so a `title` on the button itself would
			    never show — and the one time the reason matters is when the
			    control is disabled. */}
			<span title={splitReason ?? 'Split the active shell to the right'} className="shrink-0">
				<Button
					variant="quiet"
					size="sm"
					className="gap-1.5 font-normal text-xs [&_svg]:size-3"
					disabled={!canOpen || splitReason !== null}
					onClick={() => active && cwd && split(active.key, cwd)}
				>
					<Columns2 /> Split
				</Button>
			</span>
		</div>
	);
}
