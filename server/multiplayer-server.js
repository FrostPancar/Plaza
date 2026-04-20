import { WebSocketServer } from "ws";
import { createServer } from "http";

const PORT = Number(process.env.MULTIPLAYER_PORT || 8787);
const HOST = process.env.MULTIPLAYER_HOST || "127.0.0.1";
const PLAYER_BROADCAST_HZ = 15;

const world = {
  players: {},
  pins: [],
  pinsRevision: 0,
  updatedAt: Date.now(),
};

const sockets = new Map();
let playersDirty = false;

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
