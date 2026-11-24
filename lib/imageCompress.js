"use client";

// Shrinks a screenshot in the browser before upload: longest side ≤ 1600px,
// WebP (JPEG where WebP isn't supported), stepping quality down until it is
// under ~600 KB. Chart screenshots stay sharp at this size and a trade with
// a dozen of them still loads quickly.

const MAX_SIDE = 1600;
const TARGET_BYTES = 600 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name || "That file"} isn't an image the browser can read`));
    };
    img.src = url;
  });
}

const toBlob = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));

export async function compressImage(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  let type = "image/webp";
  let blob = await toBlob(canvas, type, 0.85);
  if (!blob || blob.type !== "image/webp") {
    type = "image/jpeg";
    blob = await toBlob(canvas, type, 0.85);
  }
  for (const q of [0.75, 0.65, 0.5]) {
    if (blob.size <= TARGET_BYTES) break;
    blob = await toBlob(canvas, type, q);
  }
  const data = await new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1]);
    fr.readAsDataURL(blob);
  });
  return { data, type, w, h, bytes: blob.size };
}
