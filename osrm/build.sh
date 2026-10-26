#!/usr/bin/env bash
# Builds the Gwalior OSRM dataset (MLD, car profile) into osrm/data/.
# Needs: docker, curl. Run from anywhere: bash osrm/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="$HERE/data"
BBOX="78.05,26.12,78.32,26.32"   # CLAUDE.md §7
SRC_URL="https://download.geofabrik.de/asia/india/central-zone-latest.osm.pbf"
OSRM_IMG="ghcr.io/project-osrm/osrm-backend:latest"
OSMIUM_IMG="iboates/osmium:latest"

mkdir -p "$DATA"
cd "$DATA"

if [ ! -f central-zone.osm.pbf ]; then
  curl -L --fail -o central-zone.osm.pbf "$SRC_URL"
fi

if [ ! -f gwalior.osm.pbf ]; then
  MSYS_NO_PATHCONV=1 docker run --rm -v "$DATA:/data" "$OSMIUM_IMG" \
    extract --bbox "$BBOX" --strategy complete_ways \
    /data/central-zone.osm.pbf -o /data/gwalior.osm.pbf --overwrite
fi

MSYS_NO_PATHCONV=1 docker run --rm -v "$DATA:/data" "$OSRM_IMG" osrm-extract -p /opt/car.lua /data/gwalior.osm.pbf
MSYS_NO_PATHCONV=1 docker run --rm -v "$DATA:/data" "$OSRM_IMG" osrm-partition /data/gwalior.osrm
MSYS_NO_PATHCONV=1 docker run --rm -v "$DATA:/data" "$OSRM_IMG" osrm-customize /data/gwalior.osrm

echo "Done. Start with: docker compose up osrm"
