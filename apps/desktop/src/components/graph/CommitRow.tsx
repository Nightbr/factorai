import type { GitGraphCommit, GitRefKind, RemoteHost } from '@factorai/types';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@factorai/ui';
import { CHIP_CLASSES, CHIP_SHAPE, chipMaxWidth, fitRefs, foldRefs } from '@lib/gitGraph';
import { formatAbsolute, formatRelative } from '@lib/format';
import { avatarFor } from '@lib/avatar';
import { GraphRail, ROW_HEIGHT } from '@components/graph/GraphRail';
import { Cloud, Laptop, Tag } from 'lucide-react';
// Brand marks, compiled at build time from `@iconify-json/simple-icons` the same
// way the file-type icons are (ADR-0006). lucide dropped its brand set, and a
// forge is exactly the case where the logo is the fastest thing to recognise.
import IconGitHub from '~icons/simple-icons/github';
import IconGitLab from '~icons/simple-icons/gitlab';

/** How long the pointer must rest before the card appears, and how long it
 *  lingers after leaving. Sweeping down a list of 26px rows crosses a dozen in
 *  the time it takes to read one, so without the open delay this would be a
 *  cascade of cards rather than an affordance. */
const HOVER_OPEN_MS = 400;
const HOVER_CLOSE_MS = 150;

/**
 * The mark on a ref chip, saying where that ref lives.
 *
 * Local is a device, remote is the forge `origin` actually points at — read from
 * the remote's configured URL in Rust, never by asking the forge anything. A
 * remote we don't recognise gets the cloud, which is the honest answer: it is
 * somewhere else, and we are not going to pretend to know where.
 */
function RefIcon({ kind, host }: { kind: GitRefKind; host: RemoteHost }) {
	const className = 'size-3 shrink-0';
	if (kind === 'tag') return <Tag className={className} />;
	if (kind === 'remoteBranch') {
		if (host === 'gitHub') return <IconGitHub className={className} />;
		if (host === 'gitLab') return <IconGitLab className={className} />;
		return <Cloud className={className} />;
	}
	return <Laptop className={className} />;
}

interface CommitRowProps {
	commit: GitGraphCommit;
	pitch: number;
	railWidth: number;
	/** Width left for refs and subject, for deciding what becomes `+N`. */
	textWidth: number;
	/** Which forge `origin` names, for the remote chips' icon. */
	remoteHost: RemoteHost;
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
	remoteHost,
	selected,
	tabbable,
	dirty,
	onSelect,
}: CommitRowProps) {
	const chips = foldRefs(commit.refs);
	const { shown, hiddenCount } = fitRefs(chips, textWidth);
	const maxChipWidth = chipMaxWidth(textWidth);
	const avatar = avatarFor(commit.authorName, commit.authorEmail);

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
							node={
								dirty
									? { kind: 'dirty' }
									: { kind: 'commit', colour: avatar.colour, initials: avatar.initials }
							}
						/>
						{shown.map((chip) => (
							<span
								key={chip.key}
								// Capped and truncating, so one long branch name cannot push
								// the subject off the row. The full name is on the card.
								style={{ maxWidth: maxChipWidth }}
								className={`${CHIP_SHAPE} shrink-0 ${CHIP_CLASSES[chip.kind]}`}
							>
								<RefIcon kind={chip.kind} host={remoteHost} />
								<span className="truncate">{chip.label}</span>
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
				{/* Under the row, not beside it. `side="left"` put the card outside the
				    panel and over the terminal — the thing you are working in — and at
				    the window's left edge it had nowhere to go at all.
				
				    **Width is the trigger's**, not a fixed `w-80`: the row spans the
				    panel, so matching it is what keeps the card inside the panel instead
				    of being shoved left by collision handling to fit a width the panel
				    never had. `collisionPadding` still flips it above near the foot of
				    the list. */}
				<HoverCardContent
					side="bottom"
					align="start"
					sideOffset={4}
					// Vertical only. A horizontal padding shoves the card left to keep
					// clear of the window edge — and since the panel *is* the window's
					// right edge, that put it back outside the panel, which is the
					// exact complaint this placement was fixing.
					collisionPadding={{ top: 8, bottom: 8 }}
					className="w-[var(--radix-hover-card-trigger-width)]"
				>
					<CommitCard commit={commit} remoteHost={remoteHost} />
				</HoverCardContent>
			</HoverCard>
		</li>
	);
}

/** Everything the row had to cut. Not the body or the file list — those are the
 *  detail pane's job, and a card big enough for them would cover the graph you
 *  are reading. */
function CommitCard({ commit, remoteHost }: { commit: GitGraphCommit; remoteHost: RemoteHost }) {
	const chips = foldRefs(commit.refs);
	const avatar = avatarFor(commit.authorName, commit.authorEmail);

	return (
		<div className="flex flex-col gap-2">
			{chips.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{chips.map((chip) => (
						// Uncapped here: the card is where a name too long for the row is
						// supposed to become readable.
						<span key={chip.key} className={`${CHIP_SHAPE} ${CHIP_CLASSES[chip.kind]}`}>
							<RefIcon kind={chip.kind} host={remoteHost} />
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
				<dd className="flex min-w-0 items-center gap-1.5">
					{/* The same disc as the node, so the card confirms the row rather than
					    introducing a second way to identify an author. */}
					<span
						aria-hidden="true"
						style={{ background: avatar.colour }}
						className="flex size-4 shrink-0 items-center justify-center rounded-full font-semibold text-[8px] text-card"
					>
						{avatar.initials}
					</span>
					<span className="truncate">{commit.authorName}</span>
				</dd>
				{commit.authorEmail && (
					<>
						<dt className="text-muted-foreground/60">Email</dt>
						<dd className="truncate">{commit.authorEmail}</dd>
					</>
				)}
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
