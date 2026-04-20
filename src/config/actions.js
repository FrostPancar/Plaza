export function createActionRegistry({
  onDropFile,
  onDropFolder,
  onDecorate,
  onDocumentSelf,
  onGraffiti,
  onBuild,
  onSmoke,
  onDarkMode,
  disableDecorate = false,
}) {
  void onGraffiti;
  void onBuild;
  const actions = [
    { id: "drop-file", label: "Drop File", icon: "./assets/Upload.png", enabled: true, handler: () => onDropFile?.() },
    { id: "dark-mode", label: "Dark Mode", icon: "./assets/Night_Day.png", enabled: true, handler: () => onDarkMode?.() },
    { id: "document-self", label: "Document Self", icon: "./assets/Document.png", enabled: true, handler: () => onDocumentSelf?.() },
    { id: "smoke", label: "Smoke", icon: "./assets/Smoke.png", enabled: true, handler: () => onSmoke?.() },
    { id: "drop-folder", label: "Upload Folder", icon: "./assets/Folder.png", enabled: true, handler: () => onDropFolder?.() },
  ];
  if (!disableDecorate) {
    actions.splice(2, 0, {
      id: "decorate",
      label: "Decorate",
      icon: "./assets/Decorate.png",
      enabled: true,
      handler: () => onDecorate?.(),
    });
  }
  return actions;
}
