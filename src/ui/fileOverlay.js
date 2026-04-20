export function createFileOverlayUI(root, { onDelete, canDelete, onSetModelColor, onSetModelUvMap } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "file-overlay hidden";

  const panel = document.createElement("div");
  panel.className = "file-overlay-panel";

  const header = document.createElement("div");
  header.className = "file-overlay-header";

  const title = document.createElement("h3");
  title.className = "file-overlay-title";
  header.appendChild(title);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "file-overlay-close file-overlay-icon-btn";
  setButtonIcon(
    close,
    "Close",
    '<path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  );

  const del = document.createElement("button");
  del.type = "button";
  del.className = "file-overlay-delete file-overlay-icon-btn";
  setButtonIcon(
    del,
    "Delete",
    '<path d="M8 9h8M10 9v8m4-8v8M9 6h6l1 2H8l1-2zM7 8l1 11h8l1-11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
  );

  const download = document.createElement("button");
  download.type = "button";
  download.className = "file-overlay-download file-overlay-icon-btn";
  setButtonIcon(
    download,
    "Download",
    '<path d="M12 5v9m0 0l-4-4m4 4l4-4M5 18h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
  );

  const metadata = document.createElement("button");
  metadata.type = "button";
  metadata.className = "file-overlay-meta file-overlay-icon-btn";
  setButtonIcon(
    metadata,
    "Metadata",
    '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 10v6M12 7.2h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  );

  const actions = document.createElement("div");
  actions.className = "file-overlay-actions";
  actions.appendChild(metadata);
  actions.appendChild(download);
  actions.appendChild(del);
  actions.appendChild(close);
  header.appendChild(actions);

  const body = document.createElement("div");
  body.className = "file-overlay-body";

  panel.appendChild(header);
  panel.appendChild(body);
  overlay.appendChild(panel);
  root.appendChild(overlay);

  const uvUploadInput = document.createElement("input");
  uvUploadInput.type = "file";
  uvUploadInput.accept = "image/*,.png,.jpg,.jpeg,.webp";
  uvUploadInput.style.display = "none";
  panel.appendChild(uvUploadInput);

  const colorModal = document.createElement("div");
  colorModal.className = "file-overlay-color-modal hidden";
  colorModal.innerHTML = `
    <div class="file-overlay-color-card">
      <h4 class="file-overlay-color-title">Model Color</h4>
      <div class="file-overlay-color-row">
        <input class="file-overlay-color-picker" type="color" value="#cad9f7" />
        <input class="file-overlay-color-hex" type="text" value="#cad9f7" maxlength="7" />
      </div>
      <div class="file-overlay-color-actions">
        <button type="button" class="file-overlay-color-cancel">Cancel</button>
        <button type="button" class="file-overlay-color-apply">Apply</button>
      </div>
    </div>
  `;
  panel.appendChild(colorModal);

  const colorPicker = colorModal.querySelector(".file-overlay-color-picker");
  const colorHexInput = colorModal.querySelector(".file-overlay-color-hex");
  const colorCancel = colorModal.querySelector(".file-overlay-color-cancel");
  const colorApply = colorModal.querySelector(".file-overlay-color-apply");

  let currentPin = null;
  let metadataPanel = null;

  close.addEventListener("click", () => hide());
  del.addEventListener("click", () => {
    if (!currentPin) return;
    if (del.disabled) return;
    onDelete?.(currentPin);
    hide();
  });
  download.addEventListener("click", () => {
    if (!currentPin?.dataUrl) return;
    const link = document.createElement("a");
    link.href = currentPin.dataUrl;
    link.download = currentPin.fileName || "download";
    link.rel = "noopener";
    link.click();
  });
  metadata.addEventListener("click", () => {
    if (!currentPin) return;
    if (metadataPanel) {
      metadataPanel.remove();
      metadataPanel = null;
      return;
    }

    metadataPanel = document.createElement("div");
    metadataPanel.className = "file-overlay-metadata";
    const rows = [
      ["Name", currentPin.fileName || "n/a"],
      ["Uploaded By", currentPin.ownerLabel || currentPin.ownerId || "Unknown"],
      ["Type", currentPin.fileType || "n/a"],
      ["MIME", currentPin.mimeType || "n/a"],
      ["Size", Number.isFinite(currentPin.size) ? `${Math.round(currentPin.size / 1024)} KB` : "n/a"],
      ["Created", currentPin.createdAt || "n/a"],
      [
        "Position",
        currentPin.position
          ? `${Number(currentPin.position.x || 0).toFixed(2)}, ${Number(currentPin.position.y || 0).toFixed(2)}, ${Number(currentPin.position.z || 0).toFixed(2)}`
          : "n/a",
      ],
    ];
    if (isModelPin(currentPin)) {
      rows.push(["Model Color", normalizeHex(currentPin.modelColor, "#cad9f7")]);
      rows.push(["UV Map", currentPin.modelUvMapDataUrl ? "Applied" : "None"]);
    }
    if (isFolderPin(currentPin)) {
      rows.push(["Items", `${Array.isArray(currentPin.folderEntries) ? currentPin.folderEntries.length : 0}`]);
    }

    for (const [key, value] of rows) {
      const row = document.createElement("div");
      row.className = "file-overlay-metadata-row";
      row.innerHTML = `<strong>${key}:</strong> <span>${String(value)}</span>`;
      metadataPanel.appendChild(row);
    }
    body.prepend(metadataPanel);
  });

  uvUploadInput.addEventListener("change", async () => {
    if (!currentPin || !isModelPin(currentPin)) return;
    const file = uvUploadInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    const dataUrl = await readFileAsDataUrl(file).catch(() => null);
    if (!dataUrl) return;
    if (!onSetModelUvMap) return;
    const updatedPin = await Promise.resolve(onSetModelUvMap(currentPin, dataUrl));
    if (updatedPin) {
      currentPin = updatedPin;
      show(currentPin);
    }
  });

  colorPicker.addEventListener("input", () => {
    colorHexInput.value = colorPicker.value;
  });
  colorHexInput.addEventListener("input", () => {
    const safe = normalizeHex(colorHexInput.value, colorPicker.value);
    colorPicker.value = safe;
  });
  colorCancel.addEventListener("click", () => closeColorModal());
  colorApply.addEventListener("click", async () => {
    if (!currentPin || !isModelPin(currentPin)) return;
    const safe = normalizeHex(colorHexInput.value || colorPicker.value, "#cad9f7");
    if (!onSetModelColor) {
      closeColorModal();
      return;
    }
    const updatedPin = await Promise.resolve(onSetModelColor(currentPin, safe));
    if (updatedPin) {
      currentPin = updatedPin;
      show(currentPin);
    }
    closeColorModal();
  });

  colorModal.addEventListener("click", (event) => {
    if (event.target === colorModal) closeColorModal();
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) hide();
  });
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Escape") return;
    if (!isOpen()) return;
    event.preventDefault();
    if (!colorModal.classList.contains("hidden")) {
      closeColorModal();
      return;
    }
    hide();
  });

  function hide() {
    overlay.classList.add("hidden");
    closeColorModal();
    currentPin = null;
    metadataPanel = null;
    body.replaceChildren();
  }

  function show(pin) {
    currentPin = pin;
    metadataPanel = null;
    title.textContent = pin.fileName;
    body.replaceChildren();
    const canDeleteThis = typeof canDelete === "function" ? Boolean(canDelete(pin)) : true;
    del.disabled = !canDeleteThis;
    del.style.display = canDeleteThis ? "" : "none";
    del.title = canDeleteThis ? "Delete" : "";
    del.setAttribute("aria-disabled", canDeleteThis ? "false" : "true");
    const canDownload = pin.fileType !== "folder";
    download.style.display = canDownload ? "" : "none";
    download.disabled = !canDownload;

    if (pin.fileType === "image" || pin.fileType === "decorate") {
      const img = document.createElement("img");
      img.className = "file-overlay-image";
      img.src = pin.dataUrl;
      img.alt = pin.fileName;
      body.appendChild(img);
    } else if (pin.fileType === "gif") {
      const img = document.createElement("img");
      img.className = "file-overlay-image";
      img.src = pin.dataUrl;
      img.alt = pin.fileName;
      body.appendChild(img);
    } else if (pin.fileType === "video") {
      const video = document.createElement("video");
      video.className = "file-overlay-image";
      video.src = pin.dataUrl;
      video.controls = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = true;
      video.muted = true;
      body.appendChild(video);
      video.play().catch(() => {});
    } else if (pin.fileType === "pdf") {
      const frame = document.createElement("iframe");
      frame.className = "file-overlay-pdf";
      frame.src = pin.dataUrl;
      frame.title = pin.fileName;
      body.appendChild(frame);
    } else if (pin.fileType === "audio") {
      const audio = document.createElement("audio");
      audio.className = "file-overlay-audio";
      audio.controls = true;
      audio.src = pin.dataUrl;
      body.appendChild(audio);
      audio.play().catch(() => {});
    } else if (isFolderPin(pin)) {
      const generic = document.createElement("div");
      generic.className = "file-overlay-generic";
      generic.innerHTML = `
        <h4>Folder Archive</h4>
        <p>${escapeHtml(pin.fileName || "folder")} (${Array.isArray(pin.folderEntries) ? pin.folderEntries.length : 0} items)</p>
      `;
      body.appendChild(generic);
      body.appendChild(createFolderList(pin));
    } else if (isModelPin(pin)) {
      const generic = document.createElement("div");
      generic.className = "file-overlay-generic";
      generic.innerHTML = `
        <h4>3D Model Inspector</h4>
        <p>${escapeHtml(pin.fileName || "model")} (${escapeHtml((pin.fileType || "model").toUpperCase())})</p>
      `;
      body.appendChild(generic);
      body.appendChild(createModelInspector(pin));
    } else {
      const generic = document.createElement("div");
      generic.className = "file-overlay-generic";
      generic.innerHTML = `
        <h4>Preview unavailable</h4>
        <p>${escapeHtml(pin.fileName || "file")} (${escapeHtml((pin.fileType || "unknown").toUpperCase())})</p>
      `;
      body.appendChild(generic);
    }

    overlay.classList.remove("hidden");
  }

  function createModelInspector(pin) {
    const wrap = document.createElement("div");
    wrap.className = "file-overlay-model-tools";

    const colorRow = document.createElement("div");
    colorRow.className = "file-overlay-model-row";

    const colorSwatch = document.createElement("span");
    colorSwatch.className = "file-overlay-model-swatch";
    colorSwatch.style.background = normalizeHex(pin.modelColor, "#cad9f7");
    colorRow.appendChild(colorSwatch);

    const colorButton = document.createElement("button");
    colorButton.type = "button";
    colorButton.className = "file-overlay-model-btn";
    colorButton.textContent = "Constant Color";
    colorButton.addEventListener("click", () => openColorModal(pin.modelColor));
    colorRow.appendChild(colorButton);

    const uvRow = document.createElement("div");
    uvRow.className = "file-overlay-model-row";

    const uvUploadButton = document.createElement("button");
    uvUploadButton.type = "button";
    uvUploadButton.className = "file-overlay-model-btn";
    uvUploadButton.textContent = "Upload UV Map";
    uvUploadButton.addEventListener("click", () => {
      uvUploadInput.value = "";
      uvUploadInput.click();
    });
    uvRow.appendChild(uvUploadButton);

    const uvClearButton = document.createElement("button");
    uvClearButton.type = "button";
    uvClearButton.className = "file-overlay-model-btn";
    uvClearButton.textContent = "Clear UV Map";
    uvClearButton.disabled = !pin.modelUvMapDataUrl;
    uvClearButton.addEventListener("click", async () => {
      if (!onSetModelUvMap || !currentPin) return;
      const updatedPin = await Promise.resolve(onSetModelUvMap(currentPin, ""));
      if (updatedPin) {
        currentPin = updatedPin;
        show(currentPin);
      }
    });
    uvRow.appendChild(uvClearButton);

    wrap.appendChild(colorRow);
    wrap.appendChild(uvRow);
    return wrap;
  }

  function createFolderList(pin) {
    const wrap = document.createElement("div");
    wrap.className = "file-overlay-folder-list";
    const entries = Array.isArray(pin.folderEntries) ? pin.folderEntries : [];
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "file-overlay-folder-empty";
      empty.textContent = "No files listed.";
      wrap.appendChild(empty);
      return wrap;
    }
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "file-overlay-folder-row";
      const name = document.createElement("div");
      name.className = "file-overlay-folder-name";
      name.textContent = String(entry?.path || entry?.name || "item");
      row.appendChild(name);

      const meta = document.createElement("div");
      meta.className = "file-overlay-folder-meta";
      const mime = String(entry?.mimeType || "").trim();
      const type = String(entry?.entryType || "").trim().toUpperCase();
      const size = Number(entry?.size) || 0;
      const sizeLabel = size > 0 ? `${Math.max(1, Math.round(size / 1024))} KB` : "";
      meta.textContent = [mime || type || null, sizeLabel || null].filter(Boolean).join(" · ");
      row.appendChild(meta);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function openColorModal(initialHex = "#cad9f7") {
    const safe = normalizeHex(initialHex, "#cad9f7");
    colorPicker.value = safe;
    colorHexInput.value = safe;
    colorModal.classList.remove("hidden");
  }

  function closeColorModal() {
    colorModal.classList.add("hidden");
  }

  function isOpen() {
    return !overlay.classList.contains("hidden");
  }

  return {
    show,
    hide,
    isOpen,
  };
}

function setButtonIcon(button, label, svgBody) {
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${svgBody}</svg>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isModelPin(pin) {
  return pin?.fileType === "obj" || pin?.fileType === "stl";
}

function isFolderPin(pin) {
  return pin?.fileType === "folder";
}

function normalizeHex(value, fallback = "#cad9f7") {
  const raw = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  return fallback;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}
