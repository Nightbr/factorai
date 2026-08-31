import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../../lib/utils';

/**
 * A bare icon affordance: no background in any state, the icon itself takes
 * colour on hover.
 *
 * `Button variant="ghost" size="icon"` paints a filled `bg-accent` block behind
 * the glyph on hover, which in a dense row reads as a widget rather than as an
 * affordance — and at 14px the block is bigger than the thing it highlights.
 * This is the house style for icon-only controls; see `DESIGN.md` and the
 * `frontend-conventions` skill.
 *
 * Not a variant of `Button`: every `Button` variant carries a background, and a
 * "ghost-with-no-hover-background" variant would be a trap — the next person
 * adds `hover:bg-*` to it and every icon in the app gains a block again.
 *
 * No `cursor-pointer` here on purpose: the base rule in `styles/globals.css`
 * grants it to every enabled control and withholds it from disabled ones. A
 * utility class on the element would override that and put a pointer on an
 * inert button.
 */
const iconButtonVariants = cva(
	'inline-flex shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:text-muted-foreground/30 [&_svg]:pointer-events-none [&_svg]:shrink-0',
	{
		variants: {
			size: {
				// Dense rows: sidebar affordances, panel headers.
				sm: 'p-0.5 [&_svg]:size-3.5',
				md: 'p-1 [&_svg]:size-4',
			},
		},
		defaultVariants: { size: 'sm' },
	},
);

export interface IconButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof iconButtonVariants> {
	asChild?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
	({ className, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : 'button';
		return <Comp className={cn(iconButtonVariants({ size }), className)} ref={ref} {...props} />;
	},
);
IconButton.displayName = 'IconButton';

export { iconButtonVariants };
