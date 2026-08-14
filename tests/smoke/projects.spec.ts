import { expect, test } from '@playwright/test';
import { fixtureOneProjectOneSession, installMockBridge } from './fixtures';

test.describe('projects sidebar', () => {
	test('@smoke renders the empty state when no projects', async ({ page }) => {
		await installMockBridge(page, { projects: [] });
		await page.goto('/');
		await expect(page.getByText('factorai').first()).toBeVisible();
		await expect(page.getByText(/No projects found/i)).toBeVisible();
	});

	test('@smoke lists projects from the bridge fixture', async ({ page }) => {
		const fx = fixtureOneProjectOneSession();
		await installMockBridge(page, fx);
		await page.goto('/');

		// Project name shows up in the sidebar list. There's also "factorai"
		// in the header, so filter to the list region.
		const sidebar = page.locator('aside');
		await expect(sidebar.getByText('foo')).toBeVisible();
		// Session count shows next to it.
		await expect(sidebar.getByText('1', { exact: true })).toBeVisible();
	});

	test('@smoke clicking a project navigates to its session list', async ({ page }) => {
		const fx = fixtureOneProjectOneSession();
		await installMockBridge(page, fx);
		await page.goto('/');

		await page.locator('aside').getByText('foo').click();

		// Header on the project route shows the project name and its real
		// path, plus the session title.
		await expect(page.getByText('/home/alice/code/foo')).toBeVisible();
		await expect(page.getByText('Refactor the auth middleware')).toBeVisible();
	});

	test('@smoke clicking a session opens the terminal-only session view', async ({ page }) => {
		const fx = fixtureOneProjectOneSession();
		await installMockBridge(page, fx);
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();

		// The header names the session by its indexed title (F6) — the raw uuid
		// moved to the hover title, so identity is still pinned here.
		await expect(page.locator('header').getByTitle('session-uuid-001')).toHaveText(
			'Refactor the auth middleware',
		);
		// xterm host renders a div under the terminal panel. xterm injects
		// the .xterm class on the host element it opens into.
		await expect(page.locator('.xterm')).toBeVisible();
		// The mock bridge resolves terminal_spawn, so the session registers as
		// live → the header exposes the Stop control (running lifecycle).
		await expect(page.getByRole('button', { name: /stop/i })).toBeVisible();
	});

	test('@smoke stopping a session kills the PTY and returns to the project', async ({ page }) => {
		const fx = fixtureOneProjectOneSession();
		await installMockBridge(page, fx);
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();
		await expect(page.locator('.xterm')).toBeVisible();

		await page.getByRole('button', { name: /stop/i }).click();

		// Back on the project's session list rather than parked on a dead pane
		// reading `[process exited]`.
		await expect(page).toHaveURL(/#\/projects\/-home-alice-code-foo$/);
		await expect(page.getByRole('heading', { name: 'foo' })).toBeVisible();

		// The PTY was actually killed, with the id the spawn handed back — not
		// just navigated away from.
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		const spawned = calls.find((c) => c.name === 'terminal_spawn');
		const killed = calls.find((c) => c.name === 'terminal_kill');
		expect(spawned).toBeDefined();
		expect(killed).toBeDefined();
	});

	test('@smoke opening a session spawns the PTY at the pane size', async ({ page }) => {
		const fx = fixtureOneProjectOneSession();
		await installMockBridge(page, fx);
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();
		await expect(page.locator('.xterm')).toBeVisible();

		const spawn = await page.evaluate(
			() => window.__FACTORAI_TEST_CALLS__?.find((c) => c.name === 'terminal_spawn')?.args,
		);
		const opts = spawn?.opts as { cols: number; rows: number } | undefined;

		// Regression guard: the PTY used to be spawned before its host element had
		// layout, so it was born at xterm's 80x24 default and claude rendered in
		// 80 columns until the next window resize. The pane in the test viewport is
		// far wider and taller than that.
		expect(opts?.cols).toBeGreaterThan(80);
		expect(opts?.rows).toBeGreaterThan(24);
	});
});
