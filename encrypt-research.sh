#!/usr/bin/env bash
# Encrypts all files in docs/research/ using AES-256-CBC.
# Encrypted files are saved alongside the originals with a .enc extension.
# Verifies the entered password matches the hash stored in .research.hash.
# Intended to be called from the pre-commit hook.

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
RESEARCH_DIR="$REPO_ROOT/docs/research"

if [ ! -d "$RESEARCH_DIR" ]; then
  echo "encrypt-research: research dir not found, skipping."
  exit 0
fi

# Collect plaintext files (exclude already-encrypted .enc files)
FILES=()
while IFS= read -r -d '' f; do
  FILES+=("$f")
done < <(find "$RESEARCH_DIR" -type f ! -name "*.enc" -print0)

if [ ${#FILES[@]} -eq 0 ]; then
  exit 0
fi

# Verify hash file exists
HASH_FILE="$REPO_ROOT/.research.hash"
if [ ! -f "$HASH_FILE" ]; then
  echo "ERROR: No password hash found. Run ./scripts/setup-encryption.sh first." >&2
  exit 1
fi
STORED_HASH="$(cat "$HASH_FILE")"

# Prompt for password (stderr so it doesn't pollute stdout)
echo "🔒 Encrypting files in docs/research/ ..." >&2
read -rsp "Enter encryption password: " PASSWORD </dev/tty
echo >&2

if [ -z "$PASSWORD" ]; then
  echo "ERROR: Password cannot be empty. Aborting commit." >&2
  exit 1
fi

# Verify password matches stored hash
ENTERED_HASH="$(printf '%s' "$PASSWORD" | shasum -a 256 | awk '{print $1}')"
if [ "$ENTERED_HASH" != "$STORED_HASH" ]; then
  echo "ERROR: Incorrect password. Aborting commit." >&2
  exit 1
fi

for FILE in "${FILES[@]}"; do
  ENC_FILE="${FILE}.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 100000 \
    -in "$FILE" -out "$ENC_FILE" -pass "pass:$PASSWORD"
  git add "$ENC_FILE"
  echo "  encrypted: ${FILE#$REPO_ROOT/}" >&2
done

echo "✅ Encryption complete." >&2
