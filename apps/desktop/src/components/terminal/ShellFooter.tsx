import { Button } from '@factorai/ui';
import { Plus } from 'lucide-react';
import { ShellChip } from '@components/terminal/ShellChip';
import { useShellStore } from '@store/shellStore';

/**
 * The strip along the bottom of a live session (`specs/05-features.md` § F23).
 *
 * **Always present, with no shells open.** It costs the agent a row of its grid
 * and it is the only thing that says the footer exists; a control revealed on
 * hover, or one that only appears once you have already used the feature,
 * cannot be found by somebody who has not. The new-terminal control is
 * **labelled** for the same reason — a bare `+` in a strip is a control you
 * have to already know.
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
	 *  the project root otherwise. */
	cwd: string | null;
}) {
	const open = useShellStore((s) => s.open);
	const close = useShellStore((s) => s.close);
	const setActive = useShellStore((s) => s.setActive);
	const tabs = useShellStore((s) => s.bySession[sessionId]);
	const activeKey = useShellStore((s) => s.activeBySession[sessionId] ?? null);

	return (
		<div
			className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-border border-t bg-card px-2"
			// A strip of chips is a tab list even when it is empty, and the `+` at
			// the end of it is not one of the tabs.
			role="tablist"
			aria-label="Shells"
			data-testid="shell-footer"
		>
			{tabs?.map((tab) => (
				<ShellChip
					key={tab.key}
					tab={tab}
					active={tab.key === activeKey}
					// **Clicking the chip you are on collapses the split**, leaving the
					// shells running: the agent gets its full height back while a long
					// build finishes, and nothing is lost by looking away.
					//
					// Except a dead chip, where there is nothing to collapse away from
					// and a click means "open a shell here" — collapsing it would make
					// that take two clicks for no reason anyone could infer.
					onSelect={() => setActive(sessionId, tab.key === activeKey && !tab.dead ? null : tab.key)}
					onClose={() => close(tab.key)}
				/>
			))}
			{/* Labelled, so `Button` rather than `IconButton` — the house rule is
			    that `IconButton` is for icon-*only* controls. `quiet` is the
			    labelled sibling of that rule: nothing paints behind it and the text
			    takes colour on hover, because a filled block in a chrome strip
			    outweighs the chips beside it. No `aria-label`: the visible word is
			    the accessible name.

			    **`size-3` on the glyph, matching the 12px label, and lifted 1px.**
			    The scale's 3.5 is sized for a 14px label. And centring is not
			    alignment: the flex line centres the glyph's box against the text's
			    line box, whose baseline sits below its centre — measured in the
			    running app, the `+`'s bar landed at y=935.5 against the word's
			    optical centre of 934. The pixel is that difference, not a taste. */}
			<Button
				variant="quiet"
				size="sm"
				className="shrink-0 gap-1.5 font-normal text-xs [&_svg]:-translate-y-px [&_svg]:size-3"
				// A shell with nowhere to run is refused by the backend anyway; not
				// offering the button at all is the honest version of that.
				disabled={!cwd}
				onClick={() => cwd && open(sessionId, projectId, cwd)}
			>
				<Plus /> Terminal
			</Button>
		</div>
	);
}
