//! factorai's own MCP server — the half of our tool surface the **model** can
//! call (F22 slice 3, ADR-0029).
//!
//! Its sibling [`super::ide`] is the IDE bridge, whose tools the `claude` CLI
//! calls on its own behalf and which the CLI caps at a two-name allowlist before
//! the model sees them. Nothing we can configure changes that: the bridge is
//! registered under the hardcoded key `ide`. So a tool meant for the model lives
//! here instead, behind a plain server name, reached over plain HTTP, and
//! registered per session through `--mcp-config` at spawn.
//!
//! One component, one lifetime: this listener is started beside the bridge in
//! `TerminalManager::spawn` and dropped with the PTY.

mod server;
mod tools;

pub use server::AgentToolsServer;
pub use tools::{AgentTools, CreateRoutine, ListRoutines, Routines, UpdateRoutine, SERVER_NAME};
