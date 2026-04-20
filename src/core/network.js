export class NetworkClient {
  constructor(url = null) {
    this.connected = false;
    this.handlers = new Map();
    this.socket = null;
    this.clientId = null;
    this.url = url || inferWsUrl();
    this.reconnectTimer = null;
    this.reconnectDelayMs = 1200;
    this.allowReconnect = true;
  }

  connect() {
    this.allowReconnect = true;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    try {
      this.socket = new WebSocket(this.url);
    } catch (error) {
      this.emit("error", { error, at: Date.now() });
      this.scheduleReconnect();
      return;
    }

    this.socket.addEventListener("open", () => {
      this.connected = true;
      this.emit("connected", { at: Date.now(), url: this.url });
    });

    this.socket.addEventListener("close", () => {
      this.connected = false;
      this.emit("disconnected", { at: Date.now() });
      if (this.allowReconnect) this.scheduleReconnect();
    });

    this.socket.addEventListener("error", (error) => {
      this.emit("error", { error, at: Date.now() });
    });

    this.socket.addEventListener("message", (event) => {
      let message = null;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message || typeof message !== "object") return;
      if (message.type === "welcome" && message.clientId) {
        this.clientId = String(message.clientId);
      }
      this.emit("message", message);
      this.emit(message.type || "message", message);
    });
  }

  disconnect() {
    this.allowReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connected = false;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    } else {
      this.emit("disconnected", { at: Date.now() });
    }
  }

  send(event, payload) {
    if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: event, payload }));
    this.emit("sent", { event, payload, at: Date.now() });
  }

  on(event, callback) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(callback);
  }

  emit(event, payload) {
    const callbacks = this.handlers.get(event) || [];
    for (const cb of callbacks) cb(payload);
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
  }
}

export class RemoteAvatarStore {
  constructor() {
    this.avatars = new Map();
  }

  upsert(id, nextState) {
    const prev = this.avatars.get(id);
    const state = sanitizeRemoteState(nextState);
    if (!state) return;
    if (prev) {
      prev.target.position = state.position;
      prev.target.yaw = state.yaw;
      prev.maskId = state.maskId || prev.maskId;
      prev.updatedAt = Date.now();
      return;
    }
    this.avatars.set(id, {
      id,
      position: { ...state.position },
      yaw: state.yaw,
      target: {
        position: { ...state.position },
        yaw: state.yaw,
      },
      maskId: state.maskId || null,
      updatedAt: Date.now(),
    });
  }

  replaceAll(statesById, selfId) {
    const incoming = new Set();
    for (const [id, state] of Object.entries(statesById || {})) {
      if (id === selfId) continue;
      incoming.add(id);
      this.upsert(id, state);
    }
    for (const id of this.avatars.keys()) {
      if (!incoming.has(id)) this.avatars.delete(id);
    }
  }

  tick(delta) {
    const alpha = 1 - Math.exp(-12 * delta);
    for (const avatar of this.avatars.values()) {
      avatar.position.x += (avatar.target.position.x - avatar.position.x) * alpha;
      avatar.position.y += (avatar.target.position.y - avatar.position.y) * alpha;
      avatar.position.z += (avatar.target.position.z - avatar.position.z) * alpha;
      const yawDiff = normalizeAngle(avatar.target.yaw - avatar.yaw);
      avatar.yaw += yawDiff * alpha;
    }
  }

  remove(id) {
    this.avatars.delete(id);
  }

  list() {
    return Array.from(this.avatars.entries()).map(([id, state]) => ({ id, state }));
  }
}

function inferWsUrl() {
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("ws");
  if (explicit) return explicit;
  const { protocol, hostname } = window.location;
  if (protocol === "https:") return `wss://${hostname}/ws`;
  return `ws://${hostname}:8787`;
}

function sanitizeRemoteState(raw) {
  const x = Number(raw?.position?.x);
  const y = Number(raw?.position?.y);
  const z = Number(raw?.position?.z);
  const yaw = Number(raw?.yaw);
  if (![x, y, z, yaw].every(Number.isFinite)) return null;
  return {
    position: { x, y, z },
    yaw,
    maskId: raw?.maskId ? String(raw.maskId) : null,
  };
}

function normalizeAngle(a) {
  return (((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}
