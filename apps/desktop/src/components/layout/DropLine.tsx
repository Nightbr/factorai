import type { DropIndicator } from '@lib/sidebarTree';

/**
 * The line that says where a drop will land (DESIGN.md's Drop-Target Rule).
 *
 * **This is what replaced displacement.** The sidebar used to open a gap by
 * translating every other row, which cannot work over a nested list of
 * variable-height rows — and which moved the row you were trying to hold still
 * over to make a group. Nothing moves now; this says the same thing in 2px.
 *
 * Accent rather than the hairline: unlike a group's boundary or a lifted row's
 * ring, this mark exists for one moment and has to be found instantly. Absolutely
 * positioned so it costs the row no height — a 2px line that pushed the list
 * around would be displacement again, in miniature.
 */
export function DropLine({ indicator }: { indicator: DropIndicator }) {
	if (!indicator || indicator.kind !== 'edge') return null;

	return (
		<span
			aria-hidden="true"
			data-testid={`drop-line-${indicator.edge}`}
			className={`pointer-events-none absolute inset-x-0 h-0.5 bg-primary ${
				indicator.edge === 'above' ? '-top-px' : '-bottom-px'
			}`}
		/>
	);
}
