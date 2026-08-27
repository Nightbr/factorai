import type { SettingKey } from '@factorai/types';

export const queryKeys = {
	projects: () => ['projects'] as const,
	/** The sidebar's tree — groups and the projects in them, in order (ADR-0025).
	 *  Its own key rather than a `projects` variant: this one is the *arrangement*
	 *  and only the sidebar reads it, while `projects` is the flat membership list
	 *  that four other surfaces poll. Writing the arrangement invalidates this and
	 *  leaves those alone. */
	sidebar: () => ['sidebar'] as const,
	/** Folders Claude has worked in, for the import dialog. Separate from
	 *  `projects` because it comes from a different place — a walk of the store,
	 *  not the workspace table — and is read only while the dialog is open. */
	importCandidates: () => ['import-candidates'] as const,
	sessions: (projectId: string) => ['sessions', projectId] as const,
	session: (sessionId: string, offset: number, limit: number) =>
		['session', sessionId, offset, limit] as const,
	sessionTail: (sessionId: string, limit: number) => ['session-tail', sessionId, limit] as const,
	search: (query: string, projectId: string | null) => ['search', query, projectId] as const,
	/** One directory's listing in the file tree. Keyed by absolute path so
	 *  every expanded node caches independently. */
	dir: (path: string) => ['dir', path] as const,
	/** One file's contents. Capped and uncapped reads are separate entries, so
	 *  "Show anyway" fetches rather than reusing the truncated body. */
	file: (path: string, uncapped: boolean) => ['file', path, uncapped ? 'full' : 'capped'] as const,
	/** One image's bytes. Its own namespace, not a `file` variant: the two come
	 *  from different commands and only one of them is ever right for a path. */
	image: (path: string) => ['image', path] as const,
	/** One PDF's bytes. Its own namespace for the same reason `image` is: the
	 *  path decides which command answers, and only one ever does. */
	pdf: (path: string) => ['pdf', path] as const,
	/** Repository state for one project. **One key per project, shared by the
	 *  Changes tab and the tree's decorations** — they read the same poll, which
	 *  is why the interval follows the panel rather than the tab (Q20). */
	gitStatus: (projectPath: string) => ['git-status', projectPath] as const,
	/** Every checkout of a project's repository (F21). Its own namespace rather
	 *  than a `gitStatus` variant for the reason `gitGraph` is: it polls at 30s
	 *  and is read whether or not the panel is open, because the session header's
	 *  badge needs it too. */
	gitWorktrees: (projectPath: string) => ['git-worktrees', projectPath] as const,
	/** One file at one revision, for a diff side. */
	gitBlob: (path: string, rev: string) => ['git-blob', path, rev] as const,
	/** One page of the commit graph (F18). The page index is part of the key so
	 *  loaded pages stay cached independently, and its own namespace rather than
	 *  a `gitStatus` variant because the two poll at different cadences. */
	gitGraph: (projectPath: string, page: number) => ['git-graph', projectPath, page] as const,
	/** One commit's detail, for the pane below the graph. */
	gitCommit: (projectPath: string, sha: string) => ['git-commit', projectPath, sha] as const,
	/** One setting Rust reads (F11). Keyed by the setting so a second key does
	 *  not invalidate the first — and read only while the modal is open. */
	setting: (key: SettingKey) => ['setting', key] as const,
	/** Where `claude` is and what version it reports. Invalidated when the
	 *  override is saved, since the answer depends on it. */
	claudeCli: () => ['claude-cli'] as const,
};
