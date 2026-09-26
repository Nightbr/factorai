import { expect, test, type Page } from '@playwright/test';
import { installMockBridge, type TestFixture } from '../smoke/fixtures';
import { around, shot } from './capture';
import { IDS, world } from './world';

type SearchHit = NonNullable<TestFixture['searchHits']>[number];
type Status = 'working' | 'waiting_input' | 'stopped';

const w = () => world();

/** Open a session from the sidebar under its own PTY id, so each tab can be
 *  given its own status afterwards (the mock hands every spawn the fixture's
 *  `terminalSpawnId`, read at call time). */
async function open(page: Page, title: string, ptyId: string) {
	await page.evaluate((id) => {
		if (window.__FACTORAI_TEST__) window.__FACTORAI_TEST__.terminalSpawnId = id;
	}, ptyId);
	await page
		.getByRole('link', { name: new RegExp(title) })
		.first()
		.click();
	await expect(page.locator('.xterm:visible')).toBeVisible();
}

async function status(page: Page, id: string, s: Status) {
	await page.evaluate(
		({ id, s }) =>
			window.__FACTORAI_EMIT__?.('terminal:status', { id, status: s, lastActivity: Date.now() }),
		{ id, s },
	);
}

async function write(page: Page, id: string, text: string) {
	await page.evaluate(
		({ id, text }) =>
			window.__FACTORAI_EMIT__?.('terminal:data', {
				id,
				bytesB64: btoa(unescape(encodeURIComponent(text))),
			}),
		{ id, text: text.replace(/\n/g, '\r\n') },
	);
}

async function rest(page: Page) {
	await page.mouse.move(-10, -10);
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.waitForTimeout(300);
}

async function expandAll(page: Page) {
	await page.getByRole('button', { name: 'Sort and expand projects' }).click();
	await page.getByRole('menuitem', { name: 'Expand all' }).click();
}

const TRANSCRIPT = [
	'\x1b[1m> Stripe retries are duplicating invoices. Find out why.\x1b[0m',
	'',
	'\x1b[36m●\x1b[0m Reading src/webhooks/stripe.ts',
	'\x1b[36m●\x1b[0m Reading src/invoices/create.ts',
	'',
	'The webhook handler creates an invoice before it records the event id, so',
	'a retried delivery passes the duplicate check. Moving the insert of',
	'`stripe_events.id` into the same transaction as the invoice fixes it.',
	'',
	'\x1b[36m●\x1b[0m Editing src/webhooks/stripe.ts \x1b[2m(+14 -6)\x1b[0m',
	'',
].join('\n');

test('sessions: tabs and the session header', async ({ page }) => {
	await installMockBridge(page, w());
	await page.goto('/');
	await expandAll(page);
	await open(page, 'Move Jellyfin', 'pty-jellyfin');
	await open(page, 'Write the install page', 'pty-install');
	await open(page, 'Stripe retries', 'pty-stripe');
	await status(page, 'pty-jellyfin', 'stopped');
	await status(page, 'pty-install', 'waiting_input');
	await status(page, 'pty-stripe', 'working');
	await write(page, 'pty-stripe', TRANSCRIPT);
	await rest(page);
	// The tab strip, the header under it and the first lines of the agent's
	// output: enough terminal to say what the tab holds.
	await shot(page, 'sessions-tabs', { x: 0, y: 0, width: 880, height: 270 });
	// Every dot the sidebar can show at once: working, waiting, stopped.
	const sidebar = await around([page.getByTestId('sidebar')], 0);
	await shot(page, 'sessions-status', { ...sidebar, y: 96, height: 520 });
});

test('sessions: the project page lists its sessions', async ({ page }) => {
	const fx = w();
	const billing = fx.projects[0];
	const more = [
		['Webhook signature check fails behind the proxy', 6 * 86_400_000],
		['Add idempotency keys to the refunds endpoint', 9 * 86_400_000],
		['Upgrade the Stripe SDK to v17', 13 * 86_400_000],
	] as const;
	const list = fx.sessionsByProject[billing.id];
	more.forEach(([title, ago], i) => {
		const base = list[0];
		list.push({
			...base,
			id: `${base.id.slice(0, -2)}${String(10 + i)}`,
			title,
			updatedAt: Date.now() - ago,
			createdAt: Date.now() - ago - 3_600_000,
			turnCount: 20 + i * 11,
		});
	});
	list[2] = { ...list[2], pinned: true };
	fx.projects[0] = { ...billing, sessionCount: list.length };
	await installMockBridge(page, fx);
	await page.goto(`/#/projects/${IDS.billing}`);
	const main = page.locator('main');
	await expect(main).toContainText('Upgrade the Stripe SDK');
	await rest(page);
	// The page itself, from its title to the last row — the sidebar beside it
	// is collapsed groups and says nothing here.
	const title = page.locator('main').getByText('/home/ada/code/billing-api');
	const last = page.locator('main').getByText('Upgrade the Stripe SDK to v17');
	const newSession = page.locator('main').getByRole('button', { name: /New session/ });
	const box = await around([title, last, newSession], 28);
	// Down past the list's bottom border, and clear of the top bar's rule.
	await shot(page, 'sessions-project-page', { ...box, y: box.y + 6, height: box.height + 8 });
});

test('sessions: the right-click menu on a session row', async ({ page }) => {
	await installMockBridge(page, w());
	await page.goto('/');
	await page.getByRole('button', { name: 'Expand Pro', exact: true }).click();
	await page.getByRole('button', { name: 'Expand billing-api', exact: true }).click();
	const row = page.getByRole('link', { name: /Flaky e2e on CI/ }).first();
	await row.click({ button: 'right' });
	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	const header = page.getByTestId('sidebar').getByText('Projects', { exact: true });
	await shot(
		page,
		'sessions-row-menu',
		await around(
			[header, page.getByTestId('add-project-menu'), page.getByTestId('projects'), menu],
			12,
		),
	);
});

test('sessions: search results', async ({ page }) => {
	const fx = w();
	const hit = (
		projectIndex: number,
		sessionIndex: number,
		role: 'user' | 'assistant',
		snippet: string,
	): SearchHit => {
		const p = fx.projects[projectIndex];
		const s = fx.sessionsByProject[p.id][sessionIndex];
		return {
			sessionId: s.id,
			projectId: p.id,
			projectName: p.displayName,
			projectPath: p.realPath,
			title: s.title,
			role,
			snippet,
			agent: 'claude',
		};
	};
	await installMockBridge(page, {
		...fx,
		searchHits: [
			hit(
				0,
				0,
				'assistant',
				'a retried delivery passes the duplicate check, so the webhook creates a second invoice …',
			),
			hit(
				0,
				1,
				'user',
				'the checkout spec times out when the webhook retry lands before the redirect …',
			),
			hit(
				2,
				1,
				'assistant',
				'the backup job retries every ten minutes after a failure, which is what wakes the NAS …',
			),
			hit(1, 0, 'user', 'mention that the updater retries a failed download on the next launch …'),
		],
	});
	await page.goto('/');
	await page.getByPlaceholder('Search sessions…').fill('retry');
	await expect(page.getByText(/wakes the NAS/)).toBeVisible();
	await rest(page);
	const results = await around([page.getByText(/updater retries a failed download/)], 0);
	await shot(page, 'sessions-search', {
		x: 0,
		y: 0,
		width: 1440,
		height: results.y + results.height + 24,
	});
});
