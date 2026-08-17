import type { GitGraphCommit } from '@factorai/types';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@factorai/ui';
import { CHIP_CLASSES, fitRefs, foldRefs } from '@lib/gitGraph';
import { formatAbsolute, formatRelative } from '@lib/format';
import { GraphRail, ROW_HEIGHT } from '@components/graph/GraphRail';

/** How long the pointer must rest before the card appears, and how long it
 *  lingers after leaving. Sweeping down a list of 26px rows crosses a dozen in
 *  the time it takes to read one, so without the open delay this would be a
 *  cascade of cards rather than an affordance. */
const HOVER_OPEN_MS = 400;
const HOVER_CLOSE_MS = 150;

interface CommitRowProps {
	commit: GitGraphCommit;
	pitch: number;
	railWidth: number;
	/** Width left for refs and subject, for deciding what becomes `+N`. */
	textWidth: number;
	selected: boolean;
	/** The one row in the list that Tab reaches — the selected one, or the first
	 *  when nothing is selected yet. */
	tabbable: boolean;
	/** Uncommitted changes sit on top of this commit — only ever HEAD's row. */
	dirty: boolean;
	onSelect: () => void;
}

/**
 * One commit: lane rail, ref chips, subject (specs/05-features.md F18).
 *
 * **Hover un-truncates, click goes deeper.** That rule is what makes a
 * ~38-character row acceptable: everything the row had to cut is one hover away,
 * and the body and file list — which genuinely want width — are in the pane below.
 */
export function CommitRow({
	commit,
	pitch,
	railWidth,
	textWidth,
	selected,
	tabbable,
	dirty,
	onSelect,
}: CommitRowProps) {
	const chips = foldRefs(commit.refs);
	const { shown, hiddenCount } = fitRefs(chips, textWidth);

	return (
		<li>
			<HoverCard openDelay={HOVER_OPEN_MS} closeDelay={HOVER_CLOSE_MS}>
				<HoverCardTrigger asChild>
					<button
						type="button"
						// A real button in a real list, rather than `role="listbox"` /
						// `role="option"`: those are for a composite widget whose options are
						// plain choices, and an option cannot hold a rail, chips and a
						// subject. `aria-current` says which of the siblings you are on, and
						// the roving tabindex means Tab reaches the list once instead of
						// walking 300 buttons — the container moves focus with the arrows.
						aria-current={selected}
						tabIndex={tabbable ? 0 : -1}
						data-testid="commit-row"
						data-sha={commit.sha}
						style={{ height: ROW_HEIGHT }}
						className={`flex w-full items-center gap-1.5 pr-2 text-left text-sm transition-colors ${
							selected ? 'bg-secondary' : 'hover:bg-secondary/50'
						}`}
						onClick={onSelect}
					>
						<GraphRail
							lane={commit.lane}
							edges={commit.edges}
							pitch={pitch}
							width={railWidth}
							dirty={dirty}
						/>
						{shown.map((chip) => (
							<span
								key={chip.key}
								className={`shrink-0 font-medium text-xs ${CHIP_CLASSES[chip.kind]}`}
							>
								{chip.label}
							</span>
						))}
						{hiddenCount > 0 && (
							<span className="shrink-0 text-muted-foreground text-xs">+{hiddenCount}</span>
						)}
						<span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-foreground'}`}>
							{commit.subject}
						</span>
					</button>
				</HoverCardTrigger>
				{/* Side `left`: the panel is on the right edge of the window, so a card
				    opening rightwards would be clipped by it. */}
				<HoverCardContent side="left" className="w-80">
					<CommitCard commit={commit} />
				</HoverCardContent>
			</HoverCard>
		</li>
	);
}

/** Everything the row had to cut. Not the body or the file list — those are the
 *  detail pane's job, and a card big enough for them would cover the graph you
 *  are reading. */
function CommitCard({ commit }: { commit: GitGraphCommit }) {
	const chips = foldRefs(commit.refs);

	return (
		<div className="flex flex-col gap-2">
			{chips.length > 0 && (
				<div className="flex flex-wrap gap-x-2 gap-y-1">
					{chips.map((chip) => (
						<span key={chip.key} className={`font-medium text-xs ${CHIP_CLASSES[chip.kind]}`}>
							{chip.label}
						</span>
					))}
				</div>
			)}
			{/* Untruncated, and wrapping — the whole reason to hover a row whose
			    subject was cut at 38 characters. */}
			<p className="font-medium text-sm">{commit.subject || <em>no message</em>}</p>
			<dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground text-xs">
				<dt className="text-muted-foreground/60">Author</dt>
				<dd className="truncate">{commit.authorName}</dd>
				<dt className="text-muted-foreground/60">Date</dt>
				{/* Both forms: relative is what you scan for, absolute is what you
				    need when "3 months ago" stops being precise enough. */}
				<dd>
					{formatRelative(commit.authorTime)}
					<span className="text-muted-foreground/60"> · {formatAbsolute(commit.authorTime)}</span>
				</dd>
				<dt className="text-muted-foreground/60">Commit</dt>
				<dd className="font-mono">{commit.shortSha}</dd>
				{commit.parents.length > 1 && (
					<>
						<dt className="text-muted-foreground/60">Merge</dt>
						<dd className="font-mono">{commit.parents.length} parents</dd>
					</>
				)}
			</dl>
		</div>
	);
}
