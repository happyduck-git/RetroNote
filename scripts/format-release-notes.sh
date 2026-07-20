#!/usr/bin/env bash
#
# 릴리스 노트 본문을 한 곳에서 결정한다.
# CI(release.yml)와 로컬 배포 전 미리보기가 이 스크립트를 공유하므로,
# 로컬에서 본 결과 = 실제 발행되는 노트(릴리스 본문 + latest.json 의 notes)가 보장된다.
#
# 본문은 두 갈래로 정해진다:
#   1. release-notes/<tag>.md 가 있으면 그 내용을 그대로 쓴다(손으로 쓴 사용자용 문구).
#   2. 없으면 PR 제목 기반으로 자동 생성하고 작성자·PR 번호·이슈 번호를 걷어낸다.
#
# CI 는 태그가 가리키는 커밋을 체크아웃하므로, 손으로 쓴 노트는 태그를 밀기 전에
# 커밋돼 있어야 한다(버전 범프 PR 에 같이 넣으면 문구까지 한 번에 리뷰된다).
#
# 사용법:
#   scripts/format-release-notes.sh <tag> [target_commitish]
#
#   - 배포 전 미리보기(태그가 아직 없음): 다음 버전과 기준 브랜치를 준다.
#       scripts/format-release-notes.sh v0.1.12 main
#     generate-notes API 가 "이 버전으로 내면 이렇게 나온다"를 미리 계산해 준다.
#   - CI(태그가 이미 push 되어 존재): target_commitish 생략.
#       scripts/format-release-notes.sh v0.1.12
#
#   손으로 쓴 노트의 초안을 자동 생성으로 깔아두려면:
#       scripts/draft-release-notes.sh v0.1.12 main
#
# 필요 조건: gh(CLI) 로그인 상태. gh 가 PATH 에 없으면 GH 로 경로 지정:
#   GH="/c/Program Files/GitHub CLI/gh.exe" scripts/format-release-notes.sh v0.1.12 main
#
set -euo pipefail

tag="${1:?사용법: format-release-notes.sh <tag> [target_commitish]  (예: v0.1.12 main)}"
target="${2:-}"
gh_bin="${GH:-gh}"

# 호출 위치(레포 루트 / CI / 다른 디렉터리)와 무관하게 노트 파일을 찾도록
# 스크립트 위치 기준으로 레포 루트를 잡는다.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
notes_file="${repo_root}/release-notes/${tag}.md"

# 1) 손으로 쓴 노트가 있으면 가공 없이 그대로 내보낸다.
#    자동 생성본과 달리 이미 사용자용 문구이므로 필터를 태우지 않는다(끝 공백만 정리).
if [ -f "$notes_file" ]; then
  hand=$(perl -0777 -pe 's/\s+\z/\n/' "$notes_file")
  if [ -n "$(printf '%s' "$hand" | tr -d '[:space:]')" ]; then
    printf '%s\n' "$hand"
    exit 0
  fi
  # 파일은 있는데 내용이 비었으면 실수로 보고 자동 생성으로 폴백한다
  # (릴리스를 실패시키는 대신 경고만 남긴다).
  echo "경고: ${notes_file} 가 비어 있어 자동 생성으로 대체합니다." >&2
fi

# 2) 손으로 쓴 노트가 없으면 기존 자동 생성 경로.
# CI 는 REPO(=owner/repo)를 넘겨 gh 자동 감지에 의존하지 않는다.
# 로컬은 {owner}/{repo} 플레이스홀더 → gh 가 현재 git 리모트에서 채운다.
# (:- 기본값 안에 중괄호를 직접 넣으면 파라미터 확장이 조기 종료되므로 분리해서 설정한다.)
repo="${REPO:-}"
if [ -z "$repo" ]; then
  repo='{owner}/{repo}'
fi

# generate-notes: 병합된 PR 제목 기반 changelog 를 만든다(형식은 GitHub 고정).
api_args=(--method POST "repos/${repo}/releases/generate-notes" -f "tag_name=${tag}")
if [ -n "$target" ]; then
  api_args+=(-f "target_commitish=${target}")
fi

# 발행 전 미리보기/이전 릴리스 없음/네트워크 오류 등으로 실패하면 빈 문자열로 둔다 —
# 에러 응답(JSON)이 노트 본문으로 새지 않게 하고, 아래에서 기본 문구로 폴백한다.
if ! raw=$("$gh_bin" api "${api_args[@]}" --jq '.body' 2>/dev/null); then
  raw=""
fi

# generate-notes 는 각 항목을 "* 제목 by @작성자 in <PR 링크>" 형태로 만든다.
# 사용자용 "변경 내용"에는 작성자·PR 번호·이슈 번호가 불필요하므로 제목만 남기고,
# New Contributors·Full Changelog 섹션도 통째로 걷어낸다.
# (perl 은 macOS·Git Bash 러너 모두 기본 제공된다.)
body=$(printf '%s' "$raw" | perl -0777 -pe '
  s/\n## New Contributors.*\z//s;    # New Contributors 이하(Full Changelog 포함) 전부 제거
  s/^\*\*Full Changelog\*\*.*$//mg;   # (New Contributors 없을 때) Full Changelog 줄 제거
  s/ by \@\S+ in \S+//g;              # " by @작성자 in <PR 링크>" 제거
  s/ *\(#\d[^)]*\)//g;                # 제목 속 "(#61 #63 …)" 이슈 묶음 제거
  s/ +#\d+//g;                        # 남은 " #123" 이슈/PR 번호 제거
  # 릴리스/버전범프 PR 은 사용자용 변경 내용이 아니므로 해당 항목 줄을 통째로 제거.
  s{^\* *release/\S+.*\n}{}mg;         #   릴리스 PR (제목이 "release/vX.Y.Z" 브랜치명)
  s{^\*.*버전 *범프.*\n}{}mg;          #   "…버전 범프" (예: "chore: vX.Y.Z 버전 범프")
  s{^\* *chore: *v\d[\w.]*\b.*\n}{}img; #   "chore: vX.Y.Z …" 형태의 버전 범프
  s/\n{3,}/\n\n/g;                    # 정리 과정에서 생긴 빈 줄 축소
  s/\A\s*## What.s Changed\s*\z//s;    # 남은 게 헤더뿐이면(=표시할 항목 없음) 헤더도 제거
  s/\s+\z/\n/;                         # 끝 공백 정리
')

# 필터 후 공백만 남으면(=표시할 변경 항목 없음) 기본 문구로 폴백.
if [ -z "$(printf '%s' "$body" | tr -d '[:space:]')" ]; then
  body="See the assets below to download and install."
fi

printf '%s\n' "$body"
