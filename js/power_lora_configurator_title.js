import { app } from "../../scripts/app.js";
import { log } from "./logger.js";

log("Power LoRA Configurator title-sync extension loaded");

function cleanName(s) {
  if (!s) return "";
  s = String(s).trim().replace(/\s+/g, " ");
  if (s.length > 40) s = s.slice(0, 40) + "…";
  return s;
}

function setNodeTitle(node, triggerValue) {
  const t = cleanName(triggerValue);
  node.title = t ? t : "Power LoRA Configurator";
}

app.registerExtension({
  name: "cornmeisternl.powerpack.power_lora_configurator_title",
  async nodeCreated(node) {
    if (node.comfyClass !== "CornmeisterNL_PowerLoraConfigurator") return;

    const wTrig = node.widgets?.find(w => w.name === "trigger");
    if (!wTrig) return;

    setNodeTitle(node, wTrig.value);

    const origCb = wTrig.callback;
    wTrig.callback = (v) => {
      setNodeTitle(node, v);
      if (origCb) origCb(v);
      node.setDirtyCanvas(true, true);
    };

    const origConfigure = node.onConfigure;
    node.onConfigure = function(info) {
      if (origConfigure) origConfigure.call(this, info);
      const w = node.widgets?.find(w => w.name === "trigger");
      setNodeTitle(node, w?.value);
    };
  }
});