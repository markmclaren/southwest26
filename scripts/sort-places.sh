#!/usr/bin/env bash
set -euo pipefail

# Sort GeoJSON features by date, then title.
# Undated entries are pushed to the end.
INPUT_FILE="${1:-places.geojson}"
TMP_FILE="${INPUT_FILE}.tmp"

jq '.features |= sort_by((.properties.date // "9999-12-31"), (.properties.title // ""))' "$INPUT_FILE" > "$TMP_FILE"
mv "$TMP_FILE" "$INPUT_FILE"

echo "Sorted $INPUT_FILE by date, then title."
