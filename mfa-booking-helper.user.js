// ==UserScript==
// @name         MFA Estonia D-visa booking helper
// @namespace    arnob-mfa-helper
// @version      1.2
// @description  Fills the Estonian MFA booking form fast. You tick the CAPTCHA and press the final confirm button yourself.
// @match        https://broneering.mfa.ee/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/arnob635/mfa-monitor/main/mfa-booking-helper.user.js
// @updateURL    https://raw.githubusercontent.com/arnob635/mfa-monitor/main/mfa-booking-helper.user.js
// ==/UserScript==

// No personal data lives in this file. You enter your details once in the helper's
// "My details" form; they are saved only in this browser on this device.

(function () {
  "use strict";

  const FIELDS = [
    ["firstName", "First name (as in passport)"],
    ["lastName", "Surname (as in passport)"],
    ["email", "Email"],
    ["phone", "Phone (with country code)"],
    ["dateOfBirth", "Date of birth (YYYY-MM-DD)"],
    ["passportNumber", "Passport number"],
    ["citizenship", "Citizenship (e.g. Bangladesh)"],
    ["formNumber", "Pre-filled form number"],
  ];
  const DETAILS_KEY = "mfaHelperDetails";
  const loadDetails = () => { try { return JSON.parse(localStorage.getItem(DETAILS_KEY)) || {}; } catch (e) { return {}; } };
  let ME = loadDetails();
  const haveDetails = () => !!(ME.firstName && ME.lastName && ME.passportNumber);

  const SETTINGS = {
    embassyId: "40",                 // 40 = New Delhi
    service: "pikaajaline_viisa",    // Long-stay visa (D-visa) application
    persons: "1",
    autoNext: true,                  // press "next" buttons automatically once a page is filled
    autoTickConsent: true,           // tick "I agree" style checkboxes for you
  };
  // ======================================================================

  const FLAG = "mfaAutobook";
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) {} },
  };

  // Start when the page is opened from the alert link (#autobook) or via the panel button.
  // #autobook=251 overrides the embassy, useful for a test run.
  const m = location.hash.match(/^#autobook(?:=(\d+))?$/);
  if (m) {
    ss.set(FLAG, "1");
    if (m[1]) ss.set(FLAG + "Embassy", m[1]); else ss.del(FLAG + "Embassy");
  }
  const embassyId = () => ss.get(FLAG + "Embassy") || SETTINGS.embassyId;
  const active = () => ss.get(FLAG) === "1";

  // ---------- status panel (in a shadow root, so its inputs never mix with the site's form) ----------
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;display:flex;justify-content:flex-end";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    .p{max-width:360px;width:100%;box-sizing:border-box;font:15px/1.4 system-ui,sans-serif;background:#111;color:#fff;
       padding:10px 12px;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.35)}
    button{margin:8px 6px 0 0;padding:8px 12px;border-radius:8px;border:0;font:inherit;cursor:pointer}
    label{display:block;margin-top:6px;font-size:13px;opacity:.85}
    input{width:100%;box-sizing:border-box;padding:7px;border-radius:6px;border:0;font:16px system-ui}
    .f{display:none;max-height:55vh;overflow:auto}
  </style><div class="p"><div class="m"></div><div class="f"></div>
  <button class="go"></button><button class="ed">My details</button></div>`;
  document.body.appendChild(host);
  const panel = root.querySelector(".p"), msg = root.querySelector(".m"), form = root.querySelector(".f");
  const btn = root.querySelector(".go"), edBtn = root.querySelector(".ed");
  const say = (t, color) => { msg.textContent = t; panel.style.background = color || "#111"; };
  const renderBtn = () => {
    btn.textContent = active() ? "Stop helper" : "Start auto-fill";
    btn.onclick = () => {
      if (active()) { ss.del(FLAG); say("Helper stopped."); }
      else { ss.set(FLAG, "1"); say("Helper started."); }
      renderBtn();
    };
  };
  function openDetails() {
    form.innerHTML = FIELDS.map(([k, l]) =>
      `<label>${l}<input data-k="${k}" autocomplete="off"></label>`).join("") +
      `<button class="sv">Save details</button>`;
    form.querySelectorAll("input").forEach((i) => (i.value = ME[i.dataset.k] || ""));
    form.style.display = "block";
    form.querySelector(".sv").onclick = () => {
      const d = {};
      form.querySelectorAll("input").forEach((i) => (d[i.dataset.k] = i.value.trim()));
      try { localStorage.setItem(DETAILS_KEY, JSON.stringify(d)); } catch (e) {}
      ME = d;
      form.style.display = "none";
      say(haveDetails() ? "Details saved on this device." : "Saved, but name or passport number is missing.");
    };
  }
  edBtn.onclick = () => (form.style.display === "block" ? (form.style.display = "none") : openDetails());
  renderBtn();
  if (!haveDetails()) { say("First, tap My details and save your passport details."); openDetails(); }
  else say(active() ? "Helper running..." : "Booking helper ready (open the alert link, or tap Start).");

  // ---------- helpers ----------
  let busyUntil = 0;
  const busy = () => Date.now() < busyUntil;
  new MutationObserver(() => { busyUntil = Math.min(busyUntil, Date.now() + 250); })
    .observe(document.body, { childList: true, subtree: true });

  const visible = (el) => !!(el && el.offsetParent !== null && !el.disabled);
  const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

  function fire(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const tries = {};
  function setSelect(sel, value) {
    if (sel.value === value) return false;
    const k = sel.name || sel.id;
    tries[k] = (tries[k] || 0) + 1;
    if (tries[k] > 4) { say(`Couldn't set "${k}". Please choose it by hand.`, "#7a1f1f"); return false; }
    sel.value = value;
    fire(sel);
    busyUntil = Date.now() + 4000; // the site re-renders the form after a change
    return true;
  }
  function labelText(el) {
    let t = "";
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) t += " " + l.textContent;
    }
    const wrap = el.closest("label");
    if (wrap) t += " " + wrap.textContent;
    return norm(t + " " + (el.name || "") + " " + (el.id || "") + " " +
      (el.placeholder || "") + " " + (el.getAttribute("aria-label") || ""));
  }
  function setText(el, value) {
    if (!value || el.value) return false;
    if (el._flatpickr) { el._flatpickr.setDate(value, true); return true; }
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, value);
    fire(el);
    return true;
  }
  function chooseOptionByText(sel, text) {
    if (!text || sel.value) return false;
    const want = norm(text);
    const opt = [...sel.options].find((o) => o.value && norm(o.textContent).includes(want));
    return opt ? setSelect(sel, opt.value) : false;
  }
  // Solved only when there is a real CAPTCHA answer. A CAPTCHA that hasn't loaded is NOT solved.
  function captchaSolved() {
    if (!document.querySelector(".g-recaptcha, iframe[src*='recaptcha']")) return true;
    const r = document.querySelector('textarea[name="g-recaptcha-response"]');
    if (r && r.value) return true;
    try { if (window.grecaptcha && window.grecaptcha.getResponse()) return true; } catch (e) {}
    return false;
  }
  let captchaWaitSince = 0;
  function captchaLoaded() {
    return !!document.querySelector("iframe[src*='recaptcha']");
  }
  function hasCaptcha() {
    return !!document.querySelector(".g-recaptcha, iframe[src*='recaptcha']");
  }

  // Which of my details does this field want?
  function fieldKey(d) {
    if (/application|form (no|number)|taotlus|ankeet|reference/.test(d)) return "formNumber";
    if (/birth|sünni/.test(d)) return "dateOfBirth";
    if (/e-?mail|e-post/.test(d)) return "email";
    if (/phone|telefon|mobile/.test(d)) return "phone";
    if (/passport|document (no|number)|dokumendi|passi/.test(d)) return "passportNumber";
    if (/citizenship|nationality|kodakondsus/.test(d)) return "citizenship";
    if (/first ?name|given name|forename|eesnimi/.test(d)) return "firstName";
    if (/last ?name|surname|family name|perekonnanimi/.test(d)) return "lastName";
    return null;
  }

  // ---------- page 1: embassy, service, persons ----------
  function stepFirstPage() {
    const esindus = document.querySelector('select[name="broneering[esindus]"]');
    if (!esindus) return false;
    if (esindus.value !== embassyId()) {
      setSelect(esindus, embassyId());
      say("Selecting embassy...");
      return true;
    }
    const toiming = document.querySelector('select[name="broneering[toiming]"]');
    if (toiming) {
      const hasDvisa = [...toiming.options].some((o) => o.value === SETTINGS.service);
      if (!hasDvisa) { say("D-visa is not listed right now. Reload the page to try again.", "#7a1f1f"); return true; }
      if (toiming.value !== SETTINGS.service) { setSelect(toiming, SETTINGS.service); say("Selecting D-visa..."); return true; }
    }
    return false; // remaining fields are handled by the generic filler
  }

  // ---------- any page: persons, details, dates, times ----------
  function fillGeneric() {
    let changed = false;
    const form = document.querySelector("form") || document;

    for (const el of form.querySelectorAll("input, select, textarea")) {
      if (!visible(el) || el.type === "hidden") continue;
      const d = labelText(el);

      if (/number of persons|isikute arv|persons/.test(d)) {
        if (el.tagName === "SELECT") changed = setSelect(el, SETTINGS.persons) || changed;
        else changed = setText(el, SETTINGS.persons) || changed;
        continue;
      }
      if (el.type === "checkbox") {
        if (SETTINGS.autoTickConsent && !el.checked && /agree|consent|nõus|confirm|accept/.test(d)) {
          el.click(); changed = true;
        }
        continue;
      }
      const key = fieldKey(d);
      if (key) {
        if (el.tagName === "SELECT") changed = chooseOptionByText(el, ME[key]) || changed;
        else changed = setText(el, ME[key]) || changed;
        continue;
      }
      // appointment date picker: pick the earliest open day
      if (el._flatpickr && !el.value && !/birth|sünni/.test(d)) {
        changed = pickEarliestDate(el._flatpickr) || changed;
        continue;
      }
      // appointment time: first available option
      if (el.tagName === "SELECT" && !el.value && /time|aeg|kellaaeg|slot/.test(d)) {
        const opt = [...el.options].find((o) => o.value && !o.disabled);
        if (opt) changed = setSelect(el, opt.value) || changed;
      }
    }

    // time slots shown as radio buttons or buttons like "10:30"
    const radios = [...form.querySelectorAll('input[type="radio"]')].filter(visible);
    const groups = [...new Set(radios.map((r) => r.name))];
    for (const g of groups) {
      const inGroup = radios.filter((r) => r.name === g);
      if (!inGroup.some((r) => r.checked)) { inGroup[0].click(); changed = true; }
    }
    if (!radios.length) {
      const slotBtn = [...form.querySelectorAll("button, a, .slot, [data-time]")].find(
        (b) => visible(b) && /^\s*\d{1,2}:\d{2}/.test(b.textContent) && !b.classList.contains("selected"));
      if (slotBtn && !form.querySelector(".selected, .active[data-time]")) { slotBtn.click(); changed = true; }
    }
    return changed;
  }

  function pickEarliestDate(fp) {
    fp.open();
    for (let i = 0; i < 6; i++) {
      const day = fp.calendarContainer.querySelector(
        ".flatpickr-day:not(.flatpickr-disabled):not(.prevMonthDay):not(.nextMonthDay)");
      if (day) { day.click(); busyUntil = Date.now() + 2500; return true; }
      fp.changeMonth(1);
    }
    fp.close();
    say("No open dates found in the next 6 months.", "#7a1f1f");
    return false;
  }

  // ---------- next / confirm buttons ----------
  function nextButton() {
    return [...document.querySelectorAll('button[type="submit"], input[type="submit"], button')]
      .filter((b) => visible(b) && b.name !== "turbo")
      .find((b) => /next|järgmine|edasi|continue/i.test(b.textContent || b.value));
  }
  function confirmButton() {
    return [...document.querySelectorAll('button[type="submit"], input[type="submit"], button')]
      .filter(visible)
      .find((b) => /confirm|book|kinnita|broneeri|submit|save|salvesta/i.test(b.textContent || b.value));
  }

  // ---------- main loop ----------
  setInterval(() => {
    if (!active() || busy()) return;
    if (stepFirstPage()) return;
    if (fillGeneric()) { say("Filling in your details..."); return; }

    if (hasCaptcha() && !captchaSolved()) {
      const c = document.querySelector(".g-recaptcha, iframe[src*='recaptcha']");
      c.scrollIntoView({ block: "center" });
      if (!captchaWaitSince) captchaWaitSince = Date.now();
      if (!captchaLoaded() && Date.now() - captchaWaitSince > 6000) {
        say("The CAPTCHA didn't load. Reload the page (the helper keeps going).", "#7a1f1f");
      } else {
        say("Tick \"I'm not a robot\" now.", "#8a5a00");
      }
      return;
    }
    captchaWaitSince = 0;
    const next = nextButton();
    if (next) {
      if (SETTINGS.autoNext) { say("Going to the next page..."); busyUntil = Date.now() + 5000; next.click(); }
      else { next.scrollIntoView({ block: "center" }); say("Press the next button."); }
      return;
    }
    const confirm = confirmButton();
    if (confirm) {
      confirm.scrollIntoView({ block: "center" });
      confirm.style.outline = "4px solid #ffb000";
      say("Check the date and details, then press the highlighted button to book.", "#1f6f3a");
    }
  }, 300);
})();
