import { IconButton } from '@factorai/ui';
import { Columns2, SquareTerminal, X } from 'lucide-react';
import { type ShellTab, useShellStore } from '@store/shellStore';

/**
 * One shell in the footer's strip.
 *
 * `DESIGN.md`'s Tab Chips with two extensions: a `×` on hover or focus, whose
 * space is reserved so nothing shifts when it appears, and a **dead** state —
 * a chip whose process the app's quit killed keeps its border and drops to
 * muted text, reading like a stopped session tab. Clicking a dead chip spawns a
 * new shell in the directory the old one had.
 *
 * **Labelled with a terminal glyph and the shell's name, and never anything
 * else** (`specs/05-features.md` § F23 as amended by F24). The first version
 * read the shell's own `OSC 0` title — whatever the prompt theme decided — and
 * fixed the chip at 120px so a retitle could not step it sideways. A static
 * name needs no constant: the chip hugs `zsh`, and stays put because `zsh`
 * does.
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
	// `shell` only before Rust has ever answered `shell_name`, which is before
	// any chip can exist — the strip's control is disabled until it has.
	const label = useShellStore((s) => s.shellName) ?? 'shell';
	const count = tab.panes.length;
	const dead = tab.panes.every((p) => p.dead);
	// What the tooltip says: the name, how many panes when more than one, and
	// what a click on a dead chip does, which is the one click that is not a
	// switch.
	const title = [
		label,
		count > 1 ? `${count} panes` : null,
		dead ? `click to open ${count > 1 ? 'new shells' : 'a new shell'} here` : null,
	]
		.filter(Boolean)
		.join(' · ');
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
				dead ? 'text-muted-foreground/60' : ''
			}`}
		>
			<button
				type="button"
				role="tab"
				aria-selected={active}
				onClick={onSelect}
				title={title}
				className="flex items-center gap-1.5 whitespace-nowrap font-medium text-xs"
			>
				<SquareTerminal className="size-3" />
				{label}
				{/* A chip that holds a row says so: a columns glyph and the count,
				    at the label's own size — the scale has no third one (F24). */}
				{count > 1 && (
					<span
						className="flex items-center gap-0.5 text-muted-foreground"
						aria-label={`${count} panes`}
					>
						<Columns2 className="size-3" />
						{count}
					</span>
				)}
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
