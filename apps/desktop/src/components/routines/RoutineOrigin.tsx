import { cn } from '@factorai/ui';
import { Repeat } from 'lucide-react';

/**
 * The mark on a session a routine started (F22).
 *
 * Small and quiet, and the **same treatment in all three places** it appears —
 * the sidebar row, the project's session list, and the tab. Not the sub-agent
 * badge's labelled pill: that does not fit a 240px tab, and this needs one
 * treatment rather than two.
 *
 * The tooltip carries the routine's name, because "why is this session running
 * when I didn't start it" is the question the icon exists to answer. A name of
 * `null` means the routine has been deleted since — the session keeps its mark,
 * since it really was started by one (`ON DELETE SET NULL`, migration 0013).
 */
export function RoutineOrigin({ name, className }: { name: string | null; className?: string }) {
	const label = name
		? `Started by routine — ${name}`
		: 'Started by a routine that no longer exists';
	return (
		// The title sits on a wrapper rather than the icon, the same way the
		// sidebar's disabled buttons do it: a `title` on an `aria-hidden` SVG is
		// read by neither a screen reader nor, reliably, a tooltip.
		<span data-testid="routine-origin" title={label} aria-label={label} className="inline-flex">
			<Repeat aria-hidden className={cn('size-3 shrink-0 text-muted-foreground', className)} />
		</span>
	);
}
