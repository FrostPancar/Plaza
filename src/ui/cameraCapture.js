export async function captureSelfie() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

  try {
    const overlay = document.createElement("div");
    overlay.className = "camera-capture-overlay";

    const panel = document.createElement("div");
    panel.className = "camera-capture-panel";

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;

    const controls = document.createElement("div");
    controls.className = "camera-capture-controls";

    const captureBtn = document.createElement("button");
    captureBtn.type = "button";
    captureBtn.textContent = "Capture";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";

    controls.appendChild(cancelBtn);
    controls.appendChild(captureBtn);

    panel.appendChild(video);
    panel.appendChild(controls);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    await video.play();

    const result = await new Promise((resolve) => {
      cancelBtn.addEventListener("click", () => resolve(null), { once: true });
      captureBtn.addEventListener(
        "click",
        () => {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.9));
        },
        { once: true }
      );
    });

    overlay.remove();
    return result;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}
