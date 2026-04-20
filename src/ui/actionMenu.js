export function createActionMenuUI(root, actions, options = {}) {
  const shell = document.createElement("div");
  shell.className = "action-orb-shell";
  const mobileLayout = Boolean(options.isMobileLayout);
  if (mobileLayout) shell.classList.add("mobile-layout");

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "action-orb-backdrop action-orb-hidden";
  backdrop.setAttribute("aria-label", "Close action menu");
  shell.appendChild(backdrop);

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "action-launcher";
  launcher.textContent = "E";
  launcher.setAttribute("aria-label", "Open action menu");
  shell.appendChild(launcher);

  const dialItems = [];
  const revealTimers = [];
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "action-dial-item";
    btn.setAttribute("aria-label", action.label);
    btn.title = action.label;
    if (action.icon) {
      const icon = document.createElement("img");
      icon.className = "action-dial-icon";
      icon.src = action.icon;
      icon.alt = "";
      icon.loading = "lazy";
      btn.appendChild(icon);
    }
    const label = document.createElement("span");
    label.className = "action-dial-label";
    label.textContent = action.label;
    btn.appendChild(label);
    btn.disabled = !action.enabled;
    btn.addEventListener("click", () => {
      action.handler({ source: "action-menu" });
      close();
    });
    dialItems.push(btn);
    shell.appendChild(btn);
  }

  root.appendChild(shell);

  let open = false;
  let visible = true;

  launcher.addEventListener("click", () => {
    if (!visible) return;
    toggle();
  });

  backdrop.addEventListener("click", () => {
    close();
  });

  function layoutDial() {
    const count = Math.max(1, dialItems.length);
    if (mobileLayout) {
      const spacing = window.innerWidth < 420 ? 74 : 80;
      const start = -((count - 1) * spacing) / 2;
      for (let i = 0; i < dialItems.length; i += 1) {
        const item = dialItems[i];
        item.style.setProperty("--tx", "0px");
        item.style.setProperty("--ty", `${(start + spacing * i).toFixed(1)}px`);
      }
      return;
    }
    const radius = window.innerWidth < 760 ? 138 : 176;
    const startAngle = -Math.PI / 2;
    const step = (Math.PI * 2) / count;
    for (let i = 0; i < dialItems.length; i += 1) {
      const angle = startAngle + step * i;
      const tx = Math.cos(angle) * radius;
      const ty = Math.sin(angle) * radius;
      const item = dialItems[i];
      item.style.setProperty("--tx", `${tx.toFixed(1)}px`);
      item.style.setProperty("--ty", `${ty.toFixed(1)}px`);
    }
  }

  function clearRevealTimers() {
    while (revealTimers.length) {
      clearTimeout(revealTimers.pop());
    }
  }

  function closeDialItemsImmediate() {
    clearRevealTimers();
    for (const item of dialItems) item.classList.remove("open");
  }

  function openDialItemsStaggered() {
    clearRevealTimers();
    for (let i = 0; i < dialItems.length; i += 1) {
      const item = dialItems[i];
      item.classList.remove("open");
      const timer = setTimeout(() => {
        if (!open || !visible) return;
        item.classList.add("open");
      }, i * 42);
      revealTimers.push(timer);
    }
  }

  function applyState() {
    shell.classList.toggle("open", open && visible);
    backdrop.classList.toggle("action-orb-hidden", !(open && visible));
    launcher.classList.toggle("action-orb-hidden", !visible);
    for (const item of dialItems) {
      item.classList.toggle("action-orb-hidden", !visible);
    }
    if (open && visible) {
      openDialItemsStaggered();
    } else {
      closeDialItemsImmediate();
    }
    if (open && visible) layoutDial();
  }

  function toggle() {
    if (!visible) return;
    open = !open;
    applyState();
  }

  function close() {
    open = false;
    applyState();
  }

  function isOpen() {
    return open && visible;
  }

  function setVisible(nextVisible) {
    visible = Boolean(nextVisible);
    if (!visible) open = false;
    applyState();
  }

  window.addEventListener("resize", () => {
    if (open && visible) layoutDial();
  });

  applyState();

  return {
    toggle,
    close,
    isOpen,
    setVisible,
  };
}
