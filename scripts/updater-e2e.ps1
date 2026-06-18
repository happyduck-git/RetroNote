<#
.SYNOPSIS
  tauri-plugin-updater 로컬 e2e 검증 보조 스크립트 (Windows).
  GitHub Release 를 건드리지 않고, 로컬 HTTP 서버 + 임시 endpoint 로
  "구버전 앱이 신버전을 감지 → 다운로드 → 재시작" 전체 흐름을 재현한다.

.DESCRIPTION
  자동 업데이트는 본질적으로 "낮은 버전 → 높은 버전" 흐름이라 정적 검사로는 확인이 안 된다.
  이 스크립트는 두 모드로 동작한다:

    -Mode low    : 낮은 버전(기본 0.1.5)을 빌드한다. 실행해서 "업데이트를 받는 쪽" 앱으로 쓴다.
    -Mode serve  : 높은 버전(기본 0.1.6)을 서명 빌드 → latest.json 생성 → 로컬 HTTP 서버로 제공.

  두 모드 모두 tauri.conf.json 을 임시로 수정한다(pubkey, endpoint=localhost, version).
  스크립트 종료 시 finally 에서 **원본을 그대로 복원**하므로 작업 트리는 변하지 않는다.

  전제(Phase 0, 1회):
    npm run tauri -- signer generate -w retronote.key
      → retronote.key (개인키) + retronote.key.pub (공개키) 생성.

.PARAMETER Mode
  'low' 또는 'serve'.

.PARAMETER PrivateKeyPath
  서명 개인키 경로. 공개키는 "<경로>.pub" 로 가정(없으면 -Pubkey 로 직접 지정).

.PARAMETER KeyPassword
  개인키 패스워드(생성 시 입력한 값). 빈 문자열이면 미설정.

.PARAMETER Pubkey
  공개키 문자열. 미지정 시 "<PrivateKeyPath>.pub" 에서 읽는다.

.PARAMETER LowVersion / HighVersion
  각각 낮은/높은 테스트 버전.

.PARAMETER Port
  로컬 서버 포트(기본 8000). endpoint 도 이 포트로 맞춘다.

.EXAMPLE
  # 1) 낮은 버전 빌드 → 설치/실행
  ./scripts/updater-e2e.ps1 -Mode low -PrivateKeyPath .\retronote.key -KeyPassword 'pw'

  # 2) 높은 버전 서명 빌드 + latest.json + 서버 기동(다른 터미널에서)
  ./scripts/updater-e2e.ps1 -Mode serve -PrivateKeyPath .\retronote.key -KeyPassword 'pw'

  # 3) (1)에서 설치한 낮은 버전 앱을 실행 → 업데이트 다이얼로그 확인
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('low', 'serve')] [string] $Mode,
  [Parameter(Mandatory = $true)][string] $PrivateKeyPath,
  [string] $KeyPassword = '',
  [string] $Pubkey,
  [string] $LowVersion = '0.1.5',
  [string] $HighVersion = '0.1.6',
  [int] $Port = 8000
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$confPath = Join-Path $repoRoot 'src-tauri/tauri.conf.json'
$bundleDir = Join-Path $repoRoot 'src-tauri/target/release/bundle/nsis'
$serveDir = Join-Path $repoRoot '.updater-e2e'   # latest.json + 인스톨러를 제공할 폴더

# --- 공개키 확보 ---------------------------------------------------------------
if (-not $Pubkey) {
  $pubPath = "$PrivateKeyPath.pub"
  if (-not (Test-Path $pubPath)) {
    throw "공개키를 찾을 수 없음: $pubPath (또는 -Pubkey 로 직접 지정)"
  }
  $Pubkey = (Get-Content $pubPath -Raw).Trim()
}

# --- tauri.conf.json 임시 수정(pubkey/endpoint/version) 후 빌드, 끝나면 복원 ----
$confBackup = Get-Content $confPath -Raw
$targetVersion = if ($Mode -eq 'low') { $LowVersion } else { $HighVersion }
$endpoint = "http://localhost:$Port/latest.json"

try {
  $conf = $confBackup | ConvertFrom-Json
  $conf.version = $targetVersion
  # plugins.updater 는 PR 에서 이미 존재. pubkey/endpoint 만 로컬용으로 덮어쓴다.
  $conf.plugins.updater.pubkey = $Pubkey
  $conf.plugins.updater.endpoints = @($endpoint)
  ($conf | ConvertTo-Json -Depth 20) | Set-Content $confPath -Encoding utf8
  Write-Host "[conf] version=$targetVersion endpoint=$endpoint pubkey=설정됨" -ForegroundColor Cyan

  # 서명 env: 키 '내용'을 넘긴다(Tauri 는 경로/내용 모두 허용하나 내용이 가장 안전).
  $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $PrivateKeyPath -Raw)
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $KeyPassword

  Write-Host "[build] npm run tauri build ($Mode, v$targetVersion) ..." -ForegroundColor Cyan
  & npm run tauri build
  if ($LASTEXITCODE -ne 0) { throw "tauri build 실패 (exit $LASTEXITCODE)" }
}
finally {
  # 어떤 경우에도 원본 conf 복원 → 작업 트리 무변경(placeholder pubkey + GitHub endpoint).
  Set-Content $confPath -Value $confBackup -Encoding utf8 -NoNewline
  Write-Host "[conf] 원본 복원 완료" -ForegroundColor DarkGray
}

# --- 모드별 후처리 -------------------------------------------------------------
if ($Mode -eq 'low') {
  $installer = Get-ChildItem (Join-Path $bundleDir '*-setup.exe') -ErrorAction SilentlyContinue | Select-Object -First 1
  Write-Host ""
  Write-Host "낮은 버전(v$LowVersion) 빌드 완료." -ForegroundColor Green
  if ($installer) { Write-Host "  설치본: $($installer.FullName)" }
  Write-Host "  → 이 인스톨러로 설치 후, 설치된 앱을 실행해 '업데이트를 받는 쪽'으로 사용하세요."
  Write-Host "    (또는 무설치: src-tauri/target/release/retro-note.exe 직접 실행)"
  return
}

# Mode = serve : 인스톨러 + .sig 수집 → latest.json 생성 → 서버 기동
$installer = Get-ChildItem (Join-Path $bundleDir '*-setup.exe') -ErrorAction SilentlyContinue | Select-Object -First 1
$sig = Get-ChildItem (Join-Path $bundleDir '*-setup.exe.sig') -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $installer -or -not $sig) {
  throw "NSIS 인스톨러/.sig 를 못 찾음: $bundleDir (createUpdaterArtifacts + 서명 키 확인)"
}

if (Test-Path $serveDir) { Remove-Item $serveDir -Recurse -Force }
New-Item -ItemType Directory -Path $serveDir | Out-Null
Copy-Item $installer.FullName (Join-Path $serveDir $installer.Name)

$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$latest = [ordered]@{
  version   = $HighVersion
  notes     = "local e2e test build"
  pub_date  = $pubDate
  platforms = [ordered]@{
    # Windows 업데이터는 NSIS 인스톨러를 사용. macOS 라면 darwin-aarch64 / darwin-x86_64 +
    # .app.tar.gz 로 키/파일을 바꾸면 된다(동일 구조).
    "windows-x86_64" = [ordered]@{
      signature = (Get-Content $sig.FullName -Raw).Trim()
      url       = "http://localhost:$Port/$($installer.Name)"
    }
  }
}
($latest | ConvertTo-Json -Depth 10) | Set-Content (Join-Path $serveDir 'latest.json') -Encoding utf8

Write-Host ""
Write-Host "높은 버전(v$HighVersion) 서명 빌드 + latest.json 생성 완료." -ForegroundColor Green
Write-Host "  제공 폴더: $serveDir"
Write-Host "  latest.json + $($installer.Name)"
Write-Host ""
Write-Host "로컬 서버를 기동합니다 (Ctrl+C 로 종료). 그동안 낮은 버전 앱을 실행하세요." -ForegroundColor Yellow

# 로컬 HTTP 서버: python 우선, 없으면 npx serve 안내.
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
if ($python) {
  Push-Location $serveDir
  try { & $python.Source -m http.server $Port } finally { Pop-Location }
}
else {
  Write-Host "python 미설치. 다음 중 하나로 '$serveDir' 를 포트 $Port 로 서빙하세요:" -ForegroundColor Red
  Write-Host "  npx --yes http-server `"$serveDir`" -p $Port"
}
