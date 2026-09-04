//! The exact JSON the sidebar's types cross the IPC boundary as.
//!
//! **This file exists because nothing else could catch what it catches.** The TS
//! types are hand-mirrored against these structs, and drift is meant to be caught
//! in review rather than at runtime — but the two mechanisms that look like they
//! would catch it do not:
//!
//! - `tsc` cannot see across the boundary. It checks the renderer against
//!   `@factorai/types`, and `@factorai/types` against nothing.
//! - The Playwright suite goes through `mockInvoke`, which *fabricates* camelCase
//!   objects in TypeScript. It never asks serde what it would actually emit, so a
//!   renaming bug passes 196 green browser tests.
//!
//! What was found this way on 2026-08-27, after the feature shipped green through
//! both: `SidebarRow` emitted `row_id` while the TS declared `rowId`, and
//! `SidebarOrder` used serde's *externally tagged* form and so could not
//! deserialize anything the renderer sent. Every write command was addressing
//! `undefined` or being rejected before it ran, in a build whose whole test suite
//! passed.
//!
//! So: assert the literal strings. Any type crossing the boundary as a **tagged
//! enum** belongs here, because that is the shape where serde's attributes do
//! something other than what they look like — `rename_all` on an enum renames the
//! *variants* and leaves the fields alone, which needs `rename_all_fields` as
//! well. Plain structs are far less treacherous, but a couple are checked below
//! anyway so the file reads as a complete statement of the contract.

use factorai_lib::commands::sidebar::SidebarOrder;
use factorai_lib::models::{Project, SidebarChild, SidebarRow};

fn project() -> Project {
	Project {
		id: "p1".into(),
		real_path: "/code/a".into(),
		display_name: "a".into(),
		last_session_at: Some(900),
		session_count: 2,
		missing: false,
		profile_id: Some("prof-work".into()),
		profile_name: Some("Work".into()),
	}
}

/// `SidebarRow` as `@factorai/types` declares it: `kind`, `rowId`, and camelCase
/// throughout the nested payload.
#[test]
fn a_project_row_matches_the_typescript_type() {
	let json =
		serde_json::to_value(SidebarRow::Project { row_id: "r1".into(), project: project() })
			.expect("serialize");

	assert_eq!(json["kind"], "project");
	assert_eq!(json["rowId"], "r1", "not `row_id` — see this file's header");
	assert!(json.get("row_id").is_none(), "the snake_case name must not appear: {json}");
	assert_eq!(json["project"]["realPath"], "/code/a");
	assert_eq!(json["project"]["lastSessionAt"], 900);
	assert_eq!(json["project"]["sessionCount"], 2);
	// Dropped by migration 0011 and 0012 respectively. A field that reappears here
	// is a model that has drifted back.
	assert!(json["project"].get("pinned").is_none());
	assert!(json["project"].get("sortOrder").is_none());
	assert!(json["project"].get("sort_order").is_none());
	// The project's Claude profile (F25 slice 3). Camel on the wire like
	// everything else, and the pair travels together: a name with no id is a
	// label nothing can be changed through.
	assert_eq!(json["project"]["profileId"], "prof-work");
	assert_eq!(json["project"]["profileName"], "Work");
	assert!(json["project"].get("profile_id").is_none());
}

#[test]
fn a_group_row_matches_the_typescript_type() {
	let json = serde_json::to_value(SidebarRow::Group {
		row_id: "r1".into(),
		name: "Pro".into(),
		children: vec![SidebarChild { row_id: "r2".into(), project: project() }],
	})
	.expect("serialize");

	assert_eq!(json["kind"], "group");
	assert_eq!(json["rowId"], "r1");
	assert_eq!(json["name"], "Pro");
	// The asymmetry that made the original bug hard to see: `SidebarChild` is a
	// struct, where `rename_all` *does* apply to fields, so the children were
	// right while the rows holding them were wrong.
	assert_eq!(json["children"][0]["rowId"], "r2");
	assert_eq!(json["children"][0]["project"]["displayName"], "a");
}

#[test]
fn an_empty_group_serialises_its_children_as_an_empty_array() {
	// Not `null` and not absent: the renderer maps over it unconditionally, and an
	// empty group is a container the user made on purpose (F1).
	let json = serde_json::to_value(SidebarRow::Group {
		row_id: "r1".into(),
		name: "Perso".into(),
		children: vec![],
	})
	.expect("serialize");

	assert_eq!(json["children"], serde_json::json!([]));
}

/// The direction that failed hardest: `SidebarOrder` could not parse what the
/// renderer sends at all, so `reorder_sidebar` never ran.
#[test]
fn a_project_order_parses_what_the_renderer_sends() {
	let parsed: SidebarOrder =
		serde_json::from_str(r#"{"kind":"project","rowId":"r1"}"#).expect("parse");

	match parsed {
		SidebarOrder::Project { row_id } => assert_eq!(row_id, "r1"),
		SidebarOrder::Group { .. } => panic!("parsed a project as a group"),
	}
}

#[test]
fn a_group_order_parses_what_the_renderer_sends() {
	let parsed: SidebarOrder =
		serde_json::from_str(r#"{"kind":"group","rowId":"r1","children":["r2","r3"]}"#)
			.expect("parse");

	match parsed {
		SidebarOrder::Group { row_id, children } => {
			assert_eq!(row_id, "r1");
			assert_eq!(children, vec!["r2".to_string(), "r3".to_string()]);
		}
		SidebarOrder::Project { .. } => panic!("parsed a group as a project"),
	}
}

/// Serde's **externally tagged** form is what this type had by default, and it is
/// what the renderer never sends. Asserting it is rejected pins the tag: drop
/// `tag = "kind"` and this test fails rather than the app silently doing nothing.
#[test]
fn the_externally_tagged_form_is_not_what_we_accept() {
	let result = serde_json::from_str::<SidebarOrder>(r#"{"Project":{"rowId":"r1"}}"#);

	assert!(result.is_err(), "the internally tagged form is the contract");
}

/// A whole tree, as `list_sidebar` returns it — one assertion that reads like the
/// TS type it mirrors.
#[test]
fn the_tree_round_trips_as_the_renderer_expects() {
	let rows = vec![
		SidebarRow::Group {
			row_id: "g1".into(),
			name: "Pro".into(),
			children: vec![SidebarChild { row_id: "r1".into(), project: project() }],
		},
		SidebarRow::Project { row_id: "r2".into(), project: project() },
	];

	let json = serde_json::to_string(&rows).expect("serialize");

	assert!(json.contains(r#""kind":"group""#), "{json}");
	assert!(json.contains(r#""kind":"project""#), "{json}");
	assert!(json.contains(r#""rowId":"g1""#), "{json}");
	assert!(!json.contains("row_id"), "{json}");
}
