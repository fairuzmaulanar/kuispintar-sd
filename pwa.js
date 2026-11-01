/**
 * KuisPintar SD — PWA Engine (pwa.js)
 * Diadaptasi dari standar bhs-inggris-anak.vercel.app
 * 
 * Tanggung Jawab:
 * 1. Daftarkan Service Worker (offline cache kuis).
 * 2. Tawarkan "Pasang Aplikasi" lewat tombol chip header [ ⬇️ Pasang ] & popup ramah anak.
 * 3. Memicu dialog native browser (Chrome/Edge "Install app") secara instan.
 * 4. Panduan visual 3 langkah khusus iOS Safari (Add to Home Screen).
 * 5. Manajemen snooze (tunda 5 hari) agar tidak mengganggu siswa belajar.
 */

(() => {
  "use strict";

  const SNOOZE_KEY = "kuispintar_pwa_snooze_until";
  const DISMISS_KEY = "kuispintar_pwa_dismiss_count";
  const SNOOZE_DAYS = 5;
  const MAX_DISMISS = 3;
  const SHOW_DELAY_MS = 10000;  // beri waktu anak melihat menu sebelum ditawari
  const IOS_DELAY_MS = 20000;   // panduan manual iOS lebih bersahabat

  /* ---------- Safe Storage (tahan mode privat browser) ---------- */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  /* ---------- Deteksi Lingkungan Browser & Perangkat ---------- */
  const ua = navigator.userAgent || "";
  const isIOS = /iphone|ipad|ipod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const isIOSSafari = isIOS && !/crios|fxios|edgios|opt\/|fbav|instagram|line\//i.test(ua);

  function isInstalled() {
    const modes = ["standalone", "minimal-ui", "window-controls-overlay", "fullscreen"];
    if (modes.some(m => window.matchMedia(`(display-mode: ${m})`).matches)) return true;
    if (navigator.standalone === true) return true;
    return document.referrer.startsWith("android-app://");
  }

  function isSnoozed() {
    const until = parseInt(store.get(SNOOZE_KEY), 10);
    return Number.isFinite(until) && Date.now() < until;
  }

  function snooze(days) {
    store.set(SNOOZE_KEY, String(Date.now() + days * 24 * 60 * 60 * 1000));
  }

  function countDismiss() {
    const n = (parseInt(store.get(DISMISS_KEY), 10) || 0) + 1;
    store.set(DISMISS_KEY, String(n));
    snooze(n >= MAX_DISMISS ? 3650 : SNOOZE_DAYS);
  }

  function clearNudges() {
    store.del(SNOOZE_KEY);
    store.del(DISMISS_KEY);
  }

  /* ---------- Toast Notifikasi Ringan ---------- */
  let toastTimer = 0;
  function pwaToast(msg, action) {
    let box = document.getElementById("app-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "app-toast";
      document.body.appendChild(box);
    }
    box.textContent = "";
    const text = document.createElement("span");
    text.textContent = msg;
    box.appendChild(text);
    if (action) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-action-btn";
      btn.textContent = action.label;
      btn.style.marginLeft = "10px";
      btn.style.background = "#4F46E5";
      btn.style.color = "#FFF";
      btn.style.border = "none";
      btn.style.borderRadius = "8px";
      btn.style.padding = "4px 10px";
      btn.style.fontWeight = "700";
      btn.style.cursor = "pointer";
      btn.addEventListener("click", action.onClick);
      box.appendChild(btn);
    }
    box.style.display = "block";
    box.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.style.opacity = "0";
      setTimeout(() => { box.style.display = "none"; }, 300);
    }, action ? 12000 : 4000);
  }

  /* ---------- Popup Install Ramah Anak (.pwa-install) ---------- */
  let deferredPrompt = null;
  let popup = null;
  let popupShown = false;

  function buildPopup(mode) {
    const el = document.createElement("div");
    el.className = "pwa-install" + (mode === "ios" ? " pwa-install-ios" : "");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-labelledby", "pwa-install-title");

    const steps = mode === "ios"
      ? `<ol class="pwa-install-steps">
           <li>Ketuk tombol <b>Bagikan</b> <span class="pwa-share" aria-hidden="true">☝️</span> di browser Safari.</li>
           <li>Pilih <b>Add to Home Screen</b> / <b>Tambah ke Layar Utama</b>.</li>
           <li>Ketuk <b>Add / Tambah</b> — selesai!</li>
         </ol>`
      : "";

    const actions = mode === "ios"
      ? `<button type="button" class="btn-candy ghost compact" data-pwa-act="later">Oke, Mengerti</button>`
      : `<button type="button" class="btn-candy primary" data-pwa-act="install">📲 Pasang Sekarang</button>
         <button type="button" class="btn-candy ghost" data-pwa-act="later">Nanti saja</button>`;

    el.innerHTML = `
      <button type="button" class="pwa-install-x" data-pwa-act="later" aria-label="Tutup ajakan pasang">&times;</button>
      <div class="pwa-install-head">
        <img class="pwa-install-icon" src="icon-192.png" alt="Kuis SD" />
        <div>
          <h3 id="pwa-install-title">Pasang KuisPintar SD</h3>
          <p>Main langsung dari layar utama tanpa buka browser — dan tetap jalan saat kuota habis atau offline!</p>
        </div>
      </div>
      ${steps}
      <div class="pwa-install-actions">${actions}</div>
    `;

    el.addEventListener("click", (e) => {
      const act = e.target.closest("[data-pwa-act]");
      if (!act) return;
      if (act.dataset.pwaAct === "install") {
        acceptInstall();
      } else {
        dismissPopup(true);
      }
    });

    return el;
  }

  function onKeydown(e) {
    if (e.key === "Escape" && popup) dismissPopup(true);
  }

  function showPopup(mode, manual) {
    if (popup || isInstalled()) return;
    if (!manual && (popupShown || isSnoozed())) return;
    popupShown = true;
    popup = buildPopup(mode);
    document.body.appendChild(popup);
    requestAnimationFrame(() => popup.classList.add("show"));
    document.addEventListener("keydown", onKeydown);
  }

  function hidePopup() {
    if (!popup) return;
    const el = popup;
    popup = null;
    document.removeEventListener("keydown", onKeydown);
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }

  function dismissPopup(byUser) {
    if (byUser) countDismiss();
    hidePopup();
  }

  async function acceptInstall() {
    if (!deferredPrompt) {
      hidePopup();
      if (isIOSSafari) {
        showPopup("ios", true);
      } else {
        pwaToast("Gunakan menu titik tiga (⋮) browser -> Pasang Aplikasi.");
      }
      return;
    }
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    hidePopup();

    try {
      // Memicu dialog native browser (Chrome / Edge "Install app") persis Gambar 2
      promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice && choice.outcome === "accepted") {
        clearNudges();
        pwaToast("🎉 Sedang memasang KuisPintar SD ke perangkat Anda...");
      } else {
        snooze(SNOOZE_DAYS);
      }
    } catch (e) {
      snooze(SNOOZE_DAYS);
    }
    syncTriggers();
  }

  /* Sinkronisasi tombol pasang di halaman ([data-pwa-install]) */
  function syncTriggers() {
    const usable = !isInstalled() && (Boolean(deferredPrompt) || isIOSSafari);
    document.querySelectorAll("[data-pwa-install]").forEach(el => {
      el.hidden = !usable;
      if (usable) {
        el.style.display = "inline-flex";
      } else {
        el.style.display = "none";
      }
    });
  }

  /* Delegasi Klik Tombol Pasang di Seluruh Halaman */
  document.addEventListener("click", (e) => {
    const target = e.target;
    const trigger = target && target.closest && target.closest("[data-pwa-install]");
    if (!trigger) return;
    e.preventDefault();
    if (deferredPrompt) {
      acceptInstall();
    } else if (isIOSSafari) {
      showPopup("ios", true);
    } else {
      pwaToast("Aplikasi sudah terpasang atau peramban ini belum mendukung instalasi langsung.");
    }
  });

  /* ---------- Event Listeners PWA ---------- */
  window.addEventListener("beforeinstallprompt", (e) => {
    // Tahan mini-infobar default browser agar rapi
    e.preventDefault();
    deferredPrompt = e;
    syncTriggers();
    console.log("[PWA] Prompt instalasi native siap dipicu.");
    // Munculkan popup ramah anak secara otomatis setelah jeda bermain
    setTimeout(() => showPopup("prompt", false), SHOW_DELAY_MS);
  });

  window.addEventListener("appinstalled", () => {
    console.log("[PWA] KuisPintar SD berhasil dipasang di perangkat.");
    deferredPrompt = null;
    clearNudges();
    hidePopup();
    syncTriggers();
    pwaToast("🎉 KuisPintar SD terpasang! Cek layar utama HP/PC Anda ya.");
  });

  if (isIOSSafari) {
    setTimeout(() => showPopup("ios", false), IOS_DELAY_MS);
  }

  document.addEventListener("DOMContentLoaded", syncTriggers);

  /* ---------- Service Worker Registration & Live Controller Updates ---------- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js")
        .then((reg) => {
          console.log("[PWA] Service Worker aktif:", reg.scope);
        })
        .catch((err) => {
          console.warn("[PWA] Registrasi Service Worker gagal:", err);
        });
    });

    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      pwaToast("Versi baru KuisPintar SD sudah siap", {
        label: "Muat Ulang",
        onClick: () => location.reload(),
      });
    });
  }

  // Ekspor API Global untuk keperluan pengujian
  window.PWA_ENGINE = {
    isInstalled,
    canInstall: () => Boolean(deferredPrompt) || isIOSSafari,
    promptInstall: acceptInstall,
    showIOSGuide: () => showPopup("ios", true),
    resetNudges: clearNudges,
  };
})();

