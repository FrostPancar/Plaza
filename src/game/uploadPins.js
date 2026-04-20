const MAX_FILE_SIZE_DEFAULT = 5 * 1024 * 1024;
const MAX_FILE_SIZE_OBJ = 50 * 1024 * 1024;
const MAX_FILE_SIZE_STL = 50 * 1024 * 1024;
const MAX_FILE_SIZE_MEDIA = 10 * 1024 * 1024;
const FILE_PIN_RADIUS = 6;
const GRAFFITI_PIN_RADIUS = 8;
const AUDIO_RADIUS_MULTIPLIER = 4;
const FOLDER_PIN_RADIUS = 4;
const MEDIA_PREVIEW_ACTIVE_DISTANCE = 28;
const MODEL_DEFAULT_COLOR = "#cad9f7";
const AIM_RAYCAST_INTERVAL = 1 / 24;
let mediaSourceHost = null;

const SUPPORTED_TYPES = {
  "audio/mpeg": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "audio/m4a": "audio",
  "audio/mp4": "audio",
  "audio/flac": "audio",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xlsx",
  "text/csv": "csv",
  "text/markdown": "md",
  "application/json": "json",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/x-rar-compressed": "rar",
  "application/x-7z-compressed": "7z",
  "model/gltf-binary": "glb",
  "model/gltf+json": "gltf",
  "model/fbx": "fbx",
  "text/plain": "txt",
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/avif": "image",
  "image/heic": "image",
  "image/gif": "gif",
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "video/x-matroska": "video",
  "model/obj": "obj",
  "model/stl": "stl",
  "application/sla": "stl",
  "application/vnd.ms-pki.stl": "stl",
};

function getFileType(file) {
  if (SUPPORTED_TYPES[file.type]) return SUPPORTED_TYPES[file.type];
  const name = file.name.toLowerCase();
  if (name.endsWith(".mp3")) return "audio";
  if (name.endsWith(".wav") || name.endsWith(".m4a") || name.endsWith(".flac")) return "audio";
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".pptx") || name.endsWith(".key")) return "pptx";
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "xlsx";
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".md")) return "md";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".zip")) return "zip";
  if (name.endsWith(".rar")) return "rar";
  if (name.endsWith(".7z")) return "7z";
  if (name.endsWith(".gltf")) return "gltf";
  if (name.endsWith(".glb")) return "glb";
  if (name.endsWith(".fbx")) return "fbx";
  if (name.endsWith(".psd")) return "psd";
  if (name.endsWith(".ai")) return "ai";
  if (name.endsWith(".fig")) return "fig";
  if (name.endsWith(".js")) return "js";
  if (name.endsWith(".ts")) return "ts";
  if (name.endsWith(".py")) return "py";
  if (name.endsWith(".txt")) return "txt";
  if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".webp") || name.endsWith(".avif") || name.endsWith(".heic")) return "image";
  if (name.endsWith(".gif")) return "gif";
  if (name.endsWith(".mp4") || name.endsWith(".webm") || name.endsWith(".mov") || name.endsWith(".mkv")) return "video";
  if (name.endsWith(".obj")) return "obj";
  if (name.endsWith(".stl")) return "stl";
  return "file";
}

function getMaxSizeForType(fileType) {
  if (fileType === "obj") return MAX_FILE_SIZE_OBJ;
  if (fileType === "stl") return MAX_FILE_SIZE_STL;
  if (fileType === "video" || fileType === "gif") return MAX_FILE_SIZE_MEDIA;
  return MAX_FILE_SIZE_DEFAULT;
}

function dataUrlToArrayBuffer(dataUrl) {
  const raw = String(dataUrl || "");
  const commaIndex = raw.indexOf(",");
  if (commaIndex < 0) throw new Error("Invalid data URL");
  const header = raw.slice(0, commaIndex);
  const payload = raw.slice(commaIndex + 1);

  if (/;base64/i.test(header)) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  return new TextEncoder().encode(decodeURIComponent(payload)).buffer;
}

function parseBinarySTLToGeometry(THREE, buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 84) throw new Error("Invalid binary STL");
  const triangleCount = view.getUint32(80, true);
  const expectedLen = 84 + triangleCount * 50;
  if (expectedLen > view.byteLength) throw new Error("Truncated binary STL");

  const positions = new Float32Array(triangleCount * 9);
  let inOffset = 84;
  let outOffset = 0;

  for (let i = 0; i < triangleCount; i += 1) {
    inOffset += 12; // skip normal
    for (let v = 0; v < 3; v += 1) {
      positions[outOffset++] = view.getFloat32(inOffset, true);
      positions[outOffset++] = view.getFloat32(inOffset + 4, true);
      positions[outOffset++] = view.getFloat32(inOffset + 8, true);
      inOffset += 12;
    }
    inOffset += 2; // attribute byte count
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function parseAsciiSTLToGeometry(THREE, text) {
  const pattern = /vertex\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/g;
  const verts = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    verts.push(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  if (verts.length < 9 || verts.length % 9 !== 0) throw new Error("Invalid ASCII STL");
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function parseSTLGeometry(THREE, dataUrl) {
  const buffer = dataUrlToArrayBuffer(dataUrl);
  const bytes = new Uint8Array(buffer);
  const headerSample = new TextDecoder().decode(bytes.subarray(0, Math.min(512, bytes.length))).trimStart();
  const looksAscii = headerSample.startsWith("solid") && headerSample.includes("facet");
  if (looksAscii) {
    try {
      const text = new TextDecoder().decode(bytes);
      return parseAsciiSTLToGeometry(THREE, text);
    } catch {
      return parseBinarySTLToGeometry(THREE, buffer);
    }
  }
  return parseBinarySTLToGeometry(THREE, buffer);
}

function dataUrlToText(dataUrl) {
  const raw = String(dataUrl || "");
  const commaIndex = raw.indexOf(",");
  if (commaIndex < 0) throw new Error("Invalid data URL");
  const header = raw.slice(0, commaIndex);
  const payload = raw.slice(commaIndex + 1);
  if (/;base64/i.test(header)) return atob(payload);
  return decodeURIComponent(payload);
}

function parseOBJGeometry(THREE, dataUrl) {
  const source = dataUrlToText(dataUrl);
  const lines = source.split(/\r?\n/);
  const points = [];
  const faceIndices = [];

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("v ")) {
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        points.push([x, y, z]);
      }
      continue;
    }
    if (!line.startsWith("f ")) continue;
    const tokens = line.slice(2).trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 3) continue;
    const parsed = [];
    for (const token of tokens) {
      const first = token.split("/")[0];
      const idx = Number.parseInt(first, 10);
      if (!Number.isFinite(idx) || idx === 0) continue;
      const resolved = idx > 0 ? idx - 1 : points.length + idx;
      if (resolved >= 0 && resolved < points.length) parsed.push(resolved);
    }
    if (parsed.length < 3) continue;
    for (let i = 1; i < parsed.length - 1; i += 1) {
      faceIndices.push(parsed[0], parsed[i], parsed[i + 1]);
    }
  }

  if (!faceIndices.length) throw new Error("Invalid OBJ");

  const positions = new Float32Array(faceIndices.length * 3);
  let out = 0;
  for (const idx of faceIndices) {
    const p = points[idx];
    positions[out++] = p[0];
    positions[out++] = p[1];
    positions[out++] = p[2];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function normalizeModelGeometry(THREE, geometry, targetMaxDim = 2.4) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const scale = targetMaxDim / maxDim;
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();
  const scaled = geometry.boundingBox;
  const center = new THREE.Vector3();
  scaled.getCenter(center);
  geometry.translate(-center.x, -scaled.min.y, -center.z);
  geometry.computeBoundingBox();
  const outSize = new THREE.Vector3();
  geometry.boundingBox.getSize(outSize);
  return outSize;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

async function readImageThumbnailDataUrl(file, maxEdge = 280) {
  const source = await readAsDataUrl(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const srcW = Math.max(1, img.naturalWidth || img.width || 1);
      const srcH = Math.max(1, img.naturalHeight || img.height || 1);
      const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
      const outW = Math.max(1, Math.round(srcW * scale));
      const outH = Math.max(1, Math.round(srcH * scale));
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, outW, outH);
      ctx.drawImage(img, 0, 0, outW, outH);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => resolve(source);
    img.src = source;
  });
}

function createIconCanvas(label, bg, fg) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = bg;
  ctx.fillRect(10, 10, 108, 108);

  ctx.fillStyle = fg;
  ctx.font = "bold 40px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 64, 70);

  return canvas;
}

function createMacFolderAudioCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 140;
  const ctx = canvas.getContext("2d");

  const topGrad = ctx.createLinearGradient(0, 12, 0, 54);
  topGrad.addColorStop(0, "#bfe8ff");
  topGrad.addColorStop(1, "#8fd4ff");
  ctx.fillStyle = topGrad;
  ctx.fillRect(18, 20, 82, 26);

  const bodyGrad = ctx.createLinearGradient(0, 40, 0, 124);
  bodyGrad.addColorStop(0, "#89d0ff");
  bodyGrad.addColorStop(1, "#66bfff");
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(14, 36, 164, 86);

  ctx.strokeStyle = "rgba(20,72,120,0.45)";
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 36, 164, 86);

  ctx.fillStyle = "#1d5f96";
  ctx.font = "bold 44px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("♪", 96, 79);

  return canvas;
}

function createRoundedImageTexture(THREE, imageLoader, dataUrl, width = 512, height = 360, radius = 38, backgroundColor = "") {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData = { aspect: width / height };
  texture.needsUpdate = true;

  imageLoader.load(
    dataUrl,
    (imgTexture) => {
      const image = imgTexture.image;
      if (!image) return;
      texture.userData.aspect = image.width / Math.max(image.height, 1);
      ctx.clearRect(0, 0, width, height);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(radius, 0);
      ctx.lineTo(width - radius, 0);
      ctx.quadraticCurveTo(width, 0, width, radius);
      ctx.lineTo(width, height - radius);
      ctx.quadraticCurveTo(width, height, width - radius, height);
      ctx.lineTo(radius, height);
      ctx.quadraticCurveTo(0, height, 0, height - radius);
      ctx.lineTo(0, radius);
      ctx.quadraticCurveTo(0, 0, radius, 0);
      ctx.closePath();
      ctx.clip();
      if (backgroundColor) {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, width, height);
      }

      const scale = Math.max(width / image.width, height / image.height);
      const drawW = image.width * scale;
      const drawH = image.height * scale;
      const dx = (width - drawW) / 2;
      const dy = (height - drawH) / 2;
      ctx.drawImage(image, dx, dy, drawW, drawH);
      ctx.restore();
      texture.needsUpdate = true;
    },
    undefined,
    () => {}
  );

  return texture;
}

function drawRoundedMediaFrame(ctx, source, width, height, radius = 38) {
  if (!source) return;
  const sw = source.videoWidth || source.naturalWidth || source.width || width;
  const sh = source.videoHeight || source.naturalHeight || source.height || height;
  if (!sw || !sh) return;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(width - radius, 0);
  ctx.quadraticCurveTo(width, 0, width, radius);
  ctx.lineTo(width, height - radius);
  ctx.quadraticCurveTo(width, height, width - radius, height);
  ctx.lineTo(radius, height);
  ctx.quadraticCurveTo(0, height, 0, height - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.clip();
  const scale = Math.max(width / sw, height / sh);
  const drawW = sw * scale;
  const drawH = sh * scale;
  ctx.drawImage(source, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
  ctx.restore();
}

function createLiveMediaTexture(THREE, dataUrl, mediaType = "video", width = 512, height = 360, radius = 38) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData = { aspect: width / height };
  texture.needsUpdate = true;

  let source = null;
  let active = true;
  let wasPlayingBeforeSleep = false;

  if (mediaType === "video") {
    const video = document.createElement("video");
    video.src = dataUrl;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.preload = "auto";
    video.addEventListener("loadedmetadata", () => {
      texture.userData.aspect = (video.videoWidth || width) / Math.max(video.videoHeight || height, 1);
    });
    video.play().catch(() => {});
    attachMediaSource(video);
    source = video;
  } else {
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.onload = () => {
      texture.userData.aspect = (img.naturalWidth || width) / Math.max(img.naturalHeight || height, 1);
    };
    img.src = dataUrl;
    attachMediaSource(img);
    source = img;
  }

  return {
    texture,
    setActive(next) {
      if (mediaType === "gif") {
        active = true;
        return;
      }
      active = Boolean(next);
      if (mediaType !== "video" || !source) return;
      if (active) {
        if (wasPlayingBeforeSleep && source.paused) source.play().catch(() => {});
      } else if (!source.paused) {
        wasPlayingBeforeSleep = true;
        source.pause();
      }
    },
    update() {
      if (!active || !source) return;
      if (mediaType === "video" && source.readyState < 2) return;
      drawRoundedMediaFrame(ctx, source, width, height, radius);
      texture.needsUpdate = true;
    },
    dispose() {
      active = false;
      if (source && source.tagName === "VIDEO") {
        wasPlayingBeforeSleep = false;
        source.pause();
        source.removeAttribute("src");
        source.load?.();
      }
      detachMediaSource(source);
    },
  };
}

function ensureMediaSourceHost() {
  if (mediaSourceHost) return mediaSourceHost;
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-99999px";
  host.style.top = "-99999px";
  host.style.width = "1px";
  host.style.height = "1px";
  host.style.opacity = "0";
  host.style.pointerEvents = "none";
  host.style.overflow = "hidden";
  document.body.appendChild(host);
  mediaSourceHost = host;
  return mediaSourceHost;
}

function attachMediaSource(node) {
  if (!node) return;
  const host = ensureMediaSourceHost();
  if (node.parentElement !== host) host.appendChild(node);
}

function detachMediaSource(node) {
  if (!node || !node.parentElement) return;
  if (node.parentElement === mediaSourceHost) mediaSourceHost.removeChild(node);
}

function createDocumentThumbnailTexture(THREE, kind, fileName, width = 612, height = 792, radius = 38) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const safeKind = String(kind || "PDF").toUpperCase();
  const accentByKind = {
    PDF: "#a12d2d",
    DOCX: "#2c5fa8",
    TXT: "#42614a",
    PPTX: "#b75d1f",
    XLSX: "#237a4a",
    CSV: "#1f7b58",
    MD: "#5a6472",
    JSON: "#50697f",
    CODE: "#47537f",
  };
  const accent = accentByKind[safeKind] || "#a12d2d";
  const fg = safeKind === "TXT" ? "#e8fff0" : "#fff1f1";

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(width - radius, 0);
  ctx.quadraticCurveTo(width, 0, width, radius);
  ctx.lineTo(width, height - radius);
  ctx.quadraticCurveTo(width, height, width - radius, height);
  ctx.lineTo(radius, height);
  ctx.quadraticCurveTo(0, height, 0, height - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.clip();

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#f7f8fc");
  bg.addColorStop(1, "#dfe5ef");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, width, 78);
  ctx.fillStyle = fg;
  ctx.font = "bold 38px 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(safeKind, 28, 39);

  ctx.fillStyle = "#2a3340";
  ctx.font = "600 26px 'Segoe UI', sans-serif";
  const safeName = (fileName || "document.pdf").slice(0, 30);
  ctx.fillText(safeName, 24, 132);

  ctx.strokeStyle = "rgba(70,85,102,0.24)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 10; i++) {
    const y = 168 + i * 16;
    ctx.beginPath();
    ctx.moveTo(24, y);
    ctx.lineTo(width - 24, y);
    ctx.stroke();
  }
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData = { aspect: width / height };
  return texture;
}

function createPdfThumbnailTexture(THREE, fileName, width = 612, height = 792, radius = 38) {
  return createDocumentThumbnailTexture(THREE, "PDF", fileName, width, height, radius);
}

function createDocxThumbnailTexture(THREE, fileName, width = 612, height = 792, radius = 38) {
  return createDocumentThumbnailTexture(THREE, "DOCX", fileName, width, height, radius);
}

function createTxtThumbnailTexture(THREE, fileName, width = 612, height = 792, radius = 38) {
  return createDocumentThumbnailTexture(THREE, "TXT", fileName, width, height, radius);
}

function createPptxThumbnailTexture(THREE, fileName, width = 612, height = 792, radius = 38) {
  return createDocumentThumbnailTexture(THREE, "PPTX", fileName, width, height, radius);
}

function createXlsxThumbnailTexture(THREE, fileName, width = 612, height = 792, radius = 38) {
  return createDocumentThumbnailTexture(THREE, "XLSX", fileName, width, height, radius);
}

function createCsvThumbnailTexture(THREE, fileName, width = 612, height = 792, radius = 38) {
  return createDocumentThumbnailTexture(THREE, "CSV", fileName, width, height, radius);
}

function createMdThumbnailTexture(THREE, fileName, width = 612, height = 792, radius = 38) {
  return createDocumentThumbnailTexture(THREE, "MD", fileName, width, height, radius);
}

function createJsonThumbnailTexture(THREE, fileName, width = 612, height = 792, radius = 38) {
  return createDocumentThumbnailTexture(THREE, "JSON", fileName, width, height, radius);
}

function createCodeThumbnailTexture(THREE, fileName, width = 612, height = 792, radius = 38) {
  return createDocumentThumbnailTexture(THREE, "CODE", fileName, width, height, radius);
}

const DOCUMENT_THUMB_TYPES = new Set(["pdf", "docx", "txt", "pptx", "xlsx", "csv", "md", "json", "js", "ts", "py"]);

function createDocumentTypeTexture(THREE, fileType, fileName, width = 612, height = 792, radius = 38) {
  if (fileType === "pdf") return createPdfThumbnailTexture(THREE, fileName, width, height, radius);
  if (fileType === "docx") return createDocxThumbnailTexture(THREE, fileName, width, height, radius);
  if (fileType === "txt") return createTxtThumbnailTexture(THREE, fileName, width, height, radius);
  if (fileType === "pptx") return createPptxThumbnailTexture(THREE, fileName, width, height, radius);
  if (fileType === "xlsx") return createXlsxThumbnailTexture(THREE, fileName, width, height, radius);
  if (fileType === "csv") return createCsvThumbnailTexture(THREE, fileName, width, height, radius);
  if (fileType === "md") return createMdThumbnailTexture(THREE, fileName, width, height, radius);
  if (fileType === "json") return createJsonThumbnailTexture(THREE, fileName, width, height, radius);
  if (fileType === "js" || fileType === "ts" || fileType === "py") {
    return createCodeThumbnailTexture(THREE, fileName, width, height, radius);
  }
  return null;
}

function pinTypeToIcon(pinType) {
  if (pinType === "audio") return { macFolder: true };
  if (pinType === "pdf") return { text: "PDF", bg: "#6d2f2f", fg: "#ffe3e3" };
  if (pinType === "docx") return { text: "DOCX", bg: "#2c5fa8", fg: "#e6efff" };
  if (pinType === "pptx") return { text: "PPTX", bg: "#b75d1f", fg: "#fff1e5" };
  if (pinType === "xlsx") return { text: "XLSX", bg: "#237a4a", fg: "#e9fff3" };
  if (pinType === "csv") return { text: "CSV", bg: "#1f7b58", fg: "#e8fff4" };
  if (pinType === "md") return { text: "MD", bg: "#5a6472", fg: "#eef2fa" };
  if (pinType === "json") return { text: "JSON", bg: "#50697f", fg: "#e9f2ff" };
  if (pinType === "txt") return { text: "TXT", bg: "#42614a", fg: "#e8fff0" };
  if (pinType === "zip") return { text: "ZIP", bg: "#5a4a2f", fg: "#fff3df" };
  if (pinType === "rar") return { text: "RAR", bg: "#59407b", fg: "#f0e6ff" };
  if (pinType === "7z") return { text: "7Z", bg: "#3d4e66", fg: "#ebf3ff" };
  if (pinType === "video") return { text: "VID", bg: "#2f3b6d", fg: "#dfe4ff" };
  if (pinType === "gif") return { text: "GIF", bg: "#3b2f6d", fg: "#e7ddff" };
  if (pinType === "gltf" || pinType === "glb" || pinType === "fbx") return { text: "3D", bg: "#2d4f6d", fg: "#def3ff" };
  if (pinType === "psd") return { text: "PSD", bg: "#1c4f7c", fg: "#dff4ff" };
  if (pinType === "ai") return { text: "AI", bg: "#7f4e1e", fg: "#fff1de" };
  if (pinType === "fig") return { text: "FIG", bg: "#7d255f", fg: "#ffe5f6" };
  if (pinType === "js") return { text: "JS", bg: "#7a6b1f", fg: "#fff9de" };
  if (pinType === "ts") return { text: "TS", bg: "#2a4f8a", fg: "#e3ecff" };
  if (pinType === "py") return { text: "PY", bg: "#3d5f4f", fg: "#e9fff3" };
  if (pinType === "obj") return { text: "OBJ", bg: "#2d4f6d", fg: "#def3ff" };
  if (pinType === "stl") return { text: "STL", bg: "#1f4f6f", fg: "#ddf6ff" };
  if (pinType === "folder") return { text: "DIR", bg: "#2b4e63", fg: "#e2f5ff" };
  if (pinType === "decorate") return { text: "DEC", bg: "#375033", fg: "#e7ffe6" };
  if (pinType === "graffiti") return { text: "ART", bg: "#5a2f68", fg: "#f2dcff" };
  return { text: "FILE", bg: "#4a5058", fg: "#eef2f8" };
}

function inferFolderEntryType(name, mimeType) {
  const safeMime = String(mimeType || "").toLowerCase();
  const safeName = String(name || "").toLowerCase();
  if (safeMime.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(safeName)) return "image";
  if (safeMime.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/.test(safeName)) return "video";
  if (safeMime.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|flac)$/.test(safeName)) return "audio";
  if (safeMime === "application/pdf" || /\.pdf$/.test(safeName)) return "pdf";
  if (
    safeMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx$/.test(safeName)
  ) {
    return "docx";
  }
  if (safeMime === "text/plain" || /\.txt$/.test(safeName)) return "txt";
  if (
    safeMime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    /\.pptx$/.test(safeName) ||
    /\.key$/.test(safeName)
  ) {
    return "pptx";
  }
  if (
    safeMime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    safeMime === "application/vnd.ms-excel" ||
    /\.xlsx?$/.test(safeName)
  ) {
    return "xlsx";
  }
  if (safeMime === "text/csv" || /\.csv$/.test(safeName)) return "csv";
  if (safeMime === "text/markdown" || /\.md$/.test(safeName)) return "md";
  if (safeMime === "application/json" || /\.json$/.test(safeName)) return "json";
  if (/\.js$/.test(safeName)) return "js";
  if (/\.ts$/.test(safeName)) return "ts";
  if (/\.py$/.test(safeName)) return "py";
  if (/\.zip$/.test(safeName)) return "zip";
  if (/\.rar$/.test(safeName)) return "rar";
  if (/\.7z$/.test(safeName)) return "7z";
  if (/\.gltf$/.test(safeName)) return "gltf";
  if (/\.glb$/.test(safeName)) return "glb";
  if (/\.fbx$/.test(safeName)) return "fbx";
  if (/\.psd$/.test(safeName)) return "psd";
  if (/\.ai$/.test(safeName)) return "ai";
  if (/\.fig$/.test(safeName)) return "fig";
  if (safeMime.includes("zip") || /\.(zip|rar|7z|tar|gz)$/.test(safeName)) return "archive";
  if (safeMime.includes("json") || /\.(txt|md|json|xml|csv|log)$/.test(safeName)) return "text";
  if (safeMime.includes("model") || /\.(obj|stl|fbx|gltf|glb)$/.test(safeName)) return "model";
  return "file";
}

function folderEntryIcon(entryType) {
  if (entryType === "image") return { text: "IMG", bg: "#31544a", fg: "#e6fff4" };
  if (entryType === "video") return { text: "VID", bg: "#2f3b6d", fg: "#dfe4ff" };
  if (entryType === "audio") return { text: "AUD", bg: "#365b72", fg: "#e2f4ff" };
  if (entryType === "pdf") return { text: "PDF", bg: "#6d2f2f", fg: "#ffe3e3" };
  if (entryType === "docx") return { text: "DOCX", bg: "#2c5fa8", fg: "#e6efff" };
  if (entryType === "pptx") return { text: "PPTX", bg: "#b75d1f", fg: "#fff1e5" };
  if (entryType === "xlsx") return { text: "XLSX", bg: "#237a4a", fg: "#e9fff3" };
  if (entryType === "csv") return { text: "CSV", bg: "#1f7b58", fg: "#e8fff4" };
  if (entryType === "md") return { text: "MD", bg: "#5a6472", fg: "#eef2fa" };
  if (entryType === "json") return { text: "JSON", bg: "#50697f", fg: "#e9f2ff" };
  if (entryType === "js") return { text: "JS", bg: "#7a6b1f", fg: "#fff9de" };
  if (entryType === "ts") return { text: "TS", bg: "#2a4f8a", fg: "#e3ecff" };
  if (entryType === "py") return { text: "PY", bg: "#3d5f4f", fg: "#e9fff3" };
  if (entryType === "txt") return { text: "TXT", bg: "#42614a", fg: "#e8fff0" };
  if (entryType === "archive") return { text: "ZIP", bg: "#5a4a2f", fg: "#fff3df" };
  if (entryType === "zip") return { text: "ZIP", bg: "#5a4a2f", fg: "#fff3df" };
  if (entryType === "rar") return { text: "RAR", bg: "#59407b", fg: "#f0e6ff" };
  if (entryType === "7z") return { text: "7Z", bg: "#3d4e66", fg: "#ebf3ff" };
  if (entryType === "text") return { text: "TXT", bg: "#404a57", fg: "#eff5ff" };
  if (entryType === "gltf" || entryType === "glb" || entryType === "fbx") return { text: "3D", bg: "#2d4f6d", fg: "#def3ff" };
  if (entryType === "psd") return { text: "PSD", bg: "#1c4f7c", fg: "#dff4ff" };
  if (entryType === "ai") return { text: "AI", bg: "#7f4e1e", fg: "#fff1de" };
  if (entryType === "fig") return { text: "FIG", bg: "#7d255f", fg: "#ffe5f6" };
  if (entryType === "model") return { text: "3D", bg: "#2d4f6d", fg: "#def3ff" };
  return { text: "FILE", bg: "#4a5058", fg: "#eef2f8" };
}

function folderEntrySortRank(entryType) {
  const type = String(entryType || "").toLowerCase();
  if (type === "image") return 0;
  if (type === "video") return 1;
  if (type === "audio") return 2;
  if (type === "pdf") return 3;
  if (type === "docx" || type === "txt" || type === "pptx" || type === "xlsx" || type === "csv") return 3;
  if (type === "md" || type === "json" || type === "js" || type === "ts" || type === "py") return 3;
  if (type === "model") return 4;
  if (type === "text") return 5;
  if (type === "archive") return 6;
  return 7;
}

function createFolderEntryCardTexture(THREE, entryName, entryType, size = 320) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const icon = folderEntryIcon(entryType);
  const corner = Math.round(size * 0.12);
  const inset = Math.max(8, Math.round(size * 0.03));

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  roundedRectPath(ctx, inset, inset, size - inset * 2, size - inset * 2, corner);
  ctx.clip();

  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, icon.bg);
  grad.addColorStop(1, "#111822");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  ctx.restore();
  ctx.strokeStyle = "rgba(230,240,255,0.24)";
  ctx.lineWidth = Math.max(2, Math.round(size * 0.012));
  roundedRectPath(ctx, inset, inset, size - inset * 2, size - inset * 2, corner);
  ctx.stroke();
  ctx.fillStyle = icon.fg;
  ctx.font = `700 ${Math.round(size * 0.22)}px Space Grotesk, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(icon.text, size / 2, size * 0.42);
  ctx.font = `600 ${Math.round(size * 0.062)}px Space Grotesk, sans-serif`;
  const safeName = String(entryName || "item").slice(0, 18).toUpperCase();
  ctx.fillText(safeName, size / 2, size * 0.74);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function sortFolderEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return [...entries].sort((a, b) => {
    const typeDiff = folderEntrySortRank(a?.entryType) - folderEntrySortRank(b?.entryType);
    if (typeDiff !== 0) return typeDiff;
    return String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { sensitivity: "base" });
  });
}

function uid() {
  return `pin_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function distance2D(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function normalizeHexColor(value, fallback = MODEL_DEFAULT_COLOR) {
  const raw = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  return fallback;
}

function faceWorldDimensions(hit) {
  const dims = hit.object.userData.paintable?.dimensions;
  if (!dims) return { u: 1, v: 1 };

  const n = hit.face?.normal;
  if (!n) return { u: Math.max(dims.x, 1), v: Math.max(dims.z, 1) };

  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);

  if (ay >= ax && ay >= az) return { u: Math.max(dims.x, 1), v: Math.max(dims.z, 1) };
  if (ax >= ay && ax >= az) return { u: Math.max(dims.z, 1), v: Math.max(dims.y, 1) };
  return { u: Math.max(dims.x, 1), v: Math.max(dims.y, 1) };
}

function createLayerCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  return { canvas, ctx };
}

function createFocusFrameTexture(THREE, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const margin = Math.round(size * 0.08);
  const line = Math.max(6, Math.round(size * 0.03));
  const radius = Math.round(size * 0.08);

  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = "#8fe6ff";
  ctx.lineWidth = line;
  ctx.shadowColor = "rgba(108, 212, 255, 0.9)";
  ctx.shadowBlur = Math.round(size * 0.05);
  roundedRectPath(ctx, margin, margin, size - margin * 2, size - margin * 2, radius);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createAudioToggleTexture(THREE, playing, size = 180) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(8, 10, 14, 0.56)";
  ctx.fill();
  ctx.lineWidth = Math.max(3, size * 0.02);
  ctx.strokeStyle = "rgba(214, 224, 236, 0.9)";
  ctx.stroke();

  ctx.fillStyle = "#f4f7fc";
  if (playing) {
    const w = size * 0.09;
    const h = size * 0.27;
    const gap = size * 0.07;
    ctx.fillRect(size / 2 - gap - w, size / 2 - h, w, h * 2);
    ctx.fillRect(size / 2 + gap, size / 2 - h, w, h * 2);
  } else {
    ctx.beginPath();
    ctx.moveTo(size * 0.43, size * 0.35);
    ctx.lineTo(size * 0.43, size * 0.65);
    ctx.lineTo(size * 0.67, size * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function refreshAudioToggleTexture(pin) {
  if (!pin?.audioToggleMesh?.material) return;
  const playing = Boolean(pin.audio && !pin.audio.paused);
  if (pin.audioButtonPlaying === playing) return;
  const next = createAudioToggleTexture(pin.audioToggleMesh.userData.THREE, playing);
  const prev = pin.audioToggleMesh.material.map;
  pin.audioToggleMesh.material.map = next;
  pin.audioToggleMesh.material.needsUpdate = true;
  prev?.dispose?.();
  pin.audioButtonPlaying = playing;
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function createUploadPinManager({
  THREE,
  scene,
  camera,
  overlay,
  drawables,
  onPinsChanged,
  onError,
  onGraffitiRadiusChange,
  getOwnerIdentity,
}) {
  const pinGroup = new THREE.Group();
  scene.add(pinGroup);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const focusOffset = new THREE.Vector3();
  const scaleScratch = new THREE.Vector3();
  const barRightScratch = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);

  const iconTextures = new Map();
  const imageLoader = new THREE.TextureLoader();
  const focusFrameTexture = createFocusFrameTexture(THREE);
  const iconMeshes = [];
  const buttonMeshes = [];
  const pins = [];
  const lastStrokeBySurface = new Map();
  const paintSurfaceState = new Map();
  const graffitiLayersByPin = new Map();
  let elapsedTime = 0;
  let lastPlayerPosition = { x: 0, y: 0, z: 0 };
  let activeDecoratePin = null;
  let rWasDown = false;
  let enterWasDown = false;
  let aimRaycastCooldown = 0;
  let cachedAimedPinId = null;
  let cachedAimedButtonPinId = null;

  let paintColor = "#ff4d4d";
  let brushSizeWorld = 0.45;
  let activeGraffitiPin = null;

  for (const drawable of drawables) {
    const paintable = drawable?.userData?.paintable;
    if (!paintable?.id) continue;
    const base = createLayerCanvas(paintable.canvas.width, paintable.canvas.height);
    base.ctx.drawImage(paintable.canvas, 0, 0);
    paintSurfaceState.set(paintable.id, {
      paintable,
      baseCanvas: base.canvas,
    });
  }

  function getSurfaceState(surfaceId, paintable) {
    if (paintSurfaceState.has(surfaceId)) return paintSurfaceState.get(surfaceId);
    const base = createLayerCanvas(paintable.canvas.width, paintable.canvas.height);
    base.ctx.drawImage(paintable.canvas, 0, 0);
    const state = { paintable, baseCanvas: base.canvas };
    paintSurfaceState.set(surfaceId, state);
    return state;
  }

  function getOrCreateGraffitiLayer(pinId, surfaceId, width, height) {
    let layers = graffitiLayersByPin.get(pinId);
    if (!layers) {
      layers = new Map();
      graffitiLayersByPin.set(pinId, layers);
    }
    if (layers.has(surfaceId)) return layers.get(surfaceId);

    const layer = createLayerCanvas(width, height);
    layers.set(surfaceId, layer);
    return layer;
  }

  function drawBrushArc(ctx, x, y, radius, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function redrawSurfaceComposite(surfaceId) {
    const state = paintSurfaceState.get(surfaceId);
    if (!state) return;
    const { paintable, baseCanvas } = state;
    paintable.ctx.clearRect(0, 0, paintable.canvas.width, paintable.canvas.height);
    paintable.ctx.drawImage(baseCanvas, 0, 0, paintable.canvas.width, paintable.canvas.height);
    for (const layers of graffitiLayersByPin.values()) {
      const layer = layers.get(surfaceId);
      if (!layer) continue;
      paintable.ctx.drawImage(layer.canvas, 0, 0, paintable.canvas.width, paintable.canvas.height);
    }
    paintable.texture.needsUpdate = true;
  }

  function removeGraffitiLayersForPin(pinId) {
    const layers = graffitiLayersByPin.get(pinId);
    if (!layers) return;
    const touchedSurfaceIds = [...layers.keys()];
    graffitiLayersByPin.delete(pinId);
    for (const surfaceId of touchedSurfaceIds) redrawSurfaceComposite(surfaceId);
  }

  function serializeGraffitiLayers(pinId) {
    const layers = graffitiLayersByPin.get(pinId);
    if (!layers || !layers.size) return [];
    const out = [];
    for (const [surfaceId, layer] of layers.entries()) {
      out.push({
        surfaceId,
        dataUrl: layer.canvas.toDataURL("image/png"),
      });
    }
    return out;
  }

  function restoreGraffitiLayers(pinId, serializedLayers) {
    if (!Array.isArray(serializedLayers) || !serializedLayers.length) return;
    for (const entry of serializedLayers) {
      const surfaceId = String(entry?.surfaceId || "");
      const dataUrl = String(entry?.dataUrl || "");
      if (!surfaceId || !dataUrl) continue;
      const state = paintSurfaceState.get(surfaceId);
      if (!state) continue;

      const layer = getOrCreateGraffitiLayer(pinId, surfaceId, state.paintable.canvas.width, state.paintable.canvas.height);
      const image = new Image();
      image.onload = () => {
        layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        layer.ctx.drawImage(image, 0, 0, layer.canvas.width, layer.canvas.height);
        redrawSurfaceComposite(surfaceId);
      };
      image.src = dataUrl;
    }
  }

  function getIconTexture(pinType) {
    if (iconTextures.has(pinType)) return iconTextures.get(pinType);
    const icon = pinTypeToIcon(pinType);
    let texture;
    if (icon.macFolder) {
      texture = imageLoader.load("./assets/audio-folder-icon.png", (loaded) => {
        const width = loaded.image?.naturalWidth || loaded.image?.width || 1;
        const height = loaded.image?.naturalHeight || loaded.image?.height || 1;
        loaded.userData = loaded.userData || {};
        loaded.userData.aspect = width / Math.max(height, 1);
      });
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.userData = { aspect: 1 };
      texture.needsUpdate = true;
    } else {
      const canvas = createIconCanvas(icon.text, icon.bg, icon.fg);
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.userData = { aspect: canvas.width / canvas.height };
    }
    iconTextures.set(pinType, texture);
    return texture;
  }

  function computeCardSize(aspect, longEdge = 1.7) {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    if (safeAspect >= 1) return { width: longEdge, height: longEdge / safeAspect };
    return { width: longEdge * safeAspect, height: longEdge };
  }

  function setCardGeometry(pin, aspect) {
    const { width, height } = computeCardSize(aspect, pin.fileType === "audio" ? 1.95 : 2.15);
    pin.iconMesh.geometry.dispose();
    pin.focusMesh.geometry.dispose();
    pin.iconMesh.geometry = new THREE.PlaneGeometry(width, height);
    pin.focusMesh.geometry = new THREE.PlaneGeometry(width * 1.2, height * 1.2);
    pin.cardWidth = width;
    pin.cardHeight = height;
    if (pin.progressTrackMesh && pin.progressFillMesh) {
      pin.progressTrackMesh.geometry.dispose();
      pin.progressFillMesh.geometry.dispose();
      pin.progressTrackMesh.geometry = new THREE.PlaneGeometry(width * 0.88, 0.05);
      pin.progressFillMesh.geometry = new THREE.PlaneGeometry(width * 0.86, 0.034);
      pin.progressTrackMesh.position.y = -height * 0.62;
      pin.progressFillMesh.position.y = -height * 0.62;
    }
    if (pin.audioToggleMesh) {
      pin.audioToggleMesh.geometry.dispose();
      pin.audioToggleMesh.geometry = new THREE.PlaneGeometry(0.48, 0.48);
      pin.audioToggleMesh.position.y = 0;
    }
    pin.currentAspect = aspect;
  }

  function setGroundImageGeometry(pin, aspect) {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    const longEdge = 3.2;
    let width;
    let height;
    if (safeAspect >= 1) {
      width = longEdge;
      height = longEdge / safeAspect;
    } else {
      height = longEdge;
      width = longEdge * safeAspect;
    }
    pin.iconMesh.geometry.dispose();
    pin.iconMesh.geometry = new THREE.PlaneGeometry(width, height);
    pin.cardWidth = width;
    pin.cardHeight = height;
    pin.currentAspect = safeAspect;
  }

  function pinToSerializable(pin) {
    const serialized = {
      id: pin.id,
      fileType: pin.fileType,
      fileName: pin.fileName,
      ownerId: pin.ownerId || "",
      ownerLabel: pin.ownerLabel || "",
      mimeType: pin.mimeType,
      size: pin.size,
      dataUrl: pin.dataUrl,
      position: pin.position,
      radius: pin.radius,
      createdAt: pin.createdAt,
      rotationY: pin.rotationY || 0,
      decorScale: Number.isFinite(pin.decorScale) ? pin.decorScale : 1,
    };
    if (pin.fileType === "obj" || pin.fileType === "stl") {
      serialized.modelColor = normalizeHexColor(pin.modelColor, MODEL_DEFAULT_COLOR);
      serialized.modelUvMapDataUrl = String(pin.modelUvMapDataUrl || "");
    }
    if (pin.fileType === "folder") {
      serialized.folderEntries = Array.isArray(pin.folderEntries)
        ? pin.folderEntries.map((entry) => ({
            path: String(entry?.path || ""),
            name: String(entry?.name || ""),
            mimeType: String(entry?.mimeType || ""),
            size: Number(entry?.size) || 0,
            uploadedAt: String(entry?.uploadedAt || ""),
            entryType: String(entry?.entryType || ""),
            previewDataUrl: String(entry?.previewDataUrl || ""),
            dataUrl: String(entry?.dataUrl || ""),
          }))
        : [];
    }
    if (pin.fileType === "graffiti") {
      serialized.graffitiLayers = serializeGraffitiLayers(pin.id);
    }
    return serialized;
  }

  function syncPersistence() {
    onPinsChanged(pins.map(pinToSerializable));
  }

  function clearAllPins(skipSync = false) {
    const snapshot = [...pins];
    for (const pin of snapshot) destroyPin(pin);
    if (!skipSync) syncPersistence();
  }

  function destroyPin(pin) {
    if (!pin) return;
    pinGroup.remove(pin.focusMesh);
    pinGroup.remove(pin.shadowMesh);
    pinGroup.remove(pin.iconMesh);
    pinGroup.remove(pin.ringMesh);
    pinGroup.remove(pin.progressTrackMesh);
    pinGroup.remove(pin.progressFillMesh);
    pinGroup.remove(pin.audioToggleMesh);
    pinGroup.remove(pin.modelMesh);
    if (Array.isArray(pin.folderPanelMeshes)) {
      for (const panel of pin.folderPanelMeshes) {
        pinGroup.remove(panel);
        panel.geometry?.dispose?.();
        panel.material?.dispose?.();
      }
    }
    if (Array.isArray(pin.folderPanelShadowMeshes)) {
      for (const shadow of pin.folderPanelShadowMeshes) {
        pinGroup.remove(shadow);
        shadow.geometry?.dispose?.();
        shadow.material?.dispose?.();
      }
    }
    pin.previewDispose?.();
    pin.modelUvTexture?.dispose?.();
    pin.modelUvTexture = null;

    if (pin.audio) {
      pin.audio.pause();
      pin.audio.currentTime = 0;
    }

    const meshIndex = iconMeshes.indexOf(pin.iconMesh);
    if (meshIndex >= 0) iconMeshes.splice(meshIndex, 1);
    const btnIndex = buttonMeshes.indexOf(pin.audioToggleMesh);
    if (btnIndex >= 0) buttonMeshes.splice(btnIndex, 1);

    const pinIndex = pins.indexOf(pin);
    if (pinIndex >= 0) pins.splice(pinIndex, 1);

    if (pin.fileType === "graffiti") {
      removeGraffitiLayersForPin(pin.id);
    }

    if (activeGraffitiPin?.id === pin.id) {
      activeGraffitiPin = null;
      onGraffitiRadiusChange(false);
    }
    if (activeDecoratePin?.id === pin.id) {
      activeDecoratePin = null;
    }
  }

  function spawnPin(data) {
    let iconMesh;
    let modelMesh = null;
    let modelHeight = 0;
    let modelBaseY = 0;
    let shadowRadius = 0.6;
    let textureRef = null;
    let textureAspect = 1;
    let previewUpdate = null;
    let previewDispose = null;
    let previewSetActive = null;
    let folderPanelMeshes = null;
    let folderPanelShadowMeshes = null;
    let folderPanelAngles = null;
    let folderRingRadius = 1.24;
    if (data.fileType === "image" && data.dataUrl) {
      const imageTexture = createRoundedImageTexture(THREE, imageLoader, data.dataUrl);
      textureRef = imageTexture;
      textureAspect = imageTexture.userData?.aspect || 1;

      iconMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.7, 1.7),
        new THREE.MeshBasicMaterial({ map: imageTexture, transparent: true, alphaTest: 0.06 })
      );
      shadowRadius = 0.78;
    } else if (DOCUMENT_THUMB_TYPES.has(data.fileType)) {
      const documentTexture = createDocumentTypeTexture(THREE, data.fileType, data.fileName);
      textureRef = documentTexture;
      textureAspect = documentTexture?.userData?.aspect || 0.77;
      iconMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.7, 1.7),
        new THREE.MeshBasicMaterial({ map: documentTexture, transparent: true, alphaTest: 0.06 })
      );
      shadowRadius = 0.78;
    } else if (data.fileType === "video" || data.fileType === "gif") {
      const livePreview = createLiveMediaTexture(THREE, data.dataUrl, data.fileType === "video" ? "video" : "gif");
      textureRef = livePreview.texture;
      textureAspect = livePreview.texture.userData?.aspect || 1;
      previewUpdate = livePreview.update;
      previewDispose = livePreview.dispose;
      previewSetActive = livePreview.setActive;
      iconMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.7, 1.7),
        new THREE.MeshBasicMaterial({ map: livePreview.texture, transparent: true, alphaTest: 0.06 })
      );
      shadowRadius = 0.78;
    } else if (data.fileType === "decorate" && data.dataUrl) {
      const groundTexture = createRoundedImageTexture(THREE, imageLoader, data.dataUrl, 768, 768, 34);
      textureRef = groundTexture;
      textureAspect = groundTexture.userData?.aspect || 1;
      iconMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, 3.2),
        new THREE.MeshBasicMaterial({ map: groundTexture, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide })
      );
      iconMesh.rotation.x = -Math.PI / 2;
      shadowRadius = 1.45;
    } else if (data.fileType === "folder") {
      iconMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.78, 0.78),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      const entryCount = Array.isArray(data.folderEntries) ? data.folderEntries.length : 0;
      const panelCount = Math.max(1, entryCount || 1);
      folderRingRadius = 1.9;
      folderPanelMeshes = [];
      folderPanelShadowMeshes = [];
      folderPanelAngles = [];
      for (let i = 0; i < panelCount; i += 1) {
        const entry = Array.isArray(data.folderEntries) ? data.folderEntries[i] || null : null;
        const angle = (i / panelCount) * Math.PI * 2;
        const outwardX = Math.cos(angle);
        const outwardZ = Math.sin(angle);
        const depthStagger = ((i % 3) - 1) * 0.04;
        const heightStagger = ((i % 4) - 1.5) * 0.01;
        const entryType = String(entry?.entryType || inferFolderEntryType(entry?.name, entry?.mimeType));
        const hasPreview = Boolean(entry?.previewDataUrl);
        const isAudioEntry = entryType === "audio";
        const panelTexture = hasPreview
          ? createRoundedImageTexture(THREE, imageLoader, entry.previewDataUrl, 320, 320, 18)
          : isAudioEntry
            ? createRoundedImageTexture(THREE, imageLoader, "./assets/audio-folder-icon.png", 320, 320, 18, "#ffffff")
            : DOCUMENT_THUMB_TYPES.has(entryType)
              ? createDocumentTypeTexture(THREE, entryType, entry?.name || `Item ${i + 1}`, 390, 505, 22)
              : createFolderEntryCardTexture(THREE, entry?.name || `Item ${i + 1}`, entryType, 320);
        const panelAspect = Number(panelTexture?.userData?.aspect) > 0 ? Number(panelTexture.userData.aspect) : 1;
        const panelSize = computeCardSize(panelAspect, 1.38);
        const panel = new THREE.Mesh(
          new THREE.PlaneGeometry(panelSize.width, panelSize.height),
          new THREE.MeshStandardMaterial({
            map: panelTexture,
            color: 0xffffff,
            roughness: isAudioEntry ? 0.5 : 0.6,
            metalness: 0.02,
            emissive: 0x0f1622,
            emissiveIntensity: 0.03,
            transparent: true,
            alphaTest: 0.06,
            side: THREE.DoubleSide,
          })
        );
        panel.renderOrder = 320;
        panel.position.set(
          data.position.x + outwardX * (folderRingRadius + depthStagger),
          1.8 + heightStagger,
          data.position.z + outwardZ * (folderRingRadius + depthStagger)
        );
        panel.rotation.y = Math.atan2(outwardX, outwardZ) - Math.PI / 2;
        panel.rotation.x = -0.03;
        panel.userData.pinId = data.id;
        pinGroup.add(panel);
        const panelShadow = new THREE.Mesh(
          new THREE.CircleGeometry(Math.max(panelSize.width, panelSize.height) * 0.34, 28),
          new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.18,
            depthWrite: false,
          })
        );
        panelShadow.rotation.x = -Math.PI / 2;
        panelShadow.position.set(
          data.position.x + outwardX * (folderRingRadius + depthStagger),
          0.035,
          data.position.z + outwardZ * (folderRingRadius + depthStagger)
        );
        pinGroup.add(panelShadow);
        folderPanelMeshes.push(panel);
        folderPanelShadowMeshes.push(panelShadow);
        folderPanelAngles.push(angle);
      }
      shadowRadius = 2.05;
    } else if (data.fileType === "stl" || data.fileType === "obj") {
      if (data.dataUrl) {
        try {
          const geometry =
            data.fileType === "stl" ? parseSTLGeometry(THREE, data.dataUrl) : parseOBJGeometry(THREE, data.dataUrl);
          const scaledSize = normalizeModelGeometry(THREE, geometry, 2.4);
          modelHeight = scaledSize.y || 1;
          modelBaseY = Math.max(0.14, Math.min(0.3, 0.1 + modelHeight * 0.04));
          const modelColorHex = normalizeHexColor(data.modelColor, MODEL_DEFAULT_COLOR);

          modelMesh = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({
              color: Number.parseInt(modelColorHex.slice(1), 16),
              roughness: 0.66,
              metalness: 0.15,
              emissive: 0x0e1320,
              emissiveIntensity: 0.08,
            })
          );
          modelMesh.position.set(data.position.x, modelBaseY, data.position.z);
          modelMesh.rotation.y = 0;
          modelMesh.userData.pinId = data.id;
          pinGroup.add(modelMesh);

          shadowRadius = Math.max(0.65, Math.min(2.3, (scaledSize.x + scaledSize.z) * 0.24));
          iconMesh = modelMesh;
        } catch {
          onError(`${data.fileType.toUpperCase()} parse failed.`);
          return null;
        }
      }
      if (!iconMesh) return null;
    } else {
      const iconTexture = getIconTexture(data.fileType);
      textureRef = iconTexture;
      textureAspect = iconTexture.userData?.aspect || 1;
      iconMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 1.4),
        new THREE.MeshBasicMaterial({ map: iconTexture, transparent: true })
      );
      shadowRadius = 0.58;
    }

    const isModelPin = data.fileType === "stl" || data.fileType === "obj";
    const isFolderPin = data.fileType === "folder";
    const isDecoratePin = data.fileType === "decorate";
    const focusMesh = isModelPin || isFolderPin
      ? new THREE.Mesh(
          new THREE.SphereGeometry(isFolderPin ? 1.3 : Math.max(0.6, modelHeight * 0.62), 20, 16),
          new THREE.MeshBasicMaterial({
            color: 0x8fe6ff,
            wireframe: true,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          })
        )
      : new THREE.Mesh(
          iconMesh.geometry.clone(),
          new THREE.MeshBasicMaterial({
            map: focusFrameTexture,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
          })
        );

    const shadowMesh = new THREE.Mesh(
      new THREE.CircleGeometry(shadowRadius, 28),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      })
    );
    const iconY = isModelPin ? modelBaseY : isDecoratePin ? 0.03 : isFolderPin ? 1.8 : 1.8;
    iconMesh.position.set(data.position.x, iconY, data.position.z);
    focusMesh.position.copy(iconMesh.position);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.set(data.position.x, 0.035, data.position.z);
    if (isDecoratePin || isFolderPin) shadowMesh.visible = false;
    pinGroup.add(focusMesh);
    pinGroup.add(shadowMesh);
    pinGroup.add(iconMesh);

    const ringColor = data.fileType === "graffiti" ? 0xc67cff : 0x8fb3d7;
    const ringMesh = new THREE.Mesh(
      new THREE.RingGeometry(data.radius - 0.03, data.radius, 64),
      new THREE.MeshBasicMaterial({
        color: ringColor,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      })
    );
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.set(data.position.x, 0.02, data.position.z);
    ringMesh.visible = data.fileType === "folder";
    pinGroup.add(ringMesh);

    let progressTrackMesh = null;
    let progressFillMesh = null;
    let audioToggleMesh = null;
    if (data.fileType === "audio") {
      progressTrackMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.1, 0.05),
        new THREE.MeshBasicMaterial({
          color: 0x1b1f28,
          transparent: true,
          opacity: 0.65,
          depthWrite: false,
        })
      );
      progressFillMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.08, 0.034),
        new THREE.MeshBasicMaterial({
          color: 0xd8e4f5,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        })
      );
      progressTrackMesh.position.set(data.position.x, 1.1, data.position.z);
      progressFillMesh.position.set(data.position.x, 1.1, data.position.z);
      pinGroup.add(progressTrackMesh);
      pinGroup.add(progressFillMesh);

      const toggleTexture = createAudioToggleTexture(THREE, false);
      audioToggleMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.48, 0.48),
        new THREE.MeshBasicMaterial({ map: toggleTexture, transparent: true, opacity: 0.72, depthWrite: false })
      );
      audioToggleMesh.userData.pinId = data.id;
      audioToggleMesh.userData.THREE = THREE;
      audioToggleMesh.renderOrder = 1200;
      audioToggleMesh.material.depthTest = false;
      audioToggleMesh.material.depthWrite = false;
      audioToggleMesh.material.needsUpdate = true;
      pinGroup.add(audioToggleMesh);
      buttonMeshes.push(audioToggleMesh);
    }

    let audio = null;
    if (data.fileType === "audio") {
      audio = new Audio(data.dataUrl);
      audio.loop = true;
      audio.preload = "auto";
      audio.volume = 0;
    }

    const pin = {
      ...data,
      isModelPin,
      isFolderPin,
      modelBaseY,
      modelHeight,
      modelMesh,
      isDecoratePin,
      rotationY: Number.isFinite(data.rotationY) ? data.rotationY : 0,
      decorScale: Number.isFinite(data.decorScale) ? data.decorScale : 1,
      focusMesh,
      shadowMesh,
      iconMesh,
      textureRef,
      ringMesh,
      progressTrackMesh,
      progressFillMesh,
      audioToggleMesh,
      audio,
      manualPaused: false,
      audioButtonPlaying: null,
      inRadius: false,
      currentAspect: textureAspect,
      modelHoverPhase: Math.random() * Math.PI * 2,
      modelColor: isModelPin ? normalizeHexColor(data.modelColor, MODEL_DEFAULT_COLOR) : null,
      modelUvMapDataUrl: isModelPin ? String(data.modelUvMapDataUrl || "") : "",
      modelUvTexture: null,
      folderPanelMeshes,
      folderPanelShadowMeshes,
      folderPanelAngles,
      folderRingRadius,
      folderEntries: Array.isArray(data.folderEntries)
        ? data.folderEntries.map((entry) => ({
            path: String(entry?.path || ""),
            name: String(entry?.name || ""),
            mimeType: String(entry?.mimeType || ""),
            size: Number(entry?.size) || 0,
            uploadedAt: String(entry?.uploadedAt || ""),
            entryType: String(entry?.entryType || ""),
            previewDataUrl: String(entry?.previewDataUrl || ""),
            dataUrl: String(entry?.dataUrl || ""),
          }))
        : [],
      previewUpdate,
      previewDispose,
      previewSetActive,
    };
    if (isDecoratePin) {
      setGroundImageGeometry(pin, textureAspect);
      pin.iconMesh.rotation.x = -Math.PI / 2;
      pin.iconMesh.rotation.z = pin.rotationY;
      pin.iconMesh.scale.set(pin.decorScale, pin.decorScale, 1);
    } else if (!isModelPin && !isFolderPin) {
      setCardGeometry(pin, textureAspect);
    }

    iconMesh.userData.pinId = pin.id;
    iconMeshes.push(iconMesh);
    pins.push(pin);
    if (pin.isModelPin && pin.modelUvMapDataUrl) {
      applyModelUvMapToPin(pin, pin.modelUvMapDataUrl);
    }
    return pin;
  }

  function applyModelColorToPin(pin, colorHex) {
    if (!pin?.isModelPin || !pin.modelMesh?.material) return false;
    const safeColor = normalizeHexColor(colorHex, MODEL_DEFAULT_COLOR);
    pin.modelColor = safeColor;
    pin.modelMesh.material.color.set(safeColor);
    pin.modelMesh.material.needsUpdate = true;
    return true;
  }

  function applyModelUvMapToPin(pin, uvMapDataUrl) {
    if (!pin?.isModelPin || !pin.modelMesh?.material) return false;
    const material = pin.modelMesh.material;
    const safeUrl = String(uvMapDataUrl || "");

    pin.modelUvTexture?.dispose?.();
    pin.modelUvTexture = null;
    material.map = null;
    material.needsUpdate = true;

    pin.modelUvMapDataUrl = safeUrl;
    if (!safeUrl) return true;
    if (!safeUrl.startsWith("data:image/")) return false;

    imageLoader.load(
      safeUrl,
      (texture) => {
        if (!pins.includes(pin)) {
          texture.dispose();
          return;
        }
        if (pin.modelUvMapDataUrl !== safeUrl) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        pin.modelUvTexture = texture;
        material.map = texture;
        material.needsUpdate = true;
      },
      undefined,
      () => onError("UV map could not be loaded.")
    );
    return true;
  }

  async function addFileAtPlayer(file, playerPosition) {
    const fileType = getFileType(file);

    const maxSize = getMaxSizeForType(fileType);
    if (file.size > maxSize) {
      if (fileType === "obj") {
        onError("OBJ too large. Max size is 50MB.");
      } else if (fileType === "stl") {
        onError("STL too large. Max size is 50MB.");
      } else if (fileType === "video" || fileType === "gif") {
        onError("Video/GIF too large. Max size is 10MB.");
      } else {
        onError("File too large. Max size is 5MB.");
      }
      return;
    }

    try {
      const dataUrl = await readAsDataUrl(file);
      const owner = getOwnerIdentity?.() || {};
      const pin = spawnPin({
        id: uid(),
        fileType,
        fileName: file.name,
        ownerId: owner.ownerId || "",
        ownerLabel: owner.ownerLabel || "",
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        dataUrl,
        position: {
          x: Number(playerPosition.x.toFixed(2)),
          y: Number(playerPosition.y.toFixed(2)),
          z: Number(playerPosition.z.toFixed(2)),
        },
        radius: fileType === "audio" ? FILE_PIN_RADIUS * AUDIO_RADIUS_MULTIPLIER : FILE_PIN_RADIUS,
        createdAt: new Date().toISOString(),
      });
      if (!pin) return;
      syncPersistence();
      return pin;
    } catch {
      onError("Could not read file.");
    }
  }

  async function addFolderAtPlayer(files, playerPosition) {
    const fileList = Array.isArray(files) ? files.filter((file) => file && typeof file.name === "string") : [];
    if (!fileList.length) {
      onError("Folder is empty.");
      return null;
    }
    const firstPath = String(fileList[0].webkitRelativePath || fileList[0].name || "");
    const rootName = firstPath.split("/").filter(Boolean)[0] || "folder";
    const entries = [];
    let totalSize = 0;
    const uploadStamp = new Date().toISOString();
    for (const file of fileList) {
      const size = Number(file.size) || 0;
      totalSize += size;
      const rawPath = String(file.webkitRelativePath || file.name || "");
      const path = rawPath || file.name || "item";
      const name = path.split("/").pop() || file.name || "item";
      const mimeType = String(file.type || "application/octet-stream");
      const entryType = inferFolderEntryType(name, mimeType);
      let previewDataUrl = "";
      let entryDataUrl = "";
      try {
        entryDataUrl = await readAsDataUrl(file);
      } catch {
        entryDataUrl = "";
      }
      if (entryType === "image" && size > 0) {
        try {
          previewDataUrl = await readImageThumbnailDataUrl(file);
        } catch {
          previewDataUrl = "";
        }
      }
      entries.push({
        path,
        name,
        mimeType,
        size,
        uploadedAt: uploadStamp,
        entryType,
        previewDataUrl,
        dataUrl: entryDataUrl,
      });
    }
    const sortedEntries = sortFolderEntries(entries);
    const owner = getOwnerIdentity?.() || {};
    const pin = spawnPin({
      id: uid(),
      fileType: "folder",
      fileName: rootName,
      ownerId: owner.ownerId || "",
      ownerLabel: owner.ownerLabel || "",
      mimeType: "application/x-folder",
      size: totalSize,
      dataUrl: `folder://${encodeURIComponent(rootName)}`,
      folderEntries: sortedEntries,
      position: {
        x: Number(playerPosition.x.toFixed(2)),
        y: Number(playerPosition.y.toFixed(2)),
        z: Number(playerPosition.z.toFixed(2)),
      },
      radius: FOLDER_PIN_RADIUS,
      createdAt: new Date().toISOString(),
    });
    if (!pin) return null;
    syncPersistence();
    return pin;
  }

  async function appendFilesToFolder(folderPinId, files, requesterOwnerId = null) {
    const pin = pins.find((p) => p.id === folderPinId);
    if (!pin || pin.fileType !== "folder") return null;
    void requesterOwnerId;

    const fileList = Array.isArray(files) ? files.filter((file) => file && typeof file.name === "string") : [];
    if (!fileList.length) return null;

    const newEntries = [];
    const uploadStamp = new Date().toISOString();
    for (const file of fileList) {
      const fileType = getFileType(file);
      const maxSize = getMaxSizeForType(fileType);
      if ((Number(file.size) || 0) > maxSize) continue;

      const size = Number(file.size) || 0;
      const path = String(file.name || "item");
      const name = path.split("/").pop() || file.name || "item";
      const mimeType = String(file.type || "application/octet-stream");
      const entryType = inferFolderEntryType(name, mimeType);

      let previewDataUrl = "";
      let entryDataUrl = "";
      try {
        entryDataUrl = await readAsDataUrl(file);
      } catch {
        entryDataUrl = "";
      }
      if (entryType === "image" && size > 0) {
        try {
          previewDataUrl = await readImageThumbnailDataUrl(file);
        } catch {
          previewDataUrl = "";
        }
      }

      newEntries.push({
        path,
        name,
        mimeType,
        size,
        uploadedAt: uploadStamp,
        entryType,
        previewDataUrl,
        dataUrl: entryDataUrl,
      });
    }
    if (!newEntries.length) return null;

    const mergedEntries = sortFolderEntries([...(pin.folderEntries || []), ...newEntries]);
    const nextData = pinToSerializable(pin);
    nextData.folderEntries = mergedEntries;
    nextData.size = mergedEntries.reduce((sum, entry) => sum + (Number(entry?.size) || 0), 0);
    if (!nextData.dataUrl) nextData.dataUrl = `folder://${encodeURIComponent(nextData.fileName || "folder")}`;
    nextData.position = { ...pin.position };
    nextData.radius = pin.radius;

    destroyPin(pin);
    const nextPin = spawnPin(nextData);
    if (!nextPin) return null;
    syncPersistence();
    return pinToSerializable(nextPin);
  }

  function addImageDataPinAtPlayer({ dataUrl, fileName = "selfie.jpg", mimeType = "image/jpeg", playerPosition }) {
    const owner = getOwnerIdentity?.() || {};
    const pin = spawnPin({
      id: uid(),
      fileType: "image",
      fileName,
      ownerId: owner.ownerId || "",
      ownerLabel: owner.ownerLabel || "",
      mimeType,
      size: dataUrl.length,
      dataUrl,
      position: {
        x: Number(playerPosition.x.toFixed(2)),
        y: Number(playerPosition.y.toFixed(2)),
        z: Number(playerPosition.z.toFixed(2)),
      },
      radius: FILE_PIN_RADIUS,
      createdAt: new Date().toISOString(),
    });
    syncPersistence();
    return pin;
  }

  function addDecorImagePinAtPlayer({ dataUrl, fileName = "decorate.png", mimeType = "image/png", playerPosition }) {
    const owner = getOwnerIdentity?.() || {};
    const pin = spawnPin({
      id: uid(),
      fileType: "decorate",
      fileName,
      ownerId: owner.ownerId || "",
      ownerLabel: owner.ownerLabel || "",
      mimeType,
      size: dataUrl.length,
      dataUrl,
      position: {
        x: Number(playerPosition.x.toFixed(2)),
        y: 0,
        z: Number(playerPosition.z.toFixed(2)),
      },
      radius: FILE_PIN_RADIUS,
      createdAt: new Date().toISOString(),
      rotationY: 0,
    });
    if (!pin) return null;
    syncPersistence();
    return pin;
  }

  function addGraffitiPinAtPlayer(playerPosition) {
    const owner = getOwnerIdentity?.() || {};
    const pin = spawnPin({
      id: uid(),
      fileType: "graffiti",
      fileName: "graffiti-zone",
      ownerId: owner.ownerId || "",
      ownerLabel: owner.ownerLabel || "",
      mimeType: "application/x-graffiti-zone",
      size: 0,
      dataUrl: "",
      position: {
        x: Number(playerPosition.x.toFixed(2)),
        y: Number(playerPosition.y.toFixed(2)),
        z: Number(playerPosition.z.toFixed(2)),
      },
      radius: GRAFFITI_PIN_RADIUS,
      createdAt: new Date().toISOString(),
    });
    syncPersistence();
    return pin;
  }

  function deletePin(pinId, requesterOwnerId = null) {
    const pin = pins.find((p) => p.id === pinId);
    if (!pin) return false;
    if (requesterOwnerId && pin.ownerId && pin.ownerId !== requesterOwnerId) return false;
    destroyPin(pin);
    syncPersistence();
    return true;
  }

  function clearActiveGraffitiArea() {
    if (!activeGraffitiPin) return false;
    destroyPin(activeGraffitiPin);
    syncPersistence();
    return true;
  }

  function loadFromSaved(items) {
    clearAllPins(true);
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || !item.fileType || !item.position) continue;
      if (item.fileType !== "graffiti" && !item.dataUrl) continue;

      spawnPin({
        id: item.id || uid(),
        fileType: item.fileType,
        fileName: item.fileName || "file",
        ownerId: String(item.ownerId || ""),
        ownerLabel: String(item.ownerLabel || ""),
        mimeType: item.mimeType || "application/octet-stream",
        size: Number(item.size) || 0,
        dataUrl: item.dataUrl || "",
        position: {
          x: Number(item.position.x) || 0,
          y: Number(item.position.y) || 0,
          z: Number(item.position.z) || 0,
        },
        radius:
          item.fileType === "audio"
            ? Math.max(Number(item.radius) || 0, FILE_PIN_RADIUS * AUDIO_RADIUS_MULTIPLIER)
            : item.fileType === "folder"
              ? Number(item.radius) || FOLDER_PIN_RADIUS
            : Number(item.radius) ||
              (item.fileType === "graffiti" ? GRAFFITI_PIN_RADIUS : FILE_PIN_RADIUS),
        createdAt: item.createdAt || new Date().toISOString(),
        rotationY: Number(item.rotationY) || 0,
        decorScale: Number(item.decorScale) || 1,
        modelColor: item.modelColor,
        modelUvMapDataUrl: item.modelUvMapDataUrl,
        folderEntries: item.folderEntries,
      });
    }
    for (const item of items) {
      if (!item || item.fileType !== "graffiti" || !item.id) continue;
      restoreGraffitiLayers(String(item.id), item.graffitiLayers);
    }
    syncPersistence();
  }

  function getSerializablePins() {
    return pins.map(pinToSerializable);
  }

  function applySharedPins(items, { skipSync = true } = {}) {
    clearAllPins(true);
    if (Array.isArray(items) && items.length) {
      for (const item of items) {
        if (!item || !item.fileType || !item.position) continue;
        if (item.fileType !== "graffiti" && !item.dataUrl) continue;
        spawnPin({
          id: item.id || uid(),
          fileType: item.fileType,
          fileName: item.fileName || "file",
          ownerId: String(item.ownerId || ""),
          ownerLabel: String(item.ownerLabel || ""),
          mimeType: item.mimeType || "application/octet-stream",
          size: Number(item.size) || 0,
          dataUrl: item.dataUrl || "",
          position: {
            x: Number(item.position.x) || 0,
            y: Number(item.position.y) || 0,
            z: Number(item.position.z) || 0,
          },
          radius:
            item.fileType === "audio"
              ? Math.max(Number(item.radius) || 0, FILE_PIN_RADIUS * AUDIO_RADIUS_MULTIPLIER)
              : item.fileType === "folder"
                ? Number(item.radius) || FOLDER_PIN_RADIUS
              : Number(item.radius) ||
                (item.fileType === "graffiti" ? GRAFFITI_PIN_RADIUS : FILE_PIN_RADIUS),
          createdAt: item.createdAt || new Date().toISOString(),
          rotationY: Number(item.rotationY) || 0,
          decorScale: Number(item.decorScale) || 1,
          modelColor: item.modelColor,
          modelUvMapDataUrl: item.modelUvMapDataUrl,
          folderEntries: item.folderEntries,
        });
      }
      for (const item of items) {
        if (!item || item.fileType !== "graffiti" || !item.id) continue;
        restoreGraffitiLayers(String(item.id), item.graffitiLayers);
      }
    }
    if (!skipSync) syncPersistence();
  }

  function update(_delta, playerPosition) {
    elapsedTime += Number.isFinite(_delta) ? _delta : 0;
    lastPlayerPosition = {
      x: playerPosition.x,
      y: playerPosition.y,
      z: playerPosition.z,
    };
    let nearestGraffiti = null;
    let nearestDistance = Infinity;
    aimRaycastCooldown -= _delta;
    if (aimRaycastCooldown <= 0) {
      aimRaycastCooldown = AIM_RAYCAST_INTERVAL;
      ndc.set(0, 0);
      raycaster.setFromCamera(ndc, camera);
      const aimHits = iconMeshes.length ? raycaster.intersectObjects(iconMeshes, false) : [];
      cachedAimedPinId = aimHits[0]?.object?.userData?.pinId || null;
      const buttonAimHits = buttonMeshes.length ? raycaster.intersectObjects(buttonMeshes, false) : [];
      cachedAimedButtonPinId = buttonAimHits[0]?.object?.userData?.pinId || null;
    }
    const aimedPinId = cachedAimedPinId;
    const aimedButtonPinId = cachedAimedButtonPinId;
    for (const pin of pins) {
      const distance = distance2D(playerPosition, pin.position);
      const previewActive = distance < MEDIA_PREVIEW_ACTIVE_DISTANCE;
      pin.previewSetActive?.(previewActive);
      if (previewActive) pin.previewUpdate?.();
      if (pin.isDecoratePin) {
        if (pin.textureRef?.userData?.aspect && Math.abs(pin.textureRef.userData.aspect - pin.currentAspect) > 0.01) {
          setGroundImageGeometry(pin, pin.textureRef.userData.aspect);
        }
        pin.iconMesh.position.set(pin.position.x, 0.03, pin.position.z);
        pin.iconMesh.rotation.x = -Math.PI / 2;
        pin.iconMesh.rotation.z = pin.rotationY || 0;
        pin.iconMesh.scale.set(pin.decorScale || 1, pin.decorScale || 1, 1);
        pin.focusMesh.position.set(pin.position.x, 0.11, pin.position.z);
        pin.focusMesh.rotation.x = -Math.PI / 2;
        pin.focusMesh.rotation.z = pin.rotationY || 0;
      }
      if (pin.isModelPin && pin.modelMesh) {
        pin.modelMesh.position.set(pin.position.x, pin.modelBaseY, pin.position.z);
        pin.focusMesh.position.copy(pin.modelMesh.position);
      } else if (pin.isFolderPin) {
        pin.iconMesh.position.set(pin.position.x, 1.8, pin.position.z);
        if (Array.isArray(pin.folderPanelMeshes) && Array.isArray(pin.folderPanelAngles)) {
          const radius = Number(pin.folderRingRadius) || 1.24;
          for (let i = 0; i < pin.folderPanelMeshes.length; i += 1) {
            const panel = pin.folderPanelMeshes[i];
            const panelShadow = Array.isArray(pin.folderPanelShadowMeshes) ? pin.folderPanelShadowMeshes[i] : null;
            const angle = pin.folderPanelAngles[i] || 0;
            const outwardX = Math.cos(angle);
            const outwardZ = Math.sin(angle);
            const depthStagger = ((i % 3) - 1) * 0.04;
            const heightStagger = ((i % 4) - 1.5) * 0.01;
            panel.position.set(
              pin.position.x + outwardX * (radius + depthStagger),
              1.8 + heightStagger,
              pin.position.z + outwardZ * (radius + depthStagger)
            );
            panel.rotation.y = Math.atan2(outwardX, outwardZ) - Math.PI / 2;
            panel.rotation.x = -0.03;
            if (panelShadow) {
              panelShadow.position.set(
                pin.position.x + outwardX * (radius + depthStagger),
                0.035,
                pin.position.z + outwardZ * (radius + depthStagger)
              );
            }
          }
        }
        pin.focusMesh.position.set(pin.position.x, 1.8, pin.position.z);
      } else if (!pin.isDecoratePin) {
        pin.iconMesh.lookAt(camera.position);
        pin.focusMesh.lookAt(camera.position);
        focusOffset.subVectors(camera.position, pin.iconMesh.position).normalize();
        pin.focusMesh.position.copy(pin.iconMesh.position).addScaledVector(focusOffset, 0.015);
      }
      pin.shadowMesh.position.set(pin.position.x, 0.035, pin.position.z);
      if (!pin.isModelPin && !pin.isFolderPin && pin.textureRef?.userData?.aspect && Math.abs(pin.textureRef.userData.aspect - pin.currentAspect) > 0.01) {
        setCardGeometry(pin, pin.textureRef.userData.aspect);
      }

      const inRadius = distance <= pin.radius;
      pin.inRadius = inRadius;

      const defaultColor = pin.fileType === "graffiti" ? 0xc67cff : 0x8fb3d7;
      const activeColor = pin.fileType === "graffiti" ? 0xf093ff : 0x6ac3ff;
      pin.ringMesh.material.color.setHex(inRadius ? activeColor : defaultColor);
      const focused = inRadius && pin.fileType !== "graffiti" && pin.id === aimedPinId;
      const growable = focused && !pin.isDecoratePin && !pin.isFolderPin;
      const targetScale = growable ? 1.22 : 1;
      scaleScratch.set(targetScale, targetScale, 1);
      if (!pin.isDecoratePin && !pin.isFolderPin) pin.iconMesh.scale.lerp(scaleScratch, 0.22);
      if (pin.isModelPin) {
        pin.focusMesh.scale.setScalar(targetScale);
      } else if (pin.isFolderPin) {
        pin.focusMesh.scale.setScalar(targetScale);
      } else if (pin.isDecoratePin) {
        pin.focusMesh.scale.set(pin.decorScale || 1, pin.decorScale || 1, 1);
      } else {
        pin.focusMesh.scale.copy(pin.iconMesh.scale);
      }
      pin.ringMesh.material.opacity = pin.fileType === "folder" ? (inRadius ? 0.2 : 0.1) : 0;
      pin.focusMesh.material.opacity = 0;

      if (pin.progressTrackMesh && pin.progressFillMesh) {
        pin.progressTrackMesh.lookAt(camera.position);
        pin.progressFillMesh.lookAt(camera.position);
        pin.progressTrackMesh.position.set(pin.position.x, pin.iconMesh.position.y - (pin.cardHeight || 1.1) * 0.62, pin.position.z);
        pin.progressFillMesh.position.copy(pin.progressTrackMesh.position);
        const duration = pin.audio?.duration;
        const hasDuration = Number.isFinite(duration) && duration > 0.01;
        const progress = hasDuration ? pin.audio.currentTime / duration : 0;
        const clamped = Math.max(0, Math.min(1, progress));
        pin.progressTrackMesh.material.opacity = inRadius ? 0.7 : 0.35;
        pin.progressFillMesh.material.opacity = inRadius ? 0.95 : 0.45;
        pin.progressFillMesh.scale.set(Math.max(0.02, clamped), 1, 1);
        const barWidth = (pin.cardWidth || 1.2) * 0.86;
        pin.progressFillMesh.position.addScaledVector(focusOffset, 0.01);
        barRightScratch.crossVectors(worldUp, focusOffset);
        if (barRightScratch.lengthSq() < 1e-6) {
          barRightScratch.set(1, 0, 0);
        } else {
          barRightScratch.normalize();
        }
        pin.progressFillMesh.position.addScaledVector(barRightScratch, (clamped - 1) * barWidth * 0.5);
      }

      if (pin.audioToggleMesh) {
        pin.audioToggleMesh.lookAt(camera.position);
        pin.audioToggleMesh.position.copy(pin.iconMesh.position).addScaledVector(focusOffset, 0.025);
        const buttonFocused = inRadius && pin.id === aimedButtonPinId;
        const buttonScale = buttonFocused ? 1.38 : 1.08;
        scaleScratch.set(buttonScale, buttonScale, 1);
        pin.audioToggleMesh.scale.lerp(scaleScratch, 0.24);
      }

      if (pin.fileType === "audio" && pin.audio) {
        if (inRadius) {
          const linear = Math.max(0, 1 - distance / pin.radius);
          const gain = linear * linear;
          pin.audio.volume = Math.min(1, gain);
          if (!pin.manualPaused && pin.audio.paused) pin.audio.play().catch(() => {});
        } else {
          pin.audio.pause();
        }
        refreshAudioToggleTexture(pin);
      }

      if (pin.fileType === "graffiti" && inRadius && distance < nearestDistance) {
        nearestDistance = distance;
        nearestGraffiti = pin;
      }
    }

    activeGraffitiPin = nearestGraffiti;
    onGraffitiRadiusChange(Boolean(activeGraffitiPin));
  }

  function canRequesterControlOwner(ownerId, requesterOwnerId = null) {
    if (!requesterOwnerId) return true;
    if (!ownerId) return true;
    return ownerId === requesterOwnerId;
  }

  function getPinAtPointer(clientX, clientY, domElement) {
    const rect = domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(iconMeshes, false);
    if (!hits[0]) return null;
    return pins.find((p) => p.id === hits[0].object.userData.pinId) || null;
  }

  function pickupOwnedPinAtPointer(clientX, clientY, domElement, requesterOwnerId = null) {
    const pin = getPinAtPointer(clientX, clientY, domElement);
    if (!pin) return null;
    if (!pin.inRadius) return null;
    if (pin.fileType === "graffiti" || pin.fileType === "decorate") return null;
    if (!canRequesterControlOwner(pin.ownerId, requesterOwnerId)) return null;

    const stored = pinToSerializable(pin);
    destroyPin(pin);
    syncPersistence();
    return stored;
  }

  function canPickupOwnedPinAtPointer(clientX, clientY, domElement, requesterOwnerId = null) {
    const pin = getPinAtPointer(clientX, clientY, domElement);
    if (!pin) return false;
    if (!pin.inRadius) return false;
    if (pin.fileType === "graffiti" || pin.fileType === "decorate") return false;
    if (!canRequesterControlOwner(pin.ownerId, requesterOwnerId)) return false;
    return true;
  }

  function placeStoredPin(storedPin, targetPosition, requesterOwnerId = null) {
    if (!storedPin || typeof storedPin !== "object") return null;
    const fileType = String(storedPin.fileType || "");
    if (!fileType || fileType === "graffiti") return null;
    if (!canRequesterControlOwner(String(storedPin.ownerId || ""), requesterOwnerId)) return null;

    const owner = getOwnerIdentity?.() || {};
    const position = {
      x: Number.isFinite(Number(targetPosition?.x)) ? Number(targetPosition.x) : Number(lastPlayerPosition.x) || 0,
      y: Number.isFinite(Number(targetPosition?.y)) ? Number(targetPosition.y) : 0,
      z: Number.isFinite(Number(targetPosition?.z)) ? Number(targetPosition.z) : Number(lastPlayerPosition.z) || 0,
    };
    const numericRadius = Number(storedPin.radius);
    const radius =
      fileType === "audio"
        ? Math.max(Number.isFinite(numericRadius) ? numericRadius : 0, FILE_PIN_RADIUS * AUDIO_RADIUS_MULTIPLIER)
        : fileType === "folder"
          ? Number.isFinite(numericRadius) && numericRadius > 0
            ? numericRadius
            : FOLDER_PIN_RADIUS
        : Number.isFinite(numericRadius) && numericRadius > 0
          ? numericRadius
          : FILE_PIN_RADIUS;

    const pin = spawnPin({
      id: uid(),
      fileType,
      fileName: String(storedPin.fileName || "file"),
      ownerId: String(storedPin.ownerId || owner.ownerId || ""),
      ownerLabel: String(storedPin.ownerLabel || owner.ownerLabel || ""),
      mimeType: String(storedPin.mimeType || "application/octet-stream"),
      size: Number(storedPin.size) || 0,
      dataUrl: String(storedPin.dataUrl || ""),
      position: {
        x: Number(position.x.toFixed(2)),
        y: Number(position.y.toFixed(2)),
        z: Number(position.z.toFixed(2)),
      },
      radius,
      createdAt: new Date().toISOString(),
      rotationY: Number(storedPin.rotationY) || 0,
      decorScale: Number(storedPin.decorScale) || 1,
      modelColor: storedPin.modelColor,
      modelUvMapDataUrl: storedPin.modelUvMapDataUrl,
      folderEntries: storedPin.folderEntries,
    });
    if (!pin) return null;
    syncPersistence();
    return pinToSerializable(pin);
  }

  function setModelColor(pinId, colorHex, requesterOwnerId = null) {
    const pin = pins.find((p) => p.id === pinId);
    if (!pin || !pin.isModelPin) return null;
    if (!canRequesterControlOwner(pin.ownerId, requesterOwnerId)) return null;
    if (!applyModelColorToPin(pin, colorHex)) return null;
    syncPersistence();
    return pinToSerializable(pin);
  }

  function setModelUvMap(pinId, uvMapDataUrl, requesterOwnerId = null) {
    const pin = pins.find((p) => p.id === pinId);
    if (!pin || !pin.isModelPin) return null;
    if (!canRequesterControlOwner(pin.ownerId, requesterOwnerId)) return null;
    const applied = applyModelUvMapToPin(pin, uvMapDataUrl);
    if (!applied) {
      onError("UV map must be an image file.");
      return null;
    }
    syncPersistence();
    return pinToSerializable(pin);
  }

  function handleClick(clientX, clientY, domElement) {
    const rect = domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(ndc, camera);
    const buttonHits = raycaster.intersectObjects(buttonMeshes, false);
    if (buttonHits[0]) {
      const pin = pins.find((p) => p.id === buttonHits[0].object.userData.pinId);
      if (pin && pin.fileType === "audio" && pin.inRadius && pin.audio) {
        if (pin.audio.paused) {
          pin.manualPaused = false;
          pin.audio.play().catch(() => {});
        } else {
          pin.manualPaused = true;
          pin.audio.pause();
        }
        refreshAudioToggleTexture(pin);
        return true;
      }
    }

    const pin = getPinAtPointer(clientX, clientY, domElement);
    if (pin && pin.inRadius && pin.fileType !== "graffiti" && pin.fileType !== "decorate") {
      overlay.show(pin);
      return true;
    }
    raycaster.setFromCamera(ndc, camera);
    const groundHits = raycaster.intersectObjects(drawables, false);
    const groundPoint = groundHits[0]?.point;
    if (groundPoint) {
      let folderPin = null;
      let bestDistance = Infinity;
      for (const candidate of pins) {
        if (candidate?.fileType !== "folder") continue;
        if (!candidate.inRadius) continue;
        const d = distance2D(candidate.position, groundPoint);
        if (d > candidate.radius) continue;
        if (d < bestDistance) {
          bestDistance = d;
          folderPin = candidate;
        }
      }
      if (folderPin) {
        overlay.show(folderPin);
        return true;
      }
    }
    return false;
  }

  function beginDecorateControlAtPointer(clientX, clientY, domElement) {
    const rect = domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(iconMeshes, false);
    if (!hits[0]) return false;
    const pin = pins.find((p) => p.id === hits[0].object.userData.pinId);
    if (!pin || !pin.inRadius || !pin.isDecoratePin) return false;
    activeDecoratePin = pin;
    rWasDown = false;
    enterWasDown = false;
    return true;
  }

  function updateDecorateControl(delta, input) {
    if (!activeDecoratePin) return "inactive";
    const speed = 4.2;
    const movement = speed * delta;
    const forward = Number(input.isDown("KeyW")) - Number(input.isDown("KeyS"));
    const strafe = Number(input.isDown("KeyD")) - Number(input.isDown("KeyA"));
    const yaw = activeDecoratePin.rotationY || 0;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.sin(yaw + Math.PI / 2);
    const rz = Math.cos(yaw + Math.PI / 2);
    activeDecoratePin.position.x += (fx * forward + rx * strafe) * movement;
    activeDecoratePin.position.z += (fz * forward + rz * strafe) * movement;

    const rDown = input.isDown("KeyR");
    if (rDown && !rWasDown) {
      activeDecoratePin.rotationY = (activeDecoratePin.rotationY || 0) + Math.PI / 2;
    }
    rWasDown = rDown;

    const enterDown = input.isDown("Enter");
    if (enterDown && !enterWasDown) {
      syncPersistence();
      activeDecoratePin = null;
      return "placed";
    }
    enterWasDown = enterDown;

    const deleteDown = input.isDown("Delete") || input.isDown("Backspace");
    if (deleteDown) {
      const doomedId = activeDecoratePin.id;
      activeDecoratePin = null;
      deletePin(doomedId);
      return "deleted";
    }

    const upDown = input.isDown("ArrowUp");
    const downDown = input.isDown("ArrowDown");
    if (upDown) activeDecoratePin.decorScale = Math.min(3, (activeDecoratePin.decorScale || 1) + delta * 0.9);
    if (downDown) activeDecoratePin.decorScale = Math.max(0.2, (activeDecoratePin.decorScale || 1) - delta * 0.9);

    return "active";
  }

  function updateDecorateCamera() {
    if (!activeDecoratePin) return;
    const yaw = activeDecoratePin.rotationY || 0;
    const behindDist = 3.3;
    const height = 2.2;
    const px = activeDecoratePin.position.x;
    const pz = activeDecoratePin.position.z;
    camera.position.set(px - Math.sin(yaw) * behindDist, height, pz - Math.cos(yaw) * behindDist);
    camera.lookAt(px, 0.35, pz);
  }

  function isDecoratingMode() {
    return Boolean(activeDecoratePin);
  }

  function setPaintColor(color) {
    paintColor = color;
  }

  function setBrushSize(sizeWorld) {
    brushSizeWorld = Math.max(0.1, Number(sizeWorld) || 0.45);
  }

  function paintAtPointer(pointer, domElement) {
    if (!activeGraffitiPin) return false;

    const rect = domElement.getBoundingClientRect();
    const px = pointer?.x ?? rect.left + rect.width / 2;
    const py = pointer?.y ?? rect.top + rect.height / 2;

    ndc.x = ((px - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((py - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(drawables, false);
    if (!hits[0] || !hits[0].uv) return false;

    const hit = hits[0];
    const paintable = hit.object.userData.paintable;
    if (!paintable) return false;

    const distance = distance2D(activeGraffitiPin.position, hit.point);
    if (distance > activeGraffitiPin.radius) return false;

    const worldFace = faceWorldDimensions(hit);
    const pxPerWorldU = paintable.canvas.width / Math.max(worldFace.u, 0.001);
    const pxPerWorldV = paintable.canvas.height / Math.max(worldFace.v, 0.001);
    const brushPx = Math.max(2, brushSizeWorld * Math.min(pxPerWorldU, pxPerWorldV));

    const x = hit.uv.x * paintable.canvas.width;
    const y = (1 - hit.uv.y) * paintable.canvas.height;
    const surfaceId = paintable.id || "surface";
    getSurfaceState(surfaceId, paintable);
    const last = lastStrokeBySurface.get(surfaceId);
    if (last) {
      const dx = x - last.x;
      const dy = y - last.y;
      const minStep = Math.max(2, brushPx * 0.35);
      if (dx * dx + dy * dy < minStep * minStep) return false;
    }
    lastStrokeBySurface.set(surfaceId, { x, y });

    const layer = getOrCreateGraffitiLayer(activeGraffitiPin.id, surfaceId, paintable.canvas.width, paintable.canvas.height);
    drawBrushArc(layer.ctx, x, y, brushPx, paintColor);
    drawBrushArc(paintable.ctx, x, y, brushPx, paintColor);
    paintable.texture.needsUpdate = true;
    return true;
  }

  return {
    addFileAtPlayer,
    addFolderAtPlayer,
    appendFilesToFolder,
    addDecorImagePinAtPlayer,
    addImageDataPinAtPlayer,
    addGraffitiPinAtPlayer,
    loadFromSaved,
    update,
    handleClick,
    setPaintColor,
    setBrushSize,
    paintAtPointer,
    deletePin,
    canPickupOwnedPinAtPointer,
    pickupOwnedPinAtPointer,
    placeStoredPin,
    setModelColor,
    setModelUvMap,
    clearActiveGraffitiArea,
    beginDecorateControlAtPointer,
    updateDecorateControl,
    updateDecorateCamera,
    isDecoratingMode,
    getSerializablePins,
    applySharedPins,
    isInGraffitiRadius: () => Boolean(activeGraffitiPin),
  };
}
