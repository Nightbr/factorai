import * as React from 'react';
import { Toaster as Sonner, toast } from 'sonner';

/**
 * Where transient messages appear (ADR-0065). Mount exactly one, inside the
 * app; `toast` can then be called from anywhere, including code that is not a
 * component — which is why it is sonner rather than a Radix primitive with a
 * store of our own.
 *
 * Unstyled and dressed in the palette's tokens, so a toast is a floating
 * surface like a popover (DESIGN.md, Elevation & Depth): `popover` ground,
 * hairline border, the `-md` shadow step. The app is dark-only today, so the
 * theme is fixed rather than followed.
 */
function Toaster(props: React.ComponentProps<typeof Sonner>) {
	return (
		<Sonner
			theme="dark"
			position="bottom-right"
			toastOptions={{
				unstyled: true,
				classNames: {
					toast:
						'flex w-[356px] items-start gap-2 rounded-md border border-border bg-popover p-3 text-popover-foreground text-sm shadow-md',
					title: 'font-medium',
					// A content column that may shrink, and a description that breaks
					// anywhere: update failures carry a URL with no spaces in it.
					content: 'min-w-0 flex-1',
					description: 'mt-0.5 text-muted-foreground text-xs [overflow-wrap:anywhere]',
					icon: 'mt-0.5 shrink-0',
					error: '[&_[data-icon]]:text-destructive',
					// Sonner positions its close button absolutely even unstyled, off the
					// corner of a card we do not draw; `!` puts it back in the row.
					closeButton:
						'static! order-last size-5! shrink-0 transform-none! rounded-sm border-0! bg-transparent! text-muted-foreground opacity-70 hover:opacity-100 [&_svg]:size-3.5',
					actionButton:
						'shrink-0 rounded-sm bg-secondary px-2 py-0.5 text-secondary-foreground text-xs',
				},
			}}
			{...props}
		/>
	);
}

export { Toaster, toast };
