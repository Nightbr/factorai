import styles from './hero.module.css';

/**
 * The tech treatment's instrument layer: corner brackets, hairlines and a mono
 * readout of the current step. No total, on purpose — the reader is meant to
 * discover how long the intro is (roadmap item 58).
 */
export function Hud({ step }: { step: number }) {
	const seq = String(step + 1).padStart(2, '0');
	return (
		<div className={styles.hud} aria-hidden="true">
			<span className={`${styles.corner} ${styles.tl}`} />
			<span className={`${styles.corner} ${styles.tr}`} />
			<span className={`${styles.corner} ${styles.bl}`} />
			<span className={`${styles.corner} ${styles.br}`} />
			<span className={styles.readoutLeft}>factorai — agentic development environment</span>
			<span className={styles.readoutRight}>seq {seq}</span>
			<span className={styles.hairline} />
		</div>
	);
}
