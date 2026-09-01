import { IconButton } from '@factorai/ui';
import { X } from 'lucide-react';
import type { ShellTab } from '@store/shellStore';

/**
 * A chip's fixed width, in px (`specs/05-features.md` § F23).
 *
 * **Fixed, and that is the whole reason chips work here.** `DESIGN.md`'s Tab
 * Chips are bordered on every chip precisely so a chip does not change width as
 * you switch — and a chip labelled with a live `OSC 0` title would resize every
 * time the shell retitled itself, which most prompts do on every command. So the
 * label truncates into a constant box instead, and the strip stays still while
 * `cargo test` runs.
 */
const CHIP_WIDTH = 120;

/**
 * One shell in the footer's strip.
 *
 * `DESIGN.md`'s Tab Chips with two extensions: a `×` on hover or focus, whose
 * space is reserved so nothing shifts when it appears, and a **dead** state —
 * a chip whose process the app's quit killed keeps its border and drops to
 * muted text, reading like a stopped session tab. Clicking a dead chip spawns a
 * new shell in the directory the old one had.
 */
export function ShellChip({
	tab,
	active,
	onSelect,
	onClose,
}: {
	tab: ShellTab;
	active: boolean;
	/** Selecting the chip you are already on collapses the split (F23). */
	onSelect: () => void;
	onClose: () => void;
}) {
	const label = chipLabel(tab);
	return (
		<div
			// `group` so the `×` can appear on a hover of the whole chip rather than
			// of the button itself, which at this size is a target you would have to
			// aim for before you could see it.
			className={`group flex h-6 shrink-0 items-center gap-1 rounded-md border pl-2 transition-colors ${
				active
					? 'border-border bg-secondary text-foreground'
					: 'border-border/50 text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
			} ${
				// A dead chip keeps its border and loses its text, the way a stopped
				// session tab reads — it is still a place, it just has no process in
				// it. Never `opacity`: that would fade the border too, and the border
				// is what says the chip is still there to click.
				tab.dead ? 'text-muted-foreground/60' : ''
			}`}
			style={{ width: CHIP_WIDTH }}
		>
			<button
				type="button"
				role="tab"
				aria-selected={active}
				onClick={onSelect}
				title={tab.dead ? `${label} — click to open a new shell here` : label}
				className="min-w-0 flex-1 truncate text-left font-medium text-xs"
			>
				{label}
			</button>
			{/* Always rendered, so the label's box never changes width when the
			    pointer arrives — `invisible` rather than unmounted for that reason.
			    `focus-within` on the parent is what keeps it reachable by keyboard. */}
			<IconButton
				aria-label={`Close ${label}`}
				className="invisible size-5 group-focus-within:visible group-hover:visible"
				onClick={onClose}
			>
				<X className="size-3" />
			</IconButton>
		</div>
	);
}

/**
 * What a chip says: the shell's own `OSC 0`, which Rust seeds with the shell's
 * basename at spawn so a chip is never nameless — see `spawn_shell`.
 *
 * A title is read from the same stream an agent's *status* comes from, and for
 * a shell it is a name; F23 and ADR-0031 hold why those are two readings of one
 * stream rather than one rule with an exception.
 */
function chipLabel(tab: ShellTab): string {
	return tab.title ?? 'shell';
}
