import { createRequire } from 'node:module';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Copy pdf.js's side-car assets into `public/pdfjs/` so the viewer can load them
 * (ADR-0018).
 *
 * **These are not optional.** pdf.js resolves four directories at runtime, and
 * this webview has no network, so anything not on disk beside the app is simply
 * missing:
 *
 * - `standard_fonts/` — the 14 base fonts a PDF may reference without embedding.
 *   Most LaTeX and Word output does exactly that, and without these it renders
 *   with missing glyphs.
 * - `cmaps/` — CJK encoding tables, for a document whose fonts aren't embedded.
 * - `wasm/` — the JBIG2 / JPEG2000 decoders and the colour-management module,
 *   plus their JS fallbacks. A scanned PDF is usually JBIG2 or JPX inside, which
 *   is the case the viewer's 32MB cap exists for.
 * - `iccs/` — the ICC profile qcms needs for CMYK.
 *
 * **Via `public/` rather than a middleware plus a `writeBundle` copy.** Vite
 * already serves `public/` in dev and copies it into `dist/` on build, so one
 * copy at startup gets both paths with no request handling of our own and no
 * second code path to keep honest. The directory is gitignored: it is ~4MB of
 * `node_modules` and belongs in the build, not the history.
 *
 * A version stamp beside the copy makes startup free after the first run and
 * self-correcting on an upgrade — bump `pdfjs-dist` and the next start replaces
 * assets that would otherwise be a version behind the code loading them.
 */
export function pdfjsAssets(): Plugin {
	const require = createRequire(import.meta.url);

	return {
		name: 'factorai:pdfjs-assets',
		// Both `vite dev` and `vite build` run this, which is the point.
		async buildStart() {
			const pkg = require.resolve('pdfjs-dist/package.json');
			const root = dirname(pkg);
			const version = JSON.parse(await readFile(pkg, 'utf8')).version as string;

			const out = resolve(import.meta.dirname, '../public/pdfjs');
			const stamp = join(out, '.version');

			if ((await readFile(stamp, 'utf8').catch(() => null)) === version) return;

			// Replace wholesale rather than merging over the top: a file dropped
			// between versions would otherwise linger and be served forever.
			await rm(out, { recursive: true, force: true });
			await mkdir(out, { recursive: true });
			for (const dir of ['standard_fonts', 'cmaps', 'wasm', 'iccs']) {
				await cp(join(root, dir), join(out, dir), { recursive: true });
			}
			await writeFile(stamp, version);
		},
	};
}
