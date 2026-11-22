"use strict";

/* ================= Βοηθητικά: ποσά ================= */

// "12,5" / "12.50" -> 1250 (ακέραια λεπτά, χωρίς float). Επιστρέφει null αν δεν είναι έγκυρο.
function parseCents(str, allowNegative = false) {
  let s = String(str ?? "").trim().replace(/\s/g, "").replace(",", ".");
  let neg = false;
  if (allowNegative && s.startsWith("-")) { neg = true; s = s.slice(1); }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return neg ? -cents : cents;
}

const eur = new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR" });
const formatCents = (c) => eur.format(c / 100);
// Για πεδία εισαγωγής: 1250 -> "12,50"
const centsToInput = (c) => (c / 100).toFixed(2).replace(".", ",");

const dateFmt = new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/* ================= Αποθήκευση δεδομένων ================= */
/* Κοινό interface: list / add / update / remove / getSettings / saveSettings.
   Δύο υλοποιήσεις: Supabase (κανονική) και localStorage (μόνο για τοπική δοκιμή). */

function createSupabaseStore(sb, userId) {
  const fail = (error) => { if (error) throw new Error(error.message); };
  return {
    async list() {
      const rows = [];
      for (let from = 0; ; from += 1000) { // το Supabase επιστρέφει max 1000 γραμμές ανά αίτημα
        const { data, error } = await sb.from("transactions").select("*")
          .order("occurred_at", { ascending: false }).order("created_at", { ascending: false })
          .range(from, from + 999);
        fail(error);
        rows.push(...data);
        if (data.length < 1000) break;
      }
      return rows;
    },
    async add(tx) { const { error } = await sb.from("transactions").insert(tx); fail(error); },
    async update(id, patch) { const { error } = await sb.from("transactions").update(patch).eq("id", id); fail(error); },
    async remove(id) { const { error } = await sb.from("transactions").delete().eq("id", id); fail(error); },
    async listCategories() {
      const { data, error } = await sb.from("categories").select("*").order("created_at").order("name");
      fail(error); return data;
    },
    async addCategories(names) {
      const { error } = await sb.from("categories").upsert(names.map((name) => ({ user_id: userId, name })), { onConflict: "user_id,name", ignoreDuplicates: true });
      fail(error);
    },
    async removeCategory(id) { const { error } = await sb.from("categories").delete().eq("id", id); fail(error); },
    async getSettings() {
      const { data, error } = await sb.from("settings").select("*").maybeSingle();
      fail(error);
      return {
        payday_cents: data?.payday_cents ?? 100000,
        savings_goal_cents: data?.savings_goal_cents ?? 0,
        next_payday: data?.next_payday ?? null,
        pending_bills_cents: data?.pending_bills_cents ?? 0,
        cycle_start: data?.cycle_start ?? null,
      };
    },
    async saveSettings(s) {
      const { error } = await sb.from("settings").upsert({ user_id: userId, ...s });
      fail(error);
    },
  };
}

function createLocalStore() {
  const K = "budget-local-demo";
  const load = () => JSON.parse(localStorage.getItem(K) || '{"txs":[],"settings":{"payday_cents":100000}}');
  const save = (d) => localStorage.setItem(K, JSON.stringify(d));
  return {
    async list() {
      return load().txs.sort((a, b) => (b.occurred_at + b.created_at).localeCompare(a.occurred_at + a.created_at));
    },
    async add(tx) {
      const d = load(); const now = new Date().toISOString();
      d.txs.push({ id: crypto.randomUUID(), category_id: null, note: null, occurred_at: now, created_at: now, ...tx });
      save(d);
    },
    async update(id, patch) { const d = load(); Object.assign(d.txs.find((t) => t.id === id), patch); save(d); },
    async remove(id) { const d = load(); d.txs = d.txs.filter((t) => t.id !== id); save(d); },
    async listCategories() { return load().cats || []; },
    async addCategories(names) {
      const d = load(); d.cats = d.cats || [];
      for (const name of names) if (!d.cats.some((c) => c.name === name)) d.cats.push({ id: crypto.randomUUID(), name });
      save(d);
    },
    async removeCategory(id) {
      const d = load(); d.cats = (d.cats || []).filter((c) => c.id !== id);
      for (const t of d.txs) if (t.category_id === id) t.category_id = null;
      save(d);
    },
    async getSettings() {
      return { payday_cents: 100000, savings_goal_cents: 0, next_payday: null, pending_bills_cents: 0, cycle_start: null, ...load().settings };
    },
    async saveSettings(s) { const d = load(); d.settings = s; save(d); },
  };
}

/* ================= Κατάσταση & DOM ================= */

const $ = (id) => document.getElementById(id);
const cfg = window.APP_CONFIG || {};
const LOCAL_MODE = !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY;
const PAGE = 100;

const state = { store: null, txs: [], settings: { payday_cents: 100000, savings_goal_cents: 0, next_payday: null, pending_bills_cents: 0, cycle_start: null }, cats: [], addCat: null, editCat: null, shown: PAGE, editing: null };
const DEFAULT_CATS = ["Φαγητό", "Σούπερ μάρκετ", "Καφές / έξω", "Μετακινήσεις", "Διασκέδαση", "Αγορές", "Υγεία", "Άλλο"];
const catName = (id) => state.cats.find((c) => c.id === id)?.name;

// Chips επιλογής κατηγορίας. Ξαναπάτημα = αποεπιλογή (η κατηγορία είναι προαιρετική).
function renderChips(el, selectedId, onPick) {
  el.replaceChildren();
  for (const c of state.cats) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = c.name;
    b.setAttribute("aria-pressed", String(c.id === selectedId));
    b.addEventListener("click", () => { onPick(c.id === selectedId ? null : c.id); });
    el.append(b);
  }
}
function renderCatLists() {
  renderChips($("add-cats"), state.addCat, (id) => { state.addCat = id; renderCatLists(); });
  renderChips($("edit-cats"), state.editCat, (id) => { state.editCat = id; renderCatLists(); });
  const ul = $("cat-list"); ul.replaceChildren();
  for (const c of state.cats) {
    const li = document.createElement("li"); li.textContent = c.name;
    const x = document.createElement("button"); x.type = "button"; x.className = "x"; x.textContent = "✕"; x.setAttribute("aria-label", "Διαγραφή " + c.name);
    x.addEventListener("click", async () => {
      if (!(await confirmDialog("Διαγραφή κατηγορίας", "Να διαγραφεί η «" + c.name + "»; Οι κινήσεις της θα μείνουν χωρίς κατηγορία."))) return;
      await run(async () => { await state.store.removeCategory(c.id); if (state.addCat === c.id) state.addCat = null; await refresh(); });
    });
    li.append(x); ul.append(li);
  }
}
let sb = null;

function show(screen) {
  for (const id of ["screen-auth", "screen-setup", "screen-home"]) $(id).hidden = id !== screen;
}

let toastTimer;
function toast(text) {
  const t = $("toast"); t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

function confirmDialog(title, text) {
  return new Promise((resolve) => {
    $("confirm-title").textContent = title;
    $("confirm-text").textContent = text;
    const dlg = $("dlg-confirm");
    const ok = $("confirm-ok"), cancel = $("confirm-cancel");
    let done = false;
    const finish = (v) => {
      if (done) return; done = true;
      ok.onclick = cancel.onclick = dlg.onclose = null;
      if (dlg.open) dlg.close();
      resolve(v);
    };
    ok.onclick = () => finish(true);
    cancel.onclick = () => finish(false);
    dlg.onclose = () => finish(false); // Esc
    dlg.showModal();
  });
}

// Εκτελεί μια ενέργεια αποθήκευσης· σε σφάλμα το δείχνει στο msgEl.
async function run(action, msgEl) {
  if (msgEl) msgEl.textContent = "";
  try { await action(); return true; }
  catch (e) {
    const text = "Αποτυχία: " + e.message;
    if (msgEl) msgEl.textContent = text; else toast(text);
    return false;
  }
}

/* ================= Υπολογισμοί ================= */

// Οι μεταφορές (ανάληψη/κατάθεση) μετακινούν χρήματα ανάμεσα σε μετρητά και κάρτα, δεν αλλάζουν το σύνολο.
const balanceCents = () => state.txs.reduce((s, t) => (t.kind === "transfer" ? s : s + Number(t.amount_cents)), 0);

// Μετρητά = έξοδα/έσοδα με account "cash" + μεταφορές προς τα μετρητά − μεταφορές προς την κάρτα.
// Στις μεταφορές το account είναι ο ΠΡΟΟΡΙΣΜΟΣ.
function cashCents() {
  return state.txs.reduce((s, t) => {
    if (t.kind === "transfer") return s + (t.account === "cash" ? 1 : -1) * Number(t.amount_cents);
    return t.account === "cash" ? s + Number(t.amount_cents) : s;
  }, 0);
}

// Έσοδα «εκτός ημερήσιου» (π.χ. επίδομα) που μπήκαν μετά την τελευταία πληρωμή:
// μένουν στην άκρη μέχρι το επόμενο «Πληρώθηκα», μετά μπαίνουν κανονικά στα διαθέσιμα.
function reservedCents() {
  const since = state.settings.cycle_start ? new Date(state.settings.cycle_start).getTime() : 0;
  return state.txs
    .filter((t) => t.kind === "income" && t.is_extra && new Date(t.occurred_at).getTime() >= since)
    .reduce((s, t) => s + Number(t.amount_cents), 0);
}

function spentSince(start, { excludeBills = false } = {}) {
  const from = start.getTime();
  return state.txs
    .filter((t) => t.kind === "expense" && !(excludeBills && t.is_bill) && new Date(t.occurred_at).getTime() >= from)
    .reduce((s, t) => s - Number(t.amount_cents), 0);
}

// Εκτίμηση επόμενης πληρωμής: η 5η εργασιμη (Δευτ–Παρ, χωρίς αργίες) του επόμενου μήνα.
function estimateNextPayday(from = new Date()) {
  const first = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  let d = new Date(first), n = 0;
  for (;; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6 && ++n === 5) break;
  }
  return toDateStr(d);
}
const toDateStr = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const parseDateStr = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

// Διαθέσιμα για έξοδα = υπόλοιπο − στόχος αποταμίευσης − λογαριασμοί που απομένουν.
// Ημερήσιο ποσό = (διαθέσιμα στην αρχή της σημερινής μέρας) ÷ μέρες μέχρι την επόμενη πληρωμή.
function budgetInfo() {
  const { next_payday: nextStr, savings_goal_cents: goal, pending_bills_cents: pending } = state.settings;
  if (!nextStr) return null;
  const { day } = periodStarts();
  const diff = Math.round((parseDateStr(nextStr) - day) / 86400000);
  const overdue = diff < 1; // η ημερομηνία πληρωμής πέρασε και δεν πάτησες «Πληρώθηκα»
  const daysLeft = Math.max(1, diff);
  const spentToday = spentSince(day, { excludeBills: true });
  const reserved = reservedCents();
  const available = balanceCents() - goal - pending - reserved;
  const allowance = Math.floor((available + spentToday) / daysLeft); // λεπτά, ακέραιο
  return { allowance, leftToday: allowance - spentToday, available, daysLeft, goal, pending, reserved, overdue };
}

function periodStarts() {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = new Date(day); week.setDate(day.getDate() - ((day.getDay() + 6) % 7)); // Δευτέρα
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  return { day, week, month };
}

/* ================= Απεικόνιση ================= */

function txLabel(t) {
  if (t.note) return t.note;
  if (t.kind === "transfer") return t.account === "cash" ? "Ανάληψη (κάρτα → μετρητά)" : "Κατάθεση (μετρητά → κάρτα)";
  return { expense: "Αγορά", income: "Έσοδο", initial: "Αρχικό υπόλοιπο", adjustment: "Διόρθωση υπολοίπου" }[t.kind];
}

function render() {
  const bal = balanceCents();
  $("balance").textContent = formatCents(bal);
  $("balance").classList.toggle("neg", bal < 0);
  const cash = cashCents();
  const usesCash = cash !== 0 || state.txs.some((t) => t.account === "cash" || t.kind === "transfer");
  $("split").hidden = !usesCash;
  $("split").textContent = `Μετρητά: ${formatCents(cash)} · Κάρτα: ${formatCents(bal - cash)}`;

  const p = periodStarts();
  $("sum-day").textContent = formatCents(spentSince(p.day));
  $("sum-week").textContent = formatCents(spentSince(p.week));
  $("sum-month").textContent = formatCents(spentSince(p.month));

  const b = budgetInfo();
  $("budget-card").hidden = !b;
  $("budget-empty").hidden = !!b;
  if (b) {
    $("bud-today").textContent = formatCents(b.leftToday);
    $("bud-today").classList.toggle("neg", b.leftToday < 0);
    $("bud-daily").textContent = `Ημερήσιο ποσό: ${formatCents(b.allowance)} · ${b.overdue ? "η πληρωμή έχει περάσει — πάτα «Πληρώθηκα»" : b.daysLeft + " μέρες μέχρι την πληρωμή"}`;
    $("bud-month").textContent = `Στην άκρη: ${formatCents(b.goal)} · Λογαριασμοί που απομένουν: ${formatCents(b.pending)}${b.reserved ? " · Εκτός ημερήσιου: " + formatCents(b.reserved) : ""}`;
  }

  const ul = $("history");
  ul.replaceChildren();
  const visible = state.txs.slice(0, state.shown);
  for (const t of visible) {
    const li = document.createElement("li");
    li.dataset.id = t.id;
    const what = document.createElement("div"); what.className = "what";
    const note = document.createElement("div"); note.className = "note"; note.textContent = txLabel(t);
    if (catName(t.category_id)) { const ct = document.createElement("span"); ct.className = "tag"; ct.textContent = catName(t.category_id); note.append(ct); }
    if (t.account === "cash" && t.kind !== "transfer") { const tg = document.createElement("span"); tg.className = "tag"; tg.textContent = "μετρητά"; note.append(tg); }
    if (t.kind === "income" && t.is_extra) { const tg = document.createElement("span"); tg.className = "tag"; tg.textContent = "εκτός ημερήσιου"; note.append(tg); }
    if (t.is_bill) { const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "λογαριασμός"; note.append(tag); }
    const when = document.createElement("div"); when.className = "when"; when.textContent = dateFmt.format(new Date(t.occurred_at));
    what.append(note, when);
    const amt = document.createElement("div");
    const n = Number(t.amount_cents);
    if (t.kind === "transfer") { amt.className = "amt neutral"; amt.textContent = "⇄ " + formatCents(n); }
    else { amt.className = "amt " + (n < 0 ? "neg" : "pos"); amt.textContent = (n > 0 ? "+" : "") + formatCents(n); }
    li.append(what, amt);
    ul.append(li);
  }
  if (!visible.length) {
    const li = document.createElement("li"); li.className = "empty"; li.textContent = "Καμία κίνηση ακόμα.";
    ul.append(li);
  }
  $("more").hidden = state.txs.length <= state.shown;
}

async function refresh() {
  state.txs = await state.store.list();
  state.cats = await state.store.listCategories();
  if (state.cats.length === 0 && state.txs.length > 0 && !localStorage.getItem("cats-seeded")) {
    localStorage.setItem("cats-seeded", "1");
    await state.store.addCategories(DEFAULT_CATS);
    state.cats = await state.store.listCategories();
  }
  if (state.txs.length === 0) { show("screen-setup"); $("setup-amount").focus(); return; }
  show("screen-home");
  renderCatLists();
  render();
}

/* ================= Ενέργειες ================= */

const getRadio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
const setRadio = (name, value) => { document.querySelector(`input[name="${name}"][value="${value}"]`).checked = true; };

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cents = parseCents($("add-amount").value);
  if (!cents) { toast("Βάλε έγκυρο ποσό"); $("add-amount").focus(); return; }
  const btn = e.currentTarget.querySelector("button[type=submit]"); btn.disabled = true;
  const ok = await run(async () => {
    await state.store.add({ kind: "expense", amount_cents: -cents, note: $("add-note").value.trim() || null, is_bill: $("add-bill").checked, category_id: state.addCat, account: getRadio("add-acct") });
    // Πληρωμένος λογαριασμός: μειώνεται το ποσό «λογαριασμοί που απομένουν» (όχι κάτω από 0).
    if ($("add-bill").checked && state.settings.pending_bills_cents > 0) {
      const next = { ...state.settings, pending_bills_cents: Math.max(0, state.settings.pending_bills_cents - cents) };
      await state.store.saveSettings(next);
      state.settings = next;
    }
    await refresh();
  });
  btn.disabled = false;
  if (ok) { $("add-amount").value = ""; $("add-note").value = ""; $("add-bill").checked = false; setRadio("add-acct", "bank"); state.addCat = null; renderCatLists(); toast("Καταχωρήθηκε"); $("add-amount").focus(); }
});

$("payday").addEventListener("click", async () => {
  const amount = state.settings.payday_cents;
  if (!(await confirmDialog("Πληρώθηκα", `Να προστεθούν ${formatCents(amount)} στο υπόλοιπο;`))) return;
  const ok = await run(async () => {
    await state.store.add({ kind: "income", amount_cents: amount, note: "Πληρωμή" });
    const next = { ...state.settings, next_payday: estimateNextPayday(), cycle_start: new Date().toISOString() };
    await state.store.saveSettings(next);
    state.settings = next;
    await refresh();
  });
  if (ok) toast("Προστέθηκαν " + formatCents(amount));
});

// Προσθήκη χρημάτων στο υπόλοιπο (επίδομα, δώρο, κ.λπ.)
$("inc-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cents = parseCents($("inc-amount").value);
  if (!cents) { toast("Βάλε έγκυρο ποσό"); $("inc-amount").focus(); return; }
  const ok = await run(async () => {
    await state.store.add({ kind: "income", amount_cents: cents, note: $("inc-note").value.trim() || null, account: getRadio("inc-acct"), is_extra: $("inc-extra").checked });
    await refresh();
  });
  if (ok) {
    $("inc-amount").value = ""; $("inc-note").value = ""; $("inc-extra").checked = false; setRadio("inc-acct", "bank");
    $("inc-fold").open = false; toast("Προστέθηκαν " + formatCents(cents));
  }
});

// Ανάληψη / κατάθεση μετρητών
$("tr-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cents = parseCents($("tr-amount").value);
  if (!cents) { toast("Βάλε έγκυρο ποσό"); $("tr-amount").focus(); return; }
  const ok = await run(async () => {
    await state.store.add({ kind: "transfer", amount_cents: cents, account: getRadio("tr-dir"), note: null });
    await refresh();
  });
  if (ok) { $("tr-amount").value = ""; $("tr-fold").open = false; toast("Καταγράφηκε"); }
});

$("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cents = parseCents($("setup-amount").value, true);
  if (cents === null) { toast("Βάλε έγκυρο ποσό"); return; }
  await run(async () => {
    await state.store.add({ kind: "initial", amount_cents: cents, note: null });
    await refresh();
  });
});

$("more").addEventListener("click", () => { state.shown += PAGE; render(); });

// Ιστορικό -> επεξεργασία
$("history").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  const t = state.txs.find((x) => x.id === li.dataset.id);
  state.editing = t;
  const editable = t.kind === "expense" || t.kind === "income" || t.kind === "transfer";
  const spendOrIncome = t.kind === "expense" || t.kind === "income";
  $("edit-acct-wrap").hidden = !spendOrIncome;
  if (spendOrIncome) setRadio("edit-acct", t.account || "bank");
  $("edit-extra-wrap").hidden = t.kind !== "income";
  $("edit-extra").checked = !!t.is_extra;
  $("edit-title").textContent = txLabel(t);
  $("edit-amount-wrap").hidden = !editable;
  $("edit-amount").value = centsToInput(Math.abs(Number(t.amount_cents)));
  $("edit-note").value = t.note || "";
  $("edit-bill-wrap").hidden = t.kind !== "expense";
  $("edit-bill").checked = !!t.is_bill;
  $("edit-cats-wrap").hidden = t.kind !== "expense";
  state.editCat = t.category_id || null;
  renderCatLists();
  $("edit-msg").textContent = "";
  $("dlg-edit").showModal();
});

$("edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = state.editing;
  const patch = { note: $("edit-note").value.trim() || null };
  if (t.kind === "expense" || t.kind === "income" || t.kind === "transfer") {
    const cents = parseCents($("edit-amount").value);
    if (!cents) { $("edit-msg").textContent = "Βάλε έγκυρο ποσό"; return; }
    patch.amount_cents = t.kind === "expense" ? -cents : cents;
  }
  if (t.kind === "expense" || t.kind === "income") patch.account = getRadio("edit-acct");
  if (t.kind === "income") patch.is_extra = $("edit-extra").checked;
  if (t.kind === "expense") { patch.is_bill = $("edit-bill").checked; patch.category_id = state.editCat; }
  const ok = await run(async () => { await state.store.update(t.id, patch); await refresh(); }, $("edit-msg"));
  if (ok) $("dlg-edit").close();
});

$("edit-delete").addEventListener("click", async () => {
  const t = state.editing;
  $("dlg-edit").close();
  if (!(await confirmDialog("Διαγραφή", `Να διαγραφεί η κίνηση «${txLabel(t)}» (${formatCents(Number(t.amount_cents))});`))) return;
  await run(async () => { await state.store.remove(t.id); await refresh(); });
});

// Ρυθμίσεις
$("budget-empty").addEventListener("click", () => $("open-settings").click());
$("open-settings").addEventListener("click", () => {
  $("set-payday").value = centsToInput(state.settings.payday_cents);
  $("set-balance").value = "";
  $("set-cash").value = "";
  $("set-goal").value = centsToInput(state.settings.savings_goal_cents);
  $("set-next-payday").value = state.settings.next_payday ?? "";
  $("set-pending").value = centsToInput(state.settings.pending_bills_cents);
  $("settings-msg").textContent = "";
  $("dlg-settings").showModal();
});

$("settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("settings-msg");
  const payday = parseCents($("set-payday").value);
  if (!payday) { msg.textContent = "Μη έγκυρο ποσό «Πληρώθηκα»"; return; }
  const goal = parseCents($("set-goal").value.trim() || "0");
  if (goal === null) { msg.textContent = "Μη έγκυρος στόχος αποταμίευσης"; return; }
  const pending = parseCents($("set-pending").value.trim() || "0");
  if (pending === null) { msg.textContent = "Μη έγκυρο ποσό λογαριασμών"; return; }
  const nextPay = $("set-next-payday").value || null;
  const balText = $("set-balance").value.trim();
  const target = balText === "" ? null : parseCents(balText, true);
  if (balText !== "" && target === null) { msg.textContent = "Μη έγκυρο υπόλοιπο"; return; }

  const cashText = $("set-cash").value.trim();
  const cashTarget = cashText === "" ? null : parseCents(cashText);
  if (cashText !== "" && cashTarget === null) { msg.textContent = "Μη έγκυρο ποσό μετρητών"; return; }

  const ok = await run(async () => {
    const next = { ...state.settings, payday_cents: payday, savings_goal_cents: goal, next_payday: nextPay, pending_bills_cents: pending };
    if (JSON.stringify(next) !== JSON.stringify(state.settings)) {
      await state.store.saveSettings(next);
      state.settings = next;
    }
    if (target !== null) {
      const diff = target - balanceCents();
      if (diff !== 0) await state.store.add({ kind: "adjustment", amount_cents: diff, note: "Διόρθωση υπολοίπου" });
    }
    if (cashTarget !== null) {
      // Η διόρθωση μετρητών μετακινεί ποσό ανάμεσα σε κάρτα και μετρητά, χωρίς να αλλάζει το σύνολο.
      const diff = cashTarget - cashCents();
      if (diff !== 0) await state.store.add({ kind: "transfer", amount_cents: Math.abs(diff), account: diff > 0 ? "cash" : "bank", note: "Διόρθωση μετρητών" });
    }
    await refresh();
  }, msg);
  if (ok) { $("dlg-settings").close(); toast("Αποθηκεύτηκε"); }
});

$("logout").addEventListener("click", async () => {
  $("dlg-settings").close();
  if (sb) await sb.auth.signOut();
  else location.reload();
});

// Κλείσιμο dialogs
for (const b of document.querySelectorAll("[data-close]")) b.addEventListener("click", () => b.closest("dialog").close());

/* ================= Σύνδεση ================= */

let signUpMode = false;
$("auth-toggle").addEventListener("click", () => {
  signUpMode = !signUpMode;
  $("auth-submit").textContent = signUpMode ? "Εγγραφή" : "Σύνδεση";
  $("auth-toggle").textContent = signUpMode ? "Έχω ήδη λογαριασμό · Σύνδεση" : "Δεν έχω λογαριασμό · Εγγραφή";
  $("auth-pass").autocomplete = signUpMode ? "new-password" : "current-password";
  $("auth-msg").textContent = "";
});

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("auth-msg"); msg.className = "msg"; msg.textContent = "";
  const creds = { email: $("auth-email").value.trim(), password: $("auth-pass").value };
  const btn = $("auth-submit"); btn.disabled = true;
  const { data, error } = signUpMode ? await sb.auth.signUp(creds) : await sb.auth.signInWithPassword(creds);
  btn.disabled = false;
  if (error) { msg.textContent = "Αποτυχία: " + error.message; return; }
  if (signUpMode && !data.session) {
    msg.className = "msg ok";
    msg.textContent = "Έλεγξε το email σου και επιβεβαίωσε τον λογαριασμό, μετά κάνε σύνδεση.";
  }
  // Αν υπάρχει session, το onAuthStateChange συνεχίζει.
});

async function startSession(user) {
  state.store = createSupabaseStore(sb, user.id);
  state.shown = PAGE;
  await run(async () => {
    state.settings = await state.store.getSettings();
    await refresh();
  });
}

/* ================= Εκκίνηση ================= */

async function init() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  if (LOCAL_MODE) {
    state.store = createLocalStore();
    state.settings = await state.store.getSettings();
    toast("Τοπική λειτουργία δοκιμής");
    await refresh();
    return;
  }

  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  let currentUser = null;
  sb.auth.onAuthStateChange((_event, session) => {
    // Αποφεύγουμε επαναφόρτωση σε token refresh για τον ίδιο χρήστη.
    if (session?.user && session.user.id !== currentUser) {
      currentUser = session.user.id;
      setTimeout(() => startSession(session.user), 0); // εκτός του auth callback (αποφυγή deadlock)
    } else if (!session) {
      currentUser = null; state.txs = []; show("screen-auth");
    }
  });
  const { data } = await sb.auth.getSession();
  if (!data.session) show("screen-auth");
}

init();

// Νέα κατηγορία από τις ρυθμίσεις
async function addCategoryFromInput() {
  const name = $("cat-new").value.trim();
  if (!name) return;
  if (state.cats.some((c) => c.name.toLowerCase() === name.toLowerCase())) { $("settings-msg").textContent = "Υπάρχει ήδη αυτή η κατηγορία"; return; }
  $("settings-msg").textContent = "";
  if (await run(async () => { await state.store.addCategories([name]); await refresh(); }, $("settings-msg"))) $("cat-new").value = "";
}
$("cat-add").addEventListener("click", addCategoryFromInput);
$("cat-new").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addCategoryFromInput(); } });
