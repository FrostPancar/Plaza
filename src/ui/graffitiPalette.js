export function createGraffitiPaletteUI(root, colors, onSelectColor, onSelectSize, onClear) {
  const panel = document.createElement("div");
  panel.className = "graffiti-palette hidden";

  const buttons = [];
  for (const color of colors) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "graffiti-color";
    btn.style.background = color;
    btn.title = color;
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      onSelectColor(color);
    });
    panel.appendChild(btn);
    buttons.push(btn);
  }

  const sizeWrap = document.createElement("div");
  sizeWrap.className = "graffiti-size-wrap";

  const sizeLabel = document.createElement("span");
  sizeLabel.className = "graffiti-size-label";
  sizeLabel.textContent = "Brush";
  sizeWrap.appendChild(sizeLabel);

  const sizeInput = document.createElement("input");
  sizeInput.type = "range";
  sizeInput.min = "0.15";
  sizeInput.max = "1.3";
  sizeInput.step = "0.05";
  sizeInput.value = "0.45";
  sizeInput.className = "graffiti-size-slider";
  sizeInput.addEventListener("input", () => onSelectSize(Number(sizeInput.value)));
  sizeWrap.appendChild(sizeInput);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "graffiti-clear-btn";
  clearBtn.textContent = "Clear";
  clearBtn.addEventListener("click", () => onClear?.());
  sizeWrap.appendChild(clearBtn);

  panel.appendChild(sizeWrap);

  buttons[0]?.classList.add("active");
  root.appendChild(panel);

  return {
    show() {
      panel.classList.remove("hidden");
    },
    hide() {
      panel.classList.add("hidden");
    },
  };
}
