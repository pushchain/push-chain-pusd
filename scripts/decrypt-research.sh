#!/usr/bin/env bash
# Decrypts all .enc files in docs/research/ back to plaintext.
# Verifies the entered password matches the hash stored in .research.hash.

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
RESEARCH_DIR="$REPO_ROOT/docs/research"

if [ ! -d "$RESEARCH_DIR" ]; then
  echo "decrypt-research: research dir not found." >&2
  exit 1
fi

ENC_FILES=()
while IFS= read -r -d '' f; do
  ENC_FILES+=("$f")
done < <(find "$RESEARCH_DIR" -type f -name "*.enc" -print0)

if [ ${#ENC_FILES[@]} -eq 0 ]; then
  echo "No encrypted files found in docs/research/." >&2
  exit 0
fi

# Verify hash file exists
HASH_FILE="$REPO_ROOT/.research.hash"
if [ ! -f "$HASH_FILE" ]; then
  echo "ERROR: No password hash found. Run ./scripts/setup-encryption.sh first." >&2
  exit 1
fi
STORED_HASH="$(cat "$HASH_FILE")"

read -rsp "Enter decryption password: " PASSWORD </dev/tty
echo

if [ -z "$PASSWORD" ]; then
  echo "ERROR: Password cannot be empty." >&2
  exit 1
fi

# Verify password matches stored hash
ENTERED_HASH="$(printf '%s' "$PASSWORD" | shasum -a 256 | awk '{print $1}')"
if [ "$ENTERED_HASH" != "$STORED_HASH" ]; then
  echo "ERROR: Incorrect password." >&2
  exit 1
fi

for ENC_FILE in "${ENC_FILES[@]}"; do
  OUT_FILE="${ENC_FILE%.enc}"
  if openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
      -in "$ENC_FILE" -out "$OUT_FILE" -pass "pass:$PASSWORD" 2>/dev/null; then
    echo "  decrypted: ${OUT_FILE#$REPO_ROOT/}"
  else
    echo "ERROR: Failed to decrypt ${ENC_FILE#$REPO_ROOT/} — wrong password or corrupted file." >&2
    rm -f "$OUT_FILE"
    exit 1
  fi
done

echo "✅ Decryption complete."
