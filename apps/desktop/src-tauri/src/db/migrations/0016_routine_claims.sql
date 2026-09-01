-- A fire that has been decided but not yet started (F22, ADR-0030).
--
-- The runner decides when a routine is due; the *renderer* spawns the PTY
-- (ADR-0026 § 2), and the only thing joining the two halves was a
-- `routine:fire` event. Tauri does not buffer an emit: nothing was listening
-- during the launch tick — `routines.start()` runs in `setup()`, long before the
-- webview has loaded the bundle and registered the listener — so the catch-up
-- fire that makes routines usable at all went to no one. The row already said
-- "last run 10:17" with no error and no session, which is the worst shape a
-- failure can take: it claimed success.
--
-- So a fire becomes a two-step thing with a row in between. The runner *claims*
-- an occurrence here and emits; the fire is only recorded on `routines` once a
-- PTY actually exists for that session id, which is what ADR-0026 § 7 always
-- said ("a fire is recorded when the session starts") and what the event-only
-- path could not honour. Until then the occurrence is **unconsumed**:
-- `routines.last_fire_at` has not moved, so a claim in flight is what keeps the
-- next tick from deciding the same occurrence twice.
--
-- **In flight only, never history.** A row lives for seconds: it is deleted when
-- the session starts (`session_routines` is the history, written at that same
-- moment) or when the runner gives up on it. So this table is normally empty,
-- and a row surviving a restart is exactly the case worth retrying.
--
-- `ON DELETE CASCADE`, unlike `session_routines`'s `SET NULL`: that table records
-- something that happened and has to outlive the schedule, while a claim for a
-- deleted routine cannot be started — there is no prompt left to start it with.
CREATE TABLE IF NOT EXISTS routine_claims (
	-- The session id the runner minted for this fire (ADR-0008). **No foreign
	-- key**, for `session_routines`'s reason: the `sessions` row is derived from
	-- a transcript Claude has not written yet, and here it is earlier still —
	-- the process does not exist.
	session_id TEXT PRIMARY KEY,
	routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
	-- The occurrence this claim is for, so giving up can consume the right one
	-- and a retry cannot silently slide the fire forward to now.
	occurrence INTEGER NOT NULL,
	-- When the claim was made. What the grace period is measured against.
	claimed_at INTEGER NOT NULL
);
