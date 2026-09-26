import { expect, type Page, test } from '@playwright/test';
import { installMockBridge, type TestFixture } from '../smoke/fixtures';
import { type Box, Gif, shot } from './capture';
import { HOME, IDS, world } from './world';

/**
 * The session terminal and the footer shells (guide: terminal.md), in
 * billing-api. Everything the terminals show is written to them the way Rust
 * does, as base64 bytes on `terminal:data`.
 */

const ROOT = `${HOME}/billing-api`;
const SESSION = `${IDS.billing.slice(0, 8)}-5e55-4000-8000-000000000001`;
const AGENT = 'docs-terminal-agent';

type Contents = Required<TestFixture>['files'][string];

function contents(path: string, text: string): Contents {
	return {
		path,
		contents: text,
		size: text.length,
		isBinary: false,
		truncated: false,
		lineCount: text.replace(/\n$/, '').split('\n').length,
		lossy: false,
		sopsEncrypted: false,
	};
}

const RETRY_TS = `import { db } from '../db';
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
`;

function fixture(over: Partial<TestFixture> = {}): TestFixture {
	const retry = `${ROOT}/src/invoices/retry.ts`;
	return {
		...world(),
		terminalSpawnId: AGENT,
		files: { [retry]: contents(retry, RETRY_TS) },
		...over,
	};
}

/** Write `lines` to a PTY, UTF-8 encoded as Rust would send them. */
async function print(page: Page, id: string, lines: string[]): Promise<void> {
	await page.evaluate(
		([pty, text]) => {
			const bytes = new TextEncoder().encode(text);
			let bin = '';
			for (const b of bytes) bin += String.fromCharCode(b);
			window.__FACTORAI_EMIT__?.('terminal:data', { id: pty, bytesB64: btoa(bin) });
		},
		[id, lines.join('\r\n')] as const,
	);
}

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const CLAY = '\x1b[38;5;174m';
const OFF = '\x1b[0m';

const CLAUDE = [
	`${CLAY}✻${OFF} Welcome to ${BOLD}Claude Code${OFF}`,
	`  ${DIM}cwd: /home/ada/code/billing-api${OFF}`,
	'',
	`${DIM}>${OFF} Stripe retries are duplicating invoices. Find out why and fix it.`,
	'',
	'● I will start with how the webhook handler recognises a delivery',
	'  it has already seen.',
	'',
	`${GREEN}●${OFF} ${BOLD}Read${OFF}(src/invoices/webhooks.ts)`,
	`  ${DIM}⎿  Read 84 lines${OFF}`,
	'',
	`${GREEN}●${OFF} ${BOLD}Update${OFF}(src/invoices/retry.ts)`,
	`  ${DIM}⎿  Updated with 18 additions and 4 removals${OFF}`,
	'',
	`${GREEN}●${OFF} ${BOLD}Bash${OFF}(pnpm test retry)`,
	`  ${DIM}⎿  ✓ tests/retry.test.ts (6 tests) 412ms${OFF}`,
	`     ${DIM}Tests  6 passed (6)${OFF}`,
	'',
	'● Fixed. The handler keyed each invoice on the charge, so a retried',
	'  delivery wrote a second row. It now remembers every event id for',
	'  three days and returns the invoice it made the first time:',
	'',
	'  src/invoices/retry.ts:20',
	'',
	`${DIM}╭──────────────────────────────────────────────────────────────╮${OFF}`,
	`${DIM}│${OFF} > ${DIM}                                                           │${OFF}`,
	`${DIM}╰──────────────────────────────────────────────────────────────╯${OFF}`,
	// The cursor hidden, as Claude Code hides its own while it waits.
	`  ${DIM}? for shortcuts${OFF}\x1b[?25l`,
];

/** `Ctrl`/`Cmd`-hover `path` where the terminal printed it, and return the
 *  underlined link xterm draws once the provider has verified it on disk. */
async function hoverPath(page: Page, host: ReturnType<Page['locator']>, path: string) {
	const span = host.locator('.xterm-rows span', { hasText: path }).first();
	const text = (await span.textContent()) ?? '';
	const box = await span.boundingBox();
	if (!box || !text.includes(path)) throw new Error(`no rendered "${path}"`);
	const cell = box.width / text.length;
	await page.mouse.move(
		box.x + (text.indexOf(path) + path.length / 2) * cell,
		box.y + box.height / 2,
	);
	const underlined = host.locator('span[style*="underline"]', { hasText: path }).first();
	await expect(underlined).toBeVisible();
	return underlined;
}

async function mainColumn(page: Page): Promise<Box> {
	const sidebar = await page.getByTestId('sidebar').boundingBox();
	if (!sidebar) throw new Error('no sidebar');
	const x = sidebar.x + sidebar.width;
	return { x, y: 0, width: 1440 - x, height: 900 };
}

test('terminal: Ctrl+click on a printed path opens it in the viewer', async ({ page }) => {
	await installMockBridge(page, fixture());
	await page.goto(`/#/projects/${IDS.billing}/sessions/${SESSION}`);
	const host = page.locator('.xterm').first();
	await expect(host).toBeVisible();
	await print(page, AGENT, CLAUDE);
	await expect(host).toContainText('src/invoices/retry.ts:20');
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.mouse.move(-10, -10);

	const col = await mainColumn(page);
	// From the session header down: the top bar's tab strip is not the point.
	const close = await page.getByRole('button', { name: 'Close session' }).boundingBox();
	if (!close) throw new Error('no header');
	const top = close.y - 12;
	const gif = new Gif(page, { ...col, y: top, height: 560 });
	await gif.frame(1800);
	const link = await hoverPath(page, host, 'src/invoices/retry.ts:20');
	await gif.frame(1200);
	await link.click({ modifiers: ['ControlOrMeta'] });
	const viewer = page.getByTestId('file-viewer');
	await expect(viewer.getByText('const seen = await').first()).toBeVisible();
	await page.mouse.move(-10, -10);
	await page.waitForTimeout(400);
	await gif.frame(2600);
	gif.save('terminal-file-link');
});

test('terminal: two footer shells split side by side', async ({ page }) => {
	await installMockBridge(page, fixture());
	await page.goto(`/#/projects/${IDS.billing}/sessions/${SESSION}`);
	await expect(page.locator('.xterm').first()).toBeVisible();
	await print(page, AGENT, CLAUDE);
	const footer = page.getByTestId('shell-footer');
	await footer.getByRole('button', { name: 'Terminal' }).click();
	const hosts = page.getByTestId('shell-pane-host');
	await expect(hosts).toHaveCount(1);
	await footer.getByRole('button', { name: 'Split' }).click();
	await expect(hosts).toHaveCount(2);

	const prompt = `${GREEN}ada${OFF}@studio ${CYAN}~/code/billing-api${OFF} ${YELLOW}(fix/duplicate-invoices)${OFF} $`;
	await print(page, 'mock-shell-id-1', [
		`${prompt} pnpm test`,
		` ${BOLD}${CYAN}RUN${OFF}  ${CYAN}v3.2.4${OFF} ${DIM}/home/ada/code/billing-api${OFF}`,
		'',
		` ${GREEN}✓${OFF} tests/proration.test.ts ${DIM}(14 tests) 388ms${OFF}`,
		` ${GREEN}✓${OFF} tests/webhooks.test.ts ${DIM}(9 tests) 512ms${OFF}`,
		` ${GREEN}✓${OFF} tests/retry.test.ts ${DIM}(6 tests) 412ms${OFF}`,
		` ${GREEN}✓${OFF} tests/subscriptions.test.ts ${DIM}(11 tests) 297ms${OFF}`,
		` ${RED}×${OFF} tests/usage.test.ts ${DIM}(4 tests | 1 failed) 203ms${OFF}`,
		`   ${RED}×${OFF} monthly summary rounds to the cent`,
		` ${DIM}Test Files${OFF}  ${RED}${BOLD}1 failed${OFF} ${DIM}|${OFF} ${GREEN}${BOLD}4 passed${OFF} ${DIM}(5)${OFF}`,
		`      ${DIM}Tests${OFF}  ${RED}${BOLD}1 failed${OFF} ${DIM}|${OFF} ${GREEN}${BOLD}43 passed${OFF} ${DIM}(44)${OFF}`,
		`   ${DIM}Duration${OFF}  2.14s`,
		'',
		`${prompt} `,
	]);
	await print(page, 'mock-shell-id-2', [
		`${prompt} pnpm dev`,
		'',
		`${DIM}> billing-api@2.8.0 dev${OFF}`,
		`${DIM}> tsx watch src/server.ts${OFF}`,
		'',
		`${GREEN}info${OFF}  listening on http://localhost:4010`,
		`${GREEN}info${OFF}  stripe webhooks: whsec_…3f9a`,
		`${GREEN}info${OFF}  POST /webhooks/stripe 200 ${DIM}14ms${OFF}  invoice.paid`,
		`${YELLOW}warn${OFF}  POST /webhooks/stripe 200 ${DIM}3ms${OFF}   invoice.paid ${DIM}(duplicate, skipped)${OFF}`,
		// A server holds the terminal, so no cursor where a prompt would be.
		`${GREEN}info${OFF}  GET  /invoices/in_1Q8z 200 ${DIM}6ms${OFF}\x1b[?25l`,
	]);
	await expect(hosts.nth(0)).toContainText('Duration');
	await expect(hosts.nth(1)).toContainText('duplicate');
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.mouse.move(-10, -10);

	const col = await mainColumn(page);
	const top = await hosts.nth(0).boundingBox();
	if (!top) throw new Error('no pane');
	// The panes and the strip below them, with a sliver of the agent above.
	const y = top.y - 60;
	await shot(page, 'terminal-footer-shells', { ...col, y, height: 900 - y });
});
