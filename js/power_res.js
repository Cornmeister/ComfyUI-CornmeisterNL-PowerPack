import { app } from "../../scripts/app.js";
import { log } from "./logger.js";

function getComboValues(widget) {
  // Combo widget values vary between ComfyUI/LiteGraph versions
  const v = widget?.options?.values ?? widget?.options?.values_list ?? widget?.options?.items ?? widget?.options;
  return Array.isArray(v) ? v : [];
}

function fixInvalidPreset(node) {
  const wPreset = node.widgets?.find(w => w.name === "preset");
  if (!wPreset) return;

  const values = getComboValues(wPreset);
  if (!values.length) return;

  const cur = wPreset.value;
  if (cur == null || !values.includes(cur)) {
    wPreset.value = values[0];
    app.canvas?.setDirty(true, true);
  }
}

function updateTitle(node) {
  try {
    const wPreset = node.widgets?.find(w => w.name === "preset");
    const wOverride = node.widgets?.find(w => w.name === "manual_override");
    const wW = node.widgets?.find(w => w.name === "width");
    const wH = node.widgets?.find(w => w.name === "height");

    const base = "Power Res";
    let suffix = "";

    if (wOverride?.value) {
      const ww = wW?.value ?? "";
      const hh = wH?.value ?? "";
      suffix = `Manual ${ww}×${hh}`;
    } else {
      const p = wPreset?.value ?? "";
      suffix = p ? String(p) : "";
    }

    const title = suffix ? `${base} (${suffix})` : base;
    if (node.title !== title) {
      node.title = title;
      app.canvas?.setDirty(true, true);
    }
  } catch {}
}

app.registerExtension({
  name: "cornmeisternl.powerpack.power_res_title",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "CornmeisterNL_PowerRes") return;

    const origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = origCreated?.apply(this, arguments);
      setTimeout(() => { fixInvalidPreset(this); fixInvalidPreset(this); updateTitle(this); }, 0);

      const hook = () => {
        if (!this.widgets) return;
        for (const w of this.widgets) {
          const old = w.callback;
          w.callback = (...args) => {
            const rr = old?.apply(this, args);
            fixInvalidPreset(this); updateTitle(this);
            return rr;
          };
        }
      };
      hook();
      return r;
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = origConfigure?.apply(this, arguments);
      setTimeout(() => { fixInvalidPreset(this); fixInvalidPreset(this); updateTitle(this); }, 0);
      return r;
    };

    log("Power Res title hook loaded");
  },
});
