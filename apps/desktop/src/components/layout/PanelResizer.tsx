import { useRef } from 'react';

/** How far one arrow-key press moves the edge. */
const KEY_STEP = 16;

/**
 * Which edge of its panel this handle sits on. That decides two things: the axis
 * it drags along, and the sign of the delta — a `left` handle belongs to a
 * right-hand panel that grows leftwards, so a negative-x delta widens it, and
 * `top` is the same story for a bottom-docked pane growing upwards.
 */
type ResizerEdge = 'left' | 'right' | 'top' | 'bottom';

interface PanelResizerProps {
	/** Current size along the axis this handle drags — width for a side panel,
	 *  height for a stacked one. */
	size: number;
	onSize: (size: number) => void;
	edge: ResizerEdge;
	label: string;
	/** Each panel has its own sensible range, so clamping is the caller's. */
	clamp: (size: number) => number;
}

/** Whether an edge drags horizontally. `top`/`bottom` handles drag vertically. */
function isHorizontal(edge: ResizerEdge): boolean {
	return edge === 'left' || edge === 'right';
}

/** Edges whose panel grows as the pointer moves *back* along the axis. */
function isInverted(edge: ResizerEdge): boolean {
	return edge === 'left' || edge === 'top';
}

/**
 * Drag handle on a panel's edge. Pointer capture means the drag keeps tracking
 * even when the cursor outruns the 4px strip, which is most of the time.
 *
 * Both axes, because F18's commit detail docks *below* the graph rather than
 * beside it. The vertical case is the same maths on `clientY`, so it is one
 * component told which axis it is on rather than a second component that would
 * drift from this one.
 */
export function PanelResizer({ size, onSize, edge, label, clamp }: PanelResizerProps) {
	const drag = useRef<{ origin: number; size: number } | null>(null);
	const horizontal = isHorizontal(edge);
	const inverted = isInverted(edge);

	return (
		<div
			role="separator"
			// A handle between side-by-side panels is a vertical separator; one
			// between stacked panes is a horizontal separator. This is the axis of
			// the *line*, not of the drag, which is why it reads inverted.
			aria-orientation={horizontal ? 'vertical' : 'horizontal'}
			aria-label={label}
			tabIndex={0}
			className={`shrink-0 bg-border transition-colors hover:bg-primary/50 focus-visible:bg-primary/50 focus-visible:outline-none ${
				horizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'
			}`}
			onPointerDown={(e) => {
				drag.current = { origin: horizontal ? e.clientX : e.clientY, size };
				e.currentTarget.setPointerCapture(e.pointerId);
			}}
			onPointerMove={(e) => {
				const start = drag.current;
				if (!start) return;
				const delta = (horizontal ? e.clientX : e.clientY) - start.origin;
				onSize(clamp(inverted ? start.size - delta : start.size + delta));
			}}
			onPointerUp={(e) => {
				drag.current = null;
				e.currentTarget.releasePointerCapture(e.pointerId);
			}}
			onPointerCancel={() => {
				drag.current = null;
			}}
			onKeyDown={(e) => {
				const [back, forward] = horizontal
					? (['ArrowLeft', 'ArrowRight'] as const)
					: (['ArrowUp', 'ArrowDown'] as const);
				const grow = inverted ? back : forward;
				const shrink = inverted ? forward : back;
				if (e.key === grow) {
					e.preventDefault();
					onSize(clamp(size + KEY_STEP));
				} else if (e.key === shrink) {
					e.preventDefault();
					onSize(clamp(size - KEY_STEP));
				}
			}}
		/>
	);
}
