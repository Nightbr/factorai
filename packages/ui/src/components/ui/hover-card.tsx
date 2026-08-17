import * as React from 'react';
import * as HoverCardPrimitive from '@radix-ui/react-hover-card';

import { cn } from '../../lib/utils';

/**
 * A popover opened by hover (specs/05-features.md F18).
 *
 * **Why this and not the two primitives already here.** `Tooltip` is
 * `role="tooltip"`: its content is announced as a label, cannot be selected or
 * clicked, and Radix dismisses it the moment the pointer moves toward it — all
 * wrong for a card carrying a SHA you might copy. `Popover` is click-triggered,
 * and F18 wants hover. `HoverCard` is exactly this shape: hover-opened, with
 * open/close delays built in, and it does not steal focus from the terminal
 * below.
 */
const HoverCard = HoverCardPrimitive.Root;

const HoverCardTrigger = HoverCardPrimitive.Trigger;

const HoverCardContent = React.forwardRef<
	React.ElementRef<typeof HoverCardPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, ...props }, ref) => (
	<HoverCardPrimitive.Content
		ref={ref}
		align={align}
		sideOffset={sideOffset}
		className={cn(
			'z-50 w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-hover-card-content-transform-origin]',
			className,
		)}
		{...props}
	/>
));
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName;

export { HoverCard, HoverCardTrigger, HoverCardContent };
