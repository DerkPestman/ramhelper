(() => {
/* ============================================================
   FarmManager v1.2  (NL) — Derk-spec
   - FA-Only balk met filters + “Scan rapporten” (auto start)
   - Instellingen overlay (donker FA beige, autosave)
   - Presets:  A/B (read-only), C (editable + rammen), D (optioneel)
   - Resultatenlijst: Coords (klikbaar), Muur, Afst., Rammen, Min-ago,
     Laatst aangevallen, Suggestie, Actie (A/B/C knoppen in één regel)
   - C = A/B + rammen + 1 scout (rammen = wallMap[level])
   - Scan: 3 workers, 300–500 ms pacing, max 50 links per run
   - Auto-capture bij open individueel rapport
   - Legaal: opent alleen formulieren; geen auto-submit
   ============================================================ */

const APP = {
  VER: '1.2',
  KEYS: {
    cfg:     'FM_cfg',
    walls:   'FM_walls',    // { "489|480": { wall, loss, full, lastTs, id?, ts } }
    presets: 'FM_presets'   // { A:{..}, B:{..}, C:{..}, D?{..} }
  },
  SCAN: { CONCURRENCY: 3, DELAY_MIN: 300, DELAY_MAX: 500, MAX_LINKS: 50 },
  qs: (s,r=document)=>r.querySelector(s),
  qsa:(s,r=document)=>Array.from(r.querySelectorAll(s)),
};

// ---------- defaults ----------
function defaultCfg(){
  const wallMap={1:8,2:12,3:16,4:20,5:24,6:28,7:32,8:36,9:40,10:44,11:48,12:52,13:56,14:60,15:64,16:68,17:72,18:76,19:80,20:84};
  return {
    bannerShown:true, // toon FA-only tekst
    filters:{ maxDist:25, minMinutesBetween:5, sort:'dist_then_wall' },
    logic:{
      addNewBarbs:true,
      addRamsOnWall:true,     // C gebruikt rammen bij muur>0
      onlyOnLoss:true,        // C alleen bij verlies
      useBWhenFull:true       // Suggestie B bij volle buit
    },
    wallMap
  };
}
function defaultPresets(){
  // Volgorde: spear,sword,axe,archer,spy,light,heavy,marcher,ram,catapult,knight
  return {
    A:{spear:0,sword:0,axe:0,archer:0,spy:1,light:5,heavy:0,marcher:0,ram:0,catapult:0,knight:0},
    B:{spear:0,sword:0,axe:0,archer:0,spy:1,light:10,heavy:0,marcher:0,ram:0,catapult:0,knight:0},
    C:{spear:0,sword:0,axe:0,archer:0,spy:0,light:0,heavy:0,marcher:0,ram:0,catapult:0,knight:0}
  };
}
// ---------- storage ----------
const loadCfg=()=>{try{return Object.assign(defaultCfg(),JSON.parse(localStorage.getItem(APP.KEYS.cfg)||'{}'));}catch{return defaultCfg();}};
const saveCfg=(c)=>localStorage.setItem(APP.KEYS.cfg,JSON.stringify(c));
const loadWalls=()=>{try{return JSON.parse(localStorage.getItem(APP.KEYS.walls)||'{}');}catch{return{};}};
const saveWalls=(m)=>localStorage.setItem(APP.KEYS.walls,JSON.stringify(m));
const loadPresets=()=>{try{return Object.assign(defaultPresets(),JSON.parse(localStorage.getItem(APP.KEYS.presets)||'{}'));}catch{return defaultPresets();}};
const savePresets=(p)=>localStorage.setItem(APP.KEYS.presets,JSON.stringify(p));

// ---------- utils ----------
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const rint=(a,b)=>Math.floor(a+Math.random()*(b-a+1));
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const toInt=(v)=>Math.max(0,(v|0));
const now=()=>Date.now();
const fmtAgo=(ts)=>ts?Math.round((now()-ts)/60000):null;
const dist=(a,b)=>Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2);
function myCoords(){
  const t=document.body.innerText||''; const m=t.match(/\b(\d{3})\|(\d{3})\b/);
  return m?{x:+m[1],y:+m[2]}:null;
}
function faColors(){
  // donker FA beige
  return { bg:'#e9d4b4', head:'#e2cba3', border:'#c7a76a', btn:'#b2773a' };
}

// ============================================================
//  UI injecties
// ============================================================
function injectStyles(){
  if(APP.qs('#fm-styles'))return;
  const st=document.createElement('style'); st.id='fm-styles';
  st.textContent=`
  .fm-btn{background:#b2773a;border:none;color:#fff;padding:4px 8px;border-radius:6px;cursor:pointer;font:12px Verdana;}
  .fm-btn.small{padding:3px 6px;min-width:28px;text-align:center}
  .fm-btn:disabled{opacity:.6;cursor:default}
  .fm-input{padding:3px 6px;border:1px solid #c7a76a;border-radius:6px;background:#fff}
  .fm-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .fm-pill{display:inline-block;padding:2px 6px;border:1px solid #c7a76a;background:#ecd6ad;border-radius:10px}
  .fm-table-head{background:#e2cba3;border-bottom:1px solid #c7a76a;font-weight:bold}
  .fm-cell{padding:6px 8px;border-bottom:1px dashed #c7a76a}
  .fm-grid{display:grid;grid-template-columns:110px 60px 64px 72px 70px 140px 1fr 110px}
  .fm-grid-head{display:grid;grid-template-columns:110px 60px 64px 72px 70px 140px 1fr 110px}
  .fm-link{color:#532; text-decoration:underline; cursor:pointer}
  /* overlay */
  .fm-ov{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
  .fm-card{width:980px;max-height:86vh;overflow:auto;border-radius:12px;background:#e9d4b4;border:1px solid #c7a76a;box-shadow:0 10px 30px rgba(0,0,0,.45)}
  .fm-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #c7a76a;background:#e2cba3;border-top-left-radius:12px;border-top-right-radius:12px}
  .fm-body{padding:12px 14px}
  .fm-grid10{display:grid;grid-template-columns:repeat(10,1fr);gap:8px}
  .fm-urow{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}
  .fm-unit{display:flex;align-items:center;gap:6px}
  .fm-unit img{width:16px;height:16px;image-rendering:pixelated}
  `;
  document.head.appendChild(st);
}

function injectMainBar(){
  if(APP.qs('#fm-mainbar')) return;
  if(!/[?&]screen=am_farm\b/.test(location.search)) return; // FA-only

  const C=faColors(); const host=APP.qs('#content_value')||document.body;
  const wrapper=document.createElement('div');
  Object.assign(wrapper.style,{margin:'8px 0',padding:'10px',border:`1px solid ${C.border}`,borderRadius:'8px',background:C.bg});
  wrapper.id='fm-mainbar';
  host.insertBefore(wrapper, host.firstChild);

  const cfg=loadCfg();
  wrapper.innerHTML=`
    <div style="margin-bottom:6px;opacity:.85"><span class="fm-pill">FarmManager werkt alleen in het Farm Assistent-scherm.</span></div>
    <div class="fm-row">
      <label>Max velden <input id="fm-maxdist" class="fm-input" type="number" min="1" max="200" value="${cfg.filters.maxDist}" style="width:70px"></label>
      <label>Min. minuten tussen farms <input id="fm-minmin" class="fm-input" type="number" min="0" max="1440" value="${cfg.filters.minMinutesBetween}" style="width:90px"></label>
      <label><input id="fm-onlyloss" type="checkbox" ${cfg.logic.onlyOnLoss?'checked':''}> Rammen bij gedeeltelijke verliezen</label>
      <label><input id="fm-useB" type="checkbox" ${cfg.logic.useBWhenFull?'checked':''}> B-farm bij volle buit</label>
      <label><input id="fm-addbarbs" type="checkbox" ${cfg.logic.addNewBarbs?'checked':''}> Nieuwe barbs toevoegen</label>
      <div style="flex:1"></div>
      <button id="fm-scan" class="fm-btn">Scan rapporten</button>
      <button id="fm-settings" class="fm-btn">Instellingen</button>
      <button id="fm-save" class="fm-btn">Opslaan</button>
    </div>
    <div id="fm-status" style="margin-top:6px;opacity:.9"></div>
  `;
  APP.qs('#fm-save').onclick=()=>{
    const c=loadCfg();
    c.filters.maxDist=clamp(+APP.qs('#fm-maxdist').value||c.filters.maxDist,1,200);
    c.filters.minMinutesBetween=clamp(+APP.qs('#fm-minmin').value||0,0,1440);
    c.logic.onlyOnLoss=APP.qs('#fm-onlyloss').checked;
    c.logic.useBWhenFull=APP.qs('#fm-useB').checked;
    c.logic.addNewBarbs=APP.qs('#fm-addbarbs').checked;
    saveCfg(c); setStatus('Instellingen opgeslagen ✔️'); renderResults(); setTimeout(()=>setStatus(''),1200);
  };
  APP.qs('#fm-settings').onclick=()=>openSettingsOverlay();
  APP.qs('#fm-scan').onclick=()=>openScanOverlay(true); // auto start
}

function injectResultsBlock(){
  if(APP.qs('#fm-results')) return;
  if(!/[?&]screen=am_farm\b/.test(location.search)) return;

  const C=faColors(); const host=APP.qs('#content_value')||document.body;
  const box=document.createElement('div'); box.id='fm-results';
  Object.assign(box.style,{margin:'10px 0 12px',padding:'0',border:`1px solid ${C.border}`,borderRadius:'8px',background:faColors().bg});
  box.innerHTML=`
    <div class="fm-table-head fm-grid-head" style="padding:6px 8px;border-top-left-radius:8px;border-top-right-radius:8px">
      <div>Coords</div><div>Muur</div><div>Afst.</div><div>Rammen</div><div>Min-ago</div><div>Laatst aangevallen</div><div>Suggestie</div><div style="text-align:right;padding-right:12px">Actie</div>
    </div>
    <div id="fm-res-body"></div>
  `;
  host.insertBefore(box, APP.qs('#fm-mainbar')?.nextSibling || host.firstChild);
  renderResults();
}

function setStatus(t){ const el=APP.qs('#fm-status'); if(el) el.textContent=t||''; }

// ============================================================
// Scan overlay (auto start)
// ============================================================
function openScanOverlay(autoStart){
  if(APP.qs('#fm-ov-scan')) return;
  const C=faColors(); const ov=document.createElement('div'); ov.className='fm-ov'; ov.id='fm-ov-scan';
  ov.innerHTML=`
  <div class="fm-card">
    <div class="fm-head"><div><b>Scan rapporten</b></div><button id="fm-close-scan" class="fm-btn" style="background:#a55">Sluiten</button></div>
    <div class="fm-body">
      <div id="fm-prog" style="height:12px;background:#f0e6d2;border-radius:6px;overflow:hidden;margin-bottom:8px"><div id="fm-bar" style="height:100%;width:0;background:#6a8e3a"></div></div>
      <div id="fm-stat" style="margin-bottom:8px;opacity:.9">Zoek rapportlinks…</div>
      <div class="fm-row">
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
    const max=Math.min(links.length, APP.SCAN.MAX_LINKS);
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
            if(typeof got.full==='boolean') rec.full=got.full?1:0;
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
    saveWalls(db); btnStart.disabled=false; btnCancel.disabled=true;
    st.textContent = cancel?`Geannuleerd. Verwerkt: ${done}/${max}, bijgewerkt: ${updated}`:`Klaar. Verwerkt: ${done}/${max}, bijgewerkt: ${updated}`;
    setStatus('Scan voltooid'); renderResults();
  }

  btnStart.onclick=run;
  if(autoStart) run(); // direct starten
}

// ============================================================
// Instellingen Overlay (autosave, C editable, D optioneel)
// ============================================================
function openSettingsOverlay(){
  if(APP.qs('#fm-ov-set')) return;
  const C=faColors(); const ov=document.createElement('div'); ov.className='fm-ov'; ov.id='fm-ov-set';
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

  function unitRow(name, p, editable){
    return `
    <fieldset style="border:1px solid #c7a76a;border-radius:8px;padding:8px 10px">
      <legend style="padding:0 6px">Preset ${name}${editable?'':' (FA – alleen lezen)'}</legend>
      <div class="fm-urow">
        ${unitOrder.map(u => `
          <label class="fm-unit" title="${labels[u]}">
            <img src="${icon(u)}" alt="">
            <input data-fm-pre="${name}:${u}" class="fm-input" type="number" min="0" value="${toInt(p[u]||0)}" style="width:70px"${editable?'':' disabled'}>
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
    ${unitRow('A', presets.A, false)}
    ${unitRow('B', presets.B, false)}
    ${unitRow('C', presets.C, true)}

    <div style="display:flex;align-items:center;gap:8px;margin:8px 0">
      <span style="font-weight:bold">Extra preset</span>
      ${!hasD ? `<button id="fm-add-d" class="fm-btn">＋ Voeg preset D toe</button>` :
        `<span class="fm-pill">Preset D actief</span> <button id="fm-del-d" class="fm-btn" style="background:#a55">Verwijderen</button>`}
    </div>
    ${hasD ? unitRow('D', presets.D, true) : ''}

    <fieldset style="border:1px solid #c7a76a;border-radius:8px;padding:8px 10px">
      <legend style="padding:0 6px">Rammen per muurlevel</legend>
      <div class="fm-grid10">${wallGrid1}</div>
      <details style="margin-top:8px">
        <summary style="cursor:pointer">Meer niveaus (11–20)</summary>
        <div class="fm-grid10" style="margin-top:8px">${wallGrid2}</div>
      </details>
    </fieldset>

    <details style="margin-top:6px">
      <summary style="cursor:pointer">📘 Uitleg FarmManager</summary>
      <div style="margin-top:6px;opacity:.9">
        <p>Preset <b>A</b> en <b>B</b> zijn de FA-sjablonen (alleen lezen). Preset <b>C</b> is je bewerkbare set en wordt bij actie “C” gecombineerd met rammen volgens het muurlevel en met 1 verkenner.</p>
        <p>Rammen per muurlevel bepalen het aantal rammen bij een bekend muurniveau &gt; 0. Met de optie “Rammen bij gedeeltelijke verliezen” worden rammen alleen gebruikt als het laatste rapport verliezen toonde.</p>
        <p>“B bij volle buit” gebruikt preset B wanneer het laatste rapport volledige buit aangaf.</p>
      </div>
    </details>
  `;

  // autosave bindings
  root.addEventListener('input', (e)=>{
    const t=e.target;
    // presets
    if(t.matches('[data-fm-pre]')){
      const [name,u]=t.getAttribute('data-fm-pre').split(':');
      const p=loadPresets();
      if(!p[name]) p[name]={};
      p[name][u]=toInt(t.value);
      savePresets(p);
      return;
    }
    // rammen per level
    if(t.matches('[data-fm-w]')){
      const lv=+t.getAttribute('data-fm-w'); const c=loadCfg(); c.wallMap[lv]=toInt(t.value); saveCfg(c); return;
    }
  });

  const addD=APP.qs('#fm-add-d',root), delD=APP.qs('#fm-del-d',root);
  if(addD) addD.onclick=()=>{ const p=loadPresets(); if(!p.D) p.D=JSON.parse(JSON.stringify(p.C)); savePresets(p); renderSettings(root); };
  if(delD) delD.onclick=()=>{ const p=loadPresets(); delete p.D; savePresets(p); renderSettings(root); };
}

// ============================================================
// Resultatenlijst rendering
// ============================================================
function renderResults(){
  const body=APP.qs('#fm-res-body'); if(!body) return;
  const cfg=loadCfg(); const walls=loadWalls(); const presets=loadPresets(); const me=myCoords();

  const items=[];
  Object.keys(walls).forEach(k=>{
    const rec=walls[k]; if(typeof rec.wall!=='number' && !rec.lastTs) return; // alleen met data
    const [x,y]=k.split('|').map(Number);
    const it={coords:k,x,y,id:rec.id||null,wall:rec.wall|0,loss:!!rec.loss,full:!!rec.full,lastTs:rec.lastTs||0};
    it.dist=me? +dist(me,it).toFixed(2) : null;
    it.ago=fmtAgo(it.lastTs);
    items.push(it);
  });

  const maxD=cfg.filters.maxDist|0, minGap=cfg.filters.minMinutesBetween|0;
  const list=items.filter(it=>{
    if(me && maxD && it.dist!=null && it.dist>maxD) return false;
    if(minGap>0 && typeof it.ago==='number' && it.ago<minGap) return false;
    return true;
  });

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
  function actionBtns(it){
    const sugB = cfg.logic.useBWhenFull && it.full;
    const vid = new URL(location.href).searchParams.get('village')||'';
    const A = presets.A, B = presets.B, C = presets.C, D = presets.D;

    const rams = ramsFor(it);
    const addScout = 1; // C always 1 scout
    function withRams(base){ const u=JSON.parse(JSON.stringify(base||{})); u.ram=(u.ram|0)+rams; u.spy=(u.spy|0)+addScout; return u; }

    const urlA = buildPlaceUrl(vid, it.x, it.y, A);
    const urlB = buildPlaceUrl(vid, it.x, it.y, B);
    const urlC = buildPlaceUrl(vid, it.x, it.y, withRams(C));
    const titleA=compTitle(A), titleB=compTitle(B), titleC=compTitle(withRams(C));

    return `
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <a class="fm-btn small" title="${titleA}" target="_blank" href="${urlA}">A</a>
        <a class="fm-btn small" title="${titleB}" target="_blank" href="${urlB}">B</a>
        <a class="fm-btn small" title="${titleC}" target="_blank" href="${urlC}">C</a>
      </div>
    `;
  }

  body.innerHTML = list.map(it=>{
    const rams=ramsFor(it);
    const last = it.lastTs ? new Date(it.lastTs).toLocaleString() : '–';
    const sugg = (cfg.logic.useBWhenFull && it.full) ? 'Preset B (volle buit)' : 'Preset A';
    return `
      <div class="fm-grid">
        <div class="fm-cell"><a class="fm-link" target="_blank" href="${barbLink(it)}">[${it.coords}]</a></div>
        <div class="fm-cell">Lv ${it.wall}${it.loss?'*':''}</div>
        <div class="fm-cell">${it.dist!=null?it.dist:'?'}</div>
        <div class="fm-cell">${rams}</div>
        <div class="fm-cell">${it.ago!=null?it.ago:'–'}</div>
        <div class="fm-cell">${last}</div>
        <div class="fm-cell">${sugg}</div>
        <div class="fm-cell">${actionBtns(it)}</div>
      </div>
    `;
  }).join('') || `<div class="fm-cell" style="padding:8px">Geen resultaten. Scan rapporten of pas filters aan.</div>`;
}

// ============================================================
// Report parsing
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
  // verlies (indicatie)
  let loss=false; if(/Verliezen|Losses/i.test(txt)){ const m=txt.match(/Verliezen[^0-9]*(\d+)/i); loss = m? (parseInt(m[1],10)>0) : /verlies|verloren/i.test(txt); }
  // full haul
  const full=/Volledige buit|Full haul|Volle buit/i.test(txt);
  // tijd
  let timeMs=null; const mdt=txt.match(/(\d{2}[.\-\/]\d{2}[.\-\/]\d{2,4})\s+(\d{2}:\d{2}(?::\d{2})?)/);
  if(mdt){ const d=mdt[1].replace(/\./g,'-').replace(/\//g,'-'); const iso=(/\d{4}-/.test(d)?d:d.split('-').reverse().join('-'))+'T'+mdt[2]; const t=Date.parse(iso); if(!isNaN(t)) timeMs=t; }
  return {coords,wall,loss,full,timeMs,id};
}

// ============================================================
// Build place URL + titles
// ============================================================
function compTitle(units){
  const order=['spy','light','axe','spear','sword','heavy','archer','marcher','ram','catapult','knight'];
  const names={spy:'Verkenner',light:'LC',axe:'Bijl',spear:'Speer',sword:'Zwaard',heavy:'ZC',archer:'Boog',marcher:'Ruiterboog',ram:'Ram',catapult:'Kata',knight:'Ridder'};
  const parts=[]; order.forEach(k=>{const v=units[k]|0; if(v>0) parts.push(`${names[k]}: ${v}`);}); return parts.length?`Stuurt: ${parts.join(', ')}`:'Stuurt: (geen)';
}
function buildPlaceUrl(villageId,x,y,units){
  const p=new URLSearchParams(); p.set('village',villageId); p.set('screen','place'); p.set('x',x); p.set('y',y);
  const map={spear:'spear',sword:'sword',axe:'axe',archer:'archer',spy:'spy',light:'light',heavy:'heavy',marcher:'marcher',ram:'ram',catapult:'catapult',knight:'knight'};
  Object.keys(map).forEach(k=>{ const v=units[k]|0; if(v>0) p.set(map[k],String(v)); });
  return 'game.php?'+p.toString();
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
      if(typeof got.full==='boolean') rec.full=got.full?1:0;
      if(got.timeMs) rec.lastTs=got.timeMs;
      if(got.id) rec.id=got.id;
      rec.ts=now(); db[got.coords]=rec; saveWalls(db); setStatus(`Rapport opgeslagen: [${got.coords}]`); renderResults();
    }
  }catch(e){}
}

// ============================================================
// Init
// ============================================================
function init(){
  injectStyles(); injectMainBar(); injectResultsBlock(); autoCaptureIfSingleReport();
}
window.__FarmManager__={init};
init();

})();
