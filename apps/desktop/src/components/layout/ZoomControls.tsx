import { IconButton } from '@factorai/ui';
import { Minus, Plus } from 'lucide-react';
import { useEffect } from 'react';
import { isTauri } from '@lib/tauri';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, useZoomStore, zoomPercent } from '@store/zoomStore';

/**
 * Zoom controls in the sidebar footer (specs/05-features.md F15).
 *
 * Applies to the **webview**, not to CSS: the embedded terminal draws to a
 * canvas sized from its container, so webview zoom reflows it properly (the
 * container's ResizeObserver refits and the new cols/rows reach the PTY),
 * whereas a CSS transform would scale a bitmap and blur the text.
 */
export function ZoomControls() {
	const zoom = useZoomStore((s) => s.zoom);
	const zoomIn = useZoomStore((s) => s.zoomIn);
	const zoomOut = useZoomStore((s) => s.zoomOut);
	const resetZoom = useZoomStore((s) => s.resetZoom);

	// The store is the source of truth and it's persisted, so this also restores
	// the level on launch. Lazy import: browser-only dev has no webview to zoom,
	// and this keeps the API out of that bundle path.
	useEffect(() => {
		if (!isTauri()) return;
		void (async () => {
			const { getCurrentWebview } = await import('@tauri-apps/api/webview');
			await getCurrentWebview().setZoom(zoom);
		})();
	}, [zoom]);

	return (
		<div className="flex items-center gap-0.5" data-testid="zoom-controls">
			<IconButton
				aria-label="Zoom out"
				title="Zoom out"
				disabled={zoom <= MIN_ZOOM}
				onClick={zoomOut}
			>
				<Minus />
			</IconButton>
			<button
				type="button"
				// Clicking the readout resets — the affordance every browser has, and
				// it saves a third button in a 288px footer.
				title={zoom === DEFAULT_ZOOM ? 'Zoom' : 'Reset zoom to 100%'}
				aria-label="Reset zoom"
				className="min-w-9 rounded px-1 text-center tabular-nums text-muted-foreground text-xs transition-colors hover:text-foreground"
				onClick={resetZoom}
			>
				{zoomPercent(zoom)}
			</button>
			<IconButton aria-label="Zoom in" title="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={zoomIn}>
				<Plus />
			</IconButton>
		</div>
	);
}
