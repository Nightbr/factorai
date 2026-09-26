import { expect, test } from '@playwright/test';
import { installMockBridge, type TestFixture } from '../smoke/fixtures';
import { around, shot } from './capture';
import { HOME, IDS, world } from './world';

/**
 * The session header's checkout menu (guide: advanced/worktrees.md): a
 * billing-api session working in a worktree, with the repository's other
 * checkouts listed.
 */

const ROOT = `${HOME}/billing-api`;
const TREES = `${HOME}/worktrees`;
const FIX = `${TREES}/duplicate-invoices`;
const SESSION = `${IDS.billing.slice(0, 8)}-5e55-4000-8000-000000000001`;

type Worktree = Required<TestFixture>['gitWorktrees'][string][number];
type Status = Required<TestFixture>['gitStatuses'][string];

function tree(path: string, name: string | null, branch: string, over: Partial<Worktree> = {}) {
	return {
		path,
		name,
		branch,
		head: `${branch.length.toString(16)}`.padEnd(40, 'a'),
		isMain: false,
		locked: false,
		prunable: false,
		exists: true,
		...over,
	} satisfies Worktree;
}

function status(branch: string): Status {
	return {
		repoRoot: ROOT,
		branch,
		head: 'c0ffee1'.padEnd(40, '0'),
		changes: [],
		total: 0,
		truncated: false,
	};
}

function fixture(): TestFixture {
	const w = world();
	const sessions = w.sessionsByProject[IDS.billing].map((s) =>
		s.id === SESSION ? { ...s, cwd: FIX, worktree: FIX } : s,
	);
	return {
		...w,
		terminalSpawnId: 'docs-worktrees-agent',
		sessionsByProject: { ...w.sessionsByProject, [IDS.billing]: sessions },
		gitStatuses: {
			[ROOT]: status('main'),
			[FIX]: status('fix/duplicate-invoices'),
		},
		gitWorktrees: {
			[ROOT]: [
				tree(ROOT, null, 'main', { isMain: true }),
				tree(FIX, 'duplicate-invoices', 'fix/duplicate-invoices'),
				tree(`${TREES}/proration-preview`, 'proration-preview', 'feat/proration-preview', {
					locked: true,
				}),
				tree(`${TREES}/checkout-e2e`, 'checkout-e2e', 'test/checkout-e2e', {
					exists: false,
					prunable: true,
				}),
			],
		},
	};
}

test('worktrees: the header menu listing the checkouts', async ({ page }) => {
	await installMockBridge(page, fixture());
	await page.goto(`/#/projects/${IDS.billing}/sessions/${SESSION}`);
	const badge = page.getByTestId('session-worktree');
	await expect(badge).toContainText('duplicate-invoices');
	await expect(page.locator('.xterm').first()).toBeVisible();
	// No blinking block in an empty terminal under the menu.
	await page.evaluate(() =>
		window.__FACTORAI_EMIT__?.('terminal:data', {
			id: 'docs-worktrees-agent',
			bytesB64: btoa('\x1b[?25l'),
		}),
	);
	await badge.click();
	const menu = page.getByRole('menu');
	await expect(menu.getByRole('menuitemradio', { name: /proration-preview/ })).toBeVisible();
	await page.mouse.move(-10, -10);
	const box = await around([page.getByTestId('session-branch'), badge, menu], 16);
	// Far enough left to take in the project's name at the start of the header.
	const x = Math.max(0, box.x - 82);
	await shot(page, 'worktrees-checkout-menu', { ...box, x, width: box.width + box.x - x });
});
