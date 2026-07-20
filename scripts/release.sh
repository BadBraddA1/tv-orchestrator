#!/usr/bin/env bash
# Tag and push a release for fleet pinning (REPO_REF=vX.Y.Z).
# Usage: ./scripts/release.sh 1.1.0
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VER="${1:-}"
if [[ -z "$VER" ]]; then
  VER="$(node -p "require('./package.json').version")"
fi
TAG="v${VER#v}"
echo "==> Releasing $TAG"
git status -sb
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: working tree dirty — commit first" >&2
  exit 1
fi
git tag -a "$TAG" -m "Orca $TAG"
git push origin HEAD
git push origin "$TAG"
echo "Install:"
echo "  curl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/${TAG}/install.sh | REPO_REF=${TAG} bash"
