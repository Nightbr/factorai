import { expect, test } from '@playwright/test';
import { installMockBridge, type TestFixture } from '../smoke/fixtures';
import { around, shot } from './capture';
import { HOME, IDS, world } from './world';

/**
 * The Changes tab and a diff (guide: files/changes.md), in billing-api with a
 * session open beside it.
 */

const ROOT = `${HOME}/billing-api`;
const PTY = 'docs-changes-agent';

type Fx = Required<Pick<TestFixture, 'files' | 'gitStatuses'>>;
type Contents = Fx['files'][string];
type Change = Fx['gitStatuses'][string]['changes'][number];

function contents(path: string, text: string): Contents {
	return {
		path,
		contents: text,
		size: new TextEncoder().encode(text).length,
		isBinary: false,
		truncated: false,
		lineCount: text.replace(/\n$/, '').split('\n').length,
		lossy: false,
		sopsEncrypted: false,
	};
}

function change(relPath: string, over: Partial<Change> = {}): Change {
	return {
		path: `${ROOT}/${relPath}`,
		relPath,
		group: 'unstaged',
		kind: 'modified',
		oldRelPath: null,
		additions: 12,
		deletions: 3,
		isBinary: false,
		...over,
	};
}

const RETRY_TS = `import { stripe } from '../stripe';
import { db } from '../db';
import type Stripe from 'stripe';

/** How long a delivery is remembered, so a retry of it is recognised. */
const SEEN_FOR_MS = 72 * 60 * 60 * 1000;

export interface RetryOutcome {
	invoiceId: string;
	duplicate: boolean;
}

/**
 * Handle a webhook delivery Stripe may already have sent.
 *
 * Stripe retries a delivery it saw no 2xx for, with the same event id, for
 * up to three days. The invoice is keyed on that id, so a retry finds the
 * row it created the first time instead of writing a second one.
 */
export async function handleInvoiceEvent(event: Stripe.Event): Promise<RetryOutcome> {
	const seen = await db.webhookEvents.find(event.id);
	if (seen && Date.now() - seen.receivedAt < SEEN_FOR_MS) {
		return { invoiceId: seen.invoiceId, duplicate: true };
	}

	const invoice = event.data.object as Stripe.Invoice;
	const row = await db.invoices.upsert({
		stripeInvoiceId: invoice.id,
		customerId: String(invoice.customer),
		amountDue: invoice.amount_due,
		currency: invoice.currency,
	});

	await db.webhookEvents.insert({ id: event.id, invoiceId: row.id, receivedAt: Date.now() });
	return { invoiceId: row.id, duplicate: false };
}

export async function replayFailed(since: Date): Promise<number> {
	const failed = await stripe.events.list({ created: { gte: Math.floor(since.getTime() / 1000) } });
	let replayed = 0;
	for (const event of failed.data) {
		if (event.type.startsWith('invoice.')) {
			await handleInvoiceEvent(event);
			replayed += 1;
		}
	}
	return replayed;
}
`;

const RETRY_OLD = RETRY_TS.replace(
	`	const seen = await db.webhookEvents.find(event.id);
	if (seen && Date.now() - seen.receivedAt < SEEN_FOR_MS) {
		return { invoiceId: seen.invoiceId, duplicate: true };
	}

	const invoice = event.data.object as Stripe.Invoice;
	const row = await db.invoices.upsert({`,
	`	const invoice = event.data.object as Stripe.Invoice;
	const row = await db.invoices.insert({
		chargeId: String(invoice.charge),`,
)
	.replace(
		`
	await db.webhookEvents.insert({ id: event.id, invoiceId: row.id, receivedAt: Date.now() });
`,
		'\n',
	)
	.replace(
		`/** How long a delivery is remembered, so a retry of it is recognised. */
const SEEN_FOR_MS = 72 * 60 * 60 * 1000;

`,
		'',
	);

function fixture(): TestFixture {
	const retry = `${ROOT}/src/invoices/retry.ts`;
	const changes: Change[] = [
		change('src/subscriptions/sync.ts', {
			group: 'conflicted',
			kind: 'conflicted',
			additions: null,
			deletions: null,
		}),
		change('src/db.ts', { group: 'staged', additions: 9, deletions: 2 }),
		change('migrations/0042_webhook_events.sql', {
			group: 'staged',
			kind: 'added',
			additions: 14,
			deletions: 0,
		}),
		change('src/invoices/retry.ts', { additions: 11, deletions: 3 }),
		change('src/invoices/webhooks.ts', { additions: 6, deletions: 9 }),
		change('tests/retry.test.ts', { kind: 'untracked', additions: 42, deletions: 0 }),
		change('README.md', { additions: 2, deletions: 1 }),
	];
	return {
		...world(),
		terminalSpawnId: PTY,
		files: { [retry]: contents(retry, RETRY_TS) },
		gitBlobs: { [`index:${retry}`]: contents(retry, RETRY_OLD) },
		gitStatuses: {
			[ROOT]: {
				repoRoot: ROOT,
				branch: 'fix/duplicate-invoices',
				head: 'c0ffee1'.padEnd(40, '0'),
				changes,
				total: changes.length,
				truncated: false,
			},
		},
	};
}

const SESSION = `${IDS.billing.slice(0, 8)}-5e55-4000-8000-000000000001`;

test('changes: the groups, and a diff open inline', async ({ page }) => {
	await installMockBridge(page, fixture());
	await page.goto(`/#/projects/${IDS.billing}/sessions/${SESSION}`);
	await expect(page.locator('.xterm').first()).toBeVisible();
	await page.getByRole('button', { name: 'Toggle file tree' }).click();
	await page.getByRole('tab', { name: 'Changes' }).click();
	const panel = page.getByTestId('file-tree-panel');
	await expect(panel).toContainText('Merge Changes');
	await panel
		.locator('section')
		.filter({ hasText: /^Changes/ })
		.getByRole('button', { name: /retry\.ts/ })
		.click();
	const viewer = page.getByTestId('file-viewer');
	await expect(viewer.getByTestId('diff-view-editor')).toBeVisible();
	const toggle = viewer.getByRole('button', { name: 'Inline' });
	if (await toggle.isVisible()) await toggle.click();
	await expect(viewer.getByRole('button', { name: 'Split' })).toBeVisible();
	await page.waitForTimeout(600);
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await shot(page, 'changes-diff', await around([viewer, panel], 0));
});
