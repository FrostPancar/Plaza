function drawSymbol(ctx, type, color) {
  const c = 128;
  const r = 54;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 14;
  ctx.lineCap = "round";

  switch (type) {
    case "circle":
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "triangle":
      ctx.beginPath();
      ctx.moveTo(c, c - r);
      ctx.lineTo(c - r, c + r * 0.85);
      ctx.lineTo(c + r, c + r * 0.85);
      ctx.closePath();
      ctx.stroke();
      break;
    case "square":
      ctx.strokeRect(c - r, c - r, r * 2, r * 2);
      break;
    case "cross":
      ctx.beginPath();
      ctx.moveTo(c - r, c - r);
      ctx.lineTo(c + r, c + r);
      ctx.moveTo(c + r, c - r);
      ctx.lineTo(c - r, c + r);
      ctx.stroke();
      break;
    case "diamond":
      ctx.beginPath();
      ctx.moveTo(c, c - r);
      ctx.lineTo(c - r, c);
      ctx.lineTo(c, c + r);
      ctx.lineTo(c + r, c);
      ctx.closePath();
      ctx.stroke();
      break;
    case "arc":
      ctx.beginPath();
      ctx.arc(c, c, r, Math.PI * 0.2, Math.PI * 1.8);
      ctx.stroke();
      break;
    case "bars":
      for (let i = -1; i <= 1; i++) {
        ctx.fillRect(c + i * 28 - 8, c - r, 16, r * 2);
      }
      break;
    case "ring":
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c, c, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.fillRect(c - 6, c - 6, 12, 12);
      break;
  }
}

function createMaskCanvas(maskDef) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = maskDef.materialConfig.base;
  ctx.fillRect(0, 0, 256, 256);

  ctx.globalAlpha = 0.14;
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = maskDef.materialConfig.accent;
    ctx.beginPath();
    ctx.arc(30 + i * 32, 40 + (i % 2) * 26, 10 + i * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  drawSymbol(ctx, maskDef.symbolType, maskDef.materialConfig.accent);
  return canvas;
}

export function buildMasks(THREE, definitions) {
  return definitions.map((def) => {
    const canvas = createMaskCanvas(def);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    return {
      ...def,
      texture,
      previewUrl: canvas.toDataURL(),
    };
  });
}
