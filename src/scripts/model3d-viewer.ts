import { fitModelBounds, formatBom, parseBomField, pickModelLabel, pointBounds, roomBounds, roomLabel,
  stageLabels, type ModelLayout, type ModelBounds, type ModelPoint } from "../lib/model3d-layout";

// The self-hosted web component exposes its scene graph after the load event.
// Keep access to that external API here; coordinate calculations are independent.
document.querySelectorAll<HTMLElement>(".model3d-wrap").forEach((wrap) => {
  const mv = wrap.querySelector("model-viewer") as any;
  const toggle = wrap.querySelector<HTMLButtonElement>(".model3d-menu-toggle")!;
  const menu = wrap.querySelector<HTMLElement>(".model3d-menu")!;
  const form = wrap.querySelector<HTMLFormElement>('[data-panel="floors"]');
  const select = form?.querySelector<HTMLSelectElement>("select");
  const coordsForm = wrap.querySelector<HTMLFormElement>('[data-panel="coords"]');
  const coordsFields = [...coordsForm?.querySelectorAll<HTMLInputElement>("input") ?? []];
  const pin = wrap.querySelector<HTMLElement>(".model3d-pin")!;
  const info = wrap.querySelector<HTMLElement>(".model3d-pick-info")!;
  const loading = wrap.querySelector<HTMLElement>(".model3d-loading")!;
  const exitButton = wrap.querySelector<HTMLButtonElement>(".model3d-exit")!;
  const button = (action: string) => wrap.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  const lang = wrap.dataset.lang === "ja" ? "ja" : "zh";
  const ui = JSON.parse(wrap.dataset.ui!);
  const initOrbit = mv.getAttribute("camera-orbit");
  const initTarget = mv.getAttribute("camera-target");
  let layout: ModelLayout | null = null;
  let activeView: string | ModelPoint | null = "reset"; // named view, room id, or a typed point
  let cameraRequest = 0;
  let loaded = !!mv.loaded;
  let transparent = false;
  let oldOverflow = "";
  const originalMaterials = new Map<any, { color: number[]; alphaMode: string }>();

  // Menu items with aria-controls expand a panel below them; at most one panel is open.
  const expanders = [...menu.querySelectorAll<HTMLButtonElement>("[data-action][aria-controls]")]
    .map(trigger => ({ trigger, panel: document.getElementById(trigger.getAttribute("aria-controls")!)! }));
  const expand = (open: HTMLElement | null) => {
    for (const { trigger, panel } of expanders) {
      panel.hidden = panel !== open;
      trigger.setAttribute("aria-expanded", String(panel === open));
    }
    open?.querySelector<HTMLElement>("select, input")?.focus();
  };
  const setMenu = (open: boolean, restoreFocus = false) => {
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (!open) expand(null);
    if (restoreFocus) toggle.focus({ preventScroll: true });
  };
  toggle.addEventListener("click", () => setMenu(Boolean(menu.hidden)));
  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !wrap.querySelector(".model3d-controls")!.contains(event.target as Node)) setMenu(false);
  });
  wrap.addEventListener("focusout", (event) => {
    // A null relatedTarget means focus went nowhere in particular (browsers that do not focus a
    // clicked button, window blur); clicks are already judged by the pointerdown handler above.
    const next = event.relatedTarget as Node | null;
    if (next && !wrap.querySelector(".model3d-controls")!.contains(next)) setMenu(false);
  });
  for (const { trigger, panel } of expanders) trigger.addEventListener("click", () => {
    expand(panel.hidden ? panel : null);
  });

  // The pin is a model-viewer hotspot: it tracks the model and dims when the model occludes it.
  const setInfo = (text: string | null, point: ModelPoint | null = null) => {
    info.textContent = text ?? info.dataset.hint!;
    info.classList.toggle("is-picked", text !== null);
    if (point) mv.updateHotspot({ name: "hotspot-pin", position: point.join(" ") });
    pin.hidden = !point;
  };
  const showPicked = (label: string | null, point: ModelPoint | null = null) => {
    const text = [label, point && formatBom(point)].filter(Boolean).join("・");
    setInfo(text ? info.dataset.pickedTpl!.replace("{name}", text) : null, point);
  };
  const pinPoint = (point: ModelPoint) => showPicked(layout && pickModelLabel(layout, point, lang), point);
  const hitPoint = (clientX: number, clientY: number): ModelPoint | null => {
    const hit = mv.positionAndNormalFromPoint(clientX, clientY);
    return hit && [hit.position.x, hit.position.y, hit.position.z];
  };

  // Named views only move the camera; room and point views also select what they show.
  const setView = async (view: string | ModelPoint) => {
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
    } else if (Array.isArray(view)) {
      bounds = pointBounds(view);
      phi = 38;
      pinPoint(view);
    }
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
    showPicked(null);
    void setView(action);
    setMenu(false, true);
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (select?.value) void setView(select.value);
    setMenu(false, true);
  });

  // Height of the topmost surface at (x, z): jump the camera straight above it and cast through
  // the viewport centre. No frame renders in between, so a miss restores the view unnoticed and
  // a hit lets the glide to the final view start overhead.
  const surfaceHeight = async (x: number, z: number) => {
    ++cameraRequest;
    const orbit = mv.getCameraOrbit().toString(), target = mv.getCameraTarget().toString();
    mv.cameraTarget = `${x}m 3m ${z}m`;
    mv.cameraOrbit = "0deg 0deg 60m";
    mv.jumpCameraToGoal();
    await mv.updateComplete;
    const rect = mv.getBoundingClientRect();
    const hit = hitPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    if (hit) return hit[1];
    mv.cameraOrbit = orbit;
    mv.cameraTarget = target;
    mv.jumpCameraToGoal();
    return null;
  };
  for (const field of coordsFields) {
    field.addEventListener("input", () => field.setCustomValidity(""));
    // A row copied from the sheet ("x⇥y⇥z") pasted into any field fills all three.
    field.addEventListener("paste", (event) => {
      const parts = event.clipboardData?.getData("text").trim().split(/[,，\t\s()（）]+/).filter(Boolean) ?? [];
      if (parts.length < 2 || parts.length > 3) return;
      event.preventDefault();
      const [x, y, z] = parts.length === 2 ? [parts[0], "", parts[1]] : parts;
      coordsFields.forEach((f, i) => { f.value = [x, y, z][i]; f.setCustomValidity(""); });
    });
  }
  coordsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = coordsFields.map(f => parseBomField(f.value));
    const junk = values.indexOf(undefined);
    if (junk !== -1) {
      coordsFields[junk].setCustomValidity(ui.coordsInvalid);
      coordsFields[junk].reportValidity();
      return;
    }
    const [x, y, z] = values as [number, number | null, number]; // x and z are required fields
    setMenu(false, true);
    const height = y ?? await surfaceHeight(x, z);
    if (height === null) setInfo(ui.coordsNoSurface);
    else void setView([x, height, z]);
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
    button("coords")?.removeAttribute("disabled");
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
      else if (!pin.hidden && wrap.contains(document.activeElement)) showPicked(null);
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
    if (dragged || !loaded) return;
    const point = hitPoint(event.clientX, event.clientY);
    if (point) pinPoint(point); else showPicked(null);
  });
});
