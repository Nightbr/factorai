/**
 * How a shell pane's directory is written in a chip's tooltip
 * (`specs/05-features.md` § F23, `DESIGN.md` § Tab Chips).
 *
 * **The tooltip is what tells two chips apart**, since the footer became the
 * project's: every chip in a project is labelled with the same static shell
 * name (F24), and two chips in two checkouts of one repository are now an
 * ordinary thing to have open. So each pane's cwd is named — and named
 * *relative to the project root*, because the absolute path is mostly the same
 * prefix repeated and what distinguishes two panes is the tail.
 *
 * Three answers, and the third is the one that matters: a linked checkout is
 * not under the project root at all, so it keeps its own path rather than being
 * written as a run of `..` segments nobody can read.
 */
export function shellCwdLabel(cwd: string, projectRoot: string | null): string {
	if (!projectRoot) return cwd;
	const root = trimSlash(projectRoot);
	const dir = trimSlash(cwd);
	if (dir === root) return '.';
	if (dir.startsWith(`${root}/`)) return dir.slice(root.length + 1);
	return dir;
}

/** A trailing slash is not part of a directory's identity, and comparing two
 *  paths that disagree about one would call the same place two places. */
function trimSlash(path: string): string {
	return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * The whole of a chip's `title` (F23, `DESIGN.md` § Tab Chips).
 *
 * **One line.** WebKitGTK renders a `title` as a GTK tooltip and shows only its
 * first line, so a directory per line was invisible in the real window while
 * looking right in a browser (measured 2026-09-03). Everything is joined with
 * ` · `, the separator the rest of the app's titles already use.
 *
 * **The project root is omitted from the directories.** A `.` on every chip of
 * a single-checkout project distinguishes nothing; what the tooltip exists for
 * is the chip that is somewhere else. Duplicates go too — three panes in one
 * subdirectory are one place, said once.
 *
 * Here rather than in the component so the case that needs a second checkout to
 * reach in the app is reachable in a unit test.
 */
export function chipTooltip({
	label,
	cwds,
	projectRoot,
	dead,
}: {
	/** The shell's basename, which is every chip's label (F24). */
	label: string;
	/** One per pane, in row order. */
	cwds: string[];
	projectRoot: string | null;
	dead: boolean;
}): string {
	const count = cwds.length;
	const elsewhere = [
		...new Set(cwds.map((cwd) => shellCwdLabel(cwd, projectRoot)).filter((dir) => dir !== '.')),
	];
	return [
		label,
		count > 1 ? `${count} panes` : null,
		elsewhere.length > 0 ? elsewhere.join(', ') : null,
		dead ? `click to open ${count > 1 ? 'new shells' : 'a new shell'} here` : null,
	]
		.filter(Boolean)
		.join(' · ');
}
