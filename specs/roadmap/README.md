# Roadmap

**The roadmap lives on GitHub** since 2026-10-01
([ADR-0070](../adr/0070-the-roadmap-is-github-issues-and-every-change-is-a-pr.md)):

- **[Issues](https://github.com/Nightbr/factorai/issues)** are the work, one per
  item, with labels for the kind (`bug`, `feature`, `perf`, `chore`, `docs`), the
  area (`area:*`) and the size (`size:*`, below).
- **[The factorai roadmap Project](https://github.com/users/Nightbr/projects/1)** is
  the order. Its board runs *Incoming → Needs triage → Qualified → Todo → In
  progress → In review → Done*, and the hand order in *Todo* is the priority.
- **A merged PR closes its issue** (`Closes #N`), and that is the log. The gotchas
  worth keeping go in the PR's "Notes for the reviewer".

## Size

Every triaged issue carries one `size:*` label, set by the maintainer when it moves
from *Needs triage* to *Qualified*. An issue with an `area:*` label and no size has
not been triaged yet. Size is **effort to ship the issue as written**: the
maintainer's wall-clock from picking it up to the last PR merged, agents included,
since review, the real-window check and the gate are the slow part, not the typing.
Uncertainty is not part of it; `needs-adr` carries that.

| Label | Meaning |
|---|---|
| `size:XS` | Under an hour. No spec or ADR touched. |
| `size:S` | One sitting, one PR. May touch a spec. |
| `size:M` | One or two days, one PR. |
| `size:L` | Several PRs, up to a week. |
| `size:XL` | An epic. It never enters *Todo*: it is split into sized sub-issues first, and the parent keeps `size:XL`. |

Two rules follow from it. A `good first issue` is `size:XS` or `size:S`, or it is not
a first issue. And an issue carries exactly one size; re-sizing replaces the label.

What is left in this folder:

- **[`DONE.md`](./DONE.md)** is **frozen**: the dated log of what shipped up to
  2026-10-01. Immutable ADRs link into it, so it stays, and nothing is added to it.
- **`TODO.md` is gone.** Read it in git history at `205305a`, the commit the issues
  were created from.
- **The table below**, so an old "roadmap item N" still resolves.

## Old item numbers

Item numbers were permanent ids, cited from the specs, the ADRs, `DONE.md` and code
comments, and they still are. Issues and PRs share one counter, so an item number is
not its issue number. Each migrated issue keeps its number in the Project's *Item*
field, and mutable files cite both, as in "roadmap item 7 (#17)".

**A number that is not in this table shipped or was dropped**, and `DONE.md`'s entry
for it names the number.

| Item | Issue | Title |
|---|---|---|
| 1 | [#13](https://github.com/Nightbr/factorai/issues/13) | Git graph: the wide surface, session to commit links, a merge parent picker, a HEAD chip per checkout |
| 2 | [#14](https://github.com/Nightbr/factorai/issues/14) | Editing a file: drafts that survive a quit, the secrets rule, the rest of F9 |
| 6 | [#16](https://github.com/Nightbr/factorai/issues/16) | Custom window titlebar, and with it clean Linux corners |
| 7 | [#17](https://github.com/Nightbr/factorai/issues/17) | Error UX: transient errors through the toast |
| 8 | [#18](https://github.com/Nightbr/factorai/issues/18) | The smoke pass on macOS and Linux |
| 10 | [#19](https://github.com/Nightbr/factorai/issues/19) | A regression test lane beside the smoke suite |
| 12 | [#20](https://github.com/Nightbr/factorai/issues/20) | Cmd+P: quick-open by filename |
| 13 | [#21](https://github.com/Nightbr/factorai/issues/21) | Cmd+Shift+F: project-wide content search |
| 14 | [#22](https://github.com/Nightbr/factorai/issues/22) | Cmd+G: symbol search (explore first) |
| 16 | [#23](https://github.com/Nightbr/factorai/issues/23) | App-wide scrollbar styling |
| 17 | [#38](https://github.com/Nightbr/factorai/issues/38) | Rename a session from inside factorai (very low priority) |
| 18 | [#24](https://github.com/Nightbr/factorai/issues/24) | Desktop integration assets: the .desktop entry and hicolor icons |
| 19 | [#25](https://github.com/Nightbr/factorai/issues/25) | IDE bridge: past the read-only half |
| 29 | [#27](https://github.com/Nightbr/factorai/issues/27) | Error boundaries per surface, so one crash costs one pane |
| 32 | [#28](https://github.com/Nightbr/factorai/issues/28) | Light theme: make the palette that already exists render |
| 34 | [#29](https://github.com/Nightbr/factorai/issues/29) | Session status: the unread axis |
| 35 | [#30](https://github.com/Nightbr/factorai/issues/30) | Desktop notifications when a session wants you |
| 38 | [#31](https://github.com/Nightbr/factorai/issues/31) | More agents: the rest of Codex, then Gemini CLI, OpenCode and Cursor |
| 39 | [#10](https://github.com/Nightbr/factorai/issues/10) | Site: the guide's content, and the versioning decision |
| 40 | [#32](https://github.com/Nightbr/factorai/issues/32) | Pull requests and merge requests from inside factorai |
| 42 | [#15](https://github.com/Nightbr/factorai/issues/15) | Routines: the skills picker, a toast on a failed fire, run history |
| 43 | [#33](https://github.com/Nightbr/factorai/issues/33) | Handing a file to the agent: a drop target and a visible control |
| 44 | [#34](https://github.com/Nightbr/factorai/issues/34) | A default model per agent, set once in Settings |
| 48 | [#35](https://github.com/Nightbr/factorai/issues/35) | File viewer column: the three pieces the first cut left |
| 52 | [#36](https://github.com/Nightbr/factorai/issues/36) | The file viewer and its panel in a window of their own |
| 59 | [#9](https://github.com/Nightbr/factorai/issues/9) | Performance: an ADR accepting the budgets |
| 60 | [#37](https://github.com/Nightbr/factorai/issues/37) | Turn on the oxlint rules the Biome migration left off |
| 61 | [#11](https://github.com/Nightbr/factorai/issues/11) | Re-shoot the README images from the fixture workspace |
| 62 | [#12](https://github.com/Nightbr/factorai/issues/12) | The roadmap moves to GitHub: issues, a project, templates, and a PR for every change |
| 63 | [#26](https://github.com/Nightbr/factorai/issues/26) | PDF viewer: find, go to page, outline, and a rendered diff |

Sub-issues: item 2 is split into #39, #40, #41, and item 38 into #42, #43, #44, #45, #46.

## How this relates to the rest of `specs/`

The roadmap is **sequencing**, not design. It says what to do next and in what
order; it never becomes the place a feature is specified.

- [`06-milestones.md`](../06-milestones.md) is the **arc**: M0 to M6 with their exit
  criteria, and the deferred post-MVP list. It changes rarely.
- [`05-features.md`](../05-features.md) and the other numbered specs are the
  **contract** for behaviour. If an issue and a spec disagree about what a feature
  should do, the spec wins, or the spec is wrong and gets fixed first, per the
  `spec-and-adr-workflow` skill.
- [`specs/adr/`](../adr/) holds the decisions that constrain the approach. An issue
  that wants to relitigate one needs a superseding ADR, not a comment.

When the work lands, the same PR updates the spec it changed and closes the issue.
