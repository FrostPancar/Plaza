function normalizeColor(color) {
  return String(color || "").trim().toLowerCase();
}

export function createBuildPaletteUI(root, { shapes, colors, onDropShape, onSelectColor, onRotateShape }) {
  const panel = document.createElement("div");
  panel.className = "build-palette hidden";

  const header = document.createElement("div");
  header.className = "build-palette-header";
  header.textContent = "Build Palette";
  panel.appendChild(header);

  const tray = document.createElement("div");
  tray.className = "build-shape-tray";
  panel.appendChild(tray);

  const editor = document.createElement("div");
  editor.className = "build-shape-editor hidden";

  const selectedLabel = document.createElement("div");
  selectedLabel.className = "build-shape-selected";
  selectedLabel.textContent = "Select shape";
  editor.appendChild(selectedLabel);

  const swatchRow = document.createElement("div");
  swatchRow.className = "build-color-row";
  const colorButtons = [];
  for (const color of colors) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "build-color-btn";
    btn.style.background = color;
    btn.dataset.color = normalizeColor(color);
    btn.title = color;
    btn.addEventListener("click", () => {
      onSelectColor?.(color);
      setActiveColor(color);
    });
    swatchRow.appendChild(btn);
    colorButtons.push(btn);
  }
  editor.appendChild(swatchRow);

  const rotateButton = document.createElement("button");
  rotateButton.type = "button";
  rotateButton.className = "build-rotate-btn";
  rotateButton.textContent = "Rotate 22.5°";
  rotateButton.addEventListener("click", () => onRotateShape?.());
  editor.appendChild(rotateButton);
  panel.appendChild(editor);

  let dragGhost = null;
  let dragCleanup = null;

  for (const shape of shapes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "build-shape-btn";
    btn.innerHTML = `<span class="build-shape-glyph">${shape.glyph}</span><span class="build-shape-name">${shape.label}</span>`;
    btn.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      beginDrag(shape, event.clientX, event.clientY);
    });
    tray.appendChild(btn);
  }

  root.appendChild(panel);

  function setActiveColor(color) {
    const key = normalizeColor(color);
    for (const btn of colorButtons) {
      btn.classList.toggle("active", btn.dataset.color === key);
    }
  }

  function clearDrag() {
    dragCleanup?.();
    dragCleanup = null;
    dragGhost?.remove();
    dragGhost = null;
  }

  function beginDrag(shape, x, y) {
    clearDrag();

    dragGhost = document.createElement("div");
    dragGhost.className = "build-drag-ghost";
    dragGhost.textContent = shape.label;
    document.body.appendChild(dragGhost);
    dragGhost.style.left = `${x}px`;
    dragGhost.style.top = `${y}px`;

    const onMove = (event) => {
      if (!dragGhost) return;
      dragGhost.style.left = `${event.clientX}px`;
      dragGhost.style.top = `${event.clientY}px`;
    };

    const onUp = (event) => {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      onDropShape?.({
        shapeId: shape.id,
        x: event.clientX,
        y: event.clientY,
        target,
      });
      clearDrag();
    };

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    dragCleanup = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
    };
  }

  function setSelection(selection) {
    if (!selection) {
      selectedLabel.textContent = "Select shape";
      editor.classList.add("hidden");
      return;
    }
    selectedLabel.textContent = `Editing: ${selection.label}`;
    editor.classList.remove("hidden");
    setActiveColor(selection.color);
  }

  return {
    show() {
      panel.classList.remove("hidden");
    },
    hide() {
      clearDrag();
      panel.classList.add("hidden");
    },
    setSelection,
  };
}
