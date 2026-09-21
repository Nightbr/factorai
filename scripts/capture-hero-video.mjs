#!/usr/bin/env node
/**
 * Film the hero's last three steps as a social clip.
 *
 * The still card of `specs/09-branding.md` B5b is `seq 05` photographed. This
 * is its moving sibling: `seq 03` → `seq 04` → `seq 05`, the slam, the answer
 * and the strike, at 1080x1080, 60fps, silent, for a LinkedIn or X feed.
 *
 * **Why a real window and not a headless screenshot loop.** The fog is a WebGL
 * shader and the strike is a wall-clock GSAP timeline; frames have to come off
 * a GPU in real time or both judder. So: Playwright launches a *headed*
 * Chromium, sizes its viewport to exactly 540x540 CSS pixels at DPR 2, and
 * `ffmpeg`'s `x11grab`
 * records that window's content rectangle while the script walks the steps
 * with `ArrowDown` — the same `scrollToStep` path a visitor's arrow key takes,
 * with the same 0.8s ease and the same on-arrival strike.
 *
 * **Why the take starts on `seq 02`.** The dead word's slam is the *arrival*
 * animation of `seq 03`. Landing on `#seq-3` means it has already played, so
 * the page is parked on `#seq-2` behind a black veil and walked forward from
 * there; the film itself opens after the outgoing line has gone (`OPEN_AT`),
 * so the first thing a viewer sees is the slam.
 *
 * **What is hidden.** The navbar, the Next arrow and the Skip button, for the
 * reason B5b hides them in the still. The HUD stays — its brackets, hairline
 * and `seq NN` readout are the treatment, and the readout ticking 03-04-05 is
 * free motion.
 *
 * **The beats.** Each one is a hold after an observed event, not an offset from
 * the start — see `BEATS`. Typical wall-clock, from `t0` = the first keypress:
 *
 *   0.0   ArrowDown; the veil clears 0.28s later, over 0.4s
 *   1.3   the film opens here (`OPEN_AT`), on the dead word still scaling in
 *   ~1.5  "IDE is dead" has landed                → hold 1.9s
 *   ~3.4  ArrowDown
 *   ~5.2  "Long live the ADE" + expansion         → hold 1.9s
 *   ~7.1  ArrowDown
 *   ~9.5  the strike, then the board takes power
 *   ~9.9  the wordmark is up                      → +0.35s
 *   ~10.3 factorai.build fades in                 → hold 1.6s
 *   ~11.9 hard cut on the powered board
 *
 * Which is a clip of about 10.5s, the pre-roll and the first 1.3s trimmed.
 *
 * The URL is a node injected into the page, not a post-production overlay:
 * that way it is the site's own JetBrains Mono at the HUD's treatment, drawn
 * by the same renderer as everything around it.
 *
 * Usage, from the repo root:
 *
 *   pnpm capture:hero                # build the site if needed, then film
 *   pnpm capture:hero -- --probe     # one frame, to check the crop
 *   pnpm capture:hero -- --skip-build
 *
 * It writes the raw take and the two encodes into `.capture/`, which is
 * ignored; the films that ship are copied to `assets/brand/` by hand, once a
 * take has been watched.
 *
 * Sparks pick their angles from `Math.random`, so no two takes are identical.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const BUILD = join(ROOT, 'apps/docs/build');
/**
 * The film is 1080x1080, drawn by a 540px browser at device pixel ratio 2.
 *
 * **Why not 1920x1080.** A feed plays a video about 550px wide, and the hero's
 * small type is clamped at the top of its `clamp()` — 13.6px for the expansion
 * line, the forge line and the URL, 10.9px for the HUD — so it stops growing
 * with the viewport. Filmed at 1920 those are 0.7% and 0.57% of the frame, or
 * four and three pixels on a feed card: noise, which is exactly how it read.
 * Halving the CSS viewport doubles every one of those ratios, and DPR 2 puts
 * the pixels back, so nothing is upscaled. It also drops below the hero's own
 * 760px breakpoint, which hides the left-hand readout — the line that looked
 * like pixel noise — and keeps the brackets, hairline and `seq NN`.
 *
 * Square because LinkedIn and X both play 1:1 at full feed width uncropped.
 */
const WIDTH = 1080;
const HEIGHT = 1080;
const SCALE = 2;
/** What the page believes it is, in CSS pixels. */
const CSS_WIDTH = WIDTH / SCALE;
const CSS_HEIGHT = HEIGHT / SCALE;
/**
 * The three mono lines — the ADE expansion, the forge line and the URL — are a
 * whisper at a desktop reading distance and illegible on a feed card. They are
 * raised for the capture only, the same adaptation `specs/09-branding.md` B5b
 * makes when it swaps the still card's line: a frame seen cold at thumbnail
 * size is not read the way the hero is.
 */
const MICRO_TYPE_BUMP = 1.25;
const FPS = 60;
/** Black frames before `t0`, trimmed away in the encode. */
const PREROLL = 1.2;
/**
 * Where the clip opens, in seconds after `t0`.
 *
 * The veil clears while `seq 02`'s line is still on its way out, so for about
 * three frames the outgoing line is legible — a glimpse of a sentence nobody
 * has time to read, which is worse than not seeing it at all. Measured off the
 * frames: the line is gone by 1.30s and the dead word is still scaling in, so
 * that is where the film starts, over a short fade so the open is not a jump.
 */
const OPEN_AT = 1.3;
const OPEN_FADE = 0.25;
/**
 * Where `t0` is *in the file* cannot be taken from the clock: ffmpeg reports
 * its first frame later than it captured it, and take 3 lost the slam to the
 * half-second of drift that assumption carried. So the veil flashes white for
 * two frames at `t0 - FLASH_LEAD`, inside the pre-roll that gets trimmed away,
 * and the encode finds that frame by luminance and measures from it.
 */
const FLASH_LEAD = 0.6;
/**
 * The beats, in seconds — holds between events, not offsets from `t0`.
 *
 * A keypress is not a cut: `scrollToStep` eases for 0.8s, the scrub trails it
 * by 0.5s, and on `seq 05` the forge then waits 0.3s, fades the mark in and
 * drives it down for 0.8s before the strike. A clock-anchored beat sheet drifts
 * about a second and a half by the last step and cuts the wordmark off, which
 * is exactly what take 1 did. So every beat here is a hold *after* an observed
 * event: the step readout changing, or the wordmark reaching full opacity.
 */
const BEATS = {
	/**
	 * The veil holds past the keypress, and the clip then opens later still
	 * (`OPEN_AT`): between the two, `seq 02`'s line finishes blurring out where
	 * no one sees it.
	 */
	veilDelay: 0.28,
	veilFade: 0.4,
	/** What the scrub still owes after the scroll itself has stopped. */
	scrubTail: 0.45,
	/** Reading time on `seq 03` and on `seq 04` once each has settled. */
	hold: 1.9,
	urlAfterWordmark: 0.35,
	/** The powered board, held with the URL on it, before the hard cut. */
	tail: 1.6,
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(option('port', '3211'));
const OUT_DIR = resolve(option('out', join(ROOT, '.capture')));
const NAME = option('name', 'factorai-hero');
/** x11grab wants the display the browser is actually on, not a hardcoded `:0`. */
const DISPLAY = process.env.DISPLAY ?? ':0';

const log = (...parts) => console.log('•', ...parts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Sleep until an absolute wall-clock instant, correcting for timer drift. */
const sleepUntil = async (at) => {
	for (;;) {
		const left = at - Date.now();
		if (left <= 1) return;
		await sleep(left > 40 ? left - 20 : 1);
	}
};

function need(binary) {
	const found = spawnSync('which', [binary], { encoding: 'utf8' });
	if (found.status !== 0) throw new Error(`${binary} is not on PATH`);
	return found.stdout.trim();
}

/** The built site, served flat: Docusaurus emits a directory per route. */
function serve(dir, port) {
	const types = {
		'.html': 'text/html',
		'.js': 'text/javascript',
		'.css': 'text/css',
		'.svg': 'image/svg+xml',
		'.png': 'image/png',
		'.ico': 'image/x-icon',
		'.json': 'application/json',
		'.woff': 'font/woff',
		'.woff2': 'font/woff2',
		'.txt': 'text/plain',
	};
	const server = createServer((req, res) => {
		const path = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
		const candidates = [join(dir, path), join(dir, path, 'index.html'), join(dir, '404.html')];
		const file = candidates.find((c) => existsSync(c) && statSync(c).isFile());
		if (!file) {
			res.writeHead(404).end('not found');
			return;
		}
		res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
		createReadStream(file).pipe(res);
	});
	return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

/**
 * The content rectangle of the browser window in root-window coordinates.
 * `xwininfo` gives the absolute origin of the X client window — the whole
 * browser, tab strip included — and the page reports how much of that the
 * viewport is not.
 */
function contentRect(page, title) {
	const ids = execFileSync('xdotool', ['search', '--name', title], { encoding: 'utf8' })
		.trim()
		.split('\n')
		.filter(Boolean);
	if (ids.length === 0) throw new Error(`no X window titled ${title}`);
	for (const id of ids.reverse()) {
		const info = execFileSync('xwininfo', ['-id', id], { encoding: 'utf8' });
		const absX = Number(/Absolute upper-left X:\s+(-?\d+)/.exec(info)?.[1]);
		const absY = Number(/Absolute upper-left Y:\s+(-?\d+)/.exec(info)?.[1]);
		const w = Number(/Width:\s+(\d+)/.exec(info)?.[1]);
		const h = Number(/Height:\s+(\d+)/.exec(info)?.[1]);
		if (!Number.isFinite(absX) || w < WIDTH) continue;
		return page
			.evaluate(() => ({
				inner: [window.innerWidth, window.innerHeight],
				outer: [window.outerWidth, window.outerHeight],
				dpr: window.devicePixelRatio,
			}))
			.then(({ inner, outer, dpr }) => {
				// X counts device pixels, the page counts CSS pixels, and at DPR 2
				// those differ by a factor of two: the borders as much as the frame.
				const side = (outer[0] - inner[0]) / 2;
				const top = outer[1] - inner[1] - side;
				return {
					x: absX + Math.round(side * dpr),
					y: absY + Math.round(top * dpr),
					w: Math.round(inner[0] * dpr),
					h: Math.round(inner[1] * dpr),
					frame: [w, h],
				};
			});
	}
	throw new Error(`no browser window wide enough to hold a ${WIDTH}px frame`);
}

/** Hide the chrome the film is not of, add the veil and the URL, raise the
 * mono lines that a feed card cannot resolve. */
async function dress(page, bump) {
	await page.evaluate((factor) => {
		const hide = (el) => {
			if (el instanceof HTMLElement) el.style.display = 'none';
		};
		hide(document.querySelector('.navbar'));
		hide(document.querySelector('[aria-label="Next"]'));
		for (const b of document.querySelectorAll('button')) {
			if (b.textContent?.trim() === 'Skip') hide(b);
		}
		const style = document.createElement('style');
		style.textContent = `
			html, body { scrollbar-width: none; }
			::-webkit-scrollbar { display: none; }
			/* The stage is 100dvh and the viewport is a few pixels taller, so the
			   section below it bleeds a sliver into the bottom edge. Hidden, not
			   removed: the pin's spacer is measured from the layout, and taking
			   these out of flow would move the steps the film is scrubbing. */
			#app, #features, #download, #about { visibility: hidden; }
			#capture-veil {
				position: fixed; inset: 0; z-index: 2147483647;
				background: #000; opacity: 1; pointer-events: none;
				transition: opacity 0.5s linear;
			}
			#capture-url {
				margin: 0.9rem 0 0;
				color: var(--fa-primary);
				font-family: var(--ifm-font-family-monospace);
				letter-spacing: 0.3em;
				opacity: 0;
				transition: opacity 0.6s ease-out;
			}
		`;
		document.head.append(style);
		const veil = document.createElement('div');
		veil.id = 'capture-veil';
		document.body.append(veil);

		// Under the wordmark and the forge line, inside the block those two
		// already live in, so it is centred by the same flex column.
		const forgeText = document.querySelector('[data-forge] > div:last-of-type');
		const url = document.createElement('p');
		url.id = 'capture-url';
		url.textContent = 'factorai.build';
		forgeText?.append(url);

		// The two mono lines the hero already has, found by their own words
		// because the class names are hashed in a production build, and then the
		// URL beside them so all three sit at one size.
		const raise = (el) => {
			if (!(el instanceof HTMLElement)) return;
			const size = Number.parseFloat(getComputedStyle(el).fontSize);
			el.style.fontSize = `${(size * factor).toFixed(2)}px`;
		};
		for (const p of document.querySelectorAll('p')) {
			const text = p.textContent?.trim().toLowerCase() ?? '';
			if (text === 'agentic development environment' || text === 'forged for the agentic era.') {
				raise(p);
			}
		}
		const line = document.querySelector('[data-forge] > div:last-of-type p');
		url.style.fontSize = line instanceof HTMLElement ? getComputedStyle(line).fontSize : '0.9rem';
	}, bump);
}

/**
 * Find the content rectangle by looking at it, not by arithmetic.
 *
 * `outerHeight - innerHeight` is off by a few pixels — on this desktop the
 * capture sat 8px low and took a strip of the window's own edge into the
 * bottom of the frame. So the page draws a magenta border on its own edges,
 * one frame is grabbed with a margin around the estimate, and the offset comes
 * from where that border actually lands.
 */
async function calibrate(page, rect) {
	const pad = 24;
	await page.evaluate(() => {
		const cal = document.createElement('div');
		cal.id = 'capture-cal';
		cal.style.cssText =
			'position:fixed;inset:0;z-index:2147483647;pointer-events:none;border:2px solid #f0f';
		document.body.append(cal);
	});
	await sleep(250);
	const w = rect.w + pad * 2;
	const h = rect.h + pad * 2;
	const frame = spawnSync(
		'ffmpeg',
		[
			'-hide_banner',
			'-v',
			'error',
			'-f',
			'x11grab',
			'-draw_mouse',
			'0',
			'-video_size',
			`${w}x${h}`,
			'-i',
			`${DISPLAY}+${rect.x - pad},${rect.y - pad}`,
			'-frames:v',
			'1',
			'-pix_fmt',
			'rgb24',
			'-f',
			'rawvideo',
			'-',
		],
		{ encoding: 'buffer', maxBuffer: w * h * 3 + 1024 },
	).stdout;
	await page.evaluate(() => document.getElementById('capture-cal')?.remove());
	if (!frame || frame.length < w * h * 3) throw new Error('the calibration grab came back short');

	let minX = w;
	let minY = h;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 3;
			// Magenta and nothing else on this page: red and blue high, green low.
			if (frame[i] > 180 && frame[i + 2] > 180 && frame[i + 1] < 90) {
				if (x < minX) minX = x;
				if (y < minY) minY = y;
				if (x > maxX) maxX = x;
				if (y > maxY) maxY = y;
			}
		}
	}
	if (maxX < 0) throw new Error('no calibration border found in the grab');
	const found = [maxX - minX + 1, maxY - minY + 1];
	if (Math.abs(found[0] - rect.w) > 2 || Math.abs(found[1] - rect.h) > 2) {
		throw new Error(
			`calibration found a ${found[0]}x${found[1]} viewport, expected ${rect.w}x${rect.h}`,
		);
	}
	return { ...rect, x: rect.x - pad + minX, y: rect.y - pad + minY };
}

/** Two white frames on the veil, as the mark the encode measures `t0` from. */
async function flash(page) {
	await page.evaluate(() => {
		const el = document.getElementById('capture-veil');
		if (el) el.style.background = '#fff';
	});
	await sleep(40);
	await page.evaluate(() => {
		const el = document.getElementById('capture-veil');
		if (el) el.style.background = '#000';
	});
}

/**
 * The brightest frame in the first seconds of the take is the flash. Read the
 * per-frame luminance out of `signalstats` and return its timestamp.
 */
function flashAt(file) {
	const out = spawnSync(
		'ffmpeg',
		[
			'-hide_banner',
			'-v',
			'error',
			'-i',
			file,
			'-t',
			'4',
			'-vf',
			'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
			'-f',
			'null',
			'-',
		],
		{ encoding: 'utf8' },
	).stdout;
	let best = { time: 0, y: -1 };
	let time = 0;
	for (const line of out.split('\n')) {
		const stamp = /pts_time:([\d.]+)/.exec(line);
		if (stamp) {
			time = Number(stamp[1]);
			continue;
		}
		const y = /YAVG=([\d.]+)/.exec(line);
		if (y && Number(y[1]) > best.y) best = { time, y: Number(y[1]) };
	}
	if (best.y < 40) throw new Error(`no flash frame found (brightest YAVG ${best.y})`);
	return best.time;
}

/** Clear the veil, late enough that `seq 02`'s line has already blurred out. */
async function veil(page, fade) {
	await sleep(BEATS.veilDelay * 1000);
	await page.evaluate((seconds) => {
		const el = document.getElementById('capture-veil');
		if (!el) return;
		el.style.transitionDuration = `${seconds}s`;
		el.style.opacity = '0';
	}, fade);
}

/**
 * Block until the step has not merely been *named* but has come to rest.
 *
 * The HUD readout flips at `Math.round(progress * TOTAL)` — halfway through
 * the 0.8s tween, while the word is still moving — so it is the wrong thing to
 * hold a beat against. The scroll position stopping is the right one, plus the
 * scrub's own 0.5s tail behind it.
 */
async function waitForStep(page, want) {
	await page.waitForFunction(
		(step) => {
			for (const span of document.querySelectorAll('span')) {
				if (span.textContent?.trim() === step) return true;
			}
			return false;
		},
		want,
		{ timeout: 20_000, polling: 50 },
	);
	await page.waitForFunction(
		() => {
			const w = window;
			const was = w.__captureScrollY;
			w.__captureScrollY = w.scrollY;
			return was === w.scrollY;
		},
		undefined,
		{ timeout: 20_000, polling: 100 },
	);
	await sleep(BEATS.scrubTail * 1000);
}

/** The HUD's own readout, which is the only unhashed name for the step. */
const readout = (page) =>
	page.evaluate(() => {
		for (const span of document.querySelectorAll('span')) {
			const text = span.textContent?.trim() ?? '';
			if (/^seq \d\d$/.test(text)) return text;
		}
		return null;
	});

async function main() {
	need('ffmpeg');
	need('xdotool');
	need('xwininfo');

	if (!flag('skip-build') || !existsSync(join(BUILD, 'index.html'))) {
		log('building the site');
		const built = spawnSync('pnpm', ['--filter', '@factorai/docs', 'build'], {
			cwd: ROOT,
			stdio: 'inherit',
		});
		if (built.status !== 0) throw new Error('the docs build failed');
	}
	mkdirSync(OUT_DIR, { recursive: true });

	const server = await serve(BUILD, PORT);
	const title = `capture-${Date.now()}`;
	const browser = await chromium.launch({
		headless: false,
		args: [
			`--window-size=${CSS_WIDTH},${CSS_HEIGHT + 120}`,
			'--window-position=0,0',
			`--force-device-scale-factor=${SCALE}`,
			'--hide-scrollbars',
			'--disable-infobars',
			'--no-first-run',
			'--disable-features=Translate,MediaRouter',
		],
	});
	const context = await browser.newContext({ viewport: null, colorScheme: 'dark' });
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);

	try {
		await page.goto(`http://127.0.0.1:${PORT}/#seq-2`, { waitUntil: 'load' });

		// Size the *viewport* by growing the window by whatever the browser's own
		// chrome takes. Window bounds and `window.outerWidth` are both CSS pixels;
		// only X and the capture deal in device pixels.
		for (let i = 0; i < 4; i++) {
			const { inner, outer } = await page.evaluate(() => ({
				inner: [window.innerWidth, window.innerHeight],
				outer: [window.outerWidth, window.outerHeight],
			}));
			if (inner[0] === CSS_WIDTH && inner[1] === CSS_HEIGHT) break;
			const { windowId } = await cdp.send('Browser.getWindowForTarget');
			await cdp.send('Browser.setWindowBounds', {
				windowId,
				bounds: {
					left: 0,
					top: 0,
					width: outer[0] - inner[0] + CSS_WIDTH,
					height: outer[1] - inner[1] + CSS_HEIGHT,
				},
			});
			await sleep(250);
		}
		const viewport = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
		if (viewport[0] !== CSS_WIDTH || viewport[1] !== CSS_HEIGHT) {
			throw new Error(
				`viewport is ${viewport[0]}x${viewport[1]} CSS px, not ${CSS_WIDTH}x${CSS_HEIGHT}`,
			);
		}

		const renderer = await page.evaluate(() => {
			const gl = document.createElement('canvas').getContext('webgl2');
			const ext = gl?.getExtension('WEBGL_debug_renderer_info');
			return ext ? gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
		});
		log('webgl:', renderer);
		if (/swiftshader|llvmpipe/i.test(String(renderer))) {
			log('WARNING: software rendering — the fog will judder at 60fps');
		}

		await page.waitForSelector('[data-ready]', { timeout: 30_000 });
		await page.evaluate(() => document.fonts.ready);
		await page.evaluate((t) => {
			document.title = t;
		}, title);
		await sleep(1500);
		await dress(page, MICRO_TYPE_BUMP);
		await sleep(500);
		if ((await readout(page)) !== 'seq 02') {
			throw new Error(`parked on ${await readout(page)}, expected seq 02`);
		}

		const estimate = await contentRect(page, title);
		// Off the window, so no hover state lights up under a pointer that
		// `-draw_mouse 0` would have left out of frame anyway.
		execFileSync('xdotool', [
			'mousemove',
			String(estimate.x + estimate.w + 200),
			String(estimate.y + 40),
		]);
		const rect = await calibrate(page, estimate);
		log(
			`window frame ${rect.frame[0]}x${rect.frame[1]}, content ${rect.w}x${rect.h} at ` +
				`+${rect.x},${rect.y} (estimate was +${estimate.x},${estimate.y})`,
		);

		const raw = join(OUT_DIR, `${NAME}-raw.mkv`);
		if (flag('probe')) {
			const probe = join(OUT_DIR, `${NAME}-probe.png`);
			await page.evaluate(() => {
				const veil = document.getElementById('capture-veil');
				if (veil) veil.style.opacity = '0';
			});
			await sleep(700);
			spawnSync(
				'ffmpeg',
				[
					'-hide_banner',
					'-loglevel',
					'error',
					'-y',
					'-f',
					'x11grab',
					'-draw_mouse',
					'0',
					'-video_size',
					`${rect.w}x${rect.h}`,
					'-i',
					`${DISPLAY}+${rect.x},${rect.y}`,
					'-frames:v',
					'1',
					probe,
				],
				{ stdio: 'inherit' },
			);
			log('probe frame:', probe);
			return;
		}

		const ff = spawn(
			'ffmpeg',
			[
				'-hide_banner',
				'-loglevel',
				'error',
				'-y',
				'-f',
				'x11grab',
				'-draw_mouse',
				'0',
				'-framerate',
				String(FPS),
				'-video_size',
				`${rect.w}x${rect.h}`,
				'-i',
				`${DISPLAY}+${rect.x},${rect.y}`,
				'-c:v',
				'libx264',
				'-preset',
				'ultrafast',
				'-crf',
				'12',
				'-pix_fmt',
				'yuv444p',
				'-progress',
				'pipe:1',
				'-stats_period',
				'0.1',
				raw,
			],
			{ stdio: ['pipe', 'pipe', 'inherit'] },
		);

		// The first encoded frame is the clock everything else is measured from.
		const firstFrame = await new Promise((ok, fail) => {
			const timer = setTimeout(() => fail(new Error('ffmpeg produced no frame in 10s')), 10_000);
			ff.stdout.on('data', function onData(chunk) {
				if (!/frame=\s*[1-9]/.test(String(chunk))) return;
				clearTimeout(timer);
				ff.stdout.off('data', onData);
				ok(Date.now());
			});
			ff.on('exit', (code) => fail(new Error(`ffmpeg exited early (${code})`)));
		});

		const t0 = firstFrame + PREROLL * 1000;
		const mark = (what) => log(`  ${((Date.now() - t0) / 1000).toFixed(2)}s  ${what}`);

		await sleepUntil(t0 - FLASH_LEAD * 1000);
		await flash(page);
		await sleepUntil(t0);
		await Promise.all([page.keyboard.press('ArrowDown'), veil(page, BEATS.veilFade)]);
		mark('ArrowDown, veil fading');

		await waitForStep(page, 'seq 03');
		mark('seq 03 — the slam');
		await sleep(BEATS.hold * 1000);
		await page.keyboard.press('ArrowDown');

		await waitForStep(page, 'seq 04');
		mark('seq 04 — the answer');
		await sleep(BEATS.hold * 1000);
		await page.keyboard.press('ArrowDown');

		await waitForStep(page, 'seq 05');
		mark('seq 05 — the forge is armed');
		// The wordmark lands 0.8s after the strike, at the end of a timeline that
		// starts with its own 0.3s delay: the only honest cue for "the board is
		// at rest" is the wordmark's own opacity, not a stopwatch.
		await page.waitForFunction(
			() => {
				const text = document.querySelector('[data-forge] > div:last-of-type');
				return text ? Number(getComputedStyle(text).opacity) > 0.95 : false;
			},
			undefined,
			{ timeout: 20_000, polling: 50 },
		);
		mark('the wordmark is up');
		await sleep(BEATS.urlAfterWordmark * 1000);
		await page.evaluate(() => {
			const url = document.getElementById('capture-url');
			if (url) url.style.opacity = '1';
		});
		mark('factorai.build');

		await sleep(BEATS.tail * 1000);
		const cut = (Date.now() - t0) / 1000;
		mark('cut');
		await sleep(400);
		ff.stdin.write('q');
		await new Promise((ok) => ff.on('exit', ok));
		log('raw take:', raw, `${(statSync(raw).size / 1e6).toFixed(0)}MB`);

		const zero = flashAt(raw) + FLASH_LEAD;
		const start = (zero + OPEN_AT).toFixed(3);
		const length = (cut - OPEN_AT).toFixed(3);
		const fade = `fade=t=in:st=0:d=${OPEN_FADE}`;
		log(`t0 at ${zero.toFixed(2)}s in the raw take; clip length ${length}s`);
		const mp4 = join(OUT_DIR, `${NAME}.mp4`);
		const webm = join(OUT_DIR, `${NAME}.webm`);

		log('encoding the master');
		spawnSync(
			'ffmpeg',
			[
				'-hide_banner',
				'-loglevel',
				'error',
				'-y',
				'-ss',
				start,
				'-i',
				raw,
				'-t',
				length,
				'-vf',
				fade,
				'-c:v',
				'libx264',
				'-crf',
				'18',
				'-preset',
				'slow',
				'-pix_fmt',
				'yuv420p',
				'-movflags',
				'+faststart',
				'-an',
				mp4,
			],
			{ stdio: 'inherit' },
		);
		log('encoding the webm');
		spawnSync(
			'ffmpeg',
			[
				'-hide_banner',
				'-loglevel',
				'error',
				'-y',
				'-ss',
				start,
				'-i',
				raw,
				'-t',
				length,
				'-vf',
				fade,
				'-c:v',
				'libvpx-vp9',
				'-crf',
				'33',
				'-b:v',
				'0',
				'-row-mt',
				'1',
				'-pix_fmt',
				'yuv420p',
				'-an',
				webm,
			],
			{ stdio: 'inherit' },
		);

		for (const file of [mp4, webm]) {
			log(`${file} — ${(statSync(file).size / 1e6).toFixed(1)}MB`);
		}
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
