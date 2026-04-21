export function createInput() {
  const keys = new Set();
  const virtualKeys = new Set();
  const moveAxis = { x: 0, y: 0 };
  let hiddenMode = false;
  let lockElement = null;
  const hasPointerLockApi = typeof document !== "undefined" && "pointerLockElement" in document;
  const mouse = {
    leftDown: false,
    x: 0,
    y: 0,
    deltaX: 0,
    deltaY: 0,
  };
  const lookProfile = {
    lookMode: "fps_standard",
    invertLookX: false,
    invertLookY: false,
    movementMode: "wasd_standard",
  };
  const lookDebug = {
    source: "none",
    rawX: 0,
    rawY: 0,
    transformedX: 0,
    transformedY: 0,
  };

  function applyLookTransform(rawX, rawY, source) {
    const safeRawX = Number.isFinite(rawX) ? rawX : 0;
    const safeRawY = Number.isFinite(rawY) ? rawY : 0;
    const transformedX = lookProfile.invertLookX ? -safeRawX : safeRawX;
    const transformedY = lookProfile.invertLookY ? -safeRawY : safeRawY;
    lookDebug.source = source || "unknown";
    lookDebug.rawX = safeRawX;
    lookDebug.rawY = safeRawY;
    lookDebug.transformedX = transformedX;
    lookDebug.transformedY = transformedY;
    return { x: transformedX, y: transformedY };
  }

  function keydown(event) {
    keys.add(event.code);
  }

  function keyup(event) {
    keys.delete(event.code);
  }

  function mousedown(event) {
    if (event.button === 0) mouse.leftDown = true;
  }

  function mouseup(event) {
    if (event.button === 0) mouse.leftDown = false;
  }

  function mousemove(event) {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    if (hasPointerLockApi && !hiddenMode) return;
    const look = applyLookTransform(event.movementX || 0, event.movementY || 0, "mouse");
    mouse.deltaX += look.x;
    mouse.deltaY += look.y;
  }

  function syncPointerLockState() {
    if (hasPointerLockApi) {
      hiddenMode = document.pointerLockElement === lockElement || document.pointerLockElement === document.body;
    }
    document.body.classList.toggle("mouse-hidden", hiddenMode);
  }

  function bind(element = window) {
    lockElement = element;
    if (lockElement instanceof HTMLElement) {
      lockElement.tabIndex = lockElement.tabIndex >= 0 ? lockElement.tabIndex : -1;
    }
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("mousedown", mousedown);
    window.addEventListener("mouseup", mouseup);
    window.addEventListener("mousemove", mousemove);
    element.addEventListener("contextmenu", (event) => event.preventDefault());
    if (hasPointerLockApi) {
      document.addEventListener("pointerlockchange", syncPointerLockState);
      document.addEventListener("pointerlockerror", syncPointerLockState);
    }
    syncPointerLockState();
  }

  function isDown(code) {
    return keys.has(code) || virtualKeys.has(code);
  }

  function consumeLookDelta() {
    const delta = { x: mouse.deltaX, y: mouse.deltaY };
    mouse.deltaX = 0;
    mouse.deltaY = 0;
    return delta;
  }

  function requestPointerLock() {
    if (hiddenMode) return;
    if (hasPointerLockApi && lockElement?.requestPointerLock) {
      if (lockElement instanceof HTMLElement) lockElement.focus({ preventScroll: true });
      lockElement.requestPointerLock();
      return;
    }
    hiddenMode = true;
    syncPointerLockState();
  }

  function exitPointerLock() {
    if (!hiddenMode) return;
    if (hasPointerLockApi && document.pointerLockElement) {
      document.exitPointerLock();
      return;
    }
    hiddenMode = false;
    syncPointerLockState();
  }

  return {
    bind,
    isDown,
    isLeftDown: () => mouse.leftDown,
    getPointerPosition: () =>
      hiddenMode
        ? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
        : { x: mouse.x, y: mouse.y },
    consumeLookDelta,
    requestPointerLock,
    exitPointerLock,
    isPointerLocked: () => hiddenMode,
    setVirtualKey: (code, active) => {
      if (!code) return;
      if (active) virtualKeys.add(code);
      else virtualKeys.delete(code);
    },
    clearVirtualKeys: () => virtualKeys.clear(),
    setMoveAxis: (x, y) => {
      moveAxis.x = Number.isFinite(x) ? x : 0;
      moveAxis.y = Number.isFinite(y) ? y : 0;
    },
    setControlsProfile: (profile = {}) => {
      if (profile && typeof profile === "object") {
        lookProfile.lookMode = String(profile.lookMode || lookProfile.lookMode);
        lookProfile.movementMode = String(profile.movementMode || lookProfile.movementMode);
        lookProfile.invertLookX = Boolean(profile.invertLookX);
        lookProfile.invertLookY = Boolean(profile.invertLookY);
      }
    },
    getControlsProfile: () => ({ ...lookProfile }),
    addLookDelta: (dx, dy) => {
      const look = applyLookTransform(dx, dy, "touch");
      mouse.deltaX += look.x;
      mouse.deltaY += look.y;
    },
    getLookDebugSnapshot: () => ({ ...lookDebug }),
    setPointerPosition: (x, y) => {
      if (Number.isFinite(x)) mouse.x = x;
      if (Number.isFinite(y)) mouse.y = y;
    },
    getMoveAxis: () => ({ x: moveAxis.x, y: moveAxis.y }),
  };
}
