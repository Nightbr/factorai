import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
	ZULU_ID,
	fixtureOneProjectOneSession,
	fixtureTwoProjectsManySessions,
	fixtureWithChanges,
	installMockBridge,
} from './fixtures';

/**
 * The session header's close control (specs/05-features.md F3).
 *
 * It used to be a labelled `Stop` button that killed a running agent on one
 * click with no confirmation — the only place in the app where an irreversible
 * act asked nothing (`00-overview.md` § "The operating model"). It is now the
 * same gesture and the same dialog as a tab's ×, which is what these assert.
 */
async function openSession(page: Page, name: RegExp) {
	await page.getByRole('link', { name }).click();
	await expect(page.locator('.xterm:visible')).toBeVisible();
}

test.describe('session header', () => {
	test('@smoke closing from the header asks first', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);

		// The header's control, not a tab's — the tab × is named after its
		// session ("Close Zulu task 11").
		await page.getByRole('button', { name: 'Close session' }).click();

		await expect(page.getByText('Close this session?')).toBeVisible();
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'terminal_kill')).toBe(false);
	});

	test('@smoke keeping it running leaves the terminal alive', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);

		await page.getByRole('button', { name: 'Close session' }).click();
		await page.getByRole('button', { name: /Keep it running/ }).click();

		await expect(page.getByText('Close this session?')).toHaveCount(0);
		await expect(page.locator('.xterm:visible')).toBeVisible();
		await expect(page.getByTestId('session-tabs').getByRole('tab')).toHaveCount(1);
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'terminal_kill')).toBe(false);
	});

	test('@smoke confirming kills the session and lands on the project', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);

		await page.getByRole('button', { name: 'Close session' }).click();
		await page.getByRole('button', { name: /Close & kill session/ }).click();

		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'terminal_kill')).toBe(true);
		await expect(page).toHaveURL(new RegExp(`projects/${ZULU_ID}$`));
		// The tab goes with the PTY, so the strip empties too.
		await expect(page.getByTestId('session-tabs')).toHaveCount(0);
	});

	test('@smoke the header and a tab open the same dialog', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);

		// One component behind both, so the wording cannot drift — which is the
		// bug this replaced: the tab asked, the header did not.
		const fromHeader = page.getByRole('button', { name: 'Close session' });
		const fromTab = page.getByRole('button', { name: /Close Zulu task 11/ });

		await fromHeader.click();
		const headerText = await page.getByRole('dialog').innerText();
		await page.getByRole('button', { name: /Keep it running/ }).click();

		await fromTab.click();
		expect(await page.getByRole('dialog').innerText()).toBe(headerText);
	});
});

/**
 * The git branch badge (specs/05-features.md F3).
 *
 * The branch comes from the same `git_status` the Changes tab reads, but on a
 * separate observer that is **not** gated on the right panel being open — see
 * hooks/useGitBranch.ts. That gate is the thing worth pinning down here: the
 * badge has to be there with the panel shut.
 */
test.describe('session header branch badge', () => {
	async function openTheOneSession(page: Page) {
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();
	}

	test('@smoke names the branch the project is on', async ({ page }) => {
		await installMockBridge(page, fixtureWithChanges());
		await page.goto('/');
		await openTheOneSession(page);

		await expect(page.getByTestId('session-branch')).toHaveText('main');
	});

	test('@smoke shows nothing at all when the project is not a repository', async ({ page }) => {
		// No `gitStatuses` in this fixture, so the mock resolves `repoRoot: null`
		// exactly as the real command does. Absent, not an error and not an empty
		// badge — a non-git project's header must look untouched.
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		await openTheOneSession(page);

		// The header itself is there and named — it is only the badge that isn't.
		await expect(page.locator('header').last().getByTitle('session-uuid-001')).toBeVisible();
		await expect(page.getByTestId('session-branch')).toHaveCount(0);
	});

	test('@smoke survives the panel being closed', async ({ page }) => {
		await installMockBridge(page, fixtureWithChanges());
		await page.goto('/');
		await openTheOneSession(page);
		await expect(page.getByTestId('session-branch')).toHaveText('main');

		// Reusing `useGitStatus` would have tied the badge to the panel, and this
		// is the assertion that would have caught it.
		await page.getByRole('button', { name: 'Toggle file tree' }).click();
		await expect(page.getByTestId('session-branch')).toHaveText('main');
	});
});

/**
 * The IDE bridge's one pixel in the header (specs/05-features.md F20).
 *
 * The bridge shows **nothing** while it works, which is the design rather than
 * an omission: a badge for a healthy bridge is a label that is always on, and a
 * label that is always on is one you stop reading. The badge exists for the one
 * case worth interrupting for — an agent that *cannot* open a file looks exactly
 * like an agent that chose not to.
 */
test.describe('session header ide bridge', () => {
	async function openTheOneSession(page: Page) {
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();
	}

	test('@smoke a healthy bridge puts nothing in the header', async ({ page }) => {
		await installMockBridge(page, fixtureWithChanges());
		await page.goto('/');
		await openTheOneSession(page);

		await expect(page.getByTestId('session-ide-issue')).toHaveCount(0);
	});

	test('@smoke a broken bridge says so, and says why on hover', async ({ page }) => {
		await installMockBridge(page, fixtureWithChanges());
		await page.goto('/');
		await openTheOneSession(page);

		await page.evaluate(() => {
			window.__FACTORAI_EMIT__?.('ide:status', {
				sessionId: 'session-uuid-001',
				connected: false,
				error: 'binding the ide bridge: Address already in use (os error 98)',
			});
		});

		const badge = page.getByTestId('session-ide-issue');
		await expect(badge).toBeVisible();
		// The reason is the point. "Something is wrong" that does not say what is
		// a worse header than no badge at all.
		await expect(badge).toHaveAttribute('title', /Address already in use/);
	});

	test('@smoke the badge clears when the bridge recovers', async ({ page }) => {
		// A restarted session gets a fresh bridge, and a stale error would
		// outlive the problem it describes.
		await installMockBridge(page, fixtureWithChanges());
		await page.goto('/');
		await openTheOneSession(page);

		const emit = (error: string | null) =>
			page.evaluate((e) => {
				window.__FACTORAI_EMIT__?.('ide:status', {
					sessionId: 'session-uuid-001',
					connected: e === null,
					error: e,
				});
			}, error);

		await emit('binding the ide bridge: permission denied');
		await expect(page.getByTestId('session-ide-issue')).toBeVisible();

		await emit(null);
		await expect(page.getByTestId('session-ide-issue')).toHaveCount(0);
	});
});
