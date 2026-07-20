#!/usr/bin/env bash
#
# 손으로 쓸 릴리스 노트(release-notes/<tag>.md)의 초안을 깔아준다.
# 백지에서 시작하면 빠뜨리는 항목이 생기므로, 자동 생성 결과를 먼저 받아두고
# 그 위에서 사용자용 문구로 고쳐 쓰는 방식이다.
#
# 초안 내용 자체는 format-release-notes.sh 가 만든다(파일이 아직 없으니
# 그쪽의 자동 생성 경로를 탄다). 정리 규칙이 한 곳에만 있도록 재사용한다.
#
# 사용법:
#   scripts/draft-release-notes.sh <tag> [target_commitish] [--force]
#     예: scripts/draft-release-notes.sh v0.1.12 main
#
#   이미 파일이 있으면 덮어쓰지 않는다(손으로 고친 내용 보호). --force 로 강제.
#
# 필요 조건: gh(CLI) 로그인 상태. gh 가 PATH 에 없으면 GH 로 경로 지정.
#
set -euo pipefail

force=0
args=()
for a in "$@"; do
  if [ "$a" = "--force" ]; then
    force=1
  else
    args+=("$a")
  fi
done

tag="${args[0]:?사용법: draft-release-notes.sh <tag> [target_commitish] [--force]  (예: v0.1.12 main)}"
target="${args[1]:-}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
out_dir="${repo_root}/release-notes"
out_file="${out_dir}/${tag}.md"

if [ -f "$out_file" ] && [ "$force" -ne 1 ]; then
  echo "이미 있습니다: release-notes/${tag}.md" >&2
  echo "덮어쓰려면 --force 를 주세요(손으로 고친 내용이 날아갑니다)." >&2
  exit 1
fi

# 파일이 없는 상태에서 호출해야 자동 생성 경로를 탄다.
# (--force 로 덮어쓸 때는 기존 파일을 잠시 치워 자기 내용을 되읽지 않게 한다.)
backup=""
if [ -f "$out_file" ]; then
  backup="${out_file}.bak.$$"
  mv "$out_file" "$backup"
fi
restore_backup() {
  if [ -n "$backup" ] && [ -f "$backup" ]; then
    mv "$backup" "$out_file"
  fi
}
trap restore_backup EXIT

if [ -n "$target" ]; then
  body=$(bash "${script_dir}/format-release-notes.sh" "$tag" "$target")
else
  body=$(bash "${script_dir}/format-release-notes.sh" "$tag")
fi

mkdir -p "$out_dir"
printf '%s\n' "$body" > "$out_file"

# 초안이 제대로 깔렸으니 백업은 되돌리지 않고 버린다.
if [ -n "$backup" ] && [ -f "$backup" ]; then
  rm -f "$backup"
fi
backup=""
trap - EXIT

echo "초안 생성: release-notes/${tag}.md"
echo
echo "다음 순서로 진행하세요:"
echo "  1. release-notes/${tag}.md 를 사용자용 문구로 고쳐 씁니다"
echo "     (내부 작업·빌드 관련 항목은 지우고, PR 제목투는 풀어서 씁니다)"
echo "  2. npm run notes:preview -- ${tag}${target:+ $target}   # 최종 문구 확인"
echo "  3. 이 파일을 커밋한 뒤 태그를 밀면 그대로 발행됩니다"
