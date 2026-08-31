/**
 * How fresh a viewer read has to be (specs/05-features.md F7, F13).
 *
 * Every read behind the viewer is a file on disk or an object in git, and the
 * two age differently — so they get different `staleTime`s rather than one
 * house default.
 *
 * **On-disk reads are stale the moment they land.** `read_file` /
 * `read_image` / `read_pdf` and the worktree side of a diff all describe a
 * file an agent is editing while you look at it. There is no watcher on the
 * viewer's path (deliberately — see `useGitStatus` for why watching a
 * repository is its own project), so nothing invalidates these keys when the
 * bytes change. With `staleTime: Infinity` the cache answered a reopen from
 * five minutes ago and the edit was invisible until `gcTime` dropped the
 * entry: the bug fixed here. `staleTime: 0` makes *opening* the read — a
 * mount, or a path change inside the viewer — which is what "reopen it to
 * refresh" always claimed to mean. The cached bytes still render immediately
 * while the refetch is in flight, so this costs a re-read and not a flash of
 * `Loading…`.
 *
 * `refetchOnWindowFocus` stays off (the app-wide default in `App.tsx`): a
 * refetch triggered by alt-tabbing would recreate the editor and take the
 * scroll position with it, which is the yank the old comment worried about.
 */
export const REREAD_ON_OPEN = { staleTime: 0 } as const;

/**
 * A git object named by its SHA cannot change, so it is cached for the life of
 * the process. Note this is **only** true of a full SHA: `head` and `index`
 * are moving targets — commit or stage, and the blob under that name is a
 * different one — so those sides read with `REREAD_ON_OPEN` too.
 */
export const IMMUTABLE_REV = { staleTime: Number.POSITIVE_INFINITY } as const;
