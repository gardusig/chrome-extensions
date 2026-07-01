#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCKERFILE="${REPO_DOCKERFILE:-$REPO_ROOT/Dockerfile}"
UNIT_TIMEOUT_SEC="${REPO_UNIT_TIMEOUT_SEC:-120}"
INTEGRATION_TIMEOUT_SEC="${REPO_INTEGRATION_TIMEOUT_SEC:-480}"
DEPLOY_TIMEOUT_SEC="${REPO_DEPLOY_TIMEOUT_SEC:-600}"
RELEASE_TIMEOUT_SEC="${REPO_RELEASE_TIMEOUT_SEC:-900}"

docker_require() {
  command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not found" >&2; exit 127; }
  command -v timeout >/dev/null 2>&1 || { echo "ERROR: timeout not found" >&2; exit 127; }
}

docker_image_for() {
  printf '%s\n' "${REPO_DOCKER_IMAGE:-$(basename "$REPO_ROOT"):$1}"
}

docker_build_target() {
  local target="$1" image
  image="$(docker_image_for "$target")"
  echo "==> docker build --target ${target} -t ${image}"
  docker build -f "$DOCKERFILE" --target "$target" -t "$image" "$REPO_ROOT"
}

docker_run_target() {
  local target="$1" timeout_sec="$2" image
  image="$(docker_image_for "$target")"
  docker_build_target "$target"
  echo "==> docker run (timeout ${timeout_sec}s): ${image}"
  timeout "$timeout_sec" docker run --rm "$image"
}

docker_run_target_with_repo() {
  local target="$1" timeout_sec="$2" image
  image="$(docker_image_for "$target")"
  docker_build_target "$target"
  timeout "$timeout_sec" docker run --rm \
    -v "${REPO_ROOT}:/repo:rw" \
    -w /repo \
    -e GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}" \
    -e GITHUB_TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}" \
    "$image"
}

docker_run_target_with_artifacts() {
  local target="$1" timeout_sec="$2" image
  image="$(docker_image_for "$target")"
  mkdir -p "${REPO_ROOT}/artifacts"
  docker_build_target "$target"
  timeout "$timeout_sec" docker run --rm \
    -v "${REPO_ROOT}/artifacts:/artifacts:rw" \
    -e GITHUB_REF_NAME="${GITHUB_REF_NAME:-}" \
    "$image"
}

run_unit_tests() { docker_require; docker_run_target unit "$UNIT_TIMEOUT_SEC"; }
run_integration_tests() { docker_require; docker_run_target integration "$INTEGRATION_TIMEOUT_SEC"; }
run_deploy() { docker_require; docker_run_target_with_repo deploy "$DEPLOY_TIMEOUT_SEC"; }
run_release_build() { docker_require; docker_run_target_with_artifacts release "$RELEASE_TIMEOUT_SEC"; }
