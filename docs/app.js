/* Спортен график — редакционна дъска.
   Програмата идва от data/events.json (пълни я GitHub Actions).
   Авторите, смените и разпределението:
     · редакторът (влязъл с GitHub токен) ги редактира в браузъра си и ги
       публикува в data/assignments.json с бутона „Публикувай“;
     · всички останали виждат публикуваното, само за четене. */
"use strict";

const LS = "sn-grafik-v1";
const REPO = "genovhd200-art/sportni-grafik";
const PUB_PATH = "docs/data/assignments.json";
/* Общите отметки „поето“ — всеки може да ги слага, всички ги виждат.
   Пазят се в безплатна база Supabase. Докато url е празно, отметките
   ги слага само редакторът (като досега). Ключът е публичният „anon“
   ключ на проекта — той е предвиден да стои в страницата; какво може
   да се пише, решава политиката в базата (само таблицата done_marks). */
const SHARED = { url: "https://jbldhyjdrtvzumqxxmfq.supabase.co", key: "sb_publishable_Dgd8fuVVrB3X0Dq-mcx6Iw_-HIBXt3V" };
const sharedOn = () => !!(SHARED.url && SHARED.key);
const TOKEN_KEY = LS + "-editor";
const MODE_KEY = LS + "-editor-mode";      // редактор без токен (публикува с файл)
const AUTO_KEY = LS + "-autopub";          // само с токен: публикувай сам след всяка промяна
const ls = k => { try{ return localStorage.getItem(k) || ""; }catch(e){ return ""; } };
const getToken = () => ls(TOKEN_KEY);
let EDITOR = !!getToken() || ls(MODE_KEY) === "1";
const DAYFULL = ["Понеделник","Вторник","Сряда","Четвъртък","Петък","Събота","Неделя"];
const DAYSHORT = ["пн","вт","ср","чт","пт","сб","нд"];
const MONTHS = ["януари","февруари","март","април","май","юни",
                "юли","август","септември","октомври","ноември","декември"];
const SPORTS = {
  fut:{n:"Футбол",c:"var(--s-fut)"}, vol:{n:"Волейбол",c:"var(--s-vol)"},
  ten:{n:"Тенис",c:"var(--s-ten)"},  bas:{n:"Баскетбол",c:"var(--s-bas)"},
  mot:{n:"Моторни",c:"var(--s-mot)"},oth:{n:"Друго",c:"var(--ink-3)"}
};
/* Цвят на турнира (оттенък 0–360) — различен от цвета на спорта, който е
   ивицата вляво. Непознатите турнири получават оттенък от името си, така
   че един турнир е винаги в един и същ цвят. */
const LEAGUE_HUES = {
  "ла лига":0, "лига европа":22, "лига 1":45, "млс":68, "първа лига":112,
  "лига на конференциите":135, "купа на италия":158, "купа на българия":180,
  "серия а":202, "шампионска лига":225, "купа на германия":248, "висша лига":270,
  "купа на лигата":292, "бундеслига":315, "купа на краля":338,
  "лига на нациите":90, "купа на африканските нации":158, "купа на африканските нации (квал.)":158,
  "лига на нациите на конкакаф":248,
  "евролига":22, "еврокъп":180, "нба":225, "нбл":112,
  "формула 1":0, "формула 2":202,
  "суперлига (волейбол)":112, "купа на българия (волейбол)":338, "суперкупа на българия (волейбол)":45,
};
function leagueHue(comp){
  const k = String(comp||"").trim().toLowerCase();
  if(k in LEAGUE_HUES) return LEAGUE_HUES[k];
  let h = 0; for(const ch of k) h = (h*31 + ch.charCodeAt(0)) >>> 0;
  return 11.25 + (h % 16) * 22.5;   // между оттенъците на познатите, за да не съвпадат
}
const compTag = e => '<span class="rcomp" style="--lh:'+leagueHue(e.comp)+'">'+esc(e.comp)+'</span>';
const PRESETS = { day:[{s:"08:00",e:"17:00"}], eve:[{s:"16:00",e:"01:00"}],
                  full:[{s:"08:00",e:"01:00"}], off:[] };
const PALETTE = ["#C2571C","#1F6FA8","#2F7D4E","#7B3FA0","#B01E56",
                 "#0F6E45","#8A5600","#14487F","#A62B21","#476080"];
const FORMATS = ["На място","От ТВ","Кратка новина","Анализ"];
/* Колко трае събитието в минути — оттам се смята кога има какво да се пише.
   Мач в 16:00 се покрива от този, който е на смяна към 17:55, не в 16:00. */
const DURATION = { fut:115, vol:110, bas:110, ten:150, mot:120, oth:90 };
const durationOf = e => (/тренировка|квалификац|спринт/i.test(e.title) ? 70
                        : (DURATION[e.sport] || 90));
const endMins = e => mins(e.time) + durationOf(e);
const endLabel = e => { const m = endMins(e) % 1440;
  return pad(Math.floor(m/60)) + ":" + pad(m%60); };

const S = { feed:null, all:[], custom:{}, authors:{}, assign:{}, done:{}, hidden:{}, showHidden:false,
            published:null, dirty:false,
            view:"day", q:"", sports:new Set(), onlyOpen:false, onlyTodo:false, weekStart:null };
let DATES = [];

/* ---------- дребни помощници ---------- */
const pad = n => String(n).padStart(2,"0");
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
const mins = t => { const p = String(t||"0:0").split(":"); return (+p[0])*60 + (+p[1]||0); };
const esc = s => String(s==null?"":s).replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const hm = t => { const [h,m] = String(t).split(":"); return m==="00" ? String(+h) : (+h)+":"+m; };
const todayISO = () => isoOf(new Date());

function mondayOf(d){
  const x = new Date(d); const wd = (x.getDay()+6)%7;   // 0 = понеделник
  x.setDate(x.getDate()-wd); x.setHours(0,0,0,0); return x;
}
function weekDates(start){
  return Array.from({length:7}, (_,i) => {
    const d = new Date(start); d.setDate(d.getDate()+i); return isoOf(d);
  });
}
function dayIdx(iso){ return DATES.indexOf(iso); }

/* ---------- съхранение ---------- */
/* Всяка промяна минава оттук — затова тук се отбелязва и „има непубликувано“. */
function saveLocal(dirty = true){
  if(!EDITOR) return;
  if(dirty) S.dirty = true;
  try{ localStorage.setItem(LS, JSON.stringify(
    {...stateOf(), dirty:S.dirty})); }catch(e){}
  if(dirty) scheduleAutoPublish();
}
/* Със сложен токен дъската публикува сама — 8 секунди след последната
   промяна, за да не праща по веднъж на всяко кликване. */
const autoPubOn = () => !!getToken() && ls(AUTO_KEY) !== "0";
let autoPubT = null;
function scheduleAutoPublish(){
  if(!autoPubOn()) return;
  clearTimeout(autoPubT);
  autoPubT = setTimeout(() => { if(S.dirty) publish(true); }, 8000);
}
/** true, ако в този браузър вече има въведени автори или разпределение. */
function loadLocal(){
  try{
    const r = localStorage.getItem(LS); if(!r) return false;
    const d = JSON.parse(r);
    applyState(d); S.dirty = !!d.dirty;
    return Object.keys(S.authors).length > 0 || Object.keys(S.assign).length > 0;
  }catch(e){ return false; }
}
function applyState(d){
  d = d || {};
  S.authors = d.authors||{}; S.assign = d.assign||{}; S.custom = d.custom||{}; S.done = d.done||{};
  S.hidden = d.hidden||{};
}
/* Всичко, което редакторът притежава — пази се локално и се публикува. */
const stateOf = () => ({ authors:S.authors, assign:S.assign, custom:S.custom, done:S.done, hidden:S.hidden });
async function loadPublished(){
  try{
    const r = await fetch("data/assignments.json?ts="+Date.now(), {cache:"no-store"});
    return r.ok ? await r.json() : null;
  }catch(e){ return null; }
}

/* ---------- публикуване (само редакторът) ---------- */
const b64 = s => { let x = ""; for(const c of new TextEncoder().encode(s)) x += String.fromCharCode(c); return btoa(x); };
const ghErr = s => s===401 ? "токенът не се приема — изтекъл е или е сгрешен"
  : (s===403 || s===404) ? "токенът няма право да пише в хранилището"
  : (s===409 || s===422) ? "някой друг публикува току-що — опитайте пак"
  : "GitHub върна грешка "+s;

/** Без токен: сваля файла, за да се качи през сайта на GitHub. */
function publishByFile(){
  const payload = { publishedAt: new Date().toISOString(), ...stateOf() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 1)+"\n"],
    {type:"application/json"}));
  const a = document.createElement("a");
  a.href = url; a.download = "assignments.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notice('Свален е <b>assignments.json</b>. Качи го в хранилището: '+
    '<a href="https://github.com/'+REPO+'/upload/main/docs/data" target="_blank" rel="noopener">'+
    'отвори docs/data → Add file → Upload files</a>, пусни файла вътре и натисни '+
    '<b>Commit changes</b>. След минута колегите го виждат.');
}

async function publish(auto = false){
  const token = getToken();
  if(!token){ if(!auto) publishByFile(); return; }
  const btn = document.getElementById("pubBtn");
  btn.disabled = true; notice(auto ? "Публикувам промяната…" : "Публикувам…");
  const payload = { publishedAt: new Date().toISOString(), ...stateOf() };
  const api ="https://api.github.com/repos/"+REPO+"/contents/"+PUB_PATH;
  const H = { Authorization: "Bearer "+token, Accept: "application/vnd.github+json" };
  try{
    let res;
    for(let attempt = 0; attempt < 2; attempt++){      // втори опит, ако файлът се е сменил междувременно
      const g = await fetch(api+"?ref=main&ts="+Date.now(), {headers:H, cache:"no-store"});
      if(!g.ok && g.status!==404) throw new Error(ghErr(g.status));
      const sha = g.ok ? (await g.json()).sha : undefined;
      res = await fetch(api, { method:"PUT", headers:H, body: JSON.stringify({
        message: "Разпределение от дъската",
        content: b64(JSON.stringify(payload, null, 1)+"\n"),
        branch: "main", ...(sha ? {sha} : {}) }) });
      if(res.ok || (res.status!==409 && res.status!==422)) break;
    }
    if(!res.ok) throw new Error(ghErr(res.status));
    S.published = payload; S.dirty = false; saveLocal(false); render();
    notice(auto
      ? "Публикувано автоматично в "+new Date().toLocaleTimeString("bg-BG",{hour:"2-digit",minute:"2-digit"})+
        ". Колегите го виждат до около минута."
      : "Публикувано. Колегите го виждат до около минута (страницата им се обновява сама), "+
        "а известията в Telegram тръгват по него.");
  }catch(err){
    notice("Не се публикува: "+esc(err.message)+"."+
      (auto ? " Промяната е запазена тук — натиснете „Публикувай“, за да опитате пак." : ""));
  }finally{ btn.disabled = false; }
}

/* ---------- вход за редактора ---------- */
function openEditorLogin(){
  modalState = {type:"editor"};
  const body = EDITOR
    ? '<p style="margin:0 0 10px">Влезли сте като <b>редактор</b> в този браузър'+
      (getToken() ? " (с токен)" : " (без токен — „Публикувай“ сваля файл, който качвате в GitHub)")+
      '.</p>'+
      (getToken()
        ? '<label style="display:flex;gap:8px;align-items:flex-start;margin:0 0 10px">'+
          '<input type="checkbox" id="autoPub"'+(autoPubOn()?" checked":"")+'>'+
          '<span>Публикувай сам след всяка промяна<br>'+
          '<span style="color:var(--ink-3);font-size:12px">Изчаква 8 секунди и качва — не се налага да натискате нищо.</span>'+
          '</span></label>'
        : '')+
      '<p style="margin:0;color:var(--ink-3);font-size:12.5px">„Зареди публикуваното“ заменя разпределението '+
      'в този браузър с последното публикувано — полезно на нов компютър.</p>'
    : '<p style="margin:0 0 10px">Само редакторът разпределя. Всички останали виждат публикуваното.</p>'+
      '<p style="margin:0 0 10px;color:var(--ink-3);font-size:12.5px">Може и <b>без токен</b>: '+
      'натисни „Публикувай“, файлът се сваля и го качваш в GitHub. Токенът е само за да става с едно натискане.</p>'+
      '<label class="fl" for="tokIn">GitHub токен</label>'+
      '<input type="password" id="tokIn" autocomplete="off" spellcheck="false" placeholder="github_pat_…" style="width:100%">'+
      '<p style="margin:10px 0 0;color:var(--ink-3);font-size:12.5px;line-height:1.45">'+
      'GitHub → Settings → Developer settings → <b>Fine-grained tokens</b> → Generate. '+
      'Repository access: само <b>'+REPO+'</b>; Permissions → <b>Contents: Read and write</b>. '+
      'Токенът остава само в този браузър.</p>'+
      '<p id="tokErr" style="margin:8px 0 0;color:var(--crit)" hidden></p>';
  const foot = EDITOR
    ? '<button class="btn left" data-act="logout">Изход</button>'+
      '<button class="btn" data-act="loadPub">Зареди публикуваното</button>'+
      '<button class="btn primary" data-act="cancel">Готово</button>'
    : '<button class="btn left" data-act="editorNoToken">Влез без токен</button>'+
      '<button class="btn" data-act="cancel">Отказ</button>'+
      '<button class="btn primary" data-act="saveToken">Влез с токен</button>';
  openModal(EDITOR ? "Редактор" : "Вход за редактор", body, foot);
}
async function saveToken(){
  const tok = (document.getElementById("tokIn").value || "").trim();
  const err = document.getElementById("tokErr");
  const fail = m => { err.hidden = false; err.textContent = m; };
  if(!tok) return fail("Поставете токена.");
  try{
    const r = await fetch("https://api.github.com/repos/"+REPO,
      {headers:{Authorization:"Bearer "+tok, Accept:"application/vnd.github+json"}});
    if(!r.ok) return fail(ghErr(r.status)+".");
    const j = await r.json();
    if(!j.permissions || !j.permissions.push) return fail("Токенът може само да чете — трябва Contents: Read and write.");
  }catch(e){ return fail("GitHub не отговори: "+e.message); }
  try{ localStorage.setItem(TOKEN_KEY, tok); }catch(e){ return fail("Браузърът не позволява запис (частен режим?)."); }
  EDITOR = true;
  try{ if(!ls(AUTO_KEY)) localStorage.setItem(AUTO_KEY, "1"); }catch(e){}
  // първи вход в този браузър — започваме от публикуваното, ако има
  if(!loadLocal() && S.published) applyState(S.published);
  closeModal(); applyMode(); render();
  notice("Влязохте като редактор. Всяка промяна се публикува сама след 8 секунди — "+
    "колегите я виждат до минута. Може да го изключите от <b>Редактор ✓</b>.");
  if(S.dirty) scheduleAutoPublish();
}
function applyMode(){
  document.body.classList.toggle("ro", !EDITOR);
  document.getElementById("editBtn").textContent = EDITOR ? "Редактор ✓" : "Вход за редактор";
}
/* В режим „преглед“ всичко, което би променило нещо, е изключено. */
function lockUi(){
  const sel = "#main select, #authorList button" + (sharedOn() ? "" : ", #main input[type=checkbox]");
  document.querySelectorAll(sel).forEach(x => { x.disabled = true; });
}

/* ---------- смени ---------- */
function normShifts(sh, dates){
  const out = {};
  (dates||DATES).forEach(d => {
    const v = sh && sh[d];
    out[d] = Array.isArray(v) ? v.filter(x=>x&&x.s&&x.e).map(x=>({s:x.s,e:x.e})) : [];
  });
  return out;
}
function inInterval(iv, timeStr){
  let s = mins(iv.s), e = mins(iv.e); if(e<=s) e += 1440;
  let t = mins(timeStr); if(t<s && t+1440<=e) t += 1440;
  return t>=s && t<=e;
}
function onShiftAt(a, date, minutes){
  const ints = (a.shifts && a.shifts[date]) || [];
  const t = pad(Math.floor((minutes%1440)/60)) + ":" + pad(minutes%60);
  return ints.some(iv => inInterval(iv, t));
}
/** Кой поема събитието: този, който е на смяна, когато то СВЪРШВА. */
function coversEnd(a, ev){ return onShiftAt(a, ev.date, endMins(ev)); }
/** Резервно: този, който е на смяна при започването. */
function coversStart(a, ev){ return onShiftAt(a, ev.date, mins(ev.time)); }
function onShift(a, ev){ return coversEnd(a, ev) || coversStart(a, ev); }
function shiftCell(ints){
  if(!ints.length) return {txt:"—", on:false, more:0};
  return {txt: hm(ints[0].s)+"–"+hm(ints[0].e), on:true, more: ints.length-1};
}
function weekHours(a){
  let t = 0;
  DATES.forEach(d => ((a.shifts&&a.shifts[d])||[]).forEach(iv => {
    let s = mins(iv.s), e = mins(iv.e); if(e<=s) e += 1440; t += e-s;
  }));
  return Math.round(t/60);
}

/* ---------- събития ---------- */
/* Махнатите от редактора не се виждат никъде — освен ако той не е пуснал „Махнати“. */
function allEvents(){
  return S.all.concat(Object.values(S.custom))
    .filter(e => !S.hidden[e.id] || (EDITOR && S.showHidden))
    .sort((a,b) => a.date===b.date ? mins(a.time)-mins(b.time) : (a.date<b.date?-1:1));
}
function weekEvents(){ return allEvents().filter(e => DATES.includes(e.date)); }
function passes(e){
  if(S.sports.size && !S.sports.has(e.sport)) return false;
  if(S.onlyOpen && S.assign[e.id]) return false;
  if(S.onlyTodo && S.done[e.id]) return false;
  if(S.q && !((e.title+" "+e.comp+" "+(e.note||"")).toLowerCase().includes(S.q.toLowerCase())))
    return false;
  return true;
}

/* ---------- зареждане на програмата ---------- */
async function loadFeed(){
  try{
    const r = await fetch("data/events.json?ts="+Date.now(), {cache:"no-store"});
    if(!r.ok) throw new Error("HTTP "+r.status);
    const j = await r.json();
    S.feed = j;
    S.all = (j.events||[]).map(e => ({
      id: e.extId || ("x"+uid()),
      date: e.date, time: e.time, sport: e.sport||"fut",
      comp: e.comp||"", title: e.title||"",
      p: e.p||1, note: e.note || e.round || "", provisional: !!e.provisional
    }));
    return true;
  }catch(err){
    document.getElementById("main").innerHTML =
      '<div class="panel"><div class="empty">Програмата не се зареди ('+esc(err.message)+
      ').<br>Проверете дали <code>data/events.json</code> съществува и дали работният процес е минал.</div></div>';
    return false;
  }
}

/* ---------- потвърждение в бутон ---------- */
let armT=null, armedEl=null;
function disarm(){
  if(armedEl && armedEl.dataset.orig!=null && armedEl.isConnected){
    armedEl.innerHTML = armedEl.dataset.orig; armedEl.classList.remove("arm");
  }
  armedEl=null; clearTimeout(armT);
}
function confirmBtn(btn,label){
  if(armedEl===btn){ disarm(); return true; }
  disarm(); armedEl=btn; btn.dataset.orig=btn.innerHTML;
  btn.innerHTML=label; btn.classList.add("arm");
  armT=setTimeout(()=>{disarm(); notice("");},5000);
  return false;
}
function notice(html){
  const n = document.getElementById("notice");
  if(!html){ n.hidden = true; return; }
  n.hidden = false; document.getElementById("noticeMsg").innerHTML = html;
}

/* ---------- проверки ---------- */
function issuesFor(){
  const out = [], evs = weekEvents(), byId = {};
  evs.forEach(e => byId[e.id] = e);
  evs.filter(e => e.p===3 && !S.assign[e.id] && !S.done[e.id]).forEach(e =>
    out.push({k:"crit", ic:"!", t:"Водещо събитие без автор", s:label(e)}));
  evs.filter(e => e.provisional && S.assign[e.id]).forEach(e =>
    out.push({k:"warn", ic:"?", t:"Часът още не е потвърден", s:label(e)}));
  Object.keys(S.assign).forEach(id => {
    const e = byId[id], a = S.authors[S.assign[id].authorId];
    if(!e || !a || S.done[id]) return;
    if(!coversEnd(a,e) && coversStart(a,e))
      out.push({k:"warn", ic:"→", t:esc(a.name)+" излиза преди края на събитието",
        s:label(e)+" · свършва към "+endLabel(e)});
  });
  Object.values(S.authors).forEach(a => {
    const list = Object.keys(S.assign).filter(id => S.assign[id].authorId===a.id)
      .map(id => byId[id]).filter(Boolean)
      .sort((x,y) => x.date===y.date ? mins(x.time)-mins(y.time) : (x.date<y.date?-1:1));
    for(let i=1;i<list.length;i++){
      const p = list[i-1], c = list[i];
      if(p.date===c.date && Math.abs(endMins(c)-endMins(p)) < 60)
        out.push({k:"warn", ic:"≡", t:esc(a.name)+" има застъпване",
          s:p.time+" "+esc(p.title)+" (край "+endLabel(p)+")  ⟷  "+
            c.time+" "+esc(c.title)+" (край "+endLabel(c)+")"});
    }
  });
  return out;
}
const label = e => DAYSHORT[dayIdx(e.date)]+" "+e.time+" · "+esc(e.comp)+" · "+esc(e.title);

/* ---------- автоматично разпределение ---------- */
function autoAssign(){
  const btn = document.getElementById("autoBtn");
  const authors = Object.values(S.authors);
  if(!authors.length){ notice("Първо добавете автори и им задайте смени."); return; }
  const evs = weekEvents().filter(e => !S.assign[e.id] && !S.done[e.id]);
  if(!evs.length){ notice("Няма неразпределени събития тази седмица."); return; }
  const byId = {}; weekEvents().forEach(e => byId[e.id]=e);
  const load = {}, taken = {};
  authors.forEach(a => { load[a.id]=0; taken[a.id]=[]; });
  Object.keys(S.assign).forEach(id => {
    const aid = S.assign[id].authorId;
    if(load[aid]!=null){ load[aid]++; if(byId[id]) taken[aid].push(byId[id]); }
  });
  const order = evs.slice().sort((a,b) =>
    b.p-a.p || (a.date<b.date?-1 : a.date>b.date?1 : mins(a.time)-mins(b.time)));
  const plan = [];
  let doubled = 0;
  const busy = (a,e) => taken[a.id].filter(t =>
    t.date===e.date && Math.abs(endMins(t)-endMins(e)) < 60).length;
  order.forEach(e => {
    const cands = authors.filter(a => coversEnd(a,e) || coversStart(a,e));
    if(!cands.length) return;
    // Редът на предпочитане:
    //   1) свободният — ако всички вече имат мач по същото време, поема
    //      най-малко заетият и застъпването излиза в „Проверка“
    //   2) на смяна, когато мачът свършва — той ще пише; иначе този при започването
    //   3) по-малко натовареният за седмицата
    const endFirst = a => coversEnd(a,e) ? 0 : 1;
    cands.sort((x,y) => busy(x,e)-busy(y,e) || endFirst(x)-endFirst(y) || load[x.id]-load[y.id]);
    const pick = cands[0];
    if(busy(pick,e)) doubled++;
    load[pick.id]++; taken[pick.id].push(e); plan.push([e.id, pick.id]);
  });
  if(!plan.length){ notice("Никой не е на смяна по време на неразпределените събития — проверете смените."); return; }
  const skipped = order.length - plan.length;
  if(!confirmBtn(btn, "Потвърди ("+plan.length+")")){
    notice("Ще разпределя <b>"+plan.length+"</b> събития"+
      (doubled ? " — <b>"+doubled+"</b> от тях при автор, който вече има мач по същото време (виж „Проверка“)" : "")+
      (skipped ? ". <b>"+skipped+"</b> остават без автор — никой не е на смяна тогава" : "")+
      ". Натиснете бутона отново за потвърждение.");
    return;
  }
  notice("");
  plan.forEach(p => { S.assign[p[0]] = {authorId:p[1], format:""}; });
  saveLocal(); render();
}

/* ---------- модал ---------- */
const ov = document.getElementById("overlay");
let modalState = null;
function openModal(title, body, foot){
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = body;
  document.getElementById("modalFoot").innerHTML = foot;
  ov.hidden = false;
  const f = ov.querySelector("input,select,button"); if(f) f.focus();
}
function closeModal(){ disarm(); ov.hidden = true; modalState = null; }
document.getElementById("modalClose").addEventListener("click", closeModal);
ov.addEventListener("mousedown", e => { if(e.target===ov) closeModal(); });
document.addEventListener("keydown", e => { if(e.key==="Escape" && !ov.hidden) closeModal(); });

function openShiftEditor(authorId){
  const a = S.authors[authorId]; if(!a) return;
  modalState = {type:"shift", id:authorId, shifts:normShifts(a.shifts)};
  renderShiftBody();
}
function renderShiftBody(){
  const st = modalState, a = S.authors[st.id];
  const body = DATES.map((d,i) => {
    const ints = st.shifts[d] || [];
    const chips = ints.length ? ints.map((iv,idx) =>
      '<span class="sh-int"><input type="time" value="'+iv.s+'" data-d="'+d+'" data-i="'+idx+'" data-f="s">'+
      '<span>–</span><input type="time" value="'+iv.e+'" data-d="'+d+'" data-i="'+idx+'" data-f="e">'+
      '<button class="rm" data-rmint="'+d+'|'+idx+'" aria-label="Премахни">✕</button></span>').join("")
      : '<span class="sh-off">почивка</span>';
    const dt = parseISO(d);
    return '<div class="sh-row"><span class="sh-day">'+DAYFULL[i]+
      '<span>'+dt.getDate()+"."+pad(dt.getMonth()+1)+'</span></span>'+
      '<div class="sh-ints">'+chips+
      '<button class="btn sm" data-addint="'+d+'">+ интервал</button>'+
      '<span class="sh-tools">'+
        '<button class="btn xs" data-preset="day|'+d+'">Дневна</button>'+
        '<button class="btn xs" data-preset="eve|'+d+'">Вечерна</button>'+
        '<button class="btn xs" data-preset="off|'+d+'">Почивка</button>'+
        '<button class="btn xs" data-copyall="'+d+'">↧ всички</button>'+
      '</span></div></div>';
  }).join("");
  let total = 0;
  DATES.forEach(d => (st.shifts[d]||[]).forEach(iv => {
    let s = mins(iv.s), e = mins(iv.e); if(e<=s) e += 1440; total += e-s; }));
  openModal("Смени по часове — "+a.name, body,
    '<span class="left mono" style="align-self:center;color:var(--ink-3);font-size:12px">Общо '+
    Math.round(total/60)+' ч. за седмицата</span>'+
    '<button class="btn" data-act="cancel">Отказ</button>'+
    '<button class="btn primary" data-act="saveShifts">Запази</button>');
}

document.getElementById("modalBody").addEventListener("click", e => {
  const st = modalState; if(!st || st.type!=="shift") return;
  const add = e.target.closest("[data-addint]"), rm = e.target.closest("[data-rmint]"),
        pr  = e.target.closest("[data-preset]"), cp = e.target.closest("[data-copyall]");
  if(add){ (st.shifts[add.dataset.addint] = st.shifts[add.dataset.addint]||[])
             .push({s:"09:00",e:"12:00"}); renderShiftBody(); return; }
  if(rm){ const [d,i] = rm.dataset.rmint.split("|"); st.shifts[d].splice(+i,1); renderShiftBody(); return; }
  if(pr){ const [k,d] = pr.dataset.preset.split("|");
          st.shifts[d] = PRESETS[k].map(x=>({s:x.s,e:x.e})); renderShiftBody(); return; }
  if(cp){ const src = (st.shifts[cp.dataset.copyall]||[]).map(x=>({s:x.s,e:x.e}));
          DATES.forEach(d => st.shifts[d] = src.map(x=>({s:x.s,e:x.e}))); renderShiftBody(); return; }
});
document.getElementById("modalBody").addEventListener("change", e => {
  const st = modalState, t = e.target;
  if(t.id === "autoPub"){
    try{ localStorage.setItem(AUTO_KEY, t.checked ? "1" : "0"); }catch(e2){}
    if(t.checked && S.dirty) scheduleAutoPublish();
    return;
  }
  if(st && st.type==="shift" && t.dataset.f){
    const iv = st.shifts[t.dataset.d][+t.dataset.i];
    if(iv) iv[t.dataset.f] = t.value || "00:00";
  }
});
document.getElementById("modalFoot").addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if(!b) return;
  const act = b.dataset.act, st = modalState;
  if(act==="cancel"){ closeModal(); return; }
  if(act==="saveToken"){ saveToken(); return; }
  if(act==="editorNoToken"){
    try{ localStorage.setItem(MODE_KEY, "1"); }catch(e){}
    EDITOR = true;
    if(!loadLocal() && S.published) applyState(S.published);
    closeModal(); applyMode(); render();
    notice("Влязохте като редактор. При „Публикувай“ файлът се сваля и се качва в GitHub — "+
      "стъпките излизат тук.");
    return;
  }
  if(act==="logout"){
    try{ localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(MODE_KEY); }catch(e){}
    EDITOR = false; applyState(S.published); closeModal(); applyMode(); render();
    notice("Излязохте. Виждате публикуваното разпределение.");
    return;
  }
  if(act==="loadPub"){
    if(!S.published){ notice("Още няма публикувано разпределение."); closeModal(); return; }
    if(!confirmBtn(b, "Замени тукашното?")) return;
    applyState(S.published); S.dirty = false; saveLocal(false); closeModal(); render();
    notice("Заредено е публикуваното разпределение.");
    return;
  }
  if(act==="saveShifts"){
    const a = S.authors[st.id];
    const shifts = Object.assign({}, a.shifts||{});
    DATES.forEach(d => shifts[d] = (st.shifts[d]||[]).filter(iv => iv.s && iv.e));
    S.authors[st.id] = Object.assign({}, a, {shifts});
    saveLocal(); closeModal(); render(); return;
  }
});

/* ---------- рендер ---------- */
function render(){
  renderMonthStrip(); renderWeekLabel(); renderBoard();
  renderAuthors(); renderFilters(); buildDateSelect();
  const m = document.getElementById("main");
  m.innerHTML = S.view==="day" ? viewDays() : S.view==="author" ? viewAuthors() : viewIssues();
  const n = issuesFor().length, b = document.getElementById("issueBadge");
  b.hidden = !n; b.textContent = n;
  const hc = document.getElementById("hiddenCount");
  if(hc) hc.textContent = S.all.filter(e => S.hidden[e.id] && DATES.includes(e.date)).length;
  const pb = document.getElementById("pubBtn");
  pb.textContent = S.dirty ? "Публикувай ●" : "Публикувай";
  pb.title = S.dirty
    ? (autoPubOn() ? "Публикува се само след няколко секунди" : "Има промени, които колегите още не виждат")
    : "Всичко е публикувано";
  const pubAt = S.published && S.published.publishedAt;
  document.getElementById("modeTxt").textContent = (EDITOR ? "редактор" : "преглед") +
    (pubAt ? " · публикувано " + new Date(pubAt).toLocaleString("bg-BG",
      {day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"}) : " · нищо публикувано");
  if(!EDITOR) lockUi();
}
function renderWeekLabel(){
  const a = parseISO(DATES[0]), b = parseISO(DATES[6]);
  const same = a.getMonth()===b.getMonth();
  document.getElementById("weekLabel").textContent =
    a.getDate()+(same?"":" "+MONTHS[a.getMonth()])+" – "+b.getDate()+" "+MONTHS[b.getMonth()];
}
function renderMonthStrip(){
  if(!S.feed) return;
  const from = parseISO(S.feed.from), to = parseISO(S.feed.to), out = [];
  const evs = allEvents(), t = todayISO();
  for(let d = new Date(from); d <= to; d.setDate(d.getDate()+1)){
    const k = isoOf(d), list = evs.filter(e => e.date===k);
    const gap = list.some(e => e.p===3 && !S.assign[e.id]);
    out.push('<button class="mday'+(list.length?" has":"")+(gap?" gap":"")+
      (DATES.includes(k)?" cur":"")+(k===t?" today":"")+'" data-jump="'+k+'" title="'+
      list.length+' събития"><span class="dw">'+DAYSHORT[(d.getDay()+6)%7]+
      '</span><span class="dn">'+d.getDate()+'</span><span class="bar"></span></button>');
  }
  document.getElementById("monthstrip").innerHTML = out.join("");
}
function renderBoard(){
  const evs = weekEvents(), assigned = evs.filter(e => S.assign[e.id]).length;
  const key = evs.filter(e => e.p===3), keyOpen = key.filter(e => !S.assign[e.id]).length;
  const prov = evs.filter(e => e.provisional).length, iss = issuesFor().length;
  document.getElementById("board").innerHTML = [
    st("Тази седмица", evs.length, ""),
    st("Разпределени", assigned, assigned && assigned===evs.length ? "is-ok" : ""),
    st("Поети", evs.filter(e => S.done[e.id]).length,
       evs.length && evs.every(e => S.done[e.id]) ? "is-ok" : ""),
    st("Свободни", evs.length-assigned, evs.length-assigned ? "is-warn" : "is-ok"),
    st("Водещи", key.length, ""),
    st("Водещи без автор", keyOpen, keyOpen ? "is-crit" : "is-ok"),
    st("Непотвърден час", prov, prov ? "is-warn" : ""),
    st("Сигнали", iss, iss ? "is-warn" : "is-ok")
  ].join("");
}
const st = (k,v,c) => '<div class="stat '+c+'"><span class="k">'+k+'</span><span class="v">'+v+'</span></div>';

function renderAuthors(){
  const list = Object.values(S.authors).sort((a,b)=>(a.name||"").localeCompare(b.name||"","bg"));
  document.getElementById("authorCount").textContent = list.length;
  const el = document.getElementById("authorList");
  if(!list.length){
    el.innerHTML = EDITOR
      ? '<div class="empty">Още няма автори.<br>Добавете първия отдолу.</div>'
      : '<div class="empty">Редакторът още не е публикувал разпределение.</div>';
    return;
  }
  el.innerHTML = list.map(a => {
    const load = weekEvents().filter(e => S.assign[e.id] && S.assign[e.id].authorId===a.id).length;
    const sh = normShifts(a.shifts);
    const cells = DATES.map((d,i) => {
      const c = shiftCell(sh[d]);
      return '<button class="shift'+(c.on?" on":"")+'" data-shift="'+a.id+'" title="'+DAYFULL[i]+
        '"><span class="d">'+DAYSHORT[i]+'</span><span class="s">'+c.txt+'</span>'+
        (c.more>0?'<span class="more">+'+c.more+'</span>':"")+'</button>';
    }).join("");
    return '<div class="author"><div class="a-top">'+
      '<span class="swatch" style="background:'+esc(a.color)+'"></span>'+
      '<span class="a-name">'+esc(a.name)+'</span>'+
      '<span class="a-load" title="задачи · часове">'+load+' · '+weekHours(a)+'ч</span>'+
      '<button class="a-x" data-del-author="'+a.id+'" title="Премахни">×</button></div>'+
      (a.role ? '<div style="font-size:11px;color:var(--ink-3);margin-left:19px">'+esc(a.role)+'</div>' : '')+
      '<div class="shifts">'+cells+'</div>'+
      '<button class="btn sm" style="margin-top:7px;width:100%" data-shift="'+a.id+'">Смени по часове</button></div>';
  }).join("");
}
function renderFilters(){
  const box = document.getElementById("filters");
  if(box.dataset.built) return;
  box.insertAdjacentHTML("afterbegin",
    Object.keys(SPORTS).filter(k=>k!=="oth").map(k =>
      '<button class="chip" data-sport="'+k+'" aria-pressed="false">'+
      '<span class="cd" style="background:'+SPORTS[k].c+'"></span>'+SPORTS[k].n+'</button>').join("")+
    '<button class="chip" data-open="1" aria-pressed="false">Само свободни</button>'+
    '<button class="chip" data-todo="1" aria-pressed="false">Само непоети</button>'+
    '<button class="chip edit-only" data-showhidden="1" aria-pressed="false">Махнати <span id="hiddenCount">0</span></button>');
  box.dataset.built = "1";
}
function hideEvent(id){
  if(S.custom[id]){ delete S.custom[id]; }          // собственото се трие наистина
  else S.hidden[id] = true;                         // от програмата — само се скрива
  delete S.assign[id]; delete S.done[id];
  saveLocal(); render();
}
function authorOpts(evId){
  const cur = S.assign[evId] ? S.assign[evId].authorId : "";
  return '<option value="">— няма автор —</option>' +
    Object.values(S.authors).sort((a,b)=>(a.name||"").localeCompare(b.name||"","bg"))
      .map(a => '<option value="'+a.id+'"'+(a.id===cur?" selected":"")+'>'+esc(a.name)+'</option>').join("");
}
function formatOpts(evId){
  const cur = S.assign[evId] ? (S.assign[evId].format||"") : "";
  return '<option value="">формат…</option>' + FORMATS.map(f =>
    '<option value="'+f+'"'+(f===cur?" selected":"")+'>'+f+'</option>').join("");
}
function rowHtml(e){
  const sc = (SPORTS[e.sport]||{}).c || "var(--ink-3)";
  const as = S.assign[e.id], a = as ? S.authors[as.authorId] : null;
  let flags = "";
  if(!as && e.p===3) flags += '<span class="flag crit">без автор</span>';
  if(e.provisional)  flags += '<span class="flag warn">часът не е потвърден</span>';
  if(a)              flags += '<span class="flag ok">'+esc(String(a.name).split(" ")[0])+'</span>';
  const dn = !!S.done[e.id], hid = !!S.hidden[e.id];
  const x = !EDITOR ? "" : hid
    ? '<button class="rx" data-unhide="'+e.id+'" title="Върни в графика" aria-label="Върни">↺</button>'
    : '<button class="rx" data-hide="'+e.id+'" title="Махни от графика" aria-label="Махни">×</button>';
  return '<div class="row'+(e.p===3?" p3":"")+(dn?" done":"")+(hid?" hid":"")+'" style="--sc:'+sc+'">'+
    '<div class="rdone"><input type="checkbox" data-done="'+e.id+'"'+(dn?" checked":"")+
      ' title="Поето" aria-label="Поето">'+x+'</div>'+
    '<div class="rtime mono">'+e.time+(e.provisional?'<span class="prov">?</span>':"")+
      '<span class="rend">→'+endLabel(e)+'</span></div>'+
    '<div class="rmain"><div>'+compTag(e)+'</div>'+
    '<div class="rtitle">'+esc(e.title)+(e.p===3?'<span class="star">★</span>':"")+'</div>'+
    (e.note?'<div class="rnote">'+esc(e.note)+'</div>':"")+'</div>'+
    '<div class="rsel"><select data-assign="'+e.id+'" class="'+(as?"assigned":"")+
      '" aria-label="Автор">'+authorOpts(e.id)+'</select></div>'+
    '<div class="rsel"><select data-format="'+e.id+'" aria-label="Формат"'+(as?"":" disabled")+'>'+
      formatOpts(e.id)+'</select>'+
      (flags?'<div class="rflags">'+flags+'</div>':"")+'</div></div>';
}
function viewDays(){
  const evs = weekEvents().filter(passes);
  if(!evs.length) return '<div class="panel"><div class="empty">Няма събития по този филтър.</div></div>';
  const t = todayISO();
  return DATES.map((d,i) => {
    const list = evs.filter(e => e.date===d); if(!list.length) return "";
    const dt = parseISO(d);
    return '<section class="day'+(d===t?" today":"")+'"><div class="day-hd">'+
      '<h3>'+DAYFULL[i]+'</h3><span class="dnum mono">'+dt.getDate()+"."+pad(dt.getMonth()+1)+
      '</span><span class="dcount mono">'+list.length+' събития</span></div>'+
      list.map(rowHtml).join("")+'</section>';
  }).join("");
}
function viewAuthors(){
  const evs = weekEvents(), byId = {}; evs.forEach(e => byId[e.id]=e);
  const list = Object.values(S.authors).sort((a,b)=>(a.name||"").localeCompare(b.name||"","bg"));
  let html = list.length ? "" :
    '<div class="panel"><div class="empty">Добавете автори, за да видите разпределението.</div></div>';
  html += list.map(a => {
    const sh = normShifts(a.shifts);
    const mine = Object.keys(S.assign).filter(id => S.assign[id].authorId===a.id)
      .map(id => byId[id]).filter(Boolean)
      .sort((x,y) => x.date===y.date ? mins(x.time)-mins(y.time) : (x.date<y.date?-1:1));
    const rows = mine.length ? mine.map(e =>
      '<div class="arow'+(S.done[e.id]?" done":"")+'"><span class="aday mono">'+DAYSHORT[dayIdx(e.date)]+" "+
      parseISO(e.date).getDate()+"."+pad(parseISO(e.date).getMonth()+1)+'</span>'+
      '<span class="mono" style="font-weight:600">'+e.time+'</span>'+
      '<span>'+compTag(e)+'<br>'+esc(e.title)+'</span><span>'+
      (S.done[e.id]?'<span class="flag ok">✓ поето</span>':"")+
      (S.assign[e.id].format?'<span class="flag ok">'+esc(S.assign[e.id].format)+'</span>':"")+
      '</span></div>').join("") : '<div class="empty">Няма разпределени събития.</div>';
    const shiftLine = DATES.map((d,i) => DAYSHORT[i]+" "+
      (sh[d].length ? sh[d].map(iv => hm(iv.s)+"–"+hm(iv.e)).join(", ") : "—")).join("  ·  ");
    return '<section class="acard" style="--ac:'+esc(a.color)+'"><div class="acard-hd">'+
      '<span class="swatch" style="background:'+esc(a.color)+'"></span><h3>'+esc(a.name)+'</h3>'+
      '<span class="cnt">'+mine.length+' задачи · '+weekHours(a)+' ч.</span></div>'+
      '<div class="legend mono" style="border-top:none;font-size:10.5px">'+shiftLine+'</div>'+rows+'</section>';
  }).join("");
  const open = evs.filter(e => !S.assign[e.id]);
  html += '<section class="acard" style="--ac:var(--warn)"><div class="acard-hd">'+
    '<h3>Без автор</h3><span class="cnt">'+open.length+' събития</span></div>'+
    (open.length ? open.map(e => '<div class="arow"><span class="aday mono">'+
      DAYSHORT[dayIdx(e.date)]+" "+parseISO(e.date).getDate()+"."+pad(parseISO(e.date).getMonth()+1)+
      '</span><span class="mono" style="font-weight:600">'+e.time+'</span>'+
      '<span>'+compTag(e)+'<br>'+esc(e.title)+'</span><span>'+
      (e.p===3?'<span class="flag crit">водещо</span>':"")+'</span></div>').join("")
      : '<div class="empty">Всичко е разпределено.</div>')+'</section>';
  return html;
}
function viewIssues(){
  const iss = issuesFor();
  if(!iss.length) return '<div class="panel"><div class="empty">Няма сигнали за тази седмица.</div></div>';
  return '<div class="panel">'+iss.map(i => '<div class="issue '+i.k+'">'+
    '<span class="ic">'+i.ic+'</span><span><span>'+i.t+'</span><br>'+
    '<span class="sub">'+i.s+'</span></span></div>').join("")+'</div>';
}

/* ---------- взаимодействие ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-sport],[data-open],[data-todo],[data-showhidden],[data-hide],[data-unhide],[data-del-author],[data-shift],[data-jump],.tab");
  if(!t || ov.contains(t)) return;
  if(t.classList.contains("tab")){
    S.view = t.dataset.view;
    document.querySelectorAll(".tab").forEach(x =>
      x.setAttribute("aria-selected", x===t ? "true" : "false"));
    render(); return;
  }
  if(t.dataset.jump){ setWeek(mondayOf(parseISO(t.dataset.jump))); return; }
  if(t.dataset.sport){
    S.sports.has(t.dataset.sport) ? S.sports.delete(t.dataset.sport) : S.sports.add(t.dataset.sport);
    t.setAttribute("aria-pressed", S.sports.has(t.dataset.sport)); render(); return;
  }
  if(t.dataset.open){ S.onlyOpen = !S.onlyOpen; t.setAttribute("aria-pressed", S.onlyOpen); render(); return; }
  if(t.dataset.todo){ S.onlyTodo = !S.onlyTodo; t.setAttribute("aria-pressed", S.onlyTodo); render(); return; }
  if(!EDITOR) return;                       // по-долу са само редакции
  if(t.dataset.showhidden){ S.showHidden = !S.showHidden; t.setAttribute("aria-pressed", S.showHidden); render(); return; }
  if(t.dataset.hide){ hideEvent(t.dataset.hide); return; }
  if(t.dataset.unhide){ delete S.hidden[t.dataset.unhide]; saveLocal(); render(); return; }
  if(t.dataset.delAuthor){
    const a = S.authors[t.dataset.delAuthor]; if(!a) return;
    if(confirmBtn(t, "×?")){
      notice("");
      Object.keys(S.assign).forEach(k => { if(S.assign[k].authorId===a.id) delete S.assign[k]; });
      delete S.authors[a.id]; saveLocal(); render();
    } else notice("Натиснете <b>×</b> отново, за да премахнете <b>"+esc(a.name)+"</b>.");
    return;
  }
  if(t.dataset.shift){ openShiftEditor(t.dataset.shift); return; }
});
document.addEventListener("change", e => {
  const s = e.target; if(ov.contains(s)) return;
  // „поето“ е общо — всеки може да го слага, ако базата е вързана
  if(s.dataset.done && sharedOn()){ setMark(s.dataset.done, s.checked); return; }
  if(!EDITOR) return;
  if(s.dataset.done){
    if(s.checked) S.done[s.dataset.done] = true; else delete S.done[s.dataset.done];
    saveLocal(); render(); return;
  }
  if(s.dataset.assign){
    if(s.value) S.assign[s.dataset.assign] =
      {authorId:s.value, format:(S.assign[s.dataset.assign]||{}).format||""};
    else delete S.assign[s.dataset.assign];
    saveLocal(); render();
  } else if(s.dataset.format){
    const cur = S.assign[s.dataset.format];
    if(cur){ cur.format = s.value; saveLocal(); render(); }
  }
});
document.getElementById("q").addEventListener("input", e => { S.q = e.target.value.trim(); render(); });
document.getElementById("authorForm").addEventListener("submit", e => {
  e.preventDefault();
  if(!EDITOR) return;
  const name = document.getElementById("anName").value.trim(); if(!name) return;
  const n = Object.keys(S.authors).length, shifts = {};
  DATES.forEach(d => shifts[d] = PRESETS.full.map(x => ({s:x.s, e:x.e})));
  const id = uid();
  S.authors[id] = {id, name, role:document.getElementById("anRole").value.trim(),
                   color:PALETTE[n%PALETTE.length], shifts};
  saveLocal(); e.target.reset(); render(); document.getElementById("anName").focus();
});
document.getElementById("eventForm").addEventListener("submit", e => {
  e.preventDefault();
  if(!EDITOR) return;
  const title = document.getElementById("evTitle").value.trim(); if(!title) return;
  const id = "c"+uid();
  S.custom[id] = {id, date:document.getElementById("evDate").value,
    time:document.getElementById("evTime").value,
    sport:document.getElementById("evSport").value,
    comp:document.getElementById("evComp").value.trim()||"Собствено",
    title, p:+document.getElementById("evPrio").value, note:"", provisional:false};
  saveLocal(); e.target.reset();
  document.getElementById("evTime").value = "19:00";
  render(); document.getElementById("evTitle").focus();
});
function buildDateSelect(){
  document.getElementById("evDate").innerHTML = DATES.map((d,i) => {
    const dt = parseISO(d);
    return '<option value="'+d+'">'+DAYSHORT[i]+" "+dt.getDate()+"."+pad(dt.getMonth()+1)+'</option>';
  }).join("");
}
function setWeek(d){ S.weekStart = d; DATES = weekDates(d); render(); }
document.getElementById("prevW").addEventListener("click", () => {
  const d = new Date(S.weekStart); d.setDate(d.getDate()-7); setWeek(d);
});
document.getElementById("nextW").addEventListener("click", () => {
  const d = new Date(S.weekStart); d.setDate(d.getDate()+7); setWeek(d);
});
document.getElementById("todayBtn").addEventListener("click", () => setWeek(mondayOf(new Date())));
document.getElementById("autoBtn").addEventListener("click", () => { if(EDITOR) autoAssign(); });
document.getElementById("editBtn").addEventListener("click", openEditorLogin);
document.getElementById("printBtn").addEventListener("click", () => window.print());
document.getElementById("manBtn").addEventListener("click", () => {
  const list = Object.values(S.custom).map(e => ({
    date:e.date, time:e.time, sport:e.sport, comp:e.comp,
    title:e.title, p:e.p, note:e.note || ""
  })).sort((x,y) => x.date===y.date ? x.time.localeCompare(y.time) : x.date.localeCompare(y.date));
  if(!list.length){ notice("Още нямаш свои добавени събития. Добави ги от панела отляво."); return; }
  const url = URL.createObjectURL(new Blob([JSON.stringify(list, null, 1)],
    {type:"application/json"}));
  const a = document.createElement("a");
  a.href = url; a.download = "manual-events.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notice("Свален е <b>manual-events.json</b> с <b>"+list.length+"</b> събития. "+
    "Качи го в папка <b>config/</b> и ще се появяват при всички, при всяко обновяване.");
});
document.getElementById("pubBtn").addEventListener("click", publish);
document.getElementById("csvBtn").addEventListener("click", () => {
  const rows = [["Дата","Ден","Час","Спорт","Турнир","Събитие","Автор","Формат","Поето","Часът потвърден"]];
  weekEvents().forEach(e => {
    const a = S.assign[e.id] ? S.authors[S.assign[e.id].authorId] : null;
    rows.push([e.date, DAYFULL[dayIdx(e.date)], e.time, (SPORTS[e.sport]||{}).n||"",
      e.comp, e.title, a?a.name:"", S.assign[e.id]?(S.assign[e.id].format||""):"",
      S.done[e.id]?"да":"не", e.provisional?"не":"да"]);
  });
  const csv = "﻿"+rows.map(r => r.map(c => '"'+String(c).replace(/"/g,'""')+'"').join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], {type:"text/csv"}));
  const a = document.createElement("a");
  a.href = url; a.download = "grafik-"+DATES[0]+".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ---------- общи отметки „поето“ (Supabase) ---------- */
/* Новите ключове (sb_publishable_…) стигат само в apikey; старият anon е JWT и иска и Authorization. */
const sbHeaders = () => ({ apikey: SHARED.key, "Content-Type": "application/json",
  ...(SHARED.key.startsWith("sb_") ? {} : { Authorization: "Bearer "+SHARED.key }) });
/** Слага отметките от базата върху публикуваното — те са по-новото. */
async function loadMarks(){
  if(!sharedOn()) return false;
  try{
    const r = await fetch(SHARED.url+"/rest/v1/done_marks?select=event_id,done", {headers:sbHeaders(), cache:"no-store"});
    if(!r.ok) return false;
    for(const m of await r.json()){ if(m.done) S.done[m.event_id] = true; else delete S.done[m.event_id]; }
    return true;
  }catch(e){ return false; }
}
async function setMark(id, done){
  const was = !!S.done[id];
  if(done) S.done[id] = true; else delete S.done[id];
  render();
  try{
    const r = await fetch(SHARED.url+"/rest/v1/done_marks", { method:"POST",
      headers:{...sbHeaders(), Prefer:"resolution=merge-duplicates"},
      body: JSON.stringify([{event_id:id, done, updated_at:new Date().toISOString()}]) });
    if(!r.ok) throw new Error("HTTP "+r.status);
    if(EDITOR) saveLocal(false);
  }catch(err){
    if(was) S.done[id] = true; else delete S.done[id];
    render();
    notice("Отметката не се запази ("+esc(err.message)+"). Проверете връзката и опитайте пак.");
  }
}

/* ---------- старт ---------- */
(async function init(){
  const hadLocal = EDITOR && loadLocal();
  const [ok, pub] = await Promise.all([loadFeed(), loadPublished()]);
  S.published = pub;
  // Прегледът вижда само публикуваното. Редакторът — своето, а на нов браузър публикуваното.
  if(!hadLocal) applyState(pub);
  await loadMarks();
  applyMode();
  if(!ok) return;
  const gen = new Date(S.feed.generatedAt);
  document.getElementById("sub").textContent =
    "Програма "+S.feed.from+" → "+S.feed.to+" · всички часове в българско време · "+
    S.feed.count+" събития";
  document.getElementById("freshTxt").textContent =
    "обновено "+gen.toLocaleString("bg-BG",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
  document.getElementById("foot").innerHTML =
    "<p><strong>За часовете.</strong> Мачовете, чийто час лигата още не е потвърдила, са отбелязани с <b>?</b> "+
    "и с етикет „часът не е потвърден“. Телевизионните избори обикновено се фиксират около 5–6 седмици предварително, "+
    "така че в далечния край на месеца очаквайте размествания.</p>"+
    "<p><strong>Къде се пазят данните.</strong> Програмата идва от хранилището и се обновява автоматично. "+
    "Разпределението го прави редакторът и го публикува — всички останали виждат публикуваното "+
    "и страницата им го обновява сама на всеки 2 минути.</p>";
  const t = new Date(), from = parseISO(S.feed.from), to = parseISO(S.feed.to);
  setWeek(mondayOf(t >= from && t <= to ? t : from));
  // прегледът следи за ново публикуване
  setInterval(async () => {
    if(EDITOR || !ov.hidden) return;
    const p = await loadPublished();
    if(p && p.publishedAt !== (S.published||{}).publishedAt){
      S.published = p; applyState(p); await loadMarks(); render();
    }
  }, 120000);
  // отметките „поето“ от колегите — всяка минута, за всички
  if(sharedOn()) setInterval(async () => {
    if(!ov.hidden || document.activeElement?.tagName === "SELECT") return;
    if(await loadMarks()) render();
  }, 60000);
})();
