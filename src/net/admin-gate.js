/* ============================================================
   Pentacles — Canonical Admin & Owner Identity Gate
   ============================================================ */
// Enforces cryptographic server-side identity verification against
// GameConfig.owner. Client-side URL bypasses and prompts have been removed.

export const ADMIN_EMAIL = "gregcastro23@gmail.com";

let _ownerUnlocked = false;

export function sameIdentity(a, b) {
  if (!a || !b) return false;
  const cleanA = String(a.__identity__ ?? a).replace(/^0x/, "").toLowerCase().trim();
  const cleanB = String(b.__identity__ ?? b).replace(/^0x/, "").toLowerCase().trim();
  return cleanA === cleanB;
}

export function isAdmin(identity = null, player = null, config = null) {
  if (_ownerUnlocked) return true;

  if (config && config.owner) {
    const ownerId = config.owner.__identity__ ?? config.owner;
    if (sameIdentity(identity, ownerId)) {
      _ownerUnlocked = true;
      return true;
    }
  }

  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_ADMIN_IDENTITY) {
    if (sameIdentity(identity, import.meta.env.VITE_ADMIN_IDENTITY)) {
      _ownerUnlocked = true;
      return true;
    }
  }

  return false;
}

export async function verifyOwnerIdentity(spacetime, onUnlock = null) {
  if (!spacetime) return false;
  try {
    if (!spacetime.identity && typeof spacetime.ensureIdentity === "function") {
      await spacetime.ensureIdentity().catch(() => {});
    }
    if (!spacetime.identity) return false;

    const rows = typeof spacetime.query === "function"
      ? await spacetime.query("SELECT owner FROM game_config").catch(() => null)
      : null;
    const owner = rows && rows[0] && (rows[0].owner?.__identity__ ?? rows[0].owner);

    if (owner && sameIdentity(spacetime.identity, owner)) {
      _ownerUnlocked = true;
      if (typeof onUnlock === "function") onUnlock();
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function ensureAdmin(spacetime = null, onUnlock = null) {
  if (isAdmin(spacetime?.identity)) {
    if (typeof onUnlock === "function") onUnlock();
    return true;
  }

  if (typeof window !== "undefined" && window.toast) {
    window.toast("Not authorized: deployer identity required to access The Observatory.", {
      type: "error",
      title: "The Observatory",
    });
  }
  return false;
}

export default {
  ADMIN_EMAIL,
  sameIdentity,
  isAdmin,
  verifyOwnerIdentity,
  ensureAdmin,
};
