#!/usr/bin/env python3
"""A fabricated workspace to photograph the app against.

Documentation images cannot come from the author's own machine: the sidebar is
full of client and employer project names, and a picture with four rows blurred
and one legible reads as a redacted document rather than as a product. So the
subject is invented — four repositories, their git history, and the Claude
transcripts that make them sessions — and the app is pointed at it through the
two environment variables that move its whole world:

    CLAUDE_CONFIG_DIR   where the agent's store is read from (see `claude_dir`
                        in src-tauri/src/lib.rs)
    XDG_DATA_HOME       where `app_data_dir` puts `dev.factorai/factorai.db`

Nothing here touches the real store or the real database.

The names are the ones the site's own mock uses (apps/docs/src/mock), so the
hero and the guide show one invented world rather than two.

    scripts/qa/fixture-workspace.py build     # repos, history, transcripts
    eval "$(scripts/qa/fixture-workspace.py env)"
    VITE_FACTORAI_SCREENSHOT=1 scripts/qa/launch.sh    # boot once: migrates
    scripts/qa/fixture-workspace.py seed      # workspace rows, groups, routine
    VITE_FACTORAI_SCREENSHOT=1 scripts/qa/launch.sh    # and now it has a world

`build` is idempotent — it refuses a root that already holds repositories
unless `--force`, which deletes it first. `seed` needs the database to exist,
which is why the app is booted between the two.

See specs/roadmap/TODO.md item 61, and `.claude/skills/app-screenshot/SKILL.md`
for the capture itself.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

DEFAULT_ROOT = Path.home() / "factorai-demo"

# One namespace, so every id this script writes is stable across runs: a
# re-built fixture keeps the session ids its screenshots were taken against.
NS = uuid.UUID("f2c70a1e-0000-4000-8000-000000000001")

AUTHORS = [
    ("Ada Kern", "ada@example.com"),
    ("Sam Oduya", "sam@example.com"),
]

NOW = datetime.now(timezone.utc).replace(microsecond=0)


def uid(*parts: str) -> str:
    return str(uuid.uuid5(NS, "/".join(parts)))


def ago(hours: float) -> datetime:
    return NOW - timedelta(hours=hours)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def encode_project_path(path: Path) -> str:
    """Claude's own directory naming, from specs/02-data-model.md.

    Separators *and dots* fold to `-`. Only this function knows the scheme,
    exactly as only `agents::claude` does on the Rust side.
    """
    s = str(path).rstrip("/")
    for ch in ("/", "\\", "."):
        s = s.replace(ch, "-")
    return s


# ── The invented world ──────────────────────────────────────────────────────
#
# Four repositories in two groups, the same names and groups the site's mock
# draws. Each carries enough history for the Graph tab to be worth a picture,
# and one carries a dirty working tree for Changes.

BILLING_FILES = {
    "README.md": """# billing-api

Invoices, subscriptions and the webhook endpoint Stripe talks to.

```bash
pnpm install
pnpm dev
```
""",
    "package.json": """{
  "name": "billing-api",
  "version": "1.4.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "e2e": "playwright test"
  }
}
""",
    "src/server.ts": """import { createServer } from 'node:http';

import { router } from './router';

const port = Number(process.env.PORT ?? 8787);

createServer(router).listen(port, () => {
  console.log(`billing-api listening on :${port}`);
});
""",
    "src/router.ts": """import type { IncomingMessage, ServerResponse } from 'node:http';

import { handleWebhook } from './webhooks';
import { renderInvoice } from './invoices';

export function router(req: IncomingMessage, res: ServerResponse): void {
  if (req.url === '/webhooks/stripe') return handleWebhook(req, res);
  if (req.url?.startsWith('/invoices/')) return renderInvoice(req, res);
  res.statusCode = 404;
  res.end('not found');
}
""",
    "src/invoices.ts": """import type { IncomingMessage, ServerResponse } from 'node:http';

export type Line = { description: string; cents: number };

/** A plan change mid-cycle is billed for the days actually used. */
export function prorate(cents: number, dayOfCycle: number, cycleDays: number): number {
  const remaining = Math.max(cycleDays - dayOfCycle, 0);
  return Math.round((cents * remaining) / cycleDays);
}

export function renderInvoice(_req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ lines: [] satisfies Line[] }));
}
""",
    "src/webhooks.ts": """import type { IncomingMessage, ServerResponse } from 'node:http';

const seen = new Set<string>();

/** Stripe retries on any non-2xx, so the handler has to be idempotent. */
export function handleWebhook(req: IncomingMessage, res: ServerResponse): void {
  const id = String(req.headers['stripe-event-id'] ?? '');
  if (id && seen.has(id)) {
    res.statusCode = 200;
    res.end('duplicate');
    return;
  }
  seen.add(id);
  res.statusCode = 200;
  res.end('ok');
}
""",
    "src/invoices.test.ts": """import { describe, expect, it } from 'vitest';

import { prorate } from './invoices';

describe('prorate', () => {
  it('bills nothing for a change on the last day', () => {
    expect(prorate(3000, 30, 30)).toBe(0);
  });

  it('bills half a cycle at half the price', () => {
    expect(prorate(3000, 15, 30)).toBe(1500);
  });
});
""",
}

DOCS_FILES = {
    "README.md": """# docs-site

The product guide. One build, deployed on every push to `main`.
""",
    "content/index.md": """---
title: Start here
---

Install it, add a project, and the sessions appear on their own.
""",
    "content/install.md": """---
title: Install
---

## Linux

Download the AppImage, make it executable, run it.

## macOS

Download the `.dmg` and drag the app into Applications.
""",
    "content/cli.md": """---
title: The CLI
---

Every command takes `--json`, and prints a table when it is absent.
""",
    "site.config.json": """{
  "title": "docs-site",
  "baseUrl": "/",
  "nav": ["index", "install", "cli"]
}
""",
}

HOMELAB_FILES = {
    "README.md": """# homelab

One compose file, one playbook, one machine in a cupboard.
""",
    "compose.yml": """services:
  proxy:
    image: caddy:2
    ports: ['80:80', '443:443']
    volumes: ['./Caddyfile:/etc/caddy/Caddyfile']

  jellyfin:
    image: jellyfin/jellyfin:latest
    volumes: ['./media:/media']
""",
    "Caddyfile": """media.home.arpa {
  reverse_proxy jellyfin:8096
}
""",
    "ansible/playbook.yml": """- hosts: nas
  tasks:
    - name: nightly snapshot
      ansible.builtin.cron:
        name: snapshot
        hour: '3'
        minute: '0'
        job: /usr/local/bin/snapshot.sh
""",
}

RECIPES_FILES = {
    "README.md": """# recipes

Things that worked, written down before they were forgotten.
""",
    "bread/sourdough.md": """# Sourdough

- 500g flour
- 350g water
- 100g starter
- 10g salt

Autolyse an hour, four folds, overnight in the fridge, 250C with steam.
""",
    "pasta/cacio-e-pepe.md": """# Cacio e pepe

Toast the pepper. Keep the water. Take the pan off the heat before the cheese.
""",
}


def sh(args: list[str], cwd: Path, env: dict[str, str] | None = None) -> None:
    subprocess.run(args, cwd=cwd, env=env, check=True, capture_output=True)


def write(root: Path, rel: str, body: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body, encoding="utf-8")


def git(repo: Path, *args: str, when: datetime | None = None, who: int = 0) -> None:
    env = dict(os.environ)
    name, email = AUTHORS[who % len(AUTHORS)]
    env.update(
        {
            "GIT_AUTHOR_NAME": name,
            "GIT_AUTHOR_EMAIL": email,
            "GIT_COMMITTER_NAME": name,
            "GIT_COMMITTER_EMAIL": email,
            # A repository seeded in one second would draw a graph of one
            # column of identical timestamps; the history is dated so the rail
            # has something to say.
            "GIT_AUTHOR_DATE": iso(when or NOW),
            "GIT_COMMITTER_DATE": iso(when or NOW),
        }
    )
    sh(["git", *args], cwd=repo, env=env)


def init_repo(repo: Path, files: dict[str, str]) -> None:
    repo.mkdir(parents=True, exist_ok=True)
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "commit.gpgsign", "false"], cwd=repo)
    for rel, body in files.items():
        write(repo, rel, body)


def build_billing(root: Path) -> None:
    """The busy one: a merged feature branch, a tag, and a dirty tree."""
    repo = root / "billing-api"
    init_repo(repo, BILLING_FILES)

    git(repo, "add", "README.md", "package.json", when=ago(24 * 21), who=0)
    git(repo, "commit", "-q", "-m", "chore: the project, and how to run it", when=ago(24 * 21), who=0)

    git(repo, "add", "src/server.ts", "src/router.ts", when=ago(24 * 19), who=0)
    git(repo, "commit", "-q", "-m", "feat: a server and one route table", when=ago(24 * 19), who=0)

    git(repo, "add", "src/invoices.ts", when=ago(24 * 17), who=1)
    git(repo, "commit", "-q", "-m", "feat: invoices render as JSON", when=ago(24 * 17), who=1)

    git(repo, "add", "src/webhooks.ts", when=ago(24 * 14), who=0)
    git(repo, "commit", "-q", "-m", "feat: the stripe webhook endpoint", when=ago(24 * 14), who=0)

    git(repo, "tag", "v1.3.0", when=ago(24 * 14), who=0)

    # A feature branch, merged with a merge commit so the graph has a join.
    git(repo, "checkout", "-q", "-b", "feat/proration", when=ago(24 * 9), who=1)
    write(
        repo,
        "src/invoices.ts",
        BILLING_FILES["src/invoices.ts"].replace(
            "export function renderInvoice",
            "export const CYCLE_DAYS = 30;\n\nexport function renderInvoice",
        ),
    )
    git(repo, "add", "src/invoices.ts", when=ago(24 * 9), who=1)
    git(repo, "commit", "-q", "-m", "feat: a cycle length to prorate against", when=ago(24 * 9), who=1)

    git(repo, "add", "src/invoices.test.ts", when=ago(24 * 8), who=1)
    git(repo, "commit", "-q", "-m", "test: prorate at both ends of a cycle", when=ago(24 * 8), who=1)

    git(repo, "checkout", "-q", "main", when=ago(24 * 7), who=0)
    git(
        repo,
        "merge",
        "-q",
        "--no-ff",
        "feat/proration",
        "-m",
        "merge: proration on mid-cycle plan changes",
        when=ago(24 * 7),
        who=0,
    )
    git(repo, "tag", "v1.4.0", when=ago(24 * 7), who=0)

    # A second branch, still open, so the rail is not a single line.
    git(repo, "checkout", "-q", "-b", "fix/webhook-retries", when=ago(24 * 3), who=0)
    write(
        repo,
        "src/webhooks.ts",
        BILLING_FILES["src/webhooks.ts"].replace(
            "const seen = new Set<string>();",
            "// Bounded, because a process that never forgets an id is a leak.\nconst seen = new Set<string>();",
        ),
    )
    git(repo, "add", "src/webhooks.ts", when=ago(24 * 3), who=0)
    git(repo, "commit", "-q", "-m", "fix: say what the seen set is for", when=ago(24 * 3), who=0)
    git(repo, "checkout", "-q", "main", when=ago(24 * 3), who=0)

    # And what Changes is a picture of: one modified, one added, one deleted.
    write(
        repo,
        "src/invoices.ts",
        BILLING_FILES["src/invoices.ts"].replace(
            "export function renderInvoice",
            "export const CYCLE_DAYS = 30;\n\n/** Lines are ordered by the day they were accrued. */\nexport function sortLines(lines: Line[]): Line[] {\n  return [...lines].sort((a, b) => a.cents - b.cents);\n}\n\nexport function renderInvoice",
        ),
    )
    write(
        repo,
        "src/proration.md",
        "# Proration\n\nA plan change mid-cycle bills the days actually used, at the new price.\n",
    )
    (repo / "src/invoices.test.ts").unlink()


def build_docs(root: Path) -> None:
    repo = root / "docs-site"
    init_repo(repo, DOCS_FILES)
    git(repo, "add", "README.md", "site.config.json", when=ago(24 * 12), who=0)
    git(repo, "commit", "-q", "-m", "chore: the site, and what it builds", when=ago(24 * 12), who=0)
    git(repo, "add", "content/index.md", when=ago(24 * 11), who=0)
    git(repo, "commit", "-q", "-m", "docs: start here", when=ago(24 * 11), who=0)
    git(repo, "add", "content/install.md", "content/cli.md", when=ago(24 * 5), who=1)
    git(repo, "commit", "-q", "-m", "docs: install, and the CLI's flags", when=ago(24 * 5), who=1)


def build_homelab(root: Path) -> None:
    repo = root / "homelab"
    init_repo(repo, HOMELAB_FILES)
    git(repo, "add", "README.md", "compose.yml", when=ago(24 * 30), who=0)
    git(repo, "commit", "-q", "-m", "chore: one compose file", when=ago(24 * 30), who=0)
    git(repo, "add", "Caddyfile", when=ago(24 * 6), who=0)
    git(repo, "commit", "-q", "-m", "feat: everything behind the reverse proxy", when=ago(24 * 6), who=0)
    git(repo, "add", "ansible/playbook.yml", when=ago(24 * 2), who=0)
    git(repo, "commit", "-q", "-m", "feat: the nightly snapshot, as a cron task", when=ago(24 * 2), who=0)


def build_recipes(root: Path) -> None:
    repo = root / "recipes"
    init_repo(repo, RECIPES_FILES)
    git(repo, "add", "README.md", "bread/sourdough.md", when=ago(24 * 45), who=1)
    git(repo, "commit", "-q", "-m", "docs: sourdough, after the fourth attempt", when=ago(24 * 45), who=1)
    git(repo, "add", "pasta/cacio-e-pepe.md", when=ago(24 * 20), who=1)
    git(repo, "commit", "-q", "-m", "docs: cacio e pepe", when=ago(24 * 20), who=1)


# ── The transcripts ─────────────────────────────────────────────────────────
#
# One JSONL per session, in the shape specs/02-data-model.md records: an
# envelope per line, tool use as content blocks inside a message, and an
# `ai-title` event so the session list reads as sentences rather than uuids.


class Transcript:
    def __init__(self, session_id: str, cwd: Path, branch: str, start: datetime) -> None:
        self.session_id = session_id
        self.cwd = str(cwd)
        self.branch = branch
        self.at = start
        self.parent: str | None = None
        self.lines: list[str] = []
        self.tool_seq = 0

    def _emit(self, event: dict) -> None:
        self.lines.append(json.dumps(event, separators=(",", ":")))

    def _envelope(self, kind: str) -> dict:
        self.at += timedelta(seconds=17)
        this = uid(self.session_id, str(len(self.lines)))
        env = {
            "type": kind,
            "uuid": this,
            "parentUuid": self.parent,
            "timestamp": iso(self.at),
            "sessionId": self.session_id,
            "cwd": self.cwd,
            "version": "2.0.14",
            "gitBranch": self.branch,
        }
        self.parent = this
        return env

    def title(self, text: str) -> "Transcript":
        self._emit({**self._envelope("ai-title"), "aiTitle": text})
        return self

    def user(self, text: str) -> "Transcript":
        self._emit(
            {
                **self._envelope("user"),
                "message": {"role": "user", "content": [{"type": "text", "text": text}]},
            }
        )
        return self

    def assistant(self, text: str) -> "Transcript":
        self._emit(
            {
                **self._envelope("assistant"),
                "message": {"role": "assistant", "content": [{"type": "text", "text": text}]},
            }
        )
        return self

    def tool(self, name: str, inp: dict, result: str, say: str | None = None) -> "Transcript":
        self.tool_seq += 1
        tool_id = f"toolu_{self.session_id[:8]}_{self.tool_seq}"
        content: list[dict] = []
        if say:
            content.append({"type": "text", "text": say})
        content.append({"type": "tool_use", "id": tool_id, "name": name, "input": inp})
        self._emit({**self._envelope("assistant"), "message": {"role": "assistant", "content": content}})
        self._emit(
            {
                **self._envelope("user"),
                "message": {
                    "role": "user",
                    "content": [{"type": "tool_result", "tool_use_id": tool_id, "content": result}],
                },
                "toolUseResult": {"stdout": result, "stderr": "", "interrupted": False},
            }
        )
        return self

    def save(self, store: Path) -> Path:
        d = store / "projects" / encode_project_path(Path(self.cwd))
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"{self.session_id}.jsonl"
        p.write_text("\n".join(self.lines) + "\n", encoding="utf-8")
        os.utime(p, (self.at.timestamp(), self.at.timestamp()))
        return p


def transcripts(root: Path, store: Path) -> None:
    billing = root / "billing-api"
    docs = root / "docs-site"
    homelab = root / "homelab"
    recipes = root / "recipes"

    (
        Transcript(uid("s", "billing", "webhooks"), billing, "fix/webhook-retries", ago(5))
        .title("Stripe retries are duplicating invoices")
        .user(
            "Customers are getting two invoices for one payment when Stripe retries a webhook. "
            "Find out why and fix it."
        )
        .assistant(
            "Stripe retries on any non-2xx, so the handler has to be idempotent against the "
            "event id. Let me read the endpoint first."
        )
        .tool(
            "Read",
            {"file_path": "src/webhooks.ts"},
            "     1\timport type { IncomingMessage, ServerResponse } from 'node:http';\n"
            "     3\tconst seen = new Set<string>();\n"
            "     8\t  const id = String(req.headers['stripe-event-id'] ?? '');",
        )
        .assistant(
            "The set is there, but it only lives as long as the process — every deploy forgets "
            "every event id, and a retry that crosses a restart is billed twice. It also grows "
            "without bound, which is the second bug."
        )
        .tool(
            "Bash",
            {"command": "pnpm vitest run src/webhooks.test.ts", "description": "Run the webhook tests"},
            "✓ src/webhooks.test.ts (3 tests) 412ms\n\nTest Files  1 passed (1)\n     Tests  3 passed (3)",
        )
        .assistant(
            "The tests pass because they never restart the process. I will store the id with the "
            "invoice row instead, so the guarantee outlives the server, and add the case that "
            "would have caught this."
        )
        .save(store)
    )

    (
        Transcript(uid("s", "billing", "e2e"), billing, "main", ago(29))
        .title("Flaky e2e on CI: the checkout spec")
        .user("The checkout spec fails about one run in four on CI and never locally. Why?")
        .assistant("Let me look at what the spec waits for before it asserts.")
        .tool(
            "Grep",
            {"pattern": "waitFor|toBeVisible", "path": "e2e", "output_mode": "content"},
            "e2e/checkout.spec.ts:22:  await page.waitForTimeout(500);\n"
            "e2e/checkout.spec.ts:24:  await expect(total).toBeVisible();",
        )
        .assistant(
            "`waitForTimeout(500)` is the whole problem: on a loaded CI runner the total has not "
            "rendered in 500ms, and the assertion runs against an empty node. Waiting for the "
            "value rather than for the clock removes the flake and makes the test faster on the "
            "runs where it was already passing."
        )
        .save(store)
    )

    (
        Transcript(uid("s", "billing", "proration"), billing, "main", ago(24 * 7 + 3))
        .title("Proration on mid-cycle plan changes")
        .user("When someone upgrades mid-cycle we bill the full month. Bill the days they use.")
        .assistant("The arithmetic belongs beside the invoice lines. Adding it with its tests.")
        .tool(
            "Edit",
            {"file_path": "src/invoices.ts", "old_string": "export function renderInvoice", "new_string": "export function prorate"},
            "The file src/invoices.ts has been updated.",
        )
        .tool(
            "Bash",
            {"command": "pnpm test", "description": "Run the unit tests"},
            "✓ src/invoices.test.ts (2 tests) 18ms\n\nTest Files  1 passed (1)\n     Tests  2 passed (2)",
        )
        .assistant("Both ends of the cycle are covered: nothing on the last day, half for half a cycle.")
        .save(store)
    )

    (
        Transcript(uid("s", "docs", "install"), docs, "main", ago(26))
        .title("Write the install page for both platforms")
        .user("Write the install page. AppImage on Linux, dmg on macOS, and say what to do about Gatekeeper.")
        .assistant("Reading the release workflow so the page names the assets it actually publishes.")
        .tool(
            "Read",
            {"file_path": ".github/workflows/release.yml"},
            "     31\t          name: ${{ github.ref_name }}\n     44\t        with:\n     46\t          files: |",
        )
        .assistant(
            "Written. The page names the asset per platform, and the Gatekeeper step is one "
            "paragraph with the reason rather than a command to paste blindly."
        )
        .save(store)
    )

    (
        Transcript(uid("s", "docs", "anchors"), docs, "main", ago(24 * 4))
        .title("The guide's anchors break on every rename")
        .user("Half the links into the guide 404 after a heading is renamed. Can we stop that?")
        .assistant(
            "An anchor derived from the heading text changes with the heading. Pinning an "
            "explicit id per section decouples the two, and a link checker in CI turns the next "
            "one into a failed build rather than a report from a reader."
        )
        .save(store)
    )

    (
        Transcript(uid("s", "homelab", "proxy"), homelab, "main", ago(24 * 6 + 2))
        .title("Move Jellyfin behind the reverse proxy")
        .user("Put jellyfin behind caddy on media.home.arpa with a real certificate.")
        .tool(
            "Read",
            {"file_path": "compose.yml"},
            "     1\tservices:\n     2\t  proxy:\n     3\t    image: caddy:2",
        )
        .assistant(
            "Caddy is already the only thing with ports published, so this is one block in the "
            "Caddyfile and dropping Jellyfin's own port mapping."
        )
        .tool(
            "Bash",
            {"command": "docker compose config -q", "description": "Validate the compose file"},
            "",
        )
        .save(store)
    )

    (
        Transcript(uid("s", "homelab", "backup"), homelab, "main", ago(24 * 2 + 1))
        .title("The nightly backup keeps waking the NAS")
        .user("The snapshot job spins the disks up at 03:00 every night even when nothing changed.")
        .assistant(
            "The job snapshots unconditionally. Checking the change counter first means a quiet "
            "night costs one read instead of a spin-up."
        )
        .save(store)
    )

    (
        Transcript(uid("s", "recipes", "bread"), recipes, "main", ago(24 * 9))
        .title("Scale the sourdough to two loaves")
        .user("Double the sourdough recipe but keep the hydration at 70%.")
        .assistant(
            "1000g flour, 700g water, 200g starter, 20g salt. The bake time barely moves; the "
            "proof does, because a bigger mass holds its heat."
        )
        .save(store)
    )


# ── The workspace rows ──────────────────────────────────────────────────────


def seed(root: Path) -> None:
    # A debug build carries its own identifier (`dev.factorai-dev`), so the
    # directory differs between a `pnpm dev` window and a release one and the
    # fixture has to take whichever is there.
    candidates = sorted((root / ".data").glob("dev.factorai*/factorai.db"))
    if not candidates:
        sys.exit(
            f"no database under {root / '.data'}\n"
            "Boot the app once against the fixture first — the migrations create it:\n"
            '  eval "$(scripts/qa/fixture-workspace.py env)" && scripts/qa/launch.sh'
        )
    db_path = candidates[-1]

    world = [
        ("Pro", ["billing-api", "docs-site"]),
        ("Side projects", ["homelab", "recipes"]),
    ]

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    with conn:
        conn.execute("DELETE FROM sidebar_rows")
        conn.execute("DELETE FROM projects")

        order = 0
        for group_name, members in world:
            group_id = uid("group", group_name)
            conn.execute(
                "INSERT INTO sidebar_rows(id, kind, parent_id, sort_order, project_id, name) "
                "VALUES (?, 'group', NULL, ?, NULL, ?)",
                (group_id, order, group_name),
            )
            order += 1
            for inner, name in enumerate(members):
                path = str(root / name)
                pid = uid("project", name)
                conn.execute(
                    "INSERT INTO projects(id, real_path, display_name, missing, opened_at) "
                    "VALUES (?, ?, ?, 0, ?)",
                    (pid, path, name, int(ago(24 * 30).timestamp() * 1000)),
                )
                conn.execute(
                    "INSERT INTO sidebar_rows(id, kind, parent_id, sort_order, project_id, name) "
                    "VALUES (?, 'project', ?, ?, ?, NULL)",
                    (uid("row", name), group_id, inner, pid),
                )
                # The discovery the scan already wrote is linked to the project
                # it describes; that link is what gates indexing (migration
                # 0004), so without it the sessions stay invisible.
                conn.execute(
                    "UPDATE discovered_projects SET project_id = ? WHERE real_path = ?",
                    (pid, path),
                )

        # One routine, so the Routines surface has something to be a picture of.
        conn.execute("DELETE FROM routines")
        conn.execute(
            "INSERT INTO routines(id, project_id, name, cron, prompt, enabled, catchup_hours, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, 6, ?)",
            (
                uid("routine", "deps"),
                uid("project", "billing-api"),
                "Nightly dependency check",
                "0 2 * * *",
                "Check for dependency updates, run the tests against them, and open a summary of "
                "anything that broke.",
                int(ago(24 * 10).timestamp() * 1000),
            ),
        )

    linked = conn.execute(
        "SELECT COUNT(*) FROM discovered_projects WHERE project_id IS NOT NULL"
    ).fetchone()[0]
    conn.close()

    print(f"seeded {db_path}")
    print(f"  4 projects in 2 groups, {linked} discovered directories linked, 1 routine")
    print("Relaunch the app: the indexer parses a project's transcripts once it is in the workspace.")


def build(root: Path, force: bool) -> None:
    if root.exists() and any(root.iterdir()):
        if not force:
            sys.exit(f"{root} is not empty — pass --force to delete and rebuild it")
        shutil.rmtree(root)

    root.mkdir(parents=True, exist_ok=True)
    build_billing(root)
    build_docs(root)
    build_homelab(root)
    build_recipes(root)

    store = root / ".claude"
    (store / "projects").mkdir(parents=True, exist_ok=True)
    # A store with no settings file is a store Claude has never run in, and the
    # app's profile seeding reads this directory at boot.
    (store / "settings.json").write_text('{\n  "includeCoAuthoredBy": false\n}\n', encoding="utf-8")
    transcripts(root, store)

    (root / ".data").mkdir(parents=True, exist_ok=True)

    sessions = len(list((store / "projects").glob("*/*.jsonl")))
    print(f"built {root}")
    print(f"  4 repositories, {sessions} sessions, store at {store}")
    print('Next: eval "$(scripts/qa/fixture-workspace.py env)" && scripts/qa/launch.sh')


def env(root: Path) -> None:
    print(f"export CLAUDE_CONFIG_DIR={root / '.claude'}")
    print(f"export XDG_DATA_HOME={root / '.data'}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["build", "seed", "env"])
    ap.add_argument("--root", type=Path, default=DEFAULT_ROOT, help=f"default: {DEFAULT_ROOT}")
    ap.add_argument("--force", action="store_true", help="build: delete an existing root first")
    args = ap.parse_args()

    root = args.root.expanduser().resolve()
    if args.command == "build":
        build(root, args.force)
    elif args.command == "seed":
        seed(root)
    else:
        env(root)


if __name__ == "__main__":
    main()
