# Contributing

Thanks for wanting to help. factorai is an Agentic Development Environment:
agents are at the centre, and the human supervises, decides, reviews and sets
the rules they run under. It is a community project with one maintainer, so a
clear issue and a small PR are the fastest way to get something in.

## How a change gets in

1. **Find or file an issue.** The
   [roadmap board](https://github.com/users/Nightbr/projects/1) shows what is
   next, the [open issues](https://github.com/Nightbr/factorai/issues) are the
   work, and the ones labelled
   [`good first issue`](https://github.com/Nightbr/factorai/labels/good%20first%20issue)
   and [`help wanted`](https://github.com/Nightbr/factorai/labels/help%20wanted)
   are the easiest way in. Every triaged issue also carries a `size:*` label,
   from [`size:XS`](https://github.com/Nightbr/factorai/labels/size%3AXS) (under
   an hour) to `size:XL` (an epic that is split before it is scheduled);
   [`specs/roadmap/README.md`](specs/roadmap/README.md#size) defines them, and
   a first issue is `size:XS` or `size:S`. For anything bigger than a small
   fix, open an issue first and say what you plan to do, so nobody builds the
   same thing twice or builds something that will not be merged.
2. **Comment on the issue to claim it.**
3. **Fork, then branch** from `main`, with a name such as `fix/123-resume-hang`.
4. **Open a pull request early**, as a draft if it is not finished. The template
   asks for what changed and why, the issue it closes, the checks you ran, and
   screenshots or a video if the app changed.
5. **A maintainer reviews and merges it.** CI has to be green first. PRs are
   squash-merged, so the PR title becomes the commit on `main`. Use the prefixes
   below.

PRs [#5](https://github.com/Nightbr/factorai/pull/5) and
[#6](https://github.com/Nightbr/factorai/pull/6) are good examples of the size
that merges easily: one bug, one fix, a test.

## What will not be merged

Some things are out of scope on purpose. Read
[What this project does not do](AGENTS.md#what-this-project-does-not-do) before
starting on anything large. In short:

- **No native Windows port.** Windows runs the Linux build inside WSL 2
  ([ADR-0044](specs/adr/0044-windows-is-wsl2-not-a-second-port.md)), so a
  Windows-only fix is a runtime branch, not a new target.
- **No telemetry, analytics or crash reporting** in the app.
- **No localization**, and no code generation for the Tauri bindings.
- **macOS and Linux only** for v1.

## Setting up

You need:

- [mise](https://mise.jdx.dev/) for the toolchain (Node 24, pnpm 10, Rust
  stable). `mise install` reads `.mise.toml`.
- The system libraries Tauri builds against:
  - **Ubuntu / Debian:**
    ```bash
    sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
      librsvg2-dev libgtk-3-dev libxdo-dev libssl-dev build-essential patchelf file
    ```
    That is the list CI uses (`.github/workflows/quality.yml`). For other
    distributions, see [Tauri's prerequisites](https://tauri.app/start/prerequisites/).
  - **macOS:** the Xcode command line tools, `xcode-select --install`.
  - **Windows:** work inside WSL 2 and follow the Linux steps.
- The [Claude Code CLI](https://claude.com/claude-code) or Codex, signed in, if
  you want to run sessions rather than only look at them.

Then:

```bash
git clone https://github.com/<you>/factorai.git
cd factorai
mise install
pnpm install
pnpm dev            # the full app
```

`pnpm --filter @factorai/desktop vite:dev` runs the renderer alone in a browser
against a mocked backend. It is quicker for UI work, and it is what the
Playwright tests use.

## Checks

**Before you push**, at least:

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

**Before you call it done**, the whole gate, in this order:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm bytes:check
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
pnpm deps:check
pnpm deps:unused
cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

CI runs all of it on every PR except `pnpm e2e`, so the PR template asks whether
you ran that one. For UI or behaviour changes, also use the change in the real
window (`pnpm dev`). Type checking does not validate UX. `scripts/qa/` can
drive the real window for you: read [its README](scripts/qa/README.md) first,
because it sends real clicks to whatever window is under them.

## Pull requests

- **One PR, one change.** If it does two things, it is two PRs.
- **The title is the commit on `main`**: `feat:`, `fix:`, `refactor:`, `test:`,
  `docs:` or `chore:`, then a sentence. `feat:` and `fix:` titles become the
  release notes, so write them for someone reading a changelog.
- **Screenshots or a video when the app changes.** Show before and after, or
  record the flow when it moves. Take them in a made-up workspace, not your own,
  so no real project names, paths or tokens end up in a public PR. If nothing in
  the app changed, write "No app change".
- **Specs lead, code follows.** If you change behaviour, update the matching
  file under `specs/` in the same PR. If you make a decision worth recording, add
  an ADR under `specs/adr/` in the same PR. ADRs are never edited once merged: a
  new one supersedes an old one.
- **Tests live next to the code**: `foo.test.ts` beside `foo.ts`, and
  `#[cfg(test)] mod tests` in Rust. A bug fix comes with the test that would have
  caught it.

The rules that most often send a PR back, all from [AGENTS.md](AGENTS.md):

- never `--no-verify`; if a hook blocks the commit, fix the cause;
- no `as any`, `#[allow(...)]` or `// oxlint-disable` to silence a real warning;
- no `unwrap()` in Rust outside `setup()`;
- the `@factorai/ui` primitives (`Button`, `Input`, `Select`), not raw elements;
- no HTML5 drag and drop: it cannot work in this shell, so use dnd-kit and add a
  keyboard path beside the drag;
- no emojis in code or commits.

## Working with a coding agent

You are welcome to contribute through Claude Code, Codex or any other agent:
this project is built that way. [AGENTS.md](AGENTS.md) is written for agents as
much as for people, and `CLAUDE.md` links to it, so point your agent at it
before it starts. The same rules apply whoever typed the code, and **you own the
PR**: read the diff, run the gate, and be ready to answer the review yourself.

## Where things are written down

| | |
|---|---|
| [`AGENTS.md`](AGENTS.md) | how work is done here: setup, code style, the checks, PRs, scope |
| [`specs/`](specs/) | what the app does, feature by feature, and the command surface |
| [`specs/adr/`](specs/adr/) | decisions and why, including the superseded ones |
| [`DESIGN.md`](DESIGN.md) | the visual system: palette, type scale, density |
| [`.claude/skills/`](.claude/skills/) | the long form: the gate, the test lanes, QA, screenshots, PRs |

## Questions, security and licence

- **Questions and ideas** go to
  [Discussions](https://github.com/Nightbr/factorai/discussions), not issues.
- **Security problems** are reported privately: see [SECURITY.md](SECURITY.md).
- **Licence:** factorai is [MIT](LICENSE). By contributing, you agree your
  contribution is released under it. There is no CLA.
