import type { GitWorktree } from '@factorai/types';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@factorai/ui';
import { ChevronDown, FolderGit2 } from 'lucide-react';
import { checkoutLabel } from '@hooks/useWorktrees';

interface CheckoutMenuProps {
	/** Every checkout of this project's repository, in git's order — the main one
	 *  first. Two or more, or the caller does not draw this at all. */
	worktrees: GitWorktree[];
	/** The checkout the panel is currently rooted at. */
	current: string;
	/** The human picked a checkout. Called with its path, never with `current`. */
	onSelect: (path: string) => void;
	/** Drawn only when the panel is off the session's own checkout — the same
	 *  undo the badge used to carry as an icon of its own. */
	onRevert: (() => void) | null;
}

/**
 * The human's checkout picker (specs/05-features.md F21 § "On screen").
 *
 * **Deferred out of F21 v0 on purpose, and shipped once the premise it was
 * gating had been tested.** v0 existed to find out whether agent-driven
 * following works; a select would have let it look like it does. It does work,
 * off `last_cwd` and containment — and the case it cannot cover turned up in a
 * real session: an agent that creates a worktree and then drives it entirely by
 * `git -C` and absolute paths never moves its own cwd, never opens a file
 * through the bridge, and so leaves no trace to follow at all. There is nothing
 * to infer from. This is the control for that.
 *
 * **The mark is the trigger, rather than a control beside it.** The header's
 * rule is that the checkout mark is quiet — it says where you are, it is not a
 * widget — and one thing that both says where you are and takes you elsewhere is
 * fewer things in a row that already holds a status dot, a project, a branch, a
 * title and a close button. It follows `IconButton`'s hover rule for the same
 * reason: colour, never a filled block.
 *
 * **Drawn only when the repository has more than one checkout.** A
 * single-checkout project's header is byte-identical to what it was before any
 * of F21 existed, which is the 95% case paying nothing.
 */
export function CheckoutMenu({ worktrees, current, onSelect, onRevert }: CheckoutMenuProps) {
	const currentWorktree = worktrees.find((w) => w.path === current);
	const label = currentWorktree ? checkoutLabel(currentWorktree) : current;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					// The mark keeps the testid it had as a plain span: it is the same
					// fact on screen, and every spec that asserts "the header names the
					// checkout" is asserting about this element.
					data-testid="session-worktree"
					aria-label="Switch checkout"
					title={`Working in ${current}`}
					className="flex min-w-0 max-w-[12rem] shrink-0 items-center gap-1 text-muted-foreground text-xs hover:text-primary"
				>
					<FolderGit2 className="size-3 shrink-0" aria-hidden />
					<span className="truncate">{label}</span>
					<ChevronDown className="size-3 shrink-0" aria-hidden />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-64">
				<DropdownMenuLabel>Checkouts</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={current}
					onValueChange={(path) => {
						if (path !== current) onSelect(path);
					}}
				>
					{worktrees.map((worktree) => (
						<DropdownMenuRadioItem
							key={worktree.path}
							value={worktree.path}
							// A checkout whose directory is gone is listed and not
							// selectable, following the panel's own rule: filtering it out
							// leaves a checkout you cannot see and so cannot reason about.
							disabled={!worktree.exists}
						>
							<span className="flex min-w-0 flex-1 items-center justify-between gap-2">
								<span className="truncate">{checkoutLabel(worktree)}</span>
								{/* Branch, `missing`, `locked` — metadata, in the voice the
								    sidebar's own `missing` already speaks in. The branch is
								    here rather than in the label because two checkouts can
								    share a name's shape and never a branch. */}
								<span className="shrink-0 text-muted-foreground text-xs">
									{!worktree.exists
										? 'missing'
										: worktree.locked
											? 'locked'
											: (worktree.branch ?? 'detached')}
								</span>
							</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				{onRevert && (
					<>
						<DropdownMenuSeparator />
						{/* The undo of an automatic move, kept as a named action rather
						    than "pick the main checkout": it also clears the record, so the
						    next read does not resolve straight back to where you left. */}
						<DropdownMenuItem onSelect={onRevert}>
							Back to this session's own checkout
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
