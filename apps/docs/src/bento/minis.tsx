import styles from './bento.module.css';

/**
 * Coded miniatures of the real surfaces, in the app's own tokens (DESIGN.md:
 * 28px rows, two type sizes, the status ramp). Each runs a short CSS loop that
 * shows the one behaviour its cell claims, and nothing the app does not do.
 */

export function SessionsMini() {
	const rows = [
		['fix flaky e2e on CI', 'working', 'Bash  pnpm e2e --grep login', '✓ 5 passed'],
		[
			'migrate settings to SQLite',
			'waiting',
			'Edit  src/store/prefsStore.ts',
			'? Keep a backup of settings.json?  (y/n)',
		],
		['write release notes', 'working', 'Read  specs/roadmap/DONE.md', 'Edit  CHANGELOG.md'],
	] as const;
	return (
		<div className={styles.mini} data-mini="sessions">
			<div className={styles.tabs}>
				{rows.map(([name, status], i) => (
					<span key={name} className={styles.tab} data-status={status} data-i={i}>
						<i className={styles.dot} />
						{name}
					</span>
				))}
			</div>
			<div className={styles.screens}>
				<div className={styles.reel}>
					{rows.map(([name, , a, b]) => (
						<div key={name} className={styles.screen}>
							<span className={styles.termLine} style={{ width: '58%' }} />
							<span className={styles.termLine} style={{ width: '36%' }} />
							<span className={styles.termPrompt}>{a}</span>
							<span className={styles.termPrompt}>
								{b}
								<i className={styles.caret} />
							</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

export function RoutinesMini() {
	return (
		<div className={styles.mini} data-mini="routines">
			<div className={styles.routineHead}>
				<span className={styles.routineName}>nightly triage</span>
				<span className={styles.presets}>
					<b>Nightly</b>
					<i>Hourly</i>
					<i>Custom</i>
				</span>
			</div>
			<div className={styles.routine}>
				<span className={styles.mono}>0 2 * * *</span>
				<span>Triage new issues, label them, draft replies</span>
				<i className={styles.switch} />
			</div>
			<ul className={styles.nextRuns}>
				<li>
					<small>next</small>Tomorrow 02:00
				</li>
				<li>
					<small>then</small>Sat 02:00 · Sun 02:00 · Mon 02:00
				</li>
			</ul>
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
	const commits = [
		['fix: wait for the session cookie before asserting', 'CL', true],
		['feat: session tabs come back on launch', 'CL', false],
		['fix: graph lanes keep their colour', 'CL', false],
		['chore: bump tauri to 2.11', 'YO', false],
	] as const;
	return (
		<div className={styles.mini} data-mini="changes">
			<div className={styles.panelTabs}>
				<span data-tab="changes">
					Changes<em>3</em>
				</span>
				<span data-tab="graph">Graph</span>
			</div>
			<div className={styles.auditPane} data-pane="changes">
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
					].map(([k, w], i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static rows
						<span key={i} data-k={k} style={{ width: `${w}%` }} />
					))}
				</div>
			</div>
			<div className={styles.auditPane} data-pane="graph">
				{commits.map(([msg, who, head], i) => (
					<div key={msg} className={styles.commitRow} data-i={i}>
						<svg viewBox="0 0 28 26" aria-hidden="true">
							<path d="M12 0V26" />
							<circle cx="12" cy="13" r="7" data-who={who} />
							<text x="12" y="13">
								{who}
							</text>
						</svg>
						{head && <em>✓ main</em>}
						<span>{msg}</span>
					</div>
				))}
			</div>
		</div>
	);
}

/** The sidebar as the app draws it: group headers, initials tiles, a status badge, a row on the move. */
function Project({ name, status }: { name: string; status?: string }) {
	const parts = name.split(/[\s\-_]+/);
	const initials = (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
	return (
		<div className={styles.sbProject}>
			<span className={styles.sbAvatar} data-name={name}>
				<b>{initials}</b>
				{status && <i className={styles.dot} data-status={status} />}
			</span>
			<span>{name}</span>
			<em>+</em>
		</div>
	);
}

export function SidebarMini() {
	return (
		<div className={styles.mini} data-mini="sidebar">
			<div className={styles.sbGroup}>
				<small>
					<i>▾</i>Pro
				</small>
				<Project name="billing-api" status="working" />
				<Project name="docs-site" status="waiting" />
				<span className={styles.slot} />
			</div>
			<div className={styles.sbGroup} data-target>
				<small>
					<i>▾</i>Side projects
				</small>
				<Project name="factorai" status="working" />
				<span className={styles.slot} />
			</div>
			<div className={styles.dragged}>
				<Project name="homelab" />
			</div>
		</div>
	);
}

export function ViewerMini() {
	return (
		<div className={styles.mini} data-mini="viewer">
			<ul className={styles.tree}>
				<li data-dirty>
					<i>▾</i>src
				</li>
				<li data-changed data-depth="1">
					session.rs
				</li>
				<li data-depth="1">graph.ts</li>
				<li data-ignored data-depth="1">
					generated.ts
				</li>
				<li data-selected>secrets.enc.yaml</li>
			</ul>
			<div className={styles.viewer}>
				<div className={styles.viewerTab}>
					<span className={styles.mono}>secrets.enc.yaml</span>
					<i className={styles.lock} />
				</div>
				<div className={styles.code}>
					{[58, 34, 71, 46].map((w, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static rows
						<span key={i} style={{ width: `${w}%` }} data-i={i} />
					))}
				</div>
			</div>
		</div>
	);
}

export function ShellMini() {
	return (
		<div className={styles.mini} data-mini="shell">
			<div className={styles.shellAbove}>
				<i className={styles.dot} data-status="working" />
				<span>fix flaky e2e on CI</span>
				<span className={styles.shellLine} style={{ width: '46%' }} />
				<span className={styles.shellLine} style={{ width: '28%' }} />
			</div>
			<div className={styles.shell}>
				<div className={styles.shellHead}>
					<span className={styles.mono}>~/dev/billing-api</span>
					<em>split</em>
				</div>
				<div className={styles.panes}>
					<div className={styles.pane}>
						<span>$ cargo test --workspace</span>
						<span data-i="0">running 128 tests</span>
						<span data-i="1">test session::spawn … ok</span>
						<span data-i="2">test graph::lanes … ok</span>
						<span data-i="3" data-ok>
							test result: ok. 128 passed
						</span>
					</div>
					<div className={styles.pane}>
						<span>$ pnpm dev</span>
						<span data-i="1">VITE ready in 312 ms</span>
						<span data-i="2" data-ok>
							➜ http://localhost:1420/
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}

/** The machine as a box that fills the card; on hover, packets travel the traces and none leaves. */
export function LocalMini() {
	const F = 'M153.6 136H377.6V198.4H233.6V232H332.8L273.6 291.2H233.6V379.2H153.6Z';
	return (
		<div className={styles.mini} data-mini="local">
			<svg viewBox="0 0 240 176" className={styles.machine} aria-hidden="true">
				<rect x="6" y="6" width="228" height="164" rx="10" data-box />
				<text x="18" y="24" data-label>
					your machine
				</text>
				<g transform="translate(92 40) scale(0.109)">
					<rect width="512" height="512" rx="112" data-chip />
					<path d={F} data-f />
				</g>
				{[52, 68, 84].map((y) => (
					<g key={y}>
						<path d={`M18 ${y}H92`} data-trace />
						<path d={`M148 ${y}H222`} data-trace />
						<circle cx="18" cy={y} r="3" data-pad />
						<circle cx="222" cy={y} r="3" data-pad />
						<circle r="2.5" data-packet>
							<animateMotion dur="2.4s" repeatCount="indefinite" path={`M18 ${y}H92`} />
						</circle>
						<circle r="2.5" data-packet>
							<animateMotion dur="2.4s" repeatCount="indefinite" path={`M148 ${y}H222`} />
						</circle>
					</g>
				))}
				{['no telemetry', 'no account', 'no server'].map((fact, i) => (
					<text key={fact} x="18" y={122 + i * 16} data-fact>
						✓ {fact}
					</text>
				))}
				<rect x="188" y="142" width="34" height="16" rx="3" data-mit />
				<text x="205" y="150" data-mitText>
					MIT
				</text>
			</svg>
		</div>
	);
}
