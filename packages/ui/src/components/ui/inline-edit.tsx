import * as React from 'react';

import { cn } from '../../lib/utils';

interface InlineEditProps {
	/** The name as it stands. Also what Escape restores, and what a blur with an
	 *  empty field falls back to. */
	value: string;
	/** Called with the trimmed value on Enter or on blur, and only when it
	 *  actually changed — so committing an unmodified name costs no write. */
	onCommit: (value: string) => void;
	/** Called on Escape, and after a commit. The caller closes the editor here;
	 *  this component owns no open/closed state of its own. */
	onCancel: () => void;
	placeholder?: string;
	'aria-label'?: string;
	className?: string;
	'data-testid'?: string;
}

/**
 * Rename something in place: a text field that looks like the label it replaces.
 *
 * **Not a dialog.** The one caller today is a sidebar group's name, and the group
 * is created by a *gesture* — dragging one project onto another. Interrupting
 * that with a modal, whose Cancel then has to decide whether the group survives,
 * is a worse answer than editing the row you just made. The group exists either
 * way, so an abandoned rename cannot lose the grouping.
 *
 * **The text is selected on mount**, because every use of this so far is "here is
 * a default, replace it" rather than "here is your text, amend it". Typing
 * replaces; a click places the caret if you would rather edit.
 *
 * **Three exits, and they mean different things.** Enter commits. Escape restores
 * the previous value. Blur commits too — losing focus while renaming is almost
 * always "I am done", and treating it as a cancel silently discards typing the
 * user watched themselves do. That is the opposite of the file tree's rule for a
 * *destructive* confirm, and deliberately so: this one is reversible by renaming
 * again.
 *
 * Built on the same `input` styling as `Input` but stripped of its border and
 * background: it stands in for a label inside a dense row, so chrome around it
 * would make the row jump by the border's width the moment editing began.
 */
const InlineEdit = React.forwardRef<HTMLInputElement, InlineEditProps>(
	(
		{
			value,
			onCommit,
			onCancel,
			placeholder,
			className,
			'aria-label': ariaLabel,
			'data-testid': testId,
		},
		ref,
	) => {
		const [draft, setDraft] = React.useState(value);
		// Guards the blur handler against firing after Enter or Escape has already
		// resolved this edit — both of those blur the field on their way out, and
		// without the guard a commit would be followed by a second one.
		const settled = React.useRef(false);

		const commit = React.useCallback(() => {
			if (settled.current) return;
			settled.current = true;
			const next = draft.trim();
			// An empty field is not a name. Falling back to the previous value rather
			// than erroring keeps the exit paths simple: there is no state where the
			// editor refuses to close.
			if (next && next !== value) onCommit(next);
			onCancel();
		}, [draft, onCancel, onCommit, value]);

		const cancel = React.useCallback(() => {
			if (settled.current) return;
			settled.current = true;
			onCancel();
		}, [onCancel]);

		// **Focus and select on mount, then once more on the next frame.** Two
		// awkward details are behind this, both learnt the hard way:
		//
		// - It cannot live in the `ref` callback. An inline callback is a new
		//   function every render, so React detaches and reattaches it each time —
		//   re-running `select()` right before every keystroke, which replaces the
		//   whole draft with the character just typed. Typing "Pro" left "o".
		// - One focus on mount is not enough when a **menu** opened this editor. A
		//   Radix menu tears its focus scope down *after* the item's `onSelect` has
		//   mounted us, so it moves focus away again — to the trigger, or to the
		//   body when `onCloseAutoFocus` is prevented. Measured: `activeElement` was
		//   `BODY` and every keystroke went nowhere. The second pass runs after that
		//   teardown and is a no-op in every other case.
		const input = React.useRef<HTMLInputElement | null>(null);
		const setRef = React.useCallback(
			(node: HTMLInputElement | null) => {
				input.current = node;
				if (typeof ref === 'function') ref(node);
				else if (ref) ref.current = node;
			},
			[ref],
		);
		React.useEffect(() => {
			const take = () => {
				input.current?.focus();
				input.current?.select();
			};
			take();
			const frame = requestAnimationFrame(take);
			return () => cancelAnimationFrame(frame);
		}, []);

		return (
			<input
				ref={setRef}
				value={draft}
				aria-label={ariaLabel}
				data-testid={testId}
				placeholder={placeholder}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						commit();
						return;
					}
					if (e.key === 'Escape') {
						e.preventDefault();
						cancel();
						return;
					}
					// **Every other key stops here.** The row this sits in is a drag
					// handle with `Alt`+arrow shortcuts, and its ancestors carry menu and
					// navigation keys — so without this, typing a name would also be
					// reordering the sidebar.
					e.stopPropagation();
				}}
				// A click in the field must not reach the row behind it, which would
				// expand the group or start a drag.
				onClick={(e) => e.stopPropagation()}
				onPointerDown={(e) => e.stopPropagation()}
				className={cn(
					'min-w-0 flex-1 bg-transparent text-foreground outline-none focus-visible:outline-none',
					className,
				)}
			/>
		);
	},
);
InlineEdit.displayName = 'InlineEdit';

export { InlineEdit };
