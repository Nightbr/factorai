# Codex CLI fixtures

One real thread, recorded on 2026-09-22 with `codex-cli 0.155.1` under an
isolated `CODEX_HOME`, one turn ("Reply with exactly the word: pong"), then
sanitised: the working directory became `/home/alice/code/pong`, the
`base_instructions` (Codex's own system prompt) were redacted, and the `git`
block was dropped. Everything else is byte-for-byte what Codex wrote — the
record kinds, the `input_text` / `output_text` blocks, `history_mode:
"paginated"`, and `session_index.jsonl` carrying Codex's auto-title.

Read by `agents::codex` tests and by the indexer's integration tests. The
title sequence the same turn produced is in `agents/codex.rs`'s tests, as
literals. `specs/05-features.md` § F30 cites what each fact changed.
