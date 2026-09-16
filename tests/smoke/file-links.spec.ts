import { expect, type Locator, type Page, test } from '@playwright/test';
import { fixtureWithFileTree, installMockBridge, type TestFixture } from './fixtures';

const ROOT = '/home/alice/code/foo';

/** The PTY the single pane in these specs is on. Pinned so the spec can fire
 *  output at it; the mock otherwise counts spawns (F23). */
const PTY = 'shell-pty-1';

/**
 * File links in a **footer shell's** output (F19 as amended by item 56).
 *
 * The behaviour was the agent terminal's for a month, and everything but one
 * map was already shared: the panes are pooled through the same
 * `getOrCreateTerm`, so the provider is registered on every one of them. What
 * they had no entry in was the wiring the provider reads through, so a path a
 * plain `terraform apply` printed underlined nothing and clicked nowhere.
 *
 * These drive the whole path — output, hover, modifier-click, viewer — which
 * nothing else in the suite does: the `?line=` specs in `file-viewer.spec.ts`
 * enter through the URL the link ends at. The grammar itself is vitest's, in
 * `lib/fileLinks.test.ts`; what is here is the two shapes a tool that is *not*
 * Claude Code prints, since F19's grammar was derived from the agent's prose.
 */
test.describe('file links in a shell pane', () => {
	function fixture(): TestFixture {
		return { ...fixtureWithFileTree(), shellSpawnId: PTY };
	}

	/** The project's footer shell, open, with its one pane on screen. The
	 *  project route rather than a session, so the only terminal in the window
	 *  is the pane — no agent xterm to disambiguate from. */
	async function openPane(page: Page): Promise<Locator> {
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByTestId('shell-footer').getByRole('button', { name: 'Terminal' }).click();
		const host = page.getByTestId('shell-pane-host');
		await expect(host).toBeVisible();
		return host;
	}

	/** Write a line to the pane's PTY the way Rust does — base64 bytes on
	 *  `terminal:data`, keyed by terminal id. Nothing waits here: every reader
	 *  below resolves a locator inside the rendered row, which auto-waits for
	 *  xterm's next frame. */
	async function print(page: Page, line: string): Promise<void> {
		await page.evaluate(
			([id, text]) => {
				window.__FACTORAI_EMIT__?.('terminal:data', { id, bytesB64: btoa(`${text}\r\n`) });
			},
			[PTY, line] as const,
		);
	}

	/**
	 * `Ctrl`/`Cmd`-click `path` where the pane printed it.
	 *
	 * **Two gestures, and the wait between them is the point.** xterm activates
	 * only a link its *hover* already found — `_handleMouseUp` reads the link the
	 * mousemove resolved — and this provider answers asynchronously, since every
	 * candidate is verified against disk first. The underline xterm draws is the
	 * signal that answer landed, and it covers exactly the link's cells, so it is
	 * also the thing to click.
	 *
	 * **The underline is an inline `text-decoration`, not a class.** xterm's DOM
	 * renderer re-creates the hovered row splitting the link into its own span
	 * and styles it there; `xterm-underline-*` is the class for an underline the
	 * *program* asked for with SGR 4, which is a different thing.
	 */
	async function clickPath(host: Locator, path: string): Promise<void> {
		const span = host.locator('.xterm-rows span', { hasText: path }).first();
		const text = (await span.textContent()) ?? '';
		const box = await span.boundingBox();
		if (!box || !text.includes(path)) throw new Error(`no rendered "${path}" to click`);

		// Monospace, so one cell is the span's width over its character count and
		// the middle of the path is the cell to aim the hover at.
		const cell = box.width / text.length;
		await host
			.page()
			.mouse.move(box.x + (text.indexOf(path) + path.length / 2) * cell, box.y + box.height / 2);

		const underlined = host.locator('span[style*="underline"]', { hasText: path }).first();
		await expect(underlined).toBeVisible();
		await underlined.click({ modifiers: ['ControlOrMeta'] });
	}

	test('@smoke a compiler-shaped path:line:col opens the file at the line', async ({ page }) => {
		await installMockBridge(page, fixture());
		const host = await openPane(page);

		// `tsc --pretty` and `rustc` both print this shape, and neither was what
		// F19's grammar was read off.
		await print(page, 'src/deep.ts:300:5 - error TS2322: Type is not assignable');
		await clickPath(host, 'src/deep.ts:300:5');

		await expect(page).toHaveURL(/line=300/);
		const viewer = page.getByTestId('file-viewer');
		// Monaco renders only what is on screen, so the line being in the DOM is
		// the assertion that the position travelled: it was scrolled to, not
		// merely opened.
		await expect(viewer.getByText('const line300 = 300;')).toBeVisible();
	});

	test('@smoke a terraform-shaped bare filename opens, without its line', async ({ page }) => {
		await installMockBridge(page, fixture());
		const host = await openPane(page);

		await print(page, 'Error: Invalid resource type');
		await print(page, '  on main.tf line 42, in resource "aws_instance" "web":');
		await clickPath(host, 'main.tf');

		await expect(page.getByTestId('file-viewer')).toContainText('aws_instance');
		// **`on main.tf line 42` is a third grammar and deliberately not read**
		// (F19). The file opens at its top rather than at a line inferred from
		// prose, and nothing in the URL claims otherwise.
		expect(page.url()).not.toContain('line=');
	});

	test('@smoke closing the file puts the caret back in the pane', async ({ page }) => {
		await installMockBridge(page, fixture());
		const host = await openPane(page);

		await print(page, 'src/deep.ts:300:5 - error TS2322: Type is not assignable');
		await clickPath(host, 'src/deep.ts:300:5');
		await expect(page.getByTestId('file-viewer')).toBeVisible();

		// The active tab's own `×` — the close ADR-0037 left. Skip the focus
		// return and the sequence is: click a path, read the file, close it,
		// type — and the keystrokes go nowhere.
		await page
			.locator('[data-testid="file-tab"][aria-selected="true"]')
			.getByRole('button')
			.click();

		await expect(async () => {
			const inPane = await page.evaluate(() =>
				Boolean(document.activeElement?.closest('[data-testid="shell-pane-host"]')),
			);
			expect(inPane).toBe(true);
		}).toPass();
	});

	test('@smoke a path that is not on disk was never a link', async ({ page }) => {
		await installMockBridge(page, fixture());
		const host = await openPane(page);

		// Same shape, one the fixture does not carry. Nothing underlines, so
		// there is nothing to click and no viewer to open.
		await print(page, 'src/gone.ts:12:1 - error TS2304: Cannot find name');
		const span = host.locator('.xterm-rows span', { hasText: 'src/gone.ts' }).first();
		const box = await span.boundingBox();
		if (!box) throw new Error('nothing rendered');
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

		await expect(host.locator('span[style*="underline"]')).toHaveCount(0);
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await expect(page.getByTestId('file-viewer')).toHaveCount(0);
	});

	test('@smoke the agent terminal keeps its own links', async ({ page }) => {
		// The wiring map moved out of `Terminal.tsx` to grow the pane's entry;
		// this is the half that was already working, and the one a mistake in
		// that move would take away.
		await installMockBridge(page, { ...fixtureWithFileTree(), terminalSpawnId: 'agent-pty-1' });
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();
		const host = page.locator('.xterm:visible').first();
		await expect(host).toBeVisible();

		await page.evaluate(() => {
			window.__FACTORAI_EMIT__?.('terminal:data', {
				id: 'agent-pty-1',
				bytesB64: btoa('Read Cargo.toml and fixed it\r\n'),
			});
		});
		await expect(host).toContainText('Cargo.toml');
		await clickPath(host, 'Cargo.toml');

		await expect(page.getByTestId('file-viewer')).toContainText('name = "foo"');
		expect(page.url()).toContain(encodeURIComponent(`${ROOT}/Cargo.toml`));
	});
});
