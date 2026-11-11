#!/usr/bin/env bash
# Fails when the repository tracks files that must never be committed:
# learning content, media, archives, database dumps, env files, oversized
# files, and test data outside deploy/seed/.
#
# Why: the code is public and learning content is not. A textbook page or a
# recording cannot be removed from git history once it is pushed.
set -euo pipefail

max_bytes="${MAX_FILE_BYTES:-1048576}"
status=0

fail() {
  echo "forbidden-files: $1: $2"
  status=1
}

while IFS= read -r -d '' path; do
  # A file deleted in the working tree is still listed until it is staged.
  [ -f "$path" ] || continue

  lower="$(printf '%s' "$path" | tr '[:upper:]' '[:lower:]')"
  base="${lower##*/}"

  case "$base" in
    .env.example) ;;
    .env | .env.*) fail "$path" "env files are never committed" ;;
  esac

  case "$lower" in
    *.pdf | *.epub | *.djvu | *.doc | *.docx | *.ppt | *.pptx | *.xls | *.xlsx)
      fail "$path" "documents are learning content; upload them to the platform instead"
      ;;
    *.mp3 | *.wav | *.m4a | *.ogg | *.flac | *.aac | *.mp4 | *.mov | *.avi | *.mkv | *.webm)
      fail "$path" "audio and video are learning content; upload them to the platform instead"
      ;;
    *.zip | *.tar | *.gz | *.tgz | *.7z | *.rar)
      fail "$path" "archives hide their contents from review"
      ;;
    *.dump | *.sqlite | *.sqlite3 | *.db)
      fail "$path" "database dumps may contain personal data"
      ;;
  esac

  case "/$lower" in
    /deploy/seed/*) ;;
    */fixtures/* | */__fixtures__/* | */testdata/* | */seed/*)
      fail "$path" "test data lives only in deploy/seed/"
      ;;
  esac

  # The lockfile is generated and legitimately large.
  if [ "$base" != "package-lock.json" ]; then
    size="$(wc -c <"$path" | tr -d ' ')"
    if [ "$size" -gt "$max_bytes" ]; then
      fail "$path" "larger than $max_bytes bytes"
    fi
  fi
done < <(git ls-files -z)

exit "$status"
