import { BinaryCard, Centered, errorText } from '@components/viewer/chrome';
import { IconButton } from '@factorai/ui';
import { formatBytes } from '@lib/format';
import { queryKeys } from '@lib/queryKeys';
import { cmd, copyImageToClipboard } from '@lib/tauri';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Minus, Plus } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

/**
 * Zoom bounds for an image, deliberately wider than the webview zoom in
 * `zoomStore` (0.5–2). That one rescales the whole UI and anything past 2×
 * is unusable; this one is for looking at a screenshot's pixels, where 8× is
 * the point.
 */
export const IMAGE_ZOOM_MIN = 0.25;
export const IMAGE_ZOOM_MAX = 8;
/** 1 is *fit*, not natural size — the img keeps `object-contain`, so at 1 a
 *  huge screenshot is scaled down to the pane and a favicon is left alone. */
export const IMAGE_ZOOM_FIT = 1;

/**
 * Zoom a step, multiplicatively.
 *
 * Additive steps are wrong across this range: +0.25 is a quarter of the image
 * again at 1×, and three percent of it at 8×, so the control would feel coarse
 * at the bottom and useless at the top. A constant *ratio* is a constant
 * apparent step wherever you are.
 */
export function stepImageZoom(scale: number, direction: 1 | -1): number {
	return clampImageZoom(scale * 1.25 ** direction);
}

export function clampImageZoom(scale: number): number {
	if (!Number.isFinite(scale)) return IMAGE_ZOOM_FIT;
	return Math.min(IMAGE_ZOOM_MAX, Math.max(IMAGE_ZOOM_MIN, scale));
}

export function imageZoomPercent(scale: number): string {
	return `${Math.round(scale * 100)}%`;
}

/**
 * One image, rendered, with zoom / pan / copy (F7).
 *
 * The bytes arrive base64 through `read_image` rather than over the asset
 * protocol, because that protocol wants a static path scope and the paths here
 * are "whatever project you opened". `read_file`'s validation already covers
 * this ground, so reusing the command boundary costs a 33% encoding overhead
 * and buys not having a second way into the filesystem.
 *
 * Anything the backend won't call an image — wrong magic bytes, over the size
 * limit — falls through to the same card a binary file gets, which already
 * offers the only useful action left.
 */
export function ImageView({ path }: { path: string }) {
	// Read off the decoded element rather than the file: it costs nothing and
	// avoids parsing headers for six formats in Rust to learn what the browser
	// is about to work out anyway.
	const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
	const [scale, setScale] = useState(IMAGE_ZOOM_FIT);
	const [offset, setOffset] = useState({ x: 0, y: 0 });
	const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
	const imgRef = useRef<HTMLImageElement>(null);
	// Where the pointer was when the drag started, and where the image was.
	const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

	const imageQ = useQuery({
		queryKey: queryKeys.image(path),
		queryFn: () => cmd.readImage(path),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});

	// Resetting zoom resets the pan with it. Leaving the image off in a corner
	// at 100% would be a reset that doesn't look like one.
	const reset = useCallback(() => {
		setScale(IMAGE_ZOOM_FIT);
		setOffset({ x: 0, y: 0 });
	}, []);

	const zoom = useCallback((direction: 1 | -1) => {
		setScale((s) => {
			const next = stepImageZoom(s, direction);
			// Back at fit there is nothing to pan to, so drop any offset rather
			// than stranding the image outside the pane.
			if (next <= IMAGE_ZOOM_FIT) setOffset({ x: 0, y: 0 });
			return next;
		});
	}, []);

	/**
	 * Copy via a canvas, which decodes whatever format this is into the RGBA
	 * the clipboard bridge wants — so jpeg, gif and webp behave exactly like
	 * png, and nothing has to decode images in Rust. Animation is lost, which a
	 * still copy loses anyway.
	 */
	async function copyImage() {
		const img = imgRef.current;
		if (!img) return;
		try {
			const canvas = document.createElement('canvas');
			canvas.width = img.naturalWidth;
			canvas.height = img.naturalHeight;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('no 2d context');
			ctx.drawImage(img, 0, 0);
			const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
			await copyImageToClipboard(new Uint8Array(data), canvas.width, canvas.height);
			setCopied('yes');
		} catch {
			// Say so rather than showing a tick for something that didn't happen:
			// a clipboard write can be refused by the platform, and a silent
			// failure here means pasting stale content somewhere else.
			setCopied('failed');
		}
		setTimeout(() => setCopied(null), 1400);
	}

	if (imageQ.isPending) return <Centered>Loading…</Centered>;
	if (imageQ.isError || !imageQ.data) {
		return <BinaryCard path={path} reason={errorText(imageQ.error)} />;
	}

	const image = imageQ.data;
	const pannable = scale > IMAGE_ZOOM_FIT;

	return (
		<div className="flex h-full min-h-0 flex-col">
			{/* `overflow-hidden` with a transform, not a scroll container: panning
			    is the drag below, and native scrollbars over an image would fight
			    it for the same gesture. */}
			<div
				data-testid="image-stage"
				className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/30 p-4"
				onWheel={(e) => {
					// The pane has nothing else to scroll, so the wheel is free to
					// mean zoom without a modifier.
					e.preventDefault();
					zoom(e.deltaY < 0 ? 1 : -1);
				}}
				onDoubleClick={reset}
				onPointerDown={(e) => {
					if (!pannable) return;
					drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
					// Capture so a fast drag that leaves the pane keeps panning
					// instead of sticking mid-gesture.
					e.currentTarget.setPointerCapture(e.pointerId);
				}}
				onPointerMove={(e) => {
					const d = drag.current;
					if (!d) return;
					setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
				}}
				onPointerUp={(e) => {
					drag.current = null;
					e.currentTarget.releasePointerCapture(e.pointerId);
				}}
				style={{ cursor: pannable ? (drag.current ? 'grabbing' : 'grab') : 'default' }}
			>
				{/* `contain` at scale 1 means "fit"; the transform grows from there.
				    A tiny icon is left at its own size rather than blown up. */}
				<img
					ref={imgRef}
					src={`data:${image.mime};base64,${image.base64}`}
					alt={basename(path)}
					data-testid="image-view"
					draggable={false}
					className="max-h-full max-w-full object-contain"
					style={{
						transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
						// Nothing to animate mid-drag; a transition would lag the
						// pointer by its own duration.
						transition: drag.current ? 'none' : 'transform 80ms ease-out',
					}}
					onLoad={(e) =>
						setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
					}
				/>
			</div>

			<footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 text-muted-foreground text-xs">
				<span>{image.mime}</span>
				{dims && (
					<>
						<span aria-hidden="true">·</span>
						<span>
							{dims.w} × {dims.h}
						</span>
					</>
				)}
				<span aria-hidden="true">·</span>
				<span>{formatBytes(image.size)}</span>
				<span aria-hidden="true">·</span>
				<span>read-only</span>

				<span className="flex-1" />

				<IconButton
					aria-label={copied === 'failed' ? 'Copy failed' : 'Copy image'}
					title={copied === 'failed' ? 'Copy failed' : 'Copy image to clipboard'}
					onClick={() => void copyImage()}
				>
					{copied === 'yes' ? <Check className="text-primary" /> : <Copy />}
				</IconButton>
				{copied === 'failed' && <span className="text-destructive">Copy failed</span>}

				{/* Same idiom as the sidebar's webview zoom (F15): minus, a readout
				    that resets on click, plus. One control fewer than a separate
				    reset button, and it is where the eye already is. */}
				<IconButton
					aria-label="Zoom out"
					title="Zoom out"
					disabled={scale <= IMAGE_ZOOM_MIN}
					onClick={() => zoom(-1)}
				>
					<Minus />
				</IconButton>
				<button
					type="button"
					data-testid="image-zoom-readout"
					aria-label="Reset zoom"
					title={scale === IMAGE_ZOOM_FIT ? 'Zoom' : 'Reset to fit'}
					className="min-w-10 rounded px-1 text-center tabular-nums transition-colors hover:text-foreground"
					onClick={reset}
				>
					{imageZoomPercent(scale)}
				</button>
				<IconButton
					aria-label="Zoom in"
					title="Zoom in"
					disabled={scale >= IMAGE_ZOOM_MAX}
					onClick={() => zoom(1)}
				>
					<Plus />
				</IconButton>
			</footer>
		</div>
	);
}

function basename(path: string): string {
	const i = path.lastIndexOf('/');
	return i >= 0 ? path.slice(i + 1) : path;
}
