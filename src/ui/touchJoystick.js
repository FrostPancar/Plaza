export function createTouchJoystickUI(root, {
  onAxis,
  onTap,
}) {
  const wrap = document.createElement("div");
  wrap.className = "touch-joystick";

  const base = document.createElement("div");
  base.className = "touch-joystick-base";
  const knob = document.createElement("div");
  knob.className = "touch-joystick-knob";
  base.appendChild(knob);
  wrap.appendChild(base);
  root.appendChild(wrap);

  let activeId = null;
  let centerX = 0;
  let centerY = 0;
  const maxR = 42;

  function reset() {
    activeId = null;
    knob.style.transform = "translate(0px, 0px)";
    onAxis?.(0, 0);
  }

  function activate(touch) {
    const rect = base.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    activeId = touch.identifier;
    move(touch);
  }

  function move(touch) {
    const dx = touch.clientX - centerX;
    const dy = touch.clientY - centerY;
    const len = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(len, maxR);
    const x = (dx / len) * clamped;
    const y = (dy / len) * clamped;
    knob.style.transform = `translate(${x}px, ${y}px)`;
    onAxis?.(x / maxR, -y / maxR);
  }

  wrap.addEventListener("touchstart", (event) => {
    if (activeId !== null) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    event.preventDefault();
    activate(touch);
  }, { passive: false });

  wrap.addEventListener("touchmove", (event) => {
    if (activeId === null) return;
    for (const t of event.changedTouches) {
      if (t.identifier !== activeId) continue;
      event.preventDefault();
      move(t);
      return;
    }
  }, { passive: false });

  wrap.addEventListener("touchend", (event) => {
    if (activeId === null) return;
    for (const t of event.changedTouches) {
      if (t.identifier !== activeId) continue;
      event.preventDefault();
      reset();
      return;
    }
  }, { passive: false });

  wrap.addEventListener("touchcancel", reset, { passive: true });

  function handleTap(clientX, clientY) {
    onTap?.(clientX, clientY);
  }

  return {
    show() { wrap.classList.remove("hidden"); },
    hide() { wrap.classList.add("hidden"); reset(); },
    isVisible() { return !wrap.classList.contains("hidden"); },
    handleTap,
  };
}
