(() => {
  'use strict';

  // --------------------
  // Util
  // --------------------
  const $ = (q, el=document) => el.querySelector(q);
  const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));

  const DEFAULT_CLASSES = [
    'Imobiliário','Liquidez','Ações','ETFs','Fundos','PPR','Depósitos a prazo','Ouro','Prata','Arte','Cripto','Outros'
  ];

  const STORAGE_KEY = 'pf_state_v12';

  const nowISO = () => new Date().toISOString();
  const ym = (d=new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const fmtMoney = (v, cur) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    try {
      return new Intl.NumberFormat('pt-PT', { style:'currency', currency: cur || 'EUR', maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${Math.round(n)} ${cur||'EUR'}`;
    }
  };

  const fmtPct = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return `${n.toFixed(1)}%`;
  };

  const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

  const safeParse = (s, fallback=null) => {
    try { return JSON.parse(s); } catch { return fallback; }
  };

  // --------------------
  // State
  // --------------------
  const defaultState = () => ({
    version: 12,
    settings: {
      currency: 'EUR',
      taxRate: 28,
      passcodeHash: null, // SHA-256 hex
      locked: false,
    },
    assets: [],
    liabilities: [],
    snapshots: [], // { ym, assetsTotal, liabilitiesTotal, netWorth, passiveGrossAnnual, passiveNetAnnual }
    cashflow: [], // [{ ym, income:[{id,who,cat,amt,note}], expenses:[{id,cat,amt,note}] }]
    bankMoves: [] // [{id,date,desc,amount,cat,ym}]
  });

  let state = load();

  function load(){
    const raw = localStorage.getItem(STORAGE_KEY);
    const st = raw ? safeParse(raw, null) : null;
    if (!st || typeof st !== 'object') return defaultState();
    // minimal migrations
    const base = defaultState();
    const merged = {
      ...base,
      ...st,
      settings: { ...base.settings, ...(st.settings||{}) },
      assets: Array.isArray(st.assets)? st.assets : [],
      liabilities: Array.isArray(st.liabilities)? st.liabilities : [],
      snapshots: Array.isArray(st.snapshots)? st.snapshots : [],
      cashflow: Array.isArray(st.cashflow)? st.cashflow : [],
      bankMoves: Array.isArray(st.bankMoves)? st.bankMoves : [],
    };
    return merged;
  }

  function save(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // --------------------
  // Error trap (visible)
  // --------------------
  function showError(err){
    try{
      console.error(err);
      const card = $('#debugCard');
      const txt = $('#debugText');
      if (!card || !txt) return;
      card.hidden = false;
      txt.textContent = String(err?.stack || err?.message || err);
      // force switch to settings to show
      goView('Settings');
    }catch(_){ /* ignore */ }
  }

  window.addEventListener('error', (e) => showError(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => showError(e.reason || e));

  // --------------------
  // Crypto (hash)
  // --------------------
  async function sha256Hex(text){
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    const arr = Array.from(new Uint8Array(buf));
    return arr.map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  // --------------------
  // Derived
  // --------------------
  function totals(){
    const assetsTotal = state.assets.reduce((s,a)=>s + (Number(a.value)||0), 0);
    const liabilitiesTotal = state.liabilities.reduce((s,a)=>s + (Number(a.value)||0), 0);
    const netWorth = assetsTotal - liabilitiesTotal;
    const passiveGrossAnnual = state.assets.reduce((s,a)=>s + calcPassiveAnnualGross(a), 0);
    const tax = clamp((Number(state.settings.taxRate)||0)/100, 0, 0.9);
    const passiveNetAnnual = passiveGrossAnnual * (1 - tax);
    return { assetsTotal, liabilitiesTotal, netWorth, passiveGrossAnnual, passiveNetAnnual };
  }

  function calcPassiveAnnualGross(item){
    const value = Number(item.value)||0;
    const t = item.incomeType || 'none';
    const iv = Number(item.incomeValue)||0;
    if (!value || !iv) {
      // rent can be without value
      if (t === 'rent') return (Number(item.incomeValue)||0) * 12;
      return 0;
    }
    if (t === 'div_yield') return value * (iv/100);
    if (t === 'div_amount') return iv;
    if (t === 'rate') return value * (iv/100);
    if (t === 'rent') return iv * 12;
    return 0;
  }

  function groupByClass(items){
    const m = new Map();
    for(const it of items){
      const c = it.class || 'Outros';
      const v = Number(it.value)||0;
      m.set(c, (m.get(c)||0) + v);
    }
    return Array.from(m.entries()).map(([k,v])=>({k,v})).sort((a,b)=>b.v-a.v);
  }

  function sortedAssets(){
    return [...state.assets].sort((a,b)=>(Number(b.value)||0)-(Number(a.value)||0));
  }

  // --------------------
  // Views
  // --------------------
  const VIEW_IDS = {
    Dashboard: 'viewDashboard',
    Assets: 'viewAssets',
    Import: 'viewImport',
    Cashflow: 'viewCashflow',
    Settings: 'viewSettings',
    Lock: 'viewLock'
  };

  function goView(name){
    const isLocked = !!state.settings.locked;
    const target = isLocked && name !== 'Lock' ? 'Lock' : name;

    for(const [k,id] of Object.entries(VIEW_IDS)){
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.toggle('view--active', k === target);
      el.style.display = (k === target) ? 'block' : 'none';
    }

    $$('.bottomnav .tab').forEach(btn=>{
      const v = btn.dataset.view;
      btn.classList.toggle('tab--active', v === target);
    });

    // render per view
    if (target === 'Dashboard') renderDashboard();
    if (target === 'Assets') renderAssets();
    if (target === 'Cashflow') renderCashflow();
    if (target === 'Settings') renderSettings();
  }

  // --------------------
  // Charts (pure SVG)
  // --------------------
  function svgEl(name, attrs={}){
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    for(const [k,v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }

  function renderDonut(el, data, opts={}){
    // data: [{label, value, color}]
    el.innerHTML = '';
    const w = opts.size || 220;
    const h = opts.size || 220;
    const r = (w/2) - 14;
    const rIn = r - 18;

    const total = data.reduce((s,d)=>s+d.value,0) || 1;
    let a0 = -Math.PI/2;

    const svg = svgEl('svg', { viewBox:`0 0 ${w} ${h}`, width:'100%', height:'auto' });

    // base ring
    const base = svgEl('circle', { cx:w/2, cy:h/2, r:r-9, fill:'none', stroke:'rgba(255,255,255,.10)', 'stroke-width':18 });
    svg.appendChild(base);

    for(const d of data){
      const frac = d.value/total;
      const a1 = a0 + frac*2*Math.PI;
      const x0 = w/2 + r*Math.cos(a0);
      const y0 = h/2 + r*Math.sin(a0);
      const x1 = w/2 + r*Math.cos(a1);
      const y1 = h/2 + r*Math.sin(a1);
      const large = frac > 0.5 ? 1 : 0;
      const path = svgEl('path', {
        d: `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`,
        fill:'none',
        stroke: d.color,
        'stroke-width': 18,
        'stroke-linecap':'round'
      });
      svg.appendChild(path);
      a0 = a1;
    }

    // inner cut
    const hole = svgEl('circle', { cx:w/2, cy:h/2, r:rIn, fill:'rgba(11,18,32,.92)', stroke:'rgba(255,255,255,.06)' });
    svg.appendChild(hole);

    const t1 = svgEl('text', { x:w/2, y:h/2-4, 'text-anchor':'middle', 'font-size':'12', fill:'rgba(232,238,252,.65)', 'font-weight':'700' });
    t1.textContent = opts.centerLabel || 'Ativos';
    svg.appendChild(t1);

    const t2 = svgEl('text', { x:w/2, y:h/2+18, 'text-anchor':'middle', 'font-size':'18', fill:'#e8eefc', 'font-weight':'900' });
    t2.textContent = opts.centerValue || '';
    svg.appendChild(t2);

    el.appendChild(svg);
  }

  function renderLine(el, series, opts={}){
    // series: [{xLabel, y}] ordered
    el.innerHTML = '';
    const w = opts.width || 680;
    const h = opts.height || 220;
    const pad = 26;

    const ys = series.map(p=>p.y);
    const minY = Math.min(...ys, 0);
    const maxY = Math.max(...ys, 1);
    const span = (maxY - minY) || 1;

    const svg = svgEl('svg', { viewBox:`0 0 ${w} ${h}`, width:'100%', height:'auto' });

    // grid lines
    for(let i=0;i<5;i++){
      const y = pad + i*(h-2*pad)/4;
      svg.appendChild(svgEl('line', { x1:pad, y1:y, x2:w-pad, y2:y, stroke:'rgba(255,255,255,.06)', 'stroke-width':1 }));
    }

    const pts = series.map((p,i)=>{
      const x = pad + (series.length===1?0.5:i/(series.length-1))*(w-2*pad);
      const y = h - pad - ((p.y - minY)/span)*(h-2*pad);
      return {x,y};
    });

    const d = pts.map((p,i)=>`${i?'L':'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    const path = svgEl('path', { d, fill:'none', stroke:'rgba(88,193,255,.92)', 'stroke-width':3, 'stroke-linecap':'round', 'stroke-linejoin':'round' });
    svg.appendChild(path);

    // points
    pts.forEach(p=>{
      svg.appendChild(svgEl('circle',{cx:p.x,cy:p.y,r:4,fill:'rgba(155,140,255,.92)',stroke:'rgba(0,0,0,.35)','stroke-width':1}));
    });

    // x labels (first + last)
    if(series.length>=1){
      const first = series[0].xLabel;
      const last = series[series.length-1].xLabel;
      const tx1 = svgEl('text',{x:pad,y:h-8,'text-anchor':'start','font-size':'12',fill:'rgba(232,238,252,.55)','font-weight':'700'});
      tx1.textContent = first;
      svg.appendChild(tx1);
      const tx2 = svgEl('text',{x:w-pad,y:h-8,'text-anchor':'end','font-size':'12',fill:'rgba(232,238,252,.55)','font-weight':'700'});
      tx2.textContent = last;
      svg.appendChild(tx2);
    }

    // empty label
    if(series.length===0){
      const t = svgEl('text',{x:w/2,y:h/2,'text-anchor':'middle','font-size':'13',fill:'rgba(232,238,252,.55)','font-weight':'800'});
      t.textContent = opts.empty || 'Sem histórico.';
      svg.appendChild(t);
    }

    el.appendChild(svg);
  }

  // --------------------
  // Render
  // --------------------
  let passiveMode = 'net';

  function renderDashboard(){
    const cur = state.settings.currency;
    const t = totals();

    $('#netWorth').textContent = fmtMoney(t.netWorth, cur);
    $('#netWorthSub').textContent = `Ativos ${fmtMoney(t.assetsTotal,cur)} | Passivos ${fmtMoney(t.liabilitiesTotal,cur)}`;

    const passiveShown = (passiveMode==='gross') ? t.passiveGrossAnnual : t.passiveNetAnnual;
    $('#passiveAnnual').textContent = fmtMoney(passiveShown, cur);
    $('#passiveMonthly').textContent = fmtMoney(passiveShown/12, cur);

    // distribution donut
    const grouped = groupByClass(state.assets).filter(x=>x.v>0);
    const colors = palette(grouped.length);
    const donutData = grouped.map((g,i)=>({label:g.k,value:g.v,color:colors[i]}));

    renderDonut($('#donutWrap'), donutData, {
      size: 240,
      centerLabel: 'Ativos',
      centerValue: fmtMoney(t.assetsTotal, cur)
    });

    // legend
    const leg = $('#distLegend');
    leg.innerHTML = '';
    const totalA = t.assetsTotal || 1;
    grouped.slice(0,6).forEach((g,i)=>{
      const row = document.createElement('div');
      row.className = 'legrow';
      const left = document.createElement('div');
      left.style.display='flex';
      left.style.alignItems='center';
      left.style.gap='8px';
      const dot = document.createElement('div');
      dot.className='dot';
      dot.style.background = colors[i];
      const name = document.createElement('div');
      name.style.fontWeight='800';
      name.style.fontSize='13px';
      name.textContent = g.k;
      left.appendChild(dot); left.appendChild(name);

      const right = document.createElement('div');
      right.style.color='rgba(232,238,252,.70)';
      right.style.fontWeight='900';
      right.style.fontSize='13px';
      right.textContent = `${Math.round((g.v/totalA)*100)}%`;

      row.appendChild(left); row.appendChild(right);
      leg.appendChild(row);
    });

    // dist detail list
    const det = $('#distDetailList');
    det.innerHTML='';
    grouped.forEach((g,i)=>{
      det.appendChild(listRow(g.k, `${fmtMoney(g.v,cur)} · ${Math.round((g.v/totalA)*100)}%`, colors[i]));
    });

    // trends
    const snaps = [...state.snapshots].sort((a,b)=>a.ym.localeCompare(b.ym));
    renderLine($('#nwTrend'), snaps.map(s=>({xLabel:s.ym,y:Number(s.netWorth)||0})), { empty: 'Sem histórico. Clica em “Registar mês”.' });

    const piKey = passiveMode==='gross' ? 'passiveGrossAnnual' : 'passiveNetAnnual';
    renderLine($('#piTrend'), snaps.map(s=>({xLabel:s.ym,y:Number(s[piKey])||0})), { empty: 'Sem histórico. Clica em “Registar mês”.' });

    // top 10
    const top = sortedAssets();
    const top10 = top.slice(0,10);
    const topList = $('#topList');
    topList.innerHTML='';
    top10.forEach(a=> topList.appendChild(assetRow(a, cur)));

    const all = $('#allAssetsList');
    all.innerHTML='';
    top.slice(10).forEach(a=> all.appendChild(assetRow(a, cur)));

    // hide "ver tudo" if <=10
    const btn = $('[data-action="toggle-top"]');
    if (btn) btn.style.display = (top.length>10) ? 'inline-flex' : 'none';
  }

  function renderAssets(){
    // filter options
    const sel = $('#assetFilter');
    const classes = allClasses();
    sel.innerHTML = '<option value="">Todas as classes</option>' + classes.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

    const q = ($('#assetSearch').value||'').toLowerCase().trim();
    const f = sel.value;

    const filtered = state.assets
      .filter(a => !f || (a.class===f))
      .filter(a => !q || (String(a.name||'').toLowerCase().includes(q) || String(a.notes||'').toLowerCase().includes(q)) )
      .sort((a,b)=>(Number(b.value)||0)-(Number(a.value)||0));

    const favs = filtered.filter(a=>!!a.favorite);
    const rest = filtered.filter(a=>!a.favorite);

    const cur = state.settings.currency;

    const favList = $('#favList');
    favList.innerHTML='';
    if (favs.length===0) favList.appendChild(emptyRow('Sem favoritos. Marca ★ num ativo.'));
    favs.forEach(a=>favList.appendChild(assetRow(a, cur, true)));

    const list = $('#assetList');
    list.innerHTML='';
    if (rest.length===0) list.appendChild(emptyRow('Sem ativos para mostrar.'));
    rest.forEach(a=>list.appendChild(assetRow(a, cur, true)));

    const liab = $('#liabList');
    liab.innerHTML='';
    const liabs = [...state.liabilities].sort((a,b)=>(Number(b.value)||0)-(Number(a.value)||0));
    if (liabs.length===0) liab.appendChild(emptyRow('Sem passivos.'));
    liabs.forEach(l=>liab.appendChild(liabRow(l, cur)));
  }

  function renderCashflow(){
    ensureMonthExists(ym());

    const picker = $('#monthPick');
    const months = [...new Set(state.cashflow.map(m=>m.ym))].sort();
    picker.innerHTML = months.map(m=>`<option value="${m}">${m}</option>`).join('');
    if (!picker.value) picker.value = months[months.length-1];

    const m = getMonth(picker.value);

    // KPIs
    const inc = m.income.reduce((s,x)=>s+(Number(x.amt)||0),0);
    const exp = m.expenses.reduce((s,x)=>s+(Number(x.amt)||0),0);
    const res = inc - exp;

    const k = $('#cfKpis');
    k.innerHTML='';
    k.appendChild(kpi('Entradas', fmtMoney(inc, state.settings.currency)));
    k.appendChild(kpi('Despesas', fmtMoney(exp, state.settings.currency)));
    k.appendChild(kpi('Resultado', fmtMoney(res, state.settings.currency)));

    // lists
    const inL = $('#incomeList');
    inL.innerHTML='';
    if (m.income.length===0) inL.appendChild(emptyRow('Sem entradas neste mês.'));
    m.income.forEach(x=>inL.appendChild(cfRow(x, 'income')));

    const exL = $('#expenseList');
    exL.innerHTML='';
    if (m.expenses.length===0) exL.appendChild(emptyRow('Sem despesas neste mês.'));
    m.expenses.forEach(x=>exL.appendChild(cfRow(x, 'expense')));

    // annual trend (last 12)
    const ordered = [...state.cashflow].sort((a,b)=>a.ym.localeCompare(b.ym));
    const last12 = ordered.slice(-12);
    const series = last12.map(mm=>{
      const i = mm.income.reduce((s,x)=>s+(Number(x.amt)||0),0);
      const e = mm.expenses.reduce((s,x)=>s+(Number(x.amt)||0),0);
      return {xLabel:mm.ym, y:i-e};
    });
    renderLine($('#cfTrend'), series, { empty: 'Sem histórico de balanço.' });
  }

  function renderSettings(){
    $('#baseCurrency').value = state.settings.currency || 'EUR';
    $('#taxRate').value = Number(state.settings.taxRate ?? 28);

    const st = $('#lockState');
    if (state.settings.passcodeHash) {
      st.textContent = state.settings.locked ? 'Bloqueado' : 'Desbloqueado';
    } else {
      st.textContent = 'Sem código';
    }
  }

  // --------------------
  // UI helpers
  // --------------------
  function palette(n){
    // deterministic nice palette
    const base = [
      '#35d08d','#58c1ff','#9b8cff','#f6c25b','#ff6b6b','#a3b3c9','#6ee7b7','#60a5fa','#c4b5fd','#f59e0b','#fb7185','#93c5fd'
    ];
    const out = [];
    for(let i=0;i<n;i++) out.push(base[i % base.length]);
    return out;
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function listRow(title, sub, color){
    const el = document.createElement('div');
    el.className='item';
    el.innerHTML = `
      <div class="item__left">
        <div class="item__title">${escapeHtml(title)}</div>
        <div class="item__sub">${escapeHtml(sub)}</div>
      </div>
      <div class="item__right">
        <span class="badge"><span class="dot" style="background:${color||'rgba(255,255,255,.4)'}"></span></span>
      </div>
    `;
    return el;
  }

  function emptyRow(text){
    const el = document.createElement('div');
    el.className='item';
    el.innerHTML = `<div class="item__left"><div class="item__sub">${escapeHtml(text)}</div></div>`;
    return el;
  }

  function assetRow(a, cur, editable=false){
    const el = document.createElement('div');
    el.className='item';
    el.dataset.id = a.id;
    el.dataset.kind = 'asset';
    const tag = a.class || 'Outros';
    const passive = calcPassiveAnnualGross(a);
    const ptxt = passive>0 ? ` · passivo ${fmtMoney(passive*(1-clamp((Number(state.settings.taxRate)||0)/100,0,0.9)),cur)}/ano (líq.)` : '';
    el.innerHTML = `
      <div class="item__left">
        <div class="item__title">${escapeHtml(a.name||'Sem nome')} ${a.favorite?'★':''}</div>
        <div class="item__sub">${escapeHtml(tag)}${ptxt}</div>
      </div>
      <div class="item__right">
        <div class="item__val">${fmtMoney(a.value,cur)}</div>
        ${editable?`<div class="item__tag"><button class="btn btn--text" data-action="edit" data-id="${a.id}" data-kind="asset">Editar</button></div>`:''}
      </div>
    `;
    return el;
  }

  function liabRow(l, cur){
    const el = document.createElement('div');
    el.className='item';
    el.dataset.id = l.id;
    el.dataset.kind = 'liability';
    el.innerHTML = `
      <div class="item__left">
        <div class="item__title">${escapeHtml(l.name||'Passivo')}</div>
        <div class="item__sub">${escapeHtml(l.class||'Passivo')}</div>
      </div>
      <div class="item__right">
        <div class="item__val">${fmtMoney(l.value,cur)}</div>
        <div class="item__tag"><button class="btn btn--text" data-action="edit" data-id="${l.id}" data-kind="liability">Editar</button></div>
      </div>
    `;
    return el;
  }

  function kpi(label, value){
    const el = document.createElement('div');
    el.className='kpi';
    el.innerHTML = `<div class="kpi__lab">${escapeHtml(label)}</div><div class="kpi__val">${escapeHtml(value)}</div>`;
    return el;
  }

  function cfRow(x, kind){
    const el = document.createElement('div');
    el.className='item';
    const title = (kind==='income') ? (x.who?`${x.who} — ${x.cat||'Entrada'}`:(x.cat||'Entrada')) : (x.cat||'Despesa');
    el.innerHTML = `
      <div class="item__left">
        <div class="item__title">${escapeHtml(title)}</div>
        <div class="item__sub">${escapeHtml(x.note||'')}</div>
      </div>
      <div class="item__right">
        <div class="item__val">${fmtMoney(x.amt, state.settings.currency)}</div>
        <div class="item__tag"><button class="btn btn--text" data-action="edit-cf" data-kind="${kind}" data-id="${x.id}">Editar</button></div>
      </div>
    `;
    return el;
  }

  // --------------------
  // Months
  // --------------------
  function ensureMonthExists(ymStr){
    if (!state.cashflow.some(m=>m.ym===ymStr)){
      state.cashflow.push({ ym: ymStr, income: [], expenses: [] });
      save();
    }
  }

  function getMonth(ymStr){
    ensureMonthExists(ymStr);
    return state.cashflow.find(m=>m.ym===ymStr);
  }

  // --------------------
  // Classes
  // --------------------
  function allClasses(){
    const set = new Set(DEFAULT_CLASSES);
    for(const a of state.assets) if (a.class) set.add(a.class);
    for(const l of state.liabilities) if (l.class) set.add(l.class);
    return Array.from(set);
  }

  // --------------------
  // Modal
  // --------------------
  function openModal(title, html){
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modal').setAttribute('aria-hidden','false');
  }
  function closeModal(){
    $('#modal').setAttribute('aria-hidden','true');
    $('#modalBody').innerHTML = '';
  }

  function assetForm(kind, item){
    const classes = allClasses();
    const isAsset = kind==='asset';
    const name = item?.name || '';
    const cls = item?.class || (isAsset ? 'ETFs' : 'Passivo');
    const value = item?.value ?? '';
    const incomeType = item?.incomeType || 'none';
    const incomeValue = item?.incomeValue ?? '';
    const favorite = !!item?.favorite;
    const notes = item?.notes || '';

    const incomeBlock = isAsset ? `
      <div class="row row--wrap">
        <div class="field">
          <div class="label">Rendimento passivo</div>
          <select class="select" id="f_incomeType">
            <option value="none">Sem rendimento</option>
            <option value="div_yield">Dividendos (%/ano)</option>
            <option value="div_amount">Dividendos (€ / ano)</option>
            <option value="rate">Taxa (%/ano)</option>
            <option value="rent">Renda (€/mês)</option>
          </select>
        </div>
        <div class="field">
          <div class="label">Valor do rendimento</div>
          <input class="input" id="f_incomeValue" type="number" step="0.01" value="${escapeHtml(incomeValue)}" placeholder="ex: 3.2">
          <div class="hint">Consoante o tipo escolhido.</div>
        </div>
      </div>
      <div class="row">
        <label class="hint" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="f_fav" ${favorite?'checked':''}> Favorito</label>
      </div>
    ` : '';

    return `
      <form id="editForm" class="stack">
        <input type="hidden" id="f_id" value="${escapeHtml(item?.id||'')}">
        <input type="hidden" id="f_kind" value="${escapeHtml(kind)}">

        <div class="row row--wrap">
          <div class="field">
            <div class="label">Classe</div>
            <select class="select" id="f_class">
              ${classes.map(c=>`<option value="${escapeHtml(c)}" ${c===cls?'selected':''}>${escapeHtml(c)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <div class="label">Nome</div>
            <input class="input" id="f_name" value="${escapeHtml(name)}" placeholder="ex: VWCE, Casa, BTC, Depósito X" required>
          </div>
        </div>

        <div class="row row--wrap">
          <div class="field">
            <div class="label">Valor (${escapeHtml(state.settings.currency)})</div>
            <input class="input" id="f_value" type="number" step="0.01" value="${escapeHtml(value)}" placeholder="ex: 12500" required>
            <div class="hint">Passivos: valor positivo = dívida (subtrai ao património).</div>
          </div>
        </div>

        ${incomeBlock}

        <div class="row row--wrap">
          <div class="field">
            <div class="label">Notas</div>
            <input class="input" id="f_notes" value="${escapeHtml(notes)}" placeholder="opcional">
          </div>
        </div>

        <div class="row">
          <button class="btn btn--primary" type="submit">Guardar</button>
          ${item?.id?`<button class="btn btn--danger" type="button" data-action="delete-item" data-kind="${kind}" data-id="${item.id}">Eliminar</button>`:''}
        </div>
      </form>
    `;
  }

  function cfForm(kind, item, ymStr){
    const isIncome = kind==='income';
    const who = item?.who || (isIncome?'Pedro':'');
    const cat = item?.cat || (isIncome?'Salário':'Renda/Crédito');
    const amt = item?.amt ?? '';
    const note = item?.note || '';

    const whoBlock = isIncome ? `
      <div class="field">
        <div class="label">Origem</div>
        <select class="select" id="cf_who">
          <option value="Pedro" ${who==='Pedro'?'selected':''}>Pedro</option>
          <option value="Esposa" ${who==='Esposa'?'selected':''}>Esposa</option>
          <option value="Outros" ${who==='Outros'?'selected':''}>Outros</option>
        </select>
      </div>
    ` : '';

    return `
      <form id="cfForm" class="stack">
        <input type="hidden" id="cf_kind" value="${escapeHtml(kind)}">
        <input type="hidden" id="cf_id" value="${escapeHtml(item?.id||'')}">
        <input type="hidden" id="cf_ym" value="${escapeHtml(ymStr)}">

        <div class="row row--wrap">
          ${whoBlock}
          <div class="field">
            <div class="label">Categoria</div>
            <input class="input" id="cf_cat" value="${escapeHtml(cat)}" placeholder="ex: Salário, Renda, Alimentação" required>
          </div>
        </div>

        <div class="row row--wrap">
          <div class="field">
            <div class="label">Montante (${escapeHtml(state.settings.currency)})</div>
            <input class="input" id="cf_amt" type="number" step="0.01" value="${escapeHtml(amt)}" required>
          </div>
          <div class="field">
            <div class="label">Nota</div>
            <input class="input" id="cf_note" value="${escapeHtml(note)}" placeholder="opcional">
          </div>
        </div>

        <div class="row">
          <button class="btn btn--primary" type="submit">Guardar</button>
          ${item?.id?`<button class="btn btn--danger" type="button" data-action="delete-cf" data-kind="${kind}" data-id="${item.id}">Eliminar</button>`:''}
        </div>
      </form>
    `;
  }

  // --------------------
  // Actions
  // --------------------
  async function handleAction(action, target){
    const cur = state.settings.currency;

    if (action === 'add-asset'){
      openModal('Adicionar ativo', assetForm('asset', null));
      return;
    }
    if (action === 'add-liability'){
      openModal('Adicionar passivo', assetForm('liability', null));
      return;
    }
    if (action === 'snapshot'){
      const t = totals();
      const m = ym();
      const i = state.snapshots.findIndex(s=>s.ym===m);
      const snap = {
        ym: m,
        assetsTotal: t.assetsTotal,
        liabilitiesTotal: t.liabilitiesTotal,
        netWorth: t.netWorth,
        passiveGrossAnnual: t.passiveGrossAnnual,
        passiveNetAnnual: t.passiveNetAnnual,
        ts: nowISO()
      };
      if (i>=0) state.snapshots[i] = snap; else state.snapshots.push(snap);
      save();
      renderDashboard();
      return;
    }
    if (action === 'toggle-dist'){
      const box = $('#distDetail');
      box.hidden = !box.hidden;
      return;
    }
    if (action === 'toggle-top'){
      const box = $('#topAll');
      const btn = $('[data-action="toggle-top"]');
      box.hidden = !box.hidden;
      if (btn) btn.textContent = box.hidden ? 'Ver tudo' : 'Esconder';
      return;
    }
    if (action === 'clear-snapshots'){
      state.snapshots = [];
      save();
      renderDashboard();
      return;
    }
    if (action === 'edit'){
      const id = target.dataset.id;
      const kind = target.dataset.kind;
      const item = (kind==='asset') ? state.assets.find(x=>x.id===id) : state.liabilities.find(x=>x.id===id);
      openModal(kind==='asset'?'Editar ativo':'Editar passivo', assetForm(kind, item||null));
      return;
    }
    if (action === 'delete-item'){
      const id = target.dataset.id;
      const kind = target.dataset.kind;
      if (kind==='asset') state.assets = state.assets.filter(x=>x.id!==id);
      if (kind==='liability') state.liabilities = state.liabilities.filter(x=>x.id!==id);
      save();
      closeModal();
      renderDashboard();
      renderAssets();
      return;
    }
    if (action === 'close-modal'){
      closeModal();
      return;
    }
    if (action === 'export-json'){
      const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
      downloadBlob(blob, `patrimonio-familiar-backup_${ym()}.json`);
      return;
    }
    if (action === 'import-json'){
      const f = $('#fileJSON').files?.[0];
      if (!f) return alert('Escolhe um ficheiro JSON primeiro.');
      const text = await f.text();
      const parsed = safeParse(text, null);
      if (!parsed) return alert('JSON inválido.');
      state = {
        ...defaultState(),
        ...parsed,
        settings: { ...defaultState().settings, ...(parsed.settings||{}) },
        assets: Array.isArray(parsed.assets)?parsed.assets:[],
        liabilities: Array.isArray(parsed.liabilities)?parsed.liabilities:[],
        snapshots: Array.isArray(parsed.snapshots)?parsed.snapshots:[],
        cashflow: Array.isArray(parsed.cashflow)?parsed.cashflow:[],
        bankMoves: Array.isArray(parsed.bankMoves)?parsed.bankMoves:[],
      };
      save();
      goView('Dashboard');
      alert('Importado.');
      return;
    }
    if (action === 'wipe'){
      if (!confirm('Apagar todos os dados locais?')) return;
      localStorage.removeItem(STORAGE_KEY);
      state = defaultState();
      save();
      goView('Dashboard');
      return;
    }

    if (action === 'add-month'){
      const d = new Date();
      d.setMonth(d.getMonth()+1);
      const m = ym(d);
      ensureMonthExists(m);
      save();
      renderCashflow();
      return;
    }

    if (action === 'add-income' || action === 'add-expense'){
      const ymStr = $('#monthPick').value;
      const kind = (action === 'add-income') ? 'income' : 'expense';
      openModal(kind==='income'?'Adicionar entrada':'Adicionar despesa', cfForm(kind, null, ymStr));
      return;
    }

    if (action === 'edit-cf'){
      const kind = target.dataset.kind;
      const id = target.dataset.id;
      const ymStr = $('#monthPick').value;
      const m = getMonth(ymStr);
      const arr = (kind==='income') ? m.income : m.expenses;
      const item = arr.find(x=>x.id===id);
      openModal('Editar', cfForm(kind, item||null, ymStr));
      return;
    }

    if (action === 'delete-cf'){
      const kind = target.dataset.kind;
      const id = target.dataset.id;
      const ymStr = $('#monthPick').value;
      const m = getMonth(ymStr);
      if (kind==='income') m.income = m.income.filter(x=>x.id!==id);
      else m.expenses = m.expenses.filter(x=>x.id!==id);
      save();
      closeModal();
      renderCashflow();
      return;
    }

    if (action === 'set-passcode'){
      const code = ($('#passcode').value||'').trim();
      if (!code) return alert('Introduce um código.');
      state.settings.passcodeHash = await sha256Hex(code);
      state.settings.locked = false;
      $('#passcode').value='';
      save();
      renderSettings();
      alert('Código guardado.');
      return;
    }
    if (action === 'remove-passcode'){
      if (!confirm('Remover código?')) return;
      state.settings.passcodeHash = null;
      state.settings.locked = false;
      save();
      renderSettings();
      goView('Settings');
      return;
    }
    if (action === 'lock-now'){
      if (!state.settings.passcodeHash) return alert('Define um código primeiro.');
      state.settings.locked = true;
      save();
      goView('Lock');
      return;
    }
    if (action === 'unlock'){
      const code = ($('#unlockCode').value||'').trim();
      if (!code) return;
      const h = await sha256Hex(code);
      if (h === state.settings.passcodeHash){
        state.settings.locked = false;
        $('#unlockCode').value='';
        $('#unlockHint').textContent='';
        save();
        goView('Dashboard');
      } else {
        $('#unlockHint').textContent='Código incorrecto.';
      }
      return;
    }
  }

  function downloadBlob(blob, filename){
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }

  // --------------------
  // CSV import
  // --------------------
  function parseCSV(text){
    // simple CSV parser (comma/semicolon)
    const lines = text.replace(/\r/g,'').split('\n').filter(l=>l.trim().length>0);
    if (lines.length===0) return [];
    const sep = (lines[0].includes(';') && !lines[0].includes(',')) ? ';' : ',';
    const rows = lines.map(l=>splitCSVLine(l, sep));
    const header = rows[0].map(h=>h.trim());
    const out = [];
    for(let i=1;i<rows.length;i++){
      const r = rows[i];
      const obj = {};
      header.forEach((h,idx)=> obj[h] = (r[idx]??'').trim());
      out.push(obj);
    }
    return out;
  }

  function splitCSVLine(line, sep){
    const res = [];
    let cur = '';
    let inQ = false;
    for(let i=0;i<line.length;i++){
      const ch = line[i];
      if (ch==='"'){
        if (inQ && line[i+1]==='"'){ cur+='"'; i++; }
        else inQ = !inQ;
        continue;
      }
      if (!inQ && ch===sep){ res.push(cur); cur=''; continue; }
      cur += ch;
    }
    res.push(cur);
    return res;
  }

  async function importAssetsCSV(file){
    const txt = await file.text();
    const rows = parseCSV(txt);
    if (rows.length===0) return alert('CSV vazio.');

    const mapped = rows.map(r=>({
      id: uid(),
      class: r.class || r.Classe || r.classe || 'Outros',
      name: r.name || r.Nome || r.nome || 'Sem nome',
      value: Number(String(r.value||r.Valor||r.valor||'0').replace(',','.')) || 0,
      incomeType: r.incomeType || r.rendimentoTipo || 'none',
      incomeValue: Number(String(r.incomeValue||r.rendimentoValor||'0').replace(',','.')) || 0,
      favorite: String(r.favorite||'').toLowerCase()==='true' || String(r.favorito||'').toLowerCase()==='true',
      notes: r.notes || r.Notas || r.notas || ''
    }));

    state.assets = mapped;
    save();
    goView('Dashboard');
    alert(`Importados ${mapped.length} ativos.`);
  }

  async function importBankCSV(file){
    const txt = await file.text();
    const rows = parseCSV(txt);
    if (rows.length===0) return alert('CSV vazio.');

    // detect columns
    const cols = Object.keys(rows[0]||{});
    const pick = (cands) => cols.find(c => cands.some(k => c.toLowerCase().includes(k)));
    const cDate = pick(['data','date']);
    const cDesc = pick(['descr','desc','mov','detal','memo']);
    const cAmt  = pick(['mont','amount','valor','value','importe']);

    if (!cAmt) return alert('Não consegui detectar a coluna do montante.');

    const moves = rows.map(r=>{
      const rawAmt = String(r[cAmt]||'0').replace(/\s/g,'').replace('.','').replace(',','.');
      const amount = Number(rawAmt) || 0;
      const dateStr = (cDate ? String(r[cDate]||'') : '').trim();
      const desc = (cDesc ? String(r[cDesc]||'') : '').trim();
      const yms = guessYM(dateStr) || ym();
      return { id: uid(), date: dateStr, desc, amount, cat:'', ym: yms };
    });

    state.bankMoves.push(...moves);
    // auto-create expenses from negative amounts in that month (uncategorized)
    for(const mv of moves){
      ensureMonthExists(mv.ym);
      const m = getMonth(mv.ym);
      if (mv.amount < 0){
        m.expenses.push({ id: uid(), cat: mv.cat || 'Banco (importado)', amt: Math.abs(mv.amount), note: mv.desc||mv.date||'' });
      } else if (mv.amount > 0){
        m.income.push({ id: uid(), who:'Outros', cat: mv.cat || 'Banco (importado)', amt: mv.amount, note: mv.desc||mv.date||'' });
      }
    }

    save();
    goView('Cashflow');
    alert(`Importados ${moves.length} movimentos.`);
  }

  function guessYM(dateStr){
    // tries dd/mm/yyyy or yyyy-mm-dd
    const s = String(dateStr||'').trim();
    let m;
    if ((m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/))) return `${m[1]}-${String(m[2]).padStart(2,'0')}`;
    if ((m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/))) {
      const y = (m[3].length===2) ? `20${m[3]}` : m[3];
      return `${y}-${String(m[2]).padStart(2,'0')}`;
    }
    return null;
  }

  // --------------------
  // Event wiring
  // --------------------
  function bind(){
    // bottom nav
    $$('.bottomnav .tab').forEach(btn=>{
      btn.addEventListener('click', () => goView(btn.dataset.view));
    });

    // top add
    $('#btnAdd').addEventListener('click', () => openModal('Adicionar ativo', assetForm('asset', null)));

    // delegation
    document.addEventListener('click', async (e)=>{
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const action = el.dataset.action;
      e.preventDefault();
      try { await handleAction(action, el); }
      catch(err){ showError(err); }
    });

    // modal submit handlers
    document.addEventListener('submit', async (e)=>{
      const form = e.target;
      if (form.id === 'editForm'){
        e.preventDefault();
        try {
          const kind = $('#f_kind').value;
          const id = ($('#f_id').value||'').trim() || uid();
          const obj = {
            id,
            class: $('#f_class').value,
            name: $('#f_name').value.trim(),
            value: Number($('#f_value').value)||0,
            notes: $('#f_notes').value.trim(),
          };
          if (kind==='asset'){
            obj.incomeType = $('#f_incomeType') ? $('#f_incomeType').value : 'none';
            obj.incomeValue = $('#f_incomeValue') ? (Number($('#f_incomeValue').value)||0) : 0;
            obj.favorite = $('#f_fav') ? !!$('#f_fav').checked : false;
            const i = state.assets.findIndex(x=>x.id===id);
            if (i>=0) state.assets[i] = { ...state.assets[i], ...obj };
            else state.assets.push(obj);
          } else {
            const i = state.liabilities.findIndex(x=>x.id===id);
            if (i>=0) state.liabilities[i] = { ...state.liabilities[i], ...obj };
            else state.liabilities.push(obj);
          }
          save();
          closeModal();
          renderDashboard();
          renderAssets();
        } catch(err){ showError(err); }
      }

      if (form.id === 'cfForm'){
        e.preventDefault();
        try {
          const kind = $('#cf_kind').value;
          const id = ($('#cf_id').value||'').trim() || uid();
          const ymStr = $('#cf_ym').value;
          const m = getMonth(ymStr);
          const entry = {
            id,
            cat: $('#cf_cat').value.trim(),
            amt: Number($('#cf_amt').value)||0,
            note: $('#cf_note').value.trim(),
          };
          if (kind==='income') entry.who = $('#cf_who').value;

          const arr = (kind==='income') ? m.income : m.expenses;
          const i = arr.findIndex(x=>x.id===id);
          if (i>=0) arr[i] = { ...arr[i], ...entry };
          else arr.push(entry);

          save();
          closeModal();
          renderCashflow();
        } catch(err){ showError(err); }
      }
    });

    // search
    $('#assetSearch').addEventListener('input', () => renderAssets());
    $('#assetFilter').addEventListener('change', () => renderAssets());

    // month pick
    $('#monthPick').addEventListener('change', () => renderCashflow());

    // settings
    $('#baseCurrency').addEventListener('change', () => {
      state.settings.currency = $('#baseCurrency').value;
      save();
      renderDashboard();
      renderAssets();
      renderCashflow();
    });
    $('#taxRate').addEventListener('change', () => {
      state.settings.taxRate = Number($('#taxRate').value)||0;
      save();
      renderDashboard();
    });

    // passive segment
    $$('.seg__btn').forEach(b=>{
      b.addEventListener('click', () => {
        $$('.seg__btn').forEach(x=>x.classList.remove('seg__btn--active'));
        b.classList.add('seg__btn--active');
        passiveMode = b.dataset.seg === 'gross' ? 'gross' : 'net';
        renderDashboard();
      });
    });

    // file inputs
    $('#fileAssetsCSV').addEventListener('change', async ()=>{
      const f = $('#fileAssetsCSV').files?.[0];
      if (f) { try { await importAssetsCSV(f); } catch(err){ showError(err); } }
    });
    $('#fileBankCSV').addEventListener('change', async ()=>{
      const f = $('#fileBankCSV').files?.[0];
      if (f) { try { await importBankCSV(f); } catch(err){ showError(err); } }
    });

    // close modal on overlay escape
    document.addEventListener('keydown', (e)=>{
      if (e.key==='Escape') closeModal();
    });
  }

  // --------------------
  // Init
  // --------------------
  function init(){
    // make views hidden initially (CSS display none), then show dashboard
    Object.values(VIEW_IDS).forEach(id=>{
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    // lock handling
    if (state.settings.locked) goView('Lock');
    else goView('Dashboard');

    bind();
  }

  // Run after DOM
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
