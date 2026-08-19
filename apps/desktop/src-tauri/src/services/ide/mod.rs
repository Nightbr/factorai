//! The IDE bridge: factorai presenting itself to the `claude` CLI as an editor
//! (specs/05-features.md F20, ADR-0017).
//!
//! One server per session, because the port *is* the session identity — a
//! request arriving on it needs no other attribution, and factorai runs many
//! PTYs against one project so neither the client pid nor the workspace folder
//! would distinguish them.
//!
//! Built in slices. This one is the two pieces that have to be right before a
//! socket exists at all: the handle the CLI finds us by ([`lockfile`]) and the
//! boundary a connected client cannot cross ([`scope`]).

pub mod lockfile;
pub mod scope;
