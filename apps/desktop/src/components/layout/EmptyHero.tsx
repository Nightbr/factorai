import type { ReactNode } from 'react';

/**
 * The centred "nothing here yet" block, one shape for the whole app.
 *
 * The house pattern is `routes/index.tsx` — the wordmark, a line of muted text,
 * centred in the pane — and it exists because an empty list rendered as one
 * grey sentence in the top-left reads as a loading state that never finished.
 * This is that block with a slot for whatever mark the surface wants and an
 * optional action, so a list can offer the thing it is empty of.
 *
 * Deliberately not `PanelEmpty`: that one is sized for the 288px side panel and
 * says so. This is for a route's full pane.
 */
export function EmptyHero({
	icon,
	title,
	description,
	action,
}: {
	/** A 24px lucide glyph, or the wordmark. Optional — the home has no icon
	 *  because the wordmark *is* the mark. */
	icon?: ReactNode;
	title: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
}) {
	return (
		<div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
			{icon && <div className="text-muted-foreground/60 [&_svg]:size-6">{icon}</div>}
			<h3 className="font-semibold text-lg">{title}</h3>
			{description && <p className="max-w-md text-muted-foreground text-sm">{description}</p>}
			{action}
		</div>
	);
}
