function paintBase(ctx, width, height, baseA, baseB) {
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, baseA);
  grad.addColorStop(1, baseB);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

function createPaintableMaterial(THREE, {
  width = 1024,
  height = 1024,
  baseA = "#ffffff",
  baseB = "#ffffff",
  roughness = 0.9,
  metalness = 0.02,
} = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  paintBase(ctx, width, height, baseA, baseB);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness,
    metalness,
  });

  return { material, canvas, ctx, texture };
}

function createPaintableSurface({ THREE, geometry, position, paint, id, dimensions }) {
  const paintable = createPaintableMaterial(THREE, paint);
  const mesh = new THREE.Mesh(geometry, paintable.material);
  mesh.position.set(...position);
  mesh.userData.paintable = {
    id,
    ctx: paintable.ctx,
    canvas: paintable.canvas,
    texture: paintable.texture,
    dimensions,
  };
  return mesh;
}

export function createPlazaScene(THREE, scene) {
  const drawables = [];
  const paintablesById = new Map();
  let groundBaseA = "#ffffff";
  let groundBaseB = "#ffffff";

  const ground = createPaintableSurface({
    THREE,
    geometry: new THREE.PlaneGeometry(260, 260),
    position: [0, 0, 0],
    paint: {
      width: 2048,
      height: 2048,
      baseA: groundBaseA,
      baseB: groundBaseB,
      roughness: 0.9,
      metalness: 0.02,
    },
    id: "ground_main",
    dimensions: { x: 260, y: 0.1, z: 260 },
  });
  ground.rotation.x = -Math.PI / 2;
  ground.material.metalness = 0.02;
  ground.material.roughness = 0.9;
  scene.add(ground);
  drawables.push(ground);
  paintablesById.set("ground_main", ground);

  function setGroundColor(hex) {
    const color = normalizeHex(hex, "#ffffff");
    const shaded = color;
    groundBaseA = color;
    groundBaseB = shaded;
    const paintable = ground.userData.paintable;
    paintBase(paintable.ctx, paintable.canvas.width, paintable.canvas.height, groundBaseA, groundBaseB);
    paintable.texture.needsUpdate = true;
  }

  function serializePaintState() {
    const out = [];
    for (const [id, mesh] of paintablesById.entries()) {
      out.push({
        id,
        dataUrl: mesh.userData.paintable.canvas.toDataURL("image/png"),
      });
    }
    return out;
  }

  function restorePaintState(entries) {
    if (!Array.isArray(entries)) return;
    for (const item of entries) {
      const mesh = paintablesById.get(item?.id);
      if (!mesh || !item?.dataUrl) continue;

      const image = new Image();
      image.onload = () => {
        const paintable = mesh.userData.paintable;
        paintable.ctx.clearRect(0, 0, paintable.canvas.width, paintable.canvas.height);
        paintable.ctx.drawImage(image, 0, 0, paintable.canvas.width, paintable.canvas.height);
        paintable.texture.needsUpdate = true;
      };
      image.src = item.dataUrl;
    }
  }

  return {
    drawables,
    serializePaintState,
    restorePaintState,
    setGroundColor,
  };
}

export function addLighting(THREE, scene) {
  const hemi = new THREE.HemisphereLight(0xfbfcff, 0xeef3fa, 1.15);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(35, 85, 24);
  scene.add(sun);

  scene.fog = new THREE.Fog(0xeef3fa, 58, 290);
  scene.background = new THREE.Color(0xf3f5f7);
  const baseFogColor = new THREE.Color(0xeef3fa);
  const fogShadeA = new THREE.Color();
  const fogShadeB = new THREE.Color();
  const fogMixed = new THREE.Color();

  function setSkyColor(hex) {
    const color = normalizeHex(hex, "#f3f5f7");
    const skyColor = new THREE.Color(color);
    const deepFogHex = shadeHex(color, -18);
    const deepFog = new THREE.Color(deepFogHex);
    scene.background = new THREE.Color(color);
    scene.fog = new THREE.Fog(deepFog.getHex(), 58, 290);
    baseFogColor.copy(deepFog);
    fogShadeA.copy(baseFogColor).multiplyScalar(0.92);
    fogShadeB.copy(baseFogColor).lerp(skyColor, 0.24);
  }

  function updateAtmosphere(timeSeconds) {
    if (!scene.fog) return;
    const t = Number.isFinite(timeSeconds) ? timeSeconds : 0;
    const waveA = Math.sin(t * 0.075) * 0.5 + 0.5;
    const waveB = Math.sin(t * 0.047 + 1.7) * 0.5 + 0.5;
    fogMixed.copy(fogShadeA).lerp(fogShadeB, waveA * 0.6 + waveB * 0.4);
    scene.fog.color.copy(fogMixed);
    scene.fog.near = 52 + (waveB - 0.5) * 10;
    scene.fog.far = 286 + (waveA - 0.5) * 24;
  }

  setSkyColor("#f3f5f7");

  return {
    setSkyColor,
    updateAtmosphere,
  };
}

function normalizeHex(value, fallback) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  return fallback;
}

function shadeHex(hex, amount) {
  const safe = normalizeHex(hex, "#ffffff");
  const n = Number.parseInt(safe.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
