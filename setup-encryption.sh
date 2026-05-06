#!/usr/bin/env bash
# One-time setup: sets the canonical encryption password by storing its SHA-256 hash.
# Run this once as the owner. Others must know the same password to encrypt/decrypt.
#
# Usage: ./scripts/setup-encryption.sh

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
HASH_FILE="$REPO_ROOT/.research.hash"

if [ -f "$HASH_FILE" ]; then
  echo "ERROR: Password is already set. The hash file already exists at .research.hash." >&2
  echo "If you need to reset it, delete .research.hash manually first." >&2
  exit 1
fi

read -rsp "Set encryption password: " PASSWORD </dev/tty
echo >&2
read -rsp "Confirm password: " PASSWORD2 </dev/tty
echo >&2

if [ "$PASSWORD" != "$PASSWORD2" ]; then
  echo "ERROR: Passwords do not match." >&2
  exit 1
fi

if [ -z "$PASSWORD" ]; then
  echo "ERROR: Password cannot be empty." >&2
  exit 1
fi

# Store SHA-256 hash of the password (not the password itself)
printf '%s' "$PASSWORD" | shasum -a 256 | awk '{print $1}' > "$HASH_FILE"

echo "✅ Password hash saved to .research.hash (gitignored)."
echo "   Share the password securely with collaborators — never commit it."
