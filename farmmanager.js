(() => {
  // ==========================================================
  // FarmManager v1.1 — Standalone (NL)
  // - Hoofdbalk boven FA (zonder FA te wijzigen)
  // - Overlay (Instellingen) gecentreerd
  // - Scan rapporten: voortgangsbalk + status + annuleren
  // - 3x parallel, 300–500ms pacing, max 50 per run (veilig)
  // - Auto-capture op enkel rapport
  // - Presets A/B (geen edelman) + Rammen per muurlevel (Lv1–20)
  // - Filters: Max velden, Min. minuten tussen farms (verberg te verse targets)
  // - Rammen alleen bij muur>0; optie: alleen bij verliezen
  // - Default A; auto B bij “volle buit”
  // - FA-stijl kleuren; geen auto-send; alles client-side
  // ==========================================================

  const APP = {
    VER: '1.1',
    KEYS: {
      cfg:     'FM_cfg',
      walls:   'FM_walls',    // { "489|480": { wall:3, loss:1, full:1, lastTs: 1699999999999, ts: 169... } }
      presets: 'FM_presets',  // { A:{...}, B:{...} }
    },
    SCAN: {
      CONCURRENCY: 3,
      DELAY_MIN: 300,
      DELAY_MAX: 500,
      MAX_LINKS: 50,
      MAX_PAGES: 20,
    },
    qs:  (sel,root=document)=>root.querySelector(sel),
    qsa: (sel,root=document)=>Array.from(root.querySelectorAll(sel)),
  };

  // ---------------- Defaults ----------------
  function defaultCfg() {
    const wallMap = {1:8,2:12,3:16,4:20,5:24,6:28,7:32,8:36,9:40,10:44,11:48,12:52,13:56,14:60,15:64,16:68,17:72,18:76,19:80,20:84};
    return {
      ui: { showStartup:false },
      filters: {
        maxDist: 25,          // Max velden
        minMinutesBetween: 0, // Min. minuten tussen farms (verberg “te recent”)
        sort: 'dist_then_wall', // 'dist_then_wall' | 'wall_then_dist'
      },
      logic: {
        addNewBarbs: true,      // “Voeg nieuwe barbarendorpen toe”
        addRamsOnWall: true,    // Rammen alleen als muur>0
        onlyOnLoss: true,       // “Verstuur rammen naar dorpen met gedeeltelijke verliezen”
        useBWhenFull: true,     // “Verstuur B bij volle buit”
      },
      wallMap,                 // Lv -> rammen
    };
  }
  function defaultPresets() {
    // Units: spear,sword,axe,archer,spy,light,heavy,marcher,ram,catapult,knight  (geen snob)
    return {
      A: { spear:0,sword:0,axe:0,archer:0,spy:1,light:5,heavy:0,marcher:0,ram:0,catapult:0,knight:0 },
      B: { spear:0,sword:0,axe:0,archer:0,spy:1,light:10,heavy:0,marcher:0,ram:0,catapult:0,knight:0 },
    };
  }

  // ---------------- Storage helpers ----------------
  const loadCfg     = () => { try { return Object.assign(defaultCfg(), JSON.parse(localStorage.getItem(APP.KEYS.cfg)||'{}')); } catch { return defaultCfg(); } };
  const saveCfg     = (cfg)=> localStorage.setItem(APP.KEYS.cfg, JSON.stringify(cfg));
  const loadWalls   = () => { try { return JSON.parse(localStorage.getItem(APP.KEYS.walls)||'{}'); } catch { return {}; } };
  const saveWalls   = (m)  => localStorage.setItem(APP.KEYS.walls, JSON.stringify(m));
  const loadPresets = () => { try { return Object.assign(defaultPresets(), JSON.parse(localStorage.getItem(APP.KEYS.presets)||'{}')); } catch { return defaultPresets(); } };
  const savePresets = (p)=> localStorage.setItem(APP.KEYS.presets, JSON.stringify(p));

  // ---------------- Utilities ----------------
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const randInt = (a,b)=> Math.floor(a + Math.random()*(b-a+1));
  const clamp = (v,min,max)=> Math.max(min, Math.min(max, v));
  const toInt = (v)=> Math.max(0, (v|0));
  const nowMs = ()=> Date.now();
  const fmtAgoMin = (ts)=> ts? Math.round((nowMs()-ts)/60000) : null;
  const dist = (a,b)=> Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2);

  function myCoordsFromDOM(){
    // simpele heuristiek: eerste xxx|yyy in body
    const txt = document.body.innerText || '';
    const m = txt.match(/\b(\d{3})\|(\d{3})\b/);
    return m ? {x:+m[1], y:+m[2]} : null;
  }

  function getFAColors(){
    // probeer FA container kleur
    const cv = APP.qs('#content_value') || document.body;
    const bg = getComputedStyle(cv).backgroundColor;
    return {
      bg: bg && bg!=='rgba(0, 0, 0, 0)' ? bg : '#f1e0c6',
      head: '#ecd6ad',
      border: '#c7a76a',
      btn: '#b2773a'
    };
  }

  // ==========================================================
  // HOOGNIVEAU: Inject hoofdbar + resultatenblok + overlay
  // ==========================================================
  function injectStyles(){
    if (APP.qs('#fm-styles')) return;
    const st = document.createElement('style');
    st.id = 'fm-styles';
    st.textContent = `
      .fm-btn { background:#b2773a; border:none; color:#fff; padding:6px 10px; border-radius:6px; cursor:pointer; }
      .fm-btn:hover { filter:brightness(1.06); }
      .fm-btn:disabled { opacity:.6; cursor:default; }
      .fm-input { padding:4px 6px; border:1px solid #c7a76a; border-radius:6px; background:#fff; }
      .fm-switch { display:flex; align-items:center; gap:6px; }
      .fm-pill { display:inline-block; padding:2px 6px; background:#ecd6ad; border:1px solid #c7a76a; border-radius:10px; }
    `;
    document.head.appendChild(st);
  }

  function injectMainBar(){
    // Inject boven FA, FA blijft onaangetast
    if (APP.qs('#fm-mainbar')) return;
    const host = APP.qs('#content_value') || document.body;
    const box = document.createElement('div');
    box.id = 'fm-mainbar';
    const C = getFAColors();
    Object.assign(box.style, {
      margin:'8px 0', padding:'10px', border:`1px solid ${C.border}`,
      borderRadius:'8px', background:C.bg
    });
    host.insertBefore(box, host.firstChild);

    const cfg = loadCfg();
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <label>Max velden
          <input id="fm-maxdist" class="fm-input" type="number" min="1" max="200" value="${cfg.filters.maxDist}" style="width:72px">
        </label>
        <label>Min. minuten tussen farms
          <input id="fm-minmin" class="fm-input" type="number" min="0" max="1440" value="${cfg.filters.minMinutesBetween}" style="width:92px">
        </label>

        <label class="fm-switch"><input id="fm-onlyloss" type="checkbox" ${cfg.logic.onlyOnLoss?'checked':''}> Rammen bij gedeeltelijke verliezen</label>
        <label class="fm-switch"><input id="fm-useB" type="checkbox" ${cfg.logic.useBWhenFull?'checked':''}> B-farm bij volle buit</label>
        <label class="fm-switch"><input id="fm-addbarbs" type="checkbox" ${cfg.logic.addNewBarbs?'checked':''}> Nieuwe barbs toevoegen</label>

        <div style="flex:1"></div>
        <button id="fm-scan" class="fm-btn">Scan rapporten</button>
        <button id="fm-settings" class="fm-btn">Instellingen</button>
        <button id="fm-save" class="fm-btn">Opslaan</button>
      </div>
      <div id="fm-statusline" style="margin-top:6px; opacity:.85"></div>
    `;

    APP.qs('#fm-scan').onclick = ()=> openScanOverlay();
    APP.qs('#fm-settings').onclick = ()=> openSettingsOverlay();
    APP.qs('#fm-save').onclick = ()=>{
      const c = loadCfg();
      c.filters.maxDist          = clamp(+APP.qs('#fm-maxdist').value || c.filters.maxDist, 1, 200);
      c.filters.minMinutesBetween= clamp(+APP.qs('#fm-minmin').value || 0, 0, 1440);
      c.logic.onlyOnLoss         = APP.qs('#fm-onlyloss').checked;
      c.logic.useBWhenFull       = APP.qs('#fm-useB').checked;
      c.logic.addNewBarbs        = APP.qs('#fm-addbarbs').checked;
      saveCfg(c);
      setStatus('Instellingen opgeslagen ✔️');
      renderResults(); // herteken
      setTimeout(()=> setStatus(''), 1200);
    };
  }

  function injectResultsBlock(){
    if (APP.qs('#fm-results')) return;
    if (!/[?&]screen=am_farm\b/.test(location.search)) return; // alleen op FA-pagina tonen
    const host = APP.qs('#content_value') || document.body;
    const C = getFAColors();
    const box = document.createElement('div');
    box.id = 'fm-results';
    Object.assign(box.style, {
      margin:'10px 0 12px',
      padding:'10px',
      border:`1px solid ${C.border}`,
      borderRadius:'8px',
      background:'#fff'
    });
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div><b>FarmManager – resultaten</b></div>
        <button id="fm-open-planner" class="fm-btn">Open planner</button>
      </div>
      <div id="fm-res-body" style="border:1px solid ${C.border};border-radius:8px;overflow:hidden"></div>
    `;
    host.insertBefore(box, (APP.qs('#fm-mainbar')?.nextSibling)||host.firstChild);
    APP.qs('#fm-open-planner').onclick = ()=> openPlannerOverlay();
    renderResults();
  }

  function setStatus(txt){
    const el = APP.qs('#fm-statusline'); if (el) el.textContent = txt||'';
  }

  // ==========================================================
  // OVERLAYS
  // ==========================================================
  function makeOverlay(){
    const ov = document.createElement('div');
    Object.assign(ov.style, {
      position:'fixed', inset:'0', background:'rgba(0,0,0,.45)', zIndex:2147483647,
      display:'flex', alignItems:'center', justifyContent:'center'
    });
    const wrap = document.createElement('div');
    const C = getFAColors();
    Object.assign(wrap.style, {
      width:'980px', maxHeight:'86vh', overflow:'auto', borderRadius:'12px',
      background:'#fffaf0', color:'#2b2416', border:`1px solid ${C.border}`,
      boxShadow:'0 10px 30px rgba(0,0,0,.45)', font:'14px/1.5 Verdana, Arial, sans-serif'
    });
    ov.appendChild(wrap);
    return {ov,wrap,C};
  }

  function openPlannerOverlay(){
    if (APP.qs('#fm-overlay-planner')) return;
    const {ov,wrap,C} = makeOverlay();
    ov.id='fm-overlay-planner';
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid ${C.border};background:${C.head};
                  border-top-left-radius:12px;border-top-right-radius:12px;">
        <div><b>FarmManager – Planner</b> <span style="opacity:.7">v${APP.VER}</span></div>
        <button id="fm-close-planner" class="fm-btn" style="background:#a55;color:#fff">Sluiten</button>
      </div>
      <div id="fm-pl-body" style="padding:12px 14px"></div>
    `;
    document.body.appendChild(ov);
    APP.qs('#fm-close-planner').onclick = ()=> ov.remove();
    renderPlanner(APP.qs('#fm-pl-body'));
  }

  function openSettingsOverlay(){
    if (APP.qs('#fm-overlay-settings')) return;
    const {ov,wrap,C} = makeOverlay();
    ov.id='fm-overlay-settings';
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid ${C.border};background:${C.head};
                  border-top-left-radius:12px;border-top-right-radius:12px;">
        <div><b>Instellingen – FarmManager</b></div>
        <button id="fm-close-settings" class="fm-btn" style="background:#a55;color:#fff">Sluiten</button>
      </div>
      <div id="fm-set-body" style="padding:12px 14px"></div>
    `;
    document.body.appendChild(ov);
    APP.qs('#fm-close-settings').onclick = ()=> ov.remove();
    renderSettings(APP.qs('#fm-set-body'));
  }

  function openScanOverlay(){
    if (APP.qs('#fm-overlay-scan')) return;
    const {ov,wrap,C} = makeOverlay();
    ov.id='fm-overlay-scan';
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid ${C.border};background:${C.head};
                  border-top-left-radius:12px;border-top-right-radius:12px;">
        <div><b>Scan rapporten</b></div>
        <button id="fm-close-scan" class="fm-btn" style="background:#a55;color:#fff">Sluiten</button>
      </div>
      <div id="fm-scan-body" style="padding:12px 14px">
        <div id="fm-progress" style="height:12px;background:#f0e6d2;border-radius:6px;overflow:hidden;margin-bottom:8px">
          <div id="fm-bar" style="height:100%;width:0;background:#6a8e3a"></div>
        </div>
        <div id="fm-stat" style="margin-bottom:8px;opacity:.9">Zoek rapportlinks…</div>
        <div style="display:flex;gap:8px">
          <button id="fm-start" class="fm-btn">Start scan</button>
          <button id="fm-cancel" class="fm-btn" disabled>Annuleren</button>
        </div>
      </div>
    `;
    document.body.appendChild(ov);
    APP.qs('#fm-close-scan').onclick = ()=> ov.remove();
    bindScanOverlay(ov);
  }

  // ==========================================================
  // R E N D E R S
  // ==========================================================
  function renderPlanner(body){
    const cfg = loadCfg();
    const walls = loadWalls();
    const presets = loadPresets();
    const me = myCoordsFromDOM();

    const list = [];
    Object.keys(walls).forEach(k=>{
      const [x,y] = k.split('|').map(Number);
      const it = {coords:k, x,y, wall:walls[k].wall|0, loss:!!walls[k].loss, full:!!walls[k].full, lastTs:walls[k].lastTs||0};
      it.dist = me ? +dist(me,it).toFixed(2) : null;
      it.agoMin = fmtAgoMin(it.lastTs);
      list.push(it);
    });

    // filters
    const maxD = cfg.filters.maxDist|0;
    const minGap = cfg.filters.minMinutesBetween|0;
    const filtered = list.filter(it=>{
      if (me && maxD && it.dist!=null && it.dist>maxD) return false;
      if (minGap>0 && typeof it.agoMin==='number' && it.agoMin < minGap) return false;
      return it.wall>0; // planner focust op rammen targets
    });

    filtered.sort((a,b)=>{
      if (cfg.filters.sort==='wall_then_dist'){
        if (b.wall!==a.wall) return b.wall-a.wall;
        return (a.dist??999)-(b.dist??999);
      } else {
        if ((a.dist??999)!==(b.dist??999)) return (a.dist??999)-(b.dist??999);
        return b.wall-a.wall;
      }
    });

    const head = `
      <div style="display:grid;grid-template-columns:110px 64px 74px 90px 70px 1fr 140px;gap:8px;
                  padding:6px 8px;border-bottom:1px solid #c7a76a;background:#ecd6ad;font-weight:bold;">
        <div>Coords</div><div>Muur</div><div>Afst.</div><div>Rammen</div><div>Min-ago</div><div>Suggestie</div><div>Actie</div>
      </div>`;
    const rows = filtered.map(it=>{
      const shouldAddRams = cfg.logic.addRamsOnWall && it.wall>0 && (!cfg.logic.onlyOnLoss || it.loss);
      const rams = shouldAddRams ? (cfg.wallMap[it.wall]||0) : 0;

      // suggestie preset: A default; B bij volle buit
      const suggestB = (cfg.logic.useBWhenFull && it.full);
      const vid  = new URL(location.href).searchParams.get('village')||'';

      const urlA = buildPlaceUrl(vid, it.x, it.y, injectRams(loadPresets().A, rams));
      const urlB = buildPlaceUrl(vid, it.x, it.y, injectRams(loadPresets().B, rams));

      const titleA = compTitle(injectRams(loadPresets().A, rams));
      const titleB = compTitle(injectRams(loadPresets().B, rams));
      const sugg = suggestB ? 'Preset B (volle buit)' : 'Preset A';

      return `
        <div style="display:grid;grid-template-columns:110px 64px 74px 90px 70px 1fr 140px;gap:8px;align-items:center;
                    padding:6px 8px;border-bottom:1px dashed #c7a76a;">
          <div>[${it.coords}]</div>
          <div>Lv ${it.wall}${it.loss?'*':''}</div>
          <div>${it.dist!=null?it.dist:'?'}</div>
          <div>${rams}</div>
          <div>${it.agoMin!=null?it.agoMin:'–'}</div>
          <div>${sugg}</div>
          <div style="display:flex;gap:6px">
            <a href="${suggestB?urlB:urlA}" target="_blank" class="fm-btn">${suggestB?'Open B':'Open A'}</a>
            <a href="${suggestB?urlA:urlB}" target="_blank" class="fm-btn">Open ${suggestB?'A':'B'}</a>
          </div>
        </div>
      `;
    });

    body.innerHTML = `
      <div style="margin-bottom:8px;opacity:.85">* sterretje na muurlevel = laatste aanval had verliezen.</div>
      <div style="border:1px solid #c7a76a;border-radius:8px;overflow:hidden;background:#fff">
        ${head}${rows.join('') || `<div style="padding:8px;color:#7a4b00">Geen doelen binnen filters. Scan rapporten of pas instellingen aan.</div>`}
      </div>
    `;
  }

  function renderSettings(body){
    const cfg = loadCfg();
    const presets = loadPresets();

    const unitOrder = ['spear','sword','axe','archer','spy','light','heavy','marcher','ram','catapult','knight'];
    const unitLabel = {
      spear:'Speer', sword:'Zwaard', axe:'Bijl', archer:'Boog', spy:'Verkenner',
      light:'LC', heavy:'ZC', marcher:'Ruiterboog', ram:'Ram', catapult:'Kata', knight:'Ridder'
    };
    function presetForm(name, p){
      return `
      <fieldset style="border:1px solid #c7a76a;border-radius:8px;padding:8px 10px">
        <legend style="padding:0 6px">Preset ${name}</legend>
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px">
          ${unitOrder.map(u => `
            <label>${unitLabel[u]}<br>
              <input data-fm-preset="${name}:${u}" class="fm-input" type="number" min="0" value="${toInt(p[u]||0)}" style="width:100%">
            </label>`).join('')}
        </div>
      </fieldset>
      `;
    }

    const wallGrid1 = Array.from({length:10},(_,i)=>i+1).map(lv => `
      <label>Lv ${lv}<br><input data-fm-w="${lv}" class="fm-input" type="number" min="0" value="${cfg.wallMap[lv]||0}" style="width:100%"></label>
    `).join('');
    const wallGrid2 = Array.from({length:10},(_,i)=>i+11).map(lv => `
      <label>Lv ${lv}<br><input data-fm-w="${lv}" class="fm-input" type="number" min="0" value="${cfg.wallMap[lv]||0}" style="width:100%"></label>
    `).join('');

    body.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:10px">
        <button id="fm-back" class="fm-btn">← Terug</button>
        <div style="font-weight:bold">Instellingen</div>
        <div style="flex:1"></div>
        <button id="fm-save" class="fm-btn">Opslaan</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr;gap:12px">
        ${presetForm('A', presets.A)}
        ${presetForm('B', presets.B)}

        <fieldset style="border:1px solid #c7a76a;border-radius:8px;padding:8px 10px">
          <legend style="padding:0 6px">Rammen per muurlevel</legend>
          <div style="display:grid;grid-template-columns:repeat(10,1fr);gap:8px">${wallGrid1}</div>
          <details style="margin-top:8px">
            <summary style="cursor:pointer">Meer niveaus (11–20)</summary>
            <div style="display:grid;grid-template-columns:repeat(10,1fr);gap:8px;margin-top:8px">${wallGrid2}</div>
          </details>
        </fieldset>

        <details style="margin-top:6px">
          <summary style="cursor:pointer">📘 Uitleg FarmManager</summary>
          <div style="margin-top:6px;opacity:.9">
            <p>FarmManager vult alleen velden in en opent het aanvalsscherm; jij bevestigt handmatig. Het script stuurt <i>geen</i> automatische bevelen.</p>
            <p><b>Rammen per muurlevel</b> bepaalt hoeveel rammen meegaan bij een bekend muurniveau &gt; 0. Met “Rammen bij gedeeltelijke verliezen” stuur je rammen alleen als het laatste rapport verliezen bevatte.</p>
            <p><b>Preset B bij volle buit</b> gebruikt B wanneer je vorige haul volledig was. Presets kun je hierboven aanpassen.</p>
            <p>Gebruik de hoofdbalk om filters in te stellen: max. velden en minimale tijd tussen farms (verbergt te recente doelen).</p>
          </div>
        </details>
      </div>
    `;

    APP.qs('#fm-back', body).onclick = ()=> { closeOverlay('#fm-overlay-settings'); openPlannerOverlay(); };
    APP.qs('#fm-save', body).onclick = ()=>{
      // presets
      const p = loadPresets();
      ['A','B'].forEach(name=>{
        unitOrder.forEach(u=>{
          const el = APP.qs(`[data-fm-preset="${name}:${u}"]`, body);
          if (el) p[name][u] = toInt(el.value);
        });
      });
      savePresets(p);
      // walls
      const c = loadCfg();
      for (let lv=1; lv<=20; lv++){
        const el = APP.qs(`[data-fm-w="${lv}"]`, body);
        if (el) c.wallMap[lv] = toInt(el.value);
      }
      saveCfg(c);
      alert('Instellingen opgeslagen.');
    };
  }

  function closeOverlay(sel){
    const ov = APP.qs(sel); if (ov) ov.remove();
  }

  function renderResults(){
    const root = APP.qs('#fm-res-body'); if (!root) return;
    const cfg = loadCfg(); const walls = loadWalls();
    const presets = loadPresets();
    const me = myCoordsFromDOM();

    const list = [];
    Object.keys(walls).forEach(k=>{
      const [x,y] = k.split('|').map(Number);
      const it = {coords:k, x,y, wall:walls[k].wall|0, loss:!!walls[k].loss, full:!!walls[k].full, lastTs:walls[k].lastTs||0};
      it.dist = me ? +dist(me,it).toFixed(2) : null;
      it.agoMin = fmtAgoMin(it.lastTs);
      list.push(it);
    });

    const maxD = cfg.filters.maxDist|0;
    const minGap = cfg.filters.minMinutesBetween|0;
    const filtered = list.filter(it=>{
      if (me && maxD && it.dist!=null && it.dist>maxD) return false;
      if (minGap>0 && typeof it.agoMin==='number' && it.agoMin < minGap) return false;
      return it.wall>0;
    });

    filtered.sort((a,b)=>{
      if (cfg.filters.sort==='wall_then_dist'){
        if (b.wall!==a.wall) return b.wall-a.wall;
        return (a.dist??999)-(b.dist??999);
      } else {
        if ((a.dist??999)!==(b.dist??999)) return (a.dist??999)-(b.dist??999);
        return b.wall-a.wall;
      }
    });

    const head = `
      <div style="display:grid;grid-template-columns:110px 64px 74px 90px 70px 1fr 140px;gap:8px;
                  padding:6px 8px;border-bottom:1px solid #c7a76a;background:#ecd6ad;font-weight:bold;">
        <div>Coords</div><div>Muur</div><div>Afst.</div><div>Rammen</div><div>Min-ago</div><div>Suggestie</div><div>Actie</div>
      </div>`;
    const rows = filtered.map(it=>{
      const shouldAddRams = cfg.logic.addRamsOnWall && it.wall>0 && (!cfg.logic.onlyOnLoss || it.loss);
      const rams = shouldAddRams ? (cfg.wallMap[it.wall]||0) : 0;
      const suggestB = (cfg.logic.useBWhenFull && it.full);
      const vid  = new URL(location.href).searchParams.get('village')||'';
      const urlA = buildPlaceUrl(vid, it.x, it.y, injectRams(loadPresets().A, rams));
      const urlB = buildPlaceUrl(vid, it.x, it.y, injectRams(loadPresets().B, rams));
      const titleA = compTitle(injectRams(loadPresets().A, rams));
      const titleB = compTitle(injectRams(loadPresets().B, rams));
      const sugg = suggestB ? 'Preset B (volle buit)' : 'Preset A';
      return `
        <div style="display:grid;grid-template-columns:110px 64px 74px 90px 70px 1fr 140px;gap:8px;align-items:center;
                    padding:6px 8px;border-bottom:1px dashed #c7a76a;">
          <div>[${it.coords}]</div>
          <div>Lv ${it.wall}${it.loss?'*':''}</div>
          <div>${it.dist!=null?it.dist:'?'}</div>
          <div>${rams}</div>
          <div>${it.agoMin!=null?it.agoMin:'–'}</div>
          <div>${sugg}</div>
          <div style="display:flex;gap:6px">
            <a href="${suggestB?urlB:urlA}" target="_blank" class="fm-btn">${suggestB?'Open B':'Open A'}</a>
            <a href="${suggestB?urlA:urlB}" target="_blank" class="fm-btn">Open ${suggestB?'A':'B'}</a>
          </div>
        </div>
      `;
    });

    root.innerHTML = head + (rows.join('') || `<div style="padding:8px;color:#7a4b00">Geen resultaten. Gebruik planner/scan.</div>`);
  }

  // ==========================================================
  // S C A N  (overlay + concurrency)
  // ==========================================================
  function bindScanOverlay(ov){
    const stat = APP.qs('#fm-stat', ov);
    const bar  = APP.qs('#fm-bar', ov);
    let cancel = false;

    function updateProgress(done, max, updated){
      bar.style.width = ((done/max)*100).toFixed(1)+'%';
      stat.textContent = `Bezig: ${done}/${max} — bijgewerkt: ${updated}`;
      setStatus(`Scannen… ${done}/${max}`);
    }

    APP.qs('#fm-cancel', ov).onclick = ()=> { cancel = true; };

    APP.qs('#fm-start', ov).onclick = async ()=>{
      cancel = false;
      const links = APP.qsa('a[href*="screen=report"][href*="view="]');
      if (!links.length) {
        stat.textContent = 'Geen rapportlinks gevonden op deze pagina. Open je rapportenlijst of een enkel rapport.';
        return;
      }

      const max = Math.min(links.length, APP.SCAN.MAX_LINKS);
      stat.textContent = `Gevonden: ${max} rapport(en). Start…`;

      APP.qs('#fm-start', ov).disabled = true;
      APP.qs('#fm-cancel', ov).disabled = false;

      const db = loadWalls();
      let done=0, updated=0;

      // concurrentie pool
      let idx = 0;
      async function worker(){
        while (!cancel && idx < max){
          const i = idx++;
          const href = links[i].href;
          try{
            const html = await (await fetch(href,{credentials:'same-origin'})).text();
            const got = parseReport(html);
            if (got && got.coords){
              const rec = db[got.coords] || {};
              if (typeof got.wall==='number') rec.wall = got.wall;
              if (typeof got.loss==='boolean') rec.loss = got.loss?1:0;
              if (typeof got.full==='boolean') rec.full = got.full?1:0;
              if (got.timeMs) rec.lastTs = got.timeMs;
              rec.ts = nowMs();
              db[got.coords] = rec;
              updated++;
            }
          }catch(e){/* ignore */}
          done++;
          updateProgress(done,max,updated);
          await sleep(randInt(APP.SCAN.DELAY_MIN, APP.SCAN.DELAY_MAX));
        }
      }

      // start N workers
      await Promise.all(Array.from({length:APP.SCAN.CONCURRENCY}, worker));
      saveWalls(db);

      APP.qs('#fm-start', ov).disabled = false;
      APP.qs('#fm-cancel', ov).disabled = true;

      const msg = cancel ? `Geannuleerd. Verwerkt: ${done}/${max}, bijgewerkt: ${updated}` :
                           `Klaar. Verwerkt: ${done}/${max}, bijgewerkt: ${updated}`;
      stat.textContent = msg;
      setStatus('Scan voltooid');
      renderResults();
    };
  }

  // ==========================================================
  // R E P O R T   P A R S I N G  (muur, verliezen, volle buit, tijd)
  // ==========================================================
  function parseReport(html){
    const doc = new DOMParser().parseFromString(html,'text/html');
    const bodyText = (doc.body.innerText||'').replace(/\s+/g,' ');

    // muur
    let wall;
    const cells = APP.qsa('table td', doc);
    for (let i=0;i<cells.length;i++){
      const t = (cells[i].innerText||'').trim();
      if (/^(Muur|Wall)$/i.test(t)) {
        const v = (cells[i+1]?.innerText||'').trim();
        if (/^\d+$/.test(v)) { wall = parseInt(v,10); break; }
      }
    }
    if (wall===undefined) {
      const m = bodyText.match(/Muur\s*:\s*(?:niveau\s*)?(\d+)|Wall\s*:\s*(?:level\s*)?(\d+)/i);
      if (m) wall = parseInt(m[1]||m[2],10);
    }

    // coords
    const mc = bodyText.match(/\b(\d{3})\|(\d{3})\b/);
    const coords = mc ? mc[1]+'|'+mc[2] : null;

    // verliezen (heuristiek)
    let loss = false;
    if (/Verliezen|Losses/i.test(bodyText)) {
      const m = bodyText.match(/Verliezen[^0-9]*(\d+)/i);
      loss = m ? (parseInt(m[1],10) > 0) : /verlies|verloren/i.test(bodyText);
    }

    // volle buit (heuristiek): zoek “Volledige buit” of max-icoon indicator
    const full = /Volledige buit|Full haul|Volle buit/i.test(bodyText);

    // tijd uit rapport (heuristiek: data & tijd in header)
    let timeMs = null;
    // probeer “op” datum-velden (bv. 31.10.2025 22:59:00 of 2025-10-31 22:59)
    const mdt = bodyText.match(/(\d{2}[.\-\/]\d{2}[.\-\/]\d{2,4})\s+(\d{2}:\d{2}(?::\d{2})?)/);
    if (mdt){
      const d = mdt[1].replace(/\./g,'-').replace(/\//g,'-');
      const iso = (/\d{4}-/.test(d)? d : d.split('-').reverse().join('-')) + 'T' + mdt[2];
      const t = Date.parse(iso);
      if (!isNaN(t)) timeMs = t;
    }

    return {coords, wall, loss, full, timeMs};
  }

  // ==========================================================
  // H E L P E R S  (building place URLs)
  // ==========================================================
  function injectRams(preset, rams){
    const u = JSON.parse(JSON.stringify(preset||{}));
    if (rams>0) u.ram = (u.ram|0) + rams;
    return u;
  }
  function compTitle(units){
    const order = ['spy','light','axe','spear','sword','heavy','archer','marcher','ram','catapult','knight'];
    const names = {spy:'Verkenner',light:'LC',axe:'Bijl',spear:'Speer',sword:'Zwaard',heavy:'ZC',archer:'Boog',marcher:'Ruiterboog',ram:'Ram',catapult:'Kata',knight:'Ridder'};
    const parts = [];
    order.forEach(k=>{ const v=units[k]|0; if (v>0) parts.push(`${names[k]}: ${v}`); });
    return parts.length ? `Stuurt: ${parts.join(', ')}` : 'Stuurt: (geen)';
  }
  function buildPlaceUrl(villageId, x, y, units){
    const params = new URLSearchParams();
    params.set('village', villageId);
    params.set('screen', 'place');
    params.set('x', x); params.set('y', y);
    const map = { spear:'spear', sword:'sword', axe:'axe', archer:'archer', spy:'spy', light:'light', heavy:'heavy', marcher:'marcher', ram:'ram', catapult:'catapult', knight:'knight' };
    Object.keys(map).forEach(k=>{
      const v = units[k]|0;
      if (v>0) params.set(map[k], String(v));
    });
    return 'game.php?'+params.toString();
  }

  // ==========================================================
  // A U T O - C A P T U R E   (individueel rapport)
  // ==========================================================
  async function autoCaptureIfReportView(){
    const url = new URL(location.href);
    if (!(url.searchParams.get('screen')==='report' && url.searchParams.get('view'))) return;

    try{
      const html = await (await fetch(location.href,{credentials:'same-origin'})).text();
      const got = parseReport(html);
      if (got && got.coords){
        const db = loadWalls();
        const rec = db[got.coords] || {};
        if (typeof got.wall==='number') rec.wall = got.wall;
        if (typeof got.loss==='boolean') rec.loss = got.loss?1:0;
        if (typeof got.full==='boolean') rec.full = got.full?1:0;
        if (got.timeMs) rec.lastTs = got.timeMs;
        rec.ts = nowMs();
        db[got.coords] = rec;
        saveWalls(db);
        setStatus(`Rapport opgeslagen: [${got.coords}] muur ${rec.wall ?? '-'}${rec.loss?' (verlies)':''}${rec.full?' (volle buit)':''}`);
        renderResults();
      }
    }catch(e){/*ignore*/}
  }

  // ==========================================================
  // I N I T
  // ==========================================================
  function init(){
    injectStyles();
    injectMainBar();
    injectResultsBlock();
    autoCaptureIfReportView();
  }

  // Public API for bookmarklet repeat
  window.__FarmManager__ = { init };

  // Auto-init
  init();
})();
