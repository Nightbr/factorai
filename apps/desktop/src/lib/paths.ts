/**
 * Path arithmetic the renderer does on strings the backend handed it.
 *
 * POSIX separators throughout: macOS and Linux only (AGENTS.md § 8), and every
 * path here came from `list_dir`, which walks a real filesystem.
 */

/**
 * `path` expressed against the project root, for "Copy relative path" (F12).
 *
 * The root is the only base that isn't a guess — it is already threaded into
 * every tree row for `list_dir`. No leading `./`: a path you copy is a path you
 * paste into a shell or an agent prompt, and `./` there is noise. The root row
 * itself is `.`, which is the only honest name a directory has for itself.
 *
 * A path that isn't under the root comes back untouched rather than as a pile
 * of `../` — a symlink target outside the project is somewhere else, and saying
 * so absolutely is more useful than a relative path that only resolves from one
 * working directory.
 */
export function relativeToRoot(path: string, root: string): string {
	if (!root || !path) return path;
	const base = root.endsWith('/') ? root.slice(0, -1) : root;
	if (path === base) return '.';
	return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
}
