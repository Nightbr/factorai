import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';

/**
 * Writing the guide's images (ADR-0066).
 *
 * Every image is taken at device scale 2 and named `<page>-<subject>@2x`, and
 * the site's `Shot` component displays it at half its pixel size — so the
 * app's type is as sharp on the page as it is in the window.
 */
export const OUT = resolve(__dirname, '../../assets/images/guide');

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** The union of some elements' boxes, grown by `pad` CSS pixels and kept
 *  inside the viewport. What a crop of "this part of the app" is. */
export async function around(targets: Locator[], pad = 12): Promise<Box> {
	const boxes: Box[] = [];
	for (const t of targets) {
		const b = await t.boundingBox();
		if (!b) throw new Error(`nothing on screen for ${t}`);
		boxes.push(b);
	}
	const page = targets[0].page();
	const vp = page.viewportSize() ?? { width: 1440, height: 900 };
	const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
	const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
	const right = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
	const bottom = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
	return { x, y, width: right - x, height: bottom - y };
}

/** A still: `name` is `<page>-<subject>`, and the file gets `@2x.png`. */
export async function shot(page: Page, name: string, clip?: Box): Promise<string> {
	mkdirSync(OUT, { recursive: true });
	const path = join(OUT, `${name}@2x.png`);
	await page.mouse.move(-10, -10).catch(() => undefined);
	await page.screenshot({ path, clip, animations: 'disabled', caret: 'hide' });
	return path;
}

/**
 * An animated flow, as a GIF.
 *
 * Frames are screenshots of one fixed clip, each held for as long as the
 * step deserves, rather than a video: a still per state is crisp at scale 2,
 * a handful of frames is small, and nothing depends on a recording's timing.
 * ffmpeg builds one palette for the whole sequence so the colours do not
 * shimmer between frames.
 */
export class Gif {
	private readonly dir = mkdtempSync(join(tmpdir(), 'factorai-gif-'));
	private readonly frames: { file: string; holdMs: number }[] = [];

	constructor(
		private readonly page: Page,
		private readonly clip: Box,
	) {}

	/** Capture the clip now and hold it for `holdMs`. */
	async frame(holdMs: number): Promise<void> {
		const file = join(this.dir, `f${String(this.frames.length).padStart(3, '0')}.png`);
		await this.page.screenshot({ path: file, clip: this.clip, caret: 'hide' });
		this.frames.push({ file, holdMs });
	}

	/** Encode to `<name>@2x.gif` in the guide's directory, looping forever. */
	save(name: string): string {
		mkdirSync(OUT, { recursive: true });
		const out = join(OUT, `${name}@2x.gif`);
		// The concat demuxer takes a duration per file, and needs the last file
		// named twice for its duration to count.
		const last = this.frames.at(-1);
		if (!last) throw new Error('a GIF with no frames');
		const list = [
			...this.frames.flatMap((f) => [`file '${f.file}'`, `duration ${f.holdMs / 1000}`]),
			`file '${last.file}'`,
		].join('\n');
		const listFile = join(this.dir, 'frames.txt');
		writeFileSync(listFile, list);
		execFileSync('ffmpeg', [
			'-y',
			'-loglevel',
			'error',
			'-f',
			'concat',
			'-safe',
			'0',
			'-i',
			listFile,
			'-vf',
			'split[a][b];[a]palettegen=stats_mode=full:max_colors=128[p];[b][p]paletteuse=dither=none',
			'-fps_mode',
			'vfr',
			'-loop',
			'0',
			out,
		]);
		rmSync(this.dir, { recursive: true, force: true });
		return out;
	}
}
