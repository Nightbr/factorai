import type { GitGraphCommit, GitRefKind, RemoteHost } from '@factorai/types';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@factorai/ui';
import type { RefChip } from '@lib/gitGraph';
import { CHIP_CLASSES, CHIP_SHAPE, chipMaxWidth, fitRefs, foldRefs } from '@lib/gitGraph';
import { formatAbsolute, formatRelative } from '@lib/format';
import { avatarFor } from '@lib/avatar';
import { GraphRail, ROW_HEIGHT } from '@components/graph/GraphRail';
import { Check, Cloud, Laptop, Tag } from 'lucide-react';
// Brand marks, compiled at build time from `@iconify-json/simple-icons` the same
// way the file-type icons are (ADR-0006). lucide dropped its brand set, and a
// forge is exactly the case where the logo is the fastest thing to recognise.
import IconGitHub from '~icons/simple-icons/github';
import IconGitLab from '~icons/simple-icons/gitlab';

/**
 * How long the pointer must rest before the card appears, and how long it
 * lingers after leaving.
 *
 * **Opens immediately (changed 2026-08-18 on user feedback), from 400ms.** The
 * delay was there so sweeping down a list of 26px rows didn't fire a cascade of
 * cards. In use the cascade never arrived and the wait did: this card is what
 * un-truncates a row, so pointing at a row you cannot read and waiting is the
 * whole interaction, and 400ms of nothing reads as the app not responding.
 *
 * Radix keeps the sweep tolerable on its own — one card is open at a time, and
 * moving between triggers swaps content rather than opening a second. The close
 * delay stays: it is what lets the pointer travel from row to card without the
 * card vanishing under it, and it costs nothing on the way in.
 */
const HOVER_OPEN_MS = 0;
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

/**
 * One ref chip: its marks, its name, and the sentence they compress.
 *
 * **Marks replaced text on 2026-08-18** (F18 § The row). `HEAD→main ≡origin`
 * spent the whole ref budget at 288px on 4 characters of branch name; it is now
 * a tick, a laptop, `main`, and the forge's logo. `title` carries the words,
 * because an icon is faster to scan and worse to learn — the trade only works
 * while the sentence is one hover away.
 *
 * `maxWidth` is capped so one `feature/some-very-long-description` cannot push
 * the subject off the row, and **released on hover** so the name you pointed at
 * is the one you can read. The cap is an inline style because it is computed
 * from the panel's width, so lifting it needs `!` to outrank that — the one
 * place in this file where specificity is the mechanism rather than an accident.
 */
function Chip({
	chip,
	remoteHost,
	maxWidth,
}: {
	chip: RefChip;
	remoteHost: RemoteHost;
	/** Uncapped on the hover card, where a long name is the point. */
	maxWidth?: number;
}) {
	return (
		<span
			title={chip.title}
			style={maxWidth ? { maxWidth } : undefined}
			className={`${CHIP_SHAPE} ${maxWidth ? 'shrink-0 hover:max-w-none!' : ''} ${
				CHIP_CLASSES[chip.kind]
			}`}
		>
			{/* The tick, not the word: `HEAD→` cost five characters to say what every
			    other git UI says with a check beside the branch that is checked out. */}
			{chip.isHead && <Check className="size-3 shrink-0" aria-hidden />}
			<RefIcon kind={chip.kind} host={remoteHost} />
			<span className="truncate">{chip.label}</span>
			{/* Local and remote are on this same commit, so the forge's mark stands
			    in for ` ≡origin`. Which remote is in the tooltip — repositories with
			    one remote are the common case, and naming it cost more width than it
			    ever returned. */}
			{chip.syncedRemote && <RefIcon kind="remoteBranch" host={remoteHost} />}
		</span>
	);
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
							<Chip key={chip.key} chip={chip} remoteHost={remoteHost} maxWidth={maxChipWidth} />
						))}
						{hiddenCount > 0 && (
							<span className="shrink-0 text-muted-foreground text-xs">+{hiddenCount}</span>
						)}
						<span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-foreground'}`}>
							{commit.subject}
						</span>
					</button>
				</HoverCardTrigger>
				{/* **Beside the row, not under it — back to `side="left"` on 2026-08-18.**
				    This has now been both, and the two complaints are different rather
				    than one reversed: opening left originally landed the card *outside*
				    the panel in a way nothing bounded, and opening below covers the
				    commits under the row, which is the list you are reading the card in
				    order to navigate. A hover card that hides its own context is the
				    worse of the two, so it goes back to the left — with the bound the
				    first attempt was missing.

				    **What actually broke the first time was the width, not the side.**
				    A fixed `w-80` inside a panel that starts at 200px meant collision
				    handling shoved the card sideways to fit a width nothing had, and it
				    ended up over the terminal at an arbitrary offset. The card is now
				    bounded on both ends: it tracks the row's width, floors at 18rem so a
				    narrow panel doesn't produce a cramped card, and caps at 24rem so it
				    always fits the space to the left. Worst case is a 600px panel in an
				    1100px window — the minimum this app allows — which leaves ~500px for
				    a card that can never exceed 384px, so Radix never has to flip it
				    back to the right or slide it somewhere unpredictable. */}
				<HoverCardContent
					side="left"
					align="start"
					sideOffset={8}
					// Both axes now. Horizontal padding was excluded while the card
					// opened downwards, because the panel *is* the window's right edge
					// and pushing left put the card back outside it. Opening leftwards
					// inverts that: the padding is what keeps the card clear of the
					// window's left edge instead.
					collisionPadding={8}
					className="w-[var(--radix-hover-card-trigger-width)] min-w-72 max-w-96"
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
						<Chip key={chip.key} chip={chip} remoteHost={remoteHost} />
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
