import { BinaryCard, Centered, errorText } from '@components/viewer/chrome';
import '@components/viewer/pdfTextLayer.css';
import {
	type PdfDocument,
	type PdfPage,
	bytesFromBase64,
	isPasswordError,
	isWrongPassword,
	openPdf,
} from '@components/viewer/pdfjs';
import {
	PDF_ZOOM_DEFAULT,
	PDF_ZOOM_MAX,
	PDF_ZOOM_MIN,
	currentPage,
	pdfZoomPercent,
	stepPdfZoom,
} from '@components/viewer/pdfZoom';
import { Button, IconButton, Input } from '@factorai/ui';
import { formatBytes } from '@lib/format';
import { queryKeys } from '@lib/queryKeys';
import { cmd } from '@lib/tauri';
import { REREAD_ON_OPEN } from '@lib/viewerQuery';
import { useQuery } from '@tanstack/react-query';
import { Lock, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One PDF, rendered (specs/05-features.md F7, ADR-0018).
 *
 * The bytes arrive base64 through `read_pdf` for the reason `ImageView` gives
 * for `read_image`: the asset protocol wants a static path scope and these
 * paths are "whatever project you opened".
 *
 * pdf.js does the parsing, in a worker, and we own the canvas: pages are
 * measured up front so the scroll container reserves the right space, and only
 * the pages near the viewport hold a raster. That is the whole reason this isn't
 * `ImageView` with a page number — a 400-page document must cost what a 4-page
 * one does.
 */

/** How far either side of the viewport a page is kept rendered. One page: enough
 *  that a normal scroll never shows an empty box, few enough that memory is
 *  bounded by the pane rather than the document. */
const RENDER_MARGIN_PAGES = 1;

/** Space around and between pages, in CSS px at scale 1. */
const PAGE_GAP = 16;

interface Measured {
	/** 1-based, as pdf.js numbers pages. */
	number: number;
	/** Size at scale 1, in CSS px. */
	width: number;
	height: number;
}

export function PdfView({ path }: { path: string }) {
	const pdfQ = useQuery({
		queryKey: queryKeys.pdf(path),
		queryFn: () => cmd.readPdf(path),
		// A file open in the viewer is a snapshot, like every other read here —
		// and reopening it re-reads, like every other read here.
		...REREAD_ON_OPEN,
		retry: false,
	});

	if (pdfQ.isPending) return <Centered>Loading…</Centered>;
	// A refusal from the backend — not a PDF, or over the 32MB cap — is the
	// binary card's case, and its message already says which.
	if (pdfQ.isError || !pdfQ.data) return <BinaryCard path={path} reason={errorText(pdfQ.error)} />;

	// Keyed by path so switching files inside the viewer starts a clean document
	// rather than carrying the previous one's password and zoom across.
	return <PdfDocumentView key={path} path={path} base64={pdfQ.data.base64} size={pdfQ.data.size} />;
}

function PdfDocumentView({
	path,
	base64,
	size,
}: {
	path: string;
	base64: string;
	size: number;
}) {
	const [doc, setDoc] = useState<PdfDocument | null>(null);
	const [pages, setPages] = useState<Measured[]>([]);
	const [failure, setFailure] = useState<string | null>(null);
	/** Set once pdf.js says the document is encrypted; drives the unlock form. */
	const [locked, setLocked] = useState<'yes' | 'wrong' | null>(null);
	const [password, setPassword] = useState('');
	/** The password actually being tried, so typing doesn't reopen per keystroke. */
	const [attempt, setAttempt] = useState<string | undefined>(undefined);

	const [zoom, setZoom] = useState(PDF_ZOOM_DEFAULT);
	const [page, setPage] = useState(1);
	const stageRef = useRef<HTMLDivElement>(null);

	// Open, or reopen with a password. `attempt` is the only trigger: the bytes
	// don't change and the password is committed by the form, not by typing.
	//
	// Teardown destroys the *loading task*, which stops the worker — the document
	// proxy's `cleanup()` only frees rasters. React unmounting this component
	// releases neither on its own, and a leaked worker per file opened is the
	// kind of thing that shows up as the app being slow an hour later.
	useEffect(() => {
		let cancelled = false;
		setFailure(null);

		const task = openPdf(bytesFromBase64(base64), attempt);

		task.promise
			.then(async (opened) => {
				if (cancelled) return;
				// Measured in one pass at scale 1, so every box can be reserved
				// before anything rasterises and the scrollbar is honest from the
				// first paint.
				const measured: Measured[] = [];
				for (let n = 1; n <= opened.numPages; n++) {
					const p = await opened.getPage(n);
					const { width, height } = p.getViewport({ scale: 1 });
					measured.push({ number: n, width, height });
				}
				if (cancelled) return;
				setLocked(null);
				setDoc(opened);
				setPages(measured);
			})
			.catch((e: unknown) => {
				if (cancelled) return;
				if (isPasswordError(e)) {
					setLocked(isWrongPassword(e) ? 'wrong' : 'yes');
					return;
				}
				setFailure(errorText(e));
			});

		return () => {
			cancelled = true;
			setDoc(null);
			void task.destroy();
		};
	}, [base64, attempt]);

	// The scale is a plain number, from `PDF_ZOOM_DEFAULT` — the page at its
	// authored size, in whatever pane it happens to be shown in.
	const scale = zoom;

	const stepZoom = useCallback(
		(direction: 1 | -1) => setZoom((z) => stepPdfZoom(z, direction)),
		[],
	);

	// Cmd/Ctrl+wheel zooms; a bare wheel scrolls the document, which is the
	// deliberate difference from `ImageView` — that pane has nothing to scroll.
	const onWheel = useCallback(
		(e: React.WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			stepZoom(e.deltaY < 0 ? 1 : -1);
		},
		[stepZoom],
	);

	if (failure) return <BinaryCard path={path} reason={failure} />;
	if (locked) {
		return (
			<Unlock
				wrong={locked === 'wrong'}
				password={password}
				onPassword={setPassword}
				onSubmit={() => setAttempt(password)}
			/>
		);
	}
	if (!doc) return <Centered>Reading document…</Centered>;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				ref={stageRef}
				data-testid="pdf-stage"
				// `tabIndex` so PageUp/PageDown/Home/End reach the container: a div
				// that scrolls is not focusable by default, and a reader who clicks
				// the page then presses PageDown expects it to move.
				tabIndex={-1}
				className="min-h-0 flex-1 overflow-auto bg-muted/30 px-4 py-4 outline-none"
				onWheel={onWheel}
				onScroll={(e) => setPage(currentPage(pageTops(pages, scale), e.currentTarget.scrollTop))}
			>
				<div className="mx-auto flex w-fit flex-col items-center" style={{ gap: PAGE_GAP }}>
					{pages.map((p) => (
						<Page
							key={p.number}
							doc={doc}
							measured={p}
							scale={scale}
							// Rendered only near the viewport. Everything outside keeps its
							// reserved box, so scrolling never reflows.
							active={Math.abs(p.number - page) <= RENDER_MARGIN_PAGES}
						/>
					))}
				</div>
			</div>

			<footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 text-muted-foreground text-xs">
				<span data-testid="pdf-page-counter" className="tabular-nums">
					{page} / {pages.length}
				</span>
				<span aria-hidden="true">·</span>
				<span>{formatBytes(size)}</span>
				<span aria-hidden="true">·</span>
				<span>read-only</span>

				<span className="flex-1" />

				{/* The same minus / readout / plus idiom as ImageView and the
				    sidebar's webview zoom (F15). */}
				<IconButton
					aria-label="Zoom out"
					title="Zoom out"
					disabled={scale <= PDF_ZOOM_MIN}
					onClick={() => stepZoom(-1)}
				>
					<Minus />
				</IconButton>
				<button
					type="button"
					data-testid="pdf-zoom-readout"
					aria-label="Reset zoom"
					title={scale === PDF_ZOOM_DEFAULT ? 'Zoom' : 'Reset to 100%'}
					className="min-w-10 rounded px-1 text-center tabular-nums transition-colors hover:text-foreground"
					onClick={() => setZoom(PDF_ZOOM_DEFAULT)}
				>
					{pdfZoomPercent(scale)}
				</button>
				<IconButton
					aria-label="Zoom in"
					title="Zoom in"
					disabled={scale >= PDF_ZOOM_MAX}
					onClick={() => stepZoom(1)}
				>
					<Plus />
				</IconButton>
			</footer>
		</div>
	);
}

/** Where each page starts inside the scroll container, for the page counter. */
function pageTops(pages: Measured[], scale: number): number[] {
	let top = 0;
	return pages.map((p) => {
		const at = top;
		top += p.height * scale + PAGE_GAP;
		return at;
	});
}

/**
 * One page: a reserved box that fills with a raster when it comes near.
 *
 * The box is sized from the measurement, not from the canvas, so it holds its
 * space whether or not anything is drawn in it — that is what keeps scrolling a
 * 400-page document from reflowing under the reader.
 */
function Page({
	doc,
	measured,
	scale,
	active,
}: {
	doc: PdfDocument;
	measured: Measured;
	scale: number;
	active: boolean;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const textRef = useRef<HTMLDivElement>(null);
	const [drawn, setDrawn] = useState(false);

	const width = Math.round(measured.width * scale);
	const height = Math.round(measured.height * scale);

	useEffect(() => {
		if (!active) {
			// Let the raster go. A canvas of a page nobody is looking at is the
			// single biggest allocation in this view.
			setDrawn(false);
			return;
		}
		let cancelled = false;
		let task: { cancel: () => void } | null = null;

		void (async () => {
			const page: PdfPage = await doc.getPage(measured.number);
			const canvas = canvasRef.current;
			if (cancelled || !canvas) return;

			// Rendered at devicePixelRatio *inside* the zoom, so a page is crisp on
			// a retina panel rather than a scaled-up 1× raster.
			const dpr = window.devicePixelRatio || 1;
			const viewport = page.getViewport({ scale: scale * dpr });
			canvas.width = Math.round(viewport.width);
			canvas.height = Math.round(viewport.height);

			const context = canvas.getContext('2d');
			if (!context) return;
			const render = page.render({ canvas, canvasContext: context, viewport });
			task = render;
			try {
				await render.promise;
			} catch {
				// A cancelled render is the normal case when zoom changes mid-draw;
				// pdf.js rejects it and there is nothing to report.
				return;
			}
			if (cancelled) return;
			setDrawn(true);

			// The text layer is built at the same scale, over the raster. It is what
			// makes the page selectable — see pdfTextLayer.css for why its rules are
			// upstream's rather than ours.
			const host = textRef.current;
			if (!host) return;
			host.replaceChildren();
			const textLayer = new (await import('pdfjs-dist')).TextLayer({
				textContentSource: page.streamTextContent(),
				container: host,
				viewport: page.getViewport({ scale }),
			});
			await textLayer.render();
		})();

		return () => {
			cancelled = true;
			task?.cancel();
		};
	}, [doc, measured.number, scale, active]);

	return (
		<div
			data-testid="pdf-page"
			data-page={measured.number}
			// A white sheet on the dim stage, with a border so it reads as paper.
			// The document is *not* recoloured for the dark theme: a PDF is a
			// fixed-layout artefact, and inverting it would turn every photograph
			// and chart in it into a negative.
			className="relative shrink-0 border border-border bg-white shadow-sm"
			style={{
				width,
				height,
				// What pdfTextLayer.css positions its spans against. Upstream derives
				// this on `.pdfViewer .page`, a class we don't use.
				['--total-scale-factor' as string]: scale,
				['--scale-factor' as string]: scale,
			}}
		>
			<canvas
				ref={canvasRef}
				// The canvas backing store is DPR-scaled; CSS pins it back to the
				// page's own size so a retina raster doesn't draw twice as large.
				style={{ width, height, opacity: drawn ? 1 : 0 }}
				className="block transition-opacity duration-100"
			/>
			<div ref={textRef} className="textLayer" />
		</div>
	);
}

/**
 * The unlock form for an encrypted document.
 *
 * The password lives in this component's state and nowhere else: closing the
 * viewer forgets it, and reopening the file asks again. This app writes no
 * secrets and is not going to start with a PDF password.
 */
function Unlock({
	wrong,
	password,
	onPassword,
	onSubmit,
}: {
	wrong: boolean;
	password: string;
	onPassword: (value: string) => void;
	onSubmit: () => void;
}) {
	return (
		<div
			data-testid="pdf-unlock"
			className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
		>
			<Lock className="size-8 text-muted-foreground/60" />
			<p className="text-muted-foreground text-sm">
				{wrong ? 'Incorrect password.' : 'This PDF is password-protected.'}
			</p>
			<form
				className="flex items-center gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					onSubmit();
				}}
			>
				<Input
					type="password"
					autoFocus
					aria-label="Password"
					placeholder="Password"
					className="h-8 w-56 text-sm"
					value={password}
					onChange={(e) => onPassword(e.target.value)}
				/>
				<Button type="submit" variant="outline" size="sm" disabled={password.length === 0}>
					Unlock
				</Button>
			</form>
		</div>
	);
}
