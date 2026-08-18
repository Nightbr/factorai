/**
 * Per-author avatars for the graph's commit nodes (specs/05-features.md F18).
 *
 * **Derived locally, from the author email, with no network call.** Gravatar and
 * the GitHub avatar API would both work and both mean the same thing: every
 * repository you browse sends that repository's author identities to a third
 * party, from an app whose README promises it "reads local files and runs local
 * processes". That is a decision with an ADR attached, not an implementation
 * detail — see `specs/05-features.md` F18 § Avatars. Until it is taken, the
 * fallback *is* the avatar, so it has to be good rather than a grey circle.
 *
 * The shape here is deliberately resolver-friendly: a remote resolver returning
 * a URL would sit in front of `avatarFor`, and everything below stays the
 * offline default.
 */

/**
 * FNV-1a, 32-bit. Small, stable across runs, and good enough to spread a few
 * dozen authors across a hue circle — this picks a colour, it does not protect
 * anything.
 */
function hash(input: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		// The FNV prime, as shifts: `h * 16777619` overflows past 2^31 and JS
		// would silently give it back as a double.
		h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
	}
	return h >>> 0;
}

/** Distinct hues, evenly spaced. 12 rather than 360 so two authors are either
 *  obviously the same colour or obviously different, never "nearly". */
const HUE_STEPS = 12;

/**
 * The avatar's fill, as an oklch triple.
 *
 * Fixed lightness and chroma, hue varying: the whole set then sits at one
 * weight, so no author's dot shouts louder than another's.
 *
 * **Tuned twice on 2026-08-18, in one conversation, and the pair of moves is
 * the useful record.** It shipped at `oklch(62% 0.14 h)`: too saturated, a strip
 * of loud dots down a rail whose *lane* colours are the thing it exists to show.
 * The first fix halved chroma and lifted lightness to `oklch(80% 0.07 h)`, which
 * traded loud for bright — a near-white disc is the lightest thing in the panel,
 * so it still won the row. `oklch(45% 0.09 h)` is the third try and the one that
 * holds: dark enough to sit *under* the lane ring around it, tinted enough that
 * twelve hues stay tellable apart.
 *
 * **Going darker still was tried and rejected.** At `32%` the disc dissolves
 * into the background and only the ring and the initials read, which costs the
 * one thing the avatar is for — scanning a history for the commits you wrote.
 */
export function avatarColour(email: string): string {
	return `oklch(45% 0.09 ${avatarHue(email)})`;
}

/**
 * The initials' colour for that fill: the same hue, near-white.
 *
 * **Not `--card`, which is what both call sites used to paint them.** That
 * happened to work while the disc was mid-tone, and it is a theme token: white
 * in the light theme, near-black in the dark one. Since item 32 has not shipped,
 * relying on it would have meant a pair that only renders correctly in the theme
 * we can currently see — the mirror-image bug caught *before* it renders rather
 * than after, which is the lesson `color-scheme` in `globals.css` records having
 * learned the other way round.
 *
 * Tying the ink to the fill in one function is what makes the pair
 * theme-independent: neither value is a token, so neither moves when the theme
 * does, and the contrast between them is a property of this file. It flipped
 * from dark to light when the fill went from `80%` to `45%`, which is exactly
 * the kind of coupling that would have been missed if the two lived apart.
 */
export function avatarInk(email: string): string {
	return `oklch(97% 0.015 ${avatarHue(email)})`;
}

/** The hue both halves share. */
function avatarHue(email: string): number {
	return (hash(email) % HUE_STEPS) * (360 / HUE_STEPS);
}

/**
 * One or two letters for the node.
 *
 * Prefers the name's word initials — `Ada Lovelace` → `AL` — and falls back to
 * the email's local part, because plenty of commits carry a bare address or a
 * bot name with no space in it.
 */
export function authorInitials(name: string, email: string): string {
	const words = name
		.trim()
		.split(/[\s._-]+/)
		.filter(Boolean);

	if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

	const local = email.split('@')[0]?.replace(/[^a-z0-9]/gi, '') ?? '';
	return local ? local.slice(0, 2).toUpperCase() : '?';
}

/** Everything a node needs to draw one author, keyed by the identity Rust
 *  normalised. */
export function avatarFor(authorName: string, authorEmail: string) {
	// An empty email still has to be stable rather than random, so the name
	// stands in as the key; two authors with no email at all sharing a colour is
	// a better failure than one author flickering between colours.
	const key = authorEmail || authorName.trim().toLowerCase();
	return {
		colour: avatarColour(key),
		ink: avatarInk(key),
		initials: authorInitials(authorName, authorEmail),
	};
}
