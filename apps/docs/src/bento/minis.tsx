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
				{rows.map(([name, , a, b], i) => (
					<div key={name} className={styles.screen} data-i={i}>
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
