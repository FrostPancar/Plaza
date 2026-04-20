function createPanelBase(root, className) {
  const panel = document.createElement("div");
  panel.className = `${className} hidden`;
  root.appendChild(panel);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "env-panel-close";
  close.textContent = "Close";

  function show() {
    panel.classList.remove("hidden");
  }

  function hide() {
    panel.classList.add("hidden");
  }

  function toggle() {
    panel.classList.toggle("hidden");
  }

  close.addEventListener("click", hide);

  return { panel, close, show, hide, toggle, isOpen: () => !panel.classList.contains("hidden") };
}

export function createColorPanelUI(root, { initialSky = "#f3f5f7", initialGround = "#e8eaed", onApply }) {
  const base = createPanelBase(root, "env-panel");

  const title = document.createElement("h3");
  title.className = "env-panel-title";
  title.textContent = "World Colors";

  const skyLabel = document.createElement("label");
  skyLabel.className = "env-panel-row";
  skyLabel.textContent = "Sky";
  const skyInput = document.createElement("input");
  skyInput.type = "text";
  skyInput.value = initialSky;
  skyInput.maxLength = 7;

  const groundLabel = document.createElement("label");
  groundLabel.className = "env-panel-row";
  groundLabel.textContent = "Ground";
  const groundInput = document.createElement("input");
  groundInput.type = "text";
  groundInput.value = initialGround;
  groundInput.maxLength = 7;

  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "env-panel-apply";
  apply.textContent = "Apply";

  skyLabel.appendChild(skyInput);
  groundLabel.appendChild(groundInput);
  base.panel.append(title, skyLabel, groundLabel, apply, base.close);

  apply.addEventListener("click", () => {
    onApply?.({ skyColor: skyInput.value, groundColor: groundInput.value });
  });

  return {
    ...base,
    setValues({ skyColor, groundColor }) {
      if (skyColor) skyInput.value = skyColor;
      if (groundColor) groundInput.value = groundColor;
    },
  };
}

export function createFilterPanelUI(root, { initialPixelation = 63, initialVignette = 0, onApply }) {
  const base = createPanelBase(root, "env-panel");

  const title = document.createElement("h3");
  title.className = "env-panel-title";
  title.textContent = "World Filters";

  const pixelLabel = document.createElement("label");
  pixelLabel.className = "env-panel-row";
  pixelLabel.textContent = "Pixelation";
  const pixelInput = document.createElement("input");
  pixelInput.type = "range";
  pixelInput.min = "0";
  pixelInput.max = "300";
  pixelInput.step = "1";
  pixelInput.value = String(initialPixelation);

  const vignetteLabel = document.createElement("label");
  vignetteLabel.className = "env-panel-row";
  vignetteLabel.textContent = "Vignette";
  const vignetteInput = document.createElement("input");
  vignetteInput.type = "range";
  vignetteInput.min = "0";
  vignetteInput.max = "100";
  vignetteInput.step = "1";
  vignetteInput.value = String(initialVignette);

  pixelLabel.appendChild(pixelInput);
  vignetteLabel.appendChild(vignetteInput);
  base.panel.append(title, pixelLabel, vignetteLabel, base.close);

  const apply = () => {
    onApply?.({
      pixelation: Number(pixelInput.value),
      vignette: Number(vignetteInput.value),
    });
  };

  pixelInput.addEventListener("input", apply);
  vignetteInput.addEventListener("input", apply);

  return {
    ...base,
    setValues({ pixelation, vignette }) {
      if (Number.isFinite(pixelation)) pixelInput.value = String(pixelation);
      if (Number.isFinite(vignette)) vignetteInput.value = String(vignette);
    },
  };
}
