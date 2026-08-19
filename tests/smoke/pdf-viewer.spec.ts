import { type Page, expect, test } from '@playwright/test';
import { fixtureWithFileTree, installMockBridge } from './fixtures';

/**
 * PDF preview in the file viewer (F7, ADR-0018).
 *
 * These run against real pdf.js: the fixture is a genuine two-page document and
 * the worker, fonts and WASM assets are the ones the app ships. That is the
 * point — the interesting failures here (a worker that can't load, an asset path
 * that only resolves in dev) are invisible to a mocked renderer.
 */

/** Open the project, reveal the tree, and click through to a PDF in it. */
async function openPdf(page: Page, name = 'spec.pdf') {
	await page.locator('aside').first().getByText('foo').click();
	await page.getByRole('button', { name: 'Toggle file tree' }).click();
	const panel = page.getByTestId('file-tree-panel');
	await panel.getByRole('button', { name }).click();
	const viewer = page.getByTestId('file-viewer');
	await expect(viewer).toBeVisible();
	return viewer;
}

test.describe('pdf viewer', () => {
	test('@smoke a PDF renders its pages, with a counter and read-only footer', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');

		const viewer = await openPdf(page);

		// Both pages get a box reserved for them up front, whether or not they
		// have rasterised yet.
		await expect(viewer.getByTestId('pdf-page')).toHaveCount(2);
		// The first page actually drew: a canvas with real dimensions, which only
		// happens if the worker loaded and pdf.js parsed the document.
		const canvas = viewer.getByTestId('pdf-page').first().locator('canvas');
		await expect(canvas).toBeVisible();
		await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(100);

		await expect(viewer.getByTestId('pdf-page-counter')).toHaveText('1 / 2');
		await expect(viewer.getByText('read-only')).toBeVisible();
		// Not Monaco: a PDF must not reach the text editor.
		await expect(viewer.getByTestId('file-view-editor')).toHaveCount(0);
	});

	test('@smoke the text layer makes the page selectable', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');

		const viewer = await openPdf(page);

		// The fixture's first page reads "Page one"; the spans are transparent and
		// positioned over the raster, but they are real text in the DOM.
		await expect(viewer.locator('.textLayer').first()).toContainText('Page one');
	});

	test('@smoke zoom steps and resets to fit width', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');

		const viewer = await openPdf(page);
		const readout = viewer.getByTestId('pdf-zoom-readout');
		const page1 = viewer.getByTestId('pdf-page').first();

		const fitWidth = (await page1.boundingBox())?.width ?? 0;
		expect(fitWidth).toBeGreaterThan(100);
		const fitPercent = await readout.textContent();

		await viewer.getByRole('button', { name: 'Zoom in' }).click();
		await expect
			.poll(async () => (await page1.boundingBox())?.width ?? 0)
			.toBeGreaterThan(fitWidth);
		await expect(readout).not.toHaveText(fitPercent ?? '');

		// The readout is the reset, back to the fit-width the view opened at.
		await readout.click();
		await expect(readout).toHaveText(fitPercent ?? '');
	});

	test('@smoke an encrypted PDF asks for its password, and opens with it', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');

		const viewer = await openPdf(page, 'locked.pdf');

		const unlock = viewer.getByTestId('pdf-unlock');
		await expect(unlock).toBeVisible();
		await expect(unlock.getByText('This PDF is password-protected.')).toBeVisible();
		// Nothing rendered while it is locked.
		await expect(viewer.getByTestId('pdf-page')).toHaveCount(0);

		// A wrong password says so and asks again, rather than dead-ending.
		await unlock.getByLabel('Password').fill('nope');
		await unlock.getByRole('button', { name: 'Unlock' }).click();
		await expect(unlock.getByText('Incorrect password.')).toBeVisible();

		await unlock.getByLabel('Password').fill('letmein');
		await unlock.getByRole('button', { name: 'Unlock' }).click();

		await expect(viewer.getByTestId('pdf-page')).toHaveCount(1);
		await expect(viewer.getByTestId('pdf-page-counter')).toHaveText('1 / 1');
		await expect(viewer.locator('.textLayer').first()).toContainText('Secret page');
	});

	test('@smoke a .pdf that is not one falls back to the binary card', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		// Reached by URL: the fixture leaves this path out of `pdfs`, exactly as
		// the backend refuses a file whose first bytes aren't `%PDF-`.
		await page.goto('/#/?file=/home/alice/code/foo/notreally.pdf');

		const card = page.getByTestId('file-viewer').getByTestId('binary-card');
		await expect(card).toBeVisible();
		await expect(card.getByText('not a PDF: /home/alice/code/foo/notreally.pdf')).toBeVisible();
		// Scoped to the card: the modal header carries an icon button with the
		// same label, which is the header's generic action rather than this
		// dead end's only way out.
		await expect(card.getByRole('button', { name: 'Open in default app' })).toBeVisible();
	});
});
