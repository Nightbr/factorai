import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?worker&url';

/**
 * pdf.js setup, isolated so nothing else imports pdf.js directly (ADR-0018) —
 * the same containment `monaco.ts` gives Monaco, one file type over.
 *
 * The whole module arrives through `PdfView`'s own lazy chunk, so opening a
 * source file never fetches any of it.
 */

/**
 * The worker is **bundled**, and pdf.js instantiates one per document.
 *
 * `?worker&url` gives the local chunk's URL rather than an instance, which
 * matters twice over:
 *
 * - **Bundled, so nothing is fetched from a network this webview doesn't have** —
 *   the same reason `monaco.ts` refuses `@monaco-editor/react`'s CDN loader.
 * - **A URL, not a `workerPort`.** A port is *one* `Worker`, and pdf.js takes
 *   ownership of it: tearing a document down terminates it, and the next
 *   document opened then fails with "PDFWorker.create - the worker is being
 *   destroyed". Found the first time two files were opened in a row — and
 *   immediately, under React's development double-effect, which opens and
 *   destroys once before the run that keeps. With a `workerSrc` each document
 *   gets its own worker and destroying one costs the others nothing.
 */
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Where pdf.js looks for the four asset sets it resolves at runtime, staged
 * into `public/pdfjs/` by `vite/pdfjsAssets.ts` — see that file for why each
 * one is load-bearing rather than optional.
 *
 * Absolute paths: the app is served from the bundle root under `tauri://` and
 * from `/` under `vite:dev`, so `/pdfjs/…` is the one form that means the same
 * thing in both.
 */
const ASSETS = {
	standardFontDataUrl: '/pdfjs/standard_fonts/',
	cMapUrl: '/pdfjs/cmaps/',
	cMapPacked: true,
	wasmUrl: '/pdfjs/wasm/',
	iccUrl: '/pdfjs/iccs/',
} as const;

/** The bytes of a base64 payload from `read_pdf`, as pdf.js wants them.
 *
 *  `atob` + a loop rather than `fetch(dataUrl)`: the async route allocates the
 *  same bytes twice and hangs a 32MB string off a URL for the trip. */
export function bytesFromBase64(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/**
 * Start opening a document. `password` is passed only when the reader has typed
 * one.
 *
 * Returns the **loading task**, not the document, because that is the object
 * that can be torn down: `destroy()` lives there and stops the worker, whereas
 * the document proxy only offers `cleanup()`, which frees rasters and leaves the
 * worker running. `task.promise` rejects with pdf.js's own exception types,
 * which `PdfView` reads to tell an encrypted document (ask for a password) from
 * a damaged one (say so, and offer the external app).
 */
export function openPdf(bytes: Uint8Array, password?: string) {
	return pdfjs.getDocument({
		// A fresh copy per attempt: pdf.js **transfers** the buffer to its worker,
		// which detaches it here. Without this, retrying with a password — or
		// re-opening the same file from the query cache — gets an empty array.
		data: new Uint8Array(bytes),
		password,
		...ASSETS,
	});
}

/** True when this is pdf.js's "the document is encrypted" rejection.
 *
 *  By `name`, not `instanceof`: the exception classes are re-exported from a
 *  worker-shared module and the identity check has broken across versions
 *  before. The name is part of pdf.js's public error contract. */
export function isPasswordError(e: unknown): boolean {
	return e instanceof Error && e.name === 'PasswordException';
}

/** How far off a wrong password we are: pdf.js asks twice, `NEED_PASSWORD`
 *  first and `INCORRECT_PASSWORD` once one has been tried and rejected. */
export function isWrongPassword(e: unknown): boolean {
	return (
		isPasswordError(e) &&
		(e as { code?: number }).code === pdfjs.PasswordResponses.INCORRECT_PASSWORD
	);
}

export type PdfDocument = Awaited<ReturnType<typeof openPdf>['promise']>;
export type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;
