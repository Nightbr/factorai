export const queryKeys = {
	projects: () => ['projects'] as const,
	sessions: (projectId: string) => ['sessions', projectId] as const,
	session: (sessionId: string, offset: number, limit: number) =>
		['session', sessionId, offset, limit] as const,
	sessionTail: (sessionId: string, limit: number) =>
		['session-tail', sessionId, limit] as const,
	search: (query: string, projectId: string | null) =>
		['search', query, projectId] as const,
};
