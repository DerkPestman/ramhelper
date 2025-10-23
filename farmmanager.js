(() => {
  // ==========================================================
  // FarmManager v1.0 — Standalone (NL)
  // - Overlay (gecentreerd) voor voorbereiding & instellingen
  // - Resultaatblok boven FA-lijst (eigen tabel; FA blijft intact)
  // - Scan rapporten met voortgangsbalk + cancel
  // - Presets A/B (zelfde units als FA; geen edelman)
  // - Muur->Rammen mapping; extra marge; "alleen bij verliezen"
  // - Open-Place knoppen (geen auto-send)
  // ==========================================================

  const APP = {
    VER: '1.0',
    KEYS: {
      cfg:      'FM_cfg',
      walls:    'FM_walls',     // { "489|480": { wall:3, loss:1, ts:... }, ... }
      presets:  'FM_presets',   // { A:{...units}, B:{...units} }
    },
    // throttling voor scans
    SCAN_DELAY_MIN: 300,
    SCAN_DELAY_MAX: 500,
    SCAN_MAX_PAGES: 20,
    qs:  (sel, root=document) => root.querySelector(sel),
    qsa: (sel, root=document) => Array.from(root.querySelectorAll(sel)),
  };

  // ---------------- Defaults ----------------
  function defaultCfg() {
    const wallMap = {1:8,2:12,3:16,4:20,5:24,6:28,7:32,8:36,9:40,10:44,11:48,12:52,13:56,14:60,15:64,16:68,17:72,18:76,19:80,20:84};
    return {
      enable: true,          // rammen bij muur > 0
      onlyOnLoss: true,      // alleen bij verliezen
      margin: 0,             // marge-rammen extra
      wallMap,               // mapping lv -> rammen
      filters: {
        maxDist: 25,         // max velden
        sort: 'dist_then_wall', // of 'wall_then_dist'
      },
      showStartup: false
    };
  }
  function defaultPresets() {
    // units: spear,sword,axe,archer,spy,light,heavy,marcher,ram,catapult,knight (geen snob)
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
  const sleep   = (ms)=> new Promise(r=>setTimeout(r,ms));
  const clamp   = (v,min,max)=> Math.max(min, Math.min(max, v));
  const dist    = (a,b)=> Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2);
  const fmtTime = (m)=> `${Math.floor(m)}m`;
  const toInt   = (v)=> Math.max(0, (v|0));

  function myCoordsFromDOM() {
    const txt = document.body.innerText || '';
    const m = txt.match(/\b(\d{3})\|(\d{3})\b/);
    return m ? {x:+m[1], y:+m[2]} : null;
  }

  // ==========================================================
  // UI: Overlay (gecentreerd) — voorbereiding/planner/settings
  // ==========================================================
  function openOverlay() {
    if (APP.qs('#fm-overlay')) return;
    const ov = document.createElement('div');
    ov.id = 'fm-overlay';
    Object.assign(ov.style, {
      position:'fixed', inset:'0', background:'rgba(0,0,0,.45)', zIndex:2147483647,
      display:'flex', alignItems:'center', justifyContent:'center'
    });

    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      width:'980px', maxHeight:'86vh', overflow:'auto', borderRadius:'12px',
      background:'#fffaf0', color:'#2b2416', border:'1px solid #c7a76a',
      boxShadow:'0 10px 30px rgba(0,0,0,.45)', font:'14px/1.5 Verdana, Arial, sans-serif'
    });

    wrap.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #c7a76a;background:#fff3dc;border-top-left-radius:12px;border-top-right-radius:12px;">
        <div><b>FarmManager</b> <span style="opacity:.7">v${APP.VER}</span></div>
        <div style="display:flex;gap:8px">
          <button id="fm-btn-settings" class="fm-btn">Instellingen</button>
          <button id="fm-btn-scan" class="fm-btn">Scan rapporten</button>
          <button id="fm-btn-close" class="fm-btn" style="background:#a55;color:#fff">Sluiten</button>
        </div>
      </div>
      <div id="fm-body" style="padding:12px 14px"></div>
    `;

    ov.appendChild(wrap);
    document.body.appendChild(ov);

    APP.qs('#fm-btn-close', wrap).onclick = ()=> ov.remove();
    APP.qs('#fm-btn-settings', wrap).onclick = ()=> renderSettings(APP.qs('#fm-body'));
    APP.qs('#fm-btn-scan', wrap).onclick = ()=> renderScan(APP.qs('#fm-body'));
    renderPlanner(APP.qs('#fm-body')); // start op planner-tab
  }

  // ---------- Planner view in overlay ----------
  function renderPlanner(body){
    const cfg = loadCfg();
    const presets = loadPresets();
    const walls = loadWalls();
    const me = myCoordsFromDOM();

    const filterBar = `
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:10px;">
        <label>Max. velden <input id="fm-maxdist" type="number" min="1" max="100" value="${cfg.filters.maxDist}" style="width:70px"></label>
        <label>Sortering
          <select id="fm-sort">
            <option value="dist_then_wall"${cfg.filters.sort==='dist_then_wall'?' selected':''}>Afstand → Muur</option>
            <option value="wall_then_dist"${cfg.filters.sort==='wall_then_dist'?' selected':''}>Muur → Afstand</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:6px">
          <input id="fm-enable" type="checkbox" ${cfg.enable?'checked':''}> Rammen bij muur &gt; 0
        </label>
        <label style="display:flex;align-items:center;gap:6px">
          <input id="fm-loss" type="checkbox" ${cfg.onlyOnLoss?'checked':''}> Alleen bij verliezen
        </label>
        <label>+marge <input id="fm-margin" type="number" min="0" value="${cfg.margin}" style="width:60px"></label>
        <button id="fm-pl-save" class="fm-btn">Opslaan</button>
      </div>
    `;

    // prepare list from walls
    const list = [];
    Object.keys(walls).forEach(k=>{
      const [x,y] = k.split('|').map(Number);
      const it = {x,y, coords:k, wall: walls[k].wall|0, loss: !!walls[k].loss, ts:walls[k].ts||0};
      it.dist = me ? +dist(me,it).toFixed(2) : null;
      list.push(it);
    });

    // filter + sort
    const maxD = cfg.filters.maxDist|0;
    const filtered = list.filter(it=>{
      if (me && maxD && it.dist!=null && it.dist>maxD) return false;
      // toon alleen barbs met muur>0 – planner is voor rammen
      return it.wall>0;
    });
    filtered.sort((a,b)=>{
      if (cfg.filters.sort==='wall_then_dist'){
        if (b.wall!==a.wall) return b.wall-a.wall;
        return (a.dist??999)-(b.dist??999);
      }
      // dist_then_wall
      if ((a.dist??999)!==(b.dist??999)) return (a.dist??999)-(b.dist??999);
      return b.wall-a.wall;
    });

    // table
    const head = `
      <div style="display:grid;grid-template-columns:110px 60px 70px 90px 1fr 120px;gap:8px;
                  padding:6px 8px;border-bottom:1px solid #c7a76a;background:#ecd6ad;font-weight:bold;">
        <div>Coords</div><div>Muur</div><div>Afst.</div><div>Rammen</div><div>Preset (A/B)</div><div>Actie</div>
      </div>`;

    const rows = filtered.map(it=>{
      const rams = (cfg.enable && (!cfg.onlyOnLoss || it.loss)) ? ((cfg.wallMap[it.wall]||0) + (cfg.margin||0)) : 0;
      const need = {...presets.A}; // default UI laat A zien; klikken kan keuze geven (A/B)
      // alleen rammen toevoegen in de URL; preset A/B kies je door op de juiste knop te klikken
      const vid = new URL(location.href).searchParams.get('village')||'';
      const urlA = buildPlaceUrl(vid, it.x, it.y, injectRams(presets.A, rams));
      const urlB = buildPlaceUrl(vid, it.x, it.y, injectRams(presets.B, rams));
      const titleA = compTitle(injectRams(presets.A, rams));
      const titleB = compTitle(injectRams(presets.B, rams));

      return `
        <div style="display:grid;grid-template-columns:110px 60px 70px 90px 1fr 120px;gap:8px;align-items:center;
                    padding:6px 8px;border-bottom:1px dashed #c7a76a;">
          <div>[${it.coords}]</div>
          <div>Lv ${it.wall}${it.loss?'*':''}</div>
          <div>${it.dist!=null?it.dist:'?'}</div>
          <div>${rams}</div>
          <div>
            <span title="${titleA}" style="margin-right:8px;opacity:.8">A</span>
            <span title="${titleB}" style="opacity:.8">B</span>
          </div>
          <div style="display:flex;gap:6px">
            <a href="${urlA}" target="_blank" class="fm-btn">Open A</a>
            <a href="${urlB}" target="_blank" class="fm-btn">Open B</a>
          </div>
        </div>
      `;
    });

    const empty = filtered.length ? '' :
      `<div style="padding:8px 4px;color:#7a4b00">Geen doelen binnen filters (of geen muurdata &gt; 0 gevonden). Klik <b>Scan rapporten</b> en/of pas filters aan.</div>`;

    body.innerHTML = `
      ${filterBar}
      <div style="border:1px solid #c7a76a;border-radius:8px;overflow:hidden">${head}${rows.join('')}${empty}</div>
      <div style="margin-top:8px;opacity:.8">* sterretje = laatste aanval had verliezen.</div>
    `;

    // events
    APP.qs('#fm-pl-save', body).onclick = ()=>{
      const c = loadCfg();
      c.filters.maxDist = clamp(+APP.qs('#fm-maxdist', body).value||c.filters.maxDist,1,200);
      c.filters.sort    = APP.qs('#fm-sort', body).value;
      c.enable          = APP.qs('#fm-enable', body).checked;
      c.onlyOnLoss      = APP.qs('#fm-loss', body).checked;
      c.margin          = Math.max(0, +APP.qs('#fm-margin', body).value||0);
      saveCfg(c);
      renderPlanner(body);
    };
  }

  // ---------- Settings view ----------
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
              <input data-fm-preset="${name}:${u}" type="number" min="0" value="${toInt(p[u]||0)}" style="width:100%">
            </label>`).join('')}
        </div>
      </fieldset>
      `;
    }

    const wallGrid1 = Array.from({length:10},(_,i)=>i+1).map(lv => `
      <label>Lv ${lv}<br><input data-fm-w="${lv}" type="number" min="0" value="${cfg.wallMap[lv]||0}" style="width:100%"></label>
    `).join('');
    const wallGrid2 = Array.from({length:10},(_,i)=>i+11).map(lv => `
      <label>Lv ${lv}<br><input data-fm-w="${lv}" type="number" min="0" value="${cfg.wallMap[lv]||0}" style="width:100%"></label>
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
      </div>
    `;

    APP.qs('#fm-back', body).onclick = ()=> renderPlanner(body);
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

  // ---------- Scan view ----------
  function renderScan(body){
    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <button id="fm-back" class="fm-btn">← Terug</button>
        <div style="font-weight:bold">Scan rapporten</div>
      </div>
      <div id="fm-scanbox" style="border:1px solid #c7a76a;border-radius:8px;padding:10px;background:#fff;">
        <div id="fm-progress" style="height:10px;background:#f0e6d2;border-radius:6px;overflow:hidden;margin-bottom:8px">
          <div id="fm-bar" style="height:100%;width:0;background:#6a8e3a"></div>
        </div>
        <div id="fm-status" style="margin-bottom:8px;opacity:.9">Zoek rapportlinks…</div>
        <div style="display:flex;gap:8px">
          <button id="fm-start" class="fm-btn">Start scan</button>
          <button id="fm-cancel" class="fm-btn" disabled>Annuleren</button>
        </div>
      </div>
    `;
    APP.qs('#fm-back', body).onclick = ()=> renderPlanner(body);

    let cancel = false;

    APP.qs('#fm-start', body).onclick = async ()=>{
      cancel = false;
      APP.qs('#fm-start', body).disabled = true;
      APP.qs('#fm-cancel', body).disabled = false;

      const status = APP.qs('#fm-status', body);
      const bar    = APP.qs('#fm-bar', body);

      // Zoek max 20 pagina links op huidige pagina (rapportenlijst)
      const links = APP.qsa('a[href*="screen=report"][href*="view="]');
      if (!links.length) {
        status.textContent = 'Geen rapportlinks gevonden op deze pagina. Open je rapportenlijst of een enkel rapport.';
        APP.qs('#fm-start', body).disabled = false;
        APP.qs('#fm-cancel', body).disabled = true;
        return;
      }

      const db = loadWalls();
      const max = Math.min(links.length, 50); // harde limiet
      let done = 0, updated = 0;

      status.textContent = `Gevonden: ${max} rapport(en). Start…`;
      for (const a of links.slice(0, max)) {
        if (cancel) break;
        try{
          const html = await (await fetch(a.href, {credentials:'same-origin'})).text();
          const got  = parseReport(html);
          if (got && got.coords) {
            db[got.coords] = {
              wall: typeof got.wall==='number' ? got.wall : (db[got.coords]?.wall ?? 0),
              loss: got.loss?1:0,
              ts: Date.now()
            };
            updated++;
          }
        }catch(e){/* ignore */}
        done++;
        bar.style.width = ((done/max)*100).toFixed(1)+'%';
        status.textContent = `Bezig: ${done}/${max} — bijgewerkt: ${updated}`;
        await sleep(APP.SCAN_DELAY_MIN + Math.random()*(APP.SCAN_DELAY_MAX-APP.SCAN_DELAY_MIN));
      }
      saveWalls(db);
      status.textContent = cancel ? `Geannuleerd. Verwerkt: ${done}/${max}, bijgewerkt: ${updated}` :
                                     `Klaar. Verwerkt: ${done}/${max}, bijgewerkt: ${updated}`;
      APP.qs('#fm-start', body).disabled = false;
      APP.qs('#fm-cancel', body).disabled = true;
    };

    APP.qs('#fm-cancel', body).onclick = ()=> { cancel = true; };
  }

  // ---------- Report parsing ----------
  function parseReport(html){
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const bodyText = (doc.body.innerText||'').replace(/\s+/g,' ');

    // muur: tabel "Gebouw / Level"
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

    // verlies: heuristiek
    let loss = false;
    if (/Verliezen|Losses/i.test(bodyText)) {
      const m = bodyText.match(/Verliezen[^0-9]*(\d+)/i);
      loss = m ? (parseInt(m[1],10) > 0) : /verlies|verloren/i.test(bodyText);
    }
    return {coords, wall, loss};
  }

  // ---------- Helpers for Place URL ----------
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
  // Resultaatblok boven FA (FA blijft onaangeroerd)
  // ==========================================================
  function injectResultBlock(){
    // toon alleen op FA-pagina (maar niet FA wijzigen)
    if (!/[?&]screen=am_farm\b/.test(location.search)) return;
    if (APP.qs('#fm-results')) return;

    const host = APP.qs('#content_value') || document.body;
    const box = document.createElement('div');
    box.id = 'fm-results';
    Object.assign(box.style, {
      margin:'10px 0 12px',
      padding:'10px',
      border:'1px solid #c7a76a',
      borderRadius:'8px',
      background:'#fff7e8'
    });
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div><b>FarmManager – resultaten</b></div>
        <button id="fm-open-overlay" class="fm-btn">Open planner</button>
      </div>
      <div id="fm-res-body" style="border:1px solid #c7a76a;border-radius:8px;overflow:hidden;background:#fff"></div>
    `;
    host.insertBefore(box, host.firstChild);

    APP.qs('#fm-open-overlay', box).onclick = openOverlay;
    renderResults(APP.qs('#fm-res-body'));
  }

  function renderResults(root){
    const cfg = loadCfg();
    const presets = loadPresets();
    const walls = loadWalls();
    const me = myCoordsFromDOM();

    const list = [];
    Object.keys(walls).forEach(k=>{
      const [x,y] = k.split('|').map(Number);
      const it = {x,y, coords:k, wall:walls[k].wall|0, loss:!!walls[k].loss};
      it.dist = me ? +dist(me,it).toFixed(2) : null;
      list.push(it);
    });

    const maxD = cfg.filters.maxDist|0;
    const filtered = list.filter(it=>{
      if (me && maxD && it.dist!=null && it.dist>maxD) return false;
      return it.wall>0;
    });
    filtered.sort((a,b)=>{
      if (cfg.filters.sort==='wall_then_dist'){
        if (b.wall!==a.wall) return b.wall-a.wall;
        return (a.dist??999)-(b.dist??999);
      }
      if ((a.dist??999)!==(b.dist??999)) return (a.dist??999)-(b.dist??999);
      return b.wall-a.wall;
    });

    const head = `
      <div style="display:grid;grid-template-columns:110px 60px 70px 90px 1fr 120px;gap:8px;
                  padding:6px 8px;border-bottom:1px solid #c7a76a;background:#ecd6ad;font-weight:bold;">
        <div>Coords</div><div>Muur</div><div>Afst.</div><div>Rammen</div><div>Preset (A/B)</div><div>Actie</div>
      </div>`;
    const rows = filtered.map(it=>{
      const rams = (cfg.enable && (!cfg.onlyOnLoss || it.loss)) ? ((cfg.wallMap[it.wall]||0) + (cfg.margin||0)) : 0;
      const vid  = new URL(location.href).searchParams.get('village')||'';
      const urlA = buildPlaceUrl(vid, it.x, it.y, injectRams(presets.A, rams));
      const urlB = buildPlaceUrl(vid, it.x, it.y, injectRams(presets.B, rams));
      const titleA = compTitle(injectRams(presets.A, rams));
      const titleB = compTitle(injectRams(presets.B, rams));
      return `
        <div style="display:grid;grid-template-columns:110px 60px 70px 90px 1fr 120px;gap:8px;align-items:center;
                    padding:6px 8px;border-bottom:1px dashed #c7a76a;">
          <div>[${it.coords}]</div>
          <div>Lv ${it.wall}${it.loss?'*':''}</div>
          <div>${it.dist!=null?it.dist:'?'}</div>
          <div>${rams}</div>
          <div>
            <span title="${titleA}" style="margin-right:8px;opacity:.8">A</span>
            <span title="${titleB}" style="opacity:.8">B</span>
          </div>
          <div style="display:flex;gap:6px">
            <a href="${urlA}" target="_blank" class="fm-btn">Open A</a>
            <a href="${urlB}" target="_blank" class="fm-btn">Open B</a>
          </div>
        </div>
      `;
    });

    root.innerHTML = head + (rows.join('') || `<div style="padding:8px;color:#7a4b00">Geen resultaten. Gebruik <b>Open planner</b> &gt; Scan rapporten.</div>`);
  }

  // ==========================================================
  // Styles
  // ==========================================================
  function injectStyles(){
    if (APP.qs('#fm-styles')) return;
    const st = document.createElement('style');
    st.id = 'fm-styles';
    st.textContent = `
      .fm-btn {
        background:#b2773a; border:none; color:#fff; padding:6px 10px; border-radius:6px; cursor:pointer;
      }
      .fm-btn:disabled { opacity:.6; cursor:default; }
      .fm-btn:hover { filter:brightness(1.06); }
    `;
    document.head.appendChild(st);
  }

  // ==========================================================
  // Public API / init
  // ==========================================================
  function init(){
    injectStyles();
    openOverlay();          // jij opent de planner overlay
    injectResultBlock();    // en we laten boven FA een eigen blok zien (als je op FA bent)
  }

  window.__FarmManager__ = { init };

  // auto als bookmarklet gebruikt op FA of elders
  init();

})();
