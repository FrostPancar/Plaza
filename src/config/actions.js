export function createActionRegistry({
  onDropFile,
  onDropFolder,
  onDecorate,
  onDocumentSelf,
  onGraffiti,
  onBuild,
  onChangeMask,
  onSmoke,
  onDarkMode,
  disableDecorate = false,
}) {
  void onGraffiti;
  void onBuild;
  const actions = [
    { id: "drop-file", label: "Drop File", enabled: true, handler: () => onDropFile?.() },
    { id: "drop-folder", label: "Upload Folder", enabled: true, handler: () => onDropFolder?.() },
    { id: "document-self", label: "Document Self", enabled: true, handler: () => onDocumentSelf?.() },
    { id: "smoke", label: "Smoke", enabled: true, handler: () => onSmoke?.() },
    { id: "dark-mode", label: "Dark Mode", enabled: true, handler: () => onDarkMode?.() },
    { id: "change-mask", label: "Change Mask", enabled: true, handler: () => onChangeMask?.() },
  ];
  if (!disableDecorate) {
    actions.splice(1, 0, { id: "decorate", label: "Decorate", enabled: true, handler: () => onDecorate?.() });
  }
  return actions;
}
