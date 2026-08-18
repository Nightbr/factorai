import { cn } from '@factorai/ui';
import { Fragment, useId } from 'react';
import {
	MARK_CORNER_RADIUS,
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
 */
export function BrandWordmark({ className }: { className?: string }) {
	return (
		<span className={cn('font-semibold text-sm tracking-tight', className)}>
			factor<span className="text-primary">ai</span>
		</span>
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
