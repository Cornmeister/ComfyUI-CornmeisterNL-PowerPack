import { app } from "../../scripts/app.js";
import { log } from "./logger.js";

log("Power LoRA Selector extension loaded");


function ensureActiveCombo(node) {
  if (!node.widgets) return;
  const w = node.widgets.find(w => w.name === "active");
  if (!w) return;

  // If it's not a combo, replace it with a combo widget.
  if (w.type !== "combo") {
    const idx = node.widgets.indexOf(w);
    const cur = (w.value ?? "1").toString();
    if (idx >= 0) node.widgets.splice(idx, 1);

    node.addWidget(
      "combo",
      "active",
      cur,
      (v) => { /* value stored on widget */ },
      { values: ["1: (connect a cfg)"] }
    );
  }
}


function isCfgInput(input) {
  return input && typeof input.name === "string" && input.name.startsWith("cfg_");
}
function cfgInputs(node) {
  return node.inputs?.filter(isCfgInput) ?? [];
}
function nextCfgName(node) {
  const inputs = cfgInputs(node);
  return `cfg_${inputs.length + 1}`;
}
function updateActiveDropdown(node) {
  ensureActiveCombo(node);
  const w = node.widgets?.find(w => w.name === "active");
  if (!w) return;

  w.options = w.options || {};

  // Only list connected cfg inputs
  const cfgs = cfgInputs(node).filter(inp => !!inp.link);

  const labels = [];
  for (const inp of cfgs) {
    const n = parseInt(inp.name.split("_")[1] || "1", 10);
    const idx = isNaN(n) ? 1 : n;

    let lbl = (inp.label && String(inp.label).trim()) ? String(inp.label).trim() : `cfg_${idx}`;
    lbl = `${idx}: ${lbl}`;
    labels.push(lbl);
  }
  if (!labels.length) labels.push("1: (connect a cfg)");

  w.options.values = labels;

  const cur = (w.value ?? "").toString();
  if (!labels.includes(cur)) {
    // try map numeric -> "n: ..."
    const s = cur.includes(":") ? cur.split(":", 1)[0] : cur;
    const n = parseInt(s, 10);
    const match = labels.find(x => x.startsWith((isNaN(n) ? "1" : String(n)) + ":"));
    w.value = match || labels[0];
  }
}
function ensureAtLeastOneCfg(node) {
  if (!node.inputs) node.inputs = [];
  const cfgs = cfgInputs(node);
  if (cfgs.length === 0) {
    node.addInput("cfg_1", "LORA_CFG");
  } else if (cfgs[0].name !== "cfg_1") {
    cfgs.forEach((inp, idx) => (inp.name = `cfg_${idx + 1}`));
  }
}
function lastCfgConnected(node) {
  const cfgs = cfgInputs(node);
  if (!cfgs.length) return false;
  return !!cfgs[cfgs.length - 1].link;
}
function trailingEmptyCount(node) {
  const cfgs = cfgInputs(node);
  let c = 0;
  for (let i = cfgs.length - 1; i >= 0; i--) {
    if (cfgs[i].link) break;
    c++;
  }
  return c;
}
function addCfg(node) {
  node.addInput(nextCfgName(node), "LORA_CFG");
}
function removeLastCfg(node) {
  const cfgs = cfgInputs(node);
  if (cfgs.length <= 1) return;
  const lastIndex = node.inputs.findIndex(inp => inp === cfgs[cfgs.length - 1]);
  if (lastIndex >= 0) node.removeInput(lastIndex);
}

function cleanLabel(s) {
  if (!s) return "";
  s = String(s).trim().replace(/\s+/g, " ");
  if (s.length > 40) s = s.slice(0, 40) + "…";
  return s;
}

function updateCfgLabels(node) {
  const cfgs = cfgInputs(node);
  for (const inp of cfgs) {
    // default
    inp.label = inp.name;
    try {
      const linkId = inp.link;
      if (!linkId) continue;
      const link = app.graph.links[linkId];
      if (!link) continue;
      const originNode = app.graph.getNodeById(link.origin_id);
      if (!originNode) continue;

      // If origin has a trigger widget, use it
      const w = originNode.widgets?.find(w => w.name === "trigger");
      if (w && w.value) {
        const lbl = cleanLabel(w.value);
        if (lbl) inp.label = lbl;
        continue;
      }
      // fallback to title (our configurator sets title to trigger)
      const t = cleanLabel(originNode.title);
      if (t && t !== "Power LoRA Configurator") inp.label = t;
    } catch {}
  }
}

app.registerExtension({
  name: "cornmeisternl.powerpack.power_lora_selector",
  async nodeCreated(node) {
    if (node.comfyClass !== "CornmeisterNL_PowerLoraSelector") return;

    ensureAtLeastOneCfg(node);
    updateCfgLabels(node);
    ensureActiveCombo(node);
    updateActiveDropdown(node);

    const orig = node.onConnectionsChange;
    node.onConnectionsChange = function(type, slotIndex, connected, linkInfo, ioSlot) {
      if (orig) orig.call(this, type, slotIndex, connected, linkInfo, ioSlot);
      if (type !== 1) return;

      ensureAtLeastOneCfg(node);
      if (lastCfgConnected(node)) addCfg(node);
      while (trailingEmptyCount(node) > 1) removeLastCfg(node);

      ensureActiveCombo(node);
      updateCfgLabels(node);
      ensureActiveCombo(node);
      updateActiveDropdown(node);
      node.setDirtyCanvas(true, true);
    };


    // Live refresh labels (handles trigger edits after connections)
    node.onDrawForeground = function(ctx) {
      const now = Date.now();
      if (!this._pp_last_refresh) this._pp_last_refresh = 0;
      if (now - this._pp_last_refresh < 250) return;
      this._pp_last_refresh = now;
      updateCfgLabels(this);
      updateActiveDropdown(this);
    };

    const origConfigure = node.onConfigure;
    node.onConfigure = function(info) {
      if (origConfigure) origConfigure.call(this, info);

      ensureAtLeastOneCfg(node);
      if (lastCfgConnected(node)) addCfg(node);
      while (trailingEmptyCount(node) > 1) removeLastCfg(node);

      ensureActiveCombo(node);
      updateCfgLabels(node);
      ensureActiveCombo(node);
      updateActiveDropdown(node);
    };
  }
});