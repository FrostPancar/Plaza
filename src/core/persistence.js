const STORAGE_KEY = "socialPlaza.save.v1";
const SCHEMA_VERSION = 1;
const UPLOAD_DB_NAME = "socialPlaza.uploads.v1";
const UPLOAD_DB_STORE = "uploads";
const UPLOAD_DB_KEY = "all";

function clampNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function createDefaultSave() {
  return {
    schemaVersion: SCHEMA_VERSION,
    player: {
      position: { x: 0, y: 0, z: 8 },
      yaw: 0,
      cameraYaw: 0,
      cameraPitch: 0.35,
    },
    avatar: {
      selectedMaskId: null,
    },
    world: {
      interactions: [],
    },
    uploads: [],
    visuals: {
      skyColor: "#f3f5f7",
      groundColor: "#ffffff",
      darkMode: false,
      filters: {
        pixelation: 63,
        vignette: 0,
      },
    },
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeSave(raw) {
  const base = createDefaultSave();
  if (!raw || typeof raw !== "object") return base;

  if (raw.schemaVersion !== SCHEMA_VERSION) return base;

  const merged = {
    ...base,
    ...raw,
    player: {
      ...base.player,
      ...(raw.player || {}),
      position: {
        ...base.player.position,
        ...((raw.player && raw.player.position) || {}),
      },
    },
    avatar: {
      ...base.avatar,
      ...(raw.avatar || {}),
    },
    world: {
      ...base.world,
      ...(raw.world || {}),
      interactions: Array.isArray(raw.world?.interactions) ? raw.world.interactions : [],
    },
    uploads: Array.isArray(raw.uploads) ? raw.uploads : [],
    visuals: {
      ...base.visuals,
      ...(raw.visuals || {}),
      filters: {
        ...base.visuals.filters,
        ...(raw.visuals?.filters || {}),
      },
    },
  };

  merged.player.position.x = clampNumber(merged.player.position.x, base.player.position.x);
  merged.player.position.y = clampNumber(merged.player.position.y, base.player.position.y);
  merged.player.position.z = clampNumber(merged.player.position.z, base.player.position.z);
  merged.player.yaw = clampNumber(merged.player.yaw, base.player.yaw);
  merged.player.cameraYaw = clampNumber(merged.player.cameraYaw, merged.player.yaw);
  merged.player.cameraPitch = clampNumber(merged.player.cameraPitch, base.player.cameraPitch);
  merged.uploads = merged.uploads
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: String(item.id || ""),
      fileType: String(item.fileType || ""),
      fileName: String(item.fileName || "file"),
      ownerId: String(item.ownerId || ""),
      ownerLabel: String(item.ownerLabel || ""),
      mimeType: String(item.mimeType || "application/octet-stream"),
      size: clampNumber(item.size, 0),
      dataUrl: String(item.dataUrl || ""),
      externalData: Boolean(item.externalData),
      graffitiLayers: Array.isArray(item.graffitiLayers)
        ? item.graffitiLayers
            .filter((layer) => layer && typeof layer === "object")
            .map((layer) => ({
              surfaceId: String(layer.surfaceId || ""),
              dataUrl: String(layer.dataUrl || ""),
            }))
            .filter((layer) => layer.surfaceId && layer.dataUrl)
        : [],
      position: {
        x: clampNumber(item.position?.x, 0),
        y: clampNumber(item.position?.y, 0),
        z: clampNumber(item.position?.z, 0),
      },
      radius: clampNumber(item.radius, 6),
      createdAt: String(item.createdAt || new Date().toISOString()),
      rotationY: clampNumber(item.rotationY, 0),
      decorScale: clampNumber(item.decorScale, 1),
      modelColor: String(item.modelColor || ""),
      modelUvMapDataUrl: String(item.modelUvMapDataUrl || ""),
      folderEntries: Array.isArray(item.folderEntries)
        ? item.folderEntries
            .filter((entry) => entry && typeof entry === "object")
            .map((entry) => ({
              path: String(entry.path || ""),
              name: String(entry.name || ""),
              mimeType: String(entry.mimeType || ""),
              size: clampNumber(entry.size, 0),
              entryType: String(entry.entryType || ""),
              previewDataUrl: String(entry.previewDataUrl || ""),
            }))
        : [],
    }))
    .filter((item) => item.id && item.fileType && (item.fileType === "graffiti" || item.dataUrl || item.externalData));
  merged.visuals.skyColor = String(merged.visuals.skyColor || base.visuals.skyColor);
  merged.visuals.groundColor = String(merged.visuals.groundColor || base.visuals.groundColor);
  merged.visuals.darkMode = Boolean(merged.visuals.darkMode);
  merged.visuals.filters.pixelation = clampNumber(merged.visuals.filters.pixelation, base.visuals.filters.pixelation);
  merged.visuals.filters.vignette = clampNumber(merged.visuals.filters.vignette, base.visuals.filters.vignette);

  return merged;
}

export function createPersistence() {
  let save = createDefaultSave();

  function openUploadDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open(UPLOAD_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(UPLOAD_DB_STORE)) db.createObjectStore(UPLOAD_DB_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
    });
  }

  async function writeUploadsToDb(uploads) {
    const db = await openUploadDb();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(UPLOAD_DB_STORE, "readwrite");
      const store = tx.objectStore(UPLOAD_DB_STORE);
      store.put(Array.isArray(uploads) ? uploads : [], UPLOAD_DB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB write aborted"));
    });
    db.close();
  }

  async function readUploadsFromDb() {
    const db = await openUploadDb();
    if (!db) return [];
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction(UPLOAD_DB_STORE, "readonly");
      const store = tx.objectStore(UPLOAD_DB_STORE);
      const req = store.get(UPLOAD_DB_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
    });
    db.close();
    return Array.isArray(value) ? value : [];
  }

  function compactUploadsForLocal(uploads) {
    if (!Array.isArray(uploads)) return [];
    return uploads
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const isGraffiti = String(item.fileType || "") === "graffiti";
        return {
          ...item,
          dataUrl: isGraffiti ? String(item.dataUrl || "") : item.dataUrl ? `idb://${String(item.id || "")}` : "",
          externalData: !isGraffiti && Boolean(item.dataUrl),
        };
      });
  }

  function isDbPointer(value) {
    return typeof value === "string" && value.startsWith("idb://");
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        save = createDefaultSave();
        return save;
      }

      save = sanitizeSave(JSON.parse(raw));
      persist();
      return save;
    } catch {
      save = createDefaultSave();
      persist();
      return save;
    }
  }

  function persist() {
    try {
      save.updatedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
    } catch (error) {
      console.warn("Persistence write failed:", error);
    }
  }

  function setMask(maskId) {
    save.avatar.selectedMaskId = maskId;
    persist();
  }

  function setPlayerState(playerState) {
    save.player = {
      ...save.player,
      position: {
        x: clampNumber(playerState.position?.x, save.player.position.x),
        y: clampNumber(playerState.position?.y, save.player.position.y),
        z: clampNumber(playerState.position?.z, save.player.position.z),
      },
      yaw: clampNumber(playerState.yaw, save.player.yaw),
      cameraYaw: clampNumber(playerState.cameraYaw, save.player.cameraYaw),
      cameraPitch: clampNumber(playerState.cameraPitch, save.player.cameraPitch),
    };
    persist();
  }

  function getSave() {
    return save;
  }

  function setUploads(uploads) {
    const normalized = Array.isArray(uploads) ? uploads : [];
    save.uploads = compactUploadsForLocal(normalized);
    persist();
    void writeUploadsToDb(normalized).catch((error) => {
      console.warn("IndexedDB uploads write failed:", error);
    });
  }

  async function hydrateUploads() {
    try {
      const dbUploads = await readUploadsFromDb();
      if (Array.isArray(dbUploads) && dbUploads.length) {
        save.uploads = dbUploads;
        return dbUploads;
      }
    } catch (error) {
      console.warn("IndexedDB uploads read failed:", error);
    }

    const fallback = (save.uploads || []).filter(
      (item) => item && typeof item === "object" && item.dataUrl && !isDbPointer(item.dataUrl)
    );
    save.uploads = fallback;
    return fallback;
  }

  function setWorldInteractions(interactions) {
    save.world.interactions = Array.isArray(interactions) ? interactions : [];
    persist();
  }

  function setVisuals(visuals) {
    save.visuals = {
      ...save.visuals,
      ...(visuals || {}),
      filters: {
        ...save.visuals.filters,
        ...(visuals?.filters || {}),
      },
    };
    persist();
  }

  return {
    load,
    persist,
    setMask,
    setPlayerState,
    setUploads,
    hydrateUploads,
    setWorldInteractions,
    setVisuals,
    getSave,
  };
}
