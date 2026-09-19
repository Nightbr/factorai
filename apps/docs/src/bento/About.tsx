import useBaseUrl from '@docusaurus/useBaseUrl';
import { useEffect, useState } from 'react';
import { Wordmark } from '../hero/Wordmark';
import styles from './bento.module.css';

const REPO = 'Nightbr/factorai';

interface Contributor {
	login: string;
	avatar: string;
	url: string;
	contributions: number;
}

/**
 * Who and why. The contributors are the repository's, fetched live from
 * GitHub rather than written here, so the list is never a claim the
 * repository does not back (PRODUCT.md: no invented evidence).
 */
export function About() {
	const icon = useBaseUrl('/img/factorai-icon.svg');
	const [contributors, setContributors] = useState<Contributor[]>([]);

	useEffect(() => {
		let cancelled = false;
		fetch(`https://api.github.com/repos/${REPO}/contributors?per_page=24`, {
			headers: { Accept: 'application/vnd.github+json' },
		})
			.then((res) => (res.ok ? res.json() : []))
			.then(
				(
					list: {
						login: string;
						avatar_url: string;
						html_url: string;
						contributions: number;
						type: string;
					}[],
				) => {
					if (cancelled) return;
					setContributors(
						list
							.filter((c) => c.type === 'User')
							.map((c) => ({
								login: c.login,
								avatar: `${c.avatar_url}&s=96`,
								url: c.html_url,
								contributions: c.contributions,
							})),
					);
				},
			)
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<section className={styles.about} id="about">
			<span className={styles.eyebrow}>about</span>
			<div className={styles.aboutBody}>
				<div className={styles.lockup}>
					<img src={icon} alt="" width="40" height="40" />
					<Wordmark />
				</div>
				<div>
					<p>
						factorai is built by engineers who spend the day supervising agents and wanted the tool
						arranged around that, not around a cursor.
					</p>
					<p>
						It is open source, and it will stay open source: a powerful development tool should be
						available to everyone, not gated behind a seat.
					</p>
					{contributors.length > 0 && (
						<div className={styles.contributors}>
							<span className={styles.eyebrow}>contributors</span>
							<ul className={styles.avatars}>
								{contributors.map((c) => (
									<li key={c.login}>
										<a href={c.url} title={`${c.login} · ${c.contributions} commits`}>
											<img src={c.avatar} alt={c.login} width="36" height="36" loading="lazy" />
										</a>
									</li>
								))}
							</ul>
							<a className={styles.contributeLink} href={`https://github.com/${REPO}`}>
								Contribute on GitHub
							</a>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
