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
 * **Lane assignment is not tested here.** It is the feature, and it is tested in
 * Rust against `tempdir` repositories, where a merge or an octopus layout can be
 * asserted directly. What is left for the browser is what the renderer decides:
 * that the tab mounts, folds its chips, opens a detail, survives a project
 * switch, pages, and answers the arrow keys.
 *
 * The rest grew from bug reports, and that is the rule for adding to it — the
 * suite is already well past the few-seconds budget claimed for it
 * (`08-inconsistencies.md` E1), so a case earns its ~0.5s by being something
 * that already regressed once. The
 * split drag is still recorded against roadmap item 10 rather than covered here.
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
		// **The label is the branch name and nothing else** (changed 2026-08-18):
		// `HEAD→main ≡origin` spent the entire ref budget at 288px on 4 characters
		// of branch name. Both decorations are marks now, and the sentence they
		// compress is the chip's tooltip — which is the assertion worth making,
		// because a mark nobody can decode is worse than the text it replaced.
		await expect(tip).toContainText('main');
		await expect(tip.locator('span[title]').first()).toHaveAttribute(
			'title',
			'Local branch main · checked out (HEAD) · in sync with origin/main',
		);
		// `origin/main` never appears on its own — that is the folding, and it is
		// the assertion worth making, because the alternative spends a slot saying
		// the same thing twice.
		await expect(tip).not.toContainText('origin/main');
		// At the default 288px the remaining chip *still* doesn't fit beside a
		// readable subject, so it collapses to `+1` — which is the whole point of
		// having `+N`. One, not two: the fold saved a slot even though the fit
		// didn't.
		await expect(tip).toContainText('+1');

		// One rail per row: lanes are drawn, not described. Named rather than
		// counted as "the row's only svg", which stopped being true once ref chips
		// grew icons.
		await expect(tip.getByTestId('graph-rail')).toHaveCount(1);

		// Clicking goes deeper — body and file list, the half the hover card
		// deliberately doesn't carry.
		await page.getByTestId('commit-row').nth(1).click();
		const detail = page.getByTestId('commit-detail');
		await expect(detail).toBeVisible();

		// **The files are what you see first, and that is the point of the tabs**
		// (2026-08-18): the pane used to stack subject, body, author and parents
		// above the list, so at the default height clicking a commit showed
		// everything about it except what you clicked for.
		//
		// Basename and directory are separate spans, per `FileChangeRow` — the
		// filename first and the path dimmed after it, which is F13's row verbatim.
		await expect(detail).toContainText('index.ts');
		await expect(detail).toContainText('+7');

		// Identity sits above the tabs, so it survives whichever one is open —
		// author, date, and the parent chips that are how you walk history. A merge
		// names the parent its diff is against rather than leaving the reader to
		// remember the convention; `SHA_MAIN` is the first parent.
		await expect(detail).toContainText('Titouan');
		await expect(detail).toContainText(`${SHA_MAIN.slice(0, 7)} (diffed)`);
		await expect(detail).toContainText(SHA_SIDE.slice(0, 7));

		// The body is a tab away rather than above the list — uncapped there,
		// where it used to be clamped to 80px precisely to stop it swallowing the
		// pane.
		await expect(detail).not.toContainText('A body paragraph');
		await detail.getByRole('tab', { name: 'Description' }).click();
		await expect(detail).toContainText('A body paragraph, which the row had no room for.');
		await expect(detail).not.toContainText('index.ts');

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

		const line = page.getByText('Not a git repository.');
		await expect(line).toBeVisible();
		// The strip must not reflow as you move between projects.
		await expect(page.getByRole('tab', { name: 'Graph' })).toBeVisible();

		// **The same sentence, on the same pixel, on the tab next door.** Changes
		// shows this line too, and the graph's used to sit 4px above it: Files and
		// Changes render inside a `py-1` scroll wrapper in `FileTreePanel` and the
		// graph, which owns its own scrolling, renders outside it. Asserted rather
		// than eyeballed because the two are one click apart and 4px is exactly the
		// size of thing that comes back.
		const inGraph = await line.boundingBox();
		await page.getByRole('tab', { name: 'Changes' }).click();
		await expect(page.getByTestId('changes-view')).toHaveCount(0);
		const inChanges = await page.getByText('Not a git repository.').boundingBox();
		expect(inGraph?.y).toBe(inChanges?.y);
	});

	test('@smoke sweeping the list leaves one card, and a long ref stays inside it', async ({
		page,
	}) => {
		const fx = fixtureWithGraph();
		const root = fx.projects?.[0]?.realPath ?? '';
		const graph = fx.gitGraphs?.[root];
		// A ref no cap and no card can show whole, which is what both halves of this
		// test are about. On the side branch, so the tip keeps its four-ref case.
		if (graph) {
			graph.commits[3].refs = [
				{
					name: 'feature/a-very-long-branch-name-that-nobody-would-truncate',
					kind: 'localBranch',
					isHead: false,
					upstreamInSync: null,
				},
			];
		}
		await installMockBridge(page, fx);
		await page.goto(PROJECT);
		await openGraph(page);

		const rows = page.getByTestId('commit-row');
		await expect(rows).toHaveCount(5);

		// **One card at a time.** Every row is its own Radix `HoverCard` root and
		// roots know nothing of each other, so with `openDelay: 0` a sweep opened a
		// card per row crossed — five stacked over the session pane, each waiting out
		// its own close delay. Reported as commits that persist while you move.
		// `GraphBody` holds the open row for the whole list now.
		const cards = page.locator('[data-radix-popper-content-wrapper]');
		// Raw moves and a count after each, not `hover()` and a retrying
		// `toHaveCount`: the cards did close, 150ms later, so anything that waits
		// sees one card and passes against the bug. What must never happen is a
		// *second* card being open at the same time as the first.
		const open: number[] = [];
		for (let index = 0; index < 5; index++) {
			const box = await rows.nth(index).boundingBox();
			await page.mouse.move((box?.x ?? 0) + 40, (box?.y ?? 0) + 13);
			open.push(await cards.count());
		}
		expect(Math.max(...open)).toBeLessThanOrEqual(1);
		// And the one still up is the row the pointer is on, not one it passed.
		await expect(cards).toHaveCount(1);
		await expect(cards).toContainText('chore: where the two branches parted');

		// The card is where a truncated name becomes readable, so the chip wraps
		// inside it rather than printing across the graph beside it — which is what
		// an unbounded flex item sized by a 56-character ref did.
		await rows.nth(3).hover();
		await expect(cards).toHaveCount(1);
		await expect(cards).toContainText('feature/a-very-long-branch-name-that-nobody-would-truncate');
		const card = await cards.boundingBox();
		const chip = await cards.locator('span[title]').first().boundingBox();
		expect(chip?.width).toBeLessThanOrEqual(card?.width ?? 0);

		// The row keeps its cap while the card is open — it used to lift on the
		// chip's own hover, which took the subject off the row and overflowed the
		// panel with a name that still didn't fit.
		await expect(rows.nth(3)).toContainText('feat: work done on the side branch');
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
		await expect(page.getByTestId('commit-detail')).toContainText('zulu commit 0');

		await page.goto(`/#/projects/${ALPHA_ID}`);

		// alpha's two commits, and — the actual blind spot — **no** detail pane,
		// because a SHA from zulu would open a pane for a commit that isn't on
		// screen. The selection carries its project for exactly this.
		await expect(page.getByTestId('commit-row')).toHaveCount(2);
		await expect(page.getByText('bb commit 0')).toBeVisible();
		await expect(page.getByText('aa commit 0')).toHaveCount(0);
		await expect(page.getByTestId('commit-detail')).toHaveCount(0);

		await page.getByTestId('commit-row').first().click();
		await expect(page.getByTestId('commit-detail')).toContainText('alpha commit 0');

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

	test('@smoke the working-changes row follows the project', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectGraphs());
		await page.goto(`/#/projects/${ZULU_ID}`);
		await openGraph(page);

		// zulu has an uncommitted change, so the working tree gets a row of its own
		// above HEAD, carrying the count. Its node is dashed, because nothing in it
		// is a commit yet.
		const working = page.getByTestId('working-row');
		await expect(working).toBeVisible();
		await expect(working).toContainText('Working changes');
		await expect(working).toContainText('1');
		await expect(working.locator('circle')).toHaveAttribute('stroke-dasharray', /\d/);

		// alpha is clean, so there is no such row. One that stayed would be claiming
		// changes that aren't there.
		await page.goto(`/#/projects/${ALPHA_ID}`);
		await expect(page.getByTestId('commit-row').first()).toBeVisible();
		await expect(page.getByTestId('working-row')).toHaveCount(0);
	});

	test('@smoke the working row opens the Changes tab', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectGraphs());
		await page.goto(`/#/projects/${ZULU_ID}`);
		await openGraph(page);

		// The row's whole reason for being clickable: the graph says *that* there is
		// uncommitted work, and the Changes tab is where you find out what.
		await page.getByTestId('working-row').click();
		await expect(page.getByRole('tab', { name: 'Changes' })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await expect(page.getByTestId('graph-view')).toHaveCount(0);
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

		// `diffParent: null` — there is nothing to diff against, so the tab says
		// what the files are rather than implying a comparison.
		await expect(detail.getByRole('tab', { name: /Added/ })).toBeVisible();
		await expect(detail).not.toContainText('Parent');
		await expect(detail).toContainText('README.md');
	});
});
