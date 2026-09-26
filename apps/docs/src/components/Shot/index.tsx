import styles from './shot.module.css';

interface ShotProps {
	/** The image, as `require('…@2x.png').default` so the build hashes it and
	 *  fails on a path that does not exist. */
	src: string;
	alt: string;
	/** One line under the picture, when the alt text is not enough. */
	caption?: string;
}

/**
 * A picture of the app in the guide (ADR-0066).
 *
 * Every image is captured at device scale 2, so it is declared as a `2x`
 * source: the browser lays it out at half its pixel size, which is the size
 * it had in the window, and a high-density screen still gets every pixel.
 */
export default function Shot({ src, alt, caption }: ShotProps) {
	return (
		<figure className={styles.figure}>
			{/* `srcSet` alone, no `src`: a `src` beside it counts as a 1x candidate,
			    which a 1x screen picks — at twice the size. */}
			<img className={styles.image} srcSet={`${src} 2x`} alt={alt} loading="lazy" />
			{caption ? <figcaption className={styles.caption}>{caption}</figcaption> : null}
		</figure>
	);
}
