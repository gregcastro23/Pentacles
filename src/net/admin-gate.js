/* ============================================================
   Pentacles — Canonical Admin & Owner Identity Gate
   ============================================================ */

export const ADMIN_EMAIL = "gregcastro23@gmail.com";
export const ADMIN_KEY = "pentacles_admin";

let _ownerUnlocked = false;

export function sameIdentity(a, b) {
  if (!a || !b) return false;
  const cleanA = String(a).replace(/^0x/, "").toLowerCase().trim();
  const cleanB = String(b).replace(/^0x/, "").toLowerCase().trim();
  return cleanA === cleanB;
}

export function isAdmin(identity = null, player = null, config = null) {
  if (_ownerUnlocked) return true;

  if (player && (player.is_admin || player.role === "admin" || player.role === "owner")) {
    return true;
  }

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

  if (typeof window !== "undefined") {
    if (window.Pentacles?.isAdmin || window.__IS_ADMIN__) return true;

    try {
      // Check query param ?admin=
      if (typeof location !== "undefined" && location.search) {
        const qp = new URLSearchParams(location.search);
        if (qp.has("admin")) {
          const val = (qp.get("admin") || "").trim().toLowerCase();
          if (val === ADMIN_EMAIL || val === "true" || val === "1") {
            try { localStorage.setItem(ADMIN_KEY, ADMIN_EMAIL); } catch {}
            return true;
          }
        }
      }

      // Check localStorage & sessionStorage (supports email, "true", or "1")
      const stored = localStorage.getItem(ADMIN_KEY) || sessionStorage.getItem(ADMIN_KEY);
      if (stored) {
        const clean = stored.trim().toLowerCase();
        if (clean === ADMIN_EMAIL || clean === "true" || clean === "1") return true;
      }
    } catch {}
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

  let entered = null;
  if (typeof window !== "undefined" && typeof window.prompt === "function") {
    try {
      entered = window.prompt("Admin email to unlock The Observatory:");
    } catch {}
  }

  if (entered && entered.trim().toLowerCase() === ADMIN_EMAIL) {
    try {
      localStorage.setItem(ADMIN_KEY, ADMIN_EMAIL);
    } catch {}
    _ownerUnlocked = true;
    if (typeof onUnlock === "function") onUnlock();
    if (typeof window !== "undefined" && window.toast) {
      window.toast("The Observatory unlocked.", { type: "success", title: "Admin Access" });
    }
    return true;
  }

  if (entered != null && typeof window !== "undefined" && window.toast) {
    window.toast("Not authorized for the admin console.", { type: "error", title: "The Observatory" });
  }
  return false;
}

export default {
  ADMIN_EMAIL,
  ADMIN_KEY,
  sameIdentity,
  isAdmin,
  verifyOwnerIdentity,
  ensureAdmin,
};
