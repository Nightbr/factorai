---
name: app-screenshot
description: Capture a factorai screenshot for README.md, docs/ or a release note — correct size, no DEV badge, private project names blurred. Use when asked to add, retake or update a screenshot of the app in documentation.
---

# Taking a screenshot of factorai for documentation

Four things go wrong every time, and three of them are invisible until someone
else opens the README:

1. **The DEV badge.** Documentation images come from a dev build — a release build
   has no `~/.claude` history worth photographing — so the violet `DEV` chip
   appears in the shot while being absent from the product a reader downloads.
2. **Private names.** The window is full of the author's real work: client and
   employer project names in the sidebar, `~/` paths, session titles naming both.
   Committing those publishes them permanently; a later edit does not remove them
   from the git history.
3. **The size.** Every image in `docs/images/` is 1440×900 of the client area. One
   that is a different size, or that carries the window frame and the
   compositor's drop shadow, reads as a mistake.
4. **Resampling.** The app is 12px and 14px type throughout. Scaling a capture
   down turns it to mush, and the sidebar is the first thing to go.

## The loop

**Launch with the flag.** `VITE_FACTORAI_SCREENSHOT=1` is the supported way to
suppress the badge — it is read by `DevBadge.tsx` and passed through
`turbo.json`'s `globalPassThroughEnv`. Nothing else changes; the window *title*
still says DEV, which is what actually keeps a dev window distinguishable in the
switcher.

```bash
scripts/qa/kill.sh                                   # if one is already running
VITE_FACTORAI_SCREENSHOT=1 scripts/qa/launch.sh
```

**Set the app up before capturing, and prefer framing over blurring.** A shot
with no project selected leaks nothing from the main pane. Group names you chose
("Pro", "Side projects") are the point of a sidebar picture and stay legible. Ask
what the image is *for* and show only that.

**Capture.**

```bash
scripts/qa/doc-shot.sh docs/images/factorai-<subject>.png
```

It resizes the window so the client area is exactly 1440×900, crops the frame and
shadow off by the measured offset, and refuses rather than resampling if the WM
declined the resize.

**Find the regions to blur, then blur them.** Read the coordinates off the image
instead of guessing:

```bash
scripts/qa/redact.py docs/images/factorai-<subject>.png --probe   # grid overlay
scripts/qa/redact.py in.png out.png 60,170,130,26 60,208,130,26
```

Blur every real project name **except `factorai` itself**, the home path, and any
session title naming a real project. Leave the chrome, the group names and the
app's own name — those are what the picture is for. Delete the `-probe.png` when
done.

**Look at the result** before committing it. Read it as a stranger: is anything
identifiable still legible, and does the image still show the thing the section
is about?

## Referencing it

Match the existing style in `README.md` — one image per section, alt text that
says what the picture shows rather than repeating the heading:

```markdown
![The sidebar with projects grouped into Pro, Side projects and Perso](docs/images/factorai-sidebar.png)
```

## If the resize is refused

`doc-shot.sh` exits rather than guess. The window is tiled, maximised, or the WM
is honouring a size hint — un-maximise it and run again. These scripts are X11 +
GNOME only, like the rest of `scripts/qa/` (see its README).
