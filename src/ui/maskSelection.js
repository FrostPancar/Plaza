export function createMaskSelectionUI(root, masks, onSelect) {
  const overlay = document.createElement("div");
  overlay.className = "mask-overlay";

  const grid = document.createElement("div");
  grid.className = "mask-grid";

  for (const mask of masks) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mask-option";
    button.title = mask.label;

    const img = document.createElement("img");
    img.alt = mask.label;
    img.src = mask.previewUrl;
    button.appendChild(img);

    button.addEventListener("click", () => onSelect(mask.id));
    grid.appendChild(button);
  }

  overlay.appendChild(grid);
  root.appendChild(overlay);

  function show() {
    overlay.classList.remove("hidden");
  }

  function hide() {
    overlay.classList.add("hidden");
  }

  return {
    show,
    hide,
  };
}
