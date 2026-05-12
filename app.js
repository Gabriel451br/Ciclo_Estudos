/* =============================================
   CICLO DE ESTUDOS — app.js  v3
   - Timer via timestamps reais (não trava em bg)
   - Som via <audio> base64 (toca em background)
   - Ciclo 100% livre por slots independentes
   - Registro de questões por dia
   ============================================= */

'use strict';

// ─── CORES ───────────────────────────────────
const PIE_C = ['#4a8af4','#e05c5c','#639922','#d4941c','#8b5cf6','#d85a30','#1d9e75','#d4537e','#64748b','#3b82f6','#ef4444','#22c55e'];
const CIRC   = 2 * Math.PI * 68;

// ─── ÁUDIO BASE64 (WAV mínimos, tocam em background) ─
// Gerado programaticamente: 3 tons para foco, 2 tons para pausa
function makeBeepWav(freqs, durMs = 120, vol = 0.35) {
  const sr = 22050, fade = 0.01;
  const spf = Math.floor(sr * durMs / 1000);
  const gap = Math.floor(sr * 0.06);
  const total = freqs.length * (spf + gap);
  const buf = new Int16Array(total);
  freqs.forEach((freq, fi) => {
    const off = fi * (spf + gap);
    for (let i = 0; i < spf; i++) {
      let env = 1;
      const fadeSamples = Math.floor(fade * sr);
      if (i < fadeSamples) env = i / fadeSamples;
      else if (i > spf - fadeSamples) env = (spf - i) / fadeSamples;
      buf[off + i] = Math.round(Math.sin(2 * Math.PI * freq * i / sr) * vol * env * 32767);
    }
  });
  // WAV header
  const dataLen = buf.length * 2;
  const ab = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(ab);
  const w  = (o, v, l) => { for (let i=0;i<l;i++) dv.setUint8(o+i, (v>>(i*8))&0xff); };
  const ws = (o, s) => { for (let i=0;i<s.length;i++) dv.setUint8(o+i, s.charCodeAt(i)); };
  ws(0,'RIFF'); w(4,36+dataLen,4); ws(8,'WAVE'); ws(12,'fmt ');
  w(16,16,4); w(20,1,2); w(22,1,2); w(24,sr,4); w(28,sr*2,4);
  w(32,2,2); w(34,16,2); ws(36,'data'); w(40,dataLen,4);
  new Int16Array(ab, 44).set(buf);
  const bytes = new Uint8Array(ab);
  let b64 = '';
  for (let i = 0; i < bytes.length; i++) b64 += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(b64);
}

// Pré-gera os URIs de áudio uma vez
let AUDIO_FOCUS, AUDIO_BREAK;
function initAudio() {
  try {
    AUDIO_FOCUS = makeBeepWav([880, 660, 440], 130);
    AUDIO_BREAK = makeBeepWav([440, 660], 130);
  } catch(e) { AUDIO_FOCUS = null; AUDIO_BREAK = null; }
}

function playBeep(type = 'focus') {
  const src = type === 'focus' ? AUDIO_FOCUS : AUDIO_BREAK;
  if (!src) return;
  try {
    const au = new Audio(src);
    au.volume = 0.7;
    au.play().catch(() => {});
  } catch(e) {}
}

// ─── ESTADO PADRÃO ───────────────────────────
const DEFAULT_STATE = {
  subjects: [
    {name:'Língua Portuguesa',   pct:15,   freq:2, area:'Básico',     customHrs:null},
    {name:'Língua Inglesa',      pct:5,    freq:1, area:'Básico',     customHrs:null},
    {name:'Matemática',          pct:7.5,  freq:1, area:'Básico',     customHrs:null},
    {name:'At. Mercado Fin.',    pct:5,    freq:1, area:'Básico',     customHrs:null},
    {name:'Mat. Financeira',     pct:7.5,  freq:1, area:'Específico', customHrs:null},
    {name:'Conh. Bancários',     pct:15,   freq:2, area:'Específico', customHrs:null},
    {name:'Informática',         pct:22.5, freq:2, area:'Específico', customHrs:null},
    {name:'Vendas e Negociação', pct:22.5, freq:2, area:'Específico', customHrs:null},
    {name:'Redação',             pct:0,    freq:2, area:'Redação',    customHrs:null}
  ],
  // Ciclo: lista de slots livres { subjectName, label }
  cycleSlots:  [],
  sessions:    [],
  simsGeral:   [],
  simsMateria: [],
  metas:       {},
  questoes:    [],   // { date (ISO), sub, qty, note }
  pomoDone:    0,
  pomoToday:   0,
  pomoTodayDate: '',
  cfg: { hpd:4, dpw:5, r1:1, r2:3, r3:7 }
};

let S = deepClone(DEFAULT_STATE);

// ─── POMODORO RUNTIME ────────────────────────
let pomoState = {
  phase: 'focus', running: false,
  startedAt: null, remaining: 0, total: 0,
  cycle: 0, subject: '', rafId: null
};

const charts = {};

// ─── UTILS ───────────────────────────────────
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
function todayStr()   { return new Date().toISOString().split('T')[0]; }
function fmtMMSS(sec) {
  const m = Math.floor(sec/60).toString().padStart(2,'0');
  const s = (sec%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

// ─── PERSISTÊNCIA ────────────────────────────
const STORAGE_KEY = 'cicloEstudos_v3';

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      subjects:      S.subjects,
      cycleSlots:    S.cycleSlots,
      sessions:      S.sessions,
      simsGeral:     S.simsGeral,
      simsMateria:   S.simsMateria,
      metas:         S.metas,
      questoes:      S.questoes,
      pomoDone:      S.pomoDone,
      pomoToday:     S.pomoToday,
      pomoTodayDate: S.pomoTodayDate,
      cfg:           S.cfg
    }));
  } catch(e) { console.warn('localStorage indisponível:', e); }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // migração da chave antiga
    const rawOld = !raw ? localStorage.getItem('cicloEstudos_v2') : null;
    const saved = JSON.parse(raw || rawOld || 'null');
    if (!saved) return;

    S.subjects    = saved.subjects    || S.subjects;
    S.sessions    = saved.sessions    || [];
    S.simsGeral   = saved.simsGeral   || [];
    S.simsMateria = saved.simsMateria || [];
    S.metas       = saved.metas       || {};
    S.questoes    = saved.questoes    || [];
    S.pomoDone    = saved.pomoDone    || 0;
    S.cfg         = Object.assign({}, DEFAULT_STATE.cfg, saved.cfg || {});

    // Ciclo: migra cycleOrder antigo → cycleSlots
    if (saved.cycleSlots && saved.cycleSlots.length) {
      S.cycleSlots = saved.cycleSlots;
    } else if (saved.cycleOrder) {
      // converte formato antigo
      S.cycleSlots = [];
      const seen = {};
      saved.cycleOrder.forEach(idx => {
        const subj = S.subjects[idx];
        if (!subj) return;
        seen[subj.name] = (seen[subj.name] || 0) + 1;
        const n = seen[subj.name];
        const times = subj.freq || 1;
        S.cycleSlots.push({ subjectName: subj.name, label: times > 1 ? `${n}ª sessão` : 'Sessão' });
      });
    } else {
      S.cycleSlots = buildDefaultSlots();
    }

    const today = todayStr();
    if (saved.pomoTodayDate === today) {
      S.pomoToday     = saved.pomoToday || 0;
      S.pomoTodayDate = today;
    } else {
      S.pomoToday     = 0;
      S.pomoTodayDate = today;
    }
  } catch(e) { console.warn('Erro ao carregar estado:', e); }
}

function buildDefaultSlots() {
  const slots = [];
  S.subjects.forEach(s => {
    const times = s.freq || 1;
    for (let i = 1; i <= times; i++) {
      slots.push({ subjectName: s.name, label: times > 1 ? `${i}ª sessão` : 'Sessão' });
    }
  });
  return slots;
}

function clearAllData() {
  if (!confirm('Apagar TODOS os dados? Essa ação não pode ser desfeita.')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('cicloEstudos_v2');
  S = deepClone(DEFAULT_STATE);
  S.cycleSlots    = buildDefaultSlots();
  S.pomoTodayDate = todayStr();
  resetPomo();
  syncAll();
  updateMetrics();
  updateCfgUI();
  renderQuestoes();
  alert('Dados apagados com sucesso.');
}

// ─── CÁLCULOS ────────────────────────────────
function getPrio(s) {
  const sims = S.simsMateria.filter(x => x.sub === s.name);
  const avg  = sims.length ? sims.reduce((a,b) => a+b.score,0)/sims.length : 50;
  return (s.pct/100*.6 + (1-avg/100)*.4) * (s.freq===2 ? 1.2 : 1);
}
function totalPct() { return +S.subjects.reduce((a,b) => a+Number(b.pct),0).toFixed(2); }
function getRecHrs(s) {
  if (s.customHrs !== null && s.customHrs !== undefined) return s.customHrs;
  const total = S.cfg.hpd * S.cfg.dpw;
  const sum   = S.subjects.reduce((a,b) => a+getPrio(b),0);
  if (!sum) return 0;
  return Math.max(0.5, +((getPrio(s)/sum)*total).toFixed(1));
}
function todayStudiedSec() {
  const today = new Date().toDateString();
  return S.sessions
    .filter(s => s.phase==='focus' && new Date(s.date).toDateString()===today)
    .reduce((a,b) => a+b.seconds, 0);
}

// ─── SELETORES ───────────────────────────────
function buildSelects() {
  ['pomo-sub','sm-sub','q-sub','cycle-add-sub'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = '<option value="">Selecione...</option>';
    S.subjects.forEach(s => {
      const o = document.createElement('option');
      o.value = s.name; o.textContent = s.name;
      el.appendChild(o);
    });
    if (S.subjects.find(x => x.name===cur)) el.value = cur;
  });
  const today = todayStr();
  const sgd = document.getElementById('sg-date');
  if (sgd && !sgd.value) sgd.value = today;
}

// ─── TABS ────────────────────────────────────
function showTab(tab, btn) {
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected','false'); });
  document.getElementById('tab-'+tab).classList.add('active');
  btn.classList.add('active'); btn.setAttribute('aria-selected','true');

  if (tab==='dash')   { renderCharts(); renderPrioList(); }
  if (tab==='sims')   { renderSgChart(); renderMetaChart(); renderMetaProgress(); renderSmList(); renderSgList(); }
  if (tab==='ciclo')  { renderCycle(); renderRevAlerts(); }
  if (tab==='config') { renderSubjTable(); }
  if (tab==='pomo')   { renderQuestoes(); }
}

// ─── MÉTRICAS ────────────────────────────────
function updateMetrics() {
  const totalSec = S.sessions.filter(s => s.phase==='focus').reduce((a,b) => a+b.seconds,0);
  const h = Math.floor(totalSec/3600), m = Math.floor((totalSec%3600)/60);
  const hrsText = h>0 ? `${h}h${m>0?' '+m+'m':''}` : `${m}m`;

  document.getElementById('m-hrs').textContent  = hrsText;
  document.getElementById('m-pomo').textContent = S.pomoToday;
  document.getElementById('hdr-hrs').querySelector('span').textContent  = hrsText;
  document.getElementById('hdr-pomo').querySelector('span').textContent = S.pomoToday;

  const all = [...S.simsMateria, ...S.simsGeral];
  document.getElementById('m-avg').textContent = all.length
    ? Math.round(all.reduce((a,b) => a+b.score,0)/all.length)+'%' : '—';

  // meta hoje
  const todaySec = todayStudiedSec();
  const pct      = Math.min(100, Math.round(todaySec/(S.cfg.hpd*3600)*100));
  document.getElementById('dash-meta-txt').textContent = `${(todaySec/3600).toFixed(1)}h / ${S.cfg.hpd}h`;
  document.getElementById('dash-meta-bar').style.width = pct+'%';

  // questões hoje no header
  const todayQ = S.questoes
    .filter(q => q.date===todayStr())
    .reduce((a,b) => a+b.qty, 0);
  const hdrQ = document.getElementById('hdr-q');
  if (hdrQ) hdrQ.querySelector('span').textContent = todayQ+'q';
}

// ─── PAINEL ──────────────────────────────────
function renderPrioList() {
  const sorted = [...S.subjects].sort((a,b) => getPrio(b)-getPrio(a));
  const maxP   = getPrio(sorted[0]) || 1;
  document.getElementById('prio-list').innerHTML = sorted.map(s => {
    const p   = getPrio(s), pct = Math.round(p/maxP*100);
    const bc  = s.pct>=15?'bh':s.pct>=7?'bm':'bl';
    const bar = bc==='bh'?'#4a8af4':bc==='bm'?'#d4941c':'#639922';
    const sims = S.simsMateria.filter(x => x.sub===s.name);
    const avg  = sims.length ? Math.round(sims.reduce((a,b) => a+b.score,0)/sims.length) : null;
    return `<div class="prio-row">
      <span class="prio-name" title="${s.name}">${s.name}</span>
      <span class="badge ${bc}">${s.pct>=15?'Alta':s.pct>=7?'Média':'Menor'}</span>
      <div class="pbar-bg"><div class="pbar" style="width:${pct}%;background:${bar}"></div></div>
      <span class="prio-avg">${avg!==null?avg+'%':'—'}</span>
    </div>`;
  }).join('');
}

function renderCharts() {
  const pd = S.subjects.filter(s => s.pct>0).sort((a,b) => b.pct-a.pct);
  if (charts.pie) charts.pie.destroy();
  charts.pie = new Chart(document.getElementById('pieChart'), {
    type:'pie',
    data:{ labels:pd.map(s=>s.name), datasets:[{ data:pd.map(s=>s.pct), backgroundColor:PIE_C.slice(0,pd.length), borderWidth:2, borderColor:'#1a2234' }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${ctx.parsed}%`}} } }
  });
  document.getElementById('pie-leg').innerHTML = pd.map((s,i) =>
    `<span><span class="dot-sq" style="background:${PIE_C[i]}"></span>${s.name} ${s.pct}%</span>`
  ).join('');

  if (charts.bar) charts.bar.destroy();
  charts.bar = new Chart(document.getElementById('barChart'), {
    type:'bar',
    data:{ labels:S.subjects.map(s=>s.name.split(' ')[0]), datasets:[{ label:'h/sem', data:S.subjects.map(s=>getRecHrs(s)), backgroundColor:'#4a8af455', borderColor:'#4a8af4', borderWidth:1 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales:{ x:{ticks:{color:'#8a97b0',font:{size:10},autoSkip:false,maxRotation:45},grid:{color:'rgba(255,255,255,.04)'}},
               y:{beginAtZero:true,ticks:{color:'#8a97b0'},grid:{color:'rgba(255,255,255,.06)'},title:{display:true,text:'horas',color:'#8a97b0'}} } }
  });
}

// ─── SIMULADOS GERAL ─────────────────────────
function addSimGeral() {
  const date=document.getElementById('sg-date').value, score=parseFloat(document.getElementById('sg-score').value), obs=document.getElementById('sg-obs').value.trim();
  if (!date||isNaN(score)||score<0||score>100){alert('Preencha data e % de acertos (0–100).');return;}
  S.simsGeral.push({date,score,obs}); document.getElementById('sg-score').value=''; document.getElementById('sg-obs').value='';
  renderSgList(); renderSgChart(); updateMetrics(); saveState();
}
function renderSgList() {
  const el=document.getElementById('sg-list');
  if (!S.simsGeral.length){el.innerHTML='<p class="empty-msg">Nenhum simulado geral ainda.</p>';return;}
  el.innerHTML=[...S.simsGeral].reverse().map(s=>{
    const cls=s.score>=70?'sc-h':s.score>=50?'sc-m':'sc-l';
    const d=new Date(s.date+'T12:00:00');
    return `<div class="srow"><span style="color:var(--text)">Simulado geral${s.obs?' — '+s.obs:''}</span>
      <div style="display:flex;align-items:center;gap:7px"><span style="font-size:12px;color:var(--text2)">${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}</span><span class="sp ${cls}">${s.score}%</span></div></div>`;
  }).join('');
}
function renderSgChart() {
  if (charts.sg) charts.sg.destroy();
  if (!S.simsGeral.length) return;
  const sorted=[...S.simsGeral].sort((a,b)=>new Date(a.date)-new Date(b.date));
  charts.sg=new Chart(document.getElementById('sgChart'),{type:'line',
    data:{labels:sorted.map(s=>{const d=new Date(s.date+'T12:00:00');return`${d.getDate()}/${d.getMonth()+1}`;}),
      datasets:[{label:'%',data:sorted.map(s=>s.score),borderColor:'#4a8af4',backgroundColor:'#4a8af418',fill:true,tension:.35,pointBackgroundColor:'#4a8af4',pointRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{y:{min:0,max:100,ticks:{color:'#8a97b0'},grid:{color:'rgba(255,255,255,.06)'},title:{display:true,text:'%',color:'#8a97b0'}},x:{ticks:{color:'#8a97b0'},grid:{color:'rgba(255,255,255,.04)'}}}}});
}

// ─── SIMULADOS MATÉRIA ────────────────────────
function addSimMateria() {
  const sub=document.getElementById('sm-sub').value, score=parseFloat(document.getElementById('sm-score').value), meta=parseFloat(document.getElementById('sm-meta').value);
  if (!sub||isNaN(score)||score<0||score>100){alert('Preencha matéria e % de acertos.');return;}
  S.simsMateria.push({sub,score,date:Date.now()});
  if (!isNaN(meta)&&meta>=0&&meta<=100) S.metas[sub]=meta;
  document.getElementById('sm-score').value=''; document.getElementById('sm-meta').value='';
  renderSmList(); renderMetaProgress(); renderMetaChart(); renderPrioList(); renderCycle(); updateMetrics(); saveState();
}
function renderSmList() {
  const el=document.getElementById('sm-list');
  if (!S.simsMateria.length){el.innerHTML='<p class="empty-msg">Nenhum simulado por matéria ainda.</p>';return;}
  el.innerHTML=[...S.simsMateria].reverse().map(s=>{
    const cls=s.score>=70?'sc-h':s.score>=50?'sc-m':'sc-l';
    const dt=new Date(s.date);
    return `<div class="srow"><span style="color:var(--text)">${s.sub}</span>
      <div style="display:flex;align-items:center;gap:7px"><span style="font-size:12px;color:var(--text2)">${dt.getDate().toString().padStart(2,'0')}/${(dt.getMonth()+1).toString().padStart(2,'0')}</span><span class="sp ${cls}">${s.score}%</span></div></div>`;
  }).join('');
}
function renderMetaProgress() {
  const el=document.getElementById('meta-progress');
  const withMeta=S.subjects.filter(s=>S.metas[s.name]);
  if (!withMeta.length){el.innerHTML='<p class="empty-msg" style="text-align:left">Nenhuma meta definida. Salve um simulado com meta para começar.</p>';return;}
  el.innerHTML=withMeta.map(s=>{
    const goal=S.metas[s.name], sims=S.simsMateria.filter(x=>x.sub===s.name);
    const avg=sims.length?Math.round(sims.reduce((a,b)=>a+b.score,0)/sims.length):null;
    const pct=avg!==null?Math.min(100,Math.round(avg/goal*100)):0;
    const color=avg===null?'#64748b':avg>=goal?'#639922':avg>=goal*.8?'#d4941c':'#e05c5c';
    const status=avg===null?'sem dados':avg>=goal?'Meta atingida! ✓':avg>=goal*.8?'Quase lá':'Precisa de atenção';
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
        <span style="color:var(--text);font-weight:600">${s.name}</span>
        <span style="color:${color}">${avg!==null?avg+'%':'—'} / ${goal}% — ${status}</span>
      </div>
      <div class="meta-bar-bg"><div class="meta-bar" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
  }).join('');
}
function renderMetaChart() {
  if (charts.meta) charts.meta.destroy();
  const subjs=S.subjects.filter(s=>S.metas[s.name]||S.simsMateria.some(x=>x.sub===s.name));
  if (!subjs.length) return;
  const goals=subjs.map(s=>S.metas[s.name]||null);
  const avgs=subjs.map(s=>{const sims=S.simsMateria.filter(x=>x.sub===s.name);return sims.length?Math.round(sims.reduce((a,b)=>a+b.score,0)/sims.length):null;});
  charts.meta=new Chart(document.getElementById('metaChart'),{type:'bar',
    data:{labels:subjs.map(s=>s.name.split(' ')[0]),datasets:[
      {label:'Meta',data:goals,backgroundColor:'#4a8af455',borderColor:'#4a8af4',borderWidth:1.5},
      {label:'Acertos',data:avgs,backgroundColor:'#63992255',borderColor:'#639922',borderWidth:1.5}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{y:{min:0,max:100,ticks:{color:'#8a97b0'},grid:{color:'rgba(255,255,255,.06)'},title:{display:true,text:'%',color:'#8a97b0'}},x:{ticks:{color:'#8a97b0',font:{size:11}},grid:{display:false}}}}});
}

// ─── QUESTÕES POR DIA ─────────────────────────
function addQuestoes() {
  const sub = document.getElementById('q-sub').value;
  const qty = parseInt(document.getElementById('q-qty').value);
  const note= document.getElementById('q-note').value.trim();
  if (!sub || isNaN(qty) || qty < 1) { alert('Selecione a matéria e informe a quantidade.'); return; }
  S.questoes.push({ date: todayStr(), sub, qty, note });
  document.getElementById('q-qty').value  = '';
  document.getElementById('q-note').value = '';
  saveState(); renderQuestoes(); updateMetrics();
}

function renderQuestoes() {
  // Totais hoje
  const today = todayStr();
  const todayRecs = S.questoes.filter(q => q.date === today);
  const todayTotal = todayRecs.reduce((a,b) => a+b.qty, 0);
  document.getElementById('q-today-total').textContent = todayTotal;

  // Lista dos últimos 30 registros
  const el = document.getElementById('q-list');
  if (!S.questoes.length) { el.innerHTML = '<p class="empty-msg">Nenhum registro ainda.</p>'; return; }
  el.innerHTML = [...S.questoes].reverse().slice(0,50).map(q => {
    const d = new Date(q.date+'T12:00:00');
    const dateStr = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}`;
    return `<div class="srow">
      <div><span style="color:var(--text);font-weight:500">${q.sub}</span>${q.note?` <span style="color:var(--text2);font-size:12px">— ${q.note}</span>`:''}</div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:12px;color:var(--text2)">${dateStr}</span>
        <span class="badge bh" style="font-family:var(--font-mono)">${q.qty}q</span>
      </div>
    </div>`;
  }).join('');

  // Gráfico de questões por dia (últimos 14 dias)
  renderQChart();

  // Resumo por matéria (últimos 7 dias)
  renderQBySubject();
}

function renderQChart() {
  if (charts.q) charts.q.destroy();
  // Agrupa por data (últimos 14 dias)
  const days = 14;
  const labels = [], data = [];
  for (let i = days-1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate()-i);
    const ds = d.toISOString().split('T')[0];
    const total = S.questoes.filter(q => q.date===ds).reduce((a,b) => a+b.qty, 0);
    labels.push(`${d.getDate()}/${d.getMonth()+1}`);
    data.push(total);
  }
  if (data.every(v => v===0)) return;
  charts.q = new Chart(document.getElementById('qChart'), {
    type:'bar',
    data:{ labels, datasets:[{ label:'Questões', data, backgroundColor:'#8b5cf655', borderColor:'#8b5cf6', borderWidth:1 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales:{ x:{ticks:{color:'#8a97b0',font:{size:10},maxRotation:45},grid:{color:'rgba(255,255,255,.04)'}},
               y:{beginAtZero:true,ticks:{color:'#8a97b0'},grid:{color:'rgba(255,255,255,.06)'},title:{display:true,text:'questões',color:'#8a97b0'}} } }
  });
}

function renderQBySubject() {
  const el = document.getElementById('q-by-subject');
  // Soma total por matéria (geral)
  const bySubj = {};
  S.questoes.forEach(q => { bySubj[q.sub] = (bySubj[q.sub]||0) + q.qty; });
  const sorted = Object.entries(bySubj).sort((a,b) => b[1]-a[1]);
  if (!sorted.length) { el.innerHTML = ''; return; }
  const max = sorted[0][1];
  el.innerHTML = sorted.map(([sub,qty]) => {
    const pct = Math.round(qty/max*100);
    return `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="color:var(--text)">${sub}</span>
        <span style="color:var(--text2);font-family:var(--font-mono)">${qty} questões</span>
      </div>
      <div class="pbar-bg"><div class="pbar" style="width:${pct}%;background:#8b5cf6"></div></div>
    </div>`;
  }).join('');
}

// ─── CICLO — SLOTS LIVRES ────────────────────
// Cada slot é { subjectName, label } completamente independente.
// O usuário adiciona, remove e reordena cada slot individualmente.

function renderCycle() {
  const el = document.getElementById('cycle-list');
  el.innerHTML = '';

  if (!S.cycleSlots.length) {
    el.innerHTML = '<p class="empty-msg">Nenhum slot adicionado. Use o formulário abaixo para montar seu ciclo.</p>';
    return;
  }

  S.cycleSlots.forEach((slot, i) => {
    const subj  = S.subjects.find(s => s.name === slot.subjectName);
    const color = PIE_C[i % PIE_C.length];
    const sims  = S.simsMateria.filter(x => x.sub === slot.subjectName);
    const avg   = sims.length ? Math.round(sims.reduce((a,b) => a+b.score,0)/sims.length) : null;
    const hrs   = subj ? getRecHrs(subj) : '—';
    const pct   = subj ? subj.pct : 0;

    const div = document.createElement('div');
    div.className = 'ci'; div.draggable = true; div.dataset.idx = i;

    div.innerHTML = `
      <i class="ti ti-grip-vertical ci-grip" aria-hidden="true"></i>
      <div class="ci-num" style="background:${color}22;color:${color}">${i+1}</div>
      <div style="flex:1;min-width:0">
        <div class="ci-name">${slot.subjectName}</div>
        <div class="ci-meta">${slot.label}${subj?' · '+hrs+'h/sem':''}${avg!==null?' · '+avg+'%':''}</div>
      </div>
      <input type="text" value="${slot.label}"
        style="width:90px;padding:3px 6px;font-size:11px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text2);text-align:center"
        title="Rótulo da sessão"
        onchange="S.cycleSlots[${i}].label=this.value;saveState()"
        onclick="event.stopPropagation()">
      <span class="badge ${pct>=15?'bh':pct>=7?'bm':'bl'}" style="flex-shrink:0">${pct>0?pct+'%':'Red.'}</span>
      <button class="btn btn-r btn-sm" style="padding:3px 7px" onclick="removeSlot(${i})" aria-label="Remover slot">
        <i class="ti ti-trash"></i>
      </button>`;

    div.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', i); div.style.opacity = '.3'; });
    div.addEventListener('dragend',   () => { div.style.opacity = '1'; });
    div.addEventListener('dragover',  e => { e.preventDefault(); div.classList.add('drag-over'); });
    div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
    div.addEventListener('drop', e => {
      e.preventDefault(); div.classList.remove('drag-over');
      const from = parseInt(e.dataTransfer.getData('text/plain')), to = i;
      if (from===to) return;
      S.cycleSlots.splice(to, 0, S.cycleSlots.splice(from,1)[0]);
      saveState(); renderCycle();
    });
    el.appendChild(div);
  });
}

function addCycleSlot() {
  const sub   = document.getElementById('cycle-add-sub').value;
  const label = document.getElementById('cycle-add-label').value.trim() || '1ª sessão';
  if (!sub) { alert('Selecione uma matéria.'); return; }
  S.cycleSlots.push({ subjectName: sub, label });
  document.getElementById('cycle-add-label').value = '';
  saveState(); renderCycle();
}

function removeSlot(i) {
  S.cycleSlots.splice(i, 1);
  saveState(); renderCycle();
}

function resetCycleOrder() {
  if (!confirm('Gerar ciclo automático com base nas matérias configuradas?')) return;
  S.cycleSlots = buildDefaultSlots();
  saveState(); renderCycle();
}

// ─── REVISÕES ESPAÇADAS ──────────────────────
function renderRevAlerts() {
  const el = document.getElementById('rev-alerts');
  const focusSessions = S.sessions.filter(s => s.phase==='focus');
  if (!focusSessions.length) {
    el.innerHTML = '<p class="empty-msg" style="text-align:left">Registre sessões de estudo para ver revisões recomendadas.</p>';
    return;
  }
  const last = {};
  focusSessions.forEach(s => { if (!last[s.subject]||s.date>last[s.subject]) last[s.subject]=s.date; });
  const now=Date.now();
  const items=Object.entries(last).map(([sub,date])=>{
    const days=Math.floor((now-date)/86400000);
    let level=null,msg='';
    if (days>=S.cfg.r3){level='r3';msg=`Revisão profunda (${days}d sem estudar)`;}
    else if (days>=S.cfg.r2){level='r2';msg=`2ª revisão espaçada (${days}d)`;}
    else if (days>=S.cfg.r1){level='r1';msg=`1ª revisão rápida (${days}d)`;}
    return{sub,days,level,msg};
  }).filter(x=>x.level).sort((a,b)=>b.days-a.days);
  if (!items.length){el.innerHTML='<div class="rev-alert rev-ok"><i class="ti ti-check"></i> Todas as matérias em dia!</div>';return;}
  const icons={r1:'ti-clock',r2:'ti-bell',r3:'ti-alert-triangle'};
  el.innerHTML=items.map(x=>`<div class="rev-alert rev-${x.level}"><i class="ti ${icons[x.level]}"></i><div><strong>${x.sub}</strong> — ${x.msg}</div></div>`).join('');
}

// ─── CONFIG — HORAS ──────────────────────────
function updateHoursCfg() {
  const hpd=parseInt(document.getElementById('cfg-hpd').value);
  const dpw=parseInt(document.getElementById('cfg-dpw').value);
  S.cfg.hpd=hpd; S.cfg.dpw=dpw;
  document.getElementById('cfg-hpd-val').textContent=hpd+'h';
  document.getElementById('cfg-dpw-val').textContent=dpw+' dias';
  document.getElementById('cfg-total').textContent=(hpd*dpw)+'h / semana';
  saveState(); renderSubjTable(); updateMetrics();
  if (document.getElementById('tab-dash').classList.contains('active')) renderCharts();
}
function updateRevCfg() {
  S.cfg.r1=parseInt(document.getElementById('cfg-r1').value);
  S.cfg.r2=parseInt(document.getElementById('cfg-r2').value);
  S.cfg.r3=parseInt(document.getElementById('cfg-r3').value);
  document.getElementById('cfg-r1-val').textContent=S.cfg.r1+' dia'+(S.cfg.r1>1?'s':'');
  document.getElementById('cfg-r2-val').textContent=S.cfg.r2+' dias';
  document.getElementById('cfg-r3-val').textContent=S.cfg.r3+' dias';
  saveState();
}
function updateCfgUI() {
  document.getElementById('cfg-hpd').value=S.cfg.hpd;
  document.getElementById('cfg-dpw').value=S.cfg.dpw;
  document.getElementById('cfg-r1').value=S.cfg.r1;
  document.getElementById('cfg-r2').value=S.cfg.r2;
  document.getElementById('cfg-r3').value=S.cfg.r3;
  document.getElementById('cfg-hpd-val').textContent=S.cfg.hpd+'h';
  document.getElementById('cfg-dpw-val').textContent=S.cfg.dpw+' dias';
  document.getElementById('cfg-total').textContent=(S.cfg.hpd*S.cfg.dpw)+'h / semana';
  document.getElementById('cfg-r1-val').textContent=S.cfg.r1+' dia'+(S.cfg.r1>1?'s':'');
  document.getElementById('cfg-r2-val').textContent=S.cfg.r2+' dias';
  document.getElementById('cfg-r3-val').textContent=S.cfg.r3+' dias';
}

// ─── CONFIG — MATÉRIAS ───────────────────────
function renderSubjTable() {
  const tp=totalPct();
  const ind=document.getElementById('pct-indicator');
  ind.textContent=`Total: ${tp}%`;
  ind.className='pct-badge '+(Math.abs(tp-100)<0.11?'pct-ok':'pct-err');
  const el=document.getElementById('subj-table'); el.innerHTML='';
  S.subjects.forEach((s,i)=>{
    const recH=(()=>{const total=S.cfg.hpd*S.cfg.dpw,sum=S.subjects.reduce((a,b)=>a+getPrio(b),0);return sum?Math.max(0.5,+((getPrio(s)/sum)*total).toFixed(1)):0;})();
    const row=document.createElement('div'); row.className='subj-row';
    row.innerHTML=`
      <input type="text"   value="${s.name}" onchange="S.subjects[${i}].name=this.value;syncAll()" style="text-align:left">
      <input type="number" value="${s.pct}"  min="0" max="100" step="0.5" onchange="S.subjects[${i}].pct=+this.value;syncAll()">
      <select onchange="S.subjects[${i}].freq=+this.value;syncAll()">
        <option value="1" ${s.freq===1?'selected':''}>1x</option>
        <option value="2" ${s.freq===2?'selected':''}>2x</option>
      </select>
      <input type="number" value="${s.customHrs!==null?s.customHrs:''}" placeholder="${recH}"
        min="0" max="40" step="0.5" title="Vazio = automático"
        onchange="S.subjects[${i}].customHrs=this.value===''?null:+this.value;syncAll()">
      <input type="text" value="${s.area}" onchange="S.subjects[${i}].area=this.value;syncAll()" style="font-size:11px">
      <button class="btn btn-r btn-sm" onclick="removeSubject(${i})" aria-label="Remover ${s.name}"><i class="ti ti-trash"></i></button>`;
    el.appendChild(row);
  });
}
function addSubject() {
  const name=document.getElementById('ns-name').value.trim();
  const pct=parseFloat(document.getElementById('ns-pct').value);
  const freq=parseInt(document.getElementById('ns-freq').value);
  const area=document.getElementById('ns-area').value.trim()||'Geral';
  if (!name||isNaN(pct)||pct<0){alert('Preencha nome e porcentagem.');return;}
  S.subjects.push({name,pct,freq,area,customHrs:null});
  document.getElementById('ns-name').value=''; document.getElementById('ns-pct').value=''; document.getElementById('ns-area').value='';
  syncAll();
}
function removeSubject(i) {
  if (!confirm(`Remover "${S.subjects[i].name}"?`)) return;
  const name=S.subjects[i].name;
  S.subjects.splice(i,1);
  S.cycleSlots=S.cycleSlots.filter(sl=>sl.subjectName!==name);
  syncAll();
}
function syncAll() {
  saveState(); buildSelects(); renderSubjTable();
  if (document.getElementById('tab-ciclo').classList.contains('active')){renderCycle();renderRevAlerts();}
  if (document.getElementById('tab-dash').classList.contains('active')){renderCharts();renderPrioList();}
}

// ─── LOG SESSÕES ─────────────────────────────
function renderSLog() {
  const el=document.getElementById('slog');
  const today=new Date().toDateString();
  const todayS=S.sessions.filter(s=>new Date(s.date).toDateString()===today);
  if (!todayS.length){el.innerHTML='<p class="empty-msg">Nenhuma sessão hoje. Complete um pomodoro!</p>';return;}
  el.innerHTML=[...todayS].reverse().map(s=>{
    const min=Math.floor(s.seconds/60), dt=new Date(s.date);
    const tag=s.phase==='focus'?'<span class="badge bh" style="font-size:10px">foco</span>':'<span class="badge bl" style="font-size:10px">pausa</span>';
    return `<div class="srow"><span style="color:var(--text)">${s.subject} ${tag}</span>
      <span style="color:var(--text2);font-size:12px;font-family:var(--font-mono)">${min}min · ${dt.getHours().toString().padStart(2,'0')}:${dt.getMinutes().toString().padStart(2,'0')}</span></div>`;
  }).join('');
}

// ─── POMODORO ────────────────────────────────
function getFSec(){return parseInt(document.getElementById('cfg-f').value||25)*60;}
function getSSec(){return parseInt(document.getElementById('cfg-s').value||5)*60;}
function getLSec(){return parseInt(document.getElementById('cfg-l').value||15)*60;}

function updatePomoDisplay(remaining){
  const sec=Math.max(0,remaining);
  document.getElementById('pomo-disp').textContent=fmtMMSS(sec);
  const ring=document.getElementById('ring-p');
  ring.style.strokeDashoffset=(CIRC*(sec/(pomoState.total||1))).toFixed(2);
}

function setPhaseDisplay(){
  const ph=document.getElementById('pomo-ph');
  const map={focus:{label:'Foco 🎯',color:'var(--accent)'},short:{label:'Pausa curta ☕',color:'#639922'},long:{label:'Pausa longa 🌿',color:'#d4941c'}};
  const info=map[pomoState.phase]||map.focus;
  ph.textContent=info.label;
  document.getElementById('ring-p').style.stroke=info.color;
}

function updateDots(){for(let i=0;i<4;i++) document.getElementById('d'+i).classList.toggle('done',i<(pomoState.cycle%4));}

function pomoTick(){
  if (!pomoState.running) return;
  const elapsed=(Date.now()-pomoState.startedAt)/1000;
  const remaining=Math.round(pomoState.remaining-elapsed);
  updatePomoDisplay(remaining);
  if (remaining<=0){pomoState.running=false;phaseEnd();return;}
  pomoState.rafId=requestAnimationFrame(pomoTick);
}

function resetPomo(){
  cancelAnimationFrame(pomoState.rafId);
  pomoState.running=false; pomoState.phase='focus';
  pomoState.total=getFSec(); pomoState.remaining=getFSec(); pomoState.startedAt=null;
  setPhaseDisplay(); updatePomoDisplay(pomoState.remaining);
  document.getElementById('btn-st').disabled=false;
  document.getElementById('btn-pa').disabled=true;
  document.getElementById('pomo-st').textContent='';
}

function startPomo(){
  const sub=document.getElementById('pomo-sub').value;
  if (!sub){alert('Selecione uma matéria primeiro!');return;}
  if (pomoState.running) return;
  pomoState.subject=sub; pomoState.running=true; pomoState.startedAt=Date.now();
  if (pomoState.remaining<=0) pomoState.remaining=pomoState.total;
  document.getElementById('btn-st').disabled=true;
  document.getElementById('btn-pa').disabled=false;
  document.getElementById('pomo-st').textContent='Estudando: '+sub;
  cancelAnimationFrame(pomoState.rafId);
  pomoState.rafId=requestAnimationFrame(pomoTick);
}

function pausePomo(){
  if (!pomoState.running) return;
  const elapsed=(Date.now()-pomoState.startedAt)/1000;
  pomoState.remaining=Math.max(0,pomoState.remaining-elapsed);
  pomoState.startedAt=null; pomoState.running=false;
  cancelAnimationFrame(pomoState.rafId);
  document.getElementById('btn-st').disabled=false;
  document.getElementById('btn-pa').disabled=true;
  document.getElementById('pomo-st').textContent='Pausado. Clique em Iniciar para continuar.';
}

function phaseEnd(){
  cancelAnimationFrame(pomoState.rafId);
  const {subject,phase,total}=pomoState;
  S.sessions.push({subject,seconds:total,date:Date.now(),phase});

  if (phase==='focus'){
    playBeep('focus');
    pomoState.cycle++; S.pomoDone++; S.pomoToday++; S.pomoTodayDate=todayStr();
    updateDots();
    document.getElementById('pomo-cnt').textContent=`${S.pomoToday} pomodoro${S.pomoToday!==1?'s':''} completo${S.pomoToday!==1?'s':''} hoje`;
    const isLong=pomoState.cycle%4===0;
    pomoState.phase=isLong?'long':'short';
    pomoState.total=isLong?getLSec():getSSec();
    pomoState.remaining=pomoState.total;
    document.getElementById('pomo-st').textContent=isLong?'🌿 Pausa longa merecida! Descanse bem.':'☕ Pomodoro concluído! Descanse um pouco.';
  } else {
    playBeep('break');
    pomoState.phase='focus'; pomoState.total=getFSec(); pomoState.remaining=pomoState.total;
    document.getElementById('pomo-st').textContent='🎯 Pausa encerrada. Pronto para focar?';
  }

  setPhaseDisplay(); updatePomoDisplay(pomoState.remaining);
  document.getElementById('btn-st').disabled=false;
  document.getElementById('btn-pa').disabled=true;
  saveState(); renderSLog(); updateMetrics();
  if (document.getElementById('tab-ciclo').classList.contains('active')) renderRevAlerts();
}

// ─── INIT ────────────────────────────────────
function init(){
  initAudio();
  loadState();
  if (!S.cycleSlots||!S.cycleSlots.length) S.cycleSlots=buildDefaultSlots();
  buildSelects(); updateCfgUI(); resetPomo();
  renderPrioList(); renderCycle(); renderRevAlerts();
  updateMetrics(); renderSLog(); renderQuestoes();
  setTimeout(renderCharts,80);
}

document.addEventListener('DOMContentLoaded', init);
