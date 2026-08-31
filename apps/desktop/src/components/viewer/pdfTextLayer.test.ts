import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `pdfTextLayer.css` is a verbatim copy of one block of pdf.js's stylesheet
 * (ADR-0018). A copy is only safe if drift is loud, so this reads the installed
 * package and compares.
 *
 * When it fails, the fix is to re-copy the `.textLayer` block from
 * `pdfjs-dist/web/pdf_viewer.css` — not to edit either side into agreement.
 */
describe('the vendored text-layer CSS', () => {
	const require = createRequire(import.meta.url);
	const root = dirname(require.resolve('pdfjs-dist/package.json'));
	const upstream = readFileSync(join(root, 'web/pdf_viewer.css'), 'utf8');
	const ours = readFileSync(join(import.meta.dirname, 'pdfTextLayer.css'), 'utf8');

	/** Everything from the first rule onwards. Anchored to a line start, because
	 *  the header comment above it mentions `.textLayer` too. */
	const block = ours.slice(ours.search(/^\.textLayer/m));

	/**
	 * Whitespace out, on both sides.
	 *
	 * The copy is **not** byte-identical, and shouldn't be: biome formats every
	 * CSS file in this repo, vendored ones included — the same call the shadcn
	 * primitives got, so they stop being a landmine. What has to
	 * hold is that the *rules* are upstream's, which is what survives dropping
	 * the formatting.
	 */
	const bare = (css: string) => css.replace(/\s+/g, '');

	it('carries the same rules as the block it was copied from', () => {
		expect(bare(block).length).toBeGreaterThan(1000);
		expect(bare(upstream)).toContain(bare(block));
	});

	it("is the read-only block, without the annotation editor's", () => {
		// pdf_viewer.css has three `.textLayer` blocks; the other two style the
		// annotation editor's cursors and toolbar, which nothing here builds.
		expect(bare(block).match(/\.textLayer\{/g)).toHaveLength(1);
		expect(block).not.toContain('editToolbar');
		expect(block).not.toContain('editorFreeHighlight');
	});
});
