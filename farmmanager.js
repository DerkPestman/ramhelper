(() => {
/* ============================================================
   FarmManager v1.5  (NL)
   ============================================================ */

const APP = {
  VER: '1.5',
  KEYS: {
    cfg:     'FM_cfg',
    walls:   'FM_walls',    // { "x|y": {wall, loss(0/1), dead(0/1), full(0/1), lastTs, id, ts, isBarb(1/0)} }
    presets: 'FM_presets',  // { C: {...}, D?: {...} }
    meta:    'FM_meta',     // { lastScanTs }
    units:   'FM_units'     // { "<villageId>": { spear:.., sword:.., ... } }
  },
  SCAN: { CONCURRENCY: 3, DELAY_MIN: 300, DELAY_MAX: 500, DEFAULT_LIMIT: 50 },
  PLACE: { CONCURRENCY: 3, DELAY_MIN: 200, DELAY_MAX: 350 },
  qs: (s,r=document)=>r.querySelector(s),
  qsa:(s,r=document)=>Array.from(r.querySelectorAll(s)),
};

// ---------- defaults ----------
function defaultCfg(){
  const wallMap={1:8,2:12,3:16,4:20,5:24,6:28,7:32,8:36,9:40,10:44,11:48,12:52,13:56,14:60,15:64,16:68,17:72,18:76,19:80,20:84};
  return {
    filters:{ maxDist:25, minMinutesBetween:5, sort:'dist_then_wall' },
    logic:{
      addRamsOnWall:true,    // C zichtbaar bij muur>0
      onlyOnLoss:true,       // C alleen tonen bij (gedeeltelijke) verliezen
      useBWhenFull:true      // B bij volle buit
    },
    wallMap,
    scanLimit: APP.SCAN.DEFAULT_LIMIT
  };
}
function defaultPresets(){
  return {
    C:{spear:0,sword:0,axe:0,archer:0,spy:0,light:0,heavy:0,marcher:0,ram:0,catapult:0,knight:0}
  };
}
function defaultMeta(){ return {lastScanTs:0}; }

// ---------- storage ----------
const loadCfg=()=>{try{return Object.assign(defaultCfg(),JSON.parse(localStorage.getItem(APP.KEYS.cfg)||'{}'));}catch{return defaultCfg();}};
const saveCfg=(c)=>localStorage.setItem(APP.KEYS.cfg,JSON.stringify(c));
const loadWalls=()=>{try{return JSON.parse(localStorage.getItem(APP.KEYS.walls)||'{}');}catch{return{};}};
const saveWalls=(m)=>localStorage.setItem(APP.KEYS.walls,JSON.stringify(m));
const loadPresets=()=>{try{return Object.assign(defaultPresets(),JSON.parse(localStorage.getItem(APP.KEYS.presets)||'{}'));}catch{return defaultPresets();}};
const savePresets=(p)=>localStorage.setItem(APP.KEYS.presets,JSON.stringify(p));
const loadMeta=()=>{try{return Object.assign(defaultMeta(),JSON.parse(localStorage.getItem(APP.KEYS.meta)||'{}'));}catch{return defaultMeta();}};
const saveMeta=(m)=>localStorage.setItem(APP.KEYS.meta,JSON.stringify(m));
const loadUnits=()=>{try{return JSON.parse(localStorage.getItem(APP.KEYS.units)||'{}');}catch{return{};}};
const saveUnits=(u)=>localStorage.setItem(APP.KEYS.units,JSON.stringify(u));

// ---------- utils ----------
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const rint=(a,b)=>Math.floor(a+Math.random()*(b-a+1));
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const toInt=(v)=>Math.max(0,(v|0));
const now=()=>Date.now();
const dist=(a,b)=>Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2);
function myCoords(){
  const t=document.body.innerText||''; const m=t.match(/\b(\d{3})\|(\d{3})\b/);
  return m?{x:+m[1],y:+m[2]}:null;
}
function myVillageId(){
  const m=location.search.match(/[?&]village=(\d+)/);
  return m?m[1]:'';
}
function fmtDateTime(ts){
  if(!ts) return '–';
  const d=new Date(ts);
  const p=n=>String(n).padStart(2,'0');
  return `${p(d.getDate())}-${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function faColors(){
  return { bg:'#e9d4b4', head:'#e2cba3', border:'#c7a76a', btn:'#b2773a', btnHover:'#a05b31' };
}

// ========== wereldsnelheid + unitSpeed ==========
let WORLD = {speed:1, unit_speed:1}; // fallback
async function ensureWorldSpeeds(){
  if(ensureWorldSpeeds.done) return;
  try{
    const res = await fetch('interface.php?func=get_config',{credentials:'same-origin'});
    const xml = await res.text();
    const s = +(xml.match(/<speed>([\d.]+)<\/speed>/)?.[1] || 1);
    const u = +(xml.match(/<unit_speed>([\d.]+)<\/unit_speed>/)?.[1] || 1);
    WORLD.speed = s>0?s:1;
    WORLD.unit_speed = u>0?u:1;
  }catch(e){}
  ensureWorldSpeeds.done = true;
}
// minuten per veld bij (speed=1, unit_speed=1)
const BASE_MIN_PER_FIELD = {
  spear:18, sword:18, axe:18, archer:18,
  spy:9, light:10, heavy:11, marcher:10,
  ram:30, catapult:30, knight:10, noble:35
};
function minutesPerFieldForPreset(preset){
  let maxMin = 0;
  Object.entries(preset||{}).forEach(([u,c])=>{
    if(!c) return;
    const base = BASE_MIN_PER_FIELD[u];
    if(base) maxMin = Math.max(maxMin, base);
  });
  if(maxMin===0) maxMin = 10; // default LC
  return maxMin / (WORLD.speed * WORLD.unit_speed);
}
function formatDurationMinutes(mins){
  const totalSec = Math.round(mins*60);
  const hh = Math.floor(totalSec/3600);
  const mm = Math.floor((totalSec%3600)/60);
  const ss = totalSec%60;
  const pad=n=>String(n).padStart(2,'0');
  return (hh?`${pad(hh)}:`:'')+`${pad(mm)}:${pad(ss)}`;
}

// ============================================================
//  UI injecties
// ============================================================
function injectStyles(){
  if(APP.qs('#fm-styles'))return;
  const C=faColors();
  const st=document.createElement('style'); st.id='fm-styles';
  st.textContent=`
  .fm-btn{background:${C.btn};border:none;color:#fff;padding:4px 8px;border-radius:6px;cursor:pointer;font:12px Verdana;transition:background .12s}
  .fm-btn.small{padding:3px 6px;min-width:28px;text-align:center}
  .fm-btn:hover{background:${C.btnHover}}
  .fm-btn:disabled{opacity:.6;cursor:default}
  .fm-input{padding:3px 6px;border:1px solid ${C.border};border-radius:6px;background:#fff}
  .fm-block{margin:8px 0;padding:10px;border:1px solid ${C.border};border-radius:8px;background:${C.bg}}
  .fm-row-v{display:flex;flex-direction:column;gap:6px}
  .fm-table-head{background:${C.head};border-bottom:1px solid ${C.border};font-weight:bold}
  .fm-cell{padding:6px 8px;border-bottom:1px dashed ${C.border}}
  .fm-grid{display:grid;grid-template-columns:24px 110px 60px 72px 70px 72px 130px 100px 160px}
  /* ● | Coords | Muur | Afstand | Duur | Rammen | Laatst aangevallen | Aangeraden | Actie */
  .fm-grid-head{display:grid;grid-template-columns:24px 110px 60px 72px 70px 72px 130px 100px 160px}
  .fm-link{color:#532; text-decoration:underline; cursor:pointer}
  .fm-ov{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
  .fm-card{width:720px;max-height:86vh;overflow:auto;border-radius:12px;background:${C.bg};border:1px solid ${C.border};box-shadow:0 10px 30px rgba(0,0,0,.45)}
  .fm-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid ${C.border};background:${C.head};border-top-left-radius:12px;border-top-right-radius:12px}
  .fm-body{padding:12px 14px}
  .fm-actions{display:flex;flex-direction:row;gap:6px;justify-content:flex-end} /* rechts, horizontaal A/B/C */
  .fm-dot{width:10px;height:10px;border-radius:50%;display:inline-block;border:1px solid #644}
  .fm-dot.green{background:#2e9f4f}
  .fm-dot.yellow{background:#d8a732}
  .fm-dot.red{background:#c43c2c}
  `;
  document.head.appendChild(st);
}

function injectMainBar(){
  if(APP.qs('#fm-mainbar')) return;
  if(!/[?&]screen=am_farm\b/.test(location.search)) return; // FA-only

  const host=APP.qs('#content_value')||document.body;
  const bar=document.createElement('div'); bar.id='fm-mainbar'; bar.className='fm-block';
  const cfg=loadCfg();
  bar.innerHTML=`
    <div class="fm-row-v">
      <label>Max velden <input id="fm-maxdist" class="fm-input" type="number" min="1" max="200" value="${cfg.filters.maxDist}" style="width:90px"></label>
      <label>Min. minuten tussen farms <input id="fm-minmin" class="fm-input" type="number" min="0" max="1440" value="${cfg.filters.minMinutesBetween}" style="width:90px"></label>
      <label><input id="fm-onlyloss" type="checkbox" ${cfg.logic.onlyOnLoss?'checked':''}> Rammen bij gedeeltelijke verliezen (bepaalt zichtbaarheid van “C”)</label>
      <label><input id="fm-useB" type="checkbox" ${cfg.logic.useBWhenFull?'checked':''}> B-farm bij volle buit</label>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button id="fm-scan" class="fm-btn">Scan rapporten</button>
      <button id="fm-settings" class="fm-btn">Instellingen</button>
      <button id="fm-save" class="fm-btn">Opslaan</button>
    </div>
    <div id="fm-status" style="margin-top:6px;opacity:.9"></div>
  `;
  host.insertBefore(bar, host.firstChild);

  APP.qs('#fm-save').onclick=()=>{
    const c=loadCfg();
    c.filters.maxDist=clamp(+APP.qs('#fm-maxdist').value||c.filters.maxDist,1,200);
    c.filters.minMinutesBetween=clamp(+APP.qs('#fm-minmin').value||0,0,1440);
    c.logic.onlyOnLoss=APP.qs('#fm-onlyloss').checked;
    c.logic.useBWhenFull=APP.qs('#fm-useB').checked;
    saveCfg(c); setStatus('Instellingen opgeslagen ✔️'); renderResults(); setTimeout(()=>setStatus(''),1200);
  };
  APP.qs('#fm-settings').onclick=()=>openSettingsOverlay();
  APP.qs('#fm-scan').onclick=()=>openScanOverlay(true); // auto start
}

function injectResultsBlock(){
  if(APP.qs('#fm-results')) return;
  if(!/[?&]screen=am_farm\b/.test(location.search)) return;

  const host=APP.qs('#content_value')||document.body;
  const box=document.createElement('div'); box.id='fm-results'; box.className='fm-block';
  box.innerHTML=`
    <div class="fm-table-head fm-grid-head" style="padding:6px 8px;border-top-left-radius:8px;border-top-right-radius:8px">
      <div></div><div>Coords</div><div>Muur</div><div>Afstand</div><div>Duur</div><div>Rammen</div><div>Laatst aangevallen</div><div>Aangeraden</div><div style="text-align:right;padding-right:12px">Actie</div>
    </div>
    <div id="fm-res-body"></div>
  `;
  host.insertBefore(box, APP.qs('#fm-mainbar')?.nextSibling || host.firstChild);
  renderResults();
}

function setStatus(t){ const el=APP.qs('#fm-status'); if(el) el.textContent=t||''; }

// ============================================================
// Scan overlay (auto start + auto close)
// ============================================================
function openScanOverlay(autoStart){
  if(APP.qs('#fm-ov-scan')) return;
  const ov=document.createElement('div'); ov.className='fm-ov'; ov.id='fm-ov-scan';
  ov.innerHTML=`
  <div class="fm-card">
    <div class="fm-head"><div><b>Scan rapporten</b></div><button id="fm-close-scan" class="fm-btn" style="background:#a55">Sluiten</button></div>
    <div class="fm-body">
      <div id="fm-prog" style="height:12px;background:#f0e6d2;border-radius:6px;overflow:hidden;margin-bottom:8px"><div id="fm-bar" style="height:100%;width:0;background:#6a8e3a"></div></div>
      <div id="fm-stat" style="margin-bottom:8px;opacity:.9">Zoek rapportlinks…</div>
      <div style="display:flex;gap:8px">
        <button id="fm-start" class="fm-btn">Start</button>
        <button id="fm-cancel" class="fm-btn" disabled>Annuleren</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(ov);
  APP.qs('#fm-close-scan').onclick=()=>ov.remove();
  bindScanOverlay(ov, autoStart);
}

function bindScanOverlay(ov, autoStart){
  const bar=APP.qs('#fm-bar',ov), st=APP.qs('#fm-stat',ov);
  let cancel=false; const btnStart=APP.qs('#fm-start',ov), btnCancel=APP.qs('#fm-cancel',ov);
  function upd(done,max,updCnt){ bar.style.width=((done/max)*100).toFixed(1)+'%'; st.textContent=`Bezig: ${done}/${max} — bijgewerkt: ${updCnt}`; setStatus(`Scannen… ${done}/${max}`);}
  btnCancel.onclick=()=>{cancel=true;};

  async function run(){
    const links=APP.qsa('a[href*="screen=report"][href*="view="]');
    if(!links.length){ st.textContent='Geen rapportlinks op deze pagina. Open je rapportenlijst of een individueel rapport.'; return; }
    const cfg=loadCfg(); const max=Math.min(links.length, cfg.scanLimit|0 || APP.SCAN.DEFAULT_LIMIT);
    btnStart.disabled=true; btnCancel.disabled=false; st.textContent=`Gevonden: ${max} rapport(en). Start…`;
    const db=loadWalls(); let done=0, updated=0; let idx=0;

    async function worker(){
      while(!cancel && idx<max){
        const i=idx++, href=links[i].href;
        try{
          const html=await (await fetch(href,{credentials:'same-origin'})).text();
          const got=parseReport(html);
          if(got && got.coords){
            const rec=db[got.coords]||{};
            if(typeof got.wall==='number') rec.wall=got.wall;
            if(typeof got.loss==='boolean') rec.loss=got.loss?1:0;
            if(typeof got.dead==='boolean') rec.dead=got.dead?1:0;
            if(typeof got.full==='boolean') rec.full=got.full?1:0;
            if(typeof got.isBarb==='number') rec.isBarb=got.isBarb;
            if(got.timeMs) rec.lastTs=got.timeMs;
            if(got.id) rec.id=got.id;
            rec.ts=now();
            db[got.coords]=rec; updated++;
          }
        }catch(e){}
        done++; upd(done,max,updated);
        await sleep(rint(APP.SCAN.DELAY_MIN, APP.SCAN.DELAY_MAX));
      }
    }
    await Promise.all(Array.from({length:APP.SCAN.CONCURRENCY}, worker));
    saveWalls(db);

    // Troepen voor ALLE dorpen ophalen (place) en cachen
    st.textContent='Verzamelplaatsgegevens ophalen…';
    await collectAllVillageUnits();

    // markeer als "net gescand" zodat resultaten mogen renderen
    const meta=loadMeta(); meta.lastScanTs=now(); saveMeta(meta);

    btnStart.disabled=false; btnCancel.disabled=true;
    const msg = cancel?`Geannuleerd.`:`Klaar. Gegevens bijgewerkt.`;
    st.textContent = msg; setStatus('Scan voltooid'); renderResults();
    // auto close na 800ms
    setTimeout(()=>{ if(document.body.contains(ov)) ov.remove(); }, 800);
  }

  btnStart.onclick=run;
  if(autoStart) run();
}

// ============================================================
// Instellingen Overlay (C editable, D optioneel, scanLimit)
// ============================================================
function openSettingsOverlay(){
  if(APP.qs('#fm-ov-set')) return;
  const ov=document.createElement('div'); ov.className='fm-ov'; ov.id='fm-ov-set';
  ov.innerHTML=`
  <div class="fm-card">
    <div class="fm-head"><div><b>Instellingen – FarmManager</b></div><button id="fm-close-set" class="fm-btn" style="background:#a55">Sluiten</button></div>
    <div id="fm-set-body" class="fm-body"></div>
  </div>`;
  document.body.appendChild(ov);
  APP.qs('#fm-close-set').onclick=()=>ov.remove();
  renderSettings(APP.qs('#fm-set-body'));
}

function renderSettings(root){
  const cfg=loadCfg(); const presets=loadPresets();
  const unitOrder=['spear','sword','axe','archer','spy','light','heavy','marcher','ram','catapult','knight'];
  const labels={spear:'Speer',sword:'Zwaard',axe:'Bijl',archer:'Boog',spy:'Verkenner',light:'LC',heavy:'ZC',marcher:'Ruiterboog',ram:'Ram',catapult:'Kata',knight:'Ridder'};
  const icon=(k)=>`graphic/unit/unit_${k}.png`;

  function unitRow(name, p){
    return `
    <fieldset style="border:1px solid #c7a76a;border-radius:8px;padding:8px 10px">
      <legend style="padding:0 6px">Preset ${name}</legend>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px">
        ${unitOrder.map(u => `
          <label title="${labels[u]}" style="display:flex;align-items:center;gap:6px">
            <img src="${icon(u)}" width="16" height="16" style="image-rendering:pixelated">
            <input data-fm-pre="${name}:${u}" class="fm-input" type="number" min="0" value="${toInt(p[u]||0)}" style="width:70px">
          </label>
        `).join('')}
      </div>
    </fieldset>`;
  }

  const wallGrid1 = Array.from({length:10},(_,i)=>i+1).map(lv=>`
    <label>Lv ${lv}<br><input data-fm-w="${lv}" class="fm-input" type="number" min="0" value="${cfg.wallMap[lv]||0}" style="width:70px"></label>
  `).join('');
  const wallGrid2 = Array.from({length:10},(_,i)=>i+11).map(lv=>`
    <label>Lv ${lv}<br><input data-fm-w="${lv}" class="fm-input" type="number" min="0" value="${cfg.wallMap[lv]||0}" style="width:70px"></label>
  `).join('');

  const hasD = !!presets.D;
  root.innerHTML=`
    <fieldset style="border:1px solid #c7a76a;border-radius:8px;padding:8px 10px">
      <legend style="padding:0 6px">Scan-instellingen</legend>
      <label>Maximaal aantal rapporten per scan
        <input id="fm-scanlimit" class="fm-input" type="number" min="10" max="200" value="${cfg.scanLimit}" style="width:90px">
      </label>
    </fieldset>

    ${unitRow('C', presets.C)}
    <div style="display:flex;align-items:center;gap:8px;margin:8px 0">
      <span style="font-weight:bold">Extra preset</span>
      ${!hasD ? `<button id="fm-add-d" class="fm-btn">＋ Voeg preset D toe</button>` :
        `<span style="padding:2px 6px;border:1px solid #c7a76a;background:#ecd6ad;border-radius:10px">Preset D actief</span> <button id="fm-del-d" class="fm-btn" style="background:#a55">Verwijderen</button>`}
    </div>
    ${hasD ? unitRow('D', presets.D) : ''}

    <fieldset style="border:1px solid #c7a76a;border-radius:8px;padding:8px 10px">
      <legend style="padding:0 6px">Rammen per muurlevel</legend>
      <div style="display:grid;grid-template-columns:repeat(10,1fr);gap:8px">${wallGrid1}</div>
      <details style="margin-top:8px">
        <summary style="cursor:pointer">Meer niveaus (11–20)</summary>
        <div style="display:grid;grid-template-columns:repeat(10,1fr);gap:8px;margin-top:8px">${wallGrid2}</div>
      </details>
    </fieldset>
  `;

  // autosave bindings
  root.addEventListener('input', (e)=>{
    const t=e.target;
    if(t.id==='fm-scanlimit'){ const c=loadCfg(); c.scanLimit=clamp(+t.value||APP.SCAN.DEFAULT_LIMIT,10,200); saveCfg(c); return; }
    if(t.matches('[data-fm-pre]')){
      const [name,u]=t.getAttribute('data-fm-pre').split(':');
      const p=loadPresets(); if(!p[name]) p[name]={};
      p[name][u]=toInt(t.value); savePresets(p); return;
    }
    if(t.matches('[data-fm-w]')){
      const lv=+t.getAttribute('data-fm-w'); const c=loadCfg(); c.wallMap[lv]=toInt(t.value); saveCfg(c); return;
    }
  });

  const addD=APP.qs('#fm-add-d',root), delD=APP.qs('#fm-del-d',root);
  if(addD) addD.onclick=()=>{ const p=loadPresets(); if(!p.D) p.D=JSON.parse(JSON.stringify(p.C)); savePresets(p); renderSettings(root); };
  if(delD) delD.onclick=()=>{ const p=loadPresets(); delete p.D; savePresets(p); renderSettings(root); };
}

// ============================================================
// Hulp: FA-sjablonen A/B uitlezen + titel
// ============================================================
function readFAPreset(letter){
  const table = APP.qsa('table').find(t=>/Sjabloon/i.test(t.innerText||''));
  const units=['spear','sword','axe','archer','spy','light','heavy','marcher','ram','catapult','knight'];
  const out={}; units.forEach(u=>out[u]=0);
  if(!table) return out;

  const rows=APP.qsa('tr',table);
  const row=rows.find(r=>((r.cells?.[0]?.innerText||'').trim()===letter));
  if(!row){ return out; }

  const inputs=APP.qsa('input',row).filter(inp=>inp.type==='text' || inp.type==='number');
  inputs.forEach((inp,i)=>{ if(i<units.length) out[units[i]]=toInt(inp.value); });
  return out;
}
function compTitle(units){
  const order=['spy','light','axe','spear','sword','heavy','archer','marcher','ram','catapult','knight'];
  const names={spy:'Verkenner',light:'LC',axe:'Bijl',spear:'Speer',sword:'Zwaard',heavy:'ZC',archer:'Boog',marcher:'Ruiterboog',ram:'Ram',catapult:'Kata',knight:'Ridder'};
  const parts=[]; order.forEach(k=>{const v=units[k]|0; if(v>0) parts.push(`${names[k]}: ${v}`);}); return parts.length?`Stuurt: ${parts.join(', ')}`:'Stuurt: (geen)';
}
function withRamsAndScout(base, rams){
  const u=JSON.parse(JSON.stringify(base||{})); u.ram=(u.ram|0)+rams; u.spy=(u.spy|0)+1; return u;
}

// ============================================================
// Report parsing  (herken barb + verliesstatus + deadAll + full + tijd)
// ============================================================
function parseReport(html){
  const doc=new DOMParser().parseFromString(html,'text/html');
  const txt=(doc.body.innerText||'').replace(/\s+/g,' ');
  // muur
  let wall;
  const tds=APP.qsa('table td',doc);
  for(let i=0;i<tds.length;i++){
    const t=(tds[i].innerText||'').trim();
    if(/^(Muur|Wall)$/i.test(t)){ const v=(tds[i+1]?.innerText||'').trim(); if(/^\d+$/.test(v)){ wall=parseInt(v,10); break; } }
  }
  if(wall===undefined){ const m=txt.match(/Muur\s*:\s*(?:niveau\s*)?(\d+)|Wall\s*:\s*(?:level\s*)?(\d+)/i); if(m) wall=parseInt(m[1]||m[2],10); }
  // coords
  const mc=txt.match(/\b(\d{3})\|(\d{3})\b/); const coords=mc?mc[1]+'|'+mc[2]:null;
  // id
  let id=null; const vlink=APP.qs('a[href*="screen=info_village"][href*="id="]',doc); if(vlink){ const m=vlink.href.match(/id=(\d+)/); if(m) id=m[1]; }
  // barb?
  const isBarb = /Barbarendorp|Barbarian\s+village/i.test(txt) ? 1 : 0;
  // verlies-indicatoren
  let loss=false, deadAll=false;
  if(/verliezen|losses/i.test(txt)){
    const deadMsg = /(volledige nederlaag|alle.*gesneuveld|all (?:your )?troops (?:have )?died)/i.test(txt);
    deadAll = !!deadMsg;
    const anyLoss = /verliezen[^0-9]*([1-9]\d*)/i.test(txt) || /losses[^0-9]*([1-9]\d*)/i.test(txt);
    loss = anyLoss || deadAll;
  }
  // full haul
  const full=/Volledige buit|Full haul|Volle buit/i.test(txt);
  // tijd
  let timeMs=null;
  const d1=txt.match(/(\d{2}[.\-\/]\d{2}[.\-\/]\d{2,4})\s+(\d{2}:\d{2}(?::\d{2})?)/);
  if(d1){ const d=d1[1].replace(/\./g,'-').replace(/\//g,'-'); const iso=(/\d{4}-/.test(d)?d:d.split('-').reverse().join('-'))+'T'+d1[2]; const t=Date.parse(iso); if(!isNaN(t)) timeMs=t; }
  return {coords,wall,loss,dead:deadAll,full,timeMs,id,isBarb};
}

// ============================================================
// Village discovery + units via place
// ============================================================
function discoverVillageIds(){
  // beste poging: zoek alle links met &village=... in top/breadcrumbs etc.
  const ids=new Set();
  const links=APP.qsa('a[href*="village="]');
  links.forEach(a=>{
    const m=a.href.match(/[?&]village=(\d+)/);
    if(m) ids.add(m[1]);
  });
  // altijd huidige
  const cur=myVillageId(); if(cur) ids.add(cur);
  return Array.from(ids);
}
async function fetchPlaceUnits(villageId){
  try{
    const url=`game.php?village=${villageId}&screen=place`;
    const html=await (await fetch(url,{credentials:'same-origin'})).text();
    const doc=new DOMParser().parseFromString(html,'text/html');
    const map={spear:0,sword:0,axe:0,archer:0,spy:0,light:0,heavy:0,marcher:0,ram:0,catapult:0,knight:0};
    Object.keys(map).forEach(k=>{
      const inp=doc.querySelector(`#unit_input_${k}`) || doc.querySelector(`input[name="${k}"]`);
      if(inp){ const max=(inp.getAttribute('data-all-count')||inp.getAttribute('data-max')||inp.getAttribute('data-available')||'0')|0; map[k]=max; }
      else{
        // fallback: tekst naast icoon
        const img=Array.from(doc.querySelectorAll('img[src*="unit_'+k+'"]'))[0];
        if(img){
          const cell=img.closest('td,span,div'); const m=(cell?.innerText||'').match(/(\d+)/); if(m) map[k]=+m[1];
        }
      }
    });
    return map;
  }catch(e){ return null; }
}
async function collectAllVillageUnits(){
  const ids=discoverVillageIds();
  const out={}; let idx=0;
  async function worker(){
    while(idx<ids.length){
      const i=idx++, vid=ids[i];
      const got=await fetchPlaceUnits(vid);
      if(got) out[vid]=got;
      await sleep(rint(APP.PLACE.DELAY_MIN, APP.PLACE.DELAY_MAX));
    }
  }
  await Promise.all(Array.from({length:APP.PLACE.CONCURRENCY}, worker));
  saveUnits(out);
  return out;
}

// ============================================================
// Resultatenlijst rendering
// ============================================================
function renderResults(){
  const body=APP.qs('#fm-res-body'); if(!body) return;
  const cfg=loadCfg(); const walls=loadWalls(); const me=myCoords();
  const meta=loadMeta();
  const unitsByVid=loadUnits();

  if(!meta.lastScanTs){ body.innerHTML=`<div class="fm-cell" style="padding:8px">Nog geen gegevens. Klik <b>Scan rapporten</b> om te starten.</div>`; return; }

  const items=[];
  Object.keys(walls).forEach(k=>{
    const rec=walls[k];
    if(!rec || !rec.isBarb) return; // alleen barbs
    const [x,y]=k.split('|').map(Number);
    const it={coords:k,x,y,id:rec.id||null,wall:rec.wall|0,loss:!!rec.loss,dead:!!rec.dead,full:!!rec.full,lastTs:rec.lastTs||0};
    it.dist=me? +dist(me,it).toFixed(2) : null;
    items.push(it);
  });

  const maxD=cfg.filters.maxDist|0, minGap=cfg.filters.minMinutesBetween|0;
  let list=items.filter(it=>{
    if(me && maxD && it.dist!=null && it.dist>maxD) return false;
    if(minGap>0 && it.lastTs && ( (Date.now()-it.lastTs)/60000 < minGap) ) return false;
    return true;
  });

  // Presets
  const presetA = readFAPreset('A');
  const presetB = readFAPreset('B');
  const pCbase  = loadPresets().C || {};

  // helper: isNonZero preset?
  const hasTroops = (p)=>Object.values(p||{}).some(v=> (v|0) > 0);

  // Voor elke barb: check of minstens één preset haalbaar is in een of meer dorpen
  function villageCandidatesFor(preset){
    const vids = Object.keys(unitsByVid||{});
    const ok=[];
    vids.forEach(vid=>{
      const avail=unitsByVid[vid];
      if(canFillPreset(avail, preset)) ok.push(vid);
    });
    return ok;
  }
  function canFillPreset(avail, preset){
    if(!avail||!preset) return false;
    for(const [u,need] of Object.entries(preset)){
      if((need|0)>0 && (avail[u]|0) < (need|0)) return false;
    }
    return true;
  }

  // filter rows zonder enkele optie
  list=list.filter(it=>{
    const rams = cfg.logic.addRamsOnWall && it.wall>0 && (!cfg.logic.onlyOnLoss || it.loss) ? (cfg.wallMap[it.wall]||0) : 0;
    const C = rams>0 ? withRamsAndScout(pCbase, rams) : null;

    const Aok = hasTroops(presetA) && villageCandidatesFor(presetA).length>0;
    const Bok = hasTroops(presetB) && villageCandidatesFor(presetB).length>0;
    const Cok = C && villageCandidatesFor(C).length>0;

    return (Aok || Bok || Cok);
  });

  // sortering
  list.sort((a,b)=>{
    if(cfg.filters.sort==='wall_then_dist'){ if(b.wall!==a.wall) return b.wall-a.wall; return (a.dist??999)-(b.dist??999);}
    if((a.dist??999)!==(b.dist??999)) return (a.dist??999)-(b.dist??999);
    return b.wall-a.wall;
  });

  function barbLink(it){
    if(it.id) return `game.php?screen=info_village&id=${it.id}`;
    return `game.php?screen=info_village&x=${it.x}&y=${it.y}`;
  }
  function ramsFor(it){
    const use = cfg.logic.addRamsOnWall && it.wall>0 && (!cfg.logic.onlyOnLoss || it.loss);
    return use ? (cfg.wallMap[it.wall]||0) : 0;
  }
  function recDotClass(it){
    if(it.dead) return 'red';
    if(it.loss) return 'yellow';
    return 'green';
  }
  function recommended(it){
    if(cfg.logic.useBWhenFull && it.full) return 'Preset B';
    if(it.wall>0 || it.loss) return 'Preset C';
    return 'Preset A';
  }
  function firstVillageFor(preset){
    const vids=Object.keys(unitsByVid||{});
    for(const vid of vids){
      if(canFillPreset(unitsByVid[vid], preset)) return vid;
    }
    return null;
  }
  function buildPlaceUrl(villageId,x,y,units){
    const p=new URLSearchParams(); p.set('village',villageId); p.set('screen','place'); p.set('x',x); p.set('y',y);
    const map={spear:'spear',sword:'sword',axe:'axe',archer:'archer',spy:'spy',light:'light',heavy:'heavy',marcher:'marcher',ram:'ram',catapult:'catapult',knight:'knight'};
    Object.keys(map).forEach(k=>{ const v=units[k]|0; if(v>0) p.set(map[k],String(v)); });
    return 'game.php?'+p.toString();
  }

  body.innerHTML = list.map(it=>{
    const rams=ramsFor(it);
    const C = rams>0 ? withRamsAndScout(pCbase, rams) : null;

    // kies village per preset
    const vidA = hasTroops(presetA) ? firstVillageFor(presetA) : null;
    const vidB = hasTroops(presetB) ? firstVillageFor(presetB) : null;
    const vidC = C ? firstVillageFor(C) : null;

    // duur o.b.v. A (als die bestaat), anders B, anders C
    const presetForTime = (vidA?presetA:(vidB?presetB:(vidC?C:null)));
    const dur = it.dist!=null ? formatDurationMinutes( (+it.dist) * minutesPerFieldForPreset(presetForTime||presetA) ) : '–';

    const urlA = vidA ? buildPlaceUrl(vidA, it.x, it.y, presetA) : null;
    const urlB = vidB ? buildPlaceUrl(vidB, it.x, it.y, presetB) : null;
    const urlC = (C && vidC) ? buildPlaceUrl(vidC, it.x, it.y, C) : null;

    const titleA=vidA?compTitle(presetA):'';
    const titleB=vidB?compTitle(presetB):'';
    const titleC=(C&&vidC)?compTitle(C):'';

    return `
      <div class="fm-grid">
        <div class="fm-cell"><span class="fm-dot ${recDotClass(it)}" title="${it.dead?'Volledige nederlaag':(it.loss?'Gedeeltelijke verliezen':'Geen verliezen')}"></span></div>
        <div class="fm-cell"><a class="fm-link" target="_blank" href="${barbLink(it)}">[${it.coords}]</a></div>
        <div class="fm-cell">Lv ${it.wall}${it.loss?'*':''}</div>
        <div class="fm-cell">${it.dist!=null?it.dist:'?'}</div>
        <div class="fm-cell">${dur}</div>
        <div class="fm-cell">${rams}</div>
        <div class="fm-cell">${fmtDateTime(it.lastTs)}</div>
        <div class="fm-cell">${recommended(it)}</div>
        <div class="fm-cell">
          <div class="fm-actions">
            ${urlA?`<a class="fm-btn small" title="${titleA}" target="_blank" href="${urlA}">A</a>`:''}
            ${urlB?`<a class="fm-btn small" title="${titleB}" target="_blank" href="${urlB}">B</a>`:''}
            ${urlC?`<a class="fm-btn small" title="${titleC}" target="_blank" href="${urlC}">C</a>`:''}
          </div>
        </div>
      </div>
    `;
  }).join('') || `<div class="fm-cell" style="padding:8px">Geen barbs binnen je filters of zonder beschikbare troepen.</div>`;
}

// ============================================================
// Auto-capture op individueel rapport
// ============================================================
async function autoCaptureIfSingleReport(){
  const url=new URL(location.href);
  if(!(url.searchParams.get('screen')==='report' && url.searchParams.get('view'))) return;
  try{
    const html=await (await fetch(location.href,{credentials:'same-origin'})).text();
    const got=parseReport(html);
    if(got && got.coords){
      const db=loadWalls(); const rec=db[got.coords]||{};
      if(typeof got.wall==='number') rec.wall=got.wall;
      if(typeof got.loss==='boolean') rec.loss=got.loss?1:0;
      if(typeof got.dead==='boolean') rec.dead=got.dead?1:0;
      if(typeof got.full==='boolean') rec.full=got.full?1:0;
      if(typeof got.isBarb==='number') rec.isBarb=got.isBarb;
      if(got.timeMs) rec.lastTs=got.timeMs;
      if(got.id) rec.id=got.id;
      rec.ts=now(); db[got.coords]=rec; saveWalls(db);
      const meta=loadMeta(); meta.lastScanTs=now(); saveMeta(meta); // markeer als ‘vers’
      setStatus(`Rapport opgeslagen: [${got.coords}]`); renderResults();
    }
  }catch(e){}
}

// ============================================================
// Init (inclusief redirect naar FA als je er niet bent)
// ============================================================
function redirectIfNotFA(){
  if(/[?&]screen=am_farm\b/.test(location.search)) return;
  // probeer village id te behouden; anders laat het spel het bepalen
  const vid=myVillageId();
  const target = 'game.php?screen=am_farm' + (vid?('&village='+vid):'');
  location.href = target;
}

function init(){
  // Als je niet op FA staat → stuur je daarheen.
  if(!/[?&]screen=am_farm\b/.test(location.search)){ redirectIfNotFA(); return; }

  injectStyles(); injectMainBar(); injectResultsBlock(); ensureWorldSpeeds(); autoCaptureIfSingleReport();
}

window.__FarmManager__={init};
init();

})();
