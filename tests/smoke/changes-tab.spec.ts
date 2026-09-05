import { expect, test } from '@playwright/test';
import { FOO_ID, fixtureWithChanges, fixtureWithFileTree, installMockBridge } from './fixtures';

/**
 * The panel's Changes tab (specs/05-features.md F13).
 *
 * These run against `pnpm vite:dev` in browser-only mode, so the bridge is
 * mocked — what's under test is the panel, the grouping and the URL the rows
 * produce, not libgit2 (that has its own tests in services/git.rs).
 */

const PROJECT = `/#/projects/${FOO_ID}`;

async function openPanel(page: import('@playwright/test').Page) {
	await page.getByRole('button', { name: 'Toggle file tree' }).click();
	await expect(page.getByTestId('file-tree-panel')).toBeVisible();
}

test.describe('changes tab', () => {
	test('@smoke groups changes and shows counts, letters and the dimmed path', async ({ page }) => {
		await installMockBridge(page, fixtureWithChanges());
		await page.goto(PROJECT);
		await openPanel(page);

		await page.getByRole('tab', { name: 'Changes' }).click();
		const panel = page.getByTestId('file-tree-panel');

		// All three groups, conflicts first.
		const headings = panel.locator('h3');
		await expect(headings).toHaveText([/Merge Changes/, /Staged Changes/, /Changes/]);

		// The partly-staged file appears in both groups — the case that makes the
		// index worth modelling (Q19). Matched on the exact path: the fixture also
		// carries a *different* index.ts in a sibling package.
		await expect(panel.locator('button[title="src/index.ts"]')).toHaveCount(2);

		// A sibling change above the project keeps its ../ prefix.
		await expect(panel.getByText('../packages/types')).toBeVisible();

		// Binary rows carry no counts.
		const binaryRow = panel.getByRole('button', { name: /logo\.png/ });
		await expect(binaryRow).toContainText('bin');
	});

	test('@smoke a row opens the diff for its own group', async ({ page }) => {
		await installMockBridge(page, fixtureWithChanges());
		await page.goto(PROJECT);
		await openPanel(page);
		await page.getByRole('tab', { name: 'Changes' }).click();

		// The staged row must ask for HEAD ↔ index, not the worktree.
		await page
			.getByTestId('file-tree-panel')
			.locator('section')
			.filter({ hasText: 'Staged Changes' })
			.getByRole('button', { name: /index\.ts/ })
			.click();

		await expect(page).toHaveURL(/diff=staged/);
		await expect(page.getByTestId('file-viewer')).toBeVisible();
		await expect(page.getByTestId('diff-view-editor')).toBeVisible();

		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		const revs = calls.filter((c) => c.name === 'git_blob').map((c) => c.args?.rev);
		expect(revs).toContain('head');
		expect(revs).toContain('index');
	});

	test('@smoke a project without a repository says so rather than erroring', async ({ page }) => {
		// fixtureWithFileTree declares no gitStatuses, so the mock reports no repo.
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto(PROJECT);
		await openPanel(page);
		await page.getByRole('tab', { name: 'Changes' }).click();

		await expect(page.getByText('Not a git repository.')).toBeVisible();
	});

	test('@smoke a long path truncates rather than scrolling the list sideways', async ({ page }) => {
		// Built here rather than in `fixtureWithChanges`, so the grouping test
		// above keeps counting the rows it was written against.
		const fixture = fixtureWithChanges();
		const [status] = Object.values(fixture.gitStatuses ?? {});
		if (!status?.repoRoot) throw new Error('fixtureWithChanges must declare a repository');
		// A filename longer than the 288px panel on its own — the directory beside
		// it is what the row has to give up first.
		const relPath = 'docs/adr/0011-a-project-is-a-folder-in-the-workspace.md';
		// And a deep path under a short name, which is the case the row is ordered
		// for: the path truncates, the name stays whole (F13).
		const deepPath = 'apps/desktop/src/components/files/FileChangeRow.tsx';
		for (const p of [relPath, deepPath]) {
			status.changes.push({
				path: `${status.repoRoot}/${p}`,
				relPath: p,
				group: 'unstaged',
				kind: 'untracked',
				oldRelPath: null,
				additions: 168,
				deletions: 0,
				isBinary: false,
			});
		}
		status.total = status.changes.length;

		await installMockBridge(page, fixture);
		await page.goto(PROJECT);
		await openPanel(page);
		await page.getByRole('tab', { name: 'Changes' }).click();

		// The row is there, and the full path is still reachable from the tooltip.
		await expect(page.locator(`button[title="${relPath}"]`)).toBeVisible();

		// Nothing in the list is wider than the panel it sits in: one deep path
		// used to set a min-content width for every row and push the filenames
		// off the left edge.
		const bleed = await page
			.getByTestId('changes-view')
			.evaluate((el) => el.scrollWidth - el.clientWidth);
		expect(bleed).toBeLessThanOrEqual(1);

		// The two halves give up width in order, not in proportion: the path is
		// clipped and the filename beside it is whole, which is the whole reason
		// the path leads the row.
		const halves = await page
			.locator(`button[title="${deepPath}"] span`)
			.evaluateAll((els) =>
				els
					.filter(
						(el) =>
							el.textContent === 'apps/desktop/src/components/files' ||
							el.textContent === 'FileChangeRow.tsx',
					)
					.map((el) => ({ text: el.textContent, clipped: el.scrollWidth > el.clientWidth + 1 })),
			);
		expect(halves).toEqual([
			{ text: 'apps/desktop/src/components/files', clipped: true },
			{ text: 'FileChangeRow.tsx', clipped: false },
		]);
	});

	test('@smoke the chosen tab survives a reload and never switches itself', async ({ page }) => {
		await installMockBridge(page, fixtureWithChanges());
		await page.goto(PROJECT);
		await openPanel(page);
		await page.getByRole('tab', { name: 'Changes' }).click();

		await page.reload();

		await expect(page.getByRole('tab', { name: 'Changes' })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await expect(page.getByTestId('changes-view')).toBeVisible();
	});
});
