(() => {
  // =========================
  // FarmManager v1.0 (NL)
  // Add-on voor FA: rammen toevoegen bij muur>0, legaal (geen auto-send)
  // =========================

  const APP = {
    VER: '1.0',
    KEYS: {
      cfg:   'FM_cfg',
      walls: 'FM_walls',   // { "489|480": {wall:3, loss:1, ts:...}, ... }
    },
    // selector helpers
    qs: (sel,root=document)=>root.querySelector(sel),
    qsa:(sel,root=document)=>Array.from(root.querySelectorAll(sel)),
  };

  // ---------- Config laden / opslaan ----------
  function defaultCfg() {
    // Conservatief: +4 rammen per muurniveau; je kunt dit in UI aanpassen.
    const wallMap = {1:8,2:12,3:16,4:20,5:24,6:28,7:32,8:36,9:40,10:44,11:48,12:52,13:56,14:60,15:64,16:68,17:72,18:76,19:80,20:84};
    return {
      enable: true,              // rammen automatisch toevoegen bij muur>0
      onlyOnLoss: true,          // standaard AAN: alleen bij verliezen
      baseRamsOnUnknown: 0,      // bij onbekende muur (we sturen dan geen extra rammen)
      margin: 0,                 // extra marge-rammen bovenop mapping
      wallMap,                   // mapping muurniveau -> rammen
      showStartup: false,        // geen alert bij starten
    };
  }
  function loadCfg(){
    try {
      return Object.assign(defaultCfg(), JSON.parse(localStorage.getItem(APP.KEYS.cfg)||'{}'));
    } catch(e){ return defaultCfg(); }
  }
  function saveCfg(cfg){ localStorage.setItem(APP.KEYS.cfg, JSON.stringify(cfg)); }

  // ---------- Walls store ----------
  function loadWalls(){
    try { return JSON.parse(localStorage.getItem(APP.KEYS.walls)||'{}'); }
    catch(e){ return {}; }
  }
  function saveWalls(m){ localStorage.setItem(APP.KEYS.walls, JSON.stringify(m)); }

  // ---------- Utils ----------
  const fmt = (n)=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

  // ---------------- UI balk boven FA ----------------
  function injectBar(){
    // Alleen op FA-pagina
    const isFA = /[?&]screen=am_farm\b/.test(location.search);
    if (!isFA) return;

    // Vermijd dubbele injectie
    if (APP.qs('#fm-bar')) return;

    const topBox = document.createElement('div');
    topBox.id = 'fm-bar';
    topBox.style.margin = '8px 0 10px';
    topBox.style.padding = '8px';
    topBox.style.border = '1px solid #c7a76a';
    topBox.style.background = '#fff7e8';
    topBox.style.borderRadius = '8px';

    const cfg = loadCfg();

    const wallInputs = [];
    function wallRow() {
      // maak compacte rij: Lv1..Lv10 (klikbare toggle voor 11..20)
      const mk = (lv) => {
        const val = cfg.wallMap[lv] ?? 0;
        return `<label style="display:flex;align-items:center;gap:4px;margin:2px 6px 2px 0;">
          <span style="width:28px;opacity:.8">Lv ${lv}</span>
          <input data-fm="w${lv}" type="number" min="0" value="${val}" style="width:64px">
        </label>`;
      };
      const first = Array.from({length:10},(_,i)=>mk(i+1)).join('');
      const more  = Array.from({length:10},(_,i)=>mk(i+11)).join('');
      return `
        <div style="margin-top:6px">
          <div style="display:flex;flex-wrap:wrap;gap:6px">${first}</div>
          <details style="margin-top:6px">
            <summary style="cursor:pointer;opacity:.8">Meer niveaus (11–20)</summary>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${more}</div>
          </details>
        </div>
      `;
    }

    topBox.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div><b>FarmManager</b> <span style="opacity:.6">v${APP.VER}</span></div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px">
            <input id="fm-enable" type="checkbox" ${cfg.enable?'checked':''}>
            Rammen bij muur &gt; 0
          </label>
          <label style="display:flex;align-items:center;gap:6px">
            <input id="fm-loss" type="checkbox" ${cfg.onlyOnLoss?'checked':''}>
            Alleen bij verliezen
          </label>
          <label title="Extra marge bovenop mapping (veiligheid)">
            +marge <input id="fm-margin" type="number" min="0" value="${cfg.margin}" style="width:60px">
          </label>
          <button id="fm-scan"  class="btn fm-btn" style="padding:4px 8px">Scan rapporten</button>
          <button id="fm-save"  class="btn fm-btn" style="padding:4px 8px">Opslaan</button>
        </div>
      </div>
      <div style="margin-top:6px;opacity:.9">
        <i>Bij klik op A/B opent FarmManager het aanvalsscherm met A/B + rammen (indien nodig). Jij bevestigt.</i>
      </div>
      <div id="fm-wallrow">${wallRow()}</div>
    `;
    const container = APP.qs('#content_value') || document.body;
    container.insertBefore(topBox, container.firstChild);

    // events
    APP.qs('#fm-save').onclick = () => {
      const c = loadCfg();
      c.enable = APP.qs('#fm-enable').checked;
      c.onlyOnLoss = APP.qs('#fm-loss').checked;
      c.margin = Math.max(0, +APP.qs('#fm-margin').value||0);
      // wall map
      for (let lv=1; lv<=20; lv++){
        const el = APP.qs(`[data-fm="w${lv}"]`);
        if (el) c.wallMap[lv] = Math.max(0, +el.value||0);
      }
      saveCfg(c);
      alert('FarmManager: instellingen opgeslagen.');
    };

    APP.qs('#fm-scan').onclick = async ()=> {
      await scanReports();
    };

    // inject FA hooks (hover/klik)
    hookFA();
  }

  // --------------- Rapport-scan (muur & verlies) ----------------
  async function scanReports() {
    // Werkt op twee plekken:
    // 1) rapporten-lijst (leest de links en bezoekt ze throttled)
    // 2) enkel rapport (leest direct)
    try {
      const url = new URL(location.href);
      const mode = url.searchParams.get('mode') || '';
      const screen = url.searchParams.get('screen') || '';
      let count = 0;

      if (screen==='report' && url.searchParams.get('view')) {
        const html = await (await fetch(location.href, {credentials:'same-origin'})).text();
        const got = parseReport(html);
        if (got && got.coords) {
          const db = loadWalls();
          db[got.coords] = {
            wall: typeof got.wall==='number' ? got.wall : (db[got.coords]?.wall ?? 0),
            loss: got.loss?1:0,
            ts: Date.now()
          };
          saveWalls(db);
          count=1;
        }
      } else {
        // probeer lijst (attack + spy modes)
        const links = APP.qsa('a[href*="screen=report"][href*="view="]');
        if (!links.length) {
          alert('Geen rapportlinks op deze pagina gevonden.\nOpen je rapportenlijst of een enkel rapport en klik opnieuw.');
          return;
        }
        const db = loadWalls();
        for (const a of links.slice(0,50)) { // throttle & limiet
          try{
            const html = await (await fetch(a.href, {credentials:'same-origin'})).text();
            const got = parseReport(html);
            if (got && got.coords) {
              db[got.coords] = {
                wall: typeof got.wall==='number' ? got.wall : (db[got.coords]?.wall ?? 0),
                loss: got.loss?1:0,
                ts: Date.now()
              };
              count++;
              await sleep(350+Math.random()*400);
            }
          }catch(e){/*ignore*/}
        }
        saveWalls(db);
      }
      alert(`FarmManager: scan klaar. Geüpdatet: ${count} rapport(en).`);
    } catch(e){
      alert('FarmManager: scanfout: '+(e&&e.message?e.message:e));
    }
  }

  function parseReport(html){
    const doc = new DOMParser().parseFromString(html,'text/html');
    const bodyText = (doc.body.innerText||'').replace(/\s+/g,' ');
    // muur
    let wall;
    // tafel "Gebouw / Level"
    const cells = APP.qsa('table td', doc);
    for (let i=0;i<cells.length;i++){
      const t = (cells[i].innerText||'').trim();
      if (/^(Muur|Wall)$/i.test(t)) {
        const v = (cells[i+1]?.innerText||'').trim();
        if (/^\d+$/.test(v)) { wall = parseInt(v,10); break; }
      }
    }
    if (wall===undefined){
      const m = bodyText.match(/Muur\s*:\s*(?:niveau\s*)?(\d+)|Wall\s*:\s*(?:level\s*)?(\d+)/i);
      if (m) wall = parseInt(m[1]||m[2],10);
    }
    // coords
    const mc = bodyText.match(/\b(\d{3})\|(\d{3})\b/);
    const coords = mc ? mc[1]+'|'+mc[2] : null;
    // verlies: check blok "Verliezen" of icons (simpel heuristiek)
    let loss = false;
    if (/Verliezen|Losses/i.test(bodyText)) {
      // als er ergens een niet-nul in verlieskolom staat is loss true; simpele benadering
      const m = bodyText.match(/Verliezen[^0-9]*(\d+)/i);
      loss = m ? (parseInt(m[1],10) > 0) : /verlies|verloren/i.test(bodyText);
    }
    return {coords, wall, loss};
  }

  // --------------- FA integratie: hover + klik ---------------
  function hookFA(){
    // Template A/B waarden lezen uit sjabloon (bovenin FA)
    const templates = readTemplates();
    if (!templates) return;

    // Hover: laat zien wat er gestuurd wordt (A/B + rammen)
    APP.qsa('#plunder_list tr').forEach(row=>{
      // A/B knoppen staan in de laatste kolommen met <a> of <span> met 'A'/'B'
      const abBtns = APP.qsa('td:last-child a, td:last-child span', row).filter(el=>/^[AB]$/.test(el.textContent.trim()));
      if (!abBtns.length) return;
      const coords = extractCoordsFromRow(row);
      if (!coords) return;

      abBtns.forEach(btn=>{
        btn.addEventListener('mouseenter', ()=>{
          const mode = btn.textContent.trim(); // 'A' of 'B'
          const comp = computeCompositionFor(coords, mode, templates);
          btn.title = comp.title; // native tooltip
        });

        // Klik intercept: als extra rammen nodig → open PLACE met samengestelde units
        btn.addEventListener('click', (ev)=>{
          const mode = btn.textContent.trim();
          const comp = computeCompositionFor(coords, mode, templates);
          if (comp.addRams>0) {
            ev.preventDefault();
            openPlaceForRow(row, coords, comp.units);
          } // else: laat default FA-flow doorgaan (server-side A/B)
        }, true);
      });
    });
  }

  function readTemplates(){
    // FA sjabloon tabel staat bovenaan; lees inputs per unit voor A-rij en B-rij
    const table = APP.qs('table:has(tr td input)'); // ruwe heuristiek
    if (!table) return null;

    // units volgorde zoals FA ze toont (kan per wereld verschillen; we lezen aan de hand van name attr)
    const unitNames = ['spear','sword','axe','archer','spy','light','heavy','marcher','ram','catapult','knight','snob'];
    function readRow(row){
      const obj={};
      APP.qsa('input', row).forEach(inp=>{
        // name bevat unitnaam of FA gebruikt data-unit—pak value
        const val = Math.max(0, +inp.value||0);
        const nm = inferUnitName(inp) || '';
        if (nm) obj[nm]=val;
      });
      return obj;
    }
    const rows = APP.qsa('tr', table);
    const rowA = rows.find(r=>/^\s*A\s*$/.test(APP.qs('td',r)?.textContent||'')) || rows[0];
    const rowB = rows.find(r=>/^\s*B\s*$/.test(APP.qs('td',r)?.textContent||'')) || rows[1];

    const A = readRow(rowA);
    const B = readRow(rowB);
    return {A,B,unitNames};
  }
  function inferUnitName(inp){
    const nm = inp.name||'';
    // nm lijkt op "template[light]" of "light" etc.
    const m = nm.match(/(spear|sword|axe|archer|spy|light|heavy|marcher|ram|catapult|knight|snob)/);
    return m?m[1]:null;
  }

  function extractCoordsFromRow(row){
    // FA tabel bevat "Doel" kolom met "xxx|yyy"
    const txt = row.innerText||'';
    const m = txt.match(/\b(\d{3})\|(\d{3})\b/);
    return m ? (m[1]+'|'+m[2]) : null;
  }

  // Bepaal uiteindelijke units: A/B + (eventueel) extra rammen
  function computeCompositionFor(coords, mode, templates){
    const cfg = loadCfg();
    const walls = loadWalls();
    const wrec = walls[coords] || {wall:0, loss:0};

    // basis: A of B
    const base = JSON.parse(JSON.stringify(templates[mode==='A'?'A':'B']||{}));

    // mogen we rammen toevoegen?
    let addRams = 0;
    if (cfg.enable) {
      const wall = wrec.wall||0;
      const hadLoss = !!wrec.loss;
      const needByLoss = (!cfg.onlyOnLoss) || (cfg.onlyOnLoss && hadLoss);
      if (wall>0 && needByLoss) {
        addRams = (cfg.wallMap[wall]||0) + (cfg.margin||0);
      }
    }

    // voeg rammen toe
    if (addRams>0) {
      base.ram = Math.max(0, (+base.ram||0) + addRams);
    }

    // Beschrijfbaar voor hover
    const parts = [];
    const order = ['spy','light','axe','spear','sword','heavy','archer','marcher','ram','catapult'];
    order.forEach(u=>{
      const v = +base[u]||0;
      if (v>0) parts.push(`${u}: ${v}`);
    });
    const title = parts.length ? `Stuurt: ${parts.join(', ')}` : 'Stuurt: (geen)';

    return {units: base, title, addRams};
  }

  // Open PLACE met samengestelde units (veilig: jij bevestigt handmatig)
  function openPlaceForRow(row, coords, units){
    // Vind village-id van huidige dorp uit URL
    const url = new URL(location.href);
    const vid = url.searchParams.get('village')||'';

    const [x,y] = coords.split('|').map(Number);
    // bouw query
    const params = new URLSearchParams();
    params.set('village', vid);
    params.set('screen', 'place');
    params.set('x', x);
    params.set('y', y);

    // units invullen
    const map = {
      spear:'spear',
      sword:'sword',
      axe:'axe',
      archer:'archer',
      spy:'spy',
      light:'light',
      heavy:'heavy',
      marcher:'marcher',
      ram:'ram',
      catapult:'catapult',
      knight:'knight',
      snob:'snob'
    };
    Object.keys(map).forEach(k=>{
      const v = +units[k]||0;
      if (v>0) params.set(map[k], String(v));
    });

    // open in nieuw tabblad
    const href = 'game.php?'+params.toString();
    window.open(href, '_blank');
  }

  // ----------------- init -----------------
  function init(){
    // UI bar alleen op FA
    injectBar();
    // waarschuwing (eenmalig) optioneel
    const cfg = loadCfg();
    if (cfg.showStartup) alert('FarmManager geladen. Dit script vult velden; jij bevestigt zelf het versturen.');
  }

  // Exporteer
  window.__FarmManager__ = { init };

  // Autostart als we al op FA staan
  if (/[?&]screen=am_farm\b/.test(location.search)) init();

})();
