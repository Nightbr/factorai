import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { Observer } from 'gsap/Observer';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useCallback, useEffect, useRef, useState } from 'react';
import { About } from '../bento/About';
import { Bento } from '../bento/Bento';
import { Download } from '../bento/Download';
import { AppMock } from '../mock/AppMock';
import { Fog, type FogHandle } from './Fog';
import { Forge } from './Forge';
import { Hud } from './Hud';
import type { HeroCopy } from './copy';
import styles from './hero.module.css';

interface Props {
	copy: HeroCopy;
}

/**
 * The URL follows the scroll (roadmap item 58): `#seq-1` … `#seq-5` through
 * the intro, `#features`, `#download` and `#about` below it, written with
 * replaceState so the history does not fill with every step. Landing on any
 * of them scrolls there. The download dialog's own state is `?modal=download`,
 * a query, so a link to the dialog and a link to the section stay distinct.
 */
const SECTIONS = ['app', 'features', 'download', 'about'] as const;

function setHash(hash: string) {
	const { pathname, search } = window.location;
	const next = `${pathname}${search}${hash ? `#${hash}` : ''}`;
	if (`${pathname}${search}${window.location.hash}` !== next) {
		window.history.replaceState(null, '', next);
	}
}

/** Five labels, four segments of one unit each, then a short hold. */
const STEPS = 5;
const SEGMENTS = STEPS - 1;
/**
 * Scroll past the last label before the pin releases. Without it the fifth
 * step sits exactly at `end`, where ScrollTrigger already reports a leave, so
 * the strike would be cancelled the moment it was armed.
 */
const HOLD = 0.35;
const TOTAL = SEGMENTS + HOLD;

/**
 * One span per character for the stagger, grouped per word so a line can
 * only break between words: "ADE" is never "AD" over "E".
 */
function splitChars(text: string, className: string) {
	return text.split(' ').map((word, w) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: static string, never reordered
		<span key={w} className={styles.word}>
			{w > 0 && <span className={className} aria-hidden="true" />}
			{Array.from(word).map((ch, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static string, never reordered
				<span key={i} data-char="">
					{ch}
				</span>
			))}
		</span>
	));
}

/**
 * The hero: one pinned stage scrubbed by scroll and snapped to five labels
 * (roadmap item 58). Transitions between steps are scrubbed; what happens *on*
 * a step — the decay of "IDE", the strike — plays on arrival, because a strike
 * driven by a mouse wheel feels like mud.
 */
export function Hero({ copy }: Props) {
	const stage = useRef<HTMLDivElement>(null);
	const fog = useRef<FogHandle>(null);
	const msg1 = useRef<HTMLParagraphElement>(null);
	const msg2 = useRef<HTMLParagraphElement>(null);
	const dead = useRef<HTMLHeadingElement>(null);
	const longLive = useRef<HTMLHeadingElement>(null);
	const expansion = useRef<HTMLParagraphElement>(null);
	const trigger = useRef<ScrollTrigger | null>(null);

	const [step, setStep] = useState(0);
	const loader = useRef<HTMLDivElement>(null);
	const stepRef = useRef(0);
	stepRef.current = step;
	const [released, setReleased] = useState(false);
	const [skipVisible, setSkipVisible] = useState(false);

	// Header hidden during the intro, back at the bento. Data attributes on
	// `body`, not classes on `html`: Docusaurus owns the html class attribute
	// through Helmet and rewrites it on every route render.
	useEffect(() => {
		document.body.dataset.faHero = '';
		return () => {
			delete document.body.dataset.faHero;
			delete document.body.dataset.faIntro;
		};
	}, []);
	useEffect(() => {
		if (released) delete document.body.dataset.faIntro;
		else document.body.dataset.faIntro = '';
	}, [released]);

	// The skip link earns its place after two idle seconds on the first step.
	useEffect(() => {
		if (step !== 0 || released) {
			setSkipVisible(false);
			return;
		}
		const t = window.setTimeout(() => setSkipVisible(true), 2000);
		return () => window.clearTimeout(t);
	}, [step, released]);

	useGSAP(
		() => {
			gsap.registerPlugin(ScrollTrigger, ScrollToPlugin, Observer);
			const stageEl = stage.current;
			if (!stageEl || !msg1.current || !msg2.current || !dead.current || !longLive.current) return;
			const forgeEl = stageEl.querySelector<HTMLElement>('[data-forge]');
			if (!forgeEl || !expansion.current) return;

			// Dark until ready: the fog fades up and the first line rises once the
			// scroll timeline below exists, and the loader that covered the page
			// from the server-rendered HTML onward goes with them.
			const fogState = { progress: 0, density: 0, warm: 0 };
			const pushFog = () => fog.current?.set(fogState);
			pushFog();

			const tl = gsap.timeline({ defaults: { ease: 'none' } });
			tl.addLabel('s0', 0);

			// Segment 0→1: the sweep erases message 1, message 2 rises out of it.
			tl.to(fogState, { progress: 1, warm: 0.7, duration: 1, onUpdate: pushFog }, 0)
				.to(msg1.current, { '--erase': 1.15, filter: 'blur(6px)', duration: 0.6 }, 0.05)
				.fromTo(
					msg2.current,
					{ opacity: 0, y: 24, filter: 'blur(10px)' },
					{ opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.45 },
					0.55,
				)
				.addLabel('s1', 1);

			// Segment 1→2: the fog dies to black, "IDE is dead" slams in.
			tl.to(fogState, { density: 0, duration: 0.7, onUpdate: pushFog }, 1.1)
				.to(msg2.current, { opacity: 0, y: -30, filter: 'blur(8px)', duration: 0.4 }, 1.05)
				.fromTo(
					dead.current,
					{ opacity: 0, scale: 1.7 },
					{ opacity: 1, scale: 1, duration: 0.35, ease: 'power4.in' },
					1.65,
				)
				.addLabel('s2', 2);

			// Segment 2→3: the dead word leaves, the answer rises letter by letter.
			const chars = longLive.current.querySelectorAll('span[data-char]');
			tl.to(dead.current, { opacity: 0, y: -60, filter: 'blur(10px)', duration: 0.4 }, 2.05)
				.fromTo(
					chars,
					{ y: 90, opacity: 0 },
					{ y: 0, opacity: 1, duration: 0.5, stagger: 0.02, ease: 'power3.out' },
					2.35,
				)
				.fromTo(expansion.current, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.3 }, 2.7)
				.addLabel('s3', 3);

			// Segment 3→4: the answer leaves, the forge is revealed. The strike plays on arrival.
			tl.to(longLive.current, { opacity: 0, y: -50, duration: 0.4 }, 3.05)
				.to(expansion.current, { opacity: 0, duration: 0.3 }, 3.05)
				.fromTo(forgeEl, { opacity: 0 }, { opacity: 1, duration: 0.5 }, 3.4)
				.addLabel('s4', 4)
				.to({}, { duration: HOLD }, 4);

			trigger.current = ScrollTrigger.create({
				trigger: stageEl,
				start: 'top top',
				end: `+=${TOTAL * 100}%`,
				pin: true,
				// Docusaurus' main wrapper is a flex column, where ScrollTrigger
				// turns pin spacing off by default; the bento must still be pushed
				// below the four screen-heights the stage owns.
				pinSpacing: true,
				scrub: 0.5,
				animation: tl,
				snap: {
					snapTo: 'labels',
					duration: { min: 0.25, max: 0.7 },
					delay: 0.05,
					ease: 'power2.inOut',
					// Nearest label, not the next one in the direction of travel: a
					// programmatic step that lands a pixel short of its label would
					// otherwise be carried on to the label beyond it.
					directional: false,
				},
				onUpdate: (self) => {
					const next = Math.min(SEGMENTS, Math.round(self.progress * TOTAL));
					setStep(next);
					if (self.isActive) setHash(next === 0 ? '' : `seq-${next + 1}`);
				},
				onLeave: () => setReleased(true),
				onEnterBack: () => setReleased(false),
			});

			stageEl.dataset.ready = '';
			const reveal = gsap.timeline({ delay: 0.15 });
			reveal
				.to(fogState, { density: 1, duration: 1.4, ease: 'power2.out', onUpdate: pushFog }, 0)
				.fromTo(
					msg1.current,
					{ opacity: 0, y: 14 },
					{ opacity: 1, y: 0, duration: 0.9, ease: 'power2.out' },
					0.2,
				);
			if (loader.current) {
				reveal
					.to(loader.current, { opacity: 0, duration: 0.6, ease: 'power1.out' }, 0)
					.set(loader.current, { display: 'none' });
			}

			// Below the stage, the section under the middle of the viewport owns
			// the hash.
			for (const id of SECTIONS) {
				const el = document.getElementById(id);
				if (!el) continue;
				ScrollTrigger.create({
					trigger: el,
					start: 'top center',
					end: 'bottom center',
					onToggle: (self) => {
						if (self.isActive) setHash(id);
					},
				});
			}

			// A link into a section — `/#download`, `/?section=about` — has to land
			// past the pinned stage, whose spacer only exists once the trigger
			// above does. Docusaurus' own hash scroll runs before that and lands
			// short, so the section is scrolled to here: after a layout pass, again
			// once fonts and the board have settled, and on every later hash change.
			const targetFromUrl = () => {
				const params = new URLSearchParams(window.location.search);
				const wanted =
					window.location.hash.replace(/^#/, '') ||
					params.get('section') ||
					(params.get('modal') === 'download' ? 'download' : '');
				if (/^(app|features|download|about)$/.test(wanted)) return wanted;
				const seq = /^seq-([1-5])$/.exec(wanted);
				return seq ? Number(seq[1]) - 1 : null;
			};
			const landOn = (where: string | number) => {
				ScrollTrigger.refresh();
				const st = trigger.current;
				if (typeof where === 'number') {
					if (!st) return;
					window.scrollTo({ top: Math.round(st.start + (where / TOTAL) * (st.end - st.start)) });
					return;
				}
				const target = document.getElementById(where);
				if (!target) return;
				const top = target.getBoundingClientRect().top + window.scrollY - 60;
				window.scrollTo({ top, behavior: 'auto' });
			};
			const timers: number[] = [];
			const land = () => {
				const where = targetFromUrl();
				if (where === null) return;
				for (const delay of [0, 250, 800]) {
					timers.push(window.setTimeout(() => landOn(where), delay));
				}
			};
			land();
			window.addEventListener('hashchange', land);
			return () => {
				window.removeEventListener('hashchange', land);
				for (const t of timers) window.clearTimeout(t);
			};
		},
		{ scope: stage },
	);

	const scrollToStep = useCallback((target: number) => {
		const st = trigger.current;
		if (!st) return;
		const clamped = Math.max(0, Math.min(STEPS, target));
		const y =
			clamped >= STEPS
				? st.end + window.innerHeight * 0.85
				: st.start + (clamped / TOTAL) * (st.end - st.start);
		gsap.to(window, {
			scrollTo: Math.round(y),
			duration: 0.8,
			ease: 'power2.inOut',
			overwrite: true,
		});
	}, []);

	const skip = useCallback(() => scrollToStep(STEPS), [scrollToStep]);

	// Arrow keys, space and PageDown walk the steps; Escape skips to the bento.
	useEffect(() => {
		if (released) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			switch (e.key) {
				case 'ArrowDown':
				case 'PageDown':
				case ' ':
					e.preventDefault();
					scrollToStep(step + 1);
					break;
				case 'ArrowUp':
				case 'PageUp':
					e.preventDefault();
					scrollToStep(step - 1);
					break;
				case 'Escape':
					skip();
					break;
				default:
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [released, step, scrollToStep, skip]);

	// One gesture, one step. While the stage is pinned, wheel and touch no
	// longer scroll: each gesture walks one label with the button's tween, so a
	// fast flick cannot skip a step and lose what plays on arrival. Input is
	// ignored while a tween runs and for the rest of the same flick's inertia;
	// the scrollbar stays native and still snaps. Released with the stage, so
	// the bento scrolls normally.
	useEffect(() => {
		if (released) return;
		let lockedUntil = 0;
		let lastMagnitude = 0;
		let lastEvent = 0;
		const walk = (delta: 1 | -1, magnitude: number) => {
			const now = performance.now();
			// A gesture is a rising edge — a delta larger than the one before it —
			// or, after a quiet spell, a delta no smaller than the one before it.
			// An inertia tail only ever decays, so it qualifies as neither even
			// when a stalled frame opens a gap in it; a fresh flick opens big; a
			// mouse wheel's identical notches arrive spaced out and hold steady.
			const rising = magnitude > lastMagnitude * 1.15;
			const quiet = now - lastEvent > 300 && magnitude >= lastMagnitude;
			lastMagnitude = magnitude;
			lastEvent = now;
			if (magnitude < 25 || !(rising || quiet) || now < lockedUntil) return;
			lockedUntil = now + 950;
			scrollToStep(stepRef.current + delta);
		};
		// Wheel is read per event, from the raw delta: Observer's own deltaY is
		// summed per frame, and a stalled frame would sum an inertia tail into
		// one delta big enough to pass as a gesture.
		const wheel = Observer.create({
			target: window,
			type: 'wheel',
			preventDefault: true,
			onWheel: (self) => {
				const dy = self.event instanceof WheelEvent ? self.event.deltaY : 0;
				if (dy !== 0) walk(dy > 0 ? 1 : -1, Math.abs(dy));
			},
		});
		// Touch has no inertia once the default is prevented: one drag, one step.
		// A swipe up means "next", which is what onUp reports.
		const touch = Observer.create({
			target: window,
			type: 'touch',
			tolerance: 12,
			preventDefault: true,
			onUp: () => walk(1, 999),
			onDown: () => walk(-1, 999),
		});
		return () => {
			wheel.kill();
			touch.kill();
		};
	}, [released, scrollToStep]);

	const shake = useCallback(() => {
		const el = stage.current;
		if (!el) return;
		gsap.fromTo(
			el,
			{ x: 0, y: 0 },
			{
				keyframes: [
					{ x: -9, y: 6, duration: 0.05 },
					{ x: 8, y: -5, duration: 0.05 },
					{ x: -6, y: 3, duration: 0.05 },
					{ x: 4, y: -2, duration: 0.05 },
					{ x: 0, y: 0, duration: 0.08 },
				],
				ease: 'none',
			},
		);
	}, []);

	const forgeActive = step === STEPS - 1 && !released;

	return (
		<div className={styles.root}>
			<div ref={loader} className={styles.loader} aria-hidden="true">
				<span className={`${styles.corner} ${styles.tl}`} />
				<span className={`${styles.corner} ${styles.br}`} />
				<svg className={styles.loaderMark} viewBox="0 0 512 512" aria-hidden="true">
					<rect x="8" y="8" width="496" height="496" rx="108" />
					<path d="M153.6 136H377.6V198.4H233.6V232H332.8L273.6 291.2H233.6V379.2H153.6Z" />
				</svg>
				<span className={styles.loaderLine} />
			</div>
			<div ref={stage} className={styles.stage}>
				<Fog ref={fog} className={styles.fog} />
				<Hud step={step} />
				<div className={styles.scene}>
					<p ref={msg1} className={styles.fogText}>
						{copy.fog1}
					</p>
				</div>
				<div className={styles.scene}>
					<p ref={msg2} className={styles.fogText2}>
						{copy.fog2}
					</p>
				</div>
				<div className={`${styles.scene} ${step === 2 ? styles.decay : ''}`}>
					<h1 ref={dead} className={styles.dead}>
						<span className={styles.ide}>IDE</span> is dead
					</h1>
				</div>
				<div className={styles.scene}>
					<h1
						ref={longLive}
						className={styles.longLive}
						aria-label={`${copy.longLive} ${copy.acronym}`}
					>
						{splitChars(copy.longLive, styles.space)}
						<span className={styles.space} aria-hidden="true" />
						<b className={styles.acronym}>{splitChars(copy.acronym, styles.space)}</b>
					</h1>
					<p ref={expansion} className={styles.expansion}>
						{copy.expansion}
					</p>
				</div>
				<Forge active={forgeActive} copy={copy} onImpact={shake} />
			</div>

			<button
				type="button"
				className={`${styles.down} ${released ? styles.hidden : ''}`}
				onClick={() => scrollToStep(step + 1)}
				aria-label="Next"
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<path
						d="M12 4v16m0 0l-7-7m7 7l7-7"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</button>
			<button
				type="button"
				className={`${styles.skip} ${skipVisible ? styles.skipVisible : ''}`}
				onClick={skip}
				tabIndex={skipVisible ? 0 : -1}
			>
				Skip
			</button>

			<section className={styles.appSection} id="app">
				<div className={styles.appHead}>
					<span className={styles.eyebrow}>the app</span>
					<h2 className={styles.appHeading}>Three agents, one afternoon.</h2>
					<p className={styles.appLead}>
						Hand each task to an agent and keep every one in view. A dot turns amber the moment one
						needs you; switch to it, answer, and move on. The Changes panel shows what it touched,
						the graph shows what it landed, and every line of it is yours to audit, whenever you
						choose.
					</p>
				</div>
				<AppMock />
			</section>
			<Bento />
			<Download />
			<About />
		</div>
	);
}
