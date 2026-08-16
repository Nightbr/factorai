import { expect, type Page, test } from '@playwright/test';
import { fixtureWithFileTree, installMockBridge } from './fixtures';

const ROOT = '/home/alice/code/foo';

/**
 * The file tree row's right-click menu (specs/05-features.md F12).
 *
 * The row has no hover actions on purpose, so this is where the other things
 * you can do with a file live. Note what a green run here does **not** prove:
 * `navigator.clipboard.writeText` works in Chromium and on WebKitGTK, but
 * `ClipboardItem` does not (see `copyImageToClipboard`), so the image row needs
 * a manual pass in the real app whatever this says.
 */
async function openPanelOnProject(page: Page) {
	await page.locator('aside').first().getByText('foo').click();
	await page.getByRole('button', { name: 'Toggle file tree' }).click();
	return page.getByTestId('file-tree-panel');
}

/** Right-click a row in an already-open panel. Opening the panel is a toggle,
 *  so it happens once per test and not once per row. */
async function rightClick(page: Page, rowName: string) {
	await page
		.getByTestId('file-tree-panel')
		.getByRole('button', { name: rowName })
		.click({ button: 'right' });
}

/** What is on the clipboard, read back through the same API the app writes with. */
function clipboardText(page: Page) {
	return page.evaluate(() => navigator.clipboard.readText());
}

test.beforeEach(async ({ context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test.describe('file tree row menu', () => {
	test('@smoke right-click opens the menu and selects the row it acts on', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openPanelOnProject(page);
		await rightClick(page, 'README.md');

		await expect(page.getByRole('menuitem', { name: 'Open', exact: true })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: 'Open in default app' })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: 'Copy absolute path' })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: 'Copy relative path' })).toBeVisible();

		// The menu acts on one row, so that row is the visibly selected one —
		// otherwise it is acting on something you cannot see. Asserted after the
		// menu closes: an open Radix menu is modal and `aria-hidden`s the rest of
		// the page, so the row is not in the accessibility tree until then.
		await page.keyboard.press('Escape');
		await expect(panel.getByRole('button', { name: 'README.md' })).toHaveClass(
			/bg-secondary text-foreground/,
		);
	});

	test('@smoke copies the absolute path verbatim', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		await openPanelOnProject(page);
		await rightClick(page, 'README.md');
		await page.getByRole('menuitem', { name: 'Copy absolute path' }).click();

		expect(await clipboardText(page)).toBe(`${ROOT}/README.md`);
		// And the row says it happened — there is no toast to say it in.
		await expect(page.getByTestId('row-copied')).toBeVisible();
	});

	test('@smoke copies the path relative to the project root, with no leading ./', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		await openPanelOnProject(page);
		await rightClick(page, 'README.md');
		await page.getByRole('menuitem', { name: 'Copy relative path' }).click();

		expect(await clipboardText(page)).toBe('README.md');
	});

	test('@smoke copies a text file’s contents', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		await openPanelOnProject(page);
		await rightClick(page, 'Cargo.toml');
		await page.getByRole('menuitem', { name: 'Copy contents' }).click();

		expect(await clipboardText(page)).toContain('name = "foo"');
	});

	test('@smoke refuses to put a binary or a half-read file on the clipboard', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');

		// `data.bin` came back `isBinary`, `huge.log` came back `truncated`.
		// Disabled with the reason in the label, rather than copying a null byte
		// or half a file and looking like it worked.
		await openPanelOnProject(page);
		await rightClick(page, 'data.bin');
		await expect(page.getByRole('menuitem', { name: 'Copy contents (binary)' })).toBeDisabled();
		await page.keyboard.press('Escape');

		await rightClick(page, 'huge.log');
		await expect(page.getByRole('menuitem', { name: 'Copy contents (too large)' })).toBeDisabled();
	});

	test('@smoke a directory gets the same menu with the two file rows off', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		await openPanelOnProject(page);
		await rightClick(page, 'apps');

		// Same shape, not a second menu: paths are meaningful for a directory,
		// its contents and the viewer are not.
		await expect(page.getByRole('menuitem', { name: 'Open', exact: true })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: 'Copy contents (directory)' })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: 'Open in default app' })).toBeEnabled();
		await expect(page.getByRole('menuitem', { name: 'Copy absolute path' })).toBeEnabled();

		await page.getByRole('menuitem', { name: 'Copy relative path' }).click();
		expect(await clipboardText(page)).toBe('apps');
	});

	test('@smoke the root row copies as . rather than an empty string', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		await openPanelOnProject(page);
		await rightClick(page, 'foo');
		await page.getByRole('menuitem', { name: 'Copy relative path' }).click();

		expect(await clipboardText(page)).toBe('.');
	});

	test('@smoke the WebView menu is suppressed on chrome but not in a text field', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		await openPanelOnProject(page);

		// Chromium's own menu can't be observed from a test, so this asserts the
		// thing that produces it: whether the default was prevented. On WebKitGTK
		// the un-prevented default is `Back · Forward · Stop · Reload · Inspect
		// Element`, and `Reload` there drops every pooled xterm.
		const prevented = (selector: string) =>
			page.evaluate((sel) => {
				const el = document.querySelector(sel);
				if (!el) throw new Error(`no ${sel}`);
				const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
				el.dispatchEvent(ev);
				return ev.defaultPrevented;
			}, selector);

		expect(await prevented('[data-testid="file-tree-panel"] header')).toBe(true);
		// A real text field keeps its menu — paste is worth more there than
		// consistency is.
		expect(await prevented('input')).toBe(false);
	});

	test('@smoke Open sends the file to the viewer, not the OS', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		await openPanelOnProject(page);
		await rightClick(page, 'README.md');
		await page.getByRole('menuitem', { name: 'Open', exact: true }).click();

		await expect(page.getByTestId('file-viewer')).toBeVisible();
		await expect(page).toHaveURL(new RegExp(`file=${encodeURIComponent(`${ROOT}/README.md`)}`));
	});
});
