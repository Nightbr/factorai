# Security

factorai runs coding agents with access to your shell, your files and your
credentials, so a vulnerability in it can matter more than its size suggests.

## Reporting a vulnerability

**Do not open a public issue.** Report it privately through GitHub:
[Security → Report a vulnerability](https://github.com/Nightbr/factorai/security/advisories/new).

Please include the version (Settings → About), the platform, and the steps
that reproduce it.

factorai is a community-driven project maintained on volunteer time, so there
is no guaranteed response time. You should usually hear back within a week or
so. A fix ships as an alpha first and is then promoted to stable, and the
advisory is published once the stable release is out.

## Supported versions

Only the latest stable release and the current alpha get fixes. There are no
release branches: a fix goes forward, never back.

## Scope

In scope: the desktop app, its release pipeline and its updater. The agents
factorai launches (Claude Code, Codex) are their vendors' to fix. If a bug is
theirs but factorai makes it worse, report it here as well.
