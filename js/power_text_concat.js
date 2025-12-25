import { app } from "../../scripts/app.js";
import { log } from "./logger.js";

log("Power Text Concat extension loaded");

function isTextInput(input) {
  return input && typeof input.name === "string" && input.name.startsWith("text_");
}
function textInputs(node) {
  return node.inputs?.filter(isTextInput) ?? [];
}
function ensureTriggerAndText1(node) {
  if (!node.inputs) node.inputs = [];
  const hasTrigger = node.inputs.some(i => i.name === "trigger");
  if (!hasTrigger) {
    node.addInput("trigger", "STRING");
    const idx = node.inputs.findIndex(i => i.name === "trigger");
    if (idx > 0) {
      const [it] = node.inputs.splice(idx, 1);
      node.inputs.unshift(it);
    }
  }
  if (!node.inputs.some(i => i.name === "text_1")) node.addInput("text_1", "STRING");
}
function nextTextName(node) {
  const inputs = textInputs(node);
  return `text_${inputs.length + 1}`;
}
function lastTextConnected(node) {
  const inputs = textInputs(node);
  if (!inputs.length) return false;
  return !!inputs[inputs.length - 1].link;
}
function trailingEmptyTextCount(node) {
  const inputs = textInputs(node);
  let c = 0;
  for (let i = inputs.length - 1; i >= 0; i--) {
    if (inputs[i].link) break;
    c++;
  }
  return c;
}
function addText(node) { node.addInput(nextTextName(node), "STRING"); }
function removeLastText(node) {
  const inputs = textInputs(node);
  if (inputs.length <= 1) return;
  const last = inputs[inputs.length - 1];
  const idx = node.inputs.findIndex(i => i === last);
  if (idx >= 0) node.removeInput(idx);
}
function cleanLabel(s) {
  if (!s) return "";
  s = String(s).trim().replace(/\s+/g, " ");
  if (s.length > 40) s = s.slice(0, 40) + "…";
  return s;
}
function updateTriggerLabel(node) {
  const trigInput = node.inputs?.find(i => i.name === "trigger");
  if (!trigInput) return;
  trigInput.label = "trigger";

  try {
    const linkId = trigInput.link;
    if (!linkId) return;
    const link = app.graph.links[linkId];
    if (!link) return;
    const originNode = app.graph.getNodeById(link.origin_id);
    if (!originNode) return;

    const w = originNode.widgets?.find(w => w.name === "trigger");
    if (w && w.value) {
      const lbl = cleanLabel(w.value);
      if (lbl) trigInput.label = lbl;
      return;
    }
    const t = cleanLabel(originNode.title);
    if (t && t !== "Power LoRA Configurator") trigInput.label = t;
  } catch {}
}

app.registerExtension({
  name: "cornmeisternl.powerpack.power_text_concat",
  async nodeCreated(node) {
    if (node.comfyClass !== "CornmeisterNL_PowerTextConcat") return;

    ensureTriggerAndText1(node);
    updateTriggerLabel(node);

    const orig = node.onConnectionsChange;
    node.onConnectionsChange = function(type, slotIndex, connected, linkInfo, ioSlot) {
      if (orig) orig.call(this, type, slotIndex, connected, linkInfo, ioSlot);
      if (type !== 1) return;

      ensureTriggerAndText1(node);
      if (lastTextConnected(node)) addText(node);
      while (trailingEmptyTextCount(node) > 1) removeLastText(node);

      updateTriggerLabel(node);
      node.setDirtyCanvas(true, true);
    };

    const origConfigure = node.onConfigure;
    node.onConfigure = function(info) {
      if (origConfigure) origConfigure.call(this, info);
      ensureTriggerAndText1(node);
      if (lastTextConnected(node)) addText(node);
      while (trailingEmptyTextCount(node) > 1) removeLastText(node);
      updateTriggerLabel(node);
    };
  }
});