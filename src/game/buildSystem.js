const BUILD_ZONE_RADIUS = 9;
const DEFAULT_SHAPE_COLOR = "#79c8ff";

export const BUILD_SHAPE_COLORS = [
  "#79c8ff",
  "#ff8d72",
  "#89f0b2",
  "#ffd36b",
  "#c8a1ff",
  "#ffa8d2",
  "#9df2ff",
  "#d6dde8",
];

export const BUILD_SHAPE_DEFS = [
  { id: "box", label: "Cube", glyph: "Cube", createGeometry: (THREE) => new THREE.BoxGeometry(1, 1, 1) },
  { id: "sphere", label: "Sphere", glyph: "Ball", createGeometry: (THREE) => new THREE.SphereGeometry(0.56, 26, 20) },
  {
    id: "cylinder",
    label: "Cylinder",
    glyph: "Tube",
    createGeometry: (THREE) => new THREE.CylinderGeometry(0.45, 0.45, 1.05, 24),
  },
  { id: "cone", label: "Cone", glyph: "Cone", createGeometry: (THREE) => new THREE.ConeGeometry(0.54, 1.1, 22) },
  { id: "torus", label: "Torus", glyph: "Ring", createGeometry: (THREE) => new THREE.TorusGeometry(0.58, 0.18, 16, 48) },
  {
    id: "torus-knot",
    label: "Knot",
    glyph: "Knot",
    createGeometry: (THREE) => new THREE.TorusKnotGeometry(0.36, 0.12, 110, 14),
  },
  {
    id: "tetrahedron",
    label: "Tetra",
    glyph: "Tet",
    createGeometry: (THREE) => new THREE.TetrahedronGeometry(0.62, 0),
  },
  {
    id: "octahedron",
    label: "Octa",
    glyph: "Oct",
    createGeometry: (THREE) => new THREE.OctahedronGeometry(0.62, 0),
  },
  {
    id: "dodecahedron",
    label: "Dodeca",
    glyph: "Dod",
    createGeometry: (THREE) => new THREE.DodecahedronGeometry(0.58, 0),
  },
  {
    id: "icosahedron",
    label: "Icosa",
    glyph: "Ico",
    createGeometry: (THREE) => new THREE.IcosahedronGeometry(0.58, 0),
  },
];

function uid() {
  return `build_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function distance2D(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function worldNormalFromHit(THREE, hit) {
  const normal = hit.face?.normal;
  if (!normal) return new THREE.Vector3(0, 1, 0);
  return normal.clone().transformDirection(hit.object.matrixWorld).normalize();
}

function getHalfHeight(geometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) return 0.5;
  return Math.max(0.2, (bounds.max.y - bounds.min.y) * 0.5);
}

export function createBuildSystem({
  THREE,
  scene,
  camera,
  drawables,
  onBuildRadiusChange,
  onSelectionChange,
}) {
  const zoneGroup = new THREE.Group();
  zoneGroup.name = "build-zones";
  scene.add(zoneGroup);

  const shapeGroup = new THREE.Group();
  shapeGroup.name = "build-shapes";
  scene.add(shapeGroup);

  const zones = [];
  const shapes = [];
  const shapeMeshes = [];

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  let activeBuildZone = null;
  let selectedShape = null;
  let hadActiveRadius = false;
  let dragState = null;

  function pushSelectionChange() {
    if (!onSelectionChange) return;
    if (!selectedShape) {
      onSelectionChange(null);
      return;
    }
    onSelectionChange({
      id: selectedShape.id,
      label: selectedShape.def.label,
      color: `#${selectedShape.mesh.material.color.getHexString()}`,
    });
  }

  function setSelectedShape(shape) {
    selectedShape = shape || null;
    pushSelectionChange();
  }

  function pickShapeAtScreenPoint(clientX, clientY, domElement) {
    toNdc(clientX, clientY, domElement);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(shapeMeshes, false);
    if (!hits[0]) return null;
    return shapes.find((item) => item.mesh === hits[0].object) || null;
  }

  function pickSurfaceHit(clientX, clientY, domElement) {
    toNdc(clientX, clientY, domElement);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(drawables, false);
    if (!hits.length) return null;
    for (const hit of hits) {
      const worldNormal = worldNormalFromHit(THREE, hit);
      if (worldNormal.y < 0.35) continue;
      if (activeBuildZone && distance2D(hit.point, activeBuildZone.position) > activeBuildZone.radius) continue;
      return hit;
    }
    return null;
  }

  function spawnBuildZone(data) {
    const ringMesh = new THREE.Mesh(
      new THREE.RingGeometry(data.radius - 0.1, data.radius, 72),
      new THREE.MeshBasicMaterial({
        color: 0x72d6ff,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      })
    );
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.set(data.position.x, 0.025, data.position.z);
    zoneGroup.add(ringMesh);

    const columnMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.42, 1.3, 20),
      new THREE.MeshStandardMaterial({
        color: 0x315f80,
        emissive: 0x10364f,
        emissiveIntensity: 0.45,
        roughness: 0.42,
        metalness: 0.55,
      })
    );
    columnMesh.position.set(data.position.x, 0.66, data.position.z);
    zoneGroup.add(columnMesh);

    const capMesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.26, 0),
      new THREE.MeshStandardMaterial({
        color: 0x8de9ff,
        emissive: 0x216a91,
        emissiveIntensity: 0.95,
        roughness: 0.22,
        metalness: 0.58,
      })
    );
    capMesh.position.set(data.position.x, 1.35, data.position.z);
    zoneGroup.add(capMesh);

    const zone = {
      ...data,
      ringMesh,
      columnMesh,
      capMesh,
      inRadius: false,
    };
    zones.push(zone);
    return zone;
  }

  function addBuildZoneAtPlayer(playerPosition) {
    return spawnBuildZone({
      id: uid(),
      position: {
        x: Number(playerPosition.x.toFixed(2)),
        y: Number(playerPosition.y.toFixed(2)),
        z: Number(playerPosition.z.toFixed(2)),
      },
      radius: BUILD_ZONE_RADIUS,
      createdAt: new Date().toISOString(),
    });
  }

  function update(_delta, playerPosition) {
    let nearest = null;
    let nearestDistance = Infinity;

    for (const zone of zones) {
      const d = distance2D(playerPosition, zone.position);
      zone.inRadius = d <= zone.radius;

      zone.ringMesh.material.color.setHex(zone.inRadius ? 0x9ce6ff : 0x72d6ff);
      zone.columnMesh.material.emissiveIntensity = zone.inRadius ? 0.88 : 0.45;
      zone.capMesh.material.emissiveIntensity = zone.inRadius ? 1.4 : 0.95;

      if (zone.inRadius && d < nearestDistance) {
        nearestDistance = d;
        nearest = zone;
      }
    }

    activeBuildZone = nearest;
    const hasActiveRadius = Boolean(activeBuildZone);
    if (hasActiveRadius !== hadActiveRadius) {
      hadActiveRadius = hasActiveRadius;
      onBuildRadiusChange?.(hasActiveRadius);
      if (!hasActiveRadius) setSelectedShape(null);
      if (!hasActiveRadius) dragState = null;
    }
  }

  function toNdc(clientX, clientY, domElement) {
    const rect = domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    return rect;
  }

  function handleClick(clientX, clientY, domElement) {
    if (!activeBuildZone) {
      setSelectedShape(null);
      return false;
    }

    const shape = pickShapeAtScreenPoint(clientX, clientY, domElement);
    if (!shape) return false;

    setSelectedShape(shape);
    return true;
  }

  function beginShapeDrag(clientX, clientY, domElement) {
    if (!activeBuildZone) return false;
    const shape = pickShapeAtScreenPoint(clientX, clientY, domElement);
    if (!shape) return false;
    dragState = { shape };
    setSelectedShape(shape);
    return true;
  }

  function dragShape(clientX, clientY, domElement) {
    if (!dragState || !activeBuildZone) return false;
    const hit = pickSurfaceHit(clientX, clientY, domElement);
    if (!hit) return false;

    const geometry = dragState.shape.mesh.geometry;
    const halfHeight = getHalfHeight(geometry);
    dragState.shape.mesh.position.set(hit.point.x, hit.point.y + halfHeight + 0.02, hit.point.z);
    return true;
  }

  function endShapeDrag() {
    const hadDrag = Boolean(dragState);
    dragState = null;
    return hadDrag;
  }

  function placeShapeAtScreenPoint(shapeId, clientX, clientY, domElement) {
    if (!activeBuildZone) return null;
    const def = BUILD_SHAPE_DEFS.find((item) => item.id === shapeId);
    if (!def) return null;

    const chosenHit = pickSurfaceHit(clientX, clientY, domElement);
    if (!chosenHit) return null;

    const geometry = def.createGeometry(THREE);
    const material = new THREE.MeshStandardMaterial({
      color: DEFAULT_SHAPE_COLOR,
      roughness: 0.44,
      metalness: 0.32,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const halfHeight = getHalfHeight(geometry);
    mesh.position.set(chosenHit.point.x, chosenHit.point.y + halfHeight + 0.02, chosenHit.point.z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    shapeGroup.add(mesh);

    const shape = {
      id: uid(),
      def,
      mesh,
    };
    shapes.push(shape);
    shapeMeshes.push(mesh);
    setSelectedShape(shape);
    return shape;
  }

  function setSelectedShapeColor(color) {
    if (!selectedShape) return false;
    selectedShape.mesh.material.color.set(color);
    pushSelectionChange();
    return true;
  }

  function rotateSelectedShape(stepRadians = Math.PI / 8) {
    if (!selectedShape) return false;
    selectedShape.mesh.rotation.y += stepRadians;
    return true;
  }

  function clearSelection() {
    setSelectedShape(null);
  }

  return {
    addBuildZoneAtPlayer,
    update,
    handleClick,
    beginShapeDrag,
    dragShape,
    endShapeDrag,
    placeShapeAtScreenPoint,
    setSelectedShapeColor,
    rotateSelectedShape,
    clearSelection,
    isInBuildRadius: () => Boolean(activeBuildZone),
  };
}
