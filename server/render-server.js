import { createServer } from "http";
import { WebSocketServer } from "ws";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, extname, join, normalize, resolve } from "path";

const PORT = Number(process.env.PORT || process.env.MULTIPLAYER_PORT || 8787);
const HOST = process.env.MULTIPLAYER_HOST || "0.0.0.0";
const PLAYER_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const PLAYER_INACTIVITY_CHECK_INTERVAL_MS = 30 * 1000;
const ROOT_DIR = process.cwd();
const WORLD_STATE_PATH = resolve(process.env.WORLD_STATE_PATH || "server/world-state.json");
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const SUPABASE_WORLD_ROW_ID = "global";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
};

const world = {
  players: {},
  pins: [],
  pinsRevision: 0,
  sky: null,
  constellations: null,
  constellationsRevision: 0,
  updatedAt: Date.now(),
};

const sockets = new Map();
const clientLastSeenAt = new Map();
let playersDirty = false;
let persistTimer = null;

const worldLoadPromise = loadPersistedWorld();

const server = createServer((req, res) => {
  const rawUrl = String(req.url || "/");
  if (rawUrl === "/health" || rawUrl === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "social-plaza-render",
        players: Object.keys(world.players).length,
        pins: world.pins.length,
        updatedAt: world.updatedAt,
      })
    );
    return;
  }

  const pathOnly = rawUrl.split("?")[0] || "/";
  let filePath = safePath(pathOnly);
  if (!filePath) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }
  if (filePath.endsWith("/")) filePath = `${filePath}index.html`;
  const absPath = join(ROOT_DIR, filePath);

  if (!existsSync(absPath) || !statSync(absPath).isFile()) {
    const fallback = join(ROOT_DIR, "index.html");
    if (!existsSync(fallback)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    streamFile(fallback, "text/html; charset=utf-8", res);
    return;
  }

  const ext = extname(absPath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  streamFile(absPath, type, res);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 * 1024 });

server.on("upgrade", (req, socket, head) => {
  const pathOnly = String(req.url || "/").split("?")[0] || "/";
  if (pathOnly !== "/ws" && pathOnly !== "/") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  const id = uid();
  sockets.set(ws, id);
  markClientSeen(id);
  send(ws, { type: "welcome", clientId: id, world });

  ws.on("message", (raw) => {
    markClientSeen(id);
    const message = parseMessage(raw);
    if (!message) return;
    handleMessage(id, message);
  });

  ws.on("close", () => {
    sockets.delete(ws);
    clientLastSeenAt.delete(id);
    if (world.players[id]) {
      delete world.players[id];
      world.updatedAt = Date.now();
      playersDirty = true;
    }
  });

  ws.on("error", (error) => {
    const message = error?.message || String(error);
    console.warn(`[render] client socket error (${id}): ${message}`);
  });
});

wss.on("error", (error) => {
  const message = error?.message || String(error);
  console.warn(`[render] websocket server error: ${message}`);
});

setInterval(() => {
  if (!playersDirty) return;
  playersDirty = false;
  broadcastPlayers();
}, Math.round(1000 / 15));

setInterval(() => {
  reapInactivePlayers();
}, PLAYER_INACTIVITY_CHECK_INTERVAL_MS);

void worldLoadPromise.finally(() => {
  server.listen(PORT, HOST, () => {
    console.log(`[render] serving on http://${HOST}:${PORT}`);
  });
});

function handleMessage(clientId, message) {
  if (message.type === "join") {
    const payload = message.payload || {};
    world.players[clientId] = sanitizePlayer(payload.player, payload.maskId);
    if ((!Array.isArray(world.pins) || world.pins.length === 0) && Array.isArray(payload.pins) && payload.pins.length > 0) {
      world.pins = sanitizePins(payload.pins, clientId);
      world.pinsRevision += 1;
      schedulePersistWorld();
    }
    if (!world.sky && payload.sky) {
      world.sky = sanitizeSky(payload.sky);
      schedulePersistWorld();
    }
    if (!world.constellations && payload.constellations) {
      world.constellations = sanitizeConstellations(payload.constellations);
      world.constellationsRevision = world.constellations ? 1 : 0;
      schedulePersistWorld();
    }
    world.updatedAt = Date.now();
    playersDirty = true;
    sendToClient(clientId, { type: "world_snapshot", world });
    return;
  }

  if (message.type === "player_state") {
    if (!world.players[clientId]) world.players[clientId] = sanitizePlayer({}, null);
    world.players[clientId] = sanitizePlayer(message.payload?.player, message.payload?.maskId);
    world.updatedAt = Date.now();
    playersDirty = true;
    return;
  }

  if (message.type === "pins_update") {
    const nextPins = sanitizePins(message.payload?.pins, clientId);
    world.pins = reconcilePins(world.pins, nextPins, clientId);
    world.pinsRevision += 1;
    world.updatedAt = Date.now();
    schedulePersistWorld();
    broadcastPins();
    return;
  }

  if (message.type === "full_world_sync") {
    const nextPins = dedupePinsById(sanitizePins(message.payload?.pins, clientId));
    if (nextPins.length > 0 || world.pins.length === 0) {
      world.pins = nextPins;
      world.pinsRevision += 1;
      world.updatedAt = Date.now();
      schedulePersistWorld();
      broadcastPins();
    }

    const nextSky = sanitizeSky(message.payload?.sky);
    if (nextSky) {
      world.sky = nextSky;
      world.updatedAt = Date.now();
      schedulePersistWorld();
      broadcastSky();
    }

    const nextConstellations = sanitizeConstellations(message.payload?.constellations);
    if (nextConstellations) {
      world.constellations = nextConstellations;
      world.constellationsRevision += 1;
      world.updatedAt = Date.now();
      schedulePersistWorld();
      broadcastConstellations();
    }
    return;
  }

  if (message.type === "sky_update") {
    const nextSky = sanitizeSky(message.payload?.sky);
    if (!nextSky) return;
    world.sky = nextSky;
    world.updatedAt = Date.now();
    schedulePersistWorld();
    broadcastSky();
    return;
  }

  if (message.type === "constellations_update") {
    const next = sanitizeConstellations(message.payload?.constellations);
    if (!next) return;
    world.constellations = next;
    world.constellationsRevision += 1;
    world.updatedAt = Date.now();
    schedulePersistWorld();
    broadcastConstellations();
  }
}

function broadcastPlayers() {
  const payload = { type: "players_snapshot", players: world.players };
  for (const [ws] of sockets.entries()) {
    if (ws.readyState !== ws.OPEN) continue;
    send(ws, payload);
  }
}

function broadcastPins() {
  const payload = { type: "pins_snapshot", pins: world.pins, pinsRevision: world.pinsRevision };
  for (const [ws] of sockets.entries()) {
    if (ws.readyState !== ws.OPEN) continue;
    send(ws, payload);
  }
}

function broadcastSky() {
  if (!world.sky) return;
  const payload = { type: "sky_snapshot", sky: world.sky };
  for (const [ws] of sockets.entries()) {
    if (ws.readyState !== ws.OPEN) continue;
    send(ws, payload);
  }
}

function broadcastConstellations() {
  if (!world.constellations) return;
  const payload = {
    type: "constellations_snapshot",
    constellations: world.constellations,
    constellationsRevision: world.constellationsRevision,
  };
  for (const [ws] of sockets.entries()) {
    if (ws.readyState !== ws.OPEN) continue;
    send(ws, payload);
  }
}

function sendToClient(clientId, payload) {
  for (const [ws, id] of sockets.entries()) {
    if (id !== clientId) continue;
    if (ws.readyState !== ws.OPEN) continue;
    send(ws, payload);
    return;
  }
}

function markClientSeen(clientId) {
  if (!clientId) return;
  clientLastSeenAt.set(clientId, Date.now());
}

function reapInactivePlayers() {
  const now = Date.now();
  let removedAny = false;
  for (const [ws, id] of sockets.entries()) {
    const lastSeen = Number(clientLastSeenAt.get(id)) || 0;
    if (lastSeen <= 0) continue;
    if (now - lastSeen <= PLAYER_INACTIVITY_TIMEOUT_MS) continue;
    clientLastSeenAt.delete(id);
    sockets.delete(ws);
    if (world.players[id]) {
      delete world.players[id];
      removedAny = true;
    }
    try {
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        ws.close(4001, "Inactivity timeout");
      }
    } catch {}
  }
  if (removedAny) {
    world.updatedAt = now;
    playersDirty = true;
  }
}

function sanitizePlayer(rawPlayer, maskId) {
  const player = rawPlayer && typeof rawPlayer === "object" ? rawPlayer : {};
  const pos = player.position && typeof player.position === "object" ? player.position : {};
  return {
    position: {
      x: finite(pos.x, 0),
      y: finite(pos.y, 0),
      z: finite(pos.z, 0),
    },
    yaw: finite(player.yaw, 0),
    smoking: Boolean(player.smoking),
    grounded: Boolean(player.grounded),
    maskId: maskId ? String(maskId) : null,
  };
}

function sanitizePins(rawPins, defaultOwnerId = "") {
  if (!Array.isArray(rawPins)) return [];
  return rawPins
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: String(item.id || uid()),
      ownerId: String(item.ownerId || defaultOwnerId || ""),
      ownerLabel: String(item.ownerLabel || playerLabel(item.ownerId || defaultOwnerId || "")),
      fileType: String(item.fileType || ""),
      fileName: String(item.fileName || "file"),
      mimeType: String(item.mimeType || "application/octet-stream"),
      size: finite(item.size, 0),
      dataUrl: String(item.dataUrl || ""),
      previewDataUrl: String(item.previewDataUrl || ""),
      position: {
        x: finite(item.position?.x, 0),
        y: finite(item.position?.y, 0),
        z: finite(item.position?.z, 0),
      },
      radius: finite(item.radius, 6),
      createdAt: String(item.createdAt || new Date().toISOString()),
      rotationY: finite(item.rotationY, 0),
      decorScale: finite(item.decorScale, 1),
      folderEntries: Array.isArray(item.folderEntries)
        ? item.folderEntries
            .filter((entry) => entry && typeof entry === "object")
            .map((entry) => ({
              path: String(entry.path || ""),
              name: String(entry.name || ""),
              mimeType: String(entry.mimeType || "application/octet-stream"),
              size: finite(entry.size, 0),
              uploadedAt: String(entry.uploadedAt || ""),
              entryType: String(entry.entryType || ""),
              previewDataUrl: String(entry.previewDataUrl || ""),
              dataUrl: String(entry.dataUrl || ""),
            }))
        : [],
      graffitiLayers: Array.isArray(item.graffitiLayers)
        ? item.graffitiLayers
            .filter((layer) => layer && typeof layer === "object")
            .map((layer) => ({
              surfaceId: String(layer.surfaceId || ""),
              dataUrl: String(layer.dataUrl || ""),
            }))
            .filter((layer) => layer.surfaceId && layer.dataUrl)
        : [],
    }))
    .filter(isPinPayloadValid);
}

function isPinPayloadValid(item) {
  if (!item?.fileType) return false;
  if (item.fileType === "graffiti") return true;
  if (typeof item.dataUrl === "string" && item.dataUrl.length > 0) return true;
  if (item.fileType === "folder") return true;
  return false;
}

function sanitizeSky(rawSky) {
  if (!rawSky || typeof rawSky !== "object") return null;
  return {
    mode: rawSky.mode === "dark" ? "dark" : "light",
    skyColor: sanitizeHex(rawSky.skyColor, "#0f172a"),
    skyTop: sanitizeHex(rawSky.skyTop, "#081124"),
    skyBottom: sanitizeHex(rawSky.skyBottom, "#111f3d"),
    groundColor: sanitizeHex(rawSky.groundColor, "#f5f8ff"),
    fogColor: sanitizeHex(rawSky.fogColor, "#dce7ff"),
  };
}

function sanitizeConstellations(rawConstellations) {
  if (!rawConstellations || typeof rawConstellations !== "object") return null;
  const rawStars = Array.isArray(rawConstellations.stars) ? rawConstellations.stars.slice(0, 2000) : [];
  const rawLinks = Array.isArray(rawConstellations.links) ? rawConstellations.links.slice(0, 4000) : [];
  const stars = [];
  const byId = new Set();
  for (const star of rawStars) {
    if (!star || typeof star !== "object") continue;
    const id = String(star.id || "");
    if (!id || byId.has(id)) continue;
    const legacyPosition = star.position && typeof star.position === "object" ? star.position : null;
    const x = Number.isFinite(Number(star.x))
      ? finite(star.x, 0)
      : finite(legacyPosition?.x, 0);
    const y = Number.isFinite(Number(star.y))
      ? finite(star.y, 0)
      : finite(legacyPosition?.y, 0);
    const z = Number.isFinite(Number(star.z))
      ? finite(star.z, 0)
      : finite(legacyPosition?.z, 0);
    stars.push({
      id,
      x,
      y,
      z,
      seeded: Boolean(star.seeded),
      placedAt: Number.isFinite(Number(star.placedAt)) ? Number(star.placedAt) : Date.now(),
    });
    byId.add(id);
  }
  const links = [];
  const seen = new Set();
  for (const link of rawLinks) {
    if (!link || typeof link !== "object") continue;
    const a = String(link.a || "");
    const b = String(link.b || "");
    if (!a || !b || a === b) continue;
    if (!byId.has(a) || !byId.has(b)) continue;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const key = `${lo}|${hi}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ a: lo, b: hi });
  }
  return {
    stars,
    links,
    updatedAt: Number.isFinite(Number(rawConstellations.updatedAt))
      ? Number(rawConstellations.updatedAt)
      : Date.now(),
  };
}

function sanitizeHex(value, fallback) {
  const v = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback;
}

function reconcilePins(currentPins, incomingPins, clientId) {
  const oldById = new Map((Array.isArray(currentPins) ? currentPins : []).map((pin) => [pin.id, pin]));
  const incomingById = new Map((Array.isArray(incomingPins) ? incomingPins : []).map((pin) => [pin.id, pin]));
  const output = [];

  for (const oldPin of oldById.values()) {
    const incoming = incomingById.get(oldPin.id);
    if (!incoming) {
      if (oldPin.ownerId && oldPin.ownerId !== clientId) output.push(oldPin);
      continue;
    }
    incomingById.delete(oldPin.id);
    if (oldPin.ownerId && oldPin.ownerId !== clientId) {
      output.push(oldPin);
      continue;
    }
    output.push({
      ...incoming,
      folderEntries:
        Array.isArray(incoming.folderEntries) && incoming.folderEntries.length
          ? incoming.folderEntries
          : Array.isArray(oldPin.folderEntries)
            ? oldPin.folderEntries
            : [],
      ownerId: oldPin.ownerId || clientId,
      ownerLabel: oldPin.ownerLabel || playerLabel(oldPin.ownerId || clientId),
    });
  }

  for (const pin of incomingById.values()) {
    const ownerId = clientId;
    output.push({
      ...pin,
      ownerId,
      ownerLabel: pin.ownerLabel || playerLabel(ownerId),
    });
  }

  return dedupePinsById(output);
}

function dedupePinsById(pins) {
  const byId = new Map();
  for (const pin of Array.isArray(pins) ? pins : []) {
    if (!pin || typeof pin !== "object") continue;
    const id = String(pin.id || "");
    if (!id) continue;
    byId.set(id, pin);
  }
  const out = [...byId.values()];
  out.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  return out;
}

function parseMessage(raw) {
  try {
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.type || typeof parsed.type !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function send(ws, payload) {
  try {
    ws.send(JSON.stringify(payload));
  } catch {}
}

function uid() {
  return `p_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function playerLabel(id) {
  const safe = String(id || "");
  if (!safe) return "Unknown";
  return `Player ${safe.slice(-4).toUpperCase()}`;
}

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function loadPersistedWorld() {
  const loadedFromSupabase = await loadWorldFromSupabase();
  if (loadedFromSupabase) return;
  if (!existsSync(WORLD_STATE_PATH)) return;
  try {
    const raw = readFileSync(WORLD_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const loadedPins = sanitizePins(parsed?.pins || []);
    const loadedSky = sanitizeSky(parsed?.sky);
    const loadedConstellations = sanitizeConstellations(parsed?.constellations);
    world.pins = loadedPins;
    world.pinsRevision = Number.isFinite(Number(parsed?.pinsRevision)) ? Number(parsed.pinsRevision) : loadedPins.length ? 1 : 0;
    world.sky = loadedSky;
    world.constellations = loadedConstellations;
    world.constellationsRevision = Number.isFinite(Number(parsed?.constellationsRevision))
      ? Number(parsed.constellationsRevision)
      : loadedConstellations
        ? 1
        : 0;
    world.updatedAt = Number.isFinite(Number(parsed?.updatedAt)) ? Number(parsed.updatedAt) : Date.now();
    console.log(`[render] loaded ${loadedPins.length} pins from ${WORLD_STATE_PATH}`);
  } catch (error) {
    console.warn("[render] failed to load persisted world state:", error?.message || error);
  }
}

function schedulePersistWorld() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    await persistWorld();
  }, 200);
}

async function persistWorld() {
  if (await persistWorldToSupabase()) return;
  try {
    mkdirSync(dirname(WORLD_STATE_PATH), { recursive: true });
    writeFileSync(
      WORLD_STATE_PATH,
      JSON.stringify(
        {
          pins: world.pins,
          pinsRevision: world.pinsRevision,
          sky: world.sky,
          constellations: world.constellations,
          constellationsRevision: world.constellationsRevision,
          updatedAt: world.updatedAt,
        },
        null,
        2
      ),
      "utf8"
    );
  } catch (error) {
    console.warn("[render] failed to persist world state:", error?.message || error);
  }
}

process.on("SIGINT", () => {
  void persistWorld().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void persistWorld().finally(() => process.exit(0));
});

async function loadWorldFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const url = `${SUPABASE_URL}/rest/v1/world_state?id=eq.${encodeURIComponent(SUPABASE_WORLD_ROW_ID)}&select=pins,pins_revision,sky,constellations,constellations_revision,updated_at`;
    const response = await fetch(url, {
      headers: supabaseHeaders(),
    });
    if (!response.ok) {
      console.warn("[render] failed to load world from Supabase:", response.status, await response.text());
      return false;
    }
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return false;
    const loadedPins = sanitizePins(row.pins || []);
    const loadedSky = sanitizeSky(row.sky);
    const loadedConstellations = sanitizeConstellations(row.constellations);
    world.pins = loadedPins;
    world.pinsRevision = Number.isFinite(Number(row.pins_revision)) ? Number(row.pins_revision) : loadedPins.length ? 1 : 0;
    world.sky = loadedSky;
    world.constellations = loadedConstellations;
    world.constellationsRevision = Number.isFinite(Number(row.constellations_revision))
      ? Number(row.constellations_revision)
      : loadedConstellations
        ? 1
        : 0;
    world.updatedAt = Number.isFinite(Number(row.updated_at)) ? Number(row.updated_at) : Date.now();
    console.log(`[render] loaded ${loadedPins.length} pins from Supabase`);
    return true;
  } catch (error) {
    console.warn("[render] failed to load world from Supabase:", error?.message || error);
    return false;
  }
}

async function persistWorldToSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const url = `${SUPABASE_URL}/rest/v1/world_state?on_conflict=id`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...supabaseHeaders(),
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([
        {
          id: SUPABASE_WORLD_ROW_ID,
          pins: world.pins,
          pins_revision: world.pinsRevision,
          sky: world.sky,
          constellations: world.constellations,
          constellations_revision: world.constellationsRevision,
          updated_at: world.updatedAt,
        },
      ]),
    });
    if (!response.ok) {
      console.warn("[render] failed to persist world to Supabase:", response.status, await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[render] failed to persist world to Supabase:", error?.message || error);
    return false;
  }
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

function safePath(urlPath) {
  const normalized = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const candidate = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  if (candidate.includes("..")) return null;
  return candidate || "index.html";
}

function streamFile(absPath, contentType, res) {
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": contentType.includes("text/html") ? "no-cache" : "public, max-age=31536000, immutable",
  });
  createReadStream(absPath).pipe(res);
}
