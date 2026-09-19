import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { type ReactNode, useRef } from 'react';
import styles from './bento.module.css';
import { CELLS, HEADING } from './copy';
import {
	ChangesMini,
	LocalMini,
	RoutinesMini,
	SearchMini,
	SessionsMini,
	SidebarMini,
	ViewerMini,
	WorktreesMini,
} from './minis';

const MINIS: Record<string, () => ReactNode> = {
	sessions: SessionsMini,
	routines: RoutinesMini,
	search: SearchMini,
	changes: ChangesMini,
	sidebar: SidebarMini,
	viewer: ViewerMini,
	worktrees: WorktreesMini,
	local: LocalMini,
};

const NS = 'http://www.w3.org/2000/svg';

/**
 * The board continues under the bento: a trunk drops from the hero, a bus runs
 * along each row gap, and every cell hangs off its bus by a short lead ending
 * in a pad on the cell's top edge. Cells are components; they light when their
 * lead is wired, once, as they scroll in. Geometry is measured from the laid
 * out grid, so it survives any breakpoint.
 */
function wire(svg: SVGSVGElement, section: HTMLElement, cells: HTMLElement[]) {
	svg.replaceChildren();
	const box = section.getBoundingClientRect();
	svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
	const rects = cells.map((c) => {
		const r = c.getBoundingClientRect();
		return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
	});
	// Rows by top edge; the bus for a row sits in the gap above it.
	const rowTops = [...new Set(rects.map((r) => Math.round(r.y)))].sort((a, b) => a - b);
	const el = (tag: string, attrs: Record<string, string | number>) => {
		const node = document.createElementNS(NS, tag);
		for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
		svg.append(node);
		return node;
	};
	// The hero's board arrives at top centre, joins the first bus, and the
	// trunk then runs down the left gutter, outside every cell.
	const gridLeft = Math.min(...rects.map((r) => r.x));
	const gridRight = Math.max(...rects.map((r) => r.x + r.w));
	const trunkX = gridLeft - 18;
	const busY = (top: number) => top - 14;
	el('path', { d: `M${box.width / 2} 0V${busY(rowTops[0])}`, 'data-wire': 'trunk' });
	el('path', {
		d: `M${trunkX} ${busY(rowTops[0])}V${busY(rowTops[rowTops.length - 1])}`,
		'data-wire': 'trunk',
	});
	const leads: SVGPathElement[] = [];
	rowTops.forEach((top, i) => {
		const y = busY(top);
		const inRow = rects.filter((r) => Math.round(r.y) === top);
		el('path', { d: `M${trunkX} ${y}H${gridRight - 24}`, 'data-wire': 'bus', 'data-row': i });
		for (const r of inRow) {
			const px = r.x + Math.min(48, r.w * 0.2);
			const lead = el('path', { d: `M${px} ${y}V${r.y}`, 'data-wire': 'lead' }) as SVGPathElement;
			el('rect', { x: px - 5, y: r.y - 2, width: 10, height: 4, rx: 1, 'data-wire': 'pad' });
			leads.push(lead);
		}
	});
	return leads;
}

export function Bento() {
	const section = useRef<HTMLElement>(null);
	const svg = useRef<SVGSVGElement>(null);
	const grid = useRef<HTMLDivElement>(null);

	useGSAP(
		() => {
			gsap.registerPlugin(ScrollTrigger);
			const sectionEl = section.current;
			const svgEl = svg.current;
			const gridEl = grid.current;
			if (!sectionEl || !svgEl || !gridEl) return;
			const cells = Array.from(gridEl.querySelectorAll<HTMLElement>('[data-cell]'));

			const build = () => {
				wire(svgEl, sectionEl, cells);
			};
			build();
			const ro = new ResizeObserver(build);
			ro.observe(sectionEl);

			// Each cell wires in once, when its top third is on screen: the lead
			// draws, the pad and the frame take power, the miniature starts.
			for (const cell of cells) {
				ScrollTrigger.create({
					trigger: cell,
					start: 'top 80%',
					once: true,
					onEnter: () => {
						cell.dataset.powered = '';
					},
				});
			}
			ScrollTrigger.create({
				trigger: sectionEl,
				start: 'top 70%',
				once: true,
				onEnter: () => {
					sectionEl.dataset.powered = '';
				},
			});
			return () => ro.disconnect();
		},
		{ scope: section },
	);

	return (
		<section ref={section} className={styles.bento} id="features">
			<svg ref={svg} className={styles.wires} aria-hidden="true" />
			<div className={styles.head}>
				<span className={styles.eyebrow}>what it is</span>
				<h2 className={styles.heading}>{HEADING}</h2>
			</div>
			<div ref={grid} className={styles.grid}>
				{CELLS.map((cell) => {
					const Mini = MINIS[cell.id];
					return (
						<article
							key={cell.id}
							className={styles.cell}
							data-cell={cell.id}
							style={{ '--span': cell.span } as React.CSSProperties}
						>
							<span className={`${styles.corner} ${styles.tl}`} />
							<span className={`${styles.corner} ${styles.br}`} />
							<div className={styles.stage}>{Mini ? <Mini /> : null}</div>
							<div className={styles.text}>
								<span className={styles.label}>{cell.label}</span>
								<h3 className={styles.title}>{cell.title}</h3>
								<p className={styles.line}>{cell.line}</p>
							</div>
						</article>
					);
				})}
			</div>
		</section>
	);
}
