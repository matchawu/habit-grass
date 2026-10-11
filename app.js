const MAX_H = 5;
const HUES = ["green", "blue", "orange", "purple", "pink"];
const LEGACY_PTS = [0, 1, 2, 3, 4];
const HABIT_TEMPLATES = [
  { name: "重訓", color: "green", type: "level", levels: [{ label: "輕鬆", pts: 1 }, { label: "普通", pts: 2 }, { label: "認真", pts: 3 }, { label: "爆汗", pts: 4 }] },
  { name: "跑步", color: "blue", type: "level", levels: [{ label: "3 公里內", pts: 1 }, { label: "5 公里", pts: 2 }, { label: "10 公里以上", pts: 4 }] },
  { name: "線上課程", color: "purple", type: "level", levels: [{ label: "看一半", pts: 1 }, { label: "看完一堂", pts: 2 }, { label: "看完加練習", pts: 3 }] },
];
const EMOJIS = ["🍔", "🍟", "🧋", "🍰", "🍣", "🍺", "☕", "🎮", "🎬", "👟", "🛍️", "💆"];
const COLORS = ["red", "yellow", "blue", "pink", "ink"];
const COUPON_TEMPLATES = [
  { name: "麥當勞大麥克套餐", cost: 20, qty: 3, emoji: "🍔", color: "red", note: "" },
  { name: "一杯手搖飲", cost: 8, qty: 5, emoji: "🧋", color: "yellow", note: "全糖也可以" },
  { name: "新的訓練鞋", cost: 200, qty: 1, emoji: "👟", color: "blue", note: "" },
];
const WD = ["日", "一", "二", "三", "四", "五", "六"];

let S = { habits: {}, logs: {}, days: {}, rewards: {}, redemptions: {} };
let E = {};
let backend = null;
let viewYear = new Date().getFullYear();
let confirming = null, deleting = null, deletingHabit = null, editingDay = null, flashId = null;
let hDraft = null;

const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "text") n.textContent = v;
    else if (k === "style") n.style.cssText = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
  return n;
}
const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtDay = (k) => { const d = parseKey(k); return `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`; };
const iso = () => new Date().toISOString();
const BACKFILL_DAYS = 3;
function canBackfill(k) {
  const now = new Date();
  const min = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - BACKFILL_DAYS));
  return k >= min && k <= key(now);
}
const hueVar =(c) => `--hc:var(--hue-${HUES.includes(c) ? c : "green"})`;

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}
/* ---------- derived ---------- */
const levelsOf = (h) => h.type === "check" ? [{ label: "完成", pts: Number(h.pts) || 1 }] : (h.levels || []);
const maxPts = (h) => Math.max(0, ...levelsOf(h).map((l) => Number(l.pts) || 0));
function habitList() {
  return Object.entries(S.habits).sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));
}
function buildEntries() {
  const m = {};
  for (const [d, v] of Object.entries(S.days)) (m.gym ||= {})[d] = { level: v.level, pts: LEGACY_PTS[v.level] || 0 };
  for (const v of Object.values(S.logs)) if (v && v.habit && v.date) (m[v.habit] ||= {})[v.date] = { level: v.level, pts: Number(v.pts) || 0 };
  return m;
}
function allEntries() { return Object.values(E).flatMap((byDay) => Object.entries(byDay)); }
const earned = () => allEntries().reduce((s, [, v]) => s + v.pts, 0);
const spent = () => Object.values(S.redemptions).reduce((s, r) => s + (Number(r.cost) || 0), 0);
const balance = () => earned() - spent();
function shadeFor(h, level) {
  if (!level) return 0;
  const n = levelsOf(h).length || 1;
  return Math.min(4, Math.max(1, Math.ceil((level / n) * 4)));
}

/* ---------- storage (this device only) ---------- */
const LS = "gym-grass-v1";
const META = "habit-grass-meta";
function seedGym() { return { ...HABIT_TEMPLATES[0], order: 0, createdAt: iso() }; }
function readMeta() { try { return JSON.parse(localStorage.getItem(META) || "{}"); } catch (e) { return {}; } }
function writeMeta(patch) { try { localStorage.setItem(META, JSON.stringify({ ...readMeta(), ...patch })); } catch (e) {} }
function normalize(o) {
  return { habits: o.habits || {}, logs: o.logs || {}, days: o.days || {}, rewards: o.rewards || {}, redemptions: o.redemptions || {} };
}

function localBackend() {
  let seeded = false;
  try {
    const o = JSON.parse(localStorage.getItem(LS) || "null");
    if (o) { S = normalize(o); seeded = !!o.seeded; }
  } catch (e) {}
  const save = () => {
    try { localStorage.setItem(LS, JSON.stringify({ ...S, seeded: true })); }
    catch (e) { toast("沒有存成功，手機的儲存空間可能滿了"); }
    render();
  };
  if (!seeded && !Object.keys(S.habits).length) { S.habits = { gym: seedGym() }; }
  const id = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const without = (o, k) => { const c = { ...o }; delete c[k]; return c; };
  return {
    save,
    replaceAll(data) { S = normalize(data); save(); },
    setLog(hid, date, level, pts) {
      const k = hid + "__" + date;
      S.logs = level ? { ...S.logs, [k]: { habit: hid, date, level, pts, updatedAt: iso() } } : without(S.logs, k);
      if (hid === "gym") S.days = without(S.days, date);
      save();
    },
    saveHabit(hid, data) { S.habits = { ...S.habits, [hid || id("h")]: data }; save(); },
    delHabit(hid) { S.habits = without(S.habits, hid); save(); },
    addReward(r) { S.rewards = { ...S.rewards, [id("r")]: r }; save(); },
    delReward(i) { S.rewards = without(S.rewards, i); save(); },
    updateReward(i, patch) { if (S.rewards[i]) { S.rewards = { ...S.rewards, [i]: { ...S.rewards[i], ...patch } }; save(); } },
    redeem(r) { S.redemptions = { ...S.redemptions, [id("x")]: r }; save(); },
  };
}

/* ---------- backup ---------- */
function renderBackup() {
  const last = readMeta().lastBackup;
  const hasData = Object.keys(S.logs).length + Object.keys(S.days).length > 0;
  const p = $("lastBackup");
  if (!last) { p.textContent = hasData ? "還沒有備份過。" : ""; p.className = hasData ? "warn" : ""; return; }
  const days = Math.floor((Date.now() - new Date(last)) / 86400000);
  p.textContent = `上次備份：${days === 0 ? "今天" : days + " 天前"}`;
  p.className = days >= 7 ? "warn" : "";
}
async function exportData() {
  const payload = { app: "habit-grass", version: 1, exportedAt: iso(), ...S };
  const name = `habit-grass-backup-${key(new Date())}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
    } else {
      const a = el("a", { href: URL.createObjectURL(blob), download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
    writeMeta({ lastBackup: iso() }); renderBackup(); toast("備份檔已匯出");
  } catch (e) {
    if (e?.name !== "AbortError") toast("匯出失敗：" + (e?.message || "請再試一次"));
  }
}
function askImport(data) {
  const box = $("importConfirm");
  const n = (o) => Object.keys(o || {}).length;
  const when = data.exportedAt ? new Date(data.exportedAt).toLocaleDateString("zh-TW") : "不明日期";
  box.replaceChildren(
    el("span", { text: `這份備份（${when}）有 ${n(data.habits)} 個習慣、${n(data.logs) + n(data.days)} 筆打卡、${n(data.rewards)} 張券。匯入後會取代這支手機上目前的所有資料。` }),
    el("div", { class: "row" },
      el("button", { class: "btn", text: "取代並匯入", onclick: () => { backend.replaceAll(data); box.hidden = true; toast("匯入完成"); } }),
      el("button", { class: "btn ghost", text: "取消", onclick: () => { box.hidden = true; } })),
  );
  box.hidden = false;
}
$("exportBtn").onclick = exportData;
$("importFile").addEventListener("change", async (e) => {
  const f = e.target.files?.[0]; e.target.value = "";
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || typeof data !== "object" || typeof data.habits !== "object") throw new Error("bad");
    askImport(data);
  } catch (err) { toast("這不是習慣草地的備份檔"); }
});

/* ---------- habit rows (today + day dialog) ---------- */
function setLog(hid, h, date, level) {
  const lv = levelsOf(h)[level - 1];
  backend.setLog(hid, date, level, level ? Number(lv?.pts) || 0 : 0);
  if (level) toast(`${h.name}：${lv.label} +${lv.pts} 點`);
}
function habitRow(hid, h, date) {
  const cur = E[hid]?.[date];
  const lvls = levelsOf(h);
  const curLv = cur?.level || 0;
  return el("div", { class: "hrow", style: hueVar(h.color) },
    el("div", { class: "hname" }, el("i", { class: "dot" }), el("b", { text: h.name }),
      cur ? el("small", { text: `+${cur.pts} 點` }) : null),
    el("div", { class: "pills" }, lvls.map((l, i) => el("button", {
      class: "pill", "aria-pressed": String(curLv === i + 1), disabled: !backend,
      onclick: () => setLog(hid, h, date, curLv === i + 1 ? 0 : i + 1),
    }, l.label, el("small", { text: ` +${l.pts}` })))),
  );
}

/* ---------- render ---------- */
function renderToday() {
  const k = key(new Date());
  const list = habitList();
  const done = list.filter(([id]) => E[id]?.[k]).length;
  const title = !list.length ? "還沒有習慣" : done === list.length ? "今天全部完成，做得好" : `今天完成 ${done} / ${list.length}`;
  $("today").replaceChildren(
    el("div", {}, el("div", { class: "eyebrow", text: "今天 · " + fmtDay(k) }), el("h2", { text: title })),
    list.length
      ? el("div", { class: "hlist" }, list.map(([id, h]) => habitRow(id, h, k)))
      : el("div", { class: "today-empty" }, el("span", { text: "先新增一個習慣，就能開始打卡。" }), el("button", { class: "btn", text: "＋ 新增習慣", disabled: !backend, onclick: () => openHabit() })),
  );
}

function renderStats() {
  const now = new Date(); const ym = key(now).slice(0, 7); const y = String(now.getFullYear());
  const all = allEntries();
  const stat = (label, n, unit, cls = "") => el("div", { class: "stat " + cls }, el("span", { class: "eyebrow", text: label }), el("span", { class: "num" }, String(n), el("small", { text: unit })));
  $("stats").replaceChildren(
    stat("錢包點數", balance(), "點", "points"),
    stat(`${now.getMonth() + 1} 月打卡`, all.filter(([d]) => d.startsWith(ym)).length, "次"),
    stat(`${y} 年打卡`, all.filter(([d]) => d.startsWith(y)).length, "次"),
  );
}

function buildGrass(cellFor, small) {
  const todayK = key(new Date());
  const start = new Date(viewYear, 0, 1);
  const gridStart = new Date(viewYear, 0, 1 - start.getDay());
  const end = new Date(viewYear, 11, 31);
  const cells = [], months = [];
  let col = 0;
  for (let d = new Date(gridStart); d <= end || d.getDay() !== 0; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 && d > gridStart) col++;
    const k = key(d);
    if (d.getFullYear() !== viewYear) { cells.push(el("span", { class: "c out" })); continue; }
    if (d.getDate() === 1) months.push({ col, m: d.getMonth() });
    const { l, tip } = cellFor(k);
    const label = `${fmtDay(k)} · ${tip}`;
    cells.push(k > todayK
      ? el("span", { class: "c future", "data-l": l })
      : !canBackfill(k)
        ? el("span", { class: "c", "data-l": l, title: label, role: "img", "aria-label": label })
        : el("button", { class: "c" + (k === todayK ? " is-today" : ""), "data-l": l, title: label + "（可補登）", "aria-label": label + "，可補登", onclick: () => openDay(k) }));
  }
  const monthRow = el("div", { class: "months" });
  for (let i = 0; i <= col; i++) {
    const m = months.find((x) => x.col === i);
    monthRow.append(el("span", { text: m ? `${m.m + 1}月` : "" }));
  }
  const wd = el("div", { class: "wd" }, WD.map((w, i) => el("span", { text: i % 2 ? w : "" })));
  return el("div", { class: "grass" + (small ? " small" : "") }, el("span"), monthRow, wd, el("div", { class: "cells" }, cells));
}

function renderOverview() {
  $("yearLabel").textContent = viewYear;
  $("nextY").disabled = viewYear >= new Date().getFullYear();
  const list = habitList();
  const cap = list.reduce((s, [, h]) => s + maxPts(h), 0) || 1;
  $("overview").replaceChildren(buildGrass((k) => {
    let pts = 0; const names = [];
    for (const [id, h] of list) { const e = E[id]?.[k]; if (e) { pts += e.pts; names.push(h.name); } }
    const l = pts ? Math.min(4, Math.max(1, Math.ceil((pts / cap) * 4))) : 0;
    return { l, tip: pts ? `${names.join("、")} · +${pts} 點` : "沒有打卡" };
  }));
}

function renderHabits() {
  const list = habitList();
  $("habitCount").textContent = `${list.length} / ${MAX_H} 個`;
  const y = String(viewYear);
  const cards = list.map(([id, h]) => {
    const byDay = E[id] || {};
    const count = Object.keys(byDay).filter((d) => d.startsWith(y)).length;
    const desc = levelsOf(h).map((l) => `${l.label} ${l.pts}`).join(" · ") + " 點";
    const actions = deletingHabit === id
      ? [el("span", { text: "刪掉這個習慣？已賺的點數會保留" }),
         el("button", { class: "mini", text: "保留", onclick: () => { deletingHabit = null; render(); } }),
         el("button", { class: "btn", text: "刪除", onclick: () => { deletingHabit = null; backend.delHabit(id); } })]
      : [el("span", {}, el("span", { class: "num", text: String(count) }), ` 次 · ${viewYear}`),
         el("button", { class: "mini", text: "編輯", disabled: !backend, onclick: () => openHabit(id) }),
         el("button", { class: "mini", text: "刪除", disabled: !backend, onclick: () => { deletingHabit = id; render(); } })];
    return el("div", { class: "card habit", style: hueVar(h.color) },
      el("div", { class: "habit-head" },
        el("div", {}, el("h3", {}, el("i", { class: "dot" }), h.name), el("p", { text: desc })),
        el("div", { class: "habit-side" }, actions)),
      el("div", { class: "grass-scroll", "data-sk": "h-" + id }, buildGrass((k) => {
        const e = byDay[k];
        const lv = e ? levelsOf(h)[e.level - 1] : null;
        return { l: e ? shadeFor(h, e.level) : 0, tip: e ? `${lv?.label || "完成"} +${e.pts}` : "沒有打卡" };
      }, true)),
    );
  });
  const used = new Set(list.map(([, h]) => h.name));
  const add = list.length >= MAX_H
    ? el("div", { class: "addhabit" }, el("p", { text: `已經有 ${MAX_H} 個習慣了。先把這幾個養穩，想換的話可以刪掉一個再加。` }))
    : el("div", { class: "addhabit" },
        el("p", { text: list.length >= 3 ? "同時養太多習慣容易全部放棄。確定還有餘力再加喔。" : "建議一次專心 3 個以內。" }),
        el("div", { class: "row" },
          el("button", { class: "btn", text: "＋ 新增習慣", disabled: !backend, onclick: () => openHabit() }),
          HABIT_TEMPLATES.filter((t) => !used.has(t.name)).map((t) =>
            el("button", { class: "chip", disabled: !backend, style: hueVar(t.color), text: `從範例：${t.name}`, onclick: () => openHabit(null, t) }))));
  $("habits").replaceChildren(...cards, add);
}

function qtyOf(r) { return r.qty == null ? Infinity : Math.max(0, Number(r.qty) || 0); }
function ticket(r, opts = {}) {
  const bal = balance();
  const cost = Number(r.cost) || 0;
  const left = qtyOf(r);
  const limited = left !== Infinity;
  const soldOut = left === 0;
  const ok = bal >= cost && !soldOut;
  const pct = Math.max(0, Math.min(100, cost ? (bal / cost) * 100 : 100));
  const state = soldOut ? " soldout" : (ok || opts.preview ? "" : " locked");
  const node = el("article", { class: "ticket" + state + (limited && left > 1 ? " stack" : "") + (opts.id && opts.id === flashId ? " flash" : ""), "data-c": r.color || "red" },
    el("div", { class: "stub" }, el("span", { class: "emo", text: r.emoji || "🎁" }), el("span", { class: "cost", text: String(cost) }), el("span", { class: "cost-u", text: "點" })),
  );
  const meta = el("div", { class: "tmeta" },
    el("span", { class: "qty" + (limited && left > 0 && left <= 1 ? " few" : ""), text: !limited ? "不限張數" : soldOut ? "用完了" : `剩 ${left} 張` }),
    limited && !opts.preview && !soldOut ? el("button", { class: "qplus", text: "＋1 張", disabled: !backend, onclick: () => backend.updateReward(opts.id, { qty: left + 1 }) }) : null);
  const body = el("div", { class: "tbody" }, el("div", {}, el("h3", { text: r.name || "未命名的獎勵" }), r.note ? el("div", { class: "tnote", text: r.note }) : null, meta));
  if (opts.preview) {
    body.append(el("div", { class: "bar" }, el("i", { style: "width:60%" })), el("div", { class: "trow", text: "預覽" }));
  } else if (confirming === opts.id) {
    body.append(el("div", { class: "trow" }, el("span", { text: `用 ${cost} 點兌換一張？` }), el("span", { style: "display:flex;gap:6px" },
      el("button", { class: "btn ghost", text: "取消", onclick: () => { confirming = null; render(); } }),
      el("button", { class: "btn", text: "確定兌換", onclick: () => redeem(opts.id, r) }))));
  } else if (deleting === opts.id) {
    body.append(el("div", { class: "trow" }, el("span", { text: limited && left > 1 ? `刪掉剩下的 ${left} 張？` : "刪掉這張券？" }), el("span", { style: "display:flex;gap:6px" },
      el("button", { class: "btn ghost", text: "保留", onclick: () => { deleting = null; render(); } }),
      el("button", { class: "btn", text: "刪除", onclick: () => { deleting = null; backend.delReward(opts.id); } }))));
  } else if (soldOut) {
    body.append(el("div", { class: "trow" }, el("span", { text: "這張券都換完了" }),
      el("button", { class: "btn ghost", text: "再補 1 張", disabled: !backend, onclick: () => backend.updateReward(opts.id, { qty: 1 }) })));
    node.append(el("button", { class: "del", text: "刪除", "aria-label": "刪除這張券", disabled: !backend, onclick: () => { deleting = opts.id; confirming = null; render(); } }));
  } else {
    const need = cost - bal;
    const all = allEntries();
    const avg = all.length ? earned() / all.length : 2;
    body.append(
      el("div", { class: "bar" }, el("i", { style: `width:${pct}%` })),
      el("div", { class: "trow" },
        el("span", { text: ok ? "點數夠了，可以兌換" : `還差 ${need} 點，照你的平均大約再打卡 ${Math.ceil(need / Math.max(avg, 0.5))} 次` }),
        el("button", { class: "btn", text: "兌換", disabled: !ok || !backend, onclick: () => { confirming = opts.id; deleting = null; render(); } })),
    );
    node.append(el("button", { class: "del", text: "刪除", "aria-label": "刪除這張券", disabled: !backend, onclick: () => { deleting = opts.id; confirming = null; render(); } }));
  }
  node.insertBefore(body, node.children[1] || null);
  return node;
}

function renderCoupons() {
  const list = Object.entries(S.rewards).sort((a, b) => (qtyOf(a[1]) === 0) - (qtyOf(b[1]) === 0) || (a[1].cost || 0) - (b[1].cost || 0));
  $("coupons").replaceChildren(
    ...list.map(([id, r]) => ticket(r, { id })),
    el("button", { class: "newcard", disabled: !backend, onclick: () => openDesigner() },
      el("b", { text: "＋ 設計新的獎勵券" }), el("span", { text: "名稱、點數、圖示、顏色都由你決定" })),
  );
  $("templates").replaceChildren(...(list.length ? [] : [
    el("span", { text: "還沒有券？從範例開始改：" }),
    ...COUPON_TEMPLATES.map((t) => el("button", { class: "chip", disabled: !backend, text: `${t.emoji} ${t.name} ×${t.qty} · ${t.cost} 點`, onclick: () => openDesigner(t) })),
  ]));
}

function renderHistory() {
  const rows = Object.values(S.redemptions).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  $("history").replaceChildren(...(rows.length
    ? rows.map((r) => { const d = new Date(r.at); return el("div", { class: "xrow" },
        el("span", { class: "d num", text: isNaN(d) ? "" : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}` }),
        el("span", { class: "n", text: `${r.emoji || "🎁"} ${r.name}` }),
        el("span", { class: "p num", text: `−${r.cost}` })); })
    : [el("div", { class: "empty", text: "兌換過的獎勵會留在這裡，之後回頭看會很有成就感。" })]));
}

let scrolledYear = null;
function render() {
  E = buildEntries();
  const pos = {};
  document.querySelectorAll(".grass-scroll[data-sk]").forEach((s) => { pos[s.dataset.sk] = s.scrollLeft; });
  renderToday(); renderStats(); renderOverview(); renderHabits(); renderCoupons(); renderHistory(); renderBackup();
  const fresh = scrolledYear !== viewYear;
  document.querySelectorAll(".grass-scroll[data-sk]").forEach((s) => {
    const p = pos[s.dataset.sk];
    s.scrollLeft = !fresh && p != null ? p : (viewYear === new Date().getFullYear() ? s.scrollWidth : 0);
  });
  scrolledYear = viewYear;
  if (editingDay) renderDayDlg();
}

/* ---------- actions ---------- */
function redeem(id, r) {
  const left = qtyOf(r);
  if (balance() < r.cost || left === 0) return;
  confirming = null; flashId = id;
  if (left !== Infinity) backend.updateReward(id, { qty: left - 1 });
  backend.redeem({ rewardId: id, name: r.name, emoji: r.emoji, color: r.color, cost: Number(r.cost), at: iso() });
  toast(`${r.emoji || "🎁"} 兌換成功，去享受吧！`);
  render();
  setTimeout(() => { flashId = null; }, 600);
}

function renderDayDlg() {
  $("dayTitle").textContent = fmtDay(editingDay);
  const list = habitList();
  $("dayRows").replaceChildren(...(list.length ? list.map(([id, h]) => habitRow(id, h, editingDay)) : [el("div", { class: "empty", text: "還沒有習慣。" })]));
}
function openDay(k) { if (!canBackfill(k)) return; editingDay = k; renderDayDlg(); $("dayDlg").showModal(); }
$("dayDlg").addEventListener("close", () => { editingDay = null; });
$("dayClose").onclick = () => $("dayDlg").close();
$("prevY").onclick = () => { viewYear--; render(); };
$("nextY").onclick = () => { viewYear++; render(); };

/* habit editor */
$("hColor").replaceChildren(...HUES.map((c, i) => el("label", { title: c }, el("input", { type: "radio", name: "hcolor", value: c, id: "hc" + i }), el("span", { class: "sw", style: `background:var(--hue-${c})` }))));
let editingHabit = null;
function renderHabitEditor() {
  const isLevel = hDraft.type === "level";
  $("hLevelsField").hidden = !isLevel;
  $("hPtsField").hidden = isLevel;
  $("hLevels").replaceChildren(
    ...hDraft.levels.map((l, i) => el("div", { class: "lvrow" },
      el("input", { class: "inp", type: "text", id: "hl" + i, maxlength: "12", value: l.label, placeholder: `第 ${i + 1} 級`, "aria-label": `第 ${i + 1} 級名稱`, oninput: (e) => { hDraft.levels[i].label = e.target.value; } }),
      el("input", { class: "inp", type: "number", id: "hp" + i, min: "1", max: "99", value: l.pts, "aria-label": `第 ${i + 1} 級點數`, oninput: (e) => { hDraft.levels[i].pts = e.target.value; } }),
      el("button", { type: "button", class: "x", text: "×", "aria-label": "移除這一級", disabled: hDraft.levels.length <= 2, onclick: () => { hDraft.levels.splice(i, 1); renderHabitEditor(); } }))),
    hDraft.levels.length < 4 ? el("div", {}, el("button", { type: "button", class: "mini", text: "＋ 加一級", onclick: () => { hDraft.levels.push({ label: "", pts: (Number(hDraft.levels.at(-1)?.pts) || 1) + 1 }); renderHabitEditor(); } })) : null,
  );
}
function openHabit(id = null, tpl = null) {
  editingHabit = id;
  const src = id ? S.habits[id] : (tpl || { name: "", color: HUES.find((c) => !habitList().some(([, h]) => h.color === c)) || "green", type: "level", levels: [{ label: "少量", pts: 1 }, { label: "普通", pts: 2 }, { label: "很多", pts: 3 }] });
  hDraft = { name: src.name, color: src.color || "green", type: src.type || "level", pts: src.pts || 2,
    levels: (src.levels && src.levels.length ? src.levels : [{ label: "少量", pts: 1 }, { label: "普通", pts: 2 }]).map((l) => ({ ...l })) };
  const f = $("hForm");
  $("hTitle").textContent = id ? "編輯習慣" : "新增習慣";
  $("hName").value = hDraft.name; $("hPts").value = hDraft.pts;
  f.hcolor.value = hDraft.color; f.htype.value = hDraft.type;
  renderHabitEditor(); $("hDlg").showModal(); $("hName").focus();
}
$("hForm").addEventListener("change", (e) => {
  if (e.target.name === "htype") { hDraft.type = e.target.value; renderHabitEditor(); }
  if (e.target.name === "hcolor") hDraft.color = e.target.value;
});
$("hCancel").onclick = () => $("hDlg").close();
$("hForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("hName").value.trim(); if (!name) return;
  const data = { name, color: hDraft.color, type: hDraft.type };
  if (hDraft.type === "level") {
    const lv = hDraft.levels.map((l, i) => ({ label: String(l.label).trim() || `第 ${i + 1} 級`, pts: Math.max(1, parseInt(l.pts, 10) || 1) }));
    data.levels = lv;
  } else {
    data.pts = Math.max(1, parseInt($("hPts").value, 10) || 1);
  }
  const prev = editingHabit ? S.habits[editingHabit] : null;
  data.order = prev?.order ?? Date.now();
  data.createdAt = prev?.createdAt || iso();
  if (!editingHabit && habitList().length >= MAX_H) { toast(`最多 ${MAX_H} 個習慣`); return; }
  backend.saveHabit(editingHabit, data);
  $("hDlg").close(); toast(editingHabit ? `已更新「${name}」` : `新增了「${name}」`);
});

/* coupon designer */
$("cEmoji").replaceChildren(...EMOJIS.map((e, i) => el("label", {}, el("input", { type: "radio", name: "emoji", value: e, id: "ce" + i }), el("span", { class: "e", text: e }))));
$("cColor").replaceChildren(...COLORS.map((c, i) => el("label", { title: c }, el("input", { type: "radio", name: "color", value: c, id: "cc" + i }), el("span", { class: "sw", style: `background:var(--t-${c})` }))));
function draft() {
  const f = $("cForm");
  return { name: $("cName").value.trim(), cost: Math.max(1, parseInt($("cCost").value, 10) || 1), qty: $("cUnlimited").checked ? null : Math.min(99, Math.max(1, parseInt($("cQty").value, 10) || 1)), note: $("cNote").value.trim(), emoji: f.emoji.value || "🎁", color: f.color.value || "red" };
}
function renderPreview() { $("cPreview").replaceChildren(ticket(draft(), { preview: true })); }
function openDesigner(t = { name: "", cost: 20, qty: 1, note: "", emoji: "🍔", color: "red" }) {
  const f = $("cForm");
  $("cName").value = t.name; $("cCost").value = t.cost; $("cUnlimited").checked = t.qty === null; $("cQty").value = t.qty || 1; $("cQty").disabled = t.qty === null; $("cNote").value = t.note || "";
  f.emoji.value = t.emoji; f.color.value = t.color;
  renderPreview(); $("cDlg").showModal(); $("cName").focus();
}
$("cForm").addEventListener("input", renderPreview);
$("cForm").addEventListener("change", () => { $("cQty").disabled = $("cUnlimited").checked; renderPreview(); });
$("cCancel").onclick = () => $("cDlg").close();
$("cForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const d = draft(); if (!d.name) return;
  backend.addReward({ ...d, createdAt: iso() });
  $("cDlg").close(); toast(`${d.emoji} 「${d.name}」${d.qty ? ` ×${d.qty} 張` : ""}放進錢包了`);
});

/* ---------- boot ---------- */
backend = localBackend();
render();
navigator.storage?.persist?.().catch(() => {});

const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
if (!standalone && /iPhone|iPad|iPod/.test(navigator.userAgent) && !readMeta().hintClosed) $("installHint").hidden = false;
$("installHintClose").onclick = () => { $("installHint").hidden = true; writeMeta({ hintClosed: true }); };

if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
