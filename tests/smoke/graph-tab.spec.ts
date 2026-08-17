import { expect, test } from '@playwright/test';
import {
	ALPHA_ID,
	FOO_ID,
	fixtureLongHistory,
	fixtureOneProjectOneSession,
	fixtureRootCommit,
	fixtureTwoProjectGraphs,
	fixtureWithGraph,
	installMockBridge,
	SHA_MAIN,
	SHA_SIDE,
	ZULU_ID,
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

test.describe('graph tab — switching, paging and the keyboard', () => {
	test('@smoke switching project swaps the history and drops the selection', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectGraphs());
		await page.goto(`/#/projects/${ZULU_ID}`);
		await openGraph(page);

		// zulu's three commits, and nothing of alpha's.
		await expect(page.getByTestId('commit-row')).toHaveCount(3);
		await expect(page.getByText('aa commit 0')).toBeVisible();
		await expect(page.getByText('bb commit 0')).toHaveCount(0);

		// Select one, so there is something that must not survive the switch.
		await page.getByTestId('commit-row').first().click();
		await expect(page.getByTestId('commit-detail')).toContainText('Belongs to zulu.');

		await page.goto(`/#/projects/${ALPHA_ID}`);

		// alpha's two commits, and — the actual blind spot — **no** detail pane,
		// because a SHA from zulu would open a pane for a commit that isn't on
		// screen. The selection carries its project for exactly this.
		await expect(page.getByTestId('commit-row')).toHaveCount(2);
		await expect(page.getByText('bb commit 0')).toBeVisible();
		await expect(page.getByText('aa commit 0')).toHaveCount(0);
		await expect(page.getByTestId('commit-detail')).toHaveCount(0);

		await page.getByTestId('commit-row').first().click();
		await expect(page.getByTestId('commit-detail')).toContainText('Belongs to alpha.');

		// And back to zulu: its history again, and **no** pane. Arriving at a clean
		// graph is the predictable default — the pane costs 200px of the thing you
		// switched to look at, and re-selecting is one click.
		//
		// This is the assertion that pinned down a real bug. The first version kept
		// the selection alongside the project it belonged to and compared the two,
		// which meant zulu's selection came *back* on return — but only if you
		// hadn't selected anything in alpha meanwhile. Keying the subtree on the
		// project makes the reset unconditional.
		await page.goto(`/#/projects/${ZULU_ID}`);
		await expect(page.getByTestId('commit-row')).toHaveCount(3);
		await expect(page.getByText('aa commit 0')).toBeVisible();
		await expect(page.getByTestId('commit-detail')).toHaveCount(0);
	});

	test('@smoke the dirty HEAD marker follows the project', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectGraphs());
		await page.goto(`/#/projects/${ZULU_ID}`);
		await openGraph(page);

		// zulu has an uncommitted change, so its HEAD node is drawn hollow — filled
		// with the card colour rather than its lane's.
		const zuluNode = page.getByTestId('commit-row').first().locator('circle');
		await expect(zuluNode).toHaveAttribute('fill', 'var(--card)');

		// alpha is clean, so the same position is a filled node. A marker that
		// stayed hollow here would be claiming changes that aren't there.
		await page.goto(`/#/projects/${ALPHA_ID}`);
		const alphaNode = page.getByTestId('commit-row').first().locator('circle');
		await expect(alphaNode).toHaveAttribute('fill', 'var(--lane-0)');
	});

	test('@smoke Load more appends the next page and then goes away', async ({ page }) => {
		await installMockBridge(page, fixtureLongHistory());
		await page.goto(PROJECT);
		await openGraph(page);

		// One page is 300 commits, and 430 exist.
		await expect(page.getByTestId('commit-row')).toHaveCount(300);
		const loadMore = page.getByRole('button', { name: 'Load more' });
		await expect(loadMore).toBeVisible();

		await loadMore.click();

		// Appended, not replaced: the first page's rows are still at the top.
		await expect(page.getByTestId('commit-row')).toHaveCount(430);
		await expect(page.getByTestId('commit-row').first()).toContainText('commit 0');
		await expect(page.getByTestId('commit-row').nth(429)).toContainText('commit 429');
		// Nothing further to load, so the affordance stops claiming there is.
		await expect(loadMore).toHaveCount(0);
	});

	test('@smoke arrows walk the list and Enter is not needed to open a commit', async ({ page }) => {
		await installMockBridge(page, fixtureWithGraph());
		await page.goto(PROJECT);
		await openGraph(page);

		// Tab reaches the list at the first row — one tab stop, not 300.
		await page.getByTestId('commit-row').first().focus();
		await page.keyboard.press('ArrowDown');

		// Selection moves and takes focus with it, since the roving tabindex makes
		// the focused row the cursor.
		const second = page.getByTestId('commit-row').nth(1);
		await expect(second).toHaveAttribute('aria-current', 'true');
		await expect(second).toBeFocused();
		// Moving the selection *is* opening the commit — there is no separate
		// confirm step, which is what makes arrowing through history useful.
		await expect(page.getByTestId('commit-detail')).toBeVisible();

		await page.keyboard.press('End');
		const last = page.getByTestId('commit-row').nth(4);
		await expect(last).toHaveAttribute('aria-current', 'true');
		await expect(last).toBeFocused();

		await page.keyboard.press('Home');
		await expect(page.getByTestId('commit-row').first()).toHaveAttribute('aria-current', 'true');

		// Up from the top stays put rather than wrapping to the oldest commit.
		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('commit-row').first()).toHaveAttribute('aria-current', 'true');
	});

	test('@smoke a root commit says its files are additions and offers no parent', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureRootCommit());
		await page.goto(PROJECT);
		await openGraph(page);

		await page.getByTestId('commit-row').first().click();
		const detail = page.getByTestId('commit-detail');

		// `diffParent: null` — there is nothing to diff against, so the heading says
		// what the files are rather than implying a comparison.
		await expect(detail).toContainText('Added in this commit');
		await expect(detail).not.toContainText('Parent');
		await expect(detail).toContainText('README.md');
	});
});
