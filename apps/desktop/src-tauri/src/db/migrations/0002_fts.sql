CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
	session_id UNINDEXED,
	project_id UNINDEXED,
	role,
	body,
	tokenize = 'porter unicode61'
);
