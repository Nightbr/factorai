import { IconButton, Input } from '@factorai/ui';
import { CaseSensitive, ChevronDown, ChevronUp, Regex, WholeWord, X } from 'lucide-react';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
	findMatches,
	matchLabel,
	type SearchOptions,
	stepIndex,
} from '@components/viewer/textSearch';

/**
 * Find over a rendered document — the markdown preview (F7 § "Find").
 *
 * **Monaco's widget is the reference, and this is deliberately its twin.** Same
 * corner, same height, same order of controls, same `1 of 9`, same `Enter` /
 * `Shift+Enter` / `Escape`. A reader toggling between source and preview should
 * not be able to tell that one of the two find bars is ours — which is why this
 * takes Monaco's 24px field rather than the app's 32px one. `DESIGN.md`
 * § Inputs carries that exception; The Shrink-The-Padding Rule is why the box
 * gets smaller and the 14px text does not.
 *
 * **The SVG preview does not get one.** It is an `<img>` of a data URI — there
 * is no text in it to find. Neither does an image or a PDF; the PDF's own find
 * bar is roadmap item 23, and it matches this.
 */

/** The two highlight registrations. Named rather than inline so the cleanup
 *  below and the CSS in `styles/globals.css` cannot drift apart. */
const HL_ALL = 'factorai-find';
const HL_CURRENT = 'factorai-find-current';

/**
 * Every text node under `root`, with the offset each one starts at in the
 * concatenated text.
 *
 * A `TreeWalker` rather than `textContent` plus a second pass: the offsets have
 * to line up with the nodes a `Range` is built from, and `textContent` throws
 * away exactly the information that makes that possible.
 */
function textIndex(root: Node): { text: string; nodes: Text[]; starts: number[] } {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	const starts: number[] = [];
	let text = '';
	let node = walker.nextNode();
	while (node !== null) {
		const value = node.nodeValue ?? '';
		if (value !== '') {
			nodes.push(node as Text);
			starts.push(text.length);
			text += value;
		}
		node = walker.nextNode();
	}
	return { text, nodes, starts };
}

/** The node holding character `offset`, and how far into it that is. */
function locate(
	nodes: Text[],
	starts: number[],
	offset: number,
): { node: Text; offset: number } | null {
	// Backwards, so the first node whose start is at or before the offset is the
	// one holding it. Linear is fine: this runs once per match per query, over a
	// document a person is reading rather than a repository.
	for (let i = nodes.length - 1; i >= 0; i -= 1) {
		if (starts[i] <= offset) {
			const node = nodes[i];
			return { node, offset: Math.min(offset - starts[i], node.length) };
		}
	}
	return null;
}

interface FindBarProps {
	/** The element whose text is searched, and which the bar floats over. */
	root: RefObject<HTMLElement | null>;
	/** Changes when the rendered content does, so the matches are recomputed
	 *  against the document that is actually on screen. */
	contentKey: string;
	onClose: () => void;
}

export function FindBar({ root, contentKey, onClose }: FindBarProps) {
	const [query, setQuery] = useState('');
	const [options, setOptions] = useState<SearchOptions>({
		matchCase: false,
		wholeWord: false,
		isRegex: false,
	});
	const [index, setIndex] = useState(0);
	const [total, setTotal] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	// Focus on open, and select what is there: a reader pressing the key again
	// means "search for something else", which is what Monaco does too.
	useEffect(() => {
		inputRef.current?.select();
	}, []);

	/** Recompute, repaint, and scroll the current match into view. */
	const run = useCallback(
		(nextIndex: number) => {
			const host = root.current;
			if (!host) return;

			const { text, nodes, starts } = textIndex(host);
			const matches = findMatches(text, query, options);
			const at = stepIndex(nextIndex, matches.length, 0);
			setTotal(matches.length);
			setIndex(at);

			const ranges: Range[] = [];
			for (const match of matches) {
				const from = locate(nodes, starts, match.start);
				const to = locate(nodes, starts, match.end);
				if (!from || !to) continue;
				const range = document.createRange();
				range.setStart(from.node, from.offset);
				range.setEnd(to.node, to.offset);
				ranges.push(range);
			}

			// **The CSS Custom Highlight API, not `<mark>` wrappers.** The document
			// under this belongs to `react-markdown`, and wrapping its text nodes
			// would be an edit React undoes on its next render — silently, and only
			// sometimes. A highlight is a set of `Range`s held beside the DOM:
			// nothing in the tree changes, so nothing can be clobbered, and
			// clearing it is one `delete`. Guarded because the paint is the one
			// part of find a webview without the API simply does without — the
			// count, the stepping and the scroll all still work.
			const current = ranges[at];
			const registry = CSS.highlights;
			if (registry) {
				// Two registrations, not one: the current match carries the accent at
				// full strength and the rest carry the same hue at a tint, which is
				// the pair of colours the editor's widget uses.
				registry.set(HL_ALL, new Highlight(...ranges.filter((r) => r !== current)));
				registry.set(HL_CURRENT, new Highlight(...(current ? [current] : [])));
			}

			// `scrollIntoView` on the element, not the range: a `Range` has no
			// method for it, and the element's own scroll parent is the one that
			// has to move — which is the preview's container, whoever that is.
			current?.startContainer.parentElement?.scrollIntoView({
				block: 'center',
				inline: 'nearest',
			});
		},
		[options, query, root],
	);

	// A new query or a new toggle: the match list is stale and the reader starts
	// from the first hit.
	useEffect(() => {
		run(0);
	}, [run]);

	// **The document re-rendered under us**, which the ranges cannot survive:
	// they point at text nodes `react-markdown` has replaced. Through a ref, and
	// skipping the mount, because `run` changing is the effect above's job and
	// depending on both here would recompute twice per keystroke.
	const runRef = useRef(run);
	runRef.current = run;
	const searchedContent = useRef(contentKey);
	useEffect(() => {
		if (searchedContent.current === contentKey) return;
		searchedContent.current = contentKey;
		runRef.current(0);
	}, [contentKey]);

	// Clear the paint on the way out — a highlight outlives the component that
	// registered it, so leaving it set would tint a document with no find bar.
	useEffect(() => {
		return () => {
			CSS.highlights?.delete(HL_ALL);
			CSS.highlights?.delete(HL_CURRENT);
		};
	}, []);

	function toggle(key: keyof SearchOptions) {
		setOptions((o) => ({ ...o, [key]: !o[key] }));
	}

	return (
		<div
			data-testid="preview-find"
			// Monaco's corner and Monaco's geometry: 34px tall, hanging off the top
			// edge with the radius on the bottom two corners only, so it reads as
			// something that came down out of the chrome rather than as a card that
			// happens to be up there.
			className="absolute top-0 right-4 z-10 flex h-8.5 items-center gap-1 rounded-b-md border border-border border-t-0 bg-card px-1.5 shadow-md"
			onKeyDown={(event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					onClose();
					return;
				}
				if (event.key === 'Enter') {
					event.preventDefault();
					run(stepIndex(index, total, event.shiftKey ? -1 : 1));
				}
			}}
		>
			<Input
				ref={inputRef}
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="Find"
				aria-label="Find in preview"
				data-testid="preview-find-input"
				// Denser box, same 14px text — The Shrink-The-Padding Rule.
				className="h-6 w-44 px-2 py-0"
			/>
			<IconButton
				aria-label="Match case"
				title="Match case"
				aria-pressed={options.matchCase}
				className={options.matchCase ? 'text-primary' : undefined}
				onClick={() => toggle('matchCase')}
			>
				<CaseSensitive />
			</IconButton>
			<IconButton
				aria-label="Whole word"
				title="Whole word"
				aria-pressed={options.wholeWord}
				className={options.wholeWord ? 'text-primary' : undefined}
				onClick={() => toggle('wholeWord')}
			>
				<WholeWord />
			</IconButton>
			<IconButton
				aria-label="Regular expression"
				title="Regular expression"
				aria-pressed={options.isRegex}
				className={options.isRegex ? 'text-primary' : undefined}
				onClick={() => toggle('isRegex')}
			>
				<Regex />
			</IconButton>
			{/* Tabular, and a fixed width: `1 of 9` becoming `10 of 90` must not
			    shove the buttons beside it sideways mid-search. */}
			<span
				data-testid="preview-find-count"
				className={`w-20 shrink-0 px-1 text-center text-xs tabular-nums ${
					query !== '' && total === 0 ? 'text-destructive' : 'text-muted-foreground'
				}`}
			>
				{matchLabel(index, total)}
			</span>
			<IconButton
				aria-label="Previous match"
				title="Previous match"
				disabled={total === 0}
				onClick={() => run(stepIndex(index, total, -1))}
			>
				<ChevronUp />
			</IconButton>
			<IconButton
				aria-label="Next match"
				title="Next match"
				disabled={total === 0}
				onClick={() => run(stepIndex(index, total, 1))}
			>
				<ChevronDown />
			</IconButton>
			<IconButton aria-label="Close find" title="Close find" onClick={onClose}>
				<X />
			</IconButton>
		</div>
	);
}
