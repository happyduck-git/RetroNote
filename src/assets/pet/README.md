# src/assets/pet — 펫 스프라이트 (로컬 배치)

펫 기능(issue #78)이 쓰는 고양이 스프라이트. **이 폴더의 `*.png` 는 `.gitignore` 로 레포에서 제외**된다.

## 왜 커밋하지 않나

- 출처: **ToffeeCraft — Cat Pack "Pochi"** (유료 에셋, `toffeecraft.itch.io/cat-retro`).
- 라이선스 요지: *상업/개인 사용 OK · 자유 편집 OK · **재배포/재판매 금지** · 게임 등 제작물 사용 OK*.
- 완성된 앱(릴리스 바이너리)에 넣어 배포하는 건 허용되지만, **원본 PNG 를 공개 레포에 그대로 올리는 건
  "재배포"로 해석될 수 있어** 커밋하지 않는다. (이 앱이 `src/config.local.js` 를 다루는 방식과 동일한 원칙.)

## 배치 방법 (로컬 개발)

구매한 번들에서 아래 스트립을 이 폴더로 복사한다. 모두 **높이 64px, 프레임 64×64 정사각**의 가로 스트립이다.

`CatMegaBundle/Pochi/Sprites/` 에서:

| 파일 | 용도(펫 상태) | 프레임 수 |
|---|---|---|
| `Idle.png` | idle (기본) | 6 |
| `Running.png` | walk (걷기, 느리게 재생) | 6 |
| `Sleeping.png` | sleep (Zzz) | 4 |
| `Surprised.png` | react (새 메시지 놀람) | 4 |

애니메이션 → 파일 매핑과 프레임 수는 `src/pet/sprite.js` 가 소유한다. 다른 색(Black/Grey/Orange/White)이나
다른 스트립으로 바꾸려면 그 파일들을 여기 두고 `sprite.js` 상수만 고치면 된다.

## 릴리스(CI)

배포 빌드에서는 이 PNG 들을 비공개 위치(또는 GitHub Secret/아티팩트)에서 빌드 전에 이 폴더로 주입한다
— `config.local.js` 를 CI 가 주입하는 것과 같은 패턴. (릴리스 워크플로 배선은 실제 릴리스 전에 추가.)
