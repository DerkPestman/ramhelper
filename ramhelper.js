(() => {
  // =============== Meta & opslag ===============
  const APP_VER = '2.0.0-f1';
  const LS_KEY  = 'RH_barbWalls'; // { "486|453": {wall:6,id:12345,ts:...}, ... }
  const CFG_KEY = 'RH_cfg';       // instellingen (ui + planner)

  // =============== Helpers ===============
  const htmlEscape = s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const getParam = (u, k) => {
    const m = (u || location.href).match(new RegExp('[?&]'+k+'=(\\d+)'));
    return m ? m[1] : null;
  };
  const getVillageCoordFromDOM = () => {
    // zoekt eerste 3cijfer|3cijfer op de pagina (veilig genoeg voor TW)
    const t = document.body.innerText || '';
    const m = t.match(/\b(\d{3})\|(\d{3})\b/);
    return m ? {x:+m[1], y:+m[2]} : null;
  };
  const dist = (a,b) => {
    const dx=a.x-b.x, dy=a.y-b.y;
    return Math.sqrt(dx*dx+dy*dy);
  };
  const loadMap = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)||'{}'); } catch(e){ return {}; } };
  const saveMap = (map) => localStorage.setItem(LS_KEY, JSON.stringify(map));
  const loadCfg = () => {
    const d = {
      // bestaande filters
      radius: 30,
      minWall: 1,
      maxWall: 20,
      safeRams: [0,2,3,4,6,8,10,12,14,16,18,20,22],  // tbv oude lijst
      forceSpy: 1,
      sort: 'dist_then_wall',
      // --- NIEUW: Planner default ---
      planner: {
        maxRadius: 25,
        minWall: 1,
        A: 1.5,          // rams = A*wall + B
        B: 2,
        minRams: 4,      // ondergrens
        spies: 1,        // scouts per aanval
        onlyWalls>0: true // alleen barbs met muur>0
      }
    };
    try { return Object.assign(d, JSON.parse(localStorage.getItem(CFG_KEY)||'{}')); }
    catch(e){ return d; }
  };
  const saveCfg = (cfg) => localStorage.setItem(CFG_KEY, JSON.stringify(cfg));

  const wallToRamsList = (w, cfg) => {
    // behoud voor achterwaartse compatibiliteit
    const arr = cfg.safeRams;
    const idx = Math.max(0, Math.min(arr.length-1, w));
    return arr[idx] || arr[arr.length-1];
  };

  // =============== UI container (TW-stijl) ===============
  function ensureFrame() {
    let box = document.getElementById('rh-box');
    if (box) return box;

    box = document.createElement('div');
    box.id = 'rh-box';
    // TW-achtig: beige/bruin, groter
    Object.assign(box.style, {
      position:'fixed', top:'64px', right:'24px', zIndex:2147483647,
      width:'920px', maxHeight:'86vh', overflow:'auto',
      background:'#f1e0c6', color:'#2b2416',
      border:'1px solid #c7a76a', borderRadius:'10px',
      boxShadow:'0 8px 20px rgba(0,0,0,.35)',
      font:'14px/1.5 Arial, sans-serif'
    });

    box.innerHTML = `
      <div id="rh-head" style="
        display:flex;align-items:center;justify-content:space-between;
        padding:8px 12px;background:#e8d1a7;border-bottom:1px solid #c7a76a;
        border-top-left-radius:10px;border-top-right-radius:10px;cursor:move;">
        <div><b>RamHelper</b> <span style="opacity:.7">v${APP_VER}</span></div>
        <div style="display:flex;gap:8px;align-items:center">
          <button data-tab="scan" class="rh-tabbtn" style="background:#fff3dc;border:1px solid #c7a76a;border-radius:6px;padding:4px 8px;cursor:pointer;">Scan / Data</button>
          <button data-tab="planner" class="rh-tabbtn" style="background:#fff3dc;border:1px solid #c7a76a;border-radius:6px;padding:4px 8px;cursor:pointer;">Planner</button>
          <button id="rh-close" style="background:#b2773a;border:none;color:#fff;padding:4px 8px;border-radius:6px;cursor:pointer">X</button>
        </div>
      </div>
      <div id="rh-body" style="padding:10px 12px"></div>
    `;
    document.body.appendChild(box);

    // Drag
    (function drag(){
      const head=box.querySelector('#rh-head');
      let ox=0, oy=0, down=false;
      head.addEventListener('mousedown',e=>{down=true;ox=e.clientX-box.offsetLeft;oy=e.clientY-box.offsetTop;});
      document.addEventListener('mousemove',e=>{if(!down)return;box.style.left=(e.clientX-ox)+'px';box.style.top=(e.clientY-oy)+'px';box.style.right='auto';});
      document.addEventListener('mouseup',()=>down=false);
    })();

    box.querySelector('#rh-close').onclick = () => box.remove();

    // Tabs
    box.querySelectorAll('.rh-tabbtn').forEach(btn=>{
      btn.onclick = () => {
        const t = btn.getAttribute('data-tab');
        if (t === 'planner') renderPlanner();
        else renderScanData();
      };
    });

    return box;
  }

  // =============== Parser (rapport) ===============
  function parseWallFromReportHtml(html){
    const doc = new DOMParser().parseFromString(html,'text/html');
    let wall, coords, id;

    // 1) Tabel "Gebouw / Level"
    const cells = [...doc.querySelectorAll('table td')];
    for (let i=0;i<cells.length;i++){
      const txt = (cells[i].innerText||'').trim();
      if (/^(Muur|Wall)$/i.test(txt)) {
        const val = (cells[i+1]?.innerText||'').trim();
        if (/^\d+$/.test(val)) { wall = parseInt(val,10); break; }
      }
    }
    // 2) Fallback: tekst
    if (wall === undefined) {
      const txt = doc.body.innerText || '';
      const m = txt.match(/Muur\s*:\s*(?:niveau\s*)?(\d+)|Wall\s*:\s*(?:level\s*)?(\d+)/i);
      if (m) wall = parseInt(m[1]||m[2],10);
    }
    // 3) Coords
    const mc = (doc.body.innerText||'').match(/\b(\d{3})\|(\d{3})\b/);
    if (mc) coords = mc[1]+'|'+mc[2];
    // 4) Village id
    const link = doc.querySelector('a[href*="screen=info_village"][href*="id="]');
    if (link) {
      const m = link.href.match(/id=(\d+)/); if (m) id = m[1];
    }
    return { wall, coords, id };
  }

  // =============== Scanactie (ongewijzigde basis) ===============
  async function scanCurrent(){
    try{
      const url=new URL(location.href);
      if (url.searchParams.get('screen')==='report'){
        const isSingle=!!url.searchParams.get('view');
        if (isSingle){
          const res=await fetch(location.href,{credentials:'same-origin'});
          const html=await res.text();
          const got=parseWallFromReportHtml(html);
          if (!got.coords || typeof got.wall!=='number'){ alert('Kon geen muur of coords vinden op dit rapport.'); return; }
          const map=loadMap();
          map[got.coords]={wall:got.wall,id:got.id||(map[got.coords]?map[got.coords].id:null),ts:Date.now()};
          saveMap(map);
          alert('Opgeslagen: ['+got.coords+'] muur '+got.wall);
          renderScanData();
        } else {
          const rows=[...document.querySelectorAll('a[href*="screen=report"][href*="view="]')].slice(0,50);
          if (!rows.length){ alert('Geen rapportlinks gevonden op deze pagina.'); return; }
          let count=0;
          for (const a of rows){
            try{
              const r=await fetch(a.href,{credentials:'same-origin'});
              const html=await r.text();
              const got=parseWallFromReportHtml(html);
              if (got.coords && typeof got.wall==='number'){
                const map=loadMap();
                map[got.coords]={wall:got.wall,id:got.id||(map[got.coords]?map[got.coords].id:null),ts:Date.now()};
                saveMap(map); count++;
              }
            }catch(e){}
          }
          alert('Scan klaar. Geüpdatet: '+count+' rapport(en).');
          renderScanData();
        }
      } else {
        alert('Open Rapporten (verkenning) of een specifiek rapport en klik opnieuw op Scan.');
      }
    }catch(e){
      alert('Scan fout: '+(e&&e.message?e.message:e));
    }
  }

  // =============== TAB 1: Scan/Data (bestaande lijst) ===============
  function renderScanData(){
    const box = ensureFrame();
    const body = box.querySelector('#rh-body');
    const cfg  = loadCfg();
    const map  = loadMap();
    const vCoord = getVillageCoordFromDOM();
    const currentVid = getParam(location.href,'village');

    let info = '';
    if (!vCoord){
      info = `<div style="margin:6px 0 10px;color:#7a4b00">
        Kon je dorpscoördinaten niet zeker vinden op deze pagina.
        Stel ze hieronder in of open het aanvalsscherm.
      </div>`;
    }

    const headerControls = `
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:8px;">
        <label>Radius<br><input id="rh-radius" type="number" min="1" max="100" value="${cfg.radius}" style="width:100%"></label>
        <label>Min muur<br><input id="rh-minwall" type="number" min="0" max="20" value="${cfg.minWall}" style="width:100%"></label>
        <label>Sortering<br>
          <select id="rh-sort" style="width:100%">
            <option value="dist_then_wall"${cfg.sort==='dist_then_wall'?' selected':''}>Afstand → Muur</option>
            <option value="wall_then_dist"${cfg.sort==='wall_then_dist'?' selected':''}>Muur → Afstand</option>
          </select>
        </label>
        <label>Force scout<br><input id="rh-spy" type="number" min="0" max="5" value="${cfg.forceSpy}" style="width:100%"></label>
        <label>Mijn coords<br><input id="rh-mycoords" placeholder="xxx|yyy" value="${vCoord?(vCoord.x+'|'+vCoord.y):''}" style="width:100%"></label>
        <div style="display:flex;gap:6px;align-items:flex-end;">
          <button id="rh-save" style="flex:1;background:#6a8e3a;border:none;color:#fff;padding:6px;border-radius:6px;cursor:pointer;">Opslaan</button>
          <button id="rh-scan" style="flex:1;background:#3a6a8e;border:none;color:#fff;padding:6px;border-radius:6px;cursor:pointer;">Scan</button>
        </div>
      </div>
    `;

    const keys = Object.keys(map);
    if (!keys.length){
      body.innerHTML = info + headerControls +
        '<div style="opacity:.75">Nog geen barbs met muurdata. Open je <b>Rapporten</b> (verkenningsrapporten) en klik <b>Scan</b>.</div>';
      hookData();
      return;
    }

    let my = vCoord;
    if (!my){
      const s=(document.getElementById('rh-mycoords')||{}).value||'';
      const m=s.match(/(\d{3})\|(\d{3})/);
      if (m) my={x:+m[1],y:+m[2]};
    }

    const list=[];
    keys.forEach(k=>{
      const e=map[k]; if (!e || typeof e.wall!=='number') return;
      const [x,y] = k.split('|').map(Number);
      const o={id:e.id||null, x, y, wall:e.wall, ts:e.ts||0};
      o.dist = my ? +dist(my,o).toFixed(1) : null;
      list.push(o);
    });

    const filtered = list.filter(b=>{
      if (my && cfg.radius && b.dist!=null && b.dist>cfg.radius) return false;
      return b.wall>=cfg.minWall && b.wall<=cfg.maxWall;
    });

    filtered.sort((a,b)=>{
      if (cfg.sort==='wall_then_dist'){
        if (b.wall!==a.wall) return b.wall-a.wall;
        return (a.dist??999)-(b.dist??999);
      } else {
        if ((a.dist??999)!==(b.dist??999)) return (a.dist??999)-(b.dist??999);
        return b.wall-a.wall;
      }
    });

    const head = `
      <div style="display:grid;grid-template-columns:96px 64px 64px 1fr 140px 120px;gap:6px;
        padding:6px 8px;border-bottom:1px solid #c7a76a;background:#ecd6ad;font-weight:bold;">
        <div>Coords</div><div>Muur</div><div>Afst.</div><div>Advies</div><div>Actie</div><div>Beheer</div>
      </div>`;
    const rows = [head];
    filtered.forEach(b=>{
      const rams = wallToRamsList(b.wall, cfg);
      const spy  = Math.max(0, ~~cfg.forceSpy);
      const coords = `${b.x}|${b.y}`;
      const targetParam = b.id?('target='+b.id):('x='+b.x+'&y='+b.y);
      const base = 'game.php?village='+(getParam(location.href,'village')||'')+'&screen=place&'+targetParam+'&ram='+rams+(spy?('&spy='+spy):'');

      rows.push(`
        <div style="display:grid;grid-template-columns:96px 64px 64px 1fr 140px 120px;gap:6px;align-items:center;
          padding:6px 8px;border-bottom:1px dashed #c7a76a;">
          <div>[${coords}]</div>
          <div>Lv ${b.wall}</div>
          <div>${b.dist!=null?b.dist:'?'}</div>
          <div>${rams} rammen + ${spy} scout</div>
          <div><a href="${base}" target="_blank" style="background:#b2773a;color:#fff;text-decoration:none;padding:4px 8px;border-radius:6px;display:inline-block;">Open place</a></div>
          <div>
            <button data-rh="markdown" data-k="${coords}" style="background:#e6cfaa;border:1px solid #c7a76a;color:#6b4d2b;padding:4px 8px;border-radius:6px;cursor:pointer;">Muur weg</button>
            <button data-rh="rescout"  data-k="${coords}" style="background:#7aa0c8;border:none;color:#fff;padding:4px 8px;border-radius:6px;cursor:pointer;">Rescout</button>
          </div>
        </div>
      `);
    });

    const empty = filtered.length ? '' :
      `<div style="padding:10px 4px;color:#7a4b00">Binnen je radius zijn geen barbs met (voldoende) muur. Pas filters aan of scan nieuwe rapporten.</div>`;

    body.innerHTML = headerControls + empty + rows.join('');
    hookData();

    function hookData(){
      document.getElementById('rh-save').onclick = () => {
        const c = loadCfg();
        c.radius  = +document.getElementById('rh-radius').value || c.radius;
        c.minWall = +document.getElementById('rh-minwall').value|| c.minWall;
        c.sort    = document.getElementById('rh-sort').value;
        c.forceSpy= +document.getElementById('rh-spy').value|| 0;
        const mc=(document.getElementById('rh-mycoords').value||'').match(/(\d{3})\|(\d{3})/);
        if (mc) c.my = {x:+mc[1], y:+mc[2]};
        saveCfg(c);
        renderScanData();
      };
      document.getElementById('rh-scan').onclick = scanCurrent;

      body.querySelectorAll('button[data-rh="markdown"]').forEach(b=>b.onclick=()=>{
        const k=b.getAttribute('data-k'); const m=loadMap(); if (m[k]) m[k].wall=0; saveMap(m); renderScanData();
      });
      body.querySelectorAll('button[data-rh="rescout"]').forEach(b=>b.onclick=()=>{
        alert('Open het verkenningsrapport van ['+b.getAttribute('data-k')+'] en klik in deze tool op Scan om te updaten.');
      });
    }
  }

  // =============== TAB 2: Planner (NIEUW) ===============
  function renderPlanner(){
    const box = ensureFrame();
    const body = box.querySelector('#rh-body');
    const cfg  = loadCfg();
    const plan = cfg.planner || (cfg.planner = {
      maxRadius: 25, minWall: 1, A: 1.5, B: 2, minRams: 4, spies: 1, onlyWalls>0: true
    });
    saveCfg(cfg);

    const my = getVillageCoordFromDOM() || cfg.my || null;
    const map = loadMap();
    const keys = Object.keys(map);

    // Opties bovenaan (FarmGod-stijl)
    const opts = `
      <div style="border:1px solid #c7a76a;background:#fff7e8;border-radius:8px;padding:10px;margin-bottom:10px;">
        <div style="font-weight:bold;margin-bottom:6px">Planner Opties</div>
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;">
          <label>Max. velden<br><input id="pl-maxR" type="number" min="1" max="100" value="${plan.maxRadius}" style="width:100%"></label>
          <label>Min. muur<br><input id="pl-minW" type="number" min="0" max="20" value="${plan.minWall}" style="width:100%"></label>
          <label>Formule A<br><input id="pl-A" type="number" step="0.1" value="${plan.A}" style="width:100%"></label>
          <label>Formule B<br><input id="pl-B" type="number" step="1" value="${plan.B}" style="width:100%"></label>
          <label>Min. rammen<br><input id="pl-minR" type="number" min="0" value="${plan.minRams}" style="width:100%"></label>
          <label>Scouts/aanval<br><input id="pl-spy" type="number" min="0" max="5" value="${plan.spies}" style="width:100%"></label>
        </div>
        <div style="margin-top:8px;display:flex;align-items:center;gap:12px;">
          <label><input id="pl-onlywalls" type="checkbox" ${plan.onlyWalls>0?'checked':''}> Plan alleen barbs met muur &gt; 0</label>
          <div style="flex:1"></div>
          <button id="pl-save"  style="background:#6a8e3a;border:none;color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;">Opslaan</button>
          <button id="pl-plan"  style="background:#b2773a;border:none;color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;">Plan ramaanvallen</button>
        </div>
      </div>
    `;

    // Preview sectie (tabel)
    const head = `
      <div style="display:grid;grid-template-columns:96px 56px 68px 1fr 160px;gap:6px;
        padding:6px 8px;border-bottom:1px solid #c7a76a;background:#ecd6ad;font-weight:bold;">
        <div>Coords</div><div>Muur</div><div>Afst.</div><div>Benodigd (A*muur+B, min)</div><div>Actie</div>
      </div>
    `;

    const rows = [head];

    // Filter + berekening
    const list = [];
    if (keys.length){
      keys.forEach(k=>{
        const e = map[k]; if (!e || typeof e.wall!=='number') return;
        if (plan.onlyWalls>0 && e.wall<=0) return;
        if (e.wall < plan.minWall) return;

        const [x,y] = k.split('|').map(Number);
        const item = {x,y, wall:e.wall, id:e.id||null};
        item.dist = my ? +dist(my,item).toFixed(2) : null;
        if (my && plan.maxRadius && item.dist!=null && item.dist>plan.maxRadius) return;

        // dynamische formule
        const r = Math.max(0, Math.round(plan.A * e.wall + plan.B));
        item.needRams = Math.max(plan.minRams, r);
        item.needSpy  = Math.max(0, ~~plan.spies);

        list.push(item);
      });

      list.sort((a,b)=>{
        if ((a.dist??999)!==(b.dist??999)) return (a.dist??999)-(b.dist??999);
        return b.wall-a.wall;
      });
    }

    // Rijen
    const vid = getParam(location.href,'village') || '';
    list.forEach(b=>{
      const coords = `${b.x}|${b.y}`;
      const tgt = b.id?('target='+b.id):('x='+b.x+'&y='+b.y);
      const url = `game.php?village=${vid}&screen=place&${tgt}&ram=${b.needRams}${b.needSpy?('&spy='+b.needSpy):''}`;

      rows.push(`
        <div style="display:grid;grid-template-columns:96px 56px 68px 1fr 160px;gap:6px;align-items:center;
          padding:6px 8px;border-bottom:1px dashed #c7a76a;">
          <div>[${coords}]</div>
          <div>Lv ${b.wall}</div>
          <div>${b.dist!=null?b.dist:'?'}</div>
          <div>${b.needRams} rammen + ${b.needSpy} scout</div>
          <div><a href="${url}" target="_blank" style="background:#b2773a;color:#fff;text-decoration:none;padding:4px 8px;border-radius:6px;display:inline-block;">Open place</a></div>
        </div>
      `);
    });

    const empty = list.length ? '' :
      `<div style="padding:8px 4px;color:#7a4b00">Geen doelen binnen je filters. Pas opties aan of scan nieuwe rapporten.</div>`;

    body.innerHTML = opts + empty + rows.join('');
    hookPlanner();

    function hookPlanner(){
      document.getElementById('pl-save').onclick = () => {
        const c = loadCfg();
        const p = c.planner;
        p.maxRadius = +document.getElementById('pl-maxR').value || p.maxRadius;
        p.minWall   = +document.getElementById('pl-minW').value || p.minWall;
        p.A         = +document.getElementById('pl-A').value     || p.A;
        p.B         = +document.getElementById('pl-B').value     || p.B;
        p.minRams   = +document.getElementById('pl-minR').value  || p.minRams;
        p.spies     = +document.getElementById('pl-spy').value   || p.spies;
        p.onlyWalls>0 = !!document.getElementById('pl-onlywalls').checked;
        saveCfg(c);
        renderPlanner();
      };
      document.getElementById('pl-plan').onclick = () => {
        // In Fase 1 is "plan" gelijk aan de preview (bulk berekend).
        // Fase 2 zal hier dorpen met rammen ophalen en bron-toewijzing doen.
        alert('Planning berekend op basis van je instellingen. Klik de “Open place”-knoppen om handmatig te verzenden.\n(Bron-dorp selectie komt in Fase 2.)');
      };
    }
  }

  // =============== Exporteer & init ===============
  window.__RamHelper__ = {
    open: () => renderPlanner() // start direct op Planner; wissel naar renderScanData() als je dat liever hebt
  };

  // Start op Planner-tab voor directe test
  renderPlanner();
})();
