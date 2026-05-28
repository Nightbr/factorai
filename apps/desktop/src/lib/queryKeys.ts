export const queryKeys = {
	projects: () => ['projects'] as const,
	sessions: (projectId: string) => ['sessions', projectId] as const,
	session: (sessionId: string, offset: number, limit: number) =>
		['session', sessionId, offset, limit] as const,
};
