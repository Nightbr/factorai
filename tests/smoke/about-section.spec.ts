import { expect, test } from '@playwright/test';
import { fixtureOneProjectOneSession, installMockBridge } from './fixtures';

/**
 * The About section (specs/05-features.md F29).
 *
 * **Two tests, and they are the two states of one file.** Everything in this
 * pane is a render of `build-info.json` or of its absence, and the absence is
 * the branch every local build takes — so the release branch is the one nothing
 * else exercises. The parser itself is vitest, in `lib/buildInfo.test.ts`.
 *
 * The file is served by `page.route` rather than by a fixture on the bridge: it
 * reaches the app over HTTP in the real product too (Vite copies `public/` into
 * the bundle), so intercepting the request tests the same path the app takes.
 */

const RELEASE = {
	version: '0.3.0',
	builtAt: '2026-09-16T11:02:37Z',
	commit: 'a6ac769',
	contributors: [
		{ login: 'octocat', url: 'https://github.com/octocat' },
		{ login: 'hubot', url: 'https://github.com/hubot' },
	],
};

test.describe('about section', () => {
	test('@smoke a release build names itself, and the contributors expand', async ({ page }) => {
		await page.route('**/build-info.json', (route) =>
			route.fulfill({ json: RELEASE, headers: { 'content-type': 'application/json' } }),
		);
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/?settings=about');

		const modal = page.getByTestId('settings-modal');
		await expect(modal).toBeVisible();
		// Last in the nav, and it edits nothing — so Save stays disabled while it
		// is open, exactly as on first run.
		await expect(page.getByTestId('settings-nav-about')).toHaveAttribute('aria-current', 'page');

		await expect(page.getByTestId('settings-about-version')).toContainText('0.3.0');
		await expect(page.getByTestId('settings-about-build')).toContainText('a6ac769');
		await expect(page.getByTestId('settings-about-build')).toContainText('2026');
		await expect(modal.getByText('MIT licence')).toBeVisible();

		// Expands in place rather than sending anyone to a browser: the list is
		// already in the bundle.
		const contributors = page.getByTestId('settings-about-contributors');
		await expect(contributors).toContainText('2 contributors');
		await expect(page.getByTestId('settings-about-contributor-list')).toHaveCount(0);
		await contributors.click();
		const list = page.getByTestId('settings-about-contributor-list');
		await expect(list).toContainText('octocat');
		await expect(list).toContainText('hubot');
	});

	test('@smoke without the file it says it is a local build', async ({ page }) => {
		// A 404 is what a developer's machine gives, and what the Playwright lane
		// gives by default — the Vite dev server answers an unknown path with
		// `index.html`, which fails the JSON parse and lands in the same branch.
		await page.route('**/build-info.json', (route) => route.fulfill({ status: 404 }));
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/?settings=about');

		await expect(page.getByTestId('settings-about-build')).toContainText('Built locally');
		// The version still says something, because the define always does — and
		// it says the build is untagged rather than claiming a release.
		await expect(page.getByTestId('settings-about-version')).not.toHaveText('…');
		// No contributor row at all: "0 contributors" about a repository with a
		// git history reads as a bug in the pane (F29).
		await expect(page.getByTestId('settings-about-contributors')).toHaveCount(0);
	});
});
