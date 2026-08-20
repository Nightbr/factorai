import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as React from 'react';

import { cn } from '../../lib/utils';

/**
 * An on/off switch, for a preference that takes effect rather than a value you
 * submit (F11).
 *
 * **A switch, not a checkbox.** `Checkbox` answers "is this one of the things
 * selected" — a row in a list, a "select all" header — and it has an
 * indeterminate state for exactly that. This answers "is this behaviour on",
 * where there is no third state and the control should read as a physical
 * position.
 *
 * Sized to this app's rows rather than shadcn's default: `h-4 w-7` beside 14px
 * label text, where the stock `h-6 w-11` is proportioned for a 16px-body web
 * page and reads as a widget borrowed from elsewhere. Like `Checkbox` it *does*
 * paint a background — it is a control with state, not a bare affordance — and
 * like `Checkbox` it carries no `cursor-pointer`, leaving the base rule in
 * `styles/globals.css` in charge so a disabled switch correctly gets none.
 */
export const Switch = React.forwardRef<
	React.ElementRef<typeof SwitchPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
	<SwitchPrimitive.Root
		ref={ref}
		className={cn(
			'peer inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-transparent transition-colors',
			'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
			'disabled:cursor-not-allowed disabled:opacity-50',
			'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
			className,
		)}
		{...props}
	>
		<SwitchPrimitive.Thumb
			className={cn(
				'pointer-events-none block size-3 rounded-full bg-background shadow-sm transition-transform',
				'data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0.5',
			)}
		/>
	</SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;
