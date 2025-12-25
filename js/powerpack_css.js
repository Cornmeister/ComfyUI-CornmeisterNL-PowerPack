import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { log } from "./logger.js";

/**
 * Executing node highlight via HTML overlay (CSS), NOT canvas patches.
 *
 * Why this is stable:
 * - No monkeypatching of LiteGraph draw/drawNode
 * - Overlay moves via lightweight rAF loop only while executing
 * - No per-frame console logging
 *
 * The overlay is a div positioned over the canvas, following the executing node rect.
 */

const SETTINGS = {
  enabled: "CornmeisterNL PowerPack.execCssGlowEnabled",
  strength: "CornmeisterNL PowerPack.execCssGlowStrength", // 1..10
  padding: "CornmeisterNL PowerPack.execCssGlowPadding",   // px
  opacity: "CornmeisterNL PowerPack.execCssGlowOpacity",   // 0.1..1
};

const STATE = {
  executingId: null,
  overlay: null,
  styleEl: null,
  raf: 0,
  lastRectKey: "",
};

function clamp(v, a, b) {
  v = Number(v);
  if (!Number.isFinite(v)) return a;
  return Math.max(a, Math.min(b, v));
}

function getSetting(id, fallback) {
  try {
    return app.extensionManager?.setting?.get(id) ?? fallback;
  } catch {
    return fallback;
  }
}

function ensureStyle() {
  if (STATE.styleEl) return;
  const el = document.createElement("style");
  el.id = "cornmeisternl-powerpack-execglow-style";
  el.textContent = `
    .cornmeisternl-execglow {
      position: absolute;
      pointer-events: none;
      border-radius: 10px;
      transform: translate3d(0,0,0);
      z-index: 9999;
      /* colors come from CSS vars */
      box-shadow:
        0 0 0 2px rgba(0, 255, 156, var(--cmnl-opacity, 0.85)),
        0 0 calc(14px * var(--cmnl-strength, 4)) rgba(0, 255, 156, calc(var(--cmnl-opacity, 0.85) * 0.65)),
        0 0 calc(22px * var(--cmnl-strength, 4)) rgba(0, 255, 156, calc(var(--cmnl-opacity, 0.85) * 0.35));
    }
  `;
  document.head.appendChild(el);
  STATE.styleEl = el;
}

function ensureOverlay() {
  if (STATE.overlay) return;

  ensureStyle();

  const div = document.createElement("div");
  div.className = "cornmeisternl-execglow";
  div.style.display = "none";
  document.body.appendChild(div);
  STATE.overlay = div;
}

function findCanvasRect() {
  // ComfyUI canvas element
  const canvas = document.querySelector("canvas") || app.canvas?.canvas;
  if (!canvas) return null;
  return canvas.getBoundingClientRect();
}

function getNodeById(id) {
  if (id == null) return null;
  const g = app.graph || app?.canvas?.graph;
  if (g && typeof g.getNodeById === "function") return g.getNodeById(id);
  if (g?._nodes) return g._nodes.find(n => n.id === id) || null;
  return null;
}

function graphToScreen(x, y) {
  // LiteGraph/ComfyUI: graph space -> canvas pixel space
  // Using Drag/Scale system (ds)
  const ds = app.canvas?.ds;
  const scale = ds?.scale ?? 1;
  const off = ds?.offset ?? [0, 0];
  const cx = (x + off[0]) * scale;
  const cy = (y + off[1]) * scale;
  return [cx, cy];
}

function updateOverlay() {
  if (!STATE.overlay) return;

  const enabled = !!getSetting(SETTINGS.enabled, true);
  if (!enabled || STATE.executingId == null) {
    STATE.overlay.style.display = "none";
    return;
  }

  const node = getNodeById(STATE.executingId);
  const canvasRect = findCanvasRect();
  if (!node || !canvasRect) {
    STATE.overlay.style.display = "none";
    return;
  }

  const pad = clamp(getSetting(SETTINGS.padding, 10), 0, 40);
  const strength = clamp(getSetting(SETTINGS.strength, 4), 1, 10);
  const opacity = clamp(getSetting(SETTINGS.opacity, 0.85), 0.1, 1.0);

// Node rect in graph space (include title bar)
const x = node.pos?.[0] ?? 0;
const y = node.pos?.[1] ?? 0;
const w = node.size?.[0] ?? 0;
const h = node.size?.[1] ?? 0;
const TITLE_H = (window.LiteGraph && LiteGraph.NODE_TITLE_HEIGHT) ? LiteGraph.NODE_TITLE_HEIGHT : 30;
const yFull = y - TITLE_H;
const hFull = h + TITLE_H;

  // Convert to canvas pixel space
const [cx, cy] = graphToScreen(x, yFull);
const scale = app.canvas?.ds?.scale ?? 1;

const left = canvasRect.left + cx - pad * scale;
const top  = canvasRect.top  + cy - pad * scale;
const width  = (w + pad * 2) * scale;
const height = (hFull + pad * 2) * scale;

  const key = `${Math.round(left)}:${Math.round(top)}:${Math.round(width)}:${Math.round(height)}:${strength}:${opacity}`;
  if (key !== STATE.lastRectKey) {
    STATE.lastRectKey = key;
    STATE.overlay.style.left = `${left}px`;
    STATE.overlay.style.top = `${top}px`;
    STATE.overlay.style.width = `${width}px`;
    STATE.overlay.style.height = `${height}px`;
    STATE.overlay.style.setProperty("--cmnl-strength", String(strength));
    STATE.overlay.style.setProperty("--cmnl-opacity", String(opacity));
  }

  STATE.overlay.style.display = "block";
}

function startRAF() {
  if (STATE.raf) return;
  const tick = () => {
    updateOverlay();
    // Only keep ticking while executing
    if (STATE.executingId != null && !!getSetting(SETTINGS.enabled, true)) {
      STATE.raf = requestAnimationFrame(tick);
    } else {
      STATE.raf = 0;
    }
  };
  STATE.raf = requestAnimationFrame(tick);
}

function stopRAF() {
  if (STATE.raf) cancelAnimationFrame(STATE.raf);
  STATE.raf = 0;
}

function setExecuting(id) {
  STATE.executingId = id;
  ensureOverlay();
  updateOverlay();
  if (id != null) startRAF();
  else {
    stopRAF();
    if (STATE.overlay) STATE.overlay.style.display = "none";
  }
}

function extractNodeId(detail) {
  let nodeId = null;
  const d = detail;
  if (typeof d === "number") nodeId = d;
  else if (typeof d === "string" && d.trim() !== "") nodeId = parseInt(d, 10);
  else if (d && typeof d === "object") nodeId = d.node ?? d.node_id ?? d.nodeId ?? d.current_node ?? null;
  if (nodeId == null) return null;
  const n = parseInt(nodeId, 10);
  return Number.isFinite(n) ? n : null;
}

function hookApiEvents() {
  api.addEventListener("executing", (e) => {
    const id = extractNodeId(e?.detail);
    if (id != null) setExecuting(id);
    else if (e?.detail == null) setExecuting(null);
  });
  api.addEventListener("executed", (e) => {
    const id = extractNodeId(e?.detail);
    if (id != null) setExecuting(id);
  });
  api.addEventListener("execution_end", () => setExecuting(null));
  api.addEventListener("execution_error", () => setExecuting(null));
}

app.registerExtension({
  name: "cornmeisternl.powerpack.executing_glow_css_overlay",

  settings: [
    { id: SETTINGS.enabled,  name: "Enable executing-node glow (CSS overlay)", type: "boolean", defaultValue: true },
    { id: SETTINGS.strength, name: "Glow strength", type: "number", defaultValue: 4, min: 1, max: 10, step: 1 },
    { id: SETTINGS.padding,  name: "Glow padding (px)", type: "number", defaultValue: 10, min: 0, max: 40, step: 1 },
    { id: SETTINGS.opacity,  name: "Glow opacity", type: "number", defaultValue: 0.85, min: 0.1, max: 1.0, step: 0.05 },
  ],

  setup() {
    ensureOverlay();
    hookApiEvents();

    // Keep overlay aligned when window resizes
    window.addEventListener("resize", () => updateOverlay(), { passive: true });

    log("Executing glow (CSS overlay) loaded");
  },
});