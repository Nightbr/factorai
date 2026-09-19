import styles from './bento.module.css';

/**
 * Coded miniatures of the real surfaces, in the app's own tokens (DESIGN.md:
 * 28px rows, two type sizes, the status ramp). Each runs a short CSS loop that
 * shows the one behaviour its cell claims, and nothing the app does not do.
 */

export function SessionsMini() {
	const rows = [
		['fix flaky e2e on CI', 'working'],
		['migrate settings to SQLite', 'waiting'],
		['write release notes', 'working'],
		['triage inbox', 'stopped'],
	] as const;
	return (
		<div className={styles.mini} data-mini="sessions">
			<div className={styles.tabs}>
				{rows.slice(0, 3).map(([name, status], i) => (
					<span key={name} className={styles.tab} data-status={status} data-i={i}>
						<i className={styles.dot} />
						{name}
					</span>
				))}
			</div>
			<div className={styles.term}>
				<span className={styles.termLine} style={{ width: '62%' }} />
				<span className={styles.termLine} style={{ width: '38%' }} />
				<span className={styles.termLine} style={{ width: '74%' }} />
				<span className={styles.termPrompt}>
					Allow <b>Edit</b> on src/app.ts? <em>(y/n)</em>
					<i className={styles.caret} />
				</span>
			</div>
			<ul className={styles.list}>
				{rows.map(([name, status], i) => (
					<li key={name} data-status={status} data-i={i}>
						<i className={styles.dot} />
						<span>{name}</span>
						<small>{['2m', '14s', '1h', '3d'][i]}</small>
					</li>
				))}
			</ul>
		</div>
	);
}

export function RoutinesMini() {
	return (
		<div className={styles.mini} data-mini="routines">
			<div className={styles.routine}>
				<span className={styles.mono}>0 2 * * *</span>
				<span>nightly triage</span>
				<i className={styles.switch} />
			</div>
			<div className={styles.routine}>
				<span className={styles.mono}>0 * * * *</span>
				<span>lint gate</span>
				<i className={styles.switch} />
			</div>
			<div className={styles.fire}>
				<i className={`${styles.dot} ${styles.dotBackground}`} />
				<span>
					nightly triage <small>running, no tab</small>
				</span>
			</div>
		</div>
	);
}

export function SearchMini() {
	return (
		<div className={styles.mini} data-mini="search">
			<div className={styles.input}>
				<span className={styles.typed} />
				<i className={styles.caret} />
			</div>
			<ul className={styles.hits}>
				{[
					['auth middleware', 'the permission prompt fires before'],
					['release 0.44', 'permission prompt on first launch'],
					['sidebar rail', 'a permission prompt in the footer'],
				].map(([where, snippet], i) => (
					<li key={where} data-i={i}>
						<small>{where}</small>
						<span>
							{snippet.split('permission prompt')[0]}
							<mark>permission prompt</mark>
							{snippet.split('permission prompt')[1]}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

export function ChangesMini() {
	const files = [
		['src/session.rs', 12, 3],
		['src/graph.ts', 41, 8],
		['specs/05-features.md', 6, 0],
	] as const;
	return (
		<div className={styles.mini} data-mini="changes">
			<ul className={styles.files}>
				{files.map(([f, add, del]) => (
					<li key={f}>
						<span>{f}</span>
						<small>
							<b>+{add}</b> <s>-{del}</s>
						</small>
					</li>
				))}
			</ul>
			<div className={styles.diff}>
				{[
					['ctx', 70],
					['del', 55],
					['add', 62],
					['add', 44],
					['ctx', 80],
					['add', 36],
				].map(([k, w], i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static rows
					<span key={i} data-k={k} style={{ width: `${w}%` }} />
				))}
			</div>
			<svg className={styles.rail} viewBox="0 0 60 120" aria-hidden="true">
				<path d="M12 0V120" />
				<path d="M36 40V120" />
				<path d="M12 40C12 20 36 60 36 40" />
				{[10, 40, 70, 100].map((y, i) => (
					<circle key={y} cx={i === 1 ? 36 : 12} cy={y} r="4" data-i={i} />
				))}
			</svg>
		</div>
	);
}

export function SidebarMini() {
	return (
		<div className={styles.mini} data-mini="sidebar">
			<div className={styles.group}>
				<small>Pro</small>
				<span>billing-api</span>
				<span>docs-site</span>
				<span className={styles.slot} />
			</div>
			<div className={styles.group} data-target>
				<small>Side projects</small>
				<span>factorai</span>
				<span className={styles.slot} />
			</div>
			<span className={styles.dragged}>homelab</span>
		</div>
	);
}

export function ViewerMini() {
	return (
		<div className={styles.mini} data-mini="viewer">
			<div className={styles.viewerHead}>
				<span className={styles.mono}>secrets.enc.yaml</span>
				<i className={styles.lock} />
			</div>
			<div className={styles.code}>
				{[58, 34, 71, 46, 62].map((w, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static rows
					<span key={i} style={{ width: `${w}%` }} data-i={i} />
				))}
			</div>
		</div>
	);
}

export function WorktreesMini() {
	return (
		<div className={styles.mini} data-mini="worktrees">
			{[
				['main', 'work'],
				['feat/graph-lanes', 'work'],
				['fix/pty-resize', 'perso'],
			].map(([branch, profile], i) => (
				<div key={branch} className={styles.lane} data-i={i}>
					<i className={styles.dot} data-status="working" />
					<span className={styles.mono}>{branch}</span>
					<small>{profile}</small>
				</div>
			))}
		</div>
	);
}

export function LocalMini() {
	return (
		<div className={styles.mini} data-mini="local">
			<svg viewBox="0 0 120 64" className={styles.ports} aria-hidden="true">
				<rect x="34" y="4" width="52" height="56" rx="10" />
				{[14, 28, 42].map((y) => (
					<g key={y}>
						<rect x="30" y={y} width="8" height="8" />
						<rect x="82" y={y} width="8" height="8" />
						<path d={`M30 ${y + 4}H4`} />
						<path d={`M90 ${y + 4}H116`} />
					</g>
				))}
			</svg>
			<ul className={styles.plain}>
				<li>no telemetry</li>
				<li>no account</li>
				<li>no server</li>
			</ul>
		</div>
	);
}
