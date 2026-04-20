export function createFileOverlayUI(
  root,
  { onDelete, canDelete, onSetModelColor, onSetModelUvMap, onAppendToFolder } = {}
) {
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
  let folderSortKey = "date-desc";
  let currentCanEdit = false;
  let pendingModelColorHex = "#cad9f7";

  const folderAppendInput = document.createElement("input");
  folderAppendInput.type = "file";
  folderAppendInput.multiple = true;
  folderAppendInput.style.display = "none";
  panel.appendChild(folderAppendInput);

  close.addEventListener("click", () => hide());
  del.addEventListener("click", () => {
    if (!currentPin) return;
    if (del.disabled) return;
    onDelete?.(currentPin);
    hide();
  });
  download.addEventListener("click", () => {
    if (!currentPin) return;
    if (isFolderPin(currentPin)) {
      void downloadFolderZip(currentPin);
      return;
    }
    if (!currentPin.dataUrl) return;
    triggerDownload(currentPin.dataUrl, currentPin.fileName || "download");
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
    pendingModelColorHex = colorPicker.value;
  });
  colorHexInput.addEventListener("input", () => {
    const safe = normalizeHex(colorHexInput.value, colorPicker.value);
    colorPicker.value = safe;
    pendingModelColorHex = safe;
  });
  colorCancel.addEventListener("click", () => {
    void closeColorModal({ save: false });
  });
  colorApply.addEventListener("click", async () => {
    await applyColorSelection({ rerender: true });
    void closeColorModal({ save: false });
  });

  colorModal.addEventListener("click", (event) => {
    if (event.target === colorModal) {
      void closeColorModal({ save: true });
    }
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) hide();
  });
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Escape") return;
    if (!isOpen()) return;
    event.preventDefault();
    if (!colorModal.classList.contains("hidden")) {
      void closeColorModal({ save: true });
      return;
    }
    hide();
  });

  function hide() {
    if (!colorModal.classList.contains("hidden")) {
      void applyColorSelection({ rerender: false });
    }
    overlay.classList.add("hidden");
    void closeColorModal({ save: false });
    currentPin = null;
    currentCanEdit = false;
    metadataPanel = null;
    body.replaceChildren();
  }

  function show(pin) {
    currentPin = pin;
    metadataPanel = null;
    title.textContent = pin.fileName;
    body.replaceChildren();
    const canDeleteThis = typeof canDelete === "function" ? Boolean(canDelete(pin)) : true;
    currentCanEdit = canDeleteThis;
    del.disabled = !canDeleteThis;
    del.style.display = canDeleteThis ? "" : "none";
    del.title = canDeleteThis ? "Delete" : "";
    del.setAttribute("aria-disabled", canDeleteThis ? "false" : "true");
    const canDownload = pin.fileType !== "folder" || (Array.isArray(pin.folderEntries) && pin.folderEntries.length > 0);
    download.style.display = canDownload ? "" : "none";
    download.disabled = !canDownload;
    download.title = isFolderPin(pin) ? "Download ZIP" : "Download";

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
    const controls = document.createElement("div");
    controls.className = "file-overlay-folder-controls";
    const sortLabel = document.createElement("label");
    sortLabel.className = "file-overlay-folder-sort-label";
    sortLabel.textContent = "Sort";
    const sortSelect = document.createElement("select");
    sortSelect.className = "file-overlay-folder-sort";
    sortSelect.innerHTML = `
      <option value="date-desc">Date (Newest)</option>
      <option value="date-asc">Date (Oldest)</option>
      <option value="size-desc">Size (Largest)</option>
      <option value="size-asc">Size (Smallest)</option>
    `;
    sortSelect.value = folderSortKey;
    controls.appendChild(sortLabel);
    controls.appendChild(sortSelect);
    if (typeof onAppendToFolder === "function") {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "file-overlay-folder-add";
      addBtn.setAttribute("aria-label", "Add files to folder");
      addBtn.title = "Add files";
      addBtn.textContent = "+";
      addBtn.addEventListener("click", () => {
        folderAppendInput.value = "";
        folderAppendInput.click();
      });
      controls.appendChild(addBtn);
    }
    wrap.appendChild(controls);

    const list = document.createElement("div");
    list.className = "file-overlay-folder-items";
    wrap.appendChild(list);

    const entries = Array.isArray(pin.folderEntries) ? pin.folderEntries : [];
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "file-overlay-folder-empty";
      empty.textContent = "No files listed.";
      list.appendChild(empty);
      return wrap;
    }

    const renderRows = () => {
      list.replaceChildren();
      const sorted = sortFolderEntries(entries, folderSortKey);
      for (const entry of sorted) {
        const row = document.createElement("div");
        row.className = "file-overlay-folder-row";

        const name = document.createElement("div");
        name.className = "file-overlay-folder-name";
        name.textContent = String(entry?.path || entry?.name || "item");
        row.appendChild(name);

        const meta = document.createElement("div");
        meta.className = "file-overlay-folder-meta";
        const sizeLabel = formatBytes(Number(entry?.size) || 0);
        const dateLabel = formatDateCompact(entry?.uploadedAt || entry?.createdAt || pin.createdAt);
        const author = String(pin.ownerLabel || pin.ownerId || "Unknown");
        meta.textContent = `${sizeLabel} · ${dateLabel} · ${author}`;
        row.appendChild(meta);

        const rowDownload = document.createElement("button");
        rowDownload.type = "button";
        rowDownload.className = "file-overlay-folder-download";
        rowDownload.textContent = "Download";
        rowDownload.disabled = !entry?.dataUrl;
        rowDownload.addEventListener("click", () => {
          if (!entry?.dataUrl) return;
          triggerDownload(entry.dataUrl, entry.name || "file");
        });
        row.appendChild(rowDownload);
        list.appendChild(row);
      }
    };

    sortSelect.addEventListener("change", () => {
      folderSortKey = sortSelect.value || "date-desc";
      renderRows();
    });

    renderRows();
    return wrap;
  }

  function openColorModal(initialHex = "#cad9f7") {
    const safe = normalizeHex(initialHex, "#cad9f7");
    colorPicker.value = safe;
    colorHexInput.value = safe;
    pendingModelColorHex = safe;
    colorModal.classList.remove("hidden");
  }

  async function closeColorModal({ save = false } = {}) {
    if (save) await applyColorSelection({ rerender: true });
    colorModal.classList.add("hidden");
  }

  async function applyColorSelection({ rerender = false } = {}) {
    if (!currentPin || !isModelPin(currentPin) || !onSetModelColor) return;
    const safe = normalizeHex(pendingModelColorHex || colorHexInput.value || colorPicker.value, "#cad9f7");
    if (normalizeHex(currentPin.modelColor, "#cad9f7") === safe) return;
    const updatedPin = await Promise.resolve(onSetModelColor(currentPin, safe));
    if (!updatedPin) return;
    currentPin = updatedPin;
    if (rerender && isOpen()) show(currentPin);
  }

  function isOpen() {
    return !overlay.classList.contains("hidden");
  }

  folderAppendInput.addEventListener("change", async () => {
    if (!currentPin || currentPin.fileType !== "folder") return;
    const files = Array.from(folderAppendInput.files || []);
    if (!files.length) return;
    if (typeof onAppendToFolder !== "function") return;
    const updated = await Promise.resolve(onAppendToFolder(currentPin, files));
    if (updated) show(updated);
  });

  return {
    show,
    hide,
    isOpen,
  };

  async function downloadFolderZip(pin) {
    const entries = Array.isArray(pin?.folderEntries) ? pin.folderEntries : [];
    const files = [];
    for (const entry of entries) {
      const dataUrl = String(entry?.dataUrl || "");
      if (!dataUrl) continue;
      const bytes = dataUrlToBytes(dataUrl);
      if (!bytes) continue;
      const path = String(entry?.path || entry?.name || "file").replace(/^\/+/, "");
      files.push({ path: path || "file", bytes });
    }
    if (!files.length) return;
    const zipBlob = createZipBlob(files);
    const baseName = sanitizeFilename(String(pin?.fileName || "folder"));
    triggerBlobDownload(zipBlob, `${baseName}.zip`);
  }
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

function sortFolderEntries(entries, sortKey) {
  const list = Array.isArray(entries) ? [...entries] : [];
  const safeKey = String(sortKey || "date-desc");
  if (safeKey.startsWith("size")) {
    list.sort((a, b) => (Number(a?.size) || 0) - (Number(b?.size) || 0));
    if (safeKey.endsWith("desc")) list.reverse();
    return list;
  }
  list.sort((a, b) => {
    const da = Date.parse(String(a?.uploadedAt || a?.createdAt || "")) || 0;
    const db = Date.parse(String(b?.uploadedAt || b?.createdAt || "")) || 0;
    return da - db;
  });
  if (safeKey.endsWith("desc")) list.reverse();
  return list;
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  const rounded = value >= 10 || unit === "B" ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${unit}`;
}

function formatDateCompact(value) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function triggerDownload(href, filename) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename || "download";
  link.rel = "noopener";
  link.click();
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function sanitizeFilename(value) {
  const raw = String(value || "").trim();
  const clean = raw.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  return clean || "download";
}

function dataUrlToBytes(dataUrl) {
  const raw = String(dataUrl || "");
  const comma = raw.indexOf(",");
  if (comma < 0) return null;
  const header = raw.slice(0, comma);
  const payload = raw.slice(comma + 1);
  if (/;base64/i.test(header)) {
    const bin = atob(payload);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}

function createZipBlob(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(String(file.path || "file"));
    const data = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes || 0);
    const crc = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}
