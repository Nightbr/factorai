import { expect, test } from '@playwright/test';
import {
	FOO_ID,
	fixtureOneProjectOneSession,
	fixtureWithGraph,
	installMockBridge,
	SHA_MAIN,
	SHA_SIDE,
} from './fixtures';

/**
 * The panel's Graph tab (specs/05-features.md F18).
 *
 * **Deliberately two tests.** Lane assignment is the feature and it is tested in
 * Rust, against `tempdir` repositories, where a merge or an octopus layout can be
 * asserted directly. What is left for the browser is that the tab mounts, folds
 * its chips and opens a detail — and the suite is already well past the time
 * budget `AGENTS.md` § 2d claims for it (E1), so selection, the hover card,
 * paging and the split drag are recorded against roadmap item 10 rather than
 * added here.
 */

const PROJECT = `/#/projects/${FOO_ID}`;

async function openGraph(page: import('@playwright/test').Page) {
	await page.getByRole('button', { name: 'Toggle file tree' }).click();
	await expect(page.getByTestId('file-tree-panel')).toBeVisible();
	await page.getByRole('tab', { name: 'Graph' }).click();
}

test.describe('graph tab', () => {
	test('@smoke draws the rail, folds refs to one chip, and opens a commit', async ({ page }) => {
		await installMockBridge(page, fixtureWithGraph());
		await page.goto(PROJECT);
		await openGraph(page);

		const view = page.getByTestId('graph-view');
		await expect(view).toBeVisible();
		await expect(page.getByTestId('commit-row')).toHaveCount(5);

		// The case F18 is designed around: HEAD on a branch in sync with its
		// upstream, plus a tag. HEAD folds into the branch and `origin/main` is
		// absorbed into it, so three refs become two chips.
		const tip = page.getByTestId('commit-row').first();
		await expect(tip).toContainText('HEAD→main ≡origin');
		// `origin/main` never appears on its own — that is the folding, and it is
		// the assertion worth making, because the alternative spends a slot saying
		// the same thing twice.
		await expect(tip).not.toContainText('origin/main');
		// At the default 288px the remaining chip *still* doesn't fit beside a
		// readable subject, so it collapses to `+1` — which is the whole point of
		// having `+N`. One, not two: the fold saved a slot even though the fit
		// didn't.
		await expect(tip).toContainText('+1');

		// One SVG per row, which is the rail: lanes are drawn, not described.
		await expect(tip.locator('svg')).toHaveCount(1);

		// Clicking goes deeper — body and file list, the half the hover card
		// deliberately doesn't carry.
		await page.getByTestId('commit-row').nth(1).click();
		const detail = page.getByTestId('commit-detail');
		await expect(detail).toBeVisible();
		await expect(detail).toContainText('A body paragraph, which the row had no room for.');
		// Basename and directory are separate spans, per `FileChangeRow` — the
		// filename first and the path dimmed after it, which is F13's row verbatim.
		await expect(detail).toContainText('index.ts');
		await expect(detail).toContainText('+7');
		// A merge names the parent its diff is against rather than leaving the
		// reader to remember the convention. `SHA_MAIN` is the first parent.
		await expect(detail).toContainText(`${SHA_MAIN.slice(0, 7)} (diffed)`);
		await expect(detail).toContainText(SHA_SIDE.slice(0, 7));

		// The detail's own resizer, which is the horizontal PanelResizer variant.
		await expect(page.getByRole('separator', { name: 'Resize commit detail' })).toBeVisible();
	});

	test('@smoke a project with no repository says so instead of erroring', async ({ page }) => {
		// No `gitGraphs` entry, which the mock bridge answers with `repoRoot: null`
		// exactly as libgit2 does for an unversioned folder — a success the panel
		// renders, not a failure it toasts.
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto(PROJECT);
		await openGraph(page);

		await expect(page.getByText('Not a git repository.')).toBeVisible();
		// The strip must not reflow as you move between projects.
		await expect(page.getByRole('tab', { name: 'Graph' })).toBeVisible();
	});
});
