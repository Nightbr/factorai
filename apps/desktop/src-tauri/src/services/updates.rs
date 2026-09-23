//! Which update channel this install follows, and where that channel's
//! manifest lives (F14, ADR-0064).
//!
//! **Stable stays at `/releases/latest`**, which is where every install that
//! predates channels already looks — so moving it would strand them. Alpha
//! cannot live there: GitHub's `latest` skips prereleases, and an alpha is one.
//! It lives in a fixed pointer release instead, whose only asset is the newest
//! alpha's `latest.json`.

use crate::db::Db;
use crate::models::SettingKey;
use crate::services::settings;

/// The stable manifest. The same URL `tauri.conf.json` names, which is what an
/// install that has never called `check_update` still polls.
pub const STABLE_ENDPOINT: &str =
	"https://github.com/Nightbr/factorai/releases/latest/download/latest.json";

/// The alpha pointer release's manifest. `alpha.yml` replaces this one asset
/// after each alpha publishes; its URLs point into that alpha's own release.
pub const ALPHA_ENDPOINT: &str =
	"https://github.com/Nightbr/factorai/releases/download/alpha-channel/latest.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
	Stable,
	Alpha,
}

impl Channel {
	/// A stored value as a channel. **Anything unknown is stable**: a value no
	/// release ever wrote must not put somebody on the fast lane.
	pub fn parse(value: Option<&str>) -> Channel {
		match value {
			Some("alpha") => Channel::Alpha,
			_ => Channel::Stable,
		}
	}

	pub fn as_str(self) -> &'static str {
		match self {
			Channel::Stable => "stable",
			Channel::Alpha => "alpha",
		}
	}

	pub fn endpoint(self) -> &'static str {
		match self {
			Channel::Stable => STABLE_ENDPOINT,
			Channel::Alpha => ALPHA_ENDPOINT,
		}
	}
}

/// The channel the setting names, stable when unset or unreadable. A database
/// error here is not worth failing an update check over: the check falls back
/// to the channel every install started on.
pub fn channel(db: &Db) -> Channel {
	let value = db.with(|conn| settings::get(conn, SettingKey::UpdateChannel)).ok().flatten();
	Channel::parse(value.as_deref())
}

#[cfg(test)]
mod tests {
	use super::*;
	use tempfile::TempDir;

	#[test]
	fn unset_and_unknown_values_are_stable() {
		assert_eq!(Channel::parse(None), Channel::Stable);
		assert_eq!(Channel::parse(Some("stable")), Channel::Stable);
		assert_eq!(Channel::parse(Some("nightly")), Channel::Stable);
		assert_eq!(Channel::parse(Some("")), Channel::Stable);
		assert_eq!(Channel::parse(Some("alpha")), Channel::Alpha);
	}

	#[test]
	fn stable_keeps_the_endpoint_every_existing_install_polls() {
		let conf: serde_json::Value =
			serde_json::from_str(include_str!("../../tauri.conf.json")).expect("tauri.conf.json");
		let configured = &conf["plugins"]["updater"]["endpoints"][0];
		assert_eq!(configured.as_str(), Some(STABLE_ENDPOINT));
		assert_ne!(Channel::Alpha.endpoint(), STABLE_ENDPOINT);
	}

	#[test]
	fn the_setting_picks_the_channel() {
		let tmp = TempDir::new().expect("tempdir");
		let db = Db::open(&tmp.path().join("data")).expect("open db");
		assert_eq!(channel(&db), Channel::Stable);
		db.with(|conn| settings::set(conn, SettingKey::UpdateChannel, Some("alpha"))).expect("set");
		assert_eq!(channel(&db), Channel::Alpha);
		db.with(|conn| settings::set(conn, SettingKey::UpdateChannel, None)).expect("clear");
		assert_eq!(channel(&db), Channel::Stable);
	}
}
