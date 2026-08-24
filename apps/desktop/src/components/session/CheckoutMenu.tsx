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
			<DropdownMenuContent align="start" className="w-96 max-w-[calc(100vw-2rem)]">
				<DropdownMenuLabel>Checkouts</DropdownMenuLabel>
				{/* A worktree-heavy repository is this menu's normal case, not its edge
				    one — a real user had five — and a menu taller than the window is a
				    menu with rows you cannot reach. */}
				<DropdownMenuRadioGroup
					className="max-h-[60vh] overflow-y-auto"
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
							// The whole truth for a name or a branch too long to draw. The
							// path is here and nowhere else: it is what tells two checkouts
							// apart when everything else about them reads the same, and it is
							// never short enough to spend a row on.
							title={`${checkoutLabel(worktree)}\n${worktree.branch ?? 'detached HEAD'}\n${worktree.path}`}
							className="py-1.5"
						>
							{/* **A subtitle, not a second column.** They were side by side and it
							    did not survive contact with real data: a checkout named after its
							    branch puts two 40-character strings in one 256px row, and both
							    truncate to the prefix they share. Stacked, each gets the full
							    width — and the `min-w-0` chain is what makes `truncate` fire at
							    all: a flex child's default `min-width: auto` silently refuses to
							    shrink, which is why the old row overflowed the menu instead of
							    ellipsing inside it. */}
							<span className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="flex min-w-0 items-center gap-2">
									<span className="min-w-0 truncate">{checkoutLabel(worktree)}</span>
									{/* Only the two states that change whether a row can be chosen at
									    all — the voice the project row's own `missing` already speaks
									    in. Both are short by construction, so neither fights the name
									    for width. */}
									{stateChip(worktree) && (
										<span className="shrink-0 text-muted-foreground text-xs">
											{stateChip(worktree)}
										</span>
									)}
								</span>
								{branchSubtitle(worktree) && (
									<span className="min-w-0 truncate text-muted-foreground text-xs">
										{branchSubtitle(worktree)}
									</span>
								)}
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

/** `locked` or `missing` — or nothing, which is most rows.
 *
 *  **There is deliberately no `main` chip.** The main checkout is git's first row
 *  and stays first here, so the position already says it; the word did not, and
 *  beside a branch called `main` it read as a stutter. What is left are the two
 *  states that change whether a row can be chosen at all.
 *
 *  Exported for its own test, like `branchSubtitle` below: both are rules about
 *  what a row *says*, and neither needs a render to exercise. */
export function stateChip(worktree: GitWorktree): string | null {
	if (!worktree.exists) return 'missing';
	return worktree.locked ? 'locked' : null;
}

/**
 * The branch, **when it is not already what the name says**.
 *
 * A worktree is usually created for a branch and named after it, so printing
 * both is printing one fact twice — and in a real repository the two 40-character
 * strings that result are the crowding this menu was rebuilt to fix. The test is
 * the branch's last segment appearing in the name, which is what survives the
 * usual `feature/eng-3759-x` → `repo-eng-3759-x` renaming.
 *
 * A checkout with no branch at all still gets a subtitle: "no branch" is the fact
 * you most need before picking one.
 */
export function branchSubtitle(worktree: GitWorktree): string | null {
	if (!worktree.exists) return 'directory is gone';
	if (!worktree.branch) return 'detached HEAD';
	const tail = worktree.branch.split('/').pop() ?? worktree.branch;
	return checkoutLabel(worktree).toLowerCase().includes(tail.toLowerCase())
		? null
		: worktree.branch;
}
