import styles from './bento.module.css';

/** Who, licence, status. Three lines, no invented evidence (PRODUCT.md). */
export function About() {
	return (
		<section className={styles.about} id="about">
			<span className={styles.eyebrow}>about</span>
			<p>
				factorai is built by one developer who spends the day supervising agents and wanted the tool
				arranged around that, not around a cursor.
			</p>
			<p>
				It is open source under the MIT licence, and it is alpha: releases go out several times a
				day and publish themselves, so point it at work your version control can recover.
			</p>
			<p>
				<a href="https://github.com/Nightbr/factorai">Source and issues on GitHub</a>
				{' · '}
				<a href="https://github.com/Nightbr/factorai/blob/main/specs/roadmap/">What is next</a>
			</p>
		</section>
	);
}
