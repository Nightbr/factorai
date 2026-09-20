import useBaseUrl from '@docusaurus/useBaseUrl';
import { useEffect, useRef, useState } from 'react';
import styles from './mock.module.css';
import { INITIAL, LOOP_MS, type MockState, SCRIPT, SPEED, type Status } from './script';

/**
 * A working mock of the app, drawn in its own tokens (DESIGN.md: the dark
 * ground, 28px rows, two type sizes, the status ramp, a mono terminal) and
 * driven by the screenplay in script.ts on a loop. It runs only while on
 * screen. Rendered at a fixed 1120×640 and scaled to the container, so the
 * layout is the app's at every viewport.
 */
const WIDTH = 1120;
const HEIGHT = 640;

const PROJECTS: { group: string | null; name: string }[] = [
	{ group: 'Pro', name: 'billing-api' },
	{ group: 'Pro', name: 'docs-site' },
	{ group: 'Side projects', name: 'homelab' },
	{ group: 'Side projects', name: 'recipes' },
];

function Dot({ status }: { status?: Status }) {
	return <i className={styles.dot} data-status={status ?? 'stopped'} />;
}

/** The app's rule: two initials from a two-part name, else the first two letters. */
function initials(name: string): string {
	const parts = name.split(/[\s\-_]+/).filter(Boolean);
	return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

const AUTHORS: Record<string, { initials: string; colour: string }> = {
	claude: { initials: 'CL', colour: 'oklch(70% 0.15 255)' },
	you: { initials: 'YO', colour: 'oklch(72% 0.16 145)' },
};

export function AppMock() {
	const [state, setState] = useState<MockState>(INITIAL);
	const [scale, setScale] = useState(1);
	const frame = useRef<HTMLDivElement>(null);
	const icon = useBaseUrl('/img/factorai-icon.svg');

	// Scale to the container's width.
	useEffect(() => {
		const el = frame.current;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) => {
			setScale(Math.min(1, entry.contentRect.width / WIDTH));
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// The screenplay, looping, only while the mock is on screen.
	useEffect(() => {
		const el = frame.current;
		if (!el) return;
		let timers: number[] = [];
		const stop = () => {
			for (const t of timers) window.clearTimeout(t);
			timers = [];
		};
		const run = () => {
			stop();
			setState(INITIAL);
			for (const [at, step] of SCRIPT) {
				timers.push(window.setTimeout(() => setState((s) => step(s)), at * SPEED));
			}
			timers.push(window.setTimeout(run, LOOP_MS));
		};
		const io = new IntersectionObserver(([entry]) => {
			if (entry.isIntersecting) run();
			else stop();
		});
		io.observe(el);
		return () => {
			io.disconnect();
			stop();
		};
	}, []);

	const active = state.tabs.find((t) => t.id === state.active) ?? state.tabs[0];

	return (
		<div ref={frame} className={styles.frame} style={{ height: HEIGHT * scale }}>
			<div className={styles.app} style={{ transform: `scale(${scale})` }} aria-hidden="true">
				<header className={styles.header}>
					<span className={styles.brand}>
						<img src={icon} alt="" width="18" height="18" />
						<b className={styles.wordmark}>
							factor<span>ai</span>
						</b>
					</span>
					<div className={styles.tabs}>
						{state.tabs.map((t) => (
							<span
								key={t.id}
								className={styles.tab}
								data-active={t.id === state.active ? '' : undefined}
							>
								<Dot status={t.status} />
								{t.name}
								<b>×</b>
							</span>
						))}
					</div>
				</header>

				<div className={styles.body}>
					<aside className={styles.sidebar}>
						<div className={styles.search}>Search sessions…</div>
						{['Pro', 'Side projects'].map((group) => (
							<div key={group} className={styles.group}>
								<small>{group}</small>
								{PROJECTS.filter((p) => p.group === group).map((p) => (
									<div
										key={p.name}
										className={styles.project}
										data-open={p.name === 'billing-api' ? '' : undefined}
									>
										<span className={styles.avatar} data-name={p.name}>
											<b>{initials(p.name)}</b>
											{state.sidebarStatus[p.name] && <Dot status={state.sidebarStatus[p.name]} />}
										</span>
										{p.name}
									</div>
								))}
								{group === 'Pro' && (
									<ul className={styles.sessions}>
										{state.tabs.map((t) => (
											<li key={t.id} data-active={t.id === state.active ? '' : undefined}>
												<span>{t.name}</span>
												<Dot status={t.status} />
											</li>
										))}
										<li className={styles.more}>7 more…</li>
									</ul>
								)}
							</div>
						))}
						<div className={styles.sidebarFoot}>
							<span>v0.45.0</span>
							<span className={styles.upToDate}>Up to date</span>
						</div>
					</aside>

					<main className={styles.main}>
						<div className={styles.sessionHead}>
							<Dot status={active.status} />
							<span>{active.name}</span>
							<small>billing-api · main</small>
						</div>
						<div className={styles.term}>
							{state.term.map((l) => (
								<div key={l.id} className={styles.line} data-kind={l.kind}>
									{l.text}
								</div>
							))}
							<div className={styles.caretLine}>
								<i className={styles.caret} />
							</div>
						</div>
						<div className={styles.footShell}>
							<span className={styles.mono}>~/dev/billing-api</span>
							<span className={styles.mono}>$ cargo test --workspace</span>
						</div>
					</main>

					<aside className={styles.panel}>
						<div className={styles.panelTabs}>
							{(['files', 'changes', 'graph'] as const).map((p) => (
								<span key={p} data-active={p === state.panel ? '' : undefined}>
									{p === 'files' ? 'Files' : p === 'changes' ? 'Changes' : 'Graph'}
									{p === 'changes' && state.changes.length > 0 && <em>{state.changes.length}</em>}
								</span>
							))}
						</div>
						{state.panel === 'changes' && (
							<div className={styles.changes}>
								{state.changes.length === 0 ? (
									<div className={styles.empty}>Working tree clean</div>
								) : (
									<>
										<small>Unstaged · {state.changes.length}</small>
										{state.changes.map((c) => (
											<div key={c.path} className={styles.change}>
												<span>{c.path}</span>
												<b>+{c.add}</b>
												<s>-{c.del}</s>
											</div>
										))}
									</>
								)}
							</div>
						)}
						{state.panel === 'graph' && (
							<div className={styles.graph}>
								<div className={styles.row} data-working>
									<svg viewBox="0 0 40 26" className={styles.rail} aria-hidden="true">
										<path d="M12 13V26" data-lane="0" />
										<circle cx="12" cy="13" r="3.5" data-dirty />
									</svg>
									<span className={styles.subject}>Working tree</span>
									<small>
										{state.changes.length > 0 ? `${state.changes.length} changed` : 'clean'}
									</small>
								</div>
								{state.commits.map((c) => {
									const a = AUTHORS[c.author] ?? AUTHORS.claude;
									const x = c.lane === 1 ? 26 : 12;
									return (
										<div key={c.id} className={styles.row} data-lane={c.lane}>
											<svg viewBox="0 0 40 26" className={styles.rail} aria-hidden="true">
												<path d="M12 0V26" data-lane="0" />
												{c.lane === 1 && !c.merge && <path d="M26 0V26" data-lane="1" />}
												{c.merge && <path d="M26 0V13C26 22 12 20 12 26" data-lane="1" />}
												<circle cx={x} cy="13" r="7" style={{ fill: a.colour }} />
												<text x={x} y="13">
													{a.initials}
												</text>
											</svg>
											{c.head && (
												<em className={styles.chip}>
													<i>✓</i>main
												</em>
											)}
											<span className={styles.subject}>{c.message}</span>
										</div>
									);
								})}
							</div>
						)}
						{state.panel === 'files' && <div className={styles.empty}>src/</div>}
					</aside>
				</div>
			</div>
		</div>
	);
}
