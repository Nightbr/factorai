/**
 * F10 — the dot means something now.
 *
 * The Rust side owns *deriving* the state from Claude's terminal title
 * (`services::osc_title`); these tests own what the renderer does with it once
 * `terminal:status` arrives. Nothing covered that before: every dot was green
 * from spawn to exit, so a listener that dropped the event on the floor looked
 * identical to a working one.
 *
 * `terminal:status` is injected through `window.__FACTORAI_EMIT__`, the same
 * hook `pending-session.spec.ts` uses for `sessions:changed`.
 */
import { expect, test } from '@playwright/test';
import { fixtureOneProjectOneSession, installMockBridge } from './fixtures';

const TERMINAL_ID = 'mock-terminal-id';

/** Open the fixture's only session, so there is a live PTY with a dot. */
async function openSession(page: import('@playwright/test').Page) {
	await installMockBridge(page, fixtureOneProjectOneSession());
	await page.goto('/');
	await page.locator('aside').getByText('foo').click();
	await page.getByText('Refactor the auth middleware').click();
	await expect(page.locator('.xterm')).toBeVisible();
}

async function emitStatus(
	page: import('@playwright/test').Page,
	status: 'working' | 'waiting_input' | 'stopped',
) {
	await page.evaluate(
		({ id, status }) => {
			window.__FACTORAI_EMIT__?.('terminal:status', {
				id,
				status,
				lastActivity: Date.now(),
			});
		},
		{ id: TERMINAL_ID, status },
	);
}

test('@smoke a status event moves every dot for that session', async ({ page }) => {
	await openSession(page);

	// Spawned sessions start as working — Claude is booting, and it is also what
	// the dot did before F10, so a launch looks no different than it used to.
	await expect(page.locator('main header [title="Working"]')).toHaveCount(1);

	await emitStatus(page, 'waiting_input');

	// The header, the sidebar and the tab strip all describe the same session, so
	// all three move together or one of them is lying.
	await expect(page.locator('main header [title="Waiting for input"]')).toHaveCount(1);
	await expect(page.locator('aside [title="Waiting for input"]')).not.toHaveCount(0);
	await expect(page.locator('header [title="Waiting for input"]').first()).toBeVisible();
	await expect(page.locator('[title="Working"]')).toHaveCount(0);

	// And back, because a turn starting again has to be visible too — a
	// one-way flip would look correct until the second prompt.
	await emitStatus(page, 'working');
	await expect(page.locator('main header [title="Working"]')).toHaveCount(1);
});

test('@smoke the tab avatar carries the status', async ({ page }) => {
	await openSession(page);
	await emitStatus(page, 'waiting_input');

	// Badged on the avatar, not a sibling in the tab — same corner badge the
	// sidebar's project icon uses. F16 argued against a dot per tab when every
	// live PTY looked the same; it does not any more.
	const badged = page
		.locator('header')
		.getByTestId('project-icon')
		.filter({ has: page.locator('[title="Waiting for input"]') });
	await expect(badged).not.toHaveCount(0);
});

test('@smoke closing a session that is working asks first', async ({ page }) => {
	await openSession(page);
	await emitStatus(page, 'working');

	await page.getByRole('button', { name: 'Close session' }).click();
	await expect(page.getByText('Close this session?')).toBeVisible();

	// Still live: the question has not been answered.
	await expect(page.locator('.xterm')).toBeVisible();
	await page.getByRole('button', { name: 'Keep it running' }).click();
	await expect(page.getByText('Close this session?')).toHaveCount(0);
});

test('@smoke closing a session that is waiting does not ask', async ({ page }) => {
	// The whole reason F10 exists: the dialog claims "any work in progress is
	// lost", and when Claude has handed back there is none to lose.
	await openSession(page);
	await emitStatus(page, 'waiting_input');

	await page.getByRole('button', { name: 'Close session' }).click();
	await expect(page.getByText('Close this session?')).toHaveCount(0);
	// It closed rather than merely skipping the dialog — the header goes back to
	// offering a way to start the session again.
	await expect(page.locator('main header [title="Waiting for input"]')).toHaveCount(0);
});

test('@smoke the tab strip skips the confirm on the same rule', async ({ page }) => {
	// Two surfaces close a session and they used to disagree about whether to
	// ask at all. `needsCloseConfirm` is shared so they cannot drift again.
	await openSession(page);
	await emitStatus(page, 'waiting_input');

	await page
		.locator('header')
		.getByRole('button', { name: /^Close / })
		.first()
		.click();
	await expect(page.getByText('Close this session?')).toHaveCount(0);
});
