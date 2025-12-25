export const PACK_TAG = "[CornmeisterNL Powerpack]";
export const PACK_VERSION = "0.40";

export function log(msg) {
  console.log(
    `%c${PACK_TAG} v${PACK_VERSION} - ${msg}`,
    "color:#ff00ff;font-weight:bold;text-shadow:0 0 6px rgba(255,0,255,0.85);"
  );
}