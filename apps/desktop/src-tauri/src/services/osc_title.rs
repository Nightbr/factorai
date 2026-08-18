//! Session status, read out of the terminal title Claude Code already writes.
//!
//! Claude Code sets the title through `OSC 0` and encodes its own state in the
//! first character of the payload:
//!
//! ```text
//! ESC ] 0 ; ✳ Claude Code   BEL      idle — it is your turn
//! ESC ] 0 ; ◐ Claude Code   BEL      working (◐ ◑ alternating, 960ms)
//! ESC ] 0 ; ✳ Date command  BEL      idle again, title now names the turn
//! ```
//!
//! **The rule enumerates the idle marker and treats everything else as
//! working**, which is the half that survives version drift: any spinner glyph
//! the CLI adopts later still reads correctly, and only [`IDLE_MARKER`] is
//! load-bearing. Enumerating the *spinner* instead is how the prior app's
//! detector died — it matches braille frames (U+2800–U+28FF) that Claude Code
//! no longer emits, so its busy state never fires.
//!
//! Note there are two different spinners in play. The title animates `◐ ◑`
//! (U+25D0/U+25D1); the TUI *body* spinner is `· ✢ ✳ ✶ ✻ ✽`, which contains
//! `✳` — so a rule written against the body spinner would read idle mid-spin.
//! This scanner reads the title and nothing else.
//!
//! See `specs/05-features.md` § F10 and ADR-0015.

use crate::services::terminal::TerminalStatus;

/// U+2733 EIGHT SPOKED ASTERISK — the CLI's idle marker, and the only glyph
/// this module recognises by value.
const IDLE_MARKER: char = '\u{2733}';

/// Cap on a partial sequence held across reads. A title is a few dozen bytes;
/// anything past this is not a title we are waiting to complete, so the carry
/// is dropped rather than grown without bound by a stream that never
/// terminates a sequence it opened.
const MAX_CARRY: usize = 4096;

/// Incremental scanner over one PTY's byte stream.
///
/// Stateful because an escape sequence can be split across reads — the PTY
/// hands us 8KB at a time with no regard for where a sequence begins or ends,
/// so a title arriving on a chunk boundary would otherwise be missed. That is
/// exactly the kind of intermittent miss that would show up as "the dot
/// sometimes doesn't update", so it is covered by a test.
#[derive(Default)]
pub struct TitleScanner {
	/// Bytes from an unterminated sequence, waiting for the rest.
	carry: Vec<u8>,
}

impl TitleScanner {
	/// Feed the next chunk of PTY output.
	///
	/// Returns the status implied by the **last complete title** in the chunk,
	/// or `None` when the chunk contained no complete title — in which case the
	/// caller holds whatever state it already had. Last-wins because a chunk
	/// can carry several frames of the spinner and only the newest is current.
	pub fn push(&mut self, bytes: &[u8]) -> Option<TerminalStatus> {
		// Work over carry + new bytes so a sequence split across reads is seen
		// whole. The common case is an empty carry and no copy.
		let buf: Vec<u8> = if self.carry.is_empty() {
			bytes.to_vec()
		} else {
			let mut v = std::mem::take(&mut self.carry);
			v.extend_from_slice(bytes);
			v
		};

		let mut status = None;
		let mut i = 0;

		while let Some(start) = find_osc_start(&buf, i) {
			match parse_osc(&buf, start) {
				OscScan::Complete { code, payload, end } => {
					// 0 is SET_TITLE_AND_ICON, which is what the CLI uses; 2 is
					// SET_TITLE. Accepting both costs nothing and means a CLI
					// that switches to the narrower sequence still works.
					if code == 0 || code == 2 {
						if let Some(s) = classify(payload) {
							status = Some(s);
						}
					}
					i = end;
				}
				OscScan::Incomplete => {
					// Keep the tail for the next read, unless it has grown past
					// anything that could still be a title.
					let tail = &buf[start..];
					if tail.len() <= MAX_CARRY {
						self.carry = tail.to_vec();
					}
					return status;
				}
				OscScan::NotOsc => {
					// `ESC` not followed by `]` — skip just the ESC so a `]`
					// immediately after it can still open a sequence.
					i = start + 1;
				}
			}
		}

		status
	}
}

/// Which state a title payload implies, or `None` to leave the state alone.
fn classify(payload: &[u8]) -> Option<TerminalStatus> {
	// Lossy is right here: a replacement char is still "some glyph", which is
	// still "working", and a title is never a reason to drop a chunk.
	let text = String::from_utf8_lossy(payload);
	match text.trim_start().chars().next() {
		Some(IDLE_MARKER) => Some(TerminalStatus::WaitingInput),
		// Any other glyph is a spinner frame we don't need to know the name of.
		Some(_) => Some(TerminalStatus::Working),
		// An empty title says nothing, so it changes nothing.
		None => None,
	}
}

enum OscScan<'a> {
	Complete {
		code: u16,
		payload: &'a [u8],
		end: usize,
	},
	/// The sequence opened but has not terminated yet.
	Incomplete,
	/// `ESC` was not the start of an OSC after all.
	NotOsc,
}

const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const OSC_OPEN: u8 = b']';
const ST_FINAL: u8 = b'\\';

fn find_osc_start(buf: &[u8], from: usize) -> Option<usize> {
	buf.get(from..)?.iter().position(|&b| b == ESC).map(|p| from + p)
}

/// Parse one OSC beginning at `start` (which must point at `ESC`).
///
/// Terminated by `BEL` or by ST (`ESC \`) — both are in use, and the CLI's own
/// writer emits either depending on the sequence, so accepting only `BEL`
/// would work today and break quietly later.
fn parse_osc(buf: &[u8], start: usize) -> OscScan<'_> {
	match buf.get(start + 1) {
		None => return OscScan::Incomplete,
		Some(&OSC_OPEN) => {}
		Some(_) => return OscScan::NotOsc,
	}

	let mut code: u16 = 0;
	let mut digits = 0;
	let mut i = start + 2;

	// Read `<digits> ;`. Running out of buffer here is **Incomplete, not
	// NotOsc** — the distinction matters and is not cosmetic: a chunk that ends
	// exactly on `ESC ]` would otherwise be judged "not a sequence", its carry
	// dropped, and the title that completes on the next read lost for good.
	// A 16ms flush window over 8KB reads puts a boundary somewhere in every
	// busy stream, so "somewhere" is eventually here.
	loop {
		let Some(&b) = buf.get(i) else { return OscScan::Incomplete };
		if b.is_ascii_digit() {
			// Saturating so an absurd run of digits can't wrap into a code we
			// would then act on.
			code = code.saturating_mul(10).saturating_add(u16::from(b - b'0'));
			digits += 1;
			i += 1;
		} else if b == b';' && digits > 0 {
			i += 1;
			break;
		} else {
			// `ESC ] ; …` and `ESC ] x …` carry no code we can attribute.
			return OscScan::NotOsc;
		}
	}

	let payload_start = i;
	while let Some(&b) = buf.get(i) {
		match b {
			BEL => {
				return OscScan::Complete { code, payload: &buf[payload_start..i], end: i + 1 };
			}
			ESC => {
				return match buf.get(i + 1) {
					None => OscScan::Incomplete,
					Some(&ST_FINAL) => {
						OscScan::Complete { code, payload: &buf[payload_start..i], end: i + 2 }
					}
					// An ESC inside the payload that isn't ST means the
					// sequence was abandoned mid-flight. Give up on it and let
					// the caller rescan from the new ESC.
					Some(_) => OscScan::NotOsc,
				};
			}
			_ => i += 1,
		}
	}

	OscScan::Incomplete
}

#[cfg(test)]
mod tests {
	use super::*;

	/// Captured from a real session — `scripts/qa/osc-probe.sh` prints these.
	const IDLE: &[u8] = b"\x1b]0;\xe2\x9c\xb3 Claude Code\x07";
	const WORKING: &[u8] = b"\x1b]0;\xe2\x97\x90 Claude Code\x07";
	const IDLE_NAMED: &[u8] = b"\x1b]0;\xe2\x9c\xb3 Date command\x07";

	#[test]
	fn reads_the_idle_marker_as_waiting() {
		let mut s = TitleScanner::default();
		assert_eq!(s.push(IDLE), Some(TerminalStatus::WaitingInput));
		assert_eq!(s.push(IDLE_NAMED), Some(TerminalStatus::WaitingInput));
	}

	#[test]
	fn reads_any_other_glyph_as_working() {
		let mut s = TitleScanner::default();
		assert_eq!(s.push(WORKING), Some(TerminalStatus::Working));
		// The other title spinner frame, and a glyph from no set at all — the
		// rule is deliberately not a list of spinners, so a future CLI that
		// changes the animation still reads as working.
		assert_eq!(s.push(b"\x1b]0;\xe2\x97\x91 Claude Code\x07"), Some(TerminalStatus::Working));
		assert_eq!(s.push(b"\x1b]0;\xe2\xa0\x8b Claude Code\x07"), Some(TerminalStatus::Working));
		assert_eq!(s.push(b"\x1b]0;zzz\x07"), Some(TerminalStatus::Working));
	}

	#[test]
	fn the_full_turn_is_a_working_then_waiting_edge() {
		// The sequence a real turn produces: idle at boot, working while it
		// runs, idle again when it ends. This is the edge the whole feature is.
		let mut s = TitleScanner::default();
		assert_eq!(s.push(IDLE), Some(TerminalStatus::WaitingInput));
		assert_eq!(s.push(WORKING), Some(TerminalStatus::Working));
		assert_eq!(s.push(IDLE_NAMED), Some(TerminalStatus::WaitingInput));
	}

	#[test]
	fn a_title_split_across_reads_is_still_seen() {
		// The PTY hands us 8KB at a time with no regard for sequence
		// boundaries, so this is the ordinary case, not a pathological one.
		for split in 1..IDLE.len() {
			let mut s = TitleScanner::default();
			let first = s.push(&IDLE[..split]);
			let second = s.push(&IDLE[split..]);
			assert_eq!(
				first.or(second),
				Some(TerminalStatus::WaitingInput),
				"split at {split} lost the title"
			);
		}
	}

	#[test]
	fn a_title_split_one_byte_at_a_time_is_still_seen() {
		let mut s = TitleScanner::default();
		let mut seen = None;
		for b in WORKING {
			if let Some(x) = s.push(&[*b]) {
				seen = Some(x);
			}
		}
		assert_eq!(seen, Some(TerminalStatus::Working));
	}

	#[test]
	fn st_terminates_as_well_as_bel() {
		let mut s = TitleScanner::default();
		assert_eq!(
			s.push(b"\x1b]0;\xe2\x9c\xb3 Claude Code\x1b\\"),
			Some(TerminalStatus::WaitingInput)
		);
	}

	#[test]
	fn no_title_changes_nothing() {
		let mut s = TitleScanner::default();
		// Plain output, cursor movement, colours, and an OSC we don't care
		// about. None of it is a title, so none of it is a state.
		assert_eq!(s.push(b"hello world\r\n"), None);
		assert_eq!(s.push(b"\x1b[2J\x1b[H\x1b[31mred\x1b[0m"), None);
		assert_eq!(s.push(b"\x1b]8;;https://example.com\x07link\x1b]8;;\x07"), None);
		assert_eq!(s.push(b"\x1b]9;4;3;\x07"), None);
		assert_eq!(s.push(b"\x1b]777;notify;Claude Code;done\x07"), None);
	}

	#[test]
	fn an_empty_title_changes_nothing() {
		let mut s = TitleScanner::default();
		assert_eq!(s.push(b"\x1b]0;\x07"), None);
		// And it does not clobber a later real one.
		assert_eq!(s.push(IDLE), Some(TerminalStatus::WaitingInput));
	}

	#[test]
	fn the_last_title_in_a_chunk_wins() {
		// A coalesced chunk can carry several spinner frames; only the newest
		// is the current state.
		let mut s = TitleScanner::default();
		let mut chunk = Vec::new();
		chunk.extend_from_slice(WORKING);
		chunk.extend_from_slice(WORKING);
		chunk.extend_from_slice(IDLE_NAMED);
		assert_eq!(s.push(&chunk), Some(TerminalStatus::WaitingInput));

		let mut chunk = Vec::new();
		chunk.extend_from_slice(IDLE);
		chunk.extend_from_slice(WORKING);
		assert_eq!(s.push(&chunk), Some(TerminalStatus::Working));
	}

	#[test]
	fn a_title_buried_in_real_output_is_found() {
		let mut s = TitleScanner::default();
		let mut chunk = Vec::new();
		chunk.extend_from_slice(b"\x1b[?25l\x1b[38;5;208msome output\x1b[0m\r\n");
		chunk.extend_from_slice(WORKING);
		chunk.extend_from_slice(b"\x1b[K more output");
		assert_eq!(s.push(&chunk), Some(TerminalStatus::Working));
	}

	#[test]
	fn other_osc_codes_are_ignored_even_when_they_look_like_titles() {
		let mut s = TitleScanner::default();
		// OSC 7 is the cwd, whose payload starts with a glyph-free scheme but
		// is still "some first char" — if the code check were missing this
		// would read as working.
		assert_eq!(s.push(b"\x1b]7;file:///Users/x/proj\x07"), None);
		// OSC 1 sets the icon name only; we don't treat it as the title.
		assert_eq!(s.push(b"\x1b]1;\xe2\x9c\xb3 icon\x07"), None);
		// OSC 2 does set the window title, so it counts.
		assert_eq!(
			s.push(b"\x1b]2;\xe2\x9c\xb3 Claude Code\x07"),
			Some(TerminalStatus::WaitingInput)
		);
	}

	#[test]
	fn an_unterminated_sequence_does_not_grow_the_carry_without_bound() {
		let mut s = TitleScanner::default();
		let mut junk = Vec::from(&b"\x1b]0;"[..]);
		junk.extend(std::iter::repeat_n(b'x', MAX_CARRY * 2));
		assert_eq!(s.push(&junk), None);
		assert!(s.carry.is_empty(), "oversized partial sequence should be dropped, not held");
		// And the scanner still works afterwards.
		assert_eq!(s.push(IDLE), Some(TerminalStatus::WaitingInput));
	}

	#[test]
	fn a_bare_esc_does_not_swallow_the_title_after_it() {
		let mut s = TitleScanner::default();
		let mut chunk = Vec::from(&b"\x1b"[..]);
		chunk.extend_from_slice(IDLE);
		assert_eq!(s.push(&chunk), Some(TerminalStatus::WaitingInput));
	}

	#[test]
	fn an_abandoned_sequence_does_not_swallow_the_next_one() {
		let mut s = TitleScanner::default();
		// `ESC ] 0 ;` opened, then an unrelated CSI cut in before any
		// terminator. The title that follows must still be found.
		let mut chunk = Vec::from(&b"\x1b]0;abc\x1b[0m"[..]);
		chunk.extend_from_slice(WORKING);
		assert_eq!(s.push(&chunk), Some(TerminalStatus::Working));
	}
}
