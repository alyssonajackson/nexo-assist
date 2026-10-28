#!/usr/bin/env bash
# Scans the working tree and git history for leaked secrets with gitleaks (Docker, no install needed).
# Run before every push: pnpm secrets:scan
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git --redact --verbose .
  gitleaks dir --redact .
else
  docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:latest git --redact --verbose /repo
  docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:latest dir --redact /repo
fi
