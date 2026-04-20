import * as THREE from "https://unpkg.com/three@0.180.0/build/three.module.js";
import { MASK_OPTIONS } from "./config/masks.js?v=20260420af";
import { createActionRegistry } from "./config/actions.js?v=20260420af";
import { createPersistence, createDefaultSave } from "./core/persistence.js?v=20260420af";
import { NetworkClient, RemoteAvatarStore } from "./core/network.js?v=20260420ah";
import { createPlazaScene, addLighting } from "./game/plazaScene.js?v=20260420af";
import { createInput } from "./game/input.js?v=20260420af";
import { buildMasks } from "./game/maskFactory.js?v=20260420af";
import { createPlayerController } from "./game/player.js?v=20260420af";
import { createThirdPersonCameraRig } from "./game/cameraRig.js?v=20260420af";
import { createUploadPinManager } from "./game/uploadPins.js?v=20260420ag";
import { createMaskSelectionUI } from "./ui/maskSelection.js?v=20260420af";
import { createActionMenuUI } from "./ui/actionMenu.js?v=20260420af";
import { createFileOverlayUI } from "./ui/fileOverlay.js?v=20260420af";
import { createGraffitiPaletteUI } from "./ui/graffitiPalette.js?v=20260420af";
import { createColorPanelUI, createFilterPanelUI } from "./ui/environmentPanels.js?v=20260420af";
import { createTouchJoystickUI } from "./ui/touchJoystick.js?v=20260420af";
import { captureSelfie } from "./ui/cameraCapture.js?v=20260420af";

const GRAFFITI_COLORS = ["#ff4d4d", "#2f74ff", "#1fbf6d", "#f4b400"];
const REMOTE_AVATAR_VISIBILITY_RADIUS = 56;
const PLAYER_SYNC_INTERVAL = 0.12;
const PLAYER_SYNC_POS_EPS = 0.025;
const PLAYER_SYNC_YAW_EPS = 0.02;
const MOBILE_LOOK_SENSITIVITY = 1.15;
const MOBILE_TAP_MAX_MOVE = 10;
const MOBILE_PICKUP_HOLD_SECONDS = 0.5;
const INVENTORY_THROW_GRAVITY = 18;
const INVENTORY_THROW_MAX_TIME = 3.2;
const INVENTORY_THROW_MAX_TRAIL_POINTS = 28;
const INVENTORY_THROW_TRAIL_HEAD_RADIUS = 0.11;
const INVENTORY_THROW_TRAIL_TAIL_RADIUS = 0.02;
const AUTO_QUALITY_UPDATE_SECONDS = 1;
const AUTO_QUALITY_COOLDOWN_SECONDS = 2.5;
const AUTO_QUALITY_DOWN_FPS = 48;
const AUTO_QUALITY_UP_FPS = 57;
const AUTO_QUALITY_SCALES = [1, 0.88, 0.76, 0.64];
const TRUSTED_DEVICE_KEY = "plaza.trustedDevice.v1";

const root = document.getElementById("game-root");
const uiRoot = document.getElementById("ui-root");
const persistence = createPersistence();
const loadedSave = persistence.load() || createDefaultSave();
const loadedVisuals = loadedSave?.visuals || {};

const renderer = new THREE.WebGLRenderer({ antialias: true });
let pixelationStrength = clamp(Number(loadedVisuals?.filters?.pixelation), 0, 300, 63);
let vignetteStrength = clamp(Number(loadedVisuals?.filters?.vignette), 0, 100, 0);
let renderScale = pixelationToScale(pixelationStrength);
let autoQualityLevel = 0;
let autoQualityScale = AUTO_QUALITY_SCALES[0];
let lastAppliedRenderScale = -1;
let fpsSampleAccumulator = 0;
let fpsSampleTime = 0;
let qualityCooldown = 0;
let reflectionFrameCounter = 0;
renderer.setSize(window.innerWidth * renderScale, window.innerHeight * renderScale, false);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.style.width = "100%";
renderer.domElement.style.height = "100%";
renderer.domElement.style.imageRendering = "pixelated";
root.appendChild(renderer.domElement);

root.style.position = "fixed";
root.style.inset = "0";

const vignetteOverlay = document.createElement("div");
vignetteOverlay.style.position = "absolute";
vignetteOverlay.style.inset = "0";
vignetteOverlay.style.pointerEvents = "none";
vignetteOverlay.style.background =
  "radial-gradient(circle at center, rgba(0,0,0,0) 42%, rgba(0,0,0,0.55) 100%)";
root.appendChild(vignetteOverlay);

const scene = new THREE.Scene();
const lighting = addLighting(THREE, scene);
const plaza = createPlazaScene(THREE, scene);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 600);
plaza.restorePaintState(loadedSave.world?.interactions || []);
let skyColor = normalizeHex(loadedSave?.visuals?.skyColor, "#f3f5f7");
let groundColor = normalizeHex(loadedSave?.visuals?.groundColor, "#ffffff");
if (groundColor === "#e8eaed" || groundColor === "#f5f7fb" || groundColor === "#fbfcff") groundColor = "#ffffff";
let darkMode = Boolean(loadedSave?.visuals?.darkMode);
applyThemeColors();
applyFilters();

const networkClient = new NetworkClient();
const remoteAvatars = new RemoteAvatarStore();
let remoteAvatarRenderer = null;
let suppressNetworkPinBroadcast = false;
let networkReady = false;
let lastPinsRevision = -1;
let lastSentPlayerState = null;
let lastSentMaskId = null;

const input = createInput();
input.bind(renderer.domElement);
const hostname = String(window.location.hostname || "").toLowerCase();
const isLocalhostHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
const trustedFromStorage = safeLocalStorageGet(TRUSTED_DEVICE_KEY) === "1";
const urlParams = new URLSearchParams(window.location.search);
const trustDeviceParam = urlParams.get("trustDevice");
let trustedDevice = isLocalhostHost || trustedFromStorage;
if (trustDeviceParam === "1") {
  trustedDevice = true;
  safeLocalStorageSet(TRUSTED_DEVICE_KEY, "1");
} else if (trustDeviceParam === "0") {
  trustedDevice = false;
  safeLocalStorageSet(TRUSTED_DEVICE_KEY, "0");
}
const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
const hasLikelyHardwareKeyboard = window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches ?? true;
const useTouchControls = isTouchDevice && !hasLikelyHardwareKeyboard;

let uploadPins;
const overlay = createFileOverlayUI(uiRoot, {
  canDelete: (pin) =>
    trustedDevice || Boolean(networkClient.clientId && pin?.ownerId && pin.ownerId === networkClient.clientId),
  onDelete: (pin) => {
    if (trustedDevice) {
      const privilegedOwnerId = String(pin?.ownerId || networkClient.clientId || "");
      const didDelete = uploadPins?.deletePin(pin.id, privilegedOwnerId);
      if (didDelete) showToast("Pin deleted.");
      else showToast("Could not delete pin.");
      return;
    }
    const ownerId = networkClient.clientId || "";
    if (!ownerId || !pin?.ownerId || pin.ownerId !== ownerId) {
      showToast("Only the uploader can delete this item.");
      return;
    }
    const didDelete = uploadPins?.deletePin(pin.id, ownerId);
    if (didDelete) showToast("Pin deleted.");
  },
  onSetModelColor: (pin, colorHex) => {
    if (!pin?.id) return null;
    const ownerId = networkClient.clientId || null;
    const updated = uploadPins?.setModelColor(pin.id, colorHex, ownerId);
    if (!updated) {
      showToast("Could not update model color.");
      return null;
    }
    showToast("Model color updated.");
    return updated;
  },
  onSetModelUvMap: (pin, uvMapDataUrl) => {
    if (!pin?.id) return null;
    const ownerId = networkClient.clientId || null;
    const updated = uploadPins?.setModelUvMap(pin.id, uvMapDataUrl, ownerId);
    if (!updated) {
      showToast("Could not update UV map.");
      return null;
    }
    showToast(uvMapDataUrl ? "UV map applied." : "UV map cleared.");
    return updated;
  },
  onAppendToFolder: async (pin, files) => {
    if (!pin?.id) return null;
    const updated = await uploadPins?.appendFilesToFolder?.(pin.id, files, null);
    if (!updated) {
      showToast("Could not add files to folder.");
      return null;
    }
    showToast("Folder updated.");
    return updated;
  },
});

const notification = document.createElement("div");
notification.className = "status-toast hidden";
uiRoot.appendChild(notification);

const inventorySlot = document.createElement("div");
inventorySlot.className = "inventory-slot empty";
inventorySlot.innerHTML =
  '<div class="inventory-slot-key">INV</div><div class="inventory-slot-preview"></div><div class="inventory-slot-item"></div>';
const inventorySlotPreview = inventorySlot.querySelector(".inventory-slot-preview");
const inventorySlotItem = inventorySlot.querySelector(".inventory-slot-item");
uiRoot.appendChild(inventorySlot);

const mobileHoldProgress = document.createElement("div");
mobileHoldProgress.className = "mobile-hold-progress hidden";
uiRoot.appendChild(mobileHoldProgress);

const decorateControls = createDecorControlsUI(uiRoot, input);

const touchJoystick = createTouchJoystickUI(uiRoot, {
  onAxis: (x, y) => {
    // Match keyboard strafe convention in player controller: A => +X, D => -X.
    input.setMoveAxis(-x, y);
  },
  onTap: (x, y) => {
    handleMobileTap(x, y);
  },
});
if (useTouchControls) touchJoystick.show();
else touchJoystick.hide();

const colorPanel = createColorPanelUI(uiRoot, {
  initialSky: skyColor,
  initialGround: groundColor,
  onApply: ({ skyColor: nextSky, groundColor: nextGround }) => {
    skyColor = normalizeHex(nextSky, skyColor);
    groundColor = normalizeHex(nextGround, groundColor);
    lighting.setSkyColor(skyColor);
    plaza.setGroundColor(groundColor);
    persistence.setVisuals({ skyColor, groundColor });
    colorPanel.setValues({ skyColor, groundColor });
  },
});

const filterPanel = createFilterPanelUI(uiRoot, {
  initialPixelation: pixelationStrength,
  initialVignette: vignetteStrength,
  onApply: ({ pixelation, vignette }) => {
    pixelationStrength = clamp(pixelation, 0, 300, pixelationStrength);
    vignetteStrength = clamp(vignette, 0, 100, vignetteStrength);
    applyFilters();
    persistence.setVisuals({
      filters: { pixelation: pixelationStrength, vignette: vignetteStrength },
    });
  },
});

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = "*/*";
fileInput.style.display = "none";
document.body.appendChild(fileInput);

const folderInput = document.createElement("input");
folderInput.type = "file";
folderInput.multiple = true;
folderInput.style.display = "none";
folderInput.setAttribute("webkitdirectory", "");
folderInput.setAttribute("directory", "");
document.body.appendChild(folderInput);

const decorateInput = document.createElement("input");
decorateInput.type = "file";
decorateInput.accept = ".png,.jpg,.jpeg,image/png,image/jpeg";
decorateInput.style.display = "none";
document.body.appendChild(decorateInput);

const masks = buildMasks(THREE, MASK_OPTIONS);
remoteAvatarRenderer = createRemoteAvatarRenderer(THREE, scene, masks);
let selectedMaskId = loadedSave.avatar.selectedMaskId;

const defaultMask = masks[0];
const selectedMask = masks.find((m) => m.id === selectedMaskId) || defaultMask;

const player = createPlayerController(
  THREE,
  scene,
  {
    x: loadedSave.player.position.x,
    y: loadedSave.player.position.y,
    z: loadedSave.player.position.z,
    yaw: loadedSave.player.yaw,
  },
  selectedMask
);

const cameraRig = createThirdPersonCameraRig(THREE, camera, loadedSave.player);
player.setFirstPersonView(true, camera);

const graffitiPalette = createGraffitiPaletteUI(
  uiRoot,
  GRAFFITI_COLORS,
  (color) => uploadPins.setPaintColor(color),
  (size) => uploadPins.setBrushSize(size),
  () => {
    const cleared = uploadPins?.clearActiveGraffitiArea();
    if (cleared) {
      paintDirty = false;
      paintIdleSeconds = 999;
      persistence.setWorldInteractions(plaza.serializePaintState());
      showToast("Graffiti area cleared.");
    }
  }
);

uploadPins = createUploadPinManager({
  THREE,
  scene,
  camera,
  overlay,
  drawables: plaza.drawables,
  onPinsChanged: (uploads) => {
    persistence.setUploads(uploads);
    if (!suppressNetworkPinBroadcast) {
      networkClient.send("pins_update", { pins: uploads });
    }
  },
  onError: (message) => showToast(message),
  onGraffitiRadiusChange: (active) => {
    if (active) graffitiPalette.show();
    else graffitiPalette.hide();
  },
  getOwnerIdentity: () => ({
    ownerId: networkClient.clientId || "",
    ownerLabel: getPlayerLabelFromId(networkClient.clientId),
  }),
});
uploadPins.setPaintColor(GRAFFITI_COLORS[0]);
uploadPins.setBrushSize(0.45);
void persistence.hydrateUploads().then((uploads) => {
  uploadPins.loadFromSaved(uploads || []);
});

const actions = createActionRegistry({
  onDropFile: () => {
    if (inMaskSelection) return;
    fileInput.value = "";
    fileInput.click();
  },
  onDropFolder: () => {
    if (inMaskSelection) return;
    folderInput.value = "";
    folderInput.click();
  },
  onDecorate: () => {
    if (inMaskSelection) return;
    decorateInput.value = "";
    decorateInput.click();
  },
  onDocumentSelf: async () => {
    if (inMaskSelection) return;
    selfieCaptureOpen = true;
    input.exitPointerLock();
    triedInitialPointerLock = false;
    try {
      const imageDataUrl = await captureSelfie();
      if (!imageDataUrl) return;
      const playerState = player.getState();
      uploadPins.addImageDataPinAtPlayer({
        dataUrl: imageDataUrl,
        fileName: `selfie-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
        playerPosition: playerState.position,
      });
    } catch {
      showToast("Webcam unavailable or permission denied.");
    } finally {
      selfieCaptureOpen = false;
    }
  },
  onGraffiti: () => {
    showToast("Graffiti is disabled for now.");
  },
  onBuild: () => {
    showToast("Build is disabled for now.");
  },
  onSmoke: () => {
    if (inMaskSelection) return;
    const smoking = player.toggleSmoking();
    showToast(smoking ? "Smoking enabled." : "Smoking disabled.");
  },
  onDarkMode: () => {
    if (inMaskSelection) return;
    darkMode = !darkMode;
    applyThemeColors();
    persistence.setVisuals({ darkMode });
    showToast(darkMode ? "Dark mode enabled." : "Dark mode disabled.");
  },
  disableDecorate: useTouchControls,
});
const actionMenu = createActionMenuUI(uiRoot, actions, { isMobileLayout: useTouchControls });

fileInput.addEventListener("change", async () => {
  if (!fileInput.files?.length) return;
  if (inMaskSelection) return;

  const playerState = player.getState();
  await uploadPins.addFileAtPlayer(fileInput.files[0], playerState.position);
});

folderInput.addEventListener("change", async () => {
  const pickedFiles = Array.from(folderInput.files || []);
  if (!pickedFiles.length) return;
  if (inMaskSelection) return;
  const playerState = player.getState();
  const pin = await uploadPins.addFolderAtPlayer(pickedFiles, playerState.position);
  if (pin) showToast(`Folder dropped: ${pin.fileName}`);
});

decorateInput.addEventListener("change", async () => {
  if (!decorateInput.files?.length) return;
  if (inMaskSelection) return;
  const file = decorateInput.files[0];
  if (!file.type.startsWith("image/")) {
    showToast("Decorate supports PNG/JPEG images only.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || "");
    if (!dataUrl) return;
    const playerState = player.getState();
    const pin = uploadPins.addDecorImagePinAtPlayer({
      dataUrl,
      fileName: file.name || `decorate-${Date.now()}.png`,
      mimeType: file.type || "image/png",
      playerPosition: playerState.position,
    });
    if (pin) showToast("Decor image dropped. Right click it to place.");
  };
  reader.onerror = () => showToast("Could not read image.");
  reader.readAsDataURL(file);
});

function shouldLockForNavigation() {
  if (useTouchControls) return false;
  if (inMaskSelection) return false;
  if (selfieCaptureOpen) return false;
  if (uploadPins?.isDecoratingMode?.()) return false;
  if (actionMenu.isOpen() || overlay.isOpen() || colorPanel.isOpen() || filterPanel.isOpen()) return false;
  return true;
}

function getMouseInteractionPointer(event) {
  if (input.isPointerLocked()) return input.getPointerPosition();
  if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
    return { x: event.clientX, y: event.clientY };
  }
  return input.getPointerPosition();
}

window.addEventListener("keydown", (event) => {
  if (event.code === "KeyE") return;
  if (!shouldLockForNavigation()) return;
  if (!input.isPointerLocked()) {
    input.requestPointerLock();
    triedInitialPointerLock = true;
  }
});

window.addEventListener("mousedown", (event) => {
  if (useTouchControls) return;
  if (event.button !== 0) return;
  if (!shouldLockForNavigation()) return;
  if (!input.isPointerLocked()) {
    input.requestPointerLock();
    triedInitialPointerLock = true;
  }
});

renderer.domElement.addEventListener("mousedown", (event) => {
  if (useTouchControls) return;
  if (event.button === 2) {
    if (inMaskSelection) return;
    event.preventDefault();
    const pointer = getMouseInteractionPointer(event);
    const started = uploadPins.beginDecorateControlAtPointer(pointer.x, pointer.y, renderer.domElement);
    if (started) {
      actionMenu.close();
      overlay.hide();
      colorPanel.hide();
      filterPanel.hide();
      input.exitPointerLock();
      triedInitialPointerLock = false;
      showToast("Decorate: WASD move, R rotate, Arrows resize, Delete remove, Enter place.");
      return;
    }
    if (inventoryItem) {
      const placed = placeInventoryAtPointer(pointer.x, pointer.y);
      if (placed) return;
      showToast("No valid place point.");
    } else {
      const picked = pickupInventoryAtPointer(pointer.x, pointer.y);
      if (picked) return;
      showToast("Right-click your uploaded item to store it.");
    }
    return;
  }
  if (event.button !== 0) return;
  if (inMaskSelection) return;
  if (event.target !== renderer.domElement) return;

  const uiLocks = actionMenu.isOpen() || overlay.isOpen();

  if (!uiLocks && !input.isPointerLocked()) {
    input.requestPointerLock();
  }

  if (actionMenu.isOpen()) return;
  if (!overlay.isOpen() && !colorPanel.isOpen() && !filterPanel.isOpen() && !uploadPins.isDecoratingMode()) {
    const pointer = getMouseInteractionPointer(event);
    const threw = throwInventoryAtPointer(pointer.x, pointer.y);
    if (threw) return;
  }

  const clickedBuildShape = false;
  if (clickedBuildShape) return;
  const pointer = getMouseInteractionPointer(event);
  uploadPins.handleClick(pointer.x, pointer.y, renderer.domElement);
});

const mobileLookState = {
  touchId: null,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  moved: false,
};

let mobilePickupHold = null;

renderer.domElement.addEventListener(
  "touchstart",
  (event) => {
    if (!useTouchControls) return;
    if (mobileLookState.touchId !== null) return;
    if (overlay.isOpen() || actionMenu.isOpen() || inMaskSelection) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    mobileLookState.touchId = touch.identifier;
    mobileLookState.startX = touch.clientX;
    mobileLookState.startY = touch.clientY;
    mobileLookState.lastX = touch.clientX;
    mobileLookState.lastY = touch.clientY;
    mobileLookState.moved = false;
    input.setPointerPosition(touch.clientX, touch.clientY);
    beginMobilePickupHold(touch);
  },
  { passive: true }
);

renderer.domElement.addEventListener(
  "touchmove",
  (event) => {
    if (!useTouchControls) return;
    if (mobileLookState.touchId === null) return;
    if (overlay.isOpen() || actionMenu.isOpen() || inMaskSelection) return;
    for (const touch of event.changedTouches) {
      if (touch.identifier !== mobileLookState.touchId) continue;
      const dx = touch.clientX - mobileLookState.lastX;
      const dy = touch.clientY - mobileLookState.lastY;
      mobileLookState.lastX = touch.clientX;
      mobileLookState.lastY = touch.clientY;
      input.setPointerPosition(touch.clientX, touch.clientY);
      input.addLookDelta(dx * MOBILE_LOOK_SENSITIVITY, dy * MOBILE_LOOK_SENSITIVITY);
      if (!mobileLookState.moved) {
        const travel = Math.hypot(touch.clientX - mobileLookState.startX, touch.clientY - mobileLookState.startY);
        if (travel > MOBILE_TAP_MAX_MOVE) {
          mobileLookState.moved = true;
          cancelMobilePickupHold(touch.identifier);
        }
      }
      event.preventDefault();
      return;
    }
  },
  { passive: false }
);

renderer.domElement.addEventListener(
  "touchend",
  (event) => {
    if (!useTouchControls) return;
    if (mobileLookState.touchId === null) return;
    for (const touch of event.changedTouches) {
      if (touch.identifier !== mobileLookState.touchId) continue;
      input.setPointerPosition(touch.clientX, touch.clientY);
      const wasTap = !mobileLookState.moved;
      const holdConsumedTap = Boolean(
        mobilePickupHold &&
          mobilePickupHold.touchId === touch.identifier &&
          (mobilePickupHold.didPickup || mobilePickupHold.completed)
      );
      clearMobilePickupHold(touch.identifier);
      mobileLookState.touchId = null;
      mobileLookState.moved = false;
      if (holdConsumedTap) return;
      if (!wasTap) return;
      if (overlay.isOpen() || actionMenu.isOpen() || inMaskSelection) return;
      event.preventDefault();
      touchJoystick.handleTap(touch.clientX, touch.clientY);
      return;
    }
  },
  { passive: false }
);

renderer.domElement.addEventListener(
  "touchcancel",
  (event) => {
    const touch = event.changedTouches?.[0];
    if (touch) clearMobilePickupHold(touch.identifier);
    else clearMobilePickupHold();
    mobileLookState.touchId = null;
    mobileLookState.moved = false;
  },
  { passive: true }
);

window.addEventListener("mousemove", (event) => {
  if (!draggingBuildShape) return;
  if (inMaskSelection) return;
  void event;
});

window.addEventListener("mouseup", () => {
  if (!draggingBuildShape) return;
  draggingBuildShape = false;
});

const maskSelection = createMaskSelectionUI(uiRoot, masks, (maskId) => {
  selectedMaskId = maskId;
  const mask = masks.find((m) => m.id === maskId) || defaultMask;
  player.setMask(mask);
  persistence.setMask(maskId);
  networkClient.send("player_state", {
    player: serializeLocalPlayer(player.getState()),
    maskId,
  });
  maskSelection.hide();
  inMaskSelection = false;
  actionMenu.setVisible(true);
  triedInitialPointerLock = false;
  input.requestPointerLock();
});

let inMaskSelection = !selectedMaskId;
if (inMaskSelection) {
  maskSelection.show();
  actionMenu.setVisible(false);
} else {
  maskSelection.hide();
  actionMenu.setVisible(true);
}

networkClient.on("connected", () => {
  networkReady = true;
  networkClient.send("join", {
    maskId: selectedMaskId || null,
    player: serializeLocalPlayer(player.getState()),
    pins: uploadPins.getSerializablePins(),
  });
});

networkClient.on("disconnected", () => {
  networkReady = false;
  remoteAvatars.replaceAll({}, "");
});

networkClient.on("world_snapshot", ({ world }) => {
  if (!world || typeof world !== "object") return;
  remoteAvatars.replaceAll(world.players || {}, networkClient.clientId);
  const revision = Number.isFinite(Number(world.pinsRevision)) ? Number(world.pinsRevision) : 0;
  if (Array.isArray(world.pins) && revision !== lastPinsRevision) {
    lastPinsRevision = revision;
    suppressNetworkPinBroadcast = true;
    uploadPins.applySharedPins(world.pins, { skipSync: true });
    suppressNetworkPinBroadcast = false;
  }
});

networkClient.on("players_snapshot", ({ players }) => {
  remoteAvatars.replaceAll(players || {}, networkClient.clientId);
});

networkClient.on("pins_snapshot", ({ pins, pinsRevision }) => {
  const revision = Number.isFinite(Number(pinsRevision)) ? Number(pinsRevision) : lastPinsRevision + 1;
  if (revision === lastPinsRevision) return;
  lastPinsRevision = revision;
  if (!Array.isArray(pins)) return;
  suppressNetworkPinBroadcast = true;
  uploadPins.applySharedPins(pins, { skipSync: true });
  suppressNetworkPinBroadcast = false;
});

networkClient.connect();

graffitiPalette.hide();

let eWasDown = false;
let saveAccumulator = 0;
let playerSyncAccumulator = 0;
let paintDirty = false;
let paintIdleSeconds = 999;
let draggingBuildShape = false;
let inventoryItem = null;
let inventoryThrowState = null;
let suppressPaintUntilMouseUp = false;
let selfieCaptureOpen = false;

const worldRaycaster = new THREE.Raycaster();
const worldNdc = new THREE.Vector2();
const throwGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const throwPlaneScratch = new THREE.Vector3();
const throwDirectionScratch = new THREE.Vector3();
const throwForwardScratch = new THREE.Vector3();
const throwStartScratch = new THREE.Vector3();
const throwTargetScratch = new THREE.Vector3();
const throwHorizontalScratch = new THREE.Vector3();
const throwLandingScratch = new THREE.Vector3();

syncInventorySlot();

const clock = new THREE.Clock();
let triedInitialPointerLock = false;
if (useTouchControls) {
  input.exitPointerLock();
  triedInitialPointerLock = false;
}

function animate() {
  const delta = Math.min(clock.getDelta(), 0.05);
  const safeDelta = Math.max(delta, 0.0001);

  fpsSampleAccumulator += 1 / safeDelta;
  fpsSampleTime += delta;
  qualityCooldown -= delta;

  if (fpsSampleTime >= AUTO_QUALITY_UPDATE_SECONDS) {
    const avgFps = fpsSampleAccumulator / fpsSampleTime;
    fpsSampleAccumulator = 0;
    fpsSampleTime = 0;
    if (qualityCooldown <= 0) {
      if (avgFps < AUTO_QUALITY_DOWN_FPS && autoQualityLevel < AUTO_QUALITY_SCALES.length - 1) {
        autoQualityLevel += 1;
        autoQualityScale = AUTO_QUALITY_SCALES[autoQualityLevel];
        applyFilters();
        qualityCooldown = AUTO_QUALITY_COOLDOWN_SECONDS;
      } else if (avgFps > AUTO_QUALITY_UP_FPS && autoQualityLevel > 0) {
        autoQualityLevel -= 1;
        autoQualityScale = AUTO_QUALITY_SCALES[autoQualityLevel];
        applyFilters();
        qualityCooldown = AUTO_QUALITY_COOLDOWN_SECONDS;
      }
    }
  }

  const eDown = input.isDown("KeyE");
  if (eDown && !eWasDown && !inMaskSelection) {
    actionMenu.toggle();
    if (actionMenu.isOpen()) {
      overlay.hide();
      colorPanel.hide();
      filterPanel.hide();
      input.exitPointerLock();
      triedInitialPointerLock = false;
    } else if (shouldLockForNavigation()) {
      input.requestPointerLock();
      triedInitialPointerLock = true;
    }
  }
  eWasDown = eDown;

  if (!inMaskSelection) {
    const isDecoratingMode = uploadPins.isDecoratingMode();
    decorateControls.setVisible(Boolean(isDecoratingMode));
    const uiLocksMovement =
      selfieCaptureOpen ||
      isDecoratingMode ||
      actionMenu.isOpen() ||
      overlay.isOpen() ||
      colorPanel.isOpen() ||
      filterPanel.isOpen();
    player.update(delta, input, cameraRig.getYaw(), uiLocksMovement);
    const playerState = player.getState();
    playerSyncAccumulator += delta;
    if (networkReady && playerSyncAccumulator >= PLAYER_SYNC_INTERVAL) {
      playerSyncAccumulator = 0;
      const serialized = serializeLocalPlayer(playerState);
      const maskId = selectedMaskId || null;
      if (shouldSendPlayerState(serialized, lastSentPlayerState, maskId, lastSentMaskId)) {
        networkClient.send("player_state", {
          player: serialized,
          maskId,
        });
        lastSentPlayerState = serialized;
        lastSentMaskId = maskId;
      }
    }
    remoteAvatars.tick(delta);
    remoteAvatarRenderer.sync(remoteAvatars.list(), playerState.position, REMOTE_AVATAR_VISIBILITY_RADIUS);
    uploadPins.update(delta, playerState.position);

    if (isDecoratingMode) {
      const decorateState = uploadPins.updateDecorateControl(delta, input);
      uploadPins.updateDecorateCamera();
      if (decorateState === "placed") showToast("Decor placed.");
      if (decorateState === "deleted") showToast("Decor deleted.");
    } else {
      cameraRig.update(delta, input, player.object, playerState, uiLocksMovement);
    }

    if (!useTouchControls && !uiLocksMovement && !input.isPointerLocked() && !triedInitialPointerLock) {
      input.requestPointerLock();
      triedInitialPointerLock = true;
    }

    if (!useTouchControls && uiLocksMovement && input.isPointerLocked()) {
      input.exitPointerLock();
      triedInitialPointerLock = false;
    }

    if (uploadPins.isInGraffitiRadius() && input.isLeftDown() && !uiLocksMovement && !draggingBuildShape) {
      const pointer = input.getPointerPosition();
      const hovered = document.elementFromPoint(pointer.x, pointer.y);
      const overCanvas = hovered === renderer.domElement;
      if (overCanvas && !inventoryThrowState && !suppressPaintUntilMouseUp) {
        const didPaint = uploadPins.paintAtPointer(pointer, renderer.domElement);
        if (didPaint) {
          paintDirty = true;
          paintIdleSeconds = 0;
        }
      }
    }

    saveAccumulator += delta;
    if (saveAccumulator > 0.5) {
      saveAccumulator = 0;
      const cameraState = cameraRig.getState();
      persistence.setPlayerState({
        position: playerState.position,
        yaw: playerState.yaw,
        cameraYaw: cameraState.cameraYaw,
        cameraPitch: cameraState.cameraPitch,
      });
    }

    paintIdleSeconds += delta;
    if (paintDirty && !input.isLeftDown() && paintIdleSeconds > 0.9) {
      paintDirty = false;
      paintIdleSeconds = 999;
      persistence.setWorldInteractions(plaza.serializePaintState());
    }
  } else {
    decorateControls.setVisible(false);
    if (draggingBuildShape) {
      draggingBuildShape = false;
    }
    if (input.isPointerLocked()) input.exitPointerLock();
    input.consumeLookDelta();
    triedInitialPointerLock = false;
  }

  if (suppressPaintUntilMouseUp && !input.isLeftDown()) suppressPaintUntilMouseUp = false;
  updateInventoryThrow(delta);
  updateMobilePickupHold();

  const elapsed = clock.elapsedTime;
  plaza.updateAtmosphere?.(elapsed);
  lighting.updateAtmosphere?.(elapsed);
  if (typeof plaza.updateReflections === "function") {
    reflectionFrameCounter += 1;
    const interval = 1 + autoQualityLevel;
    if (reflectionFrameCounter % interval === 0) {
      plaza.updateReflections(renderer, scene, player.object);
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applyFilters();
});

window.addEventListener("beforeunload", () => {
  decorateControls.setVisible(false);
  if (!inMaskSelection) {
    const playerState = player.getState();
    const cameraState = cameraRig.getState();
    persistence.setPlayerState({
      position: playerState.position,
      yaw: playerState.yaw,
      cameraYaw: cameraState.cameraYaw,
      cameraPitch: cameraState.cameraPitch,
    });
  }
  if (paintDirty) {
    persistence.setWorldInteractions(plaza.serializePaintState());
  }
  persistence.persist();
  networkClient.disconnect();
});

let toastTimeout = null;
function showToast(message) {
  notification.textContent = message;
  notification.classList.remove("hidden");

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    notification.classList.add("hidden");
  }, 2200);
}

function applyFilters() {
  renderScale = pixelationToScale(pixelationStrength) * autoQualityScale;
  const clampedScale = clamp(renderScale, 0.08, 1, 0.62);
  if (Math.abs(clampedScale - lastAppliedRenderScale) > 0.0001) {
    renderer.setSize(window.innerWidth * clampedScale, window.innerHeight * clampedScale, false);
    lastAppliedRenderScale = clampedScale;
  }
  vignetteOverlay.style.opacity = String(vignetteStrength / 100);
}

function applyThemeColors() {
  const activeSky = darkMode ? "#0f1116" : skyColor;
  const activeGround = darkMode ? "#1a1d24" : groundColor;
  lighting.setSkyColor(activeSky);
  plaza.setGroundColor(activeGround);
  document.body.classList.toggle("theme-dark", darkMode);
}

function pixelationToScale(pixelation) {
  return clamp(1 - (pixelation / 300) * 0.9, 0.1, 1, 0.62);
}

function normalizeHex(value, fallback) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  return fallback;
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function serializeLocalPlayer(playerState) {
  return {
    position: {
      x: Number(playerState.position.x.toFixed(3)),
      y: Number(playerState.position.y.toFixed(3)),
      z: Number(playerState.position.z.toFixed(3)),
    },
    yaw: Number(playerState.yaw.toFixed(4)),
    grounded: Boolean(playerState.grounded),
    smoking: Boolean(playerState.smoking),
  };
}

function shouldSendPlayerState(next, prev, nextMaskId, prevMaskId) {
  if (!prev) return true;
  if (nextMaskId !== prevMaskId) return true;
  if (Boolean(next.smoking) !== Boolean(prev.smoking)) return true;
  const dx = next.position.x - prev.position.x;
  const dy = next.position.y - prev.position.y;
  const dz = next.position.z - prev.position.z;
  if (dx * dx + dy * dy + dz * dz > PLAYER_SYNC_POS_EPS * PLAYER_SYNC_POS_EPS) return true;
  return Math.abs(normalizeAngle(next.yaw - prev.yaw)) > PLAYER_SYNC_YAW_EPS;
}

function normalizeAngle(a) {
  return (((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

function getPlayerLabelFromId(id) {
  const safe = String(id || "");
  if (!safe) return "Unknown";
  return `Player ${safe.slice(-4).toUpperCase()}`;
}

function safeLocalStorageGet(key) {
  try {
    const value = localStorage.getItem(key);
    if (!value || typeof value !== "string") return "";
    return value.trim();
  } catch {
    return "";
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, String(value ?? ""));
  } catch {
    // Ignore storage write failures in restricted contexts.
  }
}

function syncInventorySlot() {
  const hasItem = Boolean(inventoryItem);
  inventorySlot.classList.toggle("empty", !hasItem);
  inventorySlot.classList.toggle("filled", hasItem);
  if (inventorySlotPreview) {
    inventorySlotPreview.className = "inventory-slot-preview";
    inventorySlotPreview.style.backgroundImage = "";
    inventorySlotPreview.textContent = "";
  }
  if (!inventorySlotItem) return;
  if (!hasItem) {
    inventorySlotItem.textContent = "";
    inventorySlot.title = "";
    return;
  }
  const fileType = String(inventoryItem.fileType || "item").toLowerCase();
  const type = fileType.toUpperCase();
  const name = String(inventoryItem.fileName || "").trim();
  const shortName = name ? name.slice(0, 8) : type.slice(0, 8);
  inventorySlotItem.textContent = shortName || "ITEM";
  if (inventorySlotPreview) {
    if (fileType === "image" || fileType === "gif" || fileType === "decorate") {
      inventorySlotPreview.classList.add("thumb");
      if (inventoryItem.dataUrl) inventorySlotPreview.style.backgroundImage = `url("${inventoryItem.dataUrl}")`;
    } else if (fileType === "folder") {
      inventorySlotPreview.classList.add("folder");
      inventorySlotPreview.textContent = "DIR";
    } else if (fileType === "obj" || fileType === "stl") {
      inventorySlotPreview.classList.add("model");
      inventorySlotPreview.textContent = "3D";
    } else if (fileType === "audio") {
      inventorySlotPreview.classList.add("audio");
      inventorySlotPreview.textContent = "A";
    } else if (fileType === "pdf") {
      inventorySlotPreview.classList.add("pdf");
      inventorySlotPreview.textContent = "PDF";
    } else if (fileType === "video") {
      inventorySlotPreview.classList.add("video");
      inventorySlotPreview.textContent = "VID";
    } else {
      inventorySlotPreview.classList.add("generic");
      inventorySlotPreview.textContent = type.slice(0, 3);
    }
  }
  inventorySlot.title = name ? `${type}: ${name}` : type;
}

function handleMobileTap(x, y) {
  if (overlay.isOpen() || actionMenu.isOpen() || inMaskSelection) return;
  if (inventoryItem && !inventoryThrowState) {
    const threw = throwInventoryAtPointer(x, y);
    if (threw) return;
  }
  uploadPins.handleClick(x, y, renderer.domElement);
}

function showMobilePickupProgress(x, y, progress) {
  const pct = Math.max(0, Math.min(100, progress * 100));
  mobileHoldProgress.style.left = `${x}px`;
  mobileHoldProgress.style.top = `${y}px`;
  mobileHoldProgress.style.background = `conic-gradient(rgba(132, 227, 255, 0.98) ${pct}%, rgba(255, 255, 255, 0.22) ${pct}%)`;
  mobileHoldProgress.classList.remove("hidden");
}

function hideMobilePickupProgress() {
  mobileHoldProgress.classList.add("hidden");
}

function beginMobilePickupHold(touch) {
  if (!useTouchControls) return;
  if (!touch) return;
  if (inventoryItem || inventoryThrowState) return;
  if (overlay.isOpen() || actionMenu.isOpen() || inMaskSelection) return;
  const ownerId = networkClient.clientId || null;
  const canPickup = uploadPins.canPickupOwnedPinAtPointer(touch.clientX, touch.clientY, renderer.domElement, ownerId);
  if (!canPickup) return;
  mobilePickupHold = {
    touchId: touch.identifier,
    clientX: touch.clientX,
    clientY: touch.clientY,
    startTime: performance.now(),
    didPickup: false,
    completed: false,
  };
  showMobilePickupProgress(touch.clientX, touch.clientY, 0);
}

function cancelMobilePickupHold(touchId = null) {
  if (!mobilePickupHold) return;
  if (touchId !== null && mobilePickupHold.touchId !== touchId) return;
  if (mobilePickupHold.completed) return;
  mobilePickupHold = null;
  hideMobilePickupProgress();
}

function clearMobilePickupHold(touchId = null) {
  if (!mobilePickupHold) return;
  if (touchId !== null && mobilePickupHold.touchId !== touchId) return;
  mobilePickupHold = null;
  hideMobilePickupProgress();
}

function updateMobilePickupHold() {
  if (!mobilePickupHold) return;
  if (mobilePickupHold.completed) return;
  if (!useTouchControls || overlay.isOpen() || actionMenu.isOpen() || inMaskSelection || inventoryItem || inventoryThrowState) {
    clearMobilePickupHold();
    return;
  }
  const elapsed = (performance.now() - mobilePickupHold.startTime) / 1000;
  const progress = Math.max(0, Math.min(1, elapsed / MOBILE_PICKUP_HOLD_SECONDS));
  showMobilePickupProgress(mobilePickupHold.clientX, mobilePickupHold.clientY, progress);
  if (progress < 1) return;
  mobilePickupHold.completed = true;
  const picked = pickupInventoryAtPointer(mobilePickupHold.clientX, mobilePickupHold.clientY);
  mobilePickupHold.didPickup = Boolean(picked);
  hideMobilePickupProgress();
}

function getPointerWorldHit(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  worldNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  worldNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  worldRaycaster.setFromCamera(worldNdc, camera);
  worldRaycaster.far = 1200;
  const hits = worldRaycaster.intersectObjects(plaza.drawables, false);
  if (hits[0]?.point) return hits[0].point.clone();
  const planeHit = worldRaycaster.ray.intersectPlane(throwGroundPlane, throwPlaneScratch);
  if (!planeHit) return null;
  return planeHit.clone();
}

function pickupInventoryAtPointer(clientX, clientY) {
  if (inventoryItem) return false;
  const ownerId = networkClient.clientId || null;
  const picked = uploadPins.pickupOwnedPinAtPointer(clientX, clientY, renderer.domElement, ownerId);
  if (!picked) return false;
  if (String(picked.fileType || "") === "decorate") {
    showToast("Decor items are edited in place.");
    return false;
  }
  overlay.hide();
  inventoryItem = picked;
  syncInventorySlot();
  showToast("Item stored.");
  return true;
}

function placeInventoryAtPointer(clientX, clientY) {
  if (!inventoryItem || inventoryThrowState) return false;
  const hitPoint = getPointerWorldHit(clientX, clientY);
  if (!hitPoint) {
    showToast("No placement point.");
    return true;
  }
  hitPoint.y = 0;
  const ownerId = networkClient.clientId || null;
  const placed = uploadPins.placeStoredPin(inventoryItem, hitPoint, ownerId);
  if (!placed) {
    showToast("Cannot place this item.");
    return true;
  }
  overlay.hide();
  inventoryItem = null;
  syncInventorySlot();
  showToast("Item placed.");
  return true;
}

function throwInventoryAtPointer(clientX, clientY) {
  if (!inventoryItem || inventoryThrowState) return false;
  const hitPoint = getPointerWorldHit(clientX, clientY);
  const hasTarget = Boolean(hitPoint);
  camera.getWorldDirection(throwForwardScratch).normalize();
  throwStartScratch.copy(camera.position).addScaledVector(throwForwardScratch, 0.86);
  throwStartScratch.y = Math.max(1.08, throwStartScratch.y);
  if (hasTarget) throwTargetScratch.copy(hitPoint);
  else throwTargetScratch.copy(throwStartScratch).addScaledVector(throwForwardScratch, 12);
  throwTargetScratch.y = Math.max(0.05, throwTargetScratch.y);
  throwHorizontalScratch.set(
    throwTargetScratch.x - throwStartScratch.x,
    0,
    throwTargetScratch.z - throwStartScratch.z
  );
  const horizontalDistance = Math.max(0.55, throwHorizontalScratch.length());
  const travelTime = Math.max(0.45, Math.min(1.2, horizontalDistance / 13));
  const velocity = new THREE.Vector3(
    throwHorizontalScratch.x / travelTime,
    0,
    throwHorizontalScratch.z / travelTime
  );
  velocity.y =
    (throwTargetScratch.y - throwStartScratch.y + 0.5 * INVENTORY_THROW_GRAVITY * travelTime * travelTime) /
    travelTime;

  const projectileMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0xeff6ff,
      emissive: 0xffffff,
      emissiveIntensity: 0.95,
      roughness: 0.3,
      metalness: 0.08,
    })
  );
  projectileMesh.position.copy(throwStartScratch);
  scene.add(projectileMesh);

  const trailGeometry = new THREE.SphereGeometry(1, 10, 8);
  const trailMaterial = new THREE.MeshStandardMaterial({
    color: 0xe9f4ff,
    emissive: 0xffffff,
    emissiveIntensity: 0.9,
    roughness: 0.25,
    metalness: 0.05,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  const trailGroup = new THREE.Group();
  const trailSegments = [];
  for (let i = 0; i < INVENTORY_THROW_MAX_TRAIL_POINTS; i += 1) {
    const segment = new THREE.Mesh(trailGeometry, trailMaterial);
    segment.visible = false;
    trailGroup.add(segment);
    trailSegments.push(segment);
  }
  scene.add(trailGroup);

  inventoryThrowState = {
    storedPin: inventoryItem,
    position: throwStartScratch.clone(),
    velocity,
    age: 0,
    mesh: projectileMesh,
    trailGroup,
    trailSegments,
    trailGeometry,
    trailMaterial,
    trailPoints: [throwStartScratch.clone()],
    fallbackTarget: throwTargetScratch.clone(),
  };
  inventoryItem = null;
  syncInventorySlot();
  suppressPaintUntilMouseUp = true;
  showToast("Thrown.");
  return true;
}

function finishInventoryThrow(landingPoint) {
  const state = inventoryThrowState;
  if (!state) return;
  const ownerId = networkClient.clientId || null;
  const landing = throwLandingScratch.copy(landingPoint || state.fallbackTarget || state.position);
  landing.y = 0;
  const placed = uploadPins.placeStoredPin(state.storedPin, landing, ownerId);
  if (!placed) {
    inventoryItem = state.storedPin;
    syncInventorySlot();
    showToast("Throw failed.");
  }
  scene.remove(state.mesh);
  scene.remove(state.trailGroup);
  state.mesh.geometry?.dispose?.();
  state.mesh.material?.dispose?.();
  state.trailGeometry?.dispose?.();
  state.trailMaterial?.dispose?.();
  inventoryThrowState = null;
}

function updateInventoryThrow(delta) {
  const state = inventoryThrowState;
  if (!state) return;
  state.age += delta;
  const previous = state.position.clone();
  state.velocity.y -= INVENTORY_THROW_GRAVITY * delta;
  state.position.addScaledVector(state.velocity, delta);
  state.mesh.position.copy(state.position);

  state.trailPoints.push(state.position.clone());
  if (state.trailPoints.length > INVENTORY_THROW_MAX_TRAIL_POINTS) {
    state.trailPoints.splice(0, state.trailPoints.length - INVENTORY_THROW_MAX_TRAIL_POINTS);
  }

  const visibleCount = state.trailPoints.length;
  const segmentCount = state.trailSegments.length;
  for (let i = 0; i < segmentCount; i += 1) {
    const segment = state.trailSegments[i];
    const sourceIndex = i - (segmentCount - visibleCount);
    if (sourceIndex < 0 || sourceIndex >= visibleCount) {
      segment.visible = false;
      continue;
    }
    const point = state.trailPoints[sourceIndex];
    const t = sourceIndex / Math.max(1, visibleCount - 1);
    const radius =
      INVENTORY_THROW_TRAIL_TAIL_RADIUS +
      (INVENTORY_THROW_TRAIL_HEAD_RADIUS - INVENTORY_THROW_TRAIL_TAIL_RADIUS) * t;
    segment.visible = true;
    segment.position.copy(point);
    segment.scale.setScalar(radius);
  }

  throwDirectionScratch.copy(state.position).sub(previous);
  const segmentLength = throwDirectionScratch.length();
  if (segmentLength > 1e-5) {
    throwDirectionScratch.divideScalar(segmentLength);
    worldRaycaster.set(previous, throwDirectionScratch);
    worldRaycaster.far = segmentLength + 0.08;
    const hits = worldRaycaster.intersectObjects(plaza.drawables, false);
    if (hits[0]?.point) {
      finishInventoryThrow(hits[0].point);
      return;
    }
  }

  if (state.position.y <= 0.03 || state.age >= INVENTORY_THROW_MAX_TIME) {
    finishInventoryThrow(state.position);
  }
}

function createRemoteAvatarRenderer(THREE, scene, masks) {
  const byId = new Map();
  const maskById = new Map(masks.map((mask) => [mask.id, mask]));
  const seenThisFrame = new Set();

  function buildAvatar(id) {
    const root = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 0.8, 10, 20),
      new THREE.MeshStandardMaterial({ color: 0xa0a8b8, roughness: 0.72, metalness: 0.08 })
    );
    body.position.y = 0.75;
    root.add(body);

    const maskHolder = new THREE.Group();
    maskHolder.position.set(0, 0.98, 0.37);
    root.add(maskHolder);

    const smokeAnchor = new THREE.Group();
    smokeAnchor.position.set(0.08, 1.2, 0.47);
    smokeAnchor.rotation.set(-0.08, -0.22, 0);
    root.add(smokeAnchor);
    const cigarette = createRemoteCigaretteModel(THREE);
    cigarette.visible = false;
    smokeAnchor.add(cigarette);

    const avatar = {
      id,
      root,
      body,
      maskHolder,
      maskId: null,
      smoking: false,
      smokeAnchor,
      cigarette,
      emberMaterial: cigarette.userData.emberMaterial || null,
      emberGlow: cigarette.userData.emberGlow || null,
      emberPhase: Math.random() * Math.PI * 2,
    };
    scene.add(root);
    byId.set(id, avatar);
    return avatar;
  }

  function setMask(avatar, maskId) {
    if (!avatar || avatar.maskId === maskId) return;
    while (avatar.maskHolder.children.length) {
      const old = avatar.maskHolder.children.pop();
      old.geometry?.dispose?.();
      old.material?.dispose?.();
    }
    const maskDef = maskById.get(maskId) || null;
    if (maskDef?.texture) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.385, 28, 20),
        new THREE.MeshStandardMaterial({
          map: maskDef.texture,
          transparent: true,
          side: THREE.DoubleSide,
        })
      );
      mesh.scale.set(1, 1, 0.62);
      mesh.position.z = 0.12;
      avatar.maskHolder.add(mesh);
    }
    avatar.maskId = maskId || null;
  }

  function sync(entries, localPosition, maxDistance) {
    seenThisFrame.clear();
    for (const { id, state } of entries) {
      const dx = state.position.x - localPosition.x;
      const dz = state.position.z - localPosition.z;
      const distance = Math.hypot(dx, dz);
      if (distance > maxDistance) continue;
      seenThisFrame.add(id);
      const avatar = byId.get(id) || buildAvatar(id);
      avatar.root.visible = true;
      avatar.root.position.set(state.position.x, state.position.y, state.position.z);
      avatar.root.rotation.y = state.yaw;
      setMask(avatar, state.maskId || null);
      avatar.smoking = Boolean(state.smoking);
      avatar.cigarette.visible = avatar.smoking;
      if (avatar.smoking && avatar.emberMaterial && avatar.emberGlow) {
        avatar.emberPhase += 0.18;
        const flicker = 0.72 + Math.sin(avatar.emberPhase) * 0.2 + Math.sin(avatar.emberPhase * 2.5) * 0.08;
        const glowStrength = Math.max(0.35, flicker);
        avatar.emberMaterial.emissiveIntensity = 1.5 + glowStrength * 1.2;
        avatar.emberGlow.intensity = 0.18 + glowStrength * 0.58;
      } else if (avatar.emberMaterial && avatar.emberGlow) {
        avatar.emberMaterial.emissiveIntensity = 2.1;
        avatar.emberGlow.intensity = 0.45;
      }
    }

    for (const [id, avatar] of byId.entries()) {
      if (!seenThisFrame.has(id)) avatar.root.visible = false;
    }
  }

  return { sync };
}

function createRemoteCigaretteModel(THREE) {
  const group = new THREE.Group();
  const paper = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.26, 12),
    new THREE.MeshStandardMaterial({ color: 0xe8e0d5, roughness: 0.86, metalness: 0.02 })
  );
  paper.rotation.z = Math.PI / 2;
  group.add(paper);

  const filter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.021, 0.021, 0.075, 12),
    new THREE.MeshStandardMaterial({ color: 0xc99456, roughness: 0.8, metalness: 0.04 })
  );
  filter.position.x = -0.095;
  filter.rotation.z = Math.PI / 2;
  group.add(filter);

  const ember = new THREE.Mesh(
    new THREE.SphereGeometry(0.017, 10, 10),
    new THREE.MeshStandardMaterial({
      color: 0xff8e38,
      emissive: 0xaa2f10,
      emissiveIntensity: 2.1,
      roughness: 0.4,
      metalness: 0,
    })
  );
  ember.position.x = 0.13;
  group.add(ember);

  const emberGlow = new THREE.PointLight(0xff8a42, 0.45, 0.65, 2);
  emberGlow.position.x = 0.13;
  group.add(emberGlow);
  group.scale.set(1.4, 1.4, 1.4);
  group.userData.emberMaterial = ember.material;
  group.userData.emberGlow = emberGlow;
  return group;
}

function createDecorControlsUI(root, input) {
  const panel = document.createElement("div");
  panel.className = "decor-controls hidden";

  const title = document.createElement("div");
  title.className = "decor-controls-title";
  title.textContent = "DECORATE";
  panel.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "decor-controls-grid";
  panel.appendChild(grid);

  function addHold(label, key) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "decor-btn";
    btn.textContent = label;
    const down = (e) => {
      e.preventDefault();
      input.setVirtualKey(key, true);
    };
    const up = (e) => {
      e.preventDefault();
      input.setVirtualKey(key, false);
    };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointerleave", up);
    btn.addEventListener("pointercancel", up);
    grid.appendChild(btn);
  }

  function addTap(label, key) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "decor-btn";
    btn.textContent = label;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      input.setVirtualKey(key, true);
      setTimeout(() => input.setVirtualKey(key, false), 70);
    });
    grid.appendChild(btn);
  }

  addHold("W", "KeyW");
  addHold("A", "KeyA");
  addHold("S", "KeyS");
  addHold("D", "KeyD");
  addTap("R", "KeyR");
  addHold("Size +", "ArrowUp");
  addHold("Size -", "ArrowDown");
  addTap("Delete", "Delete");
  addTap("Place", "Enter");

  const legend = document.createElement("div");
  legend.className = "decor-controls-legend";
  legend.innerHTML = `
    <div><strong>W/A/S/D</strong> Move</div>
    <div><strong>R</strong> Rotate 90°</div>
    <div><strong>Size +/-</strong> Resize</div>
    <div><strong>Delete</strong> Remove Asset</div>
    <div><strong>Place</strong> Confirm</div>
  `;
  panel.appendChild(legend);

  root.appendChild(panel);

  return {
    setVisible(next) {
      panel.classList.toggle("hidden", !next);
      if (!next) {
        input.setVirtualKey("KeyW", false);
        input.setVirtualKey("KeyA", false);
        input.setVirtualKey("KeyS", false);
        input.setVirtualKey("KeyD", false);
        input.setVirtualKey("ArrowUp", false);
        input.setVirtualKey("ArrowDown", false);
      }
    },
  };
}
