import { type Page, expect, test } from '@playwright/test';
import { fixtureWithFileTree, installMockBridge } from './fixtures';

const ROOT = '/home/alice/code/foo';

/** Open a project, reveal the tree, and return the panel locator. */
async function openTree(page: Page) {
	await page.locator('aside').first().getByText('foo').click();
	await page.getByRole('button', { name: 'Toggle file tree' }).click();
	const panel = page.getByTestId('file-tree-panel');
	await expect(panel.getByRole('button', { name: 'README.md' })).toBeVisible();
	return panel;
}

/**
 * Arguments of every read_file call so far. `maxBytes` is stringified because
 * the two cases we care about are `undefined` (backend default cap) and `null`
 * (uncapped), which `??` would collapse into one.
 */
function readCalls(page: Page) {
	return page.evaluate(() =>
		(window.__FACTORAI_TEST_CALLS__ ?? [])
			.filter((c) => c.name === 'read_file')
			.map((c) => ({ path: String(c.args?.path), maxBytes: String(c.args?.maxBytes) })),
	);
}

/** Every watch/unwatch the viewer asked for, in order — the subscription's
 *  whole lifetime as the renderer drove it. */
function watchCalls(page: Page) {
	return page.evaluate(() =>
		(window.__FACTORAI_TEST_CALLS__ ?? [])
			.filter((c) => c.name === 'watch_file' || c.name === 'unwatch_file')
			.map((c) => ({ name: c.name, path: String(c.args?.path) })),
	);
}

test.describe('file viewer', () => {
	test('@smoke clicking a file opens it in the viewer and records it in the URL', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);

		await panel.getByRole('button', { name: 'Cargo.toml' }).click();

		const viewer = page.getByTestId('file-viewer');
		await expect(viewer).toBeVisible();
		// Header: name prominent, parent directory beneath it.
		await expect(viewer.getByText('Cargo.toml', { exact: true })).toBeVisible();
		await expect(viewer.getByText(ROOT, { exact: true })).toBeVisible();
		// Monaco mounted, and the footer describes what we're looking at.
		await expect(viewer.getByTestId('file-view-editor')).toBeVisible();
		await expect(viewer.getByText('read-only')).toBeVisible();
		await expect(viewer.getByText('3 lines')).toBeVisible();

		// The open file lives in the URL, which is what the tab system will grow
		// out of — and what makes a reload reopen it.
		expect(page.url()).toContain(`file=${encodeURIComponent(`${ROOT}/Cargo.toml`)}`);
		expect(await readCalls(page)).toEqual([{ path: `${ROOT}/Cargo.toml`, maxBytes: 'undefined' }]);
	});

	test('@smoke Esc closes the viewer and clears the URL', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);
		await panel.getByRole('button', { name: 'README.md' }).click();
		await expect(page.getByTestId('file-viewer')).toBeVisible();

		await page.keyboard.press('Escape');

		await expect(page.getByTestId('file-viewer')).toHaveCount(0);
		expect(page.url()).not.toContain('file=');
	});

	test('@smoke a reload with ?file= reopens the same file', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);
		await panel.getByRole('button', { name: 'README.md' }).click();
		await expect(page.getByTestId('file-viewer')).toBeVisible();

		await page.reload();

		const viewer = page.getByTestId('file-viewer');
		await expect(viewer).toBeVisible();
		await expect(viewer.getByText('README.md', { exact: true })).toBeVisible();
	});

	test('@smoke a binary file gets a card instead of an editor', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);

		await panel.getByRole('button', { name: 'data.bin' }).click();

		const viewer = page.getByTestId('file-viewer');
		const card = viewer.getByTestId('binary-card');
		await expect(card.getByText(/Cannot preview binary file \(20 KB\)/)).toBeVisible();
		await expect(card.getByRole('button', { name: 'Open in default app' })).toBeVisible();
		await expect(viewer.getByTestId('file-view-editor')).toHaveCount(0);
	});

	test('@smoke an image renders, with its type and pixel dimensions', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);

		await panel.getByRole('button', { name: 'logo.png' }).click();

		const viewer = page.getByTestId('file-viewer');
		const img = viewer.getByTestId('image-view');
		await expect(img).toBeVisible();
		// Actually decoded, not merely present: a broken data URL still renders
		// an <img> element, so assert the browser got pixels out of it.
		await expect
			.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
			.toBeGreaterThan(0);
		await expect(viewer.getByText('image/png')).toBeVisible();
		await expect(viewer.getByText('1 × 1')).toBeVisible();
		// No Monaco, and none of the text footer's line count.
		await expect(viewer.getByTestId('file-view-editor')).toHaveCount(0);

		// read_file is never called for an image — it would read the bytes only
		// to report isBinary and discard them.
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'read_image')).toBe(true);
		expect(
			calls.some((c) => c.name === 'read_file' && String(c.args?.path).endsWith('logo.png')),
		).toBe(false);
	});

	test('@smoke an image zooms, pans while zoomed, and resets', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);
		await panel.getByRole('button', { name: 'logo.png' }).click();

		const viewer = page.getByTestId('file-viewer');
		const img = viewer.getByTestId('image-view');
		const stage = viewer.getByTestId('image-stage');
		const readout = viewer.getByTestId('image-zoom-readout');
		const transform = () => img.evaluate((el) => getComputedStyle(el).transform);

		await expect(readout).toHaveText('100%');
		// Fit is the resting state, so there is nothing to drag yet.
		await expect(stage).toHaveCSS('cursor', 'default');

		await viewer.getByRole('button', { name: 'Zoom in' }).click();
		await expect(readout).toHaveText('125%');
		// A matrix, not the string we wrote — proof it actually applied. Polled
		// because the transform is animated: read too early and you catch it
		// mid-transition at some value on the way to 1.25.
		await expect.poll(async () => (await transform()).startsWith('matrix(1.25')).toBe(true);
		await expect(stage).toHaveCSS('cursor', 'grab');

		// Drag to pan. The matrix's last two entries are the translation.
		const box = await stage.boundingBox();
		if (!box) throw new Error('no stage');
		const cx = box.x + box.width / 2;
		const cy = box.y + box.height / 2;
		await page.mouse.move(cx, cy);
		await page.mouse.down();
		await page.mouse.move(cx + 60, cy + 40, { steps: 5 });
		await page.mouse.up();
		await expect.poll(async () => (await transform()).endsWith('60, 40)')).toBe(true);

		// The readout resets zoom *and* the pan — a reset that left the image in
		// a corner wouldn't look like one.
		await readout.click();
		await expect(readout).toHaveText('100%');
		await expect.poll(async () => (await transform()).endsWith('0, 0)')).toBe(true);
	});

	test('@smoke copying an image puts a PNG on the clipboard', async ({ page }) => {
		// Stub the clipboard rather than granting permission and reading it back:
		// what this test owns is *what we hand over*, and the platform's own
		// clipboard is neither ours nor reliably readable in a headless run.
		await page.addInitScript(() => {
			(window as unknown as { __COPIED__: string[] }).__COPIED__ = [];
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: {
					write: async (items: ClipboardItem[]) => {
						(window as unknown as { __COPIED__: string[] }).__COPIED__.push(...items[0].types);
					},
					writeText: async () => undefined,
				},
			});
		});
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);
		await panel.getByRole('button', { name: 'logo.png' }).click();
		await expect(page.getByTestId('image-view')).toBeVisible();

		await page.getByRole('button', { name: 'Copy image' }).click();

		// PNG regardless of the source format: clipboards want it, and encoding
		// through a canvas is what makes a jpeg or webp behave the same.
		await expect
			.poll(() => page.evaluate(() => (window as unknown as { __COPIED__: string[] }).__COPIED__))
			.toEqual(['image/png']);
	});

	test('@smoke an svg opens rendered and can be switched to source', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);

		await panel.getByRole('button', { name: 'mark.svg' }).click();

		const viewer = page.getByTestId('file-viewer');
		const svg = viewer.getByTestId('svg-view');
		await expect(svg).toBeVisible();
		// Decoded, not just present — and via a data URL, which is what keeps a
		// <script> inside someone's svg from running with our origin.
		await expect
			.poll(() => svg.evaluate((el: HTMLImageElement) => el.naturalWidth))
			.toBeGreaterThan(0);
		await expect(svg).toHaveAttribute('src', /^data:image\/svg\+xml,/);
		await expect(viewer.getByTestId('file-view-editor')).toHaveCount(0);

		// Same toggle markdown gets, because it's the same question.
		await viewer.getByRole('button', { name: 'View source' }).click();
		await expect(viewer.getByTestId('file-view-editor')).toBeVisible();
		await expect(viewer.getByTestId('svg-view')).toHaveCount(0);
	});

	test('@smoke a file that only looks like an image falls back to the card', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);

		await panel.getByRole('button', { name: 'broken.png' }).click();

		// Routing is by extension, the verdict is the backend's — so a .png that
		// isn't one lands here rather than drawing a broken-image icon.
		const viewer = page.getByTestId('file-viewer');
		await expect(viewer.getByTestId('image-view')).toHaveCount(0);
		await expect(
			viewer.getByTestId('binary-card').getByRole('button', { name: 'Open in default app' }),
		).toBeVisible();
	});

	test('@smoke a truncated file offers Show anyway, which re-reads uncapped', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);

		await panel.getByRole('button', { name: 'huge.log' }).click();

		const viewer = page.getByTestId('file-viewer');
		await expect(viewer.getByText('truncated')).toBeVisible();
		// Size reported is the real one on disk, not the bytes we received.
		await expect(viewer.getByText('12 MB')).toBeVisible();

		await viewer.getByRole('button', { name: 'Show anyway' }).click();

		await expect(viewer.getByText('truncated')).toHaveCount(0);
		expect(await readCalls(page)).toEqual([
			{ path: `${ROOT}/huge.log`, maxBytes: 'undefined' },
			{ path: `${ROOT}/huge.log`, maxBytes: 'null' },
		]);
	});

	test('@smoke markdown opens rendered, and can be switched to source', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);

		await panel.getByRole('button', { name: 'README.md' }).click();

		const viewer = page.getByTestId('file-viewer');
		// Rendered by default: a real heading element and a GFM table, neither of
		// which Monaco would produce.
		const md = viewer.getByTestId('markdown-view');
		await expect(md).toBeVisible();
		await expect(md.getByRole('heading', { name: 'foo' })).toBeVisible();
		await expect(md.getByRole('table')).toBeVisible();
		await expect(viewer.getByTestId('file-view-editor')).toHaveCount(0);

		await viewer.getByRole('button', { name: 'View source' }).click();

		await expect(viewer.getByTestId('file-view-editor')).toBeVisible();
		await expect(viewer.getByTestId('markdown-view')).toHaveCount(0);

		// And back again.
		await viewer.getByRole('button', { name: 'Preview' }).click();
		await expect(viewer.getByTestId('markdown-view')).toBeVisible();
	});

	test('@smoke reopening a file re-reads it, so an agent edit shows', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);

		await panel.getByRole('button', { name: 'README.md' }).click();
		const viewer = page.getByTestId('file-viewer');
		await expect(
			viewer.getByTestId('markdown-view').getByRole('heading', { name: 'foo' }),
		).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(page.getByTestId('file-viewer')).toHaveCount(0);

		// The agent edits the file while the viewer is closed. Nothing tells the
		// renderer — there is no watcher on the viewer's path — so the reopen is
		// the only thing that can notice.
		// A fresh object, not a mutated one: `read_file` returns a new
		// `FileContents` per call, and mutating the fixture's in place would put the
		// new bytes into the *cache entry* as well — the test would then pass
		// against a viewer that never re-read anything.
		await page.evaluate((path) => {
			const files = window.__FACTORAI_TEST__?.files;
			const file = files?.[path];
			if (files && file) files[path] = { ...file, contents: '# rewritten\n\nby the agent.\n' };
		}, `${ROOT}/README.md`);

		await panel.getByRole('button', { name: 'README.md' }).click();

		const md = page.getByTestId('file-viewer').getByTestId('markdown-view');
		await expect(md.getByRole('heading', { name: 'rewritten' })).toBeVisible();
		// And it got there by reading again, not from a cache that happened to
		// expire: two reads of the document, one per open. Filtered by path
		// because the rendered page reads its inline SVG through read_file too.
		const reads = (await readCalls(page)).filter((c) => c.path === `${ROOT}/README.md`);
		expect(reads).toEqual([
			{ path: `${ROOT}/README.md`, maxBytes: 'undefined' },
			{ path: `${ROOT}/README.md`, maxBytes: 'undefined' },
		]);
	});

	test('@smoke an edit lands in the open file without reopening it', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);

		await panel.getByRole('button', { name: 'README.md' }).click();
		const md = page.getByTestId('file-viewer').getByTestId('markdown-view');
		await expect(md.getByRole('heading', { name: 'foo' })).toBeVisible();

		// The agent edits the file the reader is looking at, and Rust's watch on
		// it fires. Nothing is closed and nothing is clicked.
		await page.evaluate((path) => {
			const files = window.__FACTORAI_TEST__?.files;
			const file = files?.[path];
			if (files && file) files[path] = { ...file, contents: '# live\n\nedited while open.\n' };
			window.__FACTORAI_EMIT__?.('file:changed', { path });
		}, `${ROOT}/README.md`);

		await expect(md.getByRole('heading', { name: 'live' })).toBeVisible();
	});

	test('@smoke an event for another file leaves the open one alone', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);

		await panel.getByRole('button', { name: 'README.md' }).click();
		const md = page.getByTestId('file-viewer').getByTestId('markdown-view');
		await expect(md.getByRole('heading', { name: 'foo' })).toBeVisible();

		// A stale notification — the watch fired for a file the reader has since
		// moved off. It invalidates that path's cache entry, not this one's.
		await page.evaluate((root) => {
			const files = window.__FACTORAI_TEST__?.files;
			const open = `${root}/README.md`;
			const file = files?.[open];
			if (files && file) files[open] = { ...file, contents: '# should not appear\n' };
			window.__FACTORAI_EMIT__?.('file:changed', { path: `${root}/docs/guide.md` });
		}, ROOT);

		await expect(md.getByRole('heading', { name: 'foo' })).toBeVisible();
		await expect(md.getByRole('heading', { name: 'should not appear' })).toHaveCount(0);
	});

	test('@smoke the viewer watches the file it opens and releases it on close', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);

		await panel.getByRole('button', { name: 'README.md' }).click();
		await expect(page.getByTestId('file-viewer')).toBeVisible();
		await expect
			.poll(() => watchCalls(page))
			.toEqual([{ name: 'watch_file', path: `${ROOT}/README.md` }]);

		// Switching files moves the watch, and the file being left is released
		// *first* — React runs the old effect's cleanup before the new effect, which
		// is what makes a path-scoped `unwatch_file` safe. Through the document's
		// own link rather than the tree, because the modal covers the tree.
		await page.getByTestId('file-viewer').getByRole('link', { name: 'the guide' }).click();
		await expect
			.poll(() => watchCalls(page))
			.toEqual([
				{ name: 'watch_file', path: `${ROOT}/README.md` },
				{ name: 'unwatch_file', path: `${ROOT}/README.md` },
				{ name: 'watch_file', path: `${ROOT}/docs/guide.md` },
			]);

		// And closing the viewer leaves nothing watching.
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('file-viewer')).toHaveCount(0);
		await expect
			.poll(() => watchCalls(page))
			.toEqual([
				{ name: 'watch_file', path: `${ROOT}/README.md` },
				{ name: 'unwatch_file', path: `${ROOT}/README.md` },
				{ name: 'watch_file', path: `${ROOT}/docs/guide.md` },
				{ name: 'unwatch_file', path: `${ROOT}/docs/guide.md` },
			]);
	});

	test('@smoke frontmatter is laid out as fields, and collapses', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);

		await panel.getByRole('button', { name: 'README.md' }).click();

		const md = page.getByTestId('file-viewer').getByTestId('markdown-view');
		const frontmatter = md.getByTestId('frontmatter');
		// Open, because the preference ships that way.
		await expect(frontmatter).toHaveAttribute('data-state', 'open');
		// Fields in document order, the nested map's own key included — not the
		// one run-together paragraph remark used to make of the block.
		await expect(frontmatter.locator('dt')).toHaveText([
			'title',
			'reviewers',
			'notion_source',
			'links',
			'issue',
		]);
		await expect(frontmatter.getByText('Noé Pion')).toBeVisible();
		// A URL field is a link handed to the OS, like a link in the prose.
		await expect(
			frontmatter.getByRole('link', { name: 'https://example.com/ENG-3150' }),
		).toBeVisible();
		// And the YAML is gone from the document itself.
		await expect(md.locator('p', { hasText: 'title: foo' })).toHaveCount(0);

		await frontmatter.getByTestId('frontmatter-toggle').click();

		await expect(frontmatter).toHaveAttribute('data-state', 'collapsed');
		await expect(frontmatter.locator('dt')).toHaveCount(0);
		// What is behind the chevron, only while it is shut.
		await expect(frontmatter).toContainText('4 fields');
	});

	test('@smoke a mermaid fence renders as a diagram, and a broken one keeps its source', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);

		await panel.getByRole('button', { name: 'README.md' }).click();

		const md = page.getByTestId('file-viewer').getByTestId('markdown-view');
		// An `<svg>` that mermaid laid out, with the node label in it — not the
		// fence's text sitting in a code block. Mermaid loads lazily, so this is
		// the one place in the suite that waits for a chunk.
		const diagram = md.getByTestId('mermaid-diagram');
		await expect(diagram.locator('svg')).toBeVisible({ timeout: 15_000 });
		await expect(diagram).toContainText('Terminal');

		// The fence mermaid rejects reports it and keeps the source, rather than
		// leaving a gap or replacing the page with mermaid's bomb glyph.
		const failed = md.getByTestId('mermaid-error');
		await expect(failed).toBeVisible();
		await expect(failed).toContainText('nothing mermaid knows how to draw');

		// And a fence in any other language is still a code block.
		await expect(md.locator('pre code.language-ts')).toHaveText('const answer = 42;\n');
	});

	test('@smoke markdown images resolve against the file they are in', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);

		await panel.getByRole('button', { name: 'README.md' }).click();

		const md = page.getByTestId('file-viewer').getByTestId('markdown-view');
		// A relative src cannot load as a URL — the webview has no filesystem
		// origin — so neither of these paints unless the path was resolved and the
		// bytes read through a command.
		const logo = md.getByAltText('the logo');
		await expect(logo).toHaveAttribute('src', /^data:image\/png;base64,/);
		// Decoded, not merely present — same reason as the image view above.
		await expect
			.poll(() => logo.evaluate((el: HTMLImageElement) => el.naturalWidth))
			.toBeGreaterThan(0);
		// SVG is text, so it comes back through read_file rather than read_image.
		const mark = md.getByAltText('the mark');
		await expect(mark).toHaveAttribute('src', /^data:image\/svg\+xml,/);
		await expect
			.poll(() => mark.evaluate((el: HTMLImageElement) => el.naturalWidth))
			.toBeGreaterThan(0);
		// And a file that isn't there leaves the alt text behind, not a gap.
		await expect(md.getByTestId('markdown-image-missing')).toHaveText('a gap');
	});

	test('@smoke a relative markdown link opens that file in the viewer', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);
		await panel.getByRole('button', { name: 'README.md' }).click();

		const viewer = page.getByTestId('file-viewer');
		await viewer.getByRole('link', { name: 'the guide' }).click();

		// docs/guide.md resolved against the README's directory. Scoped to the
		// rendered body — the modal title says "guide.md", which also matches.
		await expect(
			viewer.getByTestId('markdown-view').getByRole('heading', { name: 'Guide' }),
		).toBeVisible();
		expect(page.url()).toContain(encodeURIComponent(`${ROOT}/docs/guide.md`));
	});

	test('@smoke the header controls sit on one row with the close button', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);
		await panel.getByRole('button', { name: 'Cargo.toml' }).click();

		const viewer = page.getByTestId('file-viewer');
		const names = ['Copy path', 'Open in default app', 'Close viewer'];
		const boxes = [];
		for (const name of names) {
			const box = await viewer.getByRole('button', { name }).boundingBox();
			expect(box, `${name} should be rendered`).not.toBeNull();
			boxes.push(box as { y: number; height: number });
		}

		// Same vertical centre, within a pixel — the built-in absolutely
		// positioned close button used to sit off this row.
		const centres = boxes.map((b) => b.y + b.height / 2);
		for (const c of centres) {
			expect(Math.abs(c - centres[0])).toBeLessThanOrEqual(1);
		}

		// Closing through the header button clears the URL like Esc does.
		await viewer.getByRole('button', { name: 'Close viewer' }).click();
		await expect(page.getByTestId('file-viewer')).toHaveCount(0);
		expect(page.url()).not.toContain('file=');
	});

	test('@smoke a file that vanished since the tree listed it explains itself', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);

		// main.py is in the listing but absent from `files`, so read_file rejects.
		await panel.getByRole('button', { name: 'main.py' }).click();

		const viewer = page.getByTestId('file-viewer');
		await expect(viewer.getByText(/File not found/i)).toBeVisible();
		await expect(viewer.getByText(/tree may be out of date/i)).toBeVisible();
	});

	/**
	 * JSON is the one common language `basic-languages` does not register, so
	 * before this it resolved to `plaintext` and the footer said `Plain Text` —
	 * a whole file type silently unhighlighted. `components/viewer/monaco.ts`
	 * registers it by hand; this is the guard that it stays registered, and that
	 * the two dialect extensions we add on top of Monaco's list keep working.
	 */
	test('@smoke a .jsonc file is recognised as JSON, not plain text', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);

		await panel.getByRole('button', { name: 'knip.jsonc' }).click();

		const viewer = page.getByTestId('file-viewer');
		await expect(viewer.getByTestId('file-view-editor')).toBeVisible();
		await expect(viewer.getByText('JSON', { exact: true })).toBeVisible();
		await expect(viewer.getByText('Plain Text')).toHaveCount(0);
	});

	/**
	 * `&line=` (F19). The terminal's link provider can't be driven from this lane
	 * — there is no PTY in browser-only mode — but the contract it depends on is
	 * a URL param on the root route, and that is reachable by typing one. Which
	 * is also the point of holding viewer state in the URL.
	 */
	test('@smoke ?line= opens the file scrolled to that line', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		const file = encodeURIComponent(`${ROOT}/src/deep.ts`);
		await page.goto(`/#/?file=${file}&line=300`);

		const viewer = page.getByTestId('file-viewer');
		await expect(viewer.getByTestId('file-view-editor')).toBeVisible();

		// Monaco renders only what is on screen, so the line being in the DOM at
		// all is the assertion: it was scrolled to, not merely opened.
		await expect(viewer.getByText('const line300 = 300;')).toBeVisible();
		await expect(viewer.getByText('const line1 = 1;', { exact: true })).toHaveCount(0);
	});

	test('@smoke a line past the end of the file lands at the end, not nowhere', async ({ page }) => {
		// The number came off output the agent printed, and the file may have
		// shrunk since. Stale `deep.ts:9000` should show the end of the file
		// rather than throwing Monaco at a line that isn't there.
		await installMockBridge(page, fixtureWithFileTree());
		const file = encodeURIComponent(`${ROOT}/src/deep.ts`);
		await page.goto(`/#/?file=${file}&line=9000`);

		const viewer = page.getByTestId('file-viewer');
		await expect(viewer.getByTestId('file-view-editor')).toBeVisible();
		await expect(viewer.getByText('const line400 = 400;')).toBeVisible();
	});

	test('@smoke a nonsense line is ignored rather than obeyed', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		const file = encodeURIComponent(`${ROOT}/src/deep.ts`);
		await page.goto(`/#/?file=${file}&line=-4`);

		const viewer = page.getByTestId('file-viewer');
		await expect(viewer.getByTestId('file-view-editor')).toBeVisible();
		await expect(viewer.getByText('const line1 = 1;', { exact: true })).toBeVisible();
	});

	/**
	 * Handing the open file to the agent (F20).
	 *
	 * The control lives in the footer because that is the only place that knows
	 * the selection, and its label names the range — a control that sends more
	 * than you highlighted is worse than one you press twice.
	 */
	test('@smoke offers the whole file when nothing is selected', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		// Through a session, so there is an agent to send to.
		await page.locator('aside').first().getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();
		await page.goto(`${page.url().split('?')[0]}?file=${encodeURIComponent(`${ROOT}/Cargo.toml`)}`);

		const button = page.getByTestId('viewer-add-to-claude');
		await expect(button).toHaveText('Add file to agent context');

		// **Bottom right, past the metadata.** Everything to the left of the
		// spacer describes the file; this is the one control in the row that
		// *does* something. Asserted on geometry rather than on the DOM order,
		// because the thing that would break it is a stray second `flex-1`
		// leaving the button stranded mid-row — which reads fine in the markup.
		const readOnly = page.getByTestId('file-viewer').getByText('read-only');
		const [buttonBox, readOnlyBox] = await Promise.all([
			button.boundingBox(),
			readOnly.boundingBox(),
		]);
		expect(buttonBox && readOnlyBox).toBeTruthy();
		if (!buttonBox || !readOnlyBox) throw new Error('both are visible');
		expect(buttonBox.x).toBeGreaterThan(readOnlyBox.x + readOnlyBox.width);

		await button.click();
		const calls = await page.evaluate(() =>
			(window.__FACTORAI_TEST_CALLS__ ?? [])
				.filter((c) => c.name === 'ide_mention')
				.map((c) => c.args?.mentions),
		);
		expect(calls).toEqual([[{ path: `${ROOT}/Cargo.toml` }]]);
	});

	test('@smoke there is nothing to send to outside a session', async ({ page }) => {
		// Absent rather than disabled: in a row of metadata a greyed control
		// reads as broken rather than unavailable.
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openTree(page);
		await panel.getByRole('button', { name: 'Cargo.toml' }).click();

		await expect(page.getByTestId('file-viewer')).toBeVisible();
		await expect(page.getByTestId('viewer-add-to-claude')).toHaveCount(0);
	});
});
