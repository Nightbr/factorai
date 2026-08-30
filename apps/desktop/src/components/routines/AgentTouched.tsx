import { cn } from '@factorai/ui';
import { formatStamp } from '@lib/cron';
import { Bot } from 'lucide-react';

/**
 * The mark on a routine an agent wrote or changed (F22 slice 3, ADR-0028).
 *
 * **One mark for two facts, with the tooltip saying which.** The question it
 * answers is *has an agent touched this schedule* — which is the question that
 * matters when a routine surprises you — and authored-versus-amended is a
 * distinction most rows never carry. Two icons in a list built to be scanned
 * would cost more than the distinction is worth at 12px.
 *
 * It exists because slice 3 lets an agent write a schedule unattended. F22
 * originally recorded that slice as carrying no provenance and said, in the same
 * paragraph, that it was worth revisiting before the slice was built; this is
 * the visible half of that revision, and migration `0014` is the durable one.
 *
 * Not clickable. The tooltip carries the session id for anyone who wants to
 * search for it, and a navigation path out of a list row is more surface than
 * "who touched this" needs.
 */
export function AgentTouched({
	createdBySessionId,
	lastModifiedBySessionId,
	changedAt,
	clock24 = true,
	className,
}: {
	/** Null means a human wrote it — meaningful rather than missing, since every
	 *  row that predates the column came from the editor. */
	createdBySessionId: string | null;
	lastModifiedBySessionId: string | null;
	/** When the routine was created, for the authored case. */
	changedAt?: number | null;
	clock24?: boolean;
	className?: string;
}) {
	const authored = createdBySessionId !== null;
	const amended = lastModifiedBySessionId !== null;
	if (!authored && !amended) return null;

	const session = authored ? createdBySessionId : lastModifiedBySessionId;
	const when = authored && changedAt ? ` on ${formatStamp(new Date(changedAt), clock24)}` : '';
	// A human editing a routine an agent wrote clears `lastModifiedBySessionId`,
	// so "created by" survives as the standing fact while "last changed by" is
	// only ever the more recent one.
	const label = authored
		? `Created by an agent session${when} — ${session}`
		: `Last changed by an agent session — ${session}`;
	return (
		// The title sits on a wrapper rather than the icon, the same way
		// `RoutineOrigin` does it: a `title` on an `aria-hidden` SVG is read by
		// neither a screen reader nor, reliably, a tooltip.
		<span
			data-testid="routine-agent-touched"
			title={label}
			aria-label={label}
			className="inline-flex"
		>
			<Bot aria-hidden className={cn('size-3 shrink-0 text-muted-foreground', className)} />
		</span>
	);
}
