import type * as React from 'react';

import { cn } from '../../lib/utils';

interface SettingRowProps {
	/** What the preference is called. `text-sm`, because it is a thing you read
	 *  to navigate the page. */
	label: string;
	/** What turning it on does, or the caveat that keeps the control honest.
	 *  Optional, but a switch whose label needs a sentence to be unambiguous
	 *  should have one rather than a longer label. */
	description?: React.ReactNode;
	/** The control: a `Switch`, a `Select`, an `Input`. Laid out at the right for
	 *  a compact one and beneath the text for a wide one — see `stacked`. */
	children: React.ReactNode;
	/** Put the control under the text rather than beside it. For an `Input`,
	 *  which needs the width, and for anything carrying validation feedback of
	 *  its own. */
	stacked?: boolean;
	/** Associates the label with the control. Pass the control's `id` and it
	 *  becomes a real `<label for>`, so clicking the words works. */
	htmlFor?: string;
	className?: string;
}

/**
 * One preference: label, description, control (F11).
 *
 * **Built once, deliberately.** F11 exists because three features in a row
 * arrived needing somewhere to put a preference and found nowhere; a settings
 * page whose every row invents its own two-column layout would recreate that
 * problem one level down. Every row in the modal is this component, so a fourth
 * preference is a `SettingRow` and not a layout decision.
 *
 * The label is `text-sm` and the description `text-xs`: the app has two type
 * sizes, and this is exactly the distinction between them — a thing you read to
 * navigate versus the metadata under it.
 */
export function SettingRow({
	label,
	description,
	children,
	stacked = false,
	htmlFor,
	className,
}: SettingRowProps) {
	const text = (
		<div className="min-w-0 space-y-0.5">
			{/* A real `<label>` when it has something to point at, so the words are
			    part of the click target; a plain span otherwise, since a label for
			    nothing is a lie to a screen reader. */}
			{htmlFor ? (
				<label htmlFor={htmlFor} className="block text-sm">
					{label}
				</label>
			) : (
				<span className="block text-sm">{label}</span>
			)}
			{description && <p className="text-muted-foreground text-xs">{description}</p>}
		</div>
	);

	if (stacked) {
		return (
			<div className={cn('space-y-2 py-2.5', className)}>
				{text}
				{children}
			</div>
		);
	}

	return (
		<div className={cn('flex items-start justify-between gap-6 py-2.5', className)}>
			{text}
			{/* `pt-0.5` optically centres a 16px control against the first line of a
			    14px label rather than against the whole block, which drifts down as
			    soon as a description wraps. */}
			<div className="shrink-0 pt-0.5">{children}</div>
		</div>
	);
}
