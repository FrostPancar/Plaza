import { WebSocketServer } from "ws";
import { createServer } from "http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

const PORT = Number(process.env.MULTIPLAYER_PORT || 8787);
const HOST = process.env.MULTIPLAYER_HOST || "127.0.0.1";
const PLAYER_BROADCAST_HZ = 15;
const WORLD_STATE_PATH = resolve(process.env.WORLD_STATE_PATH || "server/world-state.json");

const world = {
  players: {},
  pins: [],
  pinsRevision: 0,
  updatedAt: Date.now(),
};

const sockets = new Map();
let playersDirty = false;
let persistTimer = null;

loadPersistedWorld();

const server = createServer((_, res) => {
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(
    JSON.stringify({
      ok: true,
      service: "social-plaza-multiplayer",
      players: Object.keys(world.players).length,
      pins: world.pins.length,
      updatedAt: world.updatedAt,
    })
  );
});

const wss = new WebSocketServer({ server, path: "/" });

wss.on("connection", (ws) => {
  const id = uid();
  sockets.set(ws, id);
  send(ws, { type: "welcome", clientId: id, world });

  ws.on("message", (raw) => {
    const message = parseMessage(raw);
    if (!message) return;
    handleMessage(id, message);
  });

  ws.on("close", () => {
    sockets.delete(ws);
    if (world.players[id]) {
      delete world.players[id];
      world.updatedAt = Date.now();
      playersDirty = true;
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[multiplayer] listening on ws://${HOST}:${PORT}`);
});

setInterval(() => {
  if (!playersDirty) return;
  playersDirty = false;
  broadcastPlayers();
}, Math.round(1000 / PLAYER_BROADCAST_HZ));

function handleMessage(clientId, message) {
  if (message.type === "join") {
    const payload = message.payload || {};
    world.players[clientId] = sanitizePlayer(payload.player, payload.maskId);
    if ((!Array.isArray(world.pins) || world.pins.length === 0) && Array.isArray(payload.pins) && payload.pins.length > 0) {
      world.pins = sanitizePins(payload.pins, clientId);
      world.pinsRevision += 1;
      schedulePersistWorld();
    }
    world.updatedAt = Date.now();
    playersDirty = true;
    sendToClient(clientId, { type: "world_snapshot", world });
    return;
  }

  if (message.type === "player_state") {
    if (!world.players[clientId]) world.players[clientId] = sanitizePlayer({}, null);
    const next = sanitizePlayer(message.payload?.player, message.payload?.maskId);
    world.players[clientId] = next;
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

function sendToClient(clientId, payload) {
  for (const [ws, id] of sockets.entries()) {
    if (id !== clientId) continue;
    if (ws.readyState !== ws.OPEN) continue;
    send(ws, payload);
    return;
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
    .filter((item) => item.fileType && (item.fileType === "graffiti" || item.dataUrl));
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

  output.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  return output;
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

function loadPersistedWorld() {
  if (!existsSync(WORLD_STATE_PATH)) return;
  try {
    const raw = readFileSync(WORLD_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const loadedPins = sanitizePins(parsed?.pins || []);
    world.pins = loadedPins;
    world.pinsRevision = Number.isFinite(Number(parsed?.pinsRevision)) ? Number(parsed.pinsRevision) : loadedPins.length ? 1 : 0;
    world.updatedAt = Number.isFinite(Number(parsed?.updatedAt)) ? Number(parsed.updatedAt) : Date.now();
    console.log(`[multiplayer] loaded ${loadedPins.length} pins from ${WORLD_STATE_PATH}`);
  } catch (error) {
    console.warn("[multiplayer] failed to load persisted world state:", error?.message || error);
  }
}

function schedulePersistWorld() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistWorld();
  }, 200);
}

function persistWorld() {
  try {
    mkdirSync(dirname(WORLD_STATE_PATH), { recursive: true });
    writeFileSync(
      WORLD_STATE_PATH,
      JSON.stringify(
        {
          pins: world.pins,
          pinsRevision: world.pinsRevision,
          updatedAt: world.updatedAt,
        },
        null,
        2
      ),
      "utf8"
    );
  } catch (error) {
    console.warn("[multiplayer] failed to persist world state:", error?.message || error);
  }
}

process.on("SIGINT", () => {
  persistWorld();
  process.exit(0);
});

process.on("SIGTERM", () => {
  persistWorld();
  process.exit(0);
});
