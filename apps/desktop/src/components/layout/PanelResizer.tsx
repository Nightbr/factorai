import { useRef } from 'react';

/** How far one arrow-key press moves the edge. */
const KEY_STEP = 16;

interface PanelResizerProps {
	width: number;
	onWidth: (width: number) => void;
	/**
	 * Which edge of its panel this handle sits on, which decides the sign of the
	 * drag: a `left` handle belongs to a right-hand panel that grows leftwards,
	 * so a negative-x delta widens it; a `right` handle is the mirror.
	 */
	edge: 'left' | 'right';
	label: string;
	/** Each panel has its own sensible range, so clamping is the caller's. */
	clamp: (width: number) => number;
}

/**
 * Drag handle on a panel's edge. Pointer capture means the drag keeps tracking
 * even when the cursor outruns the 4px strip, which is most of the time.
 */
export function PanelResizer({ width, onWidth, edge, label, clamp }: PanelResizerProps) {
	const drag = useRef<{ x: number; width: number } | null>(null);

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={label}
			tabIndex={0}
			className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/50 focus-visible:bg-primary/50 focus-visible:outline-none"
			onPointerDown={(e) => {
				drag.current = { x: e.clientX, width };
				e.currentTarget.setPointerCapture(e.pointerId);
			}}
			onPointerMove={(e) => {
				const start = drag.current;
				if (!start) return;
				const delta = e.clientX - start.x;
				onWidth(clamp(edge === 'left' ? start.width - delta : start.width + delta));
			}}
			onPointerUp={(e) => {
				drag.current = null;
				e.currentTarget.releasePointerCapture(e.pointerId);
			}}
			onPointerCancel={() => {
				drag.current = null;
			}}
			onKeyDown={(e) => {
				const grow = edge === 'left' ? 'ArrowLeft' : 'ArrowRight';
				const shrink = edge === 'left' ? 'ArrowRight' : 'ArrowLeft';
				if (e.key === grow) {
					e.preventDefault();
					onWidth(clamp(width + KEY_STEP));
				} else if (e.key === shrink) {
					e.preventDefault();
					onWidth(clamp(width - KEY_STEP));
				}
			}}
		/>
	);
}
