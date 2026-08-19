//! The IDE bridge: factorai presenting itself to the `claude` CLI as an editor
//! (specs/05-features.md F20, ADR-0017).
//!
//! One server per session, because the port *is* the session identity — a
//! request arriving on it needs no other attribution, and factorai runs many
//! PTYs against one project so neither the client pid nor the workspace folder
//! would distinguish them.
//!
//! Built in slices. [`lockfile`] is the handle the CLI finds us by, [`scope`]
//! is the boundary a connected client cannot cross, [`server`] is the transport
//! and the door, and [`protocol`] is what the messages mean. The protocol is
//! injected into the server rather than owned by it, so each is testable
//! without the other.
//!
//! [`ui_state`] is the one thing flowing the other way: what the renderer has
//! on screen, which two of the tools' answers depend on and neither can guess.

pub mod lockfile;
pub mod protocol;
pub mod scope;
pub mod server;
pub mod ui_state;
