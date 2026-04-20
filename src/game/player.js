const PLAYER_RADIUS = 0.35;
const THIRD_PERSON_SMOKE_POS = { x: 0.08, y: 1.2, z: PLAYER_RADIUS + 0.12 };
const THIRD_PERSON_SMOKE_ROT = { x: -0.08, y: -0.22, z: 0 };
const FIRST_PERSON_SMOKE_POS = { x: 0.11, y: -0.24, z: -0.38 };
const FIRST_PERSON_SMOKE_ROT = { x: -0.08, y: -0.92, z: 0.22 };
const DOUBLE_TAP_MS = 280;

export function createPlayerController(THREE, scene, spawn, selectedMask) {
  const root = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x9ca1a7, roughness: 0.72, metalness: 0.1 });

  const capsuleHeight = 1.5;
  const capsuleCylinderLength = capsuleHeight - PLAYER_RADIUS * 2;
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER_RADIUS, capsuleCylinderLength, 10, 20),
    bodyMaterial
  );
  body.position.y = capsuleHeight * 0.5;
  root.add(body);

  const maskAnchor = new THREE.Group();
  maskAnchor.position.set(0, 0.98, PLAYER_RADIUS + 0.02);
  root.add(maskAnchor);

  const smokeAnchor = new THREE.Group();
  smokeAnchor.position.set(THIRD_PERSON_SMOKE_POS.x, THIRD_PERSON_SMOKE_POS.y, THIRD_PERSON_SMOKE_POS.z);
  root.add(smokeAnchor);
  const firstPersonViewModelAnchor = new THREE.Group();

  const smokeParticles = [];
  const smokeTexture = createSmokeTexture(THREE);
  let smoking = false;
  let smokeTimer = 0;
  const smokeOffset = new THREE.Vector3();
  const emberTip = new THREE.Vector3(0.11, 0, 0);
  let viewBobTime = 0;
  let firstPersonEnabled = false;
  let firstPersonCamera = null;

  const cigarette = createCigaretteModel(THREE);
  cigarette.visible = false;
  smokeAnchor.add(cigarette);
  const emberMaterial = cigarette.userData.emberMaterial || null;
  const emberGlow = cigarette.userData.emberGlow || null;
  let emberAnimTime = 0;

  root.position.set(spawn.x, Math.max(spawn.y, 0), spawn.z);
  root.rotation.y = spawn.yaw || 0;
  scene.add(root);

  const velocity = new THREE.Vector3();
  const desired = new THREE.Vector3();

  const config = {
    moveSpeed: 6.4,
    runMultiplier: 2.0,
    flySpeed: 7.4,
    flyAscendSpeed: 6.2,
    flyDescendSpeed: 6.2,
    turnSmoothing: 10,
    accelGround: 14,
    accelAir: 5,
    jumpForce: 8.5,
    gravity: 22,
    dampingGround: 8,
    dampingAir: 2,
  };

  let verticalVelocity = 0;
  let grounded = true;
  let flyEnabled = false;
  let flyFast = false;
  let lastSpaceTapTime = -10000;
  let lastWTapTime = -10000;
  let prevSpaceDown = false;
  let prevWDown = false;

  setMask(selectedMask);

  function setMask(mask) {
    while (maskAnchor.children.length) {
      const old = maskAnchor.children.pop();
      old.geometry?.dispose?.();
      old.material?.map?.dispose?.();
      old.material?.dispose?.();
    }

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(PLAYER_RADIUS + 0.035, 30, 22), new THREE.MeshStandardMaterial({
      map: mask.texture,
      transparent: true,
      side: THREE.DoubleSide,
    }));
    mesh.name = mask.id;
    mesh.scale.set(1, 1, 0.62);
    mesh.position.z = 0.12;
    maskAnchor.add(mesh);
  }

  function update(delta, input, cameraYaw, isActionMenuOpen) {
    const now = performance.now();
    const spaceDown = input.isDown("Space");
    const wDown = input.isDown("KeyW");
    const shiftDown = input.isDown("ShiftLeft") || input.isDown("ShiftRight");

    if (!isActionMenuOpen && spaceDown && !prevSpaceDown) {
      if (now - lastSpaceTapTime <= DOUBLE_TAP_MS) {
        flyEnabled = !flyEnabled;
        verticalVelocity = 0;
      }
      lastSpaceTapTime = now;
    }

    if (!isActionMenuOpen && wDown && !prevWDown) {
      if (now - lastWTapTime <= DOUBLE_TAP_MS && flyEnabled) {
        flyFast = true;
      }
      lastWTapTime = now;
    }

    if (!wDown) {
      flyFast = false;
    }

    prevSpaceDown = spaceDown;
    prevWDown = wDown;

    desired.set(0, 0, 0);
    const moveAxis = input.getMoveAxis ? input.getMoveAxis() : { x: 0, y: 0 };
    if (!isActionMenuOpen && (Math.abs(moveAxis.x) > 0.05 || Math.abs(moveAxis.y) > 0.05)) {
      desired.x += moveAxis.x;
      desired.z -= moveAxis.y;
    }

    if (!isActionMenuOpen) {
      if (input.isDown("KeyW")) desired.z -= 1;
      if (input.isDown("KeyS")) desired.z += 1;
      if (input.isDown("KeyA")) desired.x -= 1;
      if (input.isDown("KeyD")) desired.x += 1;
    }

    const running = shiftDown;
    const flyMultiplier = flyEnabled && flyFast ? 2 : 1;
    const speed = flyEnabled
      ? config.flySpeed * flyMultiplier
      : config.moveSpeed * (running ? config.runMultiplier : 1);

    if (desired.lengthSq() > 0) {
      desired.normalize();
      // Align movement with FPS camera forward (+Z at yaw 0).
      const moveYaw = Math.atan2(desired.x, -desired.z) + cameraYaw;
      const targetVX = Math.sin(moveYaw) * speed;
      const targetVZ = Math.cos(moveYaw) * speed;
      desired.set(targetVX, 0, targetVZ);

      const turnAlpha = 1 - Math.exp(-config.turnSmoothing * delta);
      root.rotation.y = lerpAngle(root.rotation.y, moveYaw, turnAlpha);
    } else {
      desired.set(0, 0, 0);
    }

    const accel = grounded ? config.accelGround : config.accelAir;
    const moveAlpha = 1 - Math.exp(-accel * delta);
    velocity.x += (desired.x - velocity.x) * moveAlpha;
    velocity.z += (desired.z - velocity.z) * moveAlpha;

    const damping = grounded ? config.dampingGround : config.dampingAir;
    const dampingScale = Math.exp(-damping * delta);
    velocity.x *= dampingScale;
    velocity.z *= dampingScale;

    if (flyEnabled) {
      grounded = false;
      verticalVelocity = 0;
      if (!isActionMenuOpen && spaceDown) root.position.y += config.flyAscendSpeed * delta;
      if (!isActionMenuOpen && shiftDown) root.position.y -= config.flyDescendSpeed * delta;
    } else {
      if (!isActionMenuOpen && grounded && spaceDown) {
        verticalVelocity = config.jumpForce;
        grounded = false;
      }
      verticalVelocity -= config.gravity * delta;
    }
    root.position.x += velocity.x * delta;
    root.position.z += velocity.z * delta;
    root.position.y += verticalVelocity * delta;

    if (!flyEnabled && root.position.y <= 0) {
      root.position.y = 0;
      verticalVelocity = 0;
      grounded = true;
    }

    updateSmoke(delta, input, isActionMenuOpen, Math.hypot(velocity.x, velocity.z));
  }

  function getState() {
    return {
      position: { x: root.position.x, y: root.position.y, z: root.position.z },
      yaw: root.rotation.y,
      velocity: { x: velocity.x, y: verticalVelocity, z: velocity.z },
      grounded,
      smoking,
    };
  }

  return {
    object: root,
    update,
    getState,
    setMask,
    toggleSmoking,
    setFirstPersonView,
  };

  function toggleSmoking() {
    smoking = !smoking;
    cigarette.visible = smoking;
    if (smoking) {
      emberAnimTime = 0;
      emitSmoke(true);
      emitSmoke(true);
    } else if (emberMaterial && emberGlow) {
      emberMaterial.emissiveIntensity = 2.1;
      emberGlow.intensity = 0.45;
    }
    return smoking;
  }

  function updateSmoke(delta, input, isActionMenuOpen, planarSpeed) {
    if (smoking && !isActionMenuOpen) {
      const nudge = 0.9 * delta;
      if (input.isDown("KeyI")) smokeOffset.z -= nudge;
      if (input.isDown("KeyK")) smokeOffset.z += nudge;
      if (input.isDown("KeyJ")) smokeOffset.x -= nudge;
      if (input.isDown("KeyL")) smokeOffset.x += nudge;
      if (input.isDown("KeyU")) smokeOffset.y += nudge;
      if (input.isDown("KeyO")) smokeOffset.y -= nudge;
      smokeOffset.x = clamp(smokeOffset.x, -0.6, 0.6);
      smokeOffset.y = clamp(smokeOffset.y, -0.6, 0.6);
      smokeOffset.z = clamp(smokeOffset.z, -0.8, 0.8);
    }

    if (firstPersonEnabled && firstPersonCamera) {
      if (firstPersonViewModelAnchor.parent !== firstPersonCamera) firstPersonCamera.add(firstPersonViewModelAnchor);
      if (smokeAnchor.parent !== firstPersonViewModelAnchor) firstPersonViewModelAnchor.add(smokeAnchor);
      firstPersonViewModelAnchor.position.set(0, 0, 0);
      viewBobTime += delta * (2.4 + Math.min(planarSpeed, 8) * 0.45);
      const bobY = Math.sin(viewBobTime) * 0.012;
      const bobX = Math.cos(viewBobTime * 0.5) * 0.008;
      smokeAnchor.position.set(
        FIRST_PERSON_SMOKE_POS.x + smokeOffset.x + bobX,
        FIRST_PERSON_SMOKE_POS.y + smokeOffset.y + bobY,
        FIRST_PERSON_SMOKE_POS.z + smokeOffset.z
      );
      smokeAnchor.rotation.set(FIRST_PERSON_SMOKE_ROT.x, FIRST_PERSON_SMOKE_ROT.y, FIRST_PERSON_SMOKE_ROT.z);
      cigarette.scale.set(3.25, 3.25, 3.25);
    } else {
      if (firstPersonViewModelAnchor.parent) firstPersonViewModelAnchor.parent.remove(firstPersonViewModelAnchor);
      if (smokeAnchor.parent !== root) root.add(smokeAnchor);
      smokeAnchor.position.set(
        THIRD_PERSON_SMOKE_POS.x + smokeOffset.x,
        THIRD_PERSON_SMOKE_POS.y + smokeOffset.y,
        THIRD_PERSON_SMOKE_POS.z + smokeOffset.z
      );
      smokeAnchor.rotation.set(THIRD_PERSON_SMOKE_ROT.x, THIRD_PERSON_SMOKE_ROT.y, THIRD_PERSON_SMOKE_ROT.z);
      cigarette.scale.set(1.4, 1.4, 1.4);
    }

    if (smoking) {
      emberAnimTime += delta * 11;
      if (emberMaterial && emberGlow) {
        const flicker = 0.72 + Math.sin(emberAnimTime) * 0.2 + Math.sin(emberAnimTime * 2.7) * 0.08;
        const glowStrength = Math.max(0.35, flicker);
        emberMaterial.emissiveIntensity = 1.5 + glowStrength * 1.3;
        emberGlow.intensity = 0.2 + glowStrength * 0.65;
      }
      smokeTimer += delta;
      const interval = 0.12;
      while (smokeTimer >= interval) {
        smokeTimer -= interval;
        emitSmoke(false);
      }
    }

    for (let i = smokeParticles.length - 1; i >= 0; i--) {
      const p = smokeParticles[i];
      p.age += delta;
      const t = p.age / p.life;
      if (t >= 1) {
        smokeAnchor.remove(p.sprite);
        p.sprite.material.dispose();
        smokeParticles.splice(i, 1);
        continue;
      }

      p.sprite.position.x += p.velocity.x * delta;
      p.sprite.position.y += p.velocity.y * delta;
      p.sprite.position.z += p.velocity.z * delta;
      p.velocity.x *= 0.985;
      p.velocity.z *= 0.985;
      p.velocity.y += 0.03 * delta;

      const fadeIn = Math.min(t / 0.2, 1);
      const fadeOut = Math.min((1 - t) / 0.45, 1);
      p.sprite.material.opacity = 0.38 * fadeIn * fadeOut;

      const size = p.baseSize * (1 + t * 2.2);
      p.sprite.scale.set(size, size, 1);
      p.sprite.material.rotation += p.spin * delta;
    }
  }

  function emitSmoke(boosted) {
    const material = new THREE.SpriteMaterial({
      map: smokeTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.0,
    });
    const sprite = new THREE.Sprite(material);
    const jitter = boosted ? 0.02 : 0.012;
    sprite.position.set(
      emberTip.x + (Math.random() - 0.5) * jitter,
      emberTip.y + 0.01 + Math.random() * 0.03,
      emberTip.z + (Math.random() - 0.5) * jitter
    );

    const baseSize = (boosted ? 0.24 : 0.18) + Math.random() * 0.12;
    sprite.scale.set(baseSize, baseSize, 1);
    smokeAnchor.add(sprite);

    smokeParticles.push({
      sprite,
      age: 0,
      life: (boosted ? 1.8 : 1.45) + Math.random() * 0.8,
      baseSize,
      spin: (Math.random() - 0.5) * 1.2,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.08,
        0.18 + Math.random() * 0.24,
        (Math.random() - 0.5) * 0.08
      ),
    });
  }

  function setFirstPersonView(enabled, camera = null) {
    firstPersonEnabled = Boolean(enabled);
    firstPersonCamera = firstPersonEnabled ? camera : null;
    body.visible = !firstPersonEnabled;
    maskAnchor.visible = !firstPersonEnabled;
  }
}

function lerpAngle(a, b, t) {
  const diff = ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + diff * t;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createCigaretteModel(THREE) {
  const group = new THREE.Group();

  const paper = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.26, 14),
    new THREE.MeshStandardMaterial({
      color: 0xe8e0d5,
      roughness: 0.86,
      metalness: 0.02,
    })
  );
  paper.rotation.z = Math.PI / 2;
  group.add(paper);

  const filter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.021, 0.021, 0.075, 14),
    new THREE.MeshStandardMaterial({
      color: 0xc99456,
      roughness: 0.8,
      metalness: 0.04,
    })
  );
  filter.position.x = -0.095;
  filter.rotation.z = Math.PI / 2;
  group.add(filter);

  const ember = new THREE.Mesh(
    new THREE.SphereGeometry(0.017, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0xff8e38,
      emissive: 0xaa2f10,
      emissiveIntensity: 2.1,
      roughness: 0.4,
      metalness: 0.0,
    })
  );
  ember.position.x = 0.13;
  group.add(ember);

  const emberGlow = new THREE.PointLight(0xff8a42, 0.45, 0.65, 2);
  emberGlow.position.x = 0.13;
  group.add(emberGlow);
  group.userData.emberMaterial = ember.material;
  group.userData.emberGlow = emberGlow;

  group.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    node.renderOrder = 1000;
    node.material.depthTest = false;
    node.material.depthWrite = false;
    node.material.needsUpdate = true;
  });

  return group;
}

function createSmokeTexture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");

  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  grad.addColorStop(0, "rgba(245,245,245,0.95)");
  grad.addColorStop(0.35, "rgba(220,220,220,0.65)");
  grad.addColorStop(0.75, "rgba(165,165,165,0.22)");
  grad.addColorStop(1, "rgba(120,120,120,0)");

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(64, 64, 63, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
