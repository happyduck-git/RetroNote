// 이미지 첨부 처리: 검증 → (정지 이미지 한정) 다운스케일 → Supabase Storage 업로드.
// GIF 는 애니메이션 보존 위해 리사이즈 없이 그대로 업로드. 외부(Tenor) GIF 는 이 파일을 경유하지 않는다.
//
// 반환 envelope: { url, kind, mime, width, height, bytes } — message 의 attachment_* 컬럼에 그대로 박힘.
// 실패 시 throw — 호출 측(room-view.doSend)이 메시지 전송 자체를 중단한다.

import { getClient } from "../auth/auth.js";

const BUCKET = "chat-uploads";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MiB. Storage 버킷의 file_size_limit 과 동일.
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
// 정지 이미지의 긴 변 임계값. 초과 시 Canvas 다운스케일 + JPEG 0.85 재인코딩.
// 채팅 UI 가 max-width: 31% + image-rendering: pixelated 로 작은 이미지를 청키하게 업스케일
// 표시하므로, 저장은 작게 가도 Retina/DPR 손해보다 픽셀 그레인이 살아나는 이득이 크다.
// 341 = 512 × 2/3 — display max-width 와 동일 비율로 동조시킨 값.
// GIF 는 이 임계값과 무관 — 애니메이션 보존을 위해 원본 그대로 업로드한다.
const DOWNSCALE_LONG_EDGE = 341;
const JPEG_QUALITY = 0.85;

const MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export const ATTACHMENT_LIMITS = { MAX_BYTES, ALLOWED, DOWNSCALE_LONG_EDGE };

// 사용자에게 보여 줄 친절한 에러 메시지를 throw 한다. catch 측에서 .message 그대로 alert/표시 가능.
function reject(reason) {
  throw new Error(reason);
}

// File 객체를 받아 <img> + objectURL 로 디코드 → 자연 해상도 반환.
// objectURL 은 호출 측에서 해제 책임(이 함수는 내부에서 만들고 해제).
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      URL.revokeObjectURL(url);
      resolve({ img, width: w, height: h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 읽을 수 없습니다"));
    };
    img.src = url;
  });
}

// (w, h) → 긴 변이 longEdge 이하가 되도록 등비 축소.
export function pickTargetSize(w, h, longEdge = DOWNSCALE_LONG_EDGE) {
  const longer = Math.max(w, h);
  if (longer <= longEdge) return { w, h, scaled: false };
  const ratio = longEdge / longer;
  return {
    w: Math.round(w * ratio),
    h: Math.round(h * ratio),
    scaled: true,
  };
}

// Canvas 로 다운스케일 + JPEG 재인코딩 → Blob. 알파 채널이 있으면 PNG 로 떨어지지만
// 정지 이미지에 알파를 유지할 필요가 크지 않아 JPEG 단일화(파일 크기 작게).
function canvasToJpeg(img, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  // JPEG 는 알파가 없으므로 투명 부분은 흰색으로 깔아 둔다(검은 배경 방지).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("이미지 인코딩 실패"))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

// File → { blob, mime, width, height, bytes } 정규화.
// GIF: 검증만 통과하면 원본 그대로(애니메이션 보존). 디코드는 첫 프레임으로만 한다.
// 정지 이미지: 큰 경우 다운스케일 + JPEG. 작으면 원본 그대로.
async function normalize(file) {
  if (!ALLOWED.has(file.type)) reject(`지원하지 않는 형식입니다 (${file.type || "unknown"})`);
  if (file.size > MAX_BYTES) reject(`파일이 너무 큽니다 (최대 ${Math.round(MAX_BYTES / 1024 / 1024)}MB)`);

  const { img, width, height } = await loadImage(file);

  if (file.type === "image/gif") {
    return { blob: file, mime: "image/gif", width, height, bytes: file.size };
  }

  const target = pickTargetSize(width, height);
  if (!target.scaled) {
    return { blob: file, mime: file.type, width, height, bytes: file.size };
  }
  const blob = await canvasToJpeg(img, target.w, target.h);
  return { blob, mime: "image/jpeg", width: target.w, height: target.h, bytes: blob.size };
}

// 객체 경로 규약: `<room_code>/<uuid>.<ext>` — Storage RLS 정책이 split_part(name,'/',1) 로
// room_code 를 추출해 is_room_member 검증한다.
function makePath(roomCode, mime) {
  const ext = MIME_EXT[mime] || "bin";
  return `${roomCode}/${crypto.randomUUID()}.${ext}`;
}

// 메인 진입점. File 을 받아 검증·다운스케일·업로드 후 메시지에 박을 envelope 반환.
// kind 는 항상 'image' — 'gif_external' 은 Tenor 경로(별도 모듈)가 직접 만든다.
export async function uploadAttachment(file, roomCode) {
  const norm = await normalize(file);
  const client = await getClient();
  const path = makePath(roomCode, norm.mime);

  const { error } = await client.storage
    .from(BUCKET)
    .upload(path, norm.blob, {
      contentType: norm.mime,
      cacheControl: "31536000", // public read + 큰 캐시 TTL — 객체는 immutable(같은 UUID 재사용 없음)
      upsert: false,
    });
  if (error) throw error;

  const { data } = client.storage.from(BUCKET).getPublicUrl(path);
  return {
    url: data.publicUrl,
    kind: "image",
    mime: norm.mime,
    width: norm.width,
    height: norm.height,
    bytes: norm.bytes,
  };
}
