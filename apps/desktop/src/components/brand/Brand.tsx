import { cn } from '@factorai/ui';
import { Fragment, useId } from 'react';
import {
	MARK_CORNER_RADIUS,
	MARK_F_FILL,
	MARK_F_PATH,
	MARK_HOUSING_FILL,
	MARK_HOUSING_PATH,
	MARK_PORT_DEPTH,
	MARK_PORT_HEIGHT,
	MARK_PORT_Y,
	MARK_SIZE,
} from './geometry';

/**
 * The ports, as a mask. They cut to *transparency* — `specs/09-branding.md`
 * § B6 forbids painting anything behind them, because that silhouette is the
 * only part of the mark that survives 16px intact.
 *
 * The id has to be unique per instance or two marks on one screen collide on
 * it, and the second one renders unmasked. `useId` gives us that; its colons
 * come out because a `url(#…)` reference with them is not worth the risk.
 */
function usePortsMaskId() {
	return `factorai-ports-${useId().replace(/:/g, '')}`;
}

function Ports({ id }: { id: string }) {
	return (
		<mask id={id}>
			<rect width={MARK_SIZE} height={MARK_SIZE} rx={MARK_CORNER_RADIUS} fill="#fff" />
			<g fill="#000">
				{MARK_PORT_Y.map((y) => (
					<Fragment key={y}>
						<rect x={0} y={y} width={MARK_PORT_DEPTH} height={MARK_PORT_HEIGHT} />
						<rect
							x={MARK_SIZE - MARK_PORT_DEPTH}
							y={y}
							width={MARK_PORT_DEPTH}
							height={MARK_PORT_HEIGHT}
						/>
					</Fragment>
				))}
			</g>
		</mask>
	);
}

/**
 * The one-colour mark: notched housing filled with `currentColor`, F knocked
 * clean out of it. Colour it by setting text colour on the element or a parent.
 *
 * Decorative by default — every place we use it, the wordmark beside it already
 * says "factorai", and a screen reader announcing it twice helps nobody.
 */
function BrandMark({ className }: { className?: string }) {
	const maskId = usePortsMaskId();
	return (
		<svg
			viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`}
			className={cn('size-4.5', className)}
			aria-hidden="true"
			focusable="false"
		>
			<Ports id={maskId} />
			<path mask={`url(#${maskId})`} fill="currentColor" fillRule="evenodd" d={MARK_HOUSING_PATH} />
		</svg>
	);
}

/**
 * The wordmark. The name already carries the joke — factorio plus ai, and
 * "factor" plus "ai" — so colouring the last two letters says the AI half
 * without the mark having to spell anything out.
 *
 * One text node, split by a span: it still selects, copies and reads as
 * "factorai".
 *
 * **Bold at −0.04em, which is not the `tracking-tight` scale step.** Set
 * semibold at −0.025em this read soft beside the mark — the mark is one flat
 * amber shape with a 45° cut, and a text-weight wordmark next to it looks like
 * a caption rather than half a logo. The arbitrary tracking is deliberate and
 * is the only one in the app: −0.025em is too loose here and `tracking-tighter`
 * at −0.05em starts closing the `a` and `o` counters at 14px.
 *
 * `specs/09-branding.md` B5a carries the same numbers for the exported lockup,
 * which adds a 6% condense this does not — see there for why that correction
 * belongs to the vector and not to the UI.
 */
export function BrandWordmark({ className }: { className?: string }) {
	return (
		<span className={cn('font-bold text-sm tracking-[-0.04em]', className)}>
			factor<span className="text-primary">ai</span>
		</span>
	);
}

/**
 * The app icon: the housing in its own dark, the F in amber, the ports cut to
 * transparency. The one place in the app that paints the mark rather than
 * letting it inherit `currentColor`.
 *
 * **It exists because About asked for it** (F29, `09-branding.md` B8). An About
 * panel is where somebody looks to see *the icon their dock shows*, and the
 * one-colour cut in `text-primary` is not that icon. Nothing else should use
 * this: everywhere the mark sits in chrome it should take the colour of the text
 * around it.
 *
 * The fills come from `geometry.ts`, which `geometry.test.ts` holds against the
 * master SVG — so this cannot drift from the shipped icons without a test
 * failing.
 */
export function BrandIcon({ className }: { className?: string }) {
	const maskId = usePortsMaskId();
	return (
		<svg
			viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`}
			className={cn('size-16', className)}
			aria-hidden="true"
			focusable="false"
		>
			<Ports id={maskId} />
			{/* One group under the mask: the housing and the F are painted
			    separately here — unlike the one-colour cut, where `evenodd` makes
			    the F a hole — and both have to be notched by the same ports. */}
			<g mask={`url(#${maskId})`}>
				<rect
					width={MARK_SIZE}
					height={MARK_SIZE}
					rx={MARK_CORNER_RADIUS}
					fill={MARK_HOUSING_FILL}
				/>
				<path fill={MARK_F_FILL} d={MARK_F_PATH} />
			</g>
		</svg>
	);
}

/** Mark plus wordmark, the lockup used in the header. */
export function Brand({ className }: { className?: string }) {
	return (
		<span className={cn('flex items-center gap-2', className)}>
			<BrandMark className="text-primary" />
			<BrandWordmark />
		</span>
	);
}
