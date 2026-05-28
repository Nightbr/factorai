#!/usr/bin/env bash
# Print the factorai content window geometry as `WIDTH HEIGHT X Y`
# (space-separated). Lets a caller translate "click 30% down" into pixel
# coords without hardcoding screen size.
#
# Usage:  scripts/qa/geometry.sh

set -euo pipefail

read -r _ _ X Y WIDTH HEIGHT < <("$(dirname "$0")/_resolve_wid.sh")
echo "$WIDTH $HEIGHT $X $Y"
