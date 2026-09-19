import { gsap } from 'gsap';

/**
 * The board the forged mark powers. Traces leave the mark's six ports — the
 * ports are the idea (B1): something goes in, something comes back — and run
 * outward PCB-style, orthogonal runs with 45° bends, ending in vias. Built into
 * an SVG imperatively at strike time, because the geometry depends on where
 * the mark landed on this viewport; GSAP draws the traces dim, then sends an
 * amber pulse down each one and leaves it powered.
 */

export interface Board {
	/** Dim trace, always visible once drawn. */
	base: SVGPathElement[];
	/** Amber copy carrying the pulse. */
	lit: SVGPathElement[];
	/** Wider, soft copy under the pulse. */
	glow: SVGPathElement[];
	/** Via pads at the ends and the branch tips. */
	vias: SVGCircleElement[];
	lengths: number[];
	/** The socket the mark seats into, and its six pin pads. */
	socket: SVGRectElement;
	pads: SVGRectElement[];
}

interface Layout {
	cx: number;
	cy: number;
	/** Rendered size of the mark, in px. */
	mark: number;
	w: number;
	h: number;
}

const NS = 'http://www.w3.org/2000/svg';

/** Port centres at 4, 8 and 12 cells of 16 (B2). */
const PORT_FRACTIONS = [0.25, 0.5, 0.75] as const;

/** Deterministic: the board must not redraw differently on every re-arm. */
function rng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

type Pt = [number, number];

function pathFrom(points: Pt[]): string {
	return points
		.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
		.join('');
}

/**
 * One trace: a short run out of the port, a 45° bend towards its lane, a long
 * run, maybe a second jog, then a via short of the viewport edge.
 */
function trace(start: Pt, dir: 1 | -1, lean: -1 | 0 | 1, r: () => number, w: number): Pt[] {
	const pts: Pt[] = [start];
	let [x, y] = start;
	x += dir * (36 + r() * 50);
	pts.push([x, y]);
	// Each port owns a lane: the top trace only ever bends up, the bottom one
	// down, the middle one stays level until it is clear of both. Traces on a
	// board do not cross, and this is what keeps them from doing so.
	const rise = lean === 0 ? 0 : lean * (40 + r() * 110);
	if (rise !== 0) {
		x += dir * Math.abs(rise);
		y += rise;
		pts.push([x, y]);
	}
	const edge = dir > 0 ? w : 0;
	const remaining = Math.abs(edge - x);
	x += dir * remaining * (0.35 + r() * 0.3);
	pts.push([x, y]);
	if (r() > 0.4) {
		const jog = lean === 0 ? (r() - 0.5) * 50 : lean * (30 + r() * 80);
		x += dir * Math.abs(jog);
		y += jog;
		pts.push([x, y]);
		x += dir * Math.abs(edge - x) * (0.3 + r() * 0.35);
		pts.push([x, y]);
	}
	return pts;
}

/** A short branch off the middle of a run, away from the board's centre line. */
function branch(from: Pt, dir: 1 | -1, up: -1 | 1, r: () => number): Pt[] {
	const d = 30 + r() * 60;
	const [x, y] = from;
	return [
		[x, y],
		[x + dir * d, y + up * d],
		[x + dir * (d + 20 + r() * 70), y + up * d],
	];
}

function el<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
	const node = document.createElementNS(NS, tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
	return node;
}

export function buildBoard(svg: SVGSVGElement, layout: Layout): Board {
	svg.replaceChildren();
	svg.setAttribute('viewBox', `0 0 ${layout.w} ${layout.h}`);
	const r = rng(7919);
	// The socket: a recess a little larger than the mark, with a pin pad on the
	// rim at each of the six ports. Drawn before the mark arrives.
	const inset = layout.mark * 0.08;
	const side = layout.mark + inset * 2;
	const socket = el('rect', {
		x: layout.cx - side / 2,
		y: layout.cy - side / 2,
		width: side,
		height: side,
		rx: (layout.mark * 3.5) / 16 + inset,
		'data-socket': '',
	});
	svg.append(socket);
	const pads: SVGRectElement[] = [];
	for (const dir of [-1, 1] as const) {
		for (const f of PORT_FRACTIONS) {
			const padW = inset * 1.6;
			const padH = layout.mark * 0.125;
			const pad = el('rect', {
				x: dir < 0 ? layout.cx - side / 2 - padW * 0.6 : layout.cx + side / 2 - padW * 0.4,
				y: layout.cy + (f - 0.5) * layout.mark - padH / 2,
				width: padW,
				height: padH,
				rx: 2,
				'data-pad': '',
			});
			svg.append(pad);
			pads.push(pad);
		}
	}

	const board: Board = {
		base: [],
		lit: [],
		glow: [],
		vias: [],
		lengths: [],
		socket,
		pads,
	};
	const traces: Pt[][] = [];
	for (const dir of [-1, 1] as const) {
		PORT_FRACTIONS.forEach((f, i) => {
			const start: Pt = [layout.cx + (dir * layout.mark) / 2, layout.cy + (f - 0.5) * layout.mark];
			const lean = ([-1, 0, 1] as const)[i];
			const pts = trace(start, dir, lean, r, layout.w);
			traces.push(pts);
			// Only the outer traces branch, outward; the middle lane stays clean.
			if (lean !== 0 && pts.length >= 4 && r() > 0.35) {
				const [ax, ay] = pts[2];
				const [bx] = pts[3];
				traces.push(branch([ax + (bx - ax) * (0.3 + r() * 0.4), ay], dir, lean, r));
			}
		});
	}

	const gBase = el('g', { fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
	const gGlow = el('g', { fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
	const gLit = el('g', { fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
	const gVias = el('g', {});
	svg.append(gBase, gGlow, gLit, gVias);

	for (const pts of traces) {
		const d = pathFrom(pts);
		const base = el('path', { d, 'data-trace': 'base' });
		const glow = el('path', { d, 'data-trace': 'glow' });
		const lit = el('path', { d, 'data-trace': 'lit' });
		gBase.append(base);
		gGlow.append(glow);
		gLit.append(lit);
		const len = base.getTotalLength();
		board.base.push(base);
		board.glow.push(glow);
		board.lit.push(lit);
		board.lengths.push(len);
		const [ex, ey] = pts[pts.length - 1];
		const via = el('circle', { cx: ex, cy: ey, r: 4.5, 'data-via': '' });
		gVias.append(via);
		board.vias.push(via);
	}
	return board;
}

/** The mark has seated: the socket and its pads take power. */
export function seatSocket(board: Board) {
	board.socket.setAttribute('data-lit', '');
	for (const p of board.pads) p.setAttribute('data-lit', '');
}

/** Everything dark and undrawn. */
export function resetBoard(board: Board) {
	board.base.forEach((p, i) => {
		gsap.set(p, {
			strokeDasharray: board.lengths[i],
			strokeDashoffset: board.lengths[i],
			opacity: 1,
		});
	});
	for (const list of [board.lit, board.glow]) {
		list.forEach((p, i) => {
			gsap.set(p, {
				strokeDasharray: `${board.lengths[i] * 0.22} ${board.lengths[i]}`,
				strokeDashoffset: board.lengths[i] * 0.22,
				opacity: 0,
			});
		});
	}
	for (const v of board.vias) v.removeAttribute('data-lit');
	for (const b of board.base) b.removeAttribute('data-powered');
	board.socket.removeAttribute('data-lit');
	for (const p of board.pads) p.removeAttribute('data-lit');
}

/**
 * Draw the traces out from the mark, then send a pulse down each. Returns the
 * timeline so the caller can place it and kill it.
 */
export function powerBoard(board: Board): gsap.core.Timeline {
	const tl = gsap.timeline();
	const n = board.base.length;
	// Etch: the dim trace draws outward from the port.
	board.base.forEach((p, i) => {
		tl.to(p, { strokeDashoffset: 0, duration: 0.55, ease: 'power2.out' }, i * 0.04);
	});
	// Pulse: a short amber dash travels the length, a soft glow under it.
	const pulse = gsap.timeline();
	for (let i = 0; i < n; i++) {
		const len = board.lengths[i];
		const dash = len * 0.22;
		const dur = 0.55 + len / 900;
		const at = i * 0.05;
		for (const p of [board.lit[i], board.glow[i]]) {
			pulse.set(p, { opacity: 1 }, at);
			pulse.fromTo(
				p,
				{ strokeDashoffset: dash },
				{ strokeDashoffset: -len, duration: dur, ease: 'power1.inOut', immediateRender: false },
				at,
			);
			pulse.set(p, { opacity: 0 }, at + dur);
		}
		// Arrival: the via lights and the trace stays powered.
		pulse.set(board.vias[i], { attr: { 'data-lit': '' } }, at + dur - 0.05);
		pulse.set(board.base[i], { attr: { 'data-powered': '' } }, at + dur - 0.05);
	}
	tl.add(pulse, 0.3);
	return tl;
}

/** A quieter pulse that keeps running while the scene is on screen. */
export function idlePulse(board: Board): gsap.core.Timeline {
	const tl = gsap.timeline({ repeat: -1, repeatDelay: 2.6 });
	board.lit.forEach((p, i) => {
		const len = board.lengths[i];
		const dash = len * 0.22;
		const dur = 0.7 + len / 900;
		const at = (i % 5) * 0.12;
		tl.set(p, { opacity: 0.7 }, at)
			.fromTo(
				p,
				{ strokeDashoffset: dash },
				{ strokeDashoffset: -len, duration: dur, ease: 'power1.inOut', immediateRender: false },
				at,
			)
			.set(p, { opacity: 0 }, at + dur);
	});
	return tl;
}
