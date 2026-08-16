import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import * as React from 'react';

import { cn } from '../../lib/utils';

/**
 * A checkbox, including the indeterminate state a "select all" header needs.
 *
 * Radix models `checked` as `boolean | 'indeterminate'`, and the mark switches
 * with it: a tick for checked, a dash for partially checked. A "select all"
 * that shows an empty box while two of fourteen rows are selected is telling
 * the reader something false about what clicking will do.
 *
 * Unlike `IconButton` this one *does* paint a background when checked — it is a
 * control with state, not a bare affordance, and the filled box is how a
 * checkbox has always said "on". The base rule in `styles/globals.css` handles
 * the cursor, so there is no `cursor-pointer` class here and a disabled row
 * correctly gets none.
 */
export const Checkbox = React.forwardRef<
	React.ElementRef<typeof CheckboxPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
	<CheckboxPrimitive.Root
		ref={ref}
		className={cn(
			'peer size-4 shrink-0 rounded-sm border border-input ring-offset-background transition-colors',
			'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1',
			'disabled:cursor-not-allowed disabled:opacity-50',
			'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
			'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground',
			className,
		)}
		{...props}
	>
		<CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
			{props.checked === 'indeterminate' ? (
				<Minus className="size-3" strokeWidth={3} />
			) : (
				<Check className="size-3" strokeWidth={3} />
			)}
		</CheckboxPrimitive.Indicator>
	</CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
