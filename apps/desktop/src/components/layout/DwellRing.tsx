/**
 * The filling ring that shows a drag-hold is being timed (specs/05-features.md
 * F1, DESIGN.md's Dwell Rule).
 *
 * **It exists to make a timed gesture discoverable.** Holding a dragged project
 * over another one means something a pass over it does not — but a hold with no
 * feedback is a hold nobody performs, because there is no reason to keep holding.
 * The ring is what turns "nothing is happening" into "something is about to".
 *
 * An SVG arc rather than a CSS animation, and that is the point: the sweep is
 * driven by a *measured* elapsed fraction, so it cannot drift from the timer that
 * actually decides the outcome. A CSS keyframe of the same duration would be a
 * second clock telling a similar story.
 *
 * `currentColor`, so it inherits the row's text colour and needs no palette entry
 * of its own — the row is already carrying the lift's tone.
 */
export function DwellRing({ progress }: { progress: number }) {
	// 14px to sit level with the row's other glyphs (`IconButton` renders its
	// icons at that size), inside a 16px box for the stroke.
	const size = 14;
	const stroke = 1.5;
	const radius = (size - stroke) / 2;
	const circumference = 2 * Math.PI * radius;
	const clamped = Math.max(0, Math.min(1, progress));

	return (
		<svg
			width={size}
			height={size}
			viewBox={`0 0 ${size} ${size}`}
			className="shrink-0 text-muted-foreground"
			// The literal rather than the JSX shorthand: Biome's `noSvgWithoutTitle`
			// only recognises `aria-hidden="true"` written out.
			aria-hidden="true"
			data-testid="dwell-ring"
		>
			{/* The track, at the hairline's weight against the row it sits on. */}
			<circle
				cx={size / 2}
				cy={size / 2}
				r={radius}
				fill="none"
				stroke="currentColor"
				strokeWidth={stroke}
				opacity={0.25}
			/>
			<circle
				cx={size / 2}
				cy={size / 2}
				r={radius}
				fill="none"
				stroke="currentColor"
				strokeWidth={stroke}
				strokeLinecap="round"
				strokeDasharray={circumference}
				strokeDashoffset={circumference * (1 - clamped)}
				// From twelve o'clock, which is what a progress arc is read as.
				transform={`rotate(-90 ${size / 2} ${size / 2})`}
			/>
		</svg>
	);
}
