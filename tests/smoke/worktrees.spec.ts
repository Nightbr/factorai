import { expect, test } from '@playwright/test';
import {
	FOO_ID,
	fixtureAgentMovedWithoutSaying,
	fixtureAgentWorkedByAbsolutePath,
	fixtureDetachedCheckout,
	fixtureOneProjectOneSession,
	fixtureSessionInAWorktree,
	installMockBridge,
} from './fixtures';

const IN_WORKTREE = `/#/projects/${FOO_ID}/sessions/session-uuid-002`;
const IN_PROJECT = `/#/projects/${FOO_ID}/sessions/session-uuid-001`;

/** The commands the mock bridge could not perform, so a test can assert one was
 *  attempted. */
function mockCalls(page: import('@playwright/test').Page): Promise<string[]> {
	return page.evaluate(
		() =>
			(
				window as unknown as { __FACTORAI_TEST_CALLS__?: { name: string }[] }
			).__FACTORAI_TEST_CALLS__?.map((c) => c.name) ?? [],
	);
}

async function openPanel(page: import('@playwright/test').Page) {
	await page.getByRole('button', { name: 'Toggle file tree' }).click();
	await expect(page.getByTestId('file-tree-panel')).toBeVisible();
}

/**
 * The panel follows the checkout the session is working in (F21).
 *
 * These drive the *resolution*, not the signal: the mock bridge has no IDE
 * socket, so what is exercised is the persisted `worktree` column and the
 * `cwd` fallback — which is exactly the half that has to work when the agent
 * never calls the tool.
 */
test.describe('worktrees', () => {
	test('@smoke the panel roots on the session’s worktree, not the project folder', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureSessionInAWorktree());
		await page.goto(IN_WORKTREE);
		await openPanel(page);

		// The tree's root row is the checkout, so the file only that checkout holds
		// is the proof it re-rooted.
		await expect(page.getByText('switcher.ts')).toBeVisible();
	});

	test('@smoke the header names the worktree beside the branch', async ({ page }) => {
		await installMockBridge(page, fixtureSessionInAWorktree());
		await page.goto(IN_WORKTREE);

		const badge = page.getByTestId('session-worktree');
		await expect(badge).toBeVisible();
		await expect(badge).toContainText('feature-x');
		// **Two facts that agree about where you are.** The branch badge names the
		// *checkout's* branch, not the project's — it said `main` beside a worktree
		// on another branch for one commit, which made the pair contradict.
		await expect(page.getByTestId('session-branch')).toContainText('feature-x');
	});

	test('@smoke the header and the panel call the checkout the same thing', async ({ page }) => {
		// They disagreed for one commit — `wt-demo` in the header, `demo/worktree`
		// in the panel — which reads as two different places.
		await installMockBridge(page, fixtureSessionInAWorktree());
		await page.goto(IN_WORKTREE);
		await openPanel(page);

		const header = await page.getByTestId('session-worktree').innerText();
		const panel = await page.getByTestId('panel-checkout').innerText();
		expect(panel.trim()).toBe(header.trim());
	});

	test('@smoke a single-checkout project gets no worktree furniture at all', async ({ page }) => {
		// The 95% case, and the one that must look exactly as it did before F21.
		// **The gate is the repository having one checkout**, not the session being
		// on the project's own: once there are two, which one you are in is a fact
		// worth a mark either way — and it is where the picker lives.
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto(IN_PROJECT);
		await openPanel(page);

		await expect(page.getByTestId('session-worktree')).toHaveCount(0);
		await expect(page.getByTestId('panel-checkout')).toHaveCount(0);
	});

	test('@smoke the mark names the project’s own checkout when there is more than one', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureSessionInAWorktree());
		await page.goto(IN_PROJECT);
		await openPanel(page);

		// The header says which checkout — the panel does not, because the panel's
		// mark answers "is this tree the project's own", and here it is.
		await expect(page.getByTestId('session-worktree')).toContainText('foo');
		await expect(page.getByTestId('panel-checkout')).toHaveCount(0);
	});

	test('@smoke picking a checkout roots the panel on it', async ({ page }) => {
		// **The case no inference can reach**, and why the picker shipped: an agent
		// that creates a worktree and then drives it by `git -C` and absolute paths
		// never moves its own cwd and never opens a file through the bridge, so
		// there is nothing at all to follow.
		await installMockBridge(page, fixtureSessionInAWorktree());
		await page.goto(IN_PROJECT);
		await openPanel(page);

		await page.getByTestId('session-worktree').click();
		await page.getByRole('menuitemradio', { name: /feature-x/ }).click();

		await expect(page.getByTestId('session-worktree')).toContainText('feature-x');
		// The file only the worktree holds — the panel really re-rooted, rather
		// than the header alone changing its mind.
		await expect(page.getByText('switcher.ts')).toBeVisible();
		// And it is remembered, or the pick would last exactly as long as this
		// renderer does.
		await expect.poll(() => mockCalls(page)).toContain('set_session_worktree');
	});

	test('@smoke a pick outranks a signal for the same session', async ({ page }) => {
		// An agent that never learned `setWorktree` is exactly the agent whose every
		// `openFile` is an inference — so without this, a pick lasts until the agent
		// touches a file, which reads as a control that does not work.
		await installMockBridge(page, fixtureSessionInAWorktree());
		await page.goto(IN_WORKTREE);

		await page.getByTestId('session-worktree').click();
		await page.getByRole('menuitemradio', { name: /^foo/ }).click();
		await expect(page.getByTestId('session-worktree')).toContainText('foo');

		await page.evaluate(() => {
			(
				window as unknown as {
					__FACTORAI_EMIT__?: (name: string, payload: unknown) => void;
				}
			).__FACTORAI_EMIT__?.('session:worktree', {
				sessionId: 'session-uuid-002',
				path: '/home/alice/code/worktrees/feature-x',
				branch: 'feature-x',
			});
		});

		await expect(page.getByTestId('session-worktree')).toContainText('foo');
	});

	test('@smoke the tree names the checkout beside its root folder', async ({ page }) => {
		// On the root row, not in the tab strip — that row already holds three tabs
		// and two icons at 288px. Changed 2026-08-21 on user feedback.
		await installMockBridge(page, fixtureSessionInAWorktree());
		await page.goto(IN_WORKTREE);
		await openPanel(page);

		const mark = page.getByTestId('panel-checkout');
		await expect(mark).toContainText('feature-x');
		// On a tree row, not in the tab strip — asserted both ways round, because
		// "it is visible somewhere in the panel" is what the old placement also
		// satisfied.
		await expect(page.locator('li').filter({ has: mark })).toHaveCount(1);
		await expect(page.getByRole('tablist').getByTestId('panel-checkout')).toHaveCount(0);
	});

	test('@smoke it follows an agent that moved and never said so', async ({ page }) => {
		// **The bug this fallback exists for**, seen in a real session: the agent
		// created a worktree, `cd`'d into it, and signalled nothing at all. The only
		// trace is the session's last cwd, and reading its *first* is why the panel
		// sat on main.
		await installMockBridge(page, fixtureAgentMovedWithoutSaying());
		await page.goto(IN_WORKTREE);
		await openPanel(page);

		await expect(page.getByTestId('session-worktree')).toContainText('feature-x');
		await expect(page.getByText('switcher.ts')).toBeVisible();
	});

	test('@smoke it follows an agent that never moved its cwd at all', async ({ page }) => {
		// The second shape, and the one no cwd can catch: `git worktree add`, then
		// `git -C` and absolute paths for everything after it. Both cwds name the
		// project, correctly, and the only trace of the real tree is the files the
		// agent's own tools touched.
		await installMockBridge(page, fixtureAgentWorkedByAbsolutePath());
		await page.goto(IN_WORKTREE);
		await openPanel(page);

		await expect(page.getByTestId('session-worktree')).toContainText('feature-x');
		await expect(page.getByText('switcher.ts')).toBeVisible();
	});

	test('@smoke a checkout on no branch says which commit it is on', async ({ page }) => {
		// The badge used to be absent here, which is right for a folder that is not
		// a repository and wrong for this: beside a checkout mark that is present,
		// nothing reads as "no idea" rather than as "no branch".
		await installMockBridge(page, fixtureDetachedCheckout());
		await page.goto(IN_WORKTREE);

		const badge = page.getByTestId('session-branch');
		await expect(badge).toContainText('ccccccc');
		await expect(badge).toHaveAttribute('title', `Detached HEAD at ${'c'.repeat(40)}`);

		// And the menu row says it in words, where there is room for words.
		await page.getByTestId('session-worktree').click();
		await expect(page.getByRole('menuitemradio', { name: /detached HEAD/ })).toBeVisible();
	});

	test('@smoke the revert returns the panel to the session’s own checkout', async ({ page }) => {
		await installMockBridge(page, fixtureSessionInAWorktree());
		await page.goto(IN_WORKTREE);

		// Inside the picker since it shipped: the header carries one control for
		// the checkout, not two, and the undo is one of the things it can do.
		await page.getByTestId('session-worktree').click();
		await page.getByRole('menuitem', { name: "Back to this session's own checkout" }).click();

		// The record is cleared through the backend, not only in the renderer —
		// otherwise the stored row wins again on the next read.
		await expect.poll(() => mockCalls(page)).toContain('clear_session_worktree');
	});
});
