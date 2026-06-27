/* ============================================================
   PENTACLES — Authentication & Profile Cookie Sync
   ============================================================
   Allows sharing active seeker profiles, SpacetimeDB tokens,
   and wallet connection preferences across subdomains of
   alchm.kitchen (SSO / streamlined cross-project login).
   ============================================================ */

(function () {
  "use strict";

  const COOKIE_KEYS = [
    "pentacles_stdb_token",
    "pentacles_wallet_reconnect",
    "pentacles_active_profile",
    "pentacles_profiles_list"
  ];

  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
      try {
        return decodeURIComponent(parts.pop().split(";").shift());
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  function setCookie(name, value, days = 365) {
    let expires = "";
    if (days) {
      const date = new Date();
      date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
      expires = `; expires=${date.toUTCString()}`;
    }
    let domain = "";
    const hostname = window.location.hostname;
    if (hostname.endsWith(".alchm.kitchen")) {
      domain = "; domain=.alchm.kitchen";
    } else if (hostname === "alchm.kitchen") {
      domain = "; domain=alchm.kitchen";
    }
    const safeVal = encodeURIComponent(value || "");
    document.cookie = `${name}=${safeVal}${expires}; path=/${domain}; SameSite=Lax; Secure`;
  }

  // Sync cookies -> localStorage (Run early on page load)
  function syncCookiesToLocalStorage() {
    let restoredAny = false;

    // 1. Restore standard session keys
    COOKIE_KEYS.forEach(key => {
      const cookieVal = getCookie(key);
      const localVal = localStorage.getItem(key);

      if (cookieVal && cookieVal !== localVal) {
        localStorage.setItem(key, cookieVal);
        restoredAny = true;
      }
    });

    // 2. Restore active profile save if stored in cookie and missing from localStorage
    const activeProfile = getCookie("pentacles_active_profile") || localStorage.getItem("pentacles_active_profile");
    if (activeProfile) {
      const saveKey = `pentacles_save_${activeProfile}`;
      const cookieSave = getCookie(saveKey);
      const localSave = localStorage.getItem(saveKey);

      if (cookieSave && cookieSave !== localSave) {
        localStorage.setItem(saveKey, cookieSave);
        restoredAny = true;
      }
    }

    return restoredAny;
  }

  // Sync localStorage -> cookies (Run after changes)
  function syncLocalStorageToCookies() {
    // 1. Sync standard session keys
    COOKIE_KEYS.forEach(key => {
      const localVal = localStorage.getItem(key);
      if (localVal !== null) {
        setCookie(key, localVal);
      }
    });

    // 2. Sync the active profile's actual save data if it fits in a cookie (< 3.8KB)
    const activeProfile = localStorage.getItem("pentacles_active_profile");
    if (activeProfile) {
      const saveKey = `pentacles_save_${activeProfile}`;
      const localSave = localStorage.getItem(saveKey);
      if (localSave) {
        if (localSave.length < 3800) {
          setCookie(saveKey, localSave);
        }
      }
    }
  }

  // Export to global scope
  window.CookieSync = {
    getCookie,
    setCookie,
    restore: syncCookiesToLocalStorage,
    persistAll: syncLocalStorageToCookies,
    persist: function (key, val) {
      if (val === null || val === undefined) {
        localStorage.removeItem(key);
        // Clear cookie
        let domain = "";
        const hostname = window.location.hostname;
        if (hostname.endsWith(".alchm.kitchen")) {
          domain = "; domain=.alchm.kitchen";
        } else if (hostname === "alchm.kitchen") {
          domain = "; domain=alchm.kitchen";
        }
        document.cookie = `${key}=; Max-Age=-99999999; path=/${domain}`;
      } else {
        localStorage.setItem(key, val);
        setCookie(key, val);
      }
    }
  };

  // Run automatically on script load
  syncCookiesToLocalStorage();
})();
