"use strict";
// Deng Defter: volunteer task pages that keep working without internet.
// Task pages arrive encrypted (AES-GCM, key from the shared password); they run in an iframe with a small
// window.claude shim whose db calls land here, in IndexedDB. Every write also goes to an outbox that is
// sent when the network is back (or shared by hand as a file).
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// ---------- IndexedDB ----------
let dbp = null;
function idb() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open("deng-defter", 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("kv"); d.createObjectStore("docs"); d.createObjectStore("out", { keyPath: "id" }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store); let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const kvGet = (k) => tx("kv", "readonly", (s) => req(s.get(k)));
const kvSet = (k, v) => tx("kv", "readwrite", (s) => { s.put(v, k); });

// ---------- crypto ----------
let key = null, index = null, uid = null, name = "";
async function derive(pw) {
  const s = await (await fetch("salt.json")).json();
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw.trim()), "PBKDF2", false, ["deriveKey"]);
  const salt = Uint8Array.from(atob(s.salt), (c) => c.charCodeAt(0));
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: s.iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}
async function openFile(url, k) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("fetch " + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, k || key, buf.slice(12));
  const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  return text;
}

const OPEN_PW = "deng"; // same as .parola; shown on the lock card
// ---------- boot ----------
(async () => {
  if ("serviceWorker" in navigator) { try { await navigator.serviceWorker.register("sw.js"); } catch (e) {} }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  uid = await kvGet("uid");
  if (!uid) { uid = "dd_" + Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14); await kvSet("uid", uid); }
  name = (await kvGet("name")) || "";
  key = await kvGet("key");
  // The link carries the password after "#" (never sent to the server): a tap on the link opens the app, no typing
  const fromLink = decodeURIComponent((location.hash || "").slice(1));
  if (fromLink) { try { history.replaceState(null, "", location.pathname); } catch (e) {} }
  if (!key && fromLink && await unlock(fromLink)) return;
  // the password is printed on the lock card anyway (volunteers are friends, Resul wants no typing): try it before asking
  if (!key && await unlock(OPEN_PW)) return;
  if (!key) { $("lock").hidden = false; return; }
  await afterUnlock();
})();

async function unlock(pw) {
  try {
    const k = await derive(pw);
    const txt = await openFile("data/index.bin", k);
    key = k; index = JSON.parse(txt);
    await kvSet("key", k); await kvSet("index", index);
    $("lock").hidden = true; $("pw").value = "";
    await afterUnlock(true);
    return true;
  } catch (err) { return false; }
}

$("lockForm").onsubmit = async (e) => {
  e.preventDefault();
  const pw = $("pw").value; $("pwBtn").disabled = true; $("pwErr").hidden = true;
  if (!(await unlock(pw))) {
    $("pwErr").textContent = navigator.onLine ? "Peyv şaş e. · Parola yanlış." : "Ji bo cara pêşî înternet lazim e. · İlk açılış için internet gerekli.";
    $("pwErr").hidden = false;
  }
  $("pwBtn").disabled = false;
};
// ---------- who: a name and a picture, nothing to write down ----------
// 21.11 (Resul): "people are forgetful, a letter-and-digit code gets forgotten, nobody saves it anywhere". The name and
// one picture from a short list are the whole key: on another phone the same name and the same picture bring the work back.
// Claude links the devices from the kimlik/<uid> records (kontrol/hub/kimlik.py); a picture is no password, just a reminder.
const SIGNS = [["sev", "🍎", "Sêv", "elma"], ["hirmi", "🍐", "Hirmî", "armut"], ["tiri", "🍇", "Tirî", "üzüm"], ["gelaz", "🍒", "Gêlaz", "kiraz"],
  ["xox", "🍑", "Xox", "şeftali"], ["zebes", "🍉", "Zebeş", "karpuz"], ["gul", "🌹", "Gul", "gül"], ["gulberojk", "🌻", "Gulberojk", "ayçiçeği"],
  ["lale", "🌷", "Lale", "lale"], ["dar", "🌳", "Dar", "ağaç"], ["ciya", "🏔️", "Çiya", "dağ"], ["sterk", "⭐", "Stêrk", "yıldız"],
  ["heyv", "🌙", "Heyv", "ay"], ["roj", "☀️", "Roj", "güneş"], ["berx", "🐑", "Berx", "kuzu"], ["hesp", "🐎", "Hesp", "at"],
  ["cuk", "🐦", "Çûk", "kuş"], ["pinpinik", "🦋", "Pinpinîk", "kelebek"], ["masi", "🐟", "Masî", "balık"], ["meshingiv", "🐝", "Mêşhingiv", "arı"],
  ["kevok", "🕊️", "Kevok", "güvercin"], ["xezal", "🦌", "Xezal", "ceylan"], ["bizin", "🐐", "Bizin", "keçi"], ["genim", "🌾", "Genim", "buğday"]];
const signOf = (key) => SIGNS.find((s) => s[0] === key);
let sign = "", pickedSign = "";
function signGrid(box, current, onPick) {
  box.textContent = "";
  for (const [key, emo, ku, tr] of SIGNS) {
    const b = el("button", "sg" + (key === current ? " on" : ""), emo);
    b.type = "button"; b.title = `${ku} · ${tr}`; b.setAttribute("aria-label", `${ku} · ${tr}`); b.setAttribute("aria-pressed", String(key === current));
    b.onclick = () => { onPick(key); signGrid(box, key, onPick); };
    box.append(b);
  }
}
const signText = (key) => { const s = signOf(key) || SIGNS[0]; return `${s[1]} ${s[2]} · ${s[3]}`; };
function showWho() {
  $("who").hidden = false;
  pickedSign = pickedSign || SIGNS[Math.floor(Math.random() * SIGNS.length)][0];
  const lbl = () => { $("signLbl").textContent = "Nîşana te · Resmin: " + signText(pickedSign); };
  signGrid($("signs"), pickedSign, (key) => { pickedSign = key; lbl(); }); lbl();
}
// names are matched as hashes (gecmis.py does the same): lower case, no accents, letters and digits only
function norm(s) { return (s || "").toLowerCase().replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
async function h16(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16); }
async function nameMatches(v) {
  const n = norm(v); if (!n) return [];
  const hs = [await h16(n), await h16(n.split(" ")[0])];
  return (index.people || []).filter((p) => (p.names || []).some((x) => hs.includes(x)));
}
function taskName(id) {
  const t = (index.tasks || []).find((x) => x.id === id) || (index.old || []).find((x) => x.id === id);
  return t ? t.ku : id === "gorus" ? "Nêrîn · Görüş" : id;
}
function taskSummary(p) {
  return Object.entries(p.tasks || {}).map(([id, v]) => `${taskName(id)} ${v.total && v.n >= v.total ? "✓" : v.total ? v.n + "/" + v.total : v.n}`).join(" · ");
}
$("whoForm").onsubmit = async (e) => {
  e.preventDefault();
  const v = $("nav").value.trim(); if (!v) return;
  const cands = await nameMatches(v);
  const same = cands.find((p) => p.s && p.s === pickedSign);
  if (same) return finishWho(v, same);       // same name, same picture: this is them
  if (cands.length) return askClaim(v, cands);
  finishWho(v, null);
};
function askClaim(v, cands) {
  const box = $("claim"); box.textContent = ""; box.hidden = false;
  box.append(el("h2", null, "Ev tu yî? · Bu sen misin?"),
    el("p", "tr", "Bi vî navî berê kar hatiye kirin. Heke ev tu bî, keda te ya berê tê vê telefonê. · Bu adla daha önce iş yapılmış. Sen isen önceki emeğin bu telefona gelir."));
  for (const p of cands.slice(0, 3)) {
    const c = el("div", "claimrow");
    c.append(el("p", null, `${p.s && signOf(p.s) ? signOf(p.s)[1] + " " : ""}${p.d} · ${p.p} xal`), el("p", "tr", taskSummary(p)));
    const yes = el("button", "primary", "Erê, ev ez im · Evet, benim"); yes.type = "button"; yes.onclick = () => finishWho(v, p);
    c.append(yes); box.append(c);
  }
  const no = el("button", null, "Na, ez kesekî din im · Hayır, başka biriyim"); no.type = "button"; no.onclick = () => finishWho(v, null);
  box.append(no); box.scrollIntoView({ behavior: "smooth", block: "start" });
}
let imported = 0;
async function finishWho(v, person) {
  name = v; sign = pickedSign; await kvSet("name", name); await kvSet("sign", sign);
  if (person) await kvSet("pid", person.pid);
  $("who").hidden = true; $("claim").hidden = true;
  if (person) imported = await importHistory(person);
  await saveKimlik();
  await showTasks(); download(); window.scrollTo(0, 0);
}
async function saveKimlik() {
  await write("kimlik", `kimlik/${uid}`, "set", { name, code: myCode(), sign, link: (await kvGet("pid")) || "", hide: !!(await kvGet("hide")), at: new Date().toISOString() });
}
// the person this device belongs to: claimed by name, or linked by Claude from an earlier record
async function findMe() {
  const people = index.people || [], pid = await kvGet("pid");
  if (pid) return people.find((p) => p.pid === pid) || null;
  const hh = await h16(uid), p = people.find((x) => (x.dev || []).includes(hh));
  if (p) await kvSet("pid", p.pid);
  return p || null;
}
// the person's documents of the still-open tasks go under this device's id, so each task opens where they stopped
async function importHistory(person) {
  if (!person || !person.file || (await kvGet("hist-" + person.pid)) === person.file) return 0;
  let h; try { h = JSON.parse(await openFile(person.file)); } catch (e) { return 0; }
  const fill = (x) => (Array.isArray(x) ? x.map(fill) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([a, b]) => [a, fill(b)])) : x === "{uid}" ? uid : x);
  let n = 0;
  await tx("docs", "readwrite", async (s) => {
    for (const d of h.docs) {
      const path = d.path.split("{uid}").join(uid), data = fill(d.data), kk = k(d.task, path), old = await req(s.get(kk));
      const better = path.startsWith("katki-") ? !old || (old.n || 0) < (data.n || 0) : old === undefined;
      if (better) { s.put(data, kk); n++; }
    }
  });
  await kvSet("hist-" + person.pid, person.file);
  return n;
}

async function afterUnlock(fresh) {
  if (!fresh) {
    try { index = JSON.parse(await openFile("data/index.bin")); await kvSet("index", index); }
    catch (e) {
      // a stored key that no longer opens the files (the password changed): ask again
      if (e && e.name === "OperationError") { key = null; await kvSet("key", null); if (await unlock(OPEN_PW)) return; $("lock").hidden = false; return; }
      index = await kvGet("index");
    }
  }
  if (!index) { $("lock").hidden = false; return; }
  if (!name) { showWho(); return; }
  sign = (await kvGet("sign")) || "";
  const me = await findMe();
  if (me) { imported = await importHistory(me); if (!sign && me.s) { sign = me.s; await kvSet("sign", sign); } }
  // a volunteer from before 21.11 has no picture yet: give one (shown on top, can be changed) and tell Claude
  if (!sign) { sign = SIGNS[Math.floor(Math.random() * SIGNS.length)][0]; await kvSet("sign", sign); await saveKimlik(); }
  else if (imported) await saveKimlik();
  seenToday();
  showTasks(); download();
}
// one small record a day says the app was opened, so a reminder never goes to someone who was just here
async function seenToday() {
  const day = new Date().toISOString().slice(0, 10);
  if ((await kvGet("seen")) === day) return;
  await kvSet("seen", day); await write("seen", `seen/${uid}`, "set", { day, at: new Date().toISOString() });
}

// ---------- download everything once, so it opens offline ----------
async function download() {
  const files = index.tasks.map((t) => t.file);
  let have = [];
  try { const c = await caches.open("defter-data"); have = (await c.keys()).map((r) => new URL(r.url).pathname.split("/").pop()); } catch (e) {}
  const need = files.filter((f) => !have.includes(f.split("/").pop()));
  const total = index.tasks.reduce((a, t) => a + (t.size || 0), 0);
  if (!need.length) { doneDl(total); return; }
  $("dl").hidden = false;
  let got = 0, fail = 0;
  for (const t of index.tasks) {
    if (!need.includes(t.file)) { got += t.size || 0; continue; }
    $("dlS").textContent = `${t.ku} · ${(got / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`;
    try { const r = await fetch(t.file); if (!r.ok) throw 0; await r.arrayBuffer(); got += t.size || 0; } catch (e) { fail++; }
    $("dlBar").style.width = (100 * got / Math.max(1, total)) + "%";
  }
  if (fail) {
    $("dlT").textContent = "Hin kar nehatin daxistin · Bazı işler inmedi";
    $("dlS").textContent = "Dema înternet hebe, sepanê dîsa veke. · İnternet varken uygulamayı yeniden aç.";
    return;
  }
  // drop files of older versions
  try { const c = await caches.open("defter-data"); for (const r of await c.keys()) { const p = new URL(r.url).pathname; if (p.includes("/data/") && !p.endsWith("index.bin") && !files.some((f) => p.endsWith(f))) await c.delete(r); } } catch (e) {}
  doneDl(total);
}
function doneDl(total) {
  $("dl").hidden = false;
  $("dlT").textContent = "✓ Hemû kar li ser vê cîhazê ne · Hepsi bu cihazda";
  $("dlBar").style.width = "100%";
  $("dlS").textContent = `Êdî bê înternet jî vedibin (${(total / 1e6).toFixed(1)} MB). · Artık internetsiz de açılır.`;
  installHint();
}
function installHint() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone) return;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  $("instText").textContent = ios
    ? "Vê rûpelê di Safari de veke → Parve bike (⬆︎) → Li Ekrana Sereke Zêde Bike. · Bu sayfayı Safari'de aç → Paylaş (⬆︎) → Ana Ekrana Ekle. WhatsApp'ın içinden açtıysan önce Safari'de aç."
    : "Menûya gerokê (⋮) → Sepanê saz bike / Li ekrana sereke zêde bike. · Tarayıcı menüsü (⋮) → Uygulamayı yükle / Ana ekrana ekle. Bilgisayarda adres çubuğundaki yükle simgesi.";
  $("install").hidden = false;
}

// ---------- task cards ----------
const IMP = { 3: "Pir girîng · Çok önemli", 2: "Girîng · Önemli", 1: "Asayî · Olağan" };
// 20.11 (Resul): a few warm words now and then, asking for feedback. Kurmanji first, Turkish under it.
const NUDGES = [
  ["Her nêrîneke te modela me hinekî din fêrî kurmancî dike.", "Her görüşün modelimize biraz daha Kurmancî öğretiyor."],
  ["Tiştek ne zelal bû? Bi hevokeke kurt ji me re binivîse, em dixwînin.", "Bir şey kafana mı takıldı? Bir cümleyle yaz, okuyoruz."],
  ["Te dizanibû? Bi saya guhdariya dilxwazan me dît ku dengê me hîn pirsan wek pirs naxwîne.", "Biliyor muydun? Gönüllülerin dinlemesi sayesinde sesimizin soruları hâlâ soru gibi okumadığını gördük."],
  ["Kîjan kar xweş bû, kîjan westiyayî? Bibêje, em sererast bikin.", "Hangi iş keyifliydi, hangisi yorucu? Söyle, düzeltelim."],
  ["Spas ji bo keda te! Te dengekî ecêb bihîst? Ji me re binivîse.", "Emeğin için teşekkürler! Garip bir ses mi duydun? Bize yaz."],
  ["Fikreke te heye ku kar hêsantir bibe? Em guhdar dikin.", "İşi kolaylaştıracak bir fikrin mi var? Dinliyoruz."],
];
function feedbackCard(justFinished) {
  const [ku, tr] = NUDGES[Math.floor(Math.random() * NUDGES.length)];
  const c = el("div", "card nudge");
  const top = el("div", "row");
  top.append(el("b", null, justFinished ? "Destê te sax be! · Eline sağlık!" : "Nêrîna te · Görüşün"));
  const x = el("button", "x", "×"); x.setAttribute("aria-label", "Bigire · Kapat"); x.onclick = () => c.remove(); top.append(x);
  c.append(top, el("p", null, ku), el("p", "tr", tr));
  const open = el("button", "primary", "Nêrîna xwe binivîse · Görüşünü yaz");
  const row = el("div", "row"); row.append(open); c.append(row);
  open.onclick = () => {
    row.remove();
    const ta = el("textarea"); ta.setAttribute("aria-label", "Nêrîn · Görüş"); ta.maxLength = 2000;
    const send = el("button", "primary", "Bişîne · Gönder"); const r2 = el("div", "row"); r2.append(send);
    c.append(ta, r2); ta.focus();
    send.onclick = async () => {
      const text = ta.value.trim(); if (!text) return;
      send.disabled = true;
      // same shape as the hub's gorus/<uid> (kontrol/hub/kar/model.html): one doc per person, items appended
      const old = (await docGet("gorus", `gorus/${uid}`)) || {};
      const items = (old.items || []).concat([{ at: new Date().toISOString(), task: "defter", text }]);
      await write("gorus", `gorus/${uid}`, "set", { nav: name, items });
      c.textContent = "";
      c.append(el("b", null, "Spas! Nêrîna te gihîşt me. +5 xal"), el("p", "tr", "Teşekkürler! Görüşün kaydedildi; internet gelince bize gider. +5 puan"));
      setTimeout(() => c.remove(), 6000);
    };
  };
  return c;
}
function myCode() { return uid.slice(3, 8).toUpperCase(); }

// ---------- points, levels, the garden, the weekly race (21.11, Resul: "make it a game, with praise, a star, a flower,
// a fruit, a book"; the choices are Claude's). One point (xal) per answer, three per corrected sentence, five per note.
const W = { rastkirin: 3 };
const LEVELS = [[0, "🌱", "Şitil", "Fidan"], [30, "🌸", "Kulîlk", "Çiçek"], [100, "🍎", "Fêkî", "Meyve"], [250, "⭐", "Stêrk", "Yıldız"],
  [500, "📖", "Pirtûk", "Kitap"], [1000, "🌳", "Dar", "Ağaç"], [2000, "🏔️", "Çiya", "Dağ"], [4000, "🎙️", "Dengbêj", "Dengbêj"]];
const PRAISE = [
  ["Bi xêr hatî! Her bersiv tovek e.", "Hoş geldin! Her cevap bir tohum."],
  ["Kulîlka te vebû! Destpêkeke xweş.", "Çiçeğin açtı! Güzel bir başlangıç."],
  ["Keda te fêkî da. Spas!", "Emeğin meyve verdi. Teşekkürler!"],
  ["Tu bûyî stêrkeke projeya Deng.", "Deng projesinin bir yıldızı oldun."],
  ["Te pirtûkek nivîsand: her bersiva te rûpelek e.", "Bir kitap yazdın: her cevabın bir sayfa."],
  ["Tu bûyî darek: siya te digihîje gelek kesan.", "Bir ağaç oldun: gölgen birçok kişiye ulaşıyor."],
  ["Tu wek çiyayekî yî: kurmancî bi te bilind dibe.", "Bir dağ gibisin: Kurmancî seninle yükseliyor."],
  ["Dengbêjê Deng! Keda te di dengê modelê de dijî.", "Deng'in dengbêji! Emeğin modelin sesinde yaşıyor."],
];
const levelOf = (p) => { let i = 0; while (i + 1 < LEVELS.length && p >= LEVELS[i + 1][0]) i++; return i; };
async function score(me) {
  let pts = 0; const done = new Set(), prog = {};
  for (const t of index.tasks) {
    if (t.guide) continue;
    const kd = await docGet(t.id, `katki-${t.id}/${uid}`), n = (kd && kd.n) || 0, tot = (kd && kd.total) || 0;
    prog[t.id] = { n, tot }; pts += n * (W[t.id] || 1); if (tot && n >= tot) done.add(t.id);
  }
  // old tests count from the published record (they are no longer in the app)
  if (me) for (const [id, v] of Object.entries(me.tasks || {})) {
    if (id === "gorus" || index.tasks.some((t) => t.id === id)) continue;
    pts += (W[id] || 1) * v.n; if (v.total && v.n >= v.total) done.add(id);
  }
  const g = await docGet("gorus", `gorus/${uid}`);
  const mine = ((g && g.items) || []).filter((i) => (i.text || "").trim().split(/\s+/).length >= 3).length;
  const notes = Math.min(10, Math.max(mine, (me && me.tasks && me.tasks.gorus && me.tasks.gorus.n) || 0));
  pts += 5 * notes;
  let guides = 0; for (const t of index.tasks) if (t.guide && (await kvGet("read-" + t.id))) guides++;
  return { pts, done, prog, notes, guides, week: me ? (me.w || 0) + Math.max(0, pts - (me.p || 0)) : pts };
}
function garden(sc) {
  const fl = "🌷".repeat(sc.done.size), fr = "🍎".repeat(Math.min(20, Math.floor(sc.pts / 100))), bk = "📖".repeat(sc.guides);
  return (fl + fr + bk) || "";
}
async function meCard(me, sc) {
  const lv = levelOf(sc.pts), L = LEVELS[lv], nx = LEVELS[lv + 1], s = signOf(sign) || SIGNS[0];
  const c = el("div", "card me");
  const head = el("div", "mehead");
  const who = el("div", "who"); who.append(el("b", null, name), el("span", "lv", `${L[1]} ${L[2]} · ${L[3]}`), el("span", "pts", `${sc.pts} xal · puan`));
  head.append(el("span", "bigsign", s[1]), who); c.append(head);
  if (nx) {
    const bar = el("div", "prog"), i = el("i"); i.style.width = Math.max(3, 100 * (sc.pts - L[0]) / (nx[0] - L[0])) + "%"; bar.append(i);
    c.append(bar, el("p", "tr", `Hê ${nx[0] - sc.pts} xal heta ${nx[1]} ${nx[2]} · ${nx[3]} olmana ${nx[0] - sc.pts} puan`));
  }
  const gd = garden(sc);
  if (gd) { const g = el("p", "garden", gd); g.title = "🌷 test qediya · 🍎 her 100 xal · 📖 rêber xwendî"; c.append(el("p", "tr", "Baxçeyê te · Bahçen: 🌷 biten test · 🍎 her 100 puan · 📖 okunan rehber"), g); }
  c.append(el("p", "tr", `Nîşana te ${s[1]} ${s[2]} e. Li telefoneke din navê xwe binivîse û vê nîşanê hilbijêre: keda te tê. · Resmin ${s[1]} (${s[3]}). Başka telefonda adını yaz, bu resmi seç: emeğin gelir.`));
  const row = el("div", "row small"), grid = el("div", "signs"), msg = el("p", "tr");
  grid.hidden = true;
  const ch = el("button", null, "Nîşanê biguhere · Resmi değiştir"); ch.type = "button";
  ch.onclick = () => { grid.hidden = !grid.hidden; if (!grid.hidden) signGrid(grid, sign, async (key) => { sign = key; await kvSet("sign", sign); await saveKimlik(); showTasks(); }); };
  const hidden = !!(await kvGet("hide"));
  const hd = el("button", null, hidden ? "Navê min nîşan bide · Adımı göster" : "Navê min veşêre · Adımı gizle"); hd.type = "button";
  hd.title = "Di rêza pêşbirkê de · Yarış sıralamasında";
  hd.onclick = async () => { await kvSet("hide", !hidden); await saveKimlik(); showTasks(); };
  const on = (await kvGet("push")) === "on";
  const rm = el("button", on ? null : "primary", on ? "🔕 Bîranînê bigire · Hatırlatmayı kapat" : "🔔 Carinan bîne bîra min · Ara sıra hatırlat"); rm.type = "button";
  rm.onclick = async () => { rm.disabled = true; if (await setReminder(!on, msg)) showTasks(); else rm.disabled = false; };
  row.append(ch, hd, rm); c.append(row, grid,
    el("p", "tr", "Bîranîn: herî zêde çar rojan carekê, tenê bi roj, bê deng; heke tu nû hatî, nayê. · Hatırlatma en çok dört günde bir, yalnız gündüz, sessiz; yeni geldiysen gelmez."), msg);
  return c;
}
function boardCard(me, sc) {
  const rows = (index.people || []).filter((p) => p.p > 0).map((p) => ({ ...p }));
  const live = { pid: me ? me.pid : "self", d: name, s: sign, p: sc.pts, w: sc.week, self: true };
  const at = rows.findIndex((p) => me && p.pid === me.pid);
  if (at >= 0) rows[at] = { ...rows[at], ...live }; else if (sc.pts > 0) rows.push(live);
  const total = rows.reduce((a, p) => a + p.p, 0);
  const c = el("div", "card board");
  c.append(el("h2", null, "Pêşbirka dilxwazan · Gönüllü yarışı"));
  const tabs = el("div", "row small"), list = el("ol", "rank");
  const draw = (by) => {
    list.textContent = "";
    const xs = rows.filter((p) => p[by] > 0).sort((a, b) => b[by] - a[by]);
    const mine = xs.findIndex((p) => p.self);
    xs.forEach((p, i) => {
      if (i >= 5 && i !== mine) return;
      const li = el("li", p.self ? "self" : null);
      li.append(el("span", "rk", ["🥇", "🥈", "🥉"][i] || `${i + 1}.`), el("span", "nm", `${p.s && signOf(p.s) ? signOf(p.s)[1] + " " : ""}${p.self ? name + " (tu · sen)" : p.d}`), el("span", "xp", `${p[by]} xal`));
      list.append(li);
    });
    if (!xs.length) list.append(el("li", "tr", "Vê hefteyê hîn kes tune. Yê pêşî tu be! · Bu hafta henüz kimse yok. İlk sen ol!"));
    for (const b of tabs.children) b.setAttribute("aria-pressed", String(b.dataset.by === by));
  };
  for (const [by, t] of [["w", "Vê hefteyê · Bu hafta"], ["p", "Hemû dem · Tüm zamanlar"]]) {
    const b = el("button", null, t); b.type = "button"; b.dataset.by = by; b.onclick = () => draw(by); tabs.append(b);
  }
  c.append(tabs, list); draw("w");
  const goal = index.goal || { xal: 5000, until: "2026-12-31" };
  const bar = el("div", "prog"), i = el("i"); i.style.width = Math.min(100, 100 * total / goal.xal) + "%"; bar.append(i);
  c.append(el("p", null, `Armanca hevpar: ${goal.xal.toLocaleString("tr")} xal heta ${goal.until.slice(8, 10)}.${goal.until.slice(5, 7)} · niha ${total.toLocaleString("tr")}`),
    bar, el("p", "tr", `Ortak hedef: ${goal.until.slice(8, 10)}.${goal.until.slice(5, 7)}'e kadar hep birlikte ${goal.xal.toLocaleString("tr")} puan. Sıralama ara ara güncellenir${index.boardAt ? " (son: " + index.boardAt.slice(8, 10) + "." + index.boardAt.slice(5, 7) + " " + index.boardAt.slice(11, 16) + ")" : ""}; senin puanın anında değişir.`));
  return c;
}
async function celebrateCard(sc) {
  const lv = levelOf(sc.pts), last = await kvGet("lv");
  await kvSet("lv", lv);
  if (!imported && (last === undefined || last === null || lv <= last)) return null;
  const L = LEVELS[lv], c = el("div", "card cheer");
  c.append(el("p", "cheerbig", L[1]));
  if (imported) c.append(el("b", null, "Keda te ya berê gihîşt vê telefonê! · Önceki emeğin bu telefona geldi!"));
  c.append(el("b", null, `${L[2]} · ${L[3]}`), el("p", null, PRAISE[lv][0]), el("p", "tr", PRAISE[lv][1]));
  imported = 0;
  return c;
}
function oldCard(me) {
  const old = index.old || [];
  if (!old.length) return null;
  const c = el("div", "oldbox");
  const b = el("button", null, `📜 Testên kevn · Eski testler (${old.length})`); b.type = "button";
  const ul = el("ul", "old"); ul.hidden = true;
  for (const o of old) {
    const v = me && me.tasks && me.tasks[o.id];
    const li = el("li"); li.append(el("span", null, `${o.ku} · ${o.tr}`), el("span", "tr", ` ${o.when}`));
    if (v) li.append(el("span", "okc", v.total && v.n >= v.total ? " ✓" : ` ${v.n}${v.total ? "/" + v.total : ""}`));
    ul.append(li);
  }
  b.onclick = () => { ul.hidden = !ul.hidden; };
  c.append(b, ul,);
  return c;
}
async function showTasks(justFinished) {
  $("tasks").hidden = false; $("bar").hidden = false;
  const box = $("cards"); box.textContent = "";
  const me = await findMe(), sc = await score(me);
  const cheer = await celebrateCard(sc); if (cheer) box.append(cheer);
  box.append(await meCard(me, sc));
  // 20.11 (Resul): most important first; 21.11: finished tests sink to the bottom, faded, old tests under one button
  const rows = [];
  for (const [i, t] of index.tasks.entries()) {
    const { n = 0, tot = 0 } = sc.prog[t.id] || {};
    rows.push({ t, i, n, tot, done: !t.guide && tot > 0 && n >= tot, lv: Number(t.imp) || 1 });
  }
  const open = rows.filter((r) => !r.done).sort((a, b) => (b.lv - a.lv) || (a.i - b.i)), fin = rows.filter((r) => r.done);
  // a warm note: right after a finished task, otherwise on about one opening in three
  const finished = justFinished && rows.some((r) => r.t.id === justFinished && r.done);
  if (finished || Math.random() < 0.35) box.append(feedbackCard(finished));
  for (const r of open) box.append(taskCard(r));
  box.append(boardCard(me, sc));
  if (fin.length) { box.append(el("p", "sep", "Yên qediyayî · Bitirdiklerin")); for (const r of fin) box.append(taskCard(r)); }
  const oc = oldCard(me); if (oc) box.append(oc);
  refreshSync();
}
function taskCard({ t, n, tot, done, lv }) {
  const c = el("div", "card imp" + lv + (done ? " done" : ""));
  const chip = el("span", "chip imp" + lv); chip.append(el("i", "dot"), document.createTextNode(done ? "✓ Qediya · Bitti" : IMP[lv]));
  c.append(chip, el("h2", null, t.ku), el("p", "tr", t.tr));
  if (!done && t.kd) c.append(el("p", null, t.kd));
  if (!done && t.td) c.append(el("p", "tr", t.td));
  const meta = el("div", "meta");
  if (t.min && !done) meta.append(el("span", null, `⏱ ~${t.min} deqe · dk`));
  if (n) meta.append(el("span", "pill" + (done ? " ok" : ""), `${n}${tot ? " / " + tot : ""}`));
  if (!t.guide && !done && tot) meta.append(el("span", null, `+${(tot - n) * (W[t.id] || 1)} xal`));
  c.append(meta);
  const row = el("div", "row");
  const go = el("button", done ? null : "primary", t.guide ? "Bixwîne · Oku" : done ? "Dîsa veke · Yeniden aç" : n ? "Bidomîne · Devam et" : "Dest pê bike · Başla");
  go.onclick = () => openTask(t); row.append(go); c.append(row);
  return c;
}

// ---------- gentle reminders (push, opt-in): the Mac sends at most one every four days, by day, silent ----------
function b64u(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); const b = atob(s + "===".slice((s.length + 3) % 4)); return Uint8Array.from(b, (x) => x.charCodeAt(0)); }
async function setReminder(on, msg) {
  try {
    if (!on) {
      try { const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) {}
      await write("push", `push/${uid}`, "set", { on: false, at: new Date().toISOString() });
      await kvSet("push", "off"); return true;
    }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      msg.textContent = ios && !standalone
        ? "Pêşî sepanê li ekrana sereke zêde bike (Safari → Parve bike ⬆︎ → Li Ekrana Sereke Zêde Bike), paşê ji wir veke û dîsa biceribîne. · Önce uygulamayı ana ekrana ekle, oradan açıp yeniden dene."
        : "Ev gerok agahdariyan nade. · Bu tarayıcı bildirim göstermiyor.";
      return false;
    }
    if (!index.vapid) { msg.textContent = "Bîranîn hîn ne amade ye. · Hatırlatma henüz hazır değil."; return false; }
    if ((await Notification.requestPermission()) !== "granted") { msg.textContent = "Destûr nehat dayîn. · İzin verilmedi; istersen tarayıcı ayarlarından açabilirsin."; return false; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(index.vapid) }));
    await write("push", `push/${uid}`, "set", { on: true, sub: sub.toJSON(), tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || ""), at: new Date().toISOString() });
    await kvSet("push", "on"); return true;
  } catch (e) { msg.textContent = "Nebû · Olmadı: " + String((e && e.message) || e); return false; }
}

let openId = null;
async function openTask(t) {
  $("ftitle").textContent = t.ku; $("fst").textContent = ""; $("frame").hidden = false;
  if (t.guide) kvSet("read-" + t.id, 1);
  let html;
  try { html = await openFile(t.file); }
  catch (e) { html = "<p style='font:16px system-ui;padding:16px'>Kar nehat vekirin. Dema înternet hebe dîsa biceribîne. · İş açılamadı; internet varken yeniden dene.</p>"; }
  openId = t.id; closeSubs();
  const boot = `<script>window.DLX_TASK=${JSON.stringify(t.id)};${SHIM}<\/script>`;
  const m = /^\s*<!doctype[^>]*>/i.exec(html);
  $("ifr").srcdoc = m ? m[0] + boot + html.slice(m[0].length) : boot + html;
}
$("back").onclick = () => { const was = openId; closeSubs(); openId = null; $("frame").hidden = true; $("ifr").srcdoc = ""; showTasks(was); };

// ---------- the db the task page sees ----------
const SHIM = `(function(){var n=0,pend={},subs={};
function call(op,o){return new Promise(function(res,rej){var id=++n;pend[id]={res:res,rej:rej};parent.postMessage(Object.assign({dlx:1,id:id,op:op},o||{}),"*");});}
addEventListener("message",function(e){var m=e.data;if(!m||e.source!==parent)return;
 if(m.dlx===2&&pend[m.id]){var p=pend[m.id];delete pend[m.id];m.ok?p.res(m.out):p.rej(new Error(m.err));}
 if(m.dlx===3&&subs[m.id])subs[m.id](m.snap);});
function clone(d){return d===undefined?d:JSON.parse(JSON.stringify(d));}
function dsnap(path,x){return{id:path.split("/").pop(),exists:!!x.exists,data:function(){return x.data;}};}
function csnap(x){var docs=x.docs.map(function(d){return{id:d.id,exists:true,data:function(){return d.data;}};});return{docs:docs,size:docs.length,empty:!docs.length,forEach:function(f){docs.forEach(f);}};}
function sub(path,wrap,cb){var id=++n;subs[id]=function(x){cb(wrap(x));};parent.postMessage({dlx:1,id:id,op:"sub",path:path},"*");return function(){delete subs[id];parent.postMessage({dlx:1,id:++n,op:"unsub",sid:id},"*");};}
function ref(path){var isDoc=path.split("/").length%2===0,r={path:path,id:path.split("/").pop()};
 if(isDoc){r.get=function(){return call("get",{path:path}).then(function(x){return dsnap(path,x);});};
  r.set=function(d){return call("set",{path:path,data:clone(d)});};r.update=function(d){return call("update",{path:path,data:clone(d)});};
  r.delete=function(){return call("delete",{path:path});};r.onSnapshot=function(cb){return sub(path,function(x){return dsnap(path,x);},cb);};
  r.collection=function(c){return ref(path+"/"+c);};}
 else{r.doc=function(d){return ref(path+"/"+d);};r.get=function(){return call("get",{path:path}).then(csnap);};
  r.onSnapshot=function(cb){return sub(path,csnap,cb);};}
 return r;}
var init=call("init");
var db={doc:ref,collection:ref};
var user={id:function(){return init.then(function(i){return i.uid;});},isOwner:function(){return Promise.resolve(false);},canEdit:function(){return Promise.resolve(false);},
 me:function(){return init.then(function(i){return{id:i.uid,name:i.name||""};});},profiles:function(ids){return call("profiles",{ids:ids}).then(function(x){return x.ps||{};});}};
window.claude={use:function(name){return init.then(function(){if(name==="db")return db;if(name==="user")return user;return null;});}};
window.dlxDiag=function(){};
})();`;

const k = (task, path) => task + "|" + path;
const isPlain = (x) => x && typeof x === "object" && !Array.isArray(x);
function merge(a, b) {
  const out = isPlain(a) ? { ...a } : {};
  for (const [kk, v] of Object.entries(b || {})) {
    if (isPlain(v) && v.__delete__ === true) delete out[kk];
    else out[kk] = isPlain(v) && isPlain(out[kk]) ? merge(out[kk], v) : v;
  }
  return out;
}
const docGet = (task, path) => tx("docs", "readonly", (s) => req(s.get(k(task, path))));
async function collGet(task, path) {
  const pre = k(task, path) + "/";
  const range = IDBKeyRange.bound(pre, pre + "￿");
  const [keys, vals] = await tx("docs", "readonly", (s) => Promise.all([req(s.getAllKeys(range)), req(s.getAll(range))]));
  const docs = [];
  keys.forEach((kk, i) => { const rest = kk.slice(pre.length); if (!rest.includes("/")) docs.push({ id: rest, data: vals[i] }); });
  return { docs };
}
async function write(task, path, op, data) {
  let doc = null;
  await tx("docs", "readwrite", async (s) => {
    const old = await req(s.get(k(task, path)));
    if (op === "delete") s.delete(k(task, path));
    else { doc = op === "update" ? merge(old, data) : data; s.put(doc, k(task, path)); }
  });
  const rec = { id: uid + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7), uid, name, task, path, op: op === "delete" ? "delete" : "set", data: doc, at: new Date().toISOString(), sent: 0 };
  await tx("out", "readwrite", (s) => { s.put(rec); });
  notify(task, path);
  queueSync();
}
const subs = {};
function closeSubs() { for (const kk of Object.keys(subs)) delete subs[kk]; }
async function snapFor(task, path) {
  if (path.split("/").length % 2 === 0) { const d = await docGet(task, path); return { exists: d !== undefined, data: d === undefined ? null : d }; }
  return collGet(task, path);
}
async function notify(task, path) {
  const parent = path.split("/").slice(0, -1).join("/");
  for (const [id, s] of Object.entries(subs)) {
    if (s.task !== task || (s.path !== path && s.path !== parent)) continue;
    try { $("ifr").contentWindow.postMessage({ dlx: 3, id: Number(id), snap: await snapFor(task, s.path) }, "*"); } catch (e) {}
  }
}
window.addEventListener("message", async (e) => {
  const m = e.data, win = $("ifr").contentWindow;
  if (!m || m.dlx !== 1 || e.source !== win || !openId) return;
  const task = openId;
  const reply = (r) => { try { win.postMessage({ dlx: 2, id: m.id, ...r }, "*"); } catch (err) {} };
  try {
    let out = {};
    if (m.op === "init") out = { db: true, uid, owner: false, name };
    else if (m.op === "get") out = await snapFor(task, m.path);
    else if (m.op === "set" || m.op === "update" || m.op === "delete") { await write(task, m.path, m.op, m.data); $("fst").textContent = "✓ tomar bû · kaydedildi"; }
    else if (m.op === "sub") { subs[m.id] = { task, path: m.path }; win.postMessage({ dlx: 3, id: m.id, snap: await snapFor(task, m.path) }, "*"); return; }
    else if (m.op === "unsub") { delete subs[m.sid]; return; }
    else if (m.op === "profiles") out = { ps: Object.fromEntries((m.ids || []).filter((x) => x === uid).map((x) => [x, { name }])) };
    else if (m.op === "diag") return;
    reply({ ok: true, out });
  } catch (err) { reply({ ok: false, err: String((err && err.message) || err) }); }
});

// ---------- sending ----------
let syncTimer = null, syncing = false;
function queueSync() { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 3000); }
const outAll = () => tx("out", "readonly", (s) => req(s.getAll()));
async function refreshSync(msg) {
  const all = await outAll(); const wait = all.filter((r) => !r.sent).length;
  $("sync").textContent = msg || (wait
    ? `⏳ ${wait} li benda şandinê · gönderilmeyi bekliyor${navigator.onLine ? "" : " (bê înternet · internet yok)"}`
    : all.length ? "✓ Hemû hatin şandin · Hepsi gönderildi" : "Hîn tiştek tune · Henüz bir şey yok");
  $("sendNow").disabled = !wait || !navigator.onLine || !(index && index.endpoint);
}
async function sync() {
  if (syncing || !index || !index.endpoint || !navigator.onLine) { refreshSync(); return; }
  syncing = true;
  try {
    const all = (await outAll()).filter((r) => !r.sent);
    // one record per document is enough: each record carries the whole document after the change
    const last = {}; for (const r of all) last[r.task + "|" + r.path] = r;
    const recs = Object.values(last).map(({ sent, ...r }) => r);
    for (let i = 0; i < recs.length; i += 40) {
      // no-cors: the answer cannot be read, so a sent record is "sent", not "arrived"; the local copy stays
      await fetch(index.endpoint, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ v: 1, app: "deng-defter", recs: recs.slice(i, i + 40) }) });
    }
    const now = Date.now();
    await tx("out", "readwrite", (s) => { for (const r of all) s.put({ ...r, sent: now }); });
  } catch (e) {}
  syncing = false; refreshSync();
}
$("sendNow").onclick = sync;
addEventListener("online", () => { refreshSync(); sync(); });
addEventListener("offline", () => refreshSync());
setInterval(() => { if (navigator.onLine) sync(); }, 60000);

// Share everything as a file (WhatsApp or anywhere): works even before the online channel exists
$("share").onclick = async () => {
  const docs = await tx("docs", "readonly", (s) => Promise.all([req(s.getAllKeys()), req(s.getAll())]));
  const body = { v: 1, app: "deng-defter", uid, name, at: new Date().toISOString(), docs: docs[0].map((kk, i) => ({ key: kk, data: docs[1][i] })) };
  const fname = `deng-defter-${(name || uid).replace(/[^\p{L}\p{N}]+/gu, "-")}-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(body)], fname, { type: "application/json" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "Deng Defter" }); refreshSync("✓ Pel hat parvekirin · Dosya paylaşıldı"); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  const a = el("a"); a.href = URL.createObjectURL(file); a.download = fname; document.body.append(a); a.click(); a.remove();
  refreshSync("✓ Pel hat daxistin; bi WhatsAppê bişîne · Dosya indi; WhatsApp'tan gönder");
};
