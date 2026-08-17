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
 * weight, so no author's dot shouts louder than another's, and white initials
 * stay legible on every one of them.
 */
export function avatarColour(email: string): string {
	const hue = (hash(email) % HUE_STEPS) * (360 / HUE_STEPS);
	return `oklch(62% 0.14 ${hue})`;
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
	return { colour: avatarColour(key), initials: authorInitials(authorName, authorEmail) };
}
