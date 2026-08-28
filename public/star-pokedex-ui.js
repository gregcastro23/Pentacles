/* ============================================================
   Star Pokédex (DEPRECATED ALIAS → Star-Dex)
   ============================================================
   "Star Pokédex" has been renamed to "Star-Dex".
   This file is maintained as a backwards-compatible bridge.
   Load `/star-dex-ui.js` directly.
   ============================================================ */

(function (global) {
  "use strict";
  // If StarDexUI is already defined, link aliases
  if (global.StarDexUI) {
    global.StarPokedexUI = global.StarDexUI;
    global.openStarPokedex = global.StarDexUI.openStarDex;
    global.closeStarPokedex = global.StarDexUI.closeStarDex;
  }
})(typeof window !== "undefined" ? window : this);
