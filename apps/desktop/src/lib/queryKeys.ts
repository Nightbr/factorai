export const queryKeys = {
	projects: () => ['projects'] as const,
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
};
