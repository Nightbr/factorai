import { gsap } from 'gsap';
import { useEffect, useRef } from 'react';
import { MetalMark } from './MetalMark';
import { Sparks, type SparksHandle } from './Sparks';
import { Wordmark } from './Wordmark';
import { type Board, buildBoard, idlePulse, powerBoard, resetBoard, seatSocket } from './circuit';
import type { HeroCopy } from './copy';
import styles from './hero.module.css';

interface Props {
	active: boolean;
	copy: HeroCopy;
	onImpact: () => void;
}

/**
 * Step 5. A socket waits on a board; the forged mark comes in from above the
 * page — large, soft, hovering — and seats into it. The seating is the
 * impact: a flash, a shake, sparks squeezed out at the rim, the pads taking
 * power. Then the traces etch out of the six ports and the board comes alive.
 * Plays once on arrival, replays on re-entry.
 */
export function Forge({ active, copy, onImpact }: Props) {
	const root = useRef<HTMLDivElement>(null);
	const icon = useRef<HTMLDivElement>(null);
	const flash = useRef<HTMLDivElement>(null);
	const text = useRef<HTMLDivElement>(null);
	const sparks = useRef<SparksHandle>(null);
	const boardSvg = useRef<SVGSVGElement>(null);

	useEffect(() => {
		const rootEl = root.current;
		const iconEl = icon.current;
		const svg = boardSvg.current;
		if (!rootEl || !iconEl || !svg || !flash.current || !text.current) return;

		// Geometry from the untransformed layout: the mark is centred in the
		// scene, and its rendered size is what the socket and the traces key on.
		const w = rootEl.clientWidth;
		const h = rootEl.clientHeight;
		const cx = w / 2;
		const cy = h / 2;
		const mark = iconEl.offsetWidth;
		const sheen = iconEl.querySelector<SVGRectElement>('[data-sheen]');
		const board: Board = buildBoard(svg, { cx, cy, mark, w, h });
		// Freshly built paths carry no dash state: without this they render fully
		// lit until the pulse timeline reaches them.
		resetBoard(board);
		let idle: gsap.core.Timeline | null = null;

		const rest = () => {
			if (!flash.current || !text.current) return;
			gsap.set(iconEl, {
				xPercent: -50,
				yPercent: -50,
				scale: 2.6,
				opacity: 0,
				filter: 'blur(12px) drop-shadow(0 0 0 transparent)',
			});
			gsap.set(text.current, { opacity: 0, y: 16 });
			gsap.set(flash.current, { opacity: 0 });
			if (sheen) gsap.set(sheen, { x: 0 });
			idle?.kill();
			idle = null;
			resetBoard(board);
		};
		rest();
		if (!active) return;

		const tl = gsap.timeline({ delay: 0.3 });
		tl.to(iconEl, { opacity: 1, duration: 0.3, ease: 'power1.out' })
			// The descent: from hovering above the page to seated, sharpening as
			// it comes into the plane.
			.to(
				iconEl,
				{
					scale: 1,
					filter: 'blur(0px) drop-shadow(0 0 0 transparent)',
					duration: 0.8,
					ease: 'power3.in',
				},
				'<',
			)
			.addLabel('hit')
			.add(() => {
				sparks.current?.burstEdges(cx, cy, mark, mark);
				seatSocket(board);
				onImpact();
			})
			.fromTo(
				flash.current,
				{ opacity: 0.22 },
				{ opacity: 0, duration: 0.3, ease: 'power2.out', immediateRender: false },
				'hit',
			)
			.fromTo(
				iconEl,
				{ filter: 'blur(0px) drop-shadow(0 0 28px oklch(81.3% 0.165 75 / 0.9))' },
				{
					filter: 'blur(0px) drop-shadow(0 0 0 transparent)',
					duration: 2.2,
					ease: 'power2.out',
					immediateRender: false,
				},
				'hit',
			)
			.fromTo(
				sheen,
				{ x: 0 },
				{ x: 1100, duration: 1.1, ease: 'power2.inOut', immediateRender: false },
				'hit+=0.25',
			)
			.add(powerBoard(board), 'hit+=0.2')
			.to(text.current, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out' }, 'hit+=0.8')
			.add(() => {
				idle = idlePulse(board);
			});
		return () => {
			tl.kill();
			rest();
		};
	}, [active, onImpact]);

	return (
		<div ref={root} className={styles.forge} data-forge>
			<svg ref={boardSvg} className={styles.board} aria-hidden="true" />
			<div ref={icon} className={styles.icon}>
				<MetalMark className={styles.markSvg} />
			</div>
			<Sparks ref={sparks} className={styles.forgeCanvas} />
			<div ref={flash} className={styles.flash} />
			<div ref={text} className={styles.forgedText}>
				<Wordmark />
				<p className={styles.forgedLine}>{copy.forged}</p>
			</div>
		</div>
	);
}
