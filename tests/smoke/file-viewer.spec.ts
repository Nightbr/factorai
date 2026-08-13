import { expect, type Page, test } from '@playwright/test';
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

		await panel.getByRole('button', { name: 'logo.png' }).click();

		const viewer = page.getByTestId('file-viewer');
		const card = viewer.getByTestId('binary-card');
		await expect(card.getByText(/Cannot preview binary file \(20 KB\)/)).toBeVisible();
		await expect(card.getByRole('button', { name: 'Open in default app' })).toBeVisible();
		await expect(viewer.getByTestId('file-view-editor')).toHaveCount(0);
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
});
