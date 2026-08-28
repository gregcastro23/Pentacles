/* ============================================================
   My Codex (DEPRECATED ALIAS → My Pentacles)
   ============================================================
   "My Codex" has been renamed to "My Pentacles".
   This file is maintained as a backwards-compatible bridge.
   Import from `./my-pentacles.js` instead.
   ============================================================ */
import MyPentacles, { MyPentaclesInstance, create, version } from "./my-pentacles.js";

export { MyPentaclesInstance as MyCodexInstance, create, version };
export const MyCodex = MyPentacles;
export default MyPentacles;
if (typeof window !== "undefined") {
  window.MyCodex = MyPentacles;
}
