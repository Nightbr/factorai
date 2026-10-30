//! The AWS profiles this machine has, for choosing which one decrypts a SOPS
//! file whose key is in AWS KMS (specs/05-features.md F27 § "Choosing the AWS
//! profile").
//!
//! **Names and account ids, nothing else.** The shared config and credentials
//! files hold secrets — `aws_secret_access_key`, `aws_session_token` — and this
//! module reads past them without keeping a byte: a profile here is the section
//! header plus the one field that says which account it signs in to. The
//! credentials themselves stay where they are, and `sops` reads them in its own
//! process, the way it always has.

use std::path::PathBuf;

use crate::models::AwsProfile;

/// Every profile in the shared config and credentials files, sorted by name and
/// merged where both files name the same one.
///
/// `AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE` are honoured, because
/// they are what the SDK inside `sops` honours — a picker listing profiles from
/// a file `sops` will not read would offer choices that cannot work. A file that
/// is missing or unreadable contributes nothing; no `~/.aws` at all is an empty
/// list, not an error.
pub fn profiles() -> Vec<AwsProfile> {
	let config = read(config_path());
	let credentials = read(credentials_path());
	parse_profiles(&config, &credentials)
}

/// `AWS_PROFILE` from the app's own environment, when it has one. Under a
/// desktop launcher it usually does not, which is the problem the picker solves.
pub fn env_profile() -> Option<String> {
	std::env::var("AWS_PROFILE").ok().map(|p| p.trim().to_string()).filter(|p| !p.is_empty())
}

fn config_path() -> Option<PathBuf> {
	env_path("AWS_CONFIG_FILE").or_else(|| dirs::home_dir().map(|h| h.join(".aws").join("config")))
}

fn credentials_path() -> Option<PathBuf> {
	env_path("AWS_SHARED_CREDENTIALS_FILE")
		.or_else(|| dirs::home_dir().map(|h| h.join(".aws").join("credentials")))
}

fn env_path(var: &str) -> Option<PathBuf> {
	std::env::var_os(var).filter(|v| !v.is_empty()).map(PathBuf::from)
}

fn read(path: Option<PathBuf>) -> String {
	path.and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default()
}

/// The two files' profiles, merged.
///
/// The two files spell a section differently: the config file writes
/// `[profile name]` for everything but `[default]`, the credentials file writes
/// a bare `[name]`. Other config sections — `[sso-session …]`, `[services …]` —
/// are not profiles and are skipped.
pub fn parse_profiles(config: &str, credentials: &str) -> Vec<AwsProfile> {
	let mut found: std::collections::BTreeMap<String, Option<String>> =
		std::collections::BTreeMap::new();
	for (text, in_config) in [(config, true), (credentials, false)] {
		for (name, account_id) in sections(text, in_config) {
			let slot = found.entry(name).or_insert(None);
			if slot.is_none() {
				*slot = account_id;
			}
		}
	}
	found.into_iter().map(|(name, account_id)| AwsProfile { name, account_id }).collect()
}

/// `(profile name, account id)` for each profile section of one file.
///
/// The account id comes from whichever field names one: `sso_account_id` for
/// an IAM Identity Center profile, `aws_account_id` where the SDK wrote it, or
/// the account inside a `role_arn` for an assume-role profile.
fn sections(text: &str, in_config: bool) -> Vec<(String, Option<String>)> {
	let mut out: Vec<(String, Option<String>)> = Vec::new();
	let mut current: Option<usize> = None;
	for line in text.lines() {
		let line = line.trim();
		if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
			continue;
		}
		if let Some(header) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
			current = profile_name(header.trim(), in_config).map(|name| {
				out.push((name, None));
				out.len() - 1
			});
			continue;
		}
		let (Some(index), Some((key, value))) = (current, line.split_once('=')) else {
			continue;
		};
		let value = value.trim();
		let account = match key.trim() {
			"sso_account_id" | "aws_account_id" => Some(value.to_string()),
			"role_arn" => arn_account(value),
			_ => None,
		};
		if let Some(account) = account.filter(|a| !a.is_empty()) {
			// `sso_account_id` and `role_arn` can both be present; the first one
			// in the section wins, since both name the same account in practice.
			if out[index].1.is_none() {
				out[index].1 = Some(account);
			}
		}
	}
	out
}

fn profile_name(header: &str, in_config: bool) -> Option<String> {
	if !in_config {
		return Some(header.to_string()).filter(|n| !n.is_empty());
	}
	if header == "default" {
		return Some("default".to_string());
	}
	header
		.strip_prefix("profile")
		.filter(|rest| rest.starts_with(char::is_whitespace))
		.map(|rest| rest.trim().to_string())
		.filter(|n| !n.is_empty())
}

/// The account id inside an ARN: `arn:aws:kms:eu-west-3:123456789012:key/…` →
/// `123456789012`. IAM ARNs have no region and the same position for the
/// account, so this reads both.
pub fn arn_account(arn: &str) -> Option<String> {
	let mut parts = arn.split(':');
	if parts.next()? != "arn" {
		return None;
	}
	let account = parts.nth(3)?;
	(account.len() == 12 && account.chars().all(|c| c.is_ascii_digit()))
		.then(|| account.to_string())
}

#[cfg(test)]
mod tests {
	use super::*;

	fn names(profiles: &[AwsProfile]) -> Vec<(&str, Option<&str>)> {
		profiles.iter().map(|p| (p.name.as_str(), p.account_id.as_deref())).collect()
	}

	#[test]
	fn reads_sso_assume_role_and_static_profiles_from_both_files() {
		let config = "\
[default]
region = eu-west-3

[profile staging]
sso_session = corp
sso_account_id = 111111111111
sso_role_name = Developer

[sso-session corp]
sso_start_url = https://corp.awsapps.com/start

[profile prod-admin]
role_arn = arn:aws:iam::222222222222:role/Admin
source_profile = default

# a comment
[services local]
s3 =
  endpoint_url = http://localhost:9000
";
		let credentials = "\
[default]
aws_access_key_id = AKIAEXAMPLE
aws_secret_access_key = not-kept

[legacy]
aws_access_key_id = AKIAOTHER
aws_secret_access_key = not-kept-either
";
		assert_eq!(
			names(&parse_profiles(config, credentials)),
			vec![
				("default", None),
				("legacy", None),
				("prod-admin", Some("222222222222")),
				("staging", Some("111111111111")),
			]
		);
	}

	#[test]
	fn a_section_that_only_starts_with_profile_is_not_one() {
		assert!(parse_profiles("[profiles]\nregion = x\n", "").is_empty());
	}

	#[test]
	fn no_files_is_no_profiles() {
		assert!(parse_profiles("", "").is_empty());
	}

	#[test]
	fn the_account_comes_out_of_kms_and_iam_arns() {
		assert_eq!(
			arn_account("arn:aws:kms:eu-west-3:123456789012:key/abcd").as_deref(),
			Some("123456789012")
		);
		assert_eq!(
			arn_account("arn:aws:iam::123456789012:role/Admin").as_deref(),
			Some("123456789012")
		);
		assert_eq!(arn_account("projects/p/locations/l/keyRings/r/cryptoKeys/k"), None);
		assert_eq!(arn_account("arn:aws:kms:eu-west-3:alias:key/abcd"), None);
	}
}
