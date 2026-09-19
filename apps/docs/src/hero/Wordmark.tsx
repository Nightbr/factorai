import styles from './hero.module.css';

/** The name set one way (B8): `factor` in foreground, `ai` in amber, bold at -0.04em. */
export function Wordmark() {
	return (
		<span className={styles.wordmark}>
			factor<span className={styles.ai}>ai</span>
		</span>
	);
}
