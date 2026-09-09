import { expect, test } from '@playwright/test';
import {
	FOO_ID,
	SHA_MERGE,
	SHA_TIP,
	fixtureWithChanges,
	fixtureWithFileTree,
	installMockBridge,
} from './fixtures';

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

	// ---- editing the working tree from the diff (F26, ADR-0041) --------------

	/**
	 * Type into the **modified** side of the diff — the right-hand one, which is
	 * the only side an edit can reach.
	 *
	 * Split mode puts two Monaco instances inside one host, so the click has to
	 * name which; and waiting for Monaco's own `focused` class is load-bearing
	 * here for the same reason it is in `file-viewer.spec.ts`, where the same
	 * helper lives for the plain editor.
	 */
	async function typeInModifiedSide(page: import('@playwright/test').Page, text: string) {
		const modified = page.getByTestId('diff-view-editor').locator('.editor.modified');
		await modified.click();
		await expect(modified.locator('.monaco-editor').first()).toHaveClass(/(^|\s)focused(\s|$)/);
		await page.keyboard.insertText(text);
	}

	/** The text Monaco is showing on the modified side. Read from the rendered
	 *  view lines, which is the only place a read-only editor's refusal is
	 *  observable: nothing is written either way, so "no write" alone would
	 *  pass against an editor that happily accepted the keystroke.
	 *
	 *  The two `:not()`s are the deleted/inserted **view zones** Monaco injects
	 *  into the modified pane to line the two sides up. They carry the same
	 *  `view-lines` class as the real one and are not part of the document. */
	function modifiedText(page: import('@playwright/test').Page) {
		return page
			.getByTestId('diff-view-editor')
			.locator('.editor.modified .view-lines:not(.line-delete):not(.line-insert)')
			.innerText();
	}

	/** What `write_file` was asked to write, in order. */
	function writeCalls(page: import('@playwright/test').Page) {
		return page.evaluate(() =>
			(window.__FACTORAI_TEST_CALLS__ ?? [])
				.filter((c) => c.name === 'write_file')
				.map((c) => ({ path: String(c.args?.path), contents: String(c.args?.contents) })),
		);
	}

	/** Open one group's row for `src/index.ts` — the file the fixture carries in
	 *  both the staged and the unstaged group.
	 *
	 *  Matched on the heading rather than on the section's text, because every
	 *  group's name ends in "Changes"; and on the exact `title`, because the
	 *  unstaged group also holds a *different* `index.ts` in a sibling package. */
	async function openChange(page: import('@playwright/test').Page, heading: RegExp) {
		await page
			.getByTestId('file-tree-panel')
			.locator('section')
			.filter({ has: page.locator('h3').filter({ hasText: heading }) })
			.locator('button[title="src/index.ts"]')
			.click();
		await expect(page.getByTestId('diff-view-editor')).toBeVisible();
	}

	test('@smoke the working-tree side of an uncommitted diff is editable, and Save writes it', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureWithChanges());
		await page.goto(PROJECT);
		await openPanel(page);
		await page.getByRole('tab', { name: 'Changes' }).click();
		await openChange(page, /^Changes/);

		await expect(page).toHaveURL(/diff=unstaged/);
		const viewer = page.getByTestId('file-viewer');
		// Nothing typed yet, so there is nothing to write — Save is the dirty
		// indicator, and the footer claims no reason to be read-only.
		await expect(viewer.getByTestId('viewer-save')).toBeDisabled();
		await expect(viewer.getByTestId('viewer-read-only')).toHaveCount(0);

		await typeInModifiedSide(page, 'edited-in-the-diff');
		await expect(viewer.getByTestId('viewer-save')).toBeEnabled();
		await viewer.getByTestId('viewer-save').click();

		// One write, to the working tree, carrying what was typed on top of what
		// the file already held.
		const writes = await writeCalls(page);
		expect(writes).toHaveLength(1);
		expect(writes[0].path).toMatch(/src\/index\.ts$/);
		expect(writes[0].contents).toContain('edited-in-the-diff');
		expect(writes[0].contents).toContain('export const a = 2;');
		await expect(viewer.getByTestId('viewer-save')).toBeDisabled();
		await expect(viewer.getByTestId('viewer-save-error')).toHaveCount(0);
	});

	test('@smoke a staged diff is read-only, because the index is not a file', async ({ page }) => {
		await installMockBridge(page, fixtureWithChanges());
		await page.goto(PROJECT);
		await openPanel(page);
		await page.getByRole('tab', { name: 'Changes' }).click();
		await openChange(page, /^Staged Changes/);

		const viewer = page.getByTestId('file-viewer');
		await expect(viewer.getByTestId('viewer-read-only')).toHaveText('index — read-only');
		// No Save at all rather than a disabled one: there is nothing this
		// surface could ever write.
		await expect(viewer.getByTestId('viewer-save')).toHaveCount(0);

		// The keystroke is refused by the editor, not merely left unsaved.
		const before = await modifiedText(page);
		await typeInModifiedSide(page, 'this must not land');
		expect(await modifiedText(page)).toBe(before);
		expect(await writeCalls(page)).toEqual([]);
		await expect(viewer.getByTestId('viewer-save')).toHaveCount(0);
	});

	test("@smoke a commit's diff is read-only at both ends", async ({ page }) => {
		await installMockBridge(page, fixtureWithChanges());
		// The URL F18's graph produces: a commit against its first parent, both
		// ends spelled out. There is no way to reach it from the Changes tab.
		const file = `/home/alice/code/foo/src/index.ts`;
		await page.goto(`${PROJECT}?file=${encodeURIComponent(file)}&diff=${SHA_MERGE}..${SHA_TIP}`);

		const viewer = page.getByTestId('file-viewer');
		await expect(page.getByTestId('diff-view-editor')).toBeVisible();
		await expect(viewer.getByTestId('viewer-read-only')).toHaveText('commit — read-only');
		await expect(viewer.getByTestId('viewer-save')).toHaveCount(0);

		// And the footer names the two commits rather than going blank, which is
		// what a lookup with no entry for a range used to do.
		await expect(viewer).toContainText(`${SHA_MERGE.slice(0, 7)} ↔ ${SHA_TIP.slice(0, 7)}`);

		const before = await modifiedText(page);
		await typeInModifiedSide(page, 'history is not a scratchpad');
		expect(await modifiedText(page)).toBe(before);
		expect(await writeCalls(page)).toEqual([]);
	});
});
