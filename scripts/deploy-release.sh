#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ENGINE_COMPATIBILITY="1"
REPOSITORY_SLUG="Yaserbayad/knowledge-pilot"
RUNTIME_USER="www"
RUNTIME_GROUP="www"
PORT="3100"
WORKSPACE_TIMER="knowledgepilot-agent-trigger.timer"
WORKSPACE_MCP_SERVICE="knowledgepilot-mcp.service"

PHASE="INIT"
FAILURE_REASON="deployment failed"
CUTOVER_STARTED=0
ROLLBACK_READY=0
ROLLBACK_IN_PROGRESS=0
AUTOMATION_PAUSED=0
TIMER_WAS_ACTIVE="inactive"
TIMER_WAS_ENABLED="disabled"
AAPANEL_PID_FILE=""
AAPANEL_START_SCRIPT=""
CURRENT_PID=""
RELEASE_TAG=""
EXPECTED_SHA=""
RELEASE_VERSION=""
ROLLBACK_VERSION=""
TEST_MODE=0

validate_release_args() {
  local tag="${1:-}" sha="${2:-}"
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || return 1
}

is_safe_env_mode() {
  [[ "${1:-}" == "600" ]]
}

canonical_public_key() {
  local line="${1:-}"
  awk 'NF >= 2 { print $1 " " $2; found=1; exit } END { if (!found) exit 1 }' <<<"$line"
}

phase() {
  PHASE="$1"
  printf 'PHASE=%s\n' "$PHASE"
}

fail() {
  FAILURE_REASON="$1"
  return 1
}

configure_paths() {
  if [[ "${KNOWLEDGE_PILOT_DEPLOY_TEST_MODE:-0}" == "1" ]]; then
    TEST_MODE=1
    : "${KP_TEST_ROOT:?KP_TEST_ROOT is required in test mode}"
    local resolved
    resolved="$(readlink -m "$KP_TEST_ROOT")"
    case "$resolved" in
      /tmp/*|/var/tmp/*) ;;
      *) printf 'Unsafe test root\n' >&2; return 1 ;;
    esac
    LIVE="$resolved/live"
    STAGE="$resolved/stage"
    ROLLBACK="$resolved/rollback"
    DEPLOY_REPO="$resolved/deploy-repo"
    LOCK_FILE="$resolved/deploy.lock"
    PROC_ROOT="$resolved/proc"
    AAPANEL_PID_DIR="$resolved/aapanel/pids"
    AAPANEL_SCRIPT_DIR="$resolved/aapanel/scripts"
    RUNTIME_UID="1000"
    RUNTIME_GID="1000"
  else
    LIVE="/www/wwwroot/knowledgepilot"
    STAGE="/www/wwwroot/knowledgepilot.stage"
    ROLLBACK="/www/wwwroot/knowledgepilot.rollback"
    DEPLOY_REPO="/opt/knowledgepilot-deploy"
    LOCK_FILE="/run/lock/knowledgepilot-deploy.lock"
    PROC_ROOT="/proc"
    AAPANEL_PID_DIR="/www/server/nodejs/vhost/pids"
    AAPANEL_SCRIPT_DIR="/www/server/nodejs/vhost/scripts"
    RUNTIME_UID="$(id -u "$RUNTIME_USER")" || return 1
    RUNTIME_GID="$(id -g "$RUNTIME_USER")" || return 1
  fi
}

require_commands() {
  local command
  for command in bash flock git tar rsync stat ss runuser node npm curl awk sed grep readlink find chown chmod df du seq sort cut basename head install mktemp; do
    command -v "$command" >/dev/null 2>&1 || { printf 'Missing required command: %s\n' "$command" >&2; return 1; }
  done
}

listener_snapshot() {
  ss -H -ltnp "sport = :$PORT" 2>/dev/null || true
}

get_listener_pid() {
  local snapshot lines local_count pids unique
  snapshot="$(listener_snapshot)"
  lines="$(printf '%s\n' "$snapshot" | grep -c '.' || true)"
  [[ "$lines" == "1" ]] || return 1
  local_count="$(printf '%s\n' "$snapshot" | grep -Ec "[[:space:]]127\\.0\\.0\\.1:${PORT}[[:space:]]" || true)"
  [[ "$local_count" == "1" ]] || return 1
  pids="$(printf '%s\n' "$snapshot" | grep -oE 'pid=[0-9]+' | cut -d= -f2 || true)"
  unique="$(printf '%s\n' "$pids" | sed '/^$/d' | sort -u)"
  [[ "$(printf '%s\n' "$unique" | grep -c '.' || true)" == "1" ]] || return 1
  printf '%s\n' "$unique"
}

port_is_clear() {
  [[ -z "$(listener_snapshot | sed '/^[[:space:]]*$/d')" ]]
}

wait_for_port_clear() {
  local i
  for i in $(seq 1 30); do
    port_is_clear && return 0
    sleep 1
  done
  return 1
}

wait_for_listener() {
  local i
  for i in $(seq 1 30); do
    if get_listener_pid >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

verify_process_identity() {
  local pid="$1"
  local process_root="$PROC_ROOT/$pid" # /proc/<pid> in production
  [[ -d "$process_root" ]] || return 1
  local cwd
  cwd="$(readlink -f "$process_root/cwd")" || return 1
  [[ "$cwd" == "$LIVE" ]] || return 1

  local -a argv=()
  mapfile -d '' -t argv < "$process_root/cmdline" || true
  [[ "${#argv[@]}" -ge 2 ]] || return 1
  [[ "${argv[0]##*/}" == "node" ]] || return 1
  [[ "${argv[1]}" == "src/index.js" ]] || return 1

  local uid gid
  uid="$(awk '/^Uid:/ {print $2; exit}' "$process_root/status")"
  gid="$(awk '/^Gid:/ {print $2; exit}' "$process_root/status")"
  [[ "$uid" == "$RUNTIME_UID" ]] || return 1
  [[ "$gid" == "$RUNTIME_GID" ]] || return 1
}

locate_aapanel_project() {
  local pid="$1" candidate matched=0 project
  AAPANEL_PID_FILE=""
  AAPANEL_START_SCRIPT=""
  shopt -s nullglob
  for candidate in "$AAPANEL_PID_DIR"/*.pid; do
    if [[ "$(tr -d '[:space:]' < "$candidate")" == "$pid" ]]; then
      matched=$((matched + 1))
      AAPANEL_PID_FILE="$candidate"
    fi
  done
  shopt -u nullglob
  [[ "$matched" == "1" ]] || return 1
  project="$(basename "$AAPANEL_PID_FILE" .pid)"
  AAPANEL_START_SCRIPT="$AAPANEL_SCRIPT_DIR/$project.sh"
  [[ -f "$AAPANEL_START_SCRIPT" ]] || return 1
  grep -Fq "$LIVE" "$AAPANEL_START_SCRIPT" || return 1
  grep -Fq 'src/index.js' "$AAPANEL_START_SCRIPT" || return 1
}

verify_start_script_runtime_writes() {
  (( TEST_MODE == 1 )) && return 0
  local target parent
  while IFS= read -r target; do
    [[ -n "$target" ]] || continue
    target="${target%%[[:space:]]*}"
    target="${target%\"}"; target="${target#\"}"
    target="${target%\'}"; target="${target#\'}"
    [[ "$target" == /* ]] || continue
    # aaPanel's generated start script commonly writes its PID file itself. The
    # runtime user does not need permission for that final bookkeeping write:
    # the deployer rewrites the PID file as root only after the listener,
    # cwd, argv and runtime identity have been independently verified.
    [[ "$target" == "$AAPANEL_PID_FILE" ]] && continue
    if [[ -e "$target" ]]; then
      runuser -u "$RUNTIME_USER" -- test -w "$target" || return 1
    else
      parent="$(dirname "$target")"
      runuser -u "$RUNTIME_USER" -- test -w "$parent" || return 1
    fi
  done < <(grep -oE '(>>|>)[[:space:]]*[^[:space:];&]+' "$AAPANEL_START_SCRIPT" | sed -E 's/^(>>|>)[[:space:]]*//' || true)
}

verify_current_runtime() {
  local pid
  pid="$(get_listener_pid)" || return 1
  verify_process_identity "$pid" || return 1
  locate_aapanel_project "$pid" || return 1
  CURRENT_PID="$pid"
}

verify_disk_space() {
  (( TEST_MODE == 1 )) && return 0
  local release_kb available_kb required_kb
  release_kb="$(du -sk --exclude='.env' --exclude='data' --exclude='.well-known' "$LIVE" | awk '{print $1}')" || return 1
  available_kb="$(df -Pk "$LIVE" | awk 'NR==2 {print $4}')" || return 1
  required_kb=$((release_kb * 3 + 524288))
  (( available_kb >= required_kb ))
}

verify_deploy_repo_origin() {
  local origin
  origin="$(git -C "$DEPLOY_REPO" remote get-url origin 2>/dev/null)" || return 1
  if (( TEST_MODE == 1 )); then return 0; fi
  case "$origin" in
    git@github.com:${REPOSITORY_SLUG}|git@github.com:${REPOSITORY_SLUG}.git|ssh://git@github.com/${REPOSITORY_SLUG}|ssh://git@github.com/${REPOSITORY_SLUG}.git) return 0 ;;
    *) return 1 ;;
  esac
}

verify_deploy_key_sidecar_if_available() {
  (( TEST_MODE == 1 )) && return 0
  command -v ssh-keygen >/dev/null 2>&1 || return 0
  local ssh_command key_path derived sidecar canonical_derived canonical_sidecar
  ssh_command="$(git -C "$DEPLOY_REPO" config --get core.sshCommand 2>/dev/null || true)"
  key_path="$(sed -nE 's/.*(^|[[:space:]])-i[[:space:]]+([^[:space:]]+).*/\2/p' <<<"$ssh_command" | head -n1)"
  key_path="${key_path%\"}"; key_path="${key_path#\"}"
  key_path="${key_path%\'}"; key_path="${key_path#\'}"
  [[ -n "$key_path" && -f "$key_path" && -f "$key_path.pub" ]] || return 0
  derived="$(ssh-keygen -y -f "$key_path" 2>/dev/null)" || return 1
  sidecar="$(head -n1 "$key_path.pub")" || return 1
  canonical_derived="$(canonical_public_key "$derived")" || return 1
  canonical_sidecar="$(canonical_public_key "$sidecar")" || return 1
  [[ "$canonical_derived" == "$canonical_sidecar" ]]
}

preflight() {
  (( TEST_MODE == 1 )) || [[ "$EUID" == "0" ]] || return 1
  require_commands || return 1
  [[ -d "$LIVE" && -f "$LIVE/.env" && -d "$LIVE/data" ]] || return 1
  local mode
  mode="$(stat -c '%a' "$LIVE/.env")" || return 1
  is_safe_env_mode "$mode" || return 1
  runuser -u "$RUNTIME_USER" -- test -r "$LIVE/.env" || return 1
  runuser -u "$RUNTIME_USER" -- test -r "$LIVE/data" || return 1
  runuser -u "$RUNTIME_USER" -- test -w "$LIVE/data" || return 1
  verify_current_runtime || return 1
  runuser -u "$RUNTIME_USER" -- test -r "$AAPANEL_START_SCRIPT" || return 1
  verify_start_script_runtime_writes || return 1
  verify_disk_space || return 1
  [[ -d "$DEPLOY_REPO/.git" ]] || return 1
  verify_deploy_repo_origin || return 1
}

resolve_release() {
  git -C "$DEPLOY_REPO" fetch --prune --tags origin >/dev/null || return 1
  verify_deploy_key_sidecar_if_available || return 1
  local actual_sha
  actual_sha="$(git -C "$DEPLOY_REPO" rev-parse --verify "refs/tags/${RELEASE_TAG}^{commit}" 2>/dev/null)" || return 1
  [[ "$actual_sha" == "$EXPECTED_SHA" ]] || return 1
  [[ "$(git -C "$DEPLOY_REPO" cat-file -t "$EXPECTED_SHA" 2>/dev/null)" == "commit" ]] || return 1
  if git -C "$DEPLOY_REPO" rev-parse --verify refs/remotes/origin/main >/dev/null 2>&1; then
    git -C "$DEPLOY_REPO" merge-base --is-ancestor "$EXPECTED_SHA" refs/remotes/origin/main || return 1
  fi
  RELEASE_VERSION="${RELEASE_TAG#v}"
}

verify_stage_identity() {
  [[ -f "$STAGE/VERSION" && -f "$STAGE/package.json" && -f "$STAGE/src/index.js" ]] || return 1
  [[ "$(tr -d '[:space:]' < "$STAGE/VERSION")" == "$RELEASE_VERSION" ]] || return 1
  local package_version
  package_version="$(node -e 'const p=require(process.argv[1]); process.stdout.write(String(p.version||""))' "$STAGE/package.json")" || return 1
  [[ "$package_version" == "$RELEASE_VERSION" ]] || return 1
  grep -Fq "ENGINE_COMPATIBILITY=\"$ENGINE_COMPATIBILITY\"" "$STAGE/scripts/deploy-release.sh" || return 1
}

prepare_stage() {
  rm -rf -- "$STAGE"
  mkdir -p "$STAGE"
  (cd "$DEPLOY_REPO" && git archive "$EXPECTED_SHA") | tar -x -C "$STAGE" || return 1
  verify_stage_identity || return 1
  install -m 600 "$LIVE/.env" "$STAGE/.env" || return 1
  mkdir -p "$STAGE/data/cards" "$STAGE/data/backups" "$STAGE/data/whatsapp-auth"
  chmod 700 "$STAGE/data" "$STAGE/data/cards" "$STAGE/data/backups" "$STAGE/data/whatsapp-auth"

  (
    cd "$STAGE"
    DATA_DIR=./data WHATSAPP_AUTH_DIR=./data/whatsapp-auth bash scripts/install-aapanel.sh "$STAGE"
  ) || return 1

  if [[ -d "$STAGE/automation/workspace-agent" ]]; then
    [[ -f "$STAGE/automation/workspace-agent/package.json" && -f "$STAGE/automation/workspace-agent/package-lock.json" ]] || return 1
    (
      cd "$STAGE/automation/workspace-agent"
      npm ci --ignore-scripts
      npm run check
      npm audit --omit=dev --audit-level=high
      npm ci --omit=dev --ignore-scripts
    ) || return 1
  fi
}

create_rollback_snapshot() {
  rm -rf -- "$ROLLBACK"
  mkdir -p "$ROLLBACK"
  rsync -a --checksum --delete \
    --exclude='.env' \
    --exclude='data/' \
    --exclude='.well-known/' \
    --exclude='.git/' \
    "$LIVE/" "$ROLLBACK/" || return 1
  [[ -f "$ROLLBACK/src/index.js" && -f "$ROLLBACK/VERSION" ]] || return 1
  ROLLBACK_VERSION="$(tr -d '[:space:]' < "$ROLLBACK/VERSION")"
  [[ "$ROLLBACK_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  ROLLBACK_READY=1
}

capture_workspace_timer_state() {
  (( TEST_MODE == 1 )) && return 0
  command -v systemctl >/dev/null 2>&1 || return 0
  TIMER_WAS_ENABLED="$(systemctl is-enabled "$WORKSPACE_TIMER" 2>/dev/null || true)"
  TIMER_WAS_ACTIVE="$(systemctl is-active "$WORKSPACE_TIMER" 2>/dev/null || true)"
  [[ -n "$TIMER_WAS_ENABLED" ]] || TIMER_WAS_ENABLED="disabled"
  [[ -n "$TIMER_WAS_ACTIVE" ]] || TIMER_WAS_ACTIVE="inactive"
}

pause_workspace_timer_if_active() {
  (( TEST_MODE == 1 )) && return 0
  if [[ "$TIMER_WAS_ACTIVE" == "active" ]]; then
    systemctl stop "$WORKSPACE_TIMER" || return 1
    AUTOMATION_PAUSED=1
  fi
}

restore_workspace_timer_state() {
  (( TEST_MODE == 1 )) && { AUTOMATION_PAUSED=0; return 0; }
  if (( AUTOMATION_PAUSED == 1 )); then
    systemctl start "$WORKSPACE_TIMER" || return 1
    AUTOMATION_PAUSED=0
  fi
  local now_enabled
  now_enabled="$(systemctl is-enabled "$WORKSPACE_TIMER" 2>/dev/null || true)"
  if [[ "$TIMER_WAS_ENABLED" == "enabled" ]]; then
    [[ "$now_enabled" == "enabled" ]] || return 1
  elif [[ "$TIMER_WAS_ENABLED" == "disabled" ]]; then
    [[ "$now_enabled" != "enabled" ]] || return 1
  fi
}

graceful_stop_application() {
  local pid="$1"
  verify_process_identity "$pid" || return 1
  [[ "$(get_listener_pid)" == "$pid" ]] || return 1
  if (( TEST_MODE == 1 )); then
    rm -f "$KP_TEST_ROOT/runtime/running"
    rm -rf "$PROC_ROOT/$pid"
  else
    kill -TERM "$pid" || return 1
  fi
  wait_for_port_clear || return 1
}

apply_live_permissions() {
  if (( TEST_MODE == 0 )); then
    chown "$RUNTIME_USER:$RUNTIME_GROUP" "$LIVE" || return 1
    find "$LIVE" -mindepth 1 -maxdepth 1 ! -name '.well-known' -exec chown -R "$RUNTIME_USER:$RUNTIME_GROUP" -- {} + || return 1
  fi
  chmod 600 "$LIVE/.env" || return 1
  find "$LIVE/data" -type d -exec chmod 750 {} + || return 1
  find "$LIVE/data" -type f -exec chmod 640 {} + || return 1
}

cutover_files() {
  rsync -a --checksum --delete \
    --exclude='.env' \
    --exclude='data/' \
    --exclude='.well-known/' \
    "$STAGE/" "$LIVE/" || return 1
  apply_live_permissions
}

start_application_as_runtime_user() {
  local start_rc=0
  runuser -u "$RUNTIME_USER" -- bash "$AAPANEL_START_SCRIPT" || start_rc=$?
  if ! wait_for_listener; then
    if (( start_rc != 0 )); then return "$start_rc"; fi
    return 1
  fi
  local pid
  pid="$(get_listener_pid)" || return 1
  verify_process_identity "$pid" || return 1
  printf '%s\n' "$pid" > "$AAPANEL_PID_FILE" || return 1
  CURRENT_PID="$pid"
}

verify_health_json() {
  local expected="$1" payload="$2"
  EXPECTED_VERSION="$expected" node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const j=JSON.parse(s);if(j.ok!==true||j.version!==process.env.EXPECTED_VERSION)process.exit(1)})' \
    >/dev/null 2>&1 <<<"$payload"
}

local_health_smoke() {
  local expected="$1" payload
  payload="$(curl -fsS --max-time 15 "http://127.0.0.1:${PORT}/health")" || return 1
  verify_health_json "$expected" "$payload"
}

authenticated_local_smoke() {
  if (( TEST_MODE == 1 )); then
    node --input-type=module >/dev/null <<'NODE'
await Promise.resolve();
NODE
    return 0
  fi
  KP_ENV_FILE="$LIVE/.env" KP_SMOKE_URL="http://127.0.0.1:${PORT}/api/gpt/health" node --input-type=module >/dev/null <<'NODE'
import fs from 'node:fs/promises';
const raw = await fs.readFile(process.env.KP_ENV_FILE, 'utf8');
const values = new Map();
for (const rawLine of raw.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const at = line.indexOf('=');
  if (at < 1) continue;
  const key = line.slice(0, at).trim();
  let value = line.slice(at + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  values.set(key, value.replace(/\\n/g, '\n'));
}
const secret = values.get('GPT_ACTION_API_KEY');
if (!secret) process.exit(20);
const response = await fetch(process.env.KP_SMOKE_URL, {
  headers: { authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(15_000)
});
if (!response.ok) process.exit(21);
const body = await response.json();
if (body?.ok !== true) process.exit(22);
NODE
}

load_env_value() {
  local key="$1"
  KP_ENV_FILE="$LIVE/.env" KP_ENV_KEY="$key" node --input-type=module <<'NODE'
import fs from 'node:fs/promises';
const raw = await fs.readFile(process.env.KP_ENV_FILE, 'utf8');
for (const rawLine of raw.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const at = line.indexOf('=');
  if (at < 1) continue;
  if (line.slice(0, at).trim() !== process.env.KP_ENV_KEY) continue;
  let value = line.slice(at + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  process.stdout.write(value.replace(/\\n/g, '\n'));
  process.exit(0);
}
process.exit(2);
NODE
}

external_smoke() {
  local expected="$1" base health schema
  base="$(load_env_value APP_BASE_URL)" || return 1
  [[ "$base" == https://* ]] || return 1
  base="${base%/}"
  health="$(curl -fsS --max-time 20 "$base/health")" || return 1
  verify_health_json "$expected" "$health" || return 1
  schema="$(curl -fsS --max-time 20 "$base/gpt-action/openapi.json")" || return 1
  EXPECTED_VERSION="$expected" node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const j=JSON.parse(s);if(j?.info?.version!==process.env.EXPECTED_VERSION)process.exit(1)})' \
    >/dev/null 2>&1 <<<"$schema"
}

verify_running_release() {
  local expected="$1" pid
  pid="$(get_listener_pid)" || { printf 'RUNTIME_CHECK=LISTENER_FAIL\n' >&2; return 1; }
  verify_process_identity "$pid" || { printf 'RUNTIME_CHECK=PROCESS_IDENTITY_FAIL\n' >&2; return 1; }
  local actual_version
  actual_version="$(tr -d '[:space:]' < "$LIVE/VERSION")"
  [[ "$actual_version" == "$expected" ]] || { printf 'RUNTIME_CHECK=VERSION_FAIL actual=%s expected=%s\n' "$actual_version" "$expected" >&2; return 1; }
  local_health_smoke "$expected" || { printf 'RUNTIME_CHECK=LOCAL_HEALTH_FAIL\n' >&2; return 1; }
  CURRENT_PID="$pid"
}

configure_workspace_agent_server() {
  [[ -d "$LIVE/automation/workspace-agent" ]] || return 0
  (( TEST_MODE == 1 )) && return 0
  (
    cd "$LIVE/automation/workspace-agent"
    node deploy/configure-server.mjs
  ) || return 1
  systemctl daemon-reload || return 1
  nginx -t || return 1
  systemctl restart "$WORKSPACE_MCP_SERVICE" || return 1
  systemctl is-active --quiet "$WORKSPACE_MCP_SERVICE" || return 1
}

restore_release_owned_files() {
  rsync -a --checksum --delete \
    --exclude='.env' \
    --exclude='data/' \
    --exclude='.well-known/' \
    "$ROLLBACK/" "$LIVE/" || return 1
  apply_live_permissions
}

perform_rollback() {
  ROLLBACK_IN_PROGRESS=1
  set +e
  local ok=1 pid
  pid="$(get_listener_pid 2>/dev/null)"
  if [[ -n "$pid" ]]; then
    graceful_stop_application "$pid" || ok=0
  fi
  if (( ok == 1 )); then restore_release_owned_files || ok=0; fi
  if (( ok == 1 )); then start_application_as_runtime_user || ok=0; fi
  if (( ok == 1 )); then verify_running_release "$ROLLBACK_VERSION" || ok=0; fi
  if (( ok == 1 )); then authenticated_local_smoke || ok=0; fi
  if (( ok == 1 )); then configure_workspace_agent_server || ok=0; fi
  if (( ok == 1 )); then external_smoke "$ROLLBACK_VERSION" || ok=0; fi
  restore_workspace_timer_state || ok=0
  set -e
  ROLLBACK_IN_PROGRESS=0
  (( ok == 1 ))
}

cleanup_stage() {
  if [[ -n "${STAGE:-}" && -d "$STAGE" ]]; then
    case "$STAGE" in
      /www/wwwroot/knowledgepilot.stage|/tmp/*/stage|/var/tmp/*/stage) rm -rf -- "$STAGE" ;;
    esac
  fi
}

on_exit() {
  local rc=$?
  trap - EXIT
  if (( rc != 0 )); then
    printf 'RESULT=FAIL\n'
    printf 'FAILED_PHASE=%s\n' "$PHASE"
    printf 'ERROR=%s\n' "$FAILURE_REASON"
    if (( CUTOVER_STARTED == 1 && ROLLBACK_READY == 1 && ROLLBACK_IN_PROGRESS == 0 )); then
      if perform_rollback; then
        printf 'ROLLBACK=PASS\n'
      else
        printf 'ROLLBACK=FAIL\n'
      fi
    else
      restore_workspace_timer_state >/dev/null 2>&1 || true
    fi
  fi
  cleanup_stage
  exit "$rc"
}

self_test() {
  validate_release_args v1.4.3 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa || return 1
  ! validate_release_args main aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa || return 1
  ! validate_release_args v1.4.3 deadbeef || return 1
  is_safe_env_mode 600 || return 1
  ! is_safe_env_mode 644 || return 1
  [[ "$(canonical_public_key 'ssh-ed25519 AAAATEST comment')" == "ssh-ed25519 AAAATEST" ]] || return 1
  printf 'SELF_TEST=PASS\n'
}

usage() {
  printf 'Usage: sudo deploy-knowledge-pilot vX.Y.Z <40-character-release-commit-sha>\n'
}

main() {
  if [[ "${1:-}" == "--self-test" ]]; then
    self_test
    return
  fi
  if [[ "$#" -ne 2 ]] || ! validate_release_args "$1" "$2"; then
    usage >&2
    return 2
  fi
  RELEASE_TAG="$1"
  EXPECTED_SHA="$2"
  configure_paths || return 1
  trap on_exit EXIT

  mkdir -p "$(dirname "$LOCK_FILE")"
  exec 9>"$LOCK_FILE"
  flock -n 9 || { FAILURE_REASON="another deployment is active"; return 1; }

  phase PREFLIGHT
  preflight || fail "production preflight failed"

  phase RELEASE_VERIFY
  resolve_release || fail "release identity verification failed"

  phase STAGE_VERIFY
  prepare_stage || fail "staging verification failed"

  phase ROLLBACK_SNAPSHOT
  create_rollback_snapshot || fail "rollback snapshot failed"
  capture_workspace_timer_state || fail "workspace timer state inspection failed"
  pause_workspace_timer_if_active || fail "workspace timer pause failed"

  phase LIVE_STOP
  verify_current_runtime || fail "runtime changed before stop"
  graceful_stop_application "$CURRENT_PID" || fail "graceful live stop failed"
  CUTOVER_STARTED=1

  phase CUTOVER_FILES
  cutover_files || fail "release cutover failed"

  phase RESTART
  start_application_as_runtime_user || fail "aaPanel restart failed"

  phase LOCAL_RUNTIME
  verify_running_release "$RELEASE_VERSION" || fail "runtime identity or local health verification failed"

  phase AUTHENTICATED_LOCAL_SMOKE
  authenticated_local_smoke || fail "authenticated local smoke failed"

  phase SERVER_INTEGRATION
  configure_workspace_agent_server || fail "workspace agent server integration failed"

  phase EXTERNAL_HTTPS_SMOKE
  external_smoke "$RELEASE_VERSION" || fail "external production smoke failed"

  phase AUTOMATION_RESTORE
  restore_workspace_timer_state || fail "workspace timer state restoration failed"

  phase COMPLETE
  printf 'RESULT=PASS\n'
  printf 'RELEASE=%s\n' "$RELEASE_TAG"
  printf 'RELEASE_SHA=%s\n' "$EXPECTED_SHA"
  printf 'MANAGER=aapanel-node\n'
  printf 'RUNTIME_USER=%s\n' "$RUNTIME_USER"
  printf 'PRODUCTION_CUTOVER=PASS\n'
}

if [[ "${KP_DEPLOY_LIBRARY_ONLY:-0}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

main "$@"
