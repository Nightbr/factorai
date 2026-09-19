import styles from './hero.module.css';

const CELLS = [
	['Sessions', 'The unit of work. Hundreds of them, calm at rest.'],
	['Files and Changes', 'Read what the agent touched, beside the session.'],
	['Graph', 'The repository as the agent left it.'],
	['Routines', 'Sessions on a schedule, catching up when you were away.'],
	['Search', 'Across every session and every file.'],
	['Worktrees', 'Agents in parallel, each on its own checkout.'],
] as const;

const RELEASES = 'https://github.com/Nightbr/factorai/releases/latest';

/** Grey boxes with headings: proves the release-from-pin transition. Real bento later. */
export function BentoPlaceholder() {
	return (
		<section className={styles.bento} id="features">
			<h2 className={styles.bentoTitle}>
				Agents build. You supervise, decide, review, and set the rules.
			</h2>
			<p className={styles.bentoLead}>
				Placeholder bento. Surfaces shown here, not described, once the hero is settled.
			</p>
			<div className={styles.grid}>
				{CELLS.map(([title, line]) => (
					<div key={title} className={styles.cell}>
						<h3>{title}</h3>
						<p>{line}</p>
					</div>
				))}
			</div>
			<div className={styles.download}>
				<a className={styles.downloadBtn} href={RELEASES}>
					Download for macOS
				</a>
				<a className={`${styles.downloadBtn} ${styles.downloadSecondary}`} href={RELEASES}>
					Download for Linux
				</a>
			</div>
		</section>
	);
}
