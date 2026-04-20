export function createThirdPersonCameraRig(THREE, camera, initial = {}) {
  const state = {
    yaw: initial.yaw ?? 0,
    pitch: initial.cameraPitch ?? 0,
    targetYaw: initial.yaw ?? 0,
    targetPitch: initial.cameraPitch ?? 0,
    lookSensitivityX: 0.0039,
    lookSensitivityY: 0.0028,
    yawSmooth: 14,
    pitchSmooth: 14,
    pitchMin: -1.2,
    pitchMax: 1.2,
    eyeHeight: 1.56,
  };

  const lookTarget = new THREE.Vector3();

  function update(delta, input, playerObject, _playerState, lockCamera = false) {
    const look = input.consumeLookDelta();
    if (!lockCamera) {
      state.targetYaw -= look.x * state.lookSensitivityX;
      state.targetPitch -= look.y * state.lookSensitivityY;
      state.targetPitch = clamp(state.targetPitch, state.pitchMin, state.pitchMax);
    }

    state.yaw = dampAngle(state.yaw, state.targetYaw, state.yawSmooth, delta);
    state.pitch += (state.targetPitch - state.pitch) * (1 - Math.exp(-state.pitchSmooth * delta));
    state.pitch = clamp(state.pitch, state.pitchMin, state.pitchMax);

    playerObject.rotation.y = state.yaw;

    const origin = playerObject.position.clone();
    origin.y += state.eyeHeight;

    const dirX = Math.sin(state.yaw) * Math.cos(state.pitch);
    const dirY = Math.sin(state.pitch);
    const dirZ = Math.cos(state.yaw) * Math.cos(state.pitch);

    camera.position.copy(origin);
    lookTarget.set(origin.x + dirX, origin.y + dirY, origin.z + dirZ);
    camera.lookAt(lookTarget);
  }

  function getState() {
    return {
      cameraYaw: state.yaw,
      cameraPitch: state.pitch,
    };
  }

  function getYaw() {
    return state.yaw;
  }

  return {
    update,
    getState,
    getYaw,
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeAngle(a) {
  return (((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

function dampAngle(current, target, smooth, delta) {
  const diff = normalizeAngle(target - current);
  return current + diff * (1 - Math.exp(-smooth * delta));
}
