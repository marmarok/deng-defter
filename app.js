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
$("whoForm").onsubmit = async (e) => {
  e.preventDefault();
  const v = $("nav").value.trim(); if (!v) return;
  name = v; await kvSet("name", name); $("who").hidden = true; showTasks(); download();
};

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
  if (!name) { $("who").hidden = false; return; }
  showTasks(); download();
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
async function showTasks() {
  $("tasks").hidden = false; $("bar").hidden = false;
  const box = $("cards"); box.textContent = "";
  for (const t of index.tasks) {
    const c = el("div", "card");
    c.append(el("h2", null, t.ku), el("p", "tr", t.tr));
    if (t.kd) c.append(el("p", null, t.kd));
    if (t.td) c.append(el("p", "tr", t.td));
    const meta = el("div", "meta");
    if (t.min) meta.append(el("span", null, `⏱ ~${t.min} deqe · dk`));
    if (!t.guide) {
      const k = await docGet(t.id, `katki-${t.id}/${uid}`);
      const n = (k && k.n) || 0, tot = (k && k.total) || 0;
      if (n) meta.append(el("span", "pill" + (tot && n >= tot ? " ok" : ""), tot && n >= tot ? "✓ Qediya · Bitti" : `${n}${tot ? " / " + tot : ""}`));
    }
    c.append(meta);
    const row = el("div", "row"); const go = el("button", "primary", t.guide ? "Bixwîne · Oku" : "Dest pê bike · Başla");
    go.onclick = () => openTask(t); row.append(go); c.append(row);
    box.append(c);
  }
  refreshSync();
}

let openId = null;
async function openTask(t) {
  $("ftitle").textContent = t.ku; $("fst").textContent = ""; $("frame").hidden = false;
  let html;
  try { html = await openFile(t.file); }
  catch (e) { html = "<p style='font:16px system-ui;padding:16px'>Kar nehat vekirin. Dema înternet hebe dîsa biceribîne. · İş açılamadı; internet varken yeniden dene.</p>"; }
  openId = t.id; closeSubs();
  const boot = `<script>window.DLX_TASK=${JSON.stringify(t.id)};${SHIM}<\/script>`;
  const m = /^\s*<!doctype[^>]*>/i.exec(html);
  $("ifr").srcdoc = m ? m[0] + boot + html.slice(m[0].length) : boot + html;
}
$("back").onclick = () => { closeSubs(); openId = null; $("frame").hidden = true; $("ifr").srcdoc = ""; showTasks(); };

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
