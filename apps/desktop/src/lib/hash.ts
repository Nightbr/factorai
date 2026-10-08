/**
 * FNV-1a, 32-bit. Small, stable across runs and platforms, and good enough to
 * spread a few dozen names across a short palette — this picks a colour, it
 * does not protect anything.
 *
 * Shared by the commit graph's author avatars (`lib/avatar.ts`) and the
 * project tile (`lib/icon.ts`): both hash an identity to a swatch, and two
 * hash functions for one job would be two places to get the overflow wrong.
 */
export function fnv1a(input: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		// The FNV prime, as shifts: `h * 16777619` overflows past 2^31 and JS
		// would silently give it back as a double.
		h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
	}
	return h >>> 0;
}
