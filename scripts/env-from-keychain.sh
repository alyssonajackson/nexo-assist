#!/usr/bin/env bash
# Loads secrets from the macOS Keychain into the current shell, so they never live in a file.
#
# Store once (prompts for the value, nothing ends up in shell history):
#   security add-generic-password -a "$USER" -s nexo-assist/GOOGLE_GENERATIVE_AI_API_KEY -w
#
# Then, per shell:
#   source scripts/env-from-keychain.sh
#   docker compose up --build        # compose passes the LLM keys through to the web container
#
# Alternative (deploy, or no Keychain): put the key in the gitignored .env instead.
#
# On Linux/CI, export the variable from your secret manager instead.

if [ -n "${BASH_SOURCE[0]:-}" ] && [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo "Run with 'source', otherwise the variables do not reach your shell." >&2
  exit 1
fi

# GOOGLE_GENERATIVE_AI_API_KEY is required by the default model; ANTHROPIC_API_KEY only if LLM_MODEL=anthropic/...
for name in GOOGLE_GENERATIVE_AI_API_KEY ANTHROPIC_API_KEY; do
  if value=$(security find-generic-password -a "$USER" -s "nexo-assist/$name" -w 2>/dev/null); then
    export "$name=$value"
    echo "loaded $name from Keychain"
  elif [ "$name" = GOOGLE_GENERATIVE_AI_API_KEY ]; then
    echo "missing $name in Keychain (see the comment at the top of this script)" >&2
  fi
done
