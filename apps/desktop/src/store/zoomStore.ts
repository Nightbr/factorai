import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Below this the UI is unreadable; above it a 1400px window fits almost
 *  nothing. Matches the range browsers offer for the same reason. */
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 0.1;
export const DEFAULT_ZOOM = 1;

/** Clamp and round to one decimal.
 *
 *  The rounding is not cosmetic: repeated `0.1` additions drift into
 *  `0.7000000000000001`, which then renders as "70.00000000000001%".
 *  Pure so the arithmetic is testable without a webview. */
export function clampZoom(zoom: number): number {
	if (!Number.isFinite(zoom)) return DEFAULT_ZOOM;
	return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 10) / 10;
}

export function zoomPercent(zoom: number): string {
	return `${Math.round(zoom * 100)}%`;
}

interface ZoomState {
	zoom: number;
	zoomIn: () => void;
	zoomOut: () => void;
	resetZoom: () => void;
	setZoom: (zoom: number) => void;
}

/**
 * App zoom level (specs/05-features.md F15).
 *
 * Persisted, and applied to the **webview** rather than to CSS: the embedded
 * terminal is a canvas that sizes itself from its container, so scaling the
 * webview reflows it (its ResizeObserver refits and pushes the new cols/rows to
 * the PTY) while a CSS transform would just blur it.
 */
export const useZoomStore = create<ZoomState>()(
	persist(
		(set) => ({
			zoom: DEFAULT_ZOOM,
			zoomIn: () => set((s) => ({ zoom: clampZoom(s.zoom + ZOOM_STEP) })),
			zoomOut: () => set((s) => ({ zoom: clampZoom(s.zoom - ZOOM_STEP) })),
			resetZoom: () => set({ zoom: DEFAULT_ZOOM }),
			setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
		}),
		{ name: 'factorai.zoom', version: 1 },
	),
);
