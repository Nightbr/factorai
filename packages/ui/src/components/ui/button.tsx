import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

const buttonVariants = cva(
	'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0',
	{
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground hover:bg-primary/90',
				destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
				outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
				secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
				ghost: 'hover:bg-accent hover:text-accent-foreground',
				// **The labelled sibling of `IconButton`: no background, ever.** The
				// glyph and the word take `primary` on hover — the same colour, and
				// the same rule, as every icon-only affordance in the app — and
				// nothing paints behind them. That is what a control in a chrome
				// strip has to do: a filled block there outweighs the content it
				// sits beside.
				//
				// `ghost` is not this: it paints `bg-accent` on hover, which in a
				// dense row reads as a widget. Same argument `IconButton` carries,
				// and the same trap: **never add a `hover:bg-*` to this variant**, or
				// every quiet control in the app gains a block at once.
				quiet: 'text-muted-foreground hover:text-primary',
				link: 'text-primary underline-offset-4 hover:underline',
			},
			// A desktop scale, not shadcn's stock web one. The numbers are taken
			// from what this app's dense surfaces were already overriding to by
			// hand — `sm` is h-7 because `routes/session.tsx` set exactly that,
			// and the base icon is 3.5 because every call site passed `size-3.5`.
			// Six inline overrides fighting one default was the diagnosis; if you
			// find yourself adding a seventh, the scale is wrong again, not the
			// call site. See specs/roadmap/DONE.md.
			size: {
				default: 'h-8 px-3 py-1.5',
				sm: 'h-7 rounded-md px-2.5',
				lg: 'h-9 rounded-md px-5',
				icon: 'h-8 w-8',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : 'button';
		return (
			<Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
		);
	},
);
Button.displayName = 'Button';

export { Button, buttonVariants };
