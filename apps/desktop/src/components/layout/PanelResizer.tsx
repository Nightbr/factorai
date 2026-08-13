import { useRef } from 'react';
import { clampPanelWidth } from '@store/panelStore';

/** How far one arrow-key press moves the edge. */
const KEY_STEP = 16;

interface PanelResizerProps {
	width: number;
	onWidth: (width: number) => void;
}

/**
 * Drag handle on the panel's left edge. Pointer capture means the drag keeps
 * tracking even when the cursor outruns the 4px strip, which is most of the
 * time.
 *
 * The panel grows leftwards, so a negative-x delta is a wider panel.
 */
export function PanelResizer({ width, onWidth }: PanelResizerProps) {
	const drag = useRef<{ x: number; width: number } | null>(null);

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize file tree"
			tabIndex={0}
			className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/50 focus-visible:bg-primary/50 focus-visible:outline-none"
			onPointerDown={(e) => {
				drag.current = { x: e.clientX, width };
				e.currentTarget.setPointerCapture(e.pointerId);
			}}
			onPointerMove={(e) => {
				const start = drag.current;
				if (!start) return;
				onWidth(clampPanelWidth(start.width - (e.clientX - start.x)));
			}}
			onPointerUp={(e) => {
				drag.current = null;
				e.currentTarget.releasePointerCapture(e.pointerId);
			}}
			onPointerCancel={() => {
				drag.current = null;
			}}
			onKeyDown={(e) => {
				if (e.key === 'ArrowLeft') {
					e.preventDefault();
					onWidth(clampPanelWidth(width + KEY_STEP));
				} else if (e.key === 'ArrowRight') {
					e.preventDefault();
					onWidth(clampPanelWidth(width - KEY_STEP));
				}
			}}
		/>
	);
}
