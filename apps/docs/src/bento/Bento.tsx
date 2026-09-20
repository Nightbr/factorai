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
	ShellMini,
} from './minis';

const MINIS: Record<string, () => ReactNode> = {
	sessions: SessionsMini,
	routines: RoutinesMini,
	search: SearchMini,
	changes: ChangesMini,
	sidebar: SidebarMini,
	viewer: ViewerMini,
	shell: ShellMini,
	local: LocalMini,
};

export function Bento() {
	const section = useRef<HTMLElement>(null);
	const grid = useRef<HTMLDivElement>(null);

	useGSAP(
		() => {
			gsap.registerPlugin(ScrollTrigger);
			const sectionEl = section.current;
			const gridEl = grid.current;
			if (!sectionEl || !gridEl) return;
			const cells = Array.from(gridEl.querySelectorAll<HTMLElement>('[data-cell]'));

			// Each cell powers up once, when its top is well on screen: the frame
			// takes the amber, the label lights, the miniature starts.
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
		},
		{ scope: section },
	);

	return (
		<section ref={section} className={styles.bento} id="features">
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
							style={
								{
									'--span': cell.span,
									'--stage': cell.span >= 4 ? '236px' : '224px',
								} as React.CSSProperties
							}
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
