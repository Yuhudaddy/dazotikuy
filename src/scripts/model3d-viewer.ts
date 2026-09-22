import { fitModelBounds, pickModelLabel, roomBounds, roomLabel, stageLabels,
  type ModelLayout, type ModelBounds } from "../lib/model3d-layout";

// The self-hosted web component exposes its scene graph after the load event.
// Keep access to that external API here; coordinate calculations are independent.
document.querySelectorAll<HTMLElement>(".model3d-wrap").forEach((wrap) => {
  const mv = wrap.querySelector("model-viewer") as any;
  const toggle = wrap.querySelector<HTMLButtonElement>(".model3d-menu-toggle")!;
  const menu = wrap.querySelector<HTMLElement>(".model3d-menu")!;
  const form = wrap.querySelector<HTMLFormElement>(".model3d-floors");
  const select = form?.querySelector<HTMLSelectElement>("select");
  const info = wrap.querySelector<HTMLElement>(".model3d-pick-info")!;
  const loading = wrap.querySelector<HTMLElement>(".model3d-loading")!;
  const exitButton = wrap.querySelector<HTMLButtonElement>(".model3d-exit")!;
  const button = (action: string) => wrap.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  const lang = wrap.dataset.lang === "ja" ? "ja" : "zh";
  const ui = JSON.parse(wrap.dataset.ui!);
  const initOrbit = mv.getAttribute("camera-orbit");
  const initTarget = mv.getAttribute("camera-target");
  let layout: ModelLayout | null = null;
  let activeView: string | null = "reset";
  let cameraRequest = 0;
  let loaded = !!mv.loaded;
  let transparent = false;
  let oldOverflow = "";
  const originalMaterials = new Map<any, { color: number[]; alphaMode: string }>();

  const setMenu = (open: boolean, restoreFocus = false) => {
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (!open && form) {
      form.hidden = true;
      button("floors")?.setAttribute("aria-expanded", "false");
    }
    if (restoreFocus) toggle.focus({ preventScroll: true });
  };
  toggle.addEventListener("click", () => setMenu(Boolean(menu.hidden)));
  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !wrap.querySelector(".model3d-controls")!.contains(event.target as Node)) setMenu(false);
  });
  wrap.addEventListener("focusout", (event) => {
    if (!wrap.querySelector(".model3d-controls")!.contains(event.relatedTarget as Node)) setMenu(false);
  });
  button("floors")?.addEventListener("click", () => {
    if (!form) return;
    form.hidden = !form.hidden;
    button("floors")!.setAttribute("aria-expanded", String(!form.hidden));
    if (!form.hidden) select?.focus();
  });

  const showPicked = (label: string | null) => {
    info.textContent = label ? info.dataset.pickedTpl!.replace("{name}", label) : info.dataset.hint!;
    info.classList.toggle("is-picked", !!label);
  };

  const setView = async (view: string) => {
    activeView = view;
    const request = ++cameraRequest;
    if (!loaded) return;
    // Scroll/pinch changes the camera's FOV without changing the attribute.
    // Request an update even when the authored 30deg value is already present.
    mv.fieldOfView = "30deg";
    mv.requestUpdate("fieldOfView");
    await mv.updateComplete;
    if (request !== cameraRequest) return;
    mv.jumpCameraToGoal();
    let bounds: ModelBounds | undefined;
    let theta = 0, phi = 0;
    if (layout && view === "reset") bounds = layout.resetBounds;
    if (layout && view === "overview") { bounds = layout.overviewBounds; phi = 25; }
    const room = layout?.rooms.find(r => r.id === view);
    if (room) {
      bounds = roomBounds(room);
      theta = room.floating ? 24 : 0;
      phi = room.floating ? 65 : 38;
      showPicked(roomLabel(room, lang));
    } else showPicked(null);
    if (bounds) {
      const rect = mv.getBoundingClientRect();
      const aspect = rect.width / Math.max(1, rect.height);
      // getFieldOfView() still reports the animated value until the next frame.
      // Fit against the 30deg goal, with model-viewer's documented aspect correction.
      const goalFov = 2 * Math.atan(Math.tan(Math.PI / 12) * Math.max(1, mv.getIdealAspect() / aspect)) * 180 / Math.PI;
      const framing = fitModelBounds(bounds, aspect, goalFov, theta, phi);
      mv.cameraOrbit = framing.orbit;
      mv.cameraTarget = framing.target;
    } else {
      mv.cameraOrbit = initOrbit;
      mv.cameraTarget = initTarget;
    }
    await mv.updateComplete;
    if (request === cameraRequest && matchMedia("(prefers-reduced-motion: reduce)").matches) mv.jumpCameraToGoal();
  };
  for (const action of ["reset", "overview"]) button(action)?.addEventListener("click", () => {
    void setView(action);
    setMenu(false, true);
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (select?.value) void setView(select.value);
    setMenu(false, true);
  });
  mv.addEventListener("camera-change", (event: any) => {
    if (event.detail.source === "user-interaction") { activeView = null; ++cameraRequest; }
  });
  let resizeFrame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { if (activeView && loaded) void setView(activeView); });
  }).observe(mv);

  const transparencyNames = wrap.dataset.transparencyMaterials?.split(",") ?? [];
  const onLoad = () => {
    loaded = true;
    loading.hidden = true;
    wrap.querySelector<HTMLElement>(".model3d-progress")!.hidden = true;
    mv.dismissPoster();
    originalMaterials.clear();
    for (const material of mv.model?.materials ?? []) {
      if (transparencyNames.includes(material.name)) originalMaterials.set(material, {
        color: [...material.pbrMetallicRoughness.baseColorFactor], alphaMode: material.getAlphaMode(),
      });
    }
    if (button("transparency")) button("transparency")!.disabled = !originalMaterials.size;
    transparent = false;
    button("transparency")?.setAttribute("aria-pressed", "false");
    if (activeView) void setView(activeView);
  };
  mv.addEventListener("load", onLoad);
  if (loaded) onLoad();
  mv.addEventListener("error", () => { loading.hidden = false; loading.textContent = ui.error; });
  mv.addEventListener("progress", (event: any) => {
    mv.style.setProperty("--progress", String(event.detail.totalProgress));
  });
  button("transparency")?.addEventListener("click", () => {
    transparent = !transparent;
    for (const [material, original] of originalMaterials) {
      const color = [...original.color];
      if (transparent) color[3] = Number(wrap.dataset.transparencyOpacity);
      material.pbrMetallicRoughness.setBaseColorFactor(color);
      material.setAlphaMode(transparent ? "BLEND" : original.alphaMode);
    }
    button("transparency")!.setAttribute("aria-pressed", String(transparent));
  });

  const isFullscreen = () => document.fullscreenElement === wrap || wrap.classList.contains("is-fullscreen");
  const updateFullscreen = () => {
    const full = isFullscreen();
    exitButton.hidden = !full;
    button("fullscreen")!.setAttribute("aria-pressed", String(full));
    button("fullscreen")!.querySelector("span")!.textContent = full ? ui.exitFullscreen : ui.fullscreen;
  };
  const leaveFullscreen = async () => {
    if (document.fullscreenElement === wrap) await document.exitFullscreen();
    if (wrap.classList.contains("is-fullscreen")) {
      wrap.classList.remove("is-fullscreen");
      document.documentElement.style.overflow = oldOverflow;
    }
    updateFullscreen();
    toggle.focus({ preventScroll: true });
  };
  button("fullscreen")!.addEventListener("click", async () => {
    setMenu(false);
    if (isFullscreen()) { await leaveFullscreen(); return; }
    if (wrap.requestFullscreen && document.fullscreenEnabled) {
      try { await wrap.requestFullscreen(); } catch { /* Safari / embedded-browser fallback below. */ }
    }
    if (document.fullscreenElement !== wrap) {
      oldOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
      wrap.classList.add("is-fullscreen");
    }
    updateFullscreen();
    exitButton.focus({ preventScroll: true });
  });
  exitButton.addEventListener("click", () => void leaveFullscreen());
  document.addEventListener("fullscreenchange", () => {
    updateFullscreen();
    if (!document.fullscreenElement && wrap.contains(document.activeElement)) toggle.focus({ preventScroll: true });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!menu.hidden) { event.preventDefault(); setMenu(false, true); }
      else if (isFullscreen()) { event.preventDefault(); void leaveFullscreen(); }
    }
    // Keep keyboard focus within the expanded viewer in the CSS fallback too.
    if (event.key === "Tab" && isFullscreen()) {
      const focusable = [...wrap.querySelectorAll<HTMLElement>("button:not(:disabled), select, model-viewer")]
        .filter(el => !el.closest("[hidden]"));
      const first = focusable[0], last = focusable.at(-1);
      const active = document.activeElement;
      if (event.shiftKey && active === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus(); }
    }
  });

  if (wrap.dataset.layoutSrc) fetch(wrap.dataset.layoutSrc).then(async response => {
    if (!response.ok) throw new Error("Layout unavailable");
    const data: ModelLayout = await response.json();
    if (data.version !== 2 || !data.rooms?.length) throw new Error("Layout version mismatch");
    layout = data;
    if (select) {
      for (const stage of ["beginner", "middle", "final"] as const) {
        const group = document.createElement("optgroup");
        group.label = stageLabels[lang][stage];
        for (const room of data.rooms.filter(r => r.stage === stage)) {
          group.append(new Option(roomLabel(room, lang), room.id));
        }
        select.append(group);
      }
    }
    button("floors")!.disabled = false;
    button("overview")!.disabled = false;
    if (loaded && activeView) void setView(activeView);
  }).catch(() => { info.textContent = ui.layoutError; });

  // A drag or a two-finger gesture is navigation, not a request to pick a room.
  let pointerStart: { x: number; y: number } | null = null;
  let dragged = false;
  const pointers = new Set<number>();
  mv.addEventListener("pointerdown", (event: PointerEvent) => {
    pointers.add(event.pointerId);
    if (pointers.size === 1) { pointerStart = { x: event.clientX, y: event.clientY }; dragged = false; }
    else dragged = true;
  });
  mv.addEventListener("pointermove", (event: PointerEvent) => {
    if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 6) dragged = true;
  });
  for (const eventName of ["pointerup", "pointercancel"]) document.addEventListener(eventName, (event) => {
    pointers.delete((event as PointerEvent).pointerId);
    if (!pointers.size) pointerStart = null;
  });
  mv.addEventListener("click", (event: MouseEvent) => {
    if (!layout || dragged) return;
    const hit = mv.positionAndNormalFromPoint(event.clientX, event.clientY);
    showPicked(hit ? pickModelLabel(layout, [hit.position.x, hit.position.y, hit.position.z], lang) : null);
  });
});
