import { expect, type Page, test } from '@playwright/test';
import { installMockBridge, type TestFixture } from '../smoke/fixtures';
import { around, shot } from './capture';
import { HOME, IDS, world } from './world';

/**
 * The Files tab and the viewer (guide: files/index.md), in billing-api with a
 * session open beside it.
 */

const ROOT = `${HOME}/billing-api`;
const PTY = 'docs-files-agent';

type Fx = Required<Pick<TestFixture, 'dirListings' | 'files' | 'gitStatuses'>>;
type Listing = Fx['dirListings'][string];
type Entry = Listing['entries'][number];
type Contents = Fx['files'][string];
type Change = Fx['gitStatuses'][string]['changes'][number];

function entry(dir: string, name: string, over: Partial<Entry> = {}): Entry {
	return {
		name,
		path: `${dir}/${name}`,
		isDir: false,
		isSymlink: false,
		symlinkOutsideRoot: false,
		size: 2048,
		modifiedAt: null,
		ignored: false,
		...over,
	};
}

function listing(entries: Entry[]): Listing {
	return { entries, total: entries.length, truncated: false };
}

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

const README = `---
title: billing-api
owner: payments
on_call: https://oncall.example.com/payments
---

# billing-api

Invoices, subscriptions and the Stripe webhooks that keep them in sync.

## Running it

\`\`\`sh
pnpm install
pnpm dev          # http://localhost:4010
pnpm test         # vitest, against a throwaway Postgres
\`\`\`

## How a payment flows

\`\`\`mermaid
graph LR
  Checkout --> Stripe
  Stripe -->|webhook| Handler[invoices/webhooks.ts]
  Handler --> Postgres
\`\`\`

| Event | Handled in |
| --- | --- |
| \`invoice.paid\` | \`webhooks.ts\` |
| \`invoice.payment_failed\` | \`retry.ts\` |
| \`customer.updated\` | \`sync.ts\` |

See [the runbook](docs/runbook.md) before replaying events in production.
`;

function billingTree(): Fx {
	const src = `${ROOT}/src`;
	const inv = `${src}/invoices`;
	return {
		dirListings: {
			[ROOT]: listing([
				entry(ROOT, '.github', { isDir: true }),
				entry(ROOT, 'docs', { isDir: true }),
				entry(ROOT, 'migrations', { isDir: true }),
				entry(ROOT, 'node_modules', { isDir: true, ignored: true }),
				entry(ROOT, 'src', { isDir: true }),
				entry(ROOT, 'tests', { isDir: true }),
				entry(ROOT, '.env.local', { ignored: true }),
				entry(ROOT, 'package.json'),
				entry(ROOT, 'pnpm-lock.yaml'),
				entry(ROOT, 'README.md'),
				entry(ROOT, 'tsconfig.json'),
			]),
			[src]: listing([
				entry(src, 'invoices', { isDir: true }),
				entry(src, 'subscriptions', { isDir: true }),
				entry(src, 'db.ts'),
				entry(src, 'server.ts'),
				entry(src, 'stripe.ts'),
			]),
			[inv]: listing([
				entry(inv, 'index.ts'),
				entry(inv, 'proration.ts'),
				entry(inv, 'retry.ts'),
				entry(inv, 'webhooks.ts'),
			]),
		},
		files: {
			[`${inv}/retry.ts`]: contents(`${inv}/retry.ts`, RETRY_TS),
			[`${ROOT}/README.md`]: contents(`${ROOT}/README.md`, README),
		},
		gitStatuses: {
			[ROOT]: {
				repoRoot: ROOT,
				branch: 'fix/duplicate-invoices',
				head: 'c0ffee1'.padEnd(40, '0'),
				changes: [
					change('src/invoices/retry.ts', { additions: 18, deletions: 4 }),
					change('src/invoices/webhooks.ts', { additions: 6, deletions: 9 }),
					change('migrations/0042_webhook_events.sql', {
						kind: 'untracked',
						additions: 14,
						deletions: 0,
					}),
				],
				total: 3,
				truncated: false,
			},
		},
	};
}

function fixture(): TestFixture {
	const w = world();
	return { ...w, ...billingTree(), terminalSpawnId: PTY };
}

const SESSION = `${IDS.billing.slice(0, 8)}-5e55-4000-8000-000000000001`;

/** A Claude Code-shaped screen, so the agent's side of the window is not blank. */
async function agentScreen(page: Page): Promise<void> {
	const text = [
		'\x1b[38;5;174m✻\x1b[0m Welcome to \x1b[1mClaude Code\x1b[0m',
		'  \x1b[2mcwd: /home/ada/code/billing-api\x1b[0m',
		'',
		'\x1b[2m>\x1b[0m Stripe retries are duplicating invoices. Find out why and fix it.',
		'',
		'\x1b[37m●\x1b[0m I will start with how the webhook handler recognises a delivery it has',
		'  already seen.',
		'',
		'\x1b[32m●\x1b[0m \x1b[1mRead\x1b[0m(src/invoices/webhooks.ts)',
		'  \x1b[2m⎿  Read 84 lines\x1b[0m',
		'',
		'\x1b[32m●\x1b[0m \x1b[1mSearch\x1b[0m(pattern: "event.id", path: "src")',
		'  \x1b[2m⎿  Found 2 files\x1b[0m',
		'',
		'\x1b[37m●\x1b[0m The handler keys each invoice on the charge, not on the event, so a',
		'  retried delivery writes a second row. I will key it on the event id and',
		'  remember deliveries for three days.',
		'',
		'\x1b[32m●\x1b[0m \x1b[1mUpdate\x1b[0m(src/invoices/retry.ts)',
		'  \x1b[2m⎿  Updated with 18 additions and 4 removals\x1b[0m',
		'',
	].join('\r\n');
	await page.evaluate(
		([id, t]) => {
			const bytes = new TextEncoder().encode(t);
			let bin = '';
			for (const b of bytes) bin += String.fromCharCode(b);
			window.__FACTORAI_EMIT__?.('terminal:data', { id, bytesB64: btoa(bin) });
		},
		[PTY, text] as const,
	);
}

async function openSessionWithTree(page: Page) {
	await installMockBridge(page, fixture());
	await page.goto(`/#/projects/${IDS.billing}/sessions/${SESSION}`);
	await expect(page.getByTestId('session-header').or(page.locator('.xterm').first())).toBeVisible();
	await page.getByRole('button', { name: 'Toggle file tree' }).click();
	const panel = page.getByTestId('file-tree-panel');
	await expect(panel.getByRole('button', { name: 'README.md' })).toBeVisible();
	await panel.getByRole('button', { name: 'src' }).click();
	await panel.getByRole('button', { name: 'invoices' }).click();
	await expect(panel.getByRole('button', { name: 'retry.ts' })).toBeVisible();
	return panel;
}

async function blur(page: Page) {
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.mouse.move(-10, -10);
}

async function expandSidebar(page: Page) {
	await page.getByRole('button', { name: 'Expand Pro', exact: true }).click();
}

/** Drag the edge between the agent and the viewer to `x`, so the viewer has
 *  room for its footer's labels. */
async function widenViewer(page: Page, x: number) {
	const viewer = await page.getByTestId('file-viewer').boundingBox();
	if (!viewer) throw new Error('no viewer');
	const seps = page.getByRole('separator', { name: 'Resize file viewer' });
	let best: { x: number; y: number } | null = null;
	for (const s of await seps.all()) {
		const b = await s.boundingBox();
		if (!b) continue;
		const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
		if (!best || Math.abs(c.x - viewer.x) < Math.abs(best.x - viewer.x)) best = c;
	}
	if (!best) throw new Error('no separator');
	await page.mouse.move(best.x, best.y);
	await page.mouse.down();
	await page.mouse.move((best.x + x) / 2, best.y, { steps: 5 });
	await page.mouse.move(x, best.y, { steps: 5 });
	await page.mouse.up();
}

/** Where the viewer's text is, for aiming a click at a line. */
function line(page: Page, text: string) {
	return page.getByTestId('file-viewer').locator('.view-line', { hasText: text }).first();
}

test('files: the tree with git decorations, and a file row menu', async ({ page }) => {
	const panel = await openSessionWithTree(page);
	await blur(page);
	// A row below the decorated ones, so the menu covers none of them.
	await panel
		.getByRole('button', { name: 'README.md' })
		.click({ button: 'right', position: { x: 60, y: 10 } });
	const menu = page.getByRole('menu');
	await expect(page.getByRole('menuitem', { name: /agent context/ })).toBeVisible();
	await page.mouse.move(-10, -10);
	const tree = await around([panel.getByText('tsconfig.json'), menu], 0);
	const head = await panel.boundingBox();
	if (!head) throw new Error('no panel');
	const left = Math.min(head.x, tree.x) - 12;
	await shot(page, 'files-tree', {
		x: left,
		y: head.y,
		width: head.x + head.width - left,
		height: tree.y + tree.height + 16 - head.y,
	});
});

test('files: a markdown file rendered in the viewer', async ({ page }) => {
	const panel = await openSessionWithTree(page);
	await expandSidebar(page);
	await panel.getByRole('button', { name: 'README.md' }).click();
	const viewer = page.getByTestId('file-viewer');
	await expect(viewer.getByRole('button', { name: 'View source' })).toBeVisible();
	await expect(viewer.locator('svg').first()).toBeVisible();
	await agentScreen(page);
	await page.waitForTimeout(500);
	await blur(page);
	await shot(page, 'files-markdown-preview', await around([viewer, panel], 0));
});

test('files: an edited file with lines selected for the agent', async ({ page }) => {
	// A shorter window, so the picture is the edit and the footer and not forty
	// more lines of code.
	await page.setViewportSize({ width: 1440, height: 760 });
	const panel = await openSessionWithTree(page);
	await panel.getByRole('button', { name: 'retry.ts' }).click();
	const viewer = page.getByTestId('file-viewer');
	await expect(line(page, 'SEEN_FOR_MS = 72')).toBeVisible();
	// The tree is not what this section is about, and the footer spells its
	// labels out only once the viewer is wide enough for them.
	await page.getByRole('button', { name: 'Toggle file tree' }).click();
	await widenViewer(page, 560);
	await agentScreen(page);
	// An unsaved change, so the tab carries its mark and Save is live.
	await line(page, 'SEEN_FOR_MS = 72').click();
	await page.keyboard.press('End');
	await page.keyboard.type(' // three days');
	// Then the lines to hand the agent.
	await line(page, 'const seen = await').click();
	await page.keyboard.press('Home');
	await line(page, 'return { invoiceId: seen').click({ modifiers: ['Shift'] });
	await page.keyboard.press('Shift+End');
	await expect(viewer.getByTestId('viewer-add-to-claude').locator('span')).toBeVisible();
	await page.mouse.move(-10, -10);
	await shot(page, 'files-editing', (await viewer.boundingBox()) ?? undefined);
});
