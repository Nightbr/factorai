#!/usr/bin/env bash
# Print one line per file-link case into whatever terminal runs this
# (`specs/05-features.md` § F19).
#
# Usage:  bash scripts/qa/f19-links.sh
#
# Run it in a **footer shell pane** and again in the **agent's terminal**: F19
# is one provider over both surfaces and the bases underneath are what differ,
# so a case that behaves differently between them is the bug worth catching.
# Ctrl/Cmd-click the sample line under each heading; nothing else on screen
# should become a link.
#
# Every path is derived from the terminal's own cwd rather than hardcoded, so
# the positives really exist wherever it is run — including in a project that
# is not this repository, which is the point: a link that only works here is
# not the feature.
#
# The one script in this directory that needs no X11: it drives nothing and
# only prints, so it is the same on macOS and Linux. What it verifies is the
# half the smoke lane cannot — `path_kinds` against a real disk, from a real
# shell, in a real PTY.

set -u

cwd=$(pwd)
b=$'\033[1m'
d=$'\033[90m'
g=$'\033[32m'
r=$'\033[31m'
z=$'\033[0m'

case_() { printf '\n%s%s%s %s%s%s\n' "$b" "$1" "$z" "$2" "$3" "$z"; }
yes_() { case_ "$1" "$g" "SHOULD link"; }
no_() { case_ "$1" "$r" "should NOT link"; }

# A real nested source file, a real root-level file, a real directory — picked
# off disk rather than hardcoded, so this works in any project you open.
# `nested` keeps its separator on purpose: a relative path with one is a
# different branch of the grammar from a bare filename (case 3).
nested=$(find . -mindepth 2 -maxdepth 4 -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.rs' -o -name '*.md' \) \
	-not -path './node_modules/*' -not -path './.git/*' -not -path './target/*' 2>/dev/null |
	sed 's|^\./||' | head -1)
deep=$(find . -maxdepth 8 -type f -name '*.ts*' -not -path './node_modules/*' -not -path './.git/*' 2>/dev/null |
	sed 's|^\./||' | awk '{ print length"\t"$0 }' | sort -rn | head -1 | cut -f2)
root=$(ls -p | grep -v / | head -1)
dir=$(ls -p | grep / | head -1 | sed 's|/$||')

printf '%s— F19 file links, cwd %s —%s\n' "$d" "$cwd" "$z"

yes_ "1. compiler-shaped path:line:col (rustc, tsc --pretty)"
echo "error[E0308]: mismatched types at ${nested}:12:7"

yes_ "2. cargo-shaped path:line — opens at the line, no column"
echo "warning: unused variable at ${nested}:3"

yes_ "3. bare filename, no separator at all"
echo "Checked ${root} and moved on"

yes_ "4. absolute path"
echo "wrote ${cwd}/${nested}"

yes_ "5. terraform-shaped — the FILE links, the 'line 42' does not (prose)"
echo "Error: Invalid resource type"
echo "  on ${nested} line 42, in resource \"aws_instance\" \"web\":"

yes_ "6. a directory reveals in the tree instead of opening an editor"
echo "entering ${dir}/"

yes_ "7. a long path a narrow pane wraps — drag the pane narrow first, then hover"
echo "${deep}"

yes_ "8. \$HOME expanded, if you have one of these"
echo "read ~/.claude/settings.json"

no_ "9. a path that is not on disk"
echo "error: cannot find src/definitely-not-here.ts:12:1"

no_ "10. version strings, which is what the extension rule is for"
echo "claude 2.1.235 / node v22.14.0 / 1.2.3"

no_ "11. a directory outside the project — real, and the tree cannot show it"
echo "ls ~/.claude/projects/"

no_ "12. a path with a space in it, F19's one stated limit"
echo "open '${cwd}/not a real file.ts'"

no_ "13. bare words with no extension and no separator"
echo "run the test suite in release mode"

case_ "14. a URL — F5's link, not this one: modifier-click opens the browser" "$d" "(WebLinksAddon)"
echo "https://example.com/src/index.ts"

# The `cd` case, as a command to paste rather than one this script can run: a
# `cd` in here moves nothing in the shell you are looking at.
head=${nested%%/*}
rest=${nested#*/}
printf '\n%s15. the accepted limit — paste this, then hover what it prints:%s\n' "$b" "$z"
printf '%s   cd %s && echo %s && cd - >/dev/null%s\n' "$d" "$head" "$rest" "$z"
printf '%s   It does not link, and that is the point: the pane reports its SPAWN%s\n' "$d" "$z"
printf '%s   cwd, and reading the live one means OSC 7 in your shell init, which%s\n' "$d" "$z"
printf '%s   this app will not write (F19, "A cd inside a pane"). Anything printed%s\n' "$d" "$z"
printf '%s   relative to the project root still links, which is most of what%s\n' "$d" "$z"
printf '%s   cargo, tsc and terraform actually print.%s\n' "$d" "$z"

printf '\n%sAlso worth a click: close the file with Esc or the tab x — the caret goes%s\n' "$d" "$z"
printf '%sback to the pane you clicked from, not to the agent and not to nowhere.%s\n' "$d" "$z"
