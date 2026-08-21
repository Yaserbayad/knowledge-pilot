#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

DEPLOY_REPO="/opt/knowledgepilot-deploy"
TARGET="/usr/local/sbin/deploy-knowledge-pilot"
LOCK_FILE="/run/lock/knowledgepilot-deployer-install.lock"
REPOSITORY_SLUG="Yaserbayad/knowledge-pilot"
INSTALL_TEST_MODE=0

configure_installer_paths() {
  if [[ "${KNOWLEDGE_PILOT_INSTALLER_TEST_MODE:-0}" == "1" ]]; then
    : "${KP_INSTALL_TEST_ROOT:?KP_INSTALL_TEST_ROOT is required in installer test mode}"
    local resolved
    resolved="$(readlink -m "$KP_INSTALL_TEST_ROOT")"
    case "$resolved" in
      /tmp/*|/var/tmp/*) ;;
      *) printf 'Unsafe installer test root\n' >&2; return 1 ;;
    esac
    INSTALL_TEST_MODE=1
    DEPLOY_REPO="$resolved/deploy-repo"
    TARGET="$resolved/usr/local/sbin/deploy-knowledge-pilot"
    LOCK_FILE="$resolved/install.lock"
    TEST_NPMRC="$resolved/npmrc"
  fi
}

usage() {
  printf 'Usage: sudo bash install-deployer.sh <40-character-engine-source-commit-sha>\n'
}

sanitize_npm_config_file() (
  set -Eeuo pipefail
  local file="$1"
  [[ -f "$file" ]] || return 0
  local tmp removed mode uid gid
  tmp="$(mktemp)"
  removed="$(mktemp)"
  # The source npm config can contain secrets. Keep temporary copies private
  # and guarantee their deletion even if rewriting the config fails.
  trap 'rm -f "$tmp" "$removed"' EXIT
  awk -F= -v removed="$removed" '
    {
      key=$1
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      if (key == "APP_SECRET" || key == "--init.module" || key == "init.module") {
        print key >> removed
        next
      }
      print
    }
  ' "$file" > "$tmp"
  if [[ -s "$removed" ]]; then
    mode="$(stat -c '%a' "$file")"
    uid="$(stat -c '%u' "$file")"
    gid="$(stat -c '%g' "$file")"
    if [[ "$EUID" == "0" ]]; then
      install -o "$uid" -g "$gid" -m "$mode" "$tmp" "$file"
    else
      # Non-root operation is available only to the /tmp-confined disposable
      # test path; production installation itself remains root-only.
      install -m "$mode" "$tmp" "$file"
    fi
    while IFS= read -r key; do
      printf 'NPM_CONFIG_CLEANUP=REMOVED PATH=%s KEY=%s\n' "$file" "$key"
    done < <(sort -u "$removed")
  fi
)

cleanup_stale_npm_config() {
  if (( INSTALL_TEST_MODE == 1 )); then
    sanitize_npm_config_file "$TEST_NPMRC"
    return
  fi
  command -v npm >/dev/null 2>&1 || return 0
  local user_config global_config file
  user_config="$(npm config get userconfig 2>/dev/null || true)"
  global_config="$(npm config get globalconfig 2>/dev/null || true)"
  declare -A seen=()
  for file in "$user_config" "$global_config" "/root/.npmrc" "/etc/npmrc"; do
    [[ -n "$file" && -z "${seen[$file]:-}" ]] || continue
    seen[$file]=1
    sanitize_npm_config_file "$file"
  done
}

verify_deploy_repo_origin() {
  local origin
  origin="$(git -C "$DEPLOY_REPO" remote get-url origin 2>/dev/null)" || return 1
  (( INSTALL_TEST_MODE == 1 )) && return 0
  case "$origin" in
    git@github.com:${REPOSITORY_SLUG}|git@github.com:${REPOSITORY_SLUG}.git|ssh://git@github.com/${REPOSITORY_SLUG}|ssh://git@github.com/${REPOSITORY_SLUG}.git) return 0 ;;
    *) return 1 ;;
  esac
}

main() {
  configure_installer_paths || return 1
  if (( INSTALL_TEST_MODE == 0 )); then
    [[ "$EUID" == "0" ]] || { printf 'Installer must run as root.\n' >&2; return 1; }
  fi
  [[ "$#" == "1" && "$1" =~ ^[0-9a-f]{40}$ ]] || { usage >&2; return 2; }
  local source_sha="$1" tmp installed_hash source_hash
  for command in git bash install sha256sum flock stat awk sort mktemp mv mkdir dirname readlink; do
    command -v "$command" >/dev/null 2>&1 || { printf 'Missing required command: %s\n' "$command" >&2; return 1; }
  done
  [[ -d "$DEPLOY_REPO/.git" ]] || { printf 'Deployment repository is missing.\n' >&2; return 1; }
  verify_deploy_repo_origin || { printf 'Deployment repository origin is not the Knowledge Pilot SSH repository.\n' >&2; return 1; }

  mkdir -p "$(dirname "$LOCK_FILE")"
  exec 9>"$LOCK_FILE"
  flock -n 9 || { printf 'Another deployer installation is active.\n' >&2; return 1; }

  git -C "$DEPLOY_REPO" fetch --prune origin >/dev/null
  [[ "$(git -C "$DEPLOY_REPO" cat-file -t "$source_sha" 2>/dev/null)" == "commit" ]] || { printf 'Engine source commit is unavailable.\n' >&2; return 1; }
  git -C "$DEPLOY_REPO" merge-base --is-ancestor "$source_sha" refs/remotes/origin/main || { printf 'Engine source commit is not on origin/main.\n' >&2; return 1; }

  tmp="$(mktemp)"
  trap 'rm -f "${tmp:-}" "${TARGET:-}.new"' EXIT
  (cd "$DEPLOY_REPO" && git show "$source_sha:scripts/deploy-release.sh") > "$tmp"
  bash -n "$tmp"
  bash "$tmp" --self-test

  cleanup_stale_npm_config

  mkdir -p "$(dirname "$TARGET")"
  if (( INSTALL_TEST_MODE == 1 )); then
    install -m 0755 "$tmp" "$TARGET.new"
  else
    install -o root -g root -m 0755 "$tmp" "$TARGET.new"
  fi
  mv -f "$TARGET.new" "$TARGET"
  source_hash="$(sha256sum "$tmp" | awk '{print $1}')"
  installed_hash="$(sha256sum "$TARGET" | awk '{print $1}')"
  [[ "$installed_hash" == "$source_hash" ]] || { printf 'Installed deployer hash mismatch.\n' >&2; return 1; }
  if (( INSTALL_TEST_MODE == 1 )); then
    [[ "$(stat -c '%a' "$TARGET")" == "755" ]] || { printf 'Installed deployer permissions are invalid.\n' >&2; return 1; }
  else
    [[ "$(stat -c '%U:%G:%a' "$TARGET")" == "root:root:755" ]] || { printf 'Installed deployer permissions are invalid.\n' >&2; return 1; }
  fi
  "$TARGET" --self-test >/dev/null

  printf 'INSTALL=PASS\n'
  printf 'COMMAND=%s\n' "$TARGET"
  printf 'SOURCE_SHA=%s\n' "$source_sha"
}

if [[ "${KP_DEPLOY_INSTALLER_LIBRARY_ONLY:-0}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

main "$@"
