import { firebaseConfig } from "./firebase-config.js";

/* ---------- konstanty ---------- */
const STATUS = {
  napad: "Nápad",
  pripravuje: "Připravuje se",
  pripraveno: "Připraveno",
  publikovano: "Zveřejněno",
};
const FORMATS = ["Reel", "Post", "Story", "Karusel", "Jiné"];
// Připraveno = ještě není ve Facebook plánovači, Zveřejněno = už v něm je.
const STATUS_HINT = { pripraveno: "ještě není ve FB plánovači", publikovano: "je ve FB plánovači" };
const PLAT = { ig: "Instagram", fb: "Facebook", yt: "YouTube" };
const isOk = (p) => (p.approved !== undefined ? p.approved === true : p.approval === "schvaleno"); // schváleno Robertem
// Majitel vidí zaškrtávátko přímo na kartě, ostatní jen štítek.
const tagsHtml = (p) => `<span class="tags">${
  role === "owner"
    ? `<label class="okbox"><input type="checkbox" data-ok="${p.id}" ${isOk(p) ? "checked" : ""}> Schváleno Robertem</label>`
    : isOk(p) ? '<span class="tag ap-schvaleno">Schváleno Robertem</span>' : ""
}</span>`;
const MONTHS = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
const DOW = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
const LS_KEY = "tarus-planovac-v1";
const CLOUD = !!firebaseConfig.apiKey;

/* ---------- pomocné ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => iso(new Date());
const fmtDate = (s) => (s ? `${+s.slice(8)}. ${+s.slice(5, 7)}.` : "bez data");
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const toast = (msg) => {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("on"), 2200);
};

/* ---------- stav ---------- */
let posts = [];
let role = "owner"; // owner | editor
let me = { uid: "local", email: "já" };
let view = "prehled";
let cur = (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })();
let store;

/* ---------- úložiště: lokální ---------- */
function localStore() {
  const load = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; } };
  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(posts)); } catch { toast("Nepodařilo se uložit do prohlížeče"); } };
  return {
    async start(onChange) { posts = load(); onChange(); this.cb = onChange; },
    async add(p) { posts.push({ ...p, id: uid() }); save(); this.cb(); },
    async update(id, patch) { posts = posts.map((x) => (x.id === id ? { ...x, ...patch } : x)); save(); this.cb(); },
    async comment(id, c) { posts = posts.map((x) => (x.id === id ? { ...x, comments: [...(x.comments || []), c] } : x)); save(); this.cb(); },
    async remove(id) { posts = posts.filter((x) => x.id !== id); save(); this.cb(); },
    async replaceAll(list) { posts = list.map((p) => ({ ...p, id: p.id || uid() })); save(); this.cb(); },
  };
}

/* ---------- úložiště: Firebase ---------- */
async function cloudStore() {
  const V = "10.12.2";
  const base = `https://www.gstatic.com/firebasejs/${V}`;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.initializeFirestore(app, { localCache: F.persistentLocalCache() });
  const col = F.collection(db, "posts");
  return {
    auth, A, F, db,
    async start(onChange) {
      F.onSnapshot(col, (snap) => {
        posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        onChange();
      }, (e) => toast("Chyba čtení dat: " + e.code));
    },
    async add(p) { await F.addDoc(col, p); },
    async update(id, patch) { await F.updateDoc(F.doc(db, "posts", id), patch); },
    async comment(id, c) { await F.updateDoc(F.doc(db, "posts", id), { comments: F.arrayUnion(c) }); },
    async remove(id) { await F.deleteDoc(F.doc(db, "posts", id)); },
    async replaceAll(list) {
      for (const p of list) { const { id, ...rest } = p; await F.setDoc(F.doc(db, "posts", id || uid()), rest); }
    },
    async roleOf(u) {
      const s = await F.getDoc(F.doc(db, "roles", u.uid));
      return s.exists() ? s.data().role : null;
    },
  };
}

/* ---------- start ---------- */
async function boot() {
  if (!CLOUD) {
    store = localStore();
    $("#modeBadge").textContent = "Lokální režim";
    $("#modeBadge").className = "badge local";
    $("#logoutBtn").hidden = true;
    $("#app").hidden = false;
    await store.start(render);
    return;
  }
  store = await cloudStore();
  store.A.onAuthStateChanged(store.auth, async (u) => {
    if (!u) { $("#app").hidden = true; $("#login").hidden = false; return; }
    const r = await store.roleOf(u).catch(() => null);
    if (!r) {
      $("#loginError").textContent = "Tento účet nemá přístup. Požádej majitele o přidělení role.";
      await store.A.signOut(store.auth);
      return;
    }
    role = r;
    me = { uid: u.uid, email: u.email };
    $("#login").hidden = true;
    $("#app").hidden = false;
    $("#modeBadge").textContent = r === "owner" ? "Online · majitel" : "Online · " + (u.email || "editor");
    $("#modeBadge").className = "badge cloud";
    await store.start(render);
  });
}

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#loginError").textContent = "";
  try {
    await store.A.signInWithEmailAndPassword(store.auth, $("#email").value.trim(), $("#password").value);
  } catch (err) {
    $("#loginError").textContent = "Přihlášení se nepovedlo. Zkontroluj e-mail a heslo.";
  }
});
$("#logoutBtn").addEventListener("click", () => store.A.signOut(store.auth));

/* ---------- navigace ---------- */
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]");
  if (!b) return;
  view = b.dataset.view;
  render();
});
$("#newBtn").addEventListener("click", () => openPost());
$("#menuBtn").addEventListener("click", (e) => { e.stopPropagation(); $("#menu").hidden = !$("#menu").hidden; });
document.addEventListener("click", (e) => { if (!e.target.closest("#menu")) $("#menu").hidden = true; });

$("#exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(posts, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tarus-planovac-${todayIso()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  $("#menu").hidden = true;
});
$("#importFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const list = JSON.parse(await f.text());
    if (!Array.isArray(list)) throw 0;
    await store.replaceAll(list);
    toast(`Obnoveno ${list.length} záznamů`);
  } catch { toast("Soubor se nepodařilo načíst"); }
  e.target.value = "";
  $("#menu").hidden = true;
});

/* ---------- vykreslení ---------- */
function applyRole() {
  const owner = role === "owner";
  $("#exportBtn").hidden = !owner;
  document.querySelector('label[for="importFile"]').hidden = !owner;
}

function render() {
  applyRole();
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "v-" + view));
  ({ prehled: renderOverview, kalendar: renderCalendar, napady: renderBoard })[view]();
}

const pill = (s) => `<span class="pill st-${s}">${STATUS[s] || s}</span>`;
const sorted = (l) => [...l].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
const meta = (p) => [p.format, (p.platforms || []).map((x) => PLAT[x] || x).join(" + ")].filter(Boolean).join(" · ");

function rowHtml(p, today) {
  const over = p.date && p.date < today && p.status !== "publikovano";
  return `<div class="row" data-id="${p.id}" tabindex="0" role="button">
    <span class="d ${over ? "over" : ""}">${fmtDate(p.date)}</span>
    <span class="t">${esc(p.title)}<small>${esc(meta(p))}</small>${tagsHtml(p)}</span>
    ${pill(p.status)}
  </div>`;
}

function emptyState() {
  return `<div class="empty"><p>Zatím tu nic není.</p>
    <div><button class="btn primary" data-act="seed">Načíst prosincový plán</button>
    <button class="btn" data-act="new">Přidat první nápad</button></div></div>`;
}

function renderOverview() {
  const el = $("#v-prehled");
  if (!posts.length) { el.innerHTML = emptyState(); return; }
  const today = todayIso();
  const count = (s) => posts.filter((p) => p.status === s).length;
  const overdue = posts.filter((p) => p.date && p.date < today && p.status !== "publikovano").length;
  const upcoming = sorted(posts.filter((p) => p.date && p.date >= today && p.status !== "publikovano")).slice(0, 6);
  const noDate = posts.filter((p) => !p.date && p.status !== "publikovano").slice(0, 6);
  const month = posts.filter((p) => p.date && p.date.slice(0, 7) === today.slice(0, 7)).length;
  el.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${count("napad")}</b><span>nápadů</span></div>
      <div class="stat"><b>${count("pripravuje") + count("pripraveno")}</b><span>v přípravě</span></div>
      <div class="stat"><b>${month}</b><span>v tomto měsíci</span></div>
      <div class="stat"><b>${posts.filter((p) => p.status !== "publikovano" && !isOk(p)).length}</b><span>čeká na Roberta</span></div>
      <div class="stat ${overdue ? "bad" : ""}"><b>${overdue}</b><span>po termínu</span></div>
      <div class="stat"><b>${count("publikovano")}</b><span>zveřejněno</span></div>
    </div>
    <div class="cols">
      <div class="panel"><header><h2>Nejbližší termíny</h2></header>
        ${upcoming.length ? upcoming.map((p) => rowHtml(p, today)).join("") : '<p class="muted">Nic naplánováno.</p>'}
      </div>
      <div class="panel"><header><h2>Nápady bez data</h2></header>
        ${noDate.length ? noDate.map((p) => rowHtml(p, today)).join("") : '<p class="muted">Všechno má termín.</p>'}
      </div>
    </div>`;
}

function renderCalendar() {
  const el = $("#v-kalendar");
  const first = new Date(cur.y, cur.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(cur.y, cur.m, 1 - lead);
  const today = todayIso();
  let cells = DOW.map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const k = iso(d);
    if (i >= 35 && d.getMonth() !== cur.m) break;
    const items = posts.filter((p) => p.date === k);
    cells += `<div class="day ${d.getMonth() !== cur.m ? "out" : ""} ${k === today ? "today" : ""}" data-date="${k}">
      <span class="n">${d.getDate()}</span>
      ${items.map((p) => `<button class="chip st-${p.status}" data-id="${p.id}" title="${esc(p.title)}"><span>${isOk(p) ? "✓ " : ""}${esc(p.title)}</span></button>`).join("")}
    </div>`;
  }
  el.innerHTML = `
    <div class="cal-head">
      <button class="btn" data-nav="-1" aria-label="Předchozí měsíc">←</button>
      <h2>${MONTHS[cur.m]} ${cur.y}</h2>
      <button class="btn" data-nav="1" aria-label="Další měsíc">→</button>
      <button class="btn ghost" data-nav="0">Dnes</button>
    </div>
    <div class="cal">${cells}</div>`;
}

function renderBoard() {
  const el = $("#v-napady");
  if (!posts.length) { el.innerHTML = emptyState(); return; }
  const grip = role === "owner" ? `<span class="grip" title="Přetáhni do jiného sloupce" aria-hidden="true">⠿</span>` : "";
  el.innerHTML = `<div class="board">${Object.keys(STATUS).map((s) => {
    const items = sorted(posts.filter((p) => p.status === s));
    return `<div class="col" data-status="${s}"><h3><span class="st-${s}">${STATUS[s]}</span><span class="muted">${items.length}</span></h3>${STATUS_HINT[s] ? `<small class="muted hint">${STATUS_HINT[s]}</small>` : ""}
      ${items.map((p) => `<div class="card" data-id="${p.id}" tabindex="0" role="button">
        <strong>${grip}${esc(p.title)}</strong>
        <div class="meta"><span>${fmtDate(p.date)}</span><span>${esc(meta(p))}</span>${(p.comments || []).length ? `<span>💬 ${p.comments.length}</span>` : ""}</div>
        ${tagsHtml(p)}
      </div>`).join("") || '<p class="muted">Prázdné</p>'}
    </div>`;
  }).join("")}</div>`;
}

/* ---------- přetahování (myš i dotyk) ---------- */
// Karty se mezi sloupci stavů přetahují myší kdekoli, na dotyku za úchyt ⠿ (aby šlo dál scrollovat).
// Položky v kalendáři se přetahují na jiný den myší; na telefonu změň datum v detailu.
let drag = null;
let justDragged = false;

function dropTarget(x, y, el) {
  const sel = el.matches(".card") ? ".col[data-status]" : ".day[data-date]";
  return document.elementFromPoint(x, y)?.closest(sel) || null;
}
function endDrag() {
  if (!drag) return;
  drag.ghost?.remove();
  drag.el.classList.remove("dragging");
  document.querySelectorAll(".drop-over").forEach((n) => n.classList.remove("drop-over"));
  document.body.classList.remove("is-dragging");
  drag = null;
}
document.addEventListener("pointerdown", (e) => {
  if (role !== "owner" || e.button > 0) return;
  const grip = e.target.closest(".grip");
  const el = grip ? grip.closest(".card") : e.pointerType === "mouse" ? e.target.closest(".card[data-id], .chip[data-id]") : null;
  if (!el) return;
  drag = { el, x: e.clientX, y: e.clientY, on: false, ghost: null, dx: 0, dy: 0 };
});
document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    const r = drag.el.getBoundingClientRect();
    drag.on = true;
    drag.dx = e.clientX - r.left;
    drag.dy = e.clientY - r.top;
    drag.ghost = drag.el.cloneNode(true);
    drag.ghost.classList.add("drag-ghost");
    drag.ghost.style.width = r.width + "px";
    document.body.append(drag.ghost);
    drag.el.classList.add("dragging");
    document.body.classList.add("is-dragging");
  }
  drag.ghost.style.left = e.clientX - drag.dx + "px";
  drag.ghost.style.top = e.clientY - drag.dy + "px";
  document.querySelectorAll(".drop-over").forEach((n) => n.classList.remove("drop-over"));
  dropTarget(e.clientX, e.clientY, drag.el)?.classList.add("drop-over");
});
document.addEventListener("pointerup", async (e) => {
  if (!drag) return;
  if (drag.on) {
    justDragged = true;
    setTimeout(() => (justDragged = false), 60);
    const t = dropTarget(e.clientX, e.clientY, drag.el);
    const id = drag.el.dataset.id;
    const p = posts.find((x) => x.id === id);
    endDrag();
    if (t && p) {
      try {
        if (t.dataset.status && t.dataset.status !== p.status) { await store.update(id, { status: t.dataset.status }); toast("Přesunuto: " + STATUS[t.dataset.status]); }
        else if (t.dataset.date && t.dataset.date !== p.date) { await store.update(id, { date: t.dataset.date }); toast("Nový termín: " + fmtDate(t.dataset.date)); }
      } catch (err) { toast("Přesun se nepovedl: " + (err.code || err.message)); }
    }
  } else endDrag();
});
document.addEventListener("pointercancel", endDrag);

/* delegace kliků v pohledech */
document.addEventListener("change", async (e) => {
  const box = e.target.closest("input[data-ok]");
  if (!box) return;
  try { await store.update(box.dataset.ok, { approved: box.checked }); toast(box.checked ? "Schváleno Robertem" : "Schválení zrušeno"); }
  catch (err) { box.checked = !box.checked; toast("Uložení se nepovedlo: " + (err.code || err.message)); }
});
document.addEventListener("click", (e) => {
  if (justDragged || e.target.closest(".okbox")) return;
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "seed") return seed();
  if (act === "new") return openPost();
  const nav = e.target.closest("[data-nav]");
  if (nav) {
    const n = +nav.dataset.nav;
    if (n === 0) { const d = new Date(); cur = { y: d.getFullYear(), m: d.getMonth() }; }
    else { const d = new Date(cur.y, cur.m + n, 1); cur = { y: d.getFullYear(), m: d.getMonth() }; }
    return renderCalendar();
  }
  const item = e.target.closest(".row[data-id], .card[data-id], .chip[data-id]");
  if (item) return openPost(posts.find((p) => p.id === item.dataset.id));
  const day = e.target.closest(".day[data-date]");
  if (day) openPost(null, day.dataset.date);
});
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".row[data-id], .card[data-id]")) {
    e.preventDefault();
    openPost(posts.find((p) => p.id === e.target.dataset.id));
  }
});

/* ---------- detail / editace ---------- */
function openPost(p, date) {
  const isNew = !p;
  const owner = role === "owner";
  const canEdit = owner;                       // editor jen přidává nové a komentuje
  const canFill = owner || isNew;
  const d = p || { title: "", format: "Reel", platforms: ["ig", "fb"], date: date || "", status: "napad", approved: false, captionIg: "", captionFb: "", captionYt: "", note: "", comments: [] };
  const f = $("#postForm");
  const ro = !canFill;
  f.innerHTML = `
    <header><h2>${isNew ? "Nový nápad" : "Detail příspěvku"}</h2>
      <button type="button" class="btn ghost" id="closeDlg" aria-label="Zavřít">✕</button></header>
    <div><label for="f-title">Název</label>
      ${ro ? `<div class="ro">${esc(d.title)}</div>` : `<input id="f-title" required maxlength="120" value="${esc(d.title)}">`}</div>
    <div class="grid2">
      <div><label for="f-format">Formát</label>
        ${ro ? `<div class="ro">${esc(d.format)}</div>` : `<select id="f-format">${FORMATS.map((x) => `<option ${x === d.format ? "selected" : ""}>${x}</option>`).join("")}</select>`}</div>
      <div><label for="f-date">Datum zveřejnění</label>
        ${ro ? `<div class="ro">${fmtDate(d.date)}</div>` : `<input id="f-date" type="date" value="${d.date || ""}">`}</div>
    </div>
    <div><label>Kde</label>
      ${ro ? `<div class="ro">${esc(meta(d))}</div>` : `<div class="checks">${Object.entries(PLAT).map(([k, v]) => `<label><input type="checkbox" id="f-${k}" ${(d.platforms || []).includes(k) ? "checked" : ""}> ${v}</label>`).join("")}</div>`}</div>
    <div class="grid2">
      <div><label for="f-status">Stav</label>
        ${owner ? `<select id="f-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === d.status ? "selected" : ""}>${v}${STATUS_HINT[k] ? " (" + STATUS_HINT[k] + ")" : ""}</option>`).join("")}</select>` : `<div class="ro">${STATUS[d.status]}</div>`}</div>
      <div><label>Robert</label>
        ${owner ? `<label class="okline"><input type="checkbox" id="f-approved" ${isOk(d) ? "checked" : ""}> Schváleno Robertem</label>` : `<div class="ro">${isOk(d) ? "Schváleno" : "Zatím neschváleno"}</div>`}</div>
    </div>
    <div class="caps"><label>Texty příspěvku</label>
      ${[["captionIg", "Instagram"], ["captionFb", "Facebook"], ["captionYt", "YouTube"]].map(([k, l]) => {
        const v = d[k] || "";
        const prev = v ? esc(v.replace(/\s+/g, " ").slice(0, 70)) + (v.length > 70 ? "…" : "") : "zatím bez textu";
        return `<details class="cap"><summary>${l} <small class="muted">${prev}</small></summary>
          ${ro ? `<div class="ro" id="f-${k}">${esc(v)}</div>` : `<textarea id="f-${k}" rows="9">${esc(v)}</textarea>`}
          <button type="button" class="btn" data-copy="f-${k}">Zkopírovat text</button></details>`;
      }).join("")}</div>
    <div><label for="f-note">Poznámky a nápady</label>
      ${ro ? `<div class="ro">${esc(d.note)}</div>` : `<textarea id="f-note">${esc(d.note)}</textarea>`}</div>
    ${!isNew ? `<div class="comments"><h3>Komentáře</h3>
      ${(d.comments || []).map((c) => `<div class="cm"><small>${esc(c.by)} · ${new Date(c.at).toLocaleString("cs-CZ")}</small>${esc(c.text)}</div>`).join("") || '<p class="muted">Zatím žádné.</p>'}
      <div class="cm-add"><input id="f-cm" placeholder="Připsat poznámku…" maxlength="500"><button type="button" class="btn" id="cmBtn">Přidat</button></div></div>` : ""}
    <div class="actions">
      ${!isNew && canEdit ? `<button type="button" class="btn danger" id="delBtn">Smazat</button>` : "<span></span>"}
      <div class="r"><button type="button" class="btn" id="cancelBtn">Zavřít</button>
      ${canFill ? `<button type="submit" class="btn primary">Uložit</button>` : ""}</div>
    </div>`;
  const dlg = $("#dlg");
  dlg.showModal();
  const close = () => dlg.close();
  $("#closeDlg").onclick = close;
  $("#cancelBtn").onclick = close;
  f.querySelectorAll("[data-copy]").forEach((b) => {
    b.onclick = async () => {
      const el = $("#" + b.dataset.copy);
      const text = el.value ?? el.textContent;
      try { await navigator.clipboard.writeText(text); toast("Text zkopírován"); }
      catch {
        const det = b.closest("details");
        el.focus?.();
        const r = document.createRange(); r.selectNodeContents(el);
        if (el.select) el.select(); else { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
        toast("Text označen, zkopíruj ho Ctrl+C");
      }
    };
  });

  f.onsubmit = async (e) => {
    e.preventDefault();
    const platforms = Object.keys(PLAT).filter((k) => $("#f-" + k)?.checked);
    const data = {
      title: $("#f-title").value.trim(),
      format: $("#f-format").value,
      date: $("#f-date").value || "",
      platforms,
      status: owner ? $("#f-status").value : "napad",
      approved: owner ? $("#f-approved").checked : false,
      captionIg: $("#f-captionIg").value,
      captionFb: $("#f-captionFb").value,
      captionYt: $("#f-captionYt").value,
      note: $("#f-note").value,
    };
    if (!data.title) return;
    try {
      if (isNew) await store.add({ ...data, comments: [], createdBy: me.uid, createdAt: Date.now() });
      else await store.update(p.id, data);
      toast("Uloženo");
      close();
    } catch (err) { toast("Uložení se nepovedlo: " + (err.code || err.message)); }
  };

  const addComment = async () => {
    const inp = $("#f-cm");
    const text = inp.value.trim();
    if (!text) return;
    try {
      await store.comment(p.id, { by: me.email, text, at: Date.now() });
      toast("Poznámka přidána");
      close();
    } catch (err) { toast("Nepovedlo se: " + (err.code || err.message)); }
  };
  $("#cmBtn")?.addEventListener("click", addComment);
  $("#f-cm")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addComment(); } });

  $("#delBtn")?.addEventListener("click", async function () {
    if (this.dataset.sure !== "1") { this.dataset.sure = "1"; this.textContent = "Opravdu smazat?"; return; }
    try { await store.remove(p.id); toast("Smazáno"); close(); } catch (err) { toast("Smazání se nepovedlo"); }
  });
}

/* ---------- ukázkový prosincový plán ---------- */
async function seed() {
  const y = new Date().getFullYear();
  const mk = (title, format, platforms, date, status, note) => ({
    title, format, platforms, date: date ? `${y}-${date}` : "", status, caption: "", note, comments: [], createdBy: me.uid, createdAt: Date.now(),
  });
  const list = [
    mk("Vánoční reel: Díky, že stavíte s námi", "Reel", ["ig", "fb"], "12-20", "napad", "Sklad, dodávky, tým. Klidnější hudba, sníh. Konec: Krásné Vánoce + tarus.cz. 10–12 s."),
    mk("Vánoční doba: otevírací doba a poslední expedice", "Post", ["fb", "ig"], "12-18", "napad", "Doplnit poslední den expedice a to, jestli e-shop přijímá objednávky o svátcích."),
    mk("Story: poslední objednávky před Vánoci", "Story", ["ig", "fb"], "12-16", "napad", "Připomenout 2–3 dny předem."),
    mk("Novoroční reel: Rok v číslech + PF", "Reel", ["ig", "fb"], "12-31", "napad", "Energické, drop. Čísla za rok od majitele. Konec: PF a tarus.cz. 12–15 s."),
    mk("Po svátcích: opět expedujeme", "Post", ["fb", "ig"], "01-02", "napad", "Datum prvního dne expedice doplnit."),
  ].map((p) => (p.date.startsWith(`${y}-01`) ? { ...p, date: `${y + 1}-01-02` } : p));
  try { for (const p of list) await store.add(p); toast("Plán načten"); } catch { toast("Nepodařilo se načíst plán"); }
}

boot();
