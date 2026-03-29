<script>
/* ════════════════════════════════════════════════════════
   SECTION 1 — HELPERS
════════════════════════════════════════════════════════ */
function isPow2(n){ return n>0&&(n&(n-1))===0; }
function log2i(n){ return Math.log2(n)|0; }

/* ════════════════════════════════════════════════════════
   SECTION 2 — ADDRESS DECOMPOSER
════════════════════════════════════════════════════════ */
class AddressDecomposer{
  constructor(bs,ns){
    this.offsetBits=log2i(bs);
    this.indexBits=ns>1?log2i(ns):0;
    this.tagBits=32-this.offsetBits-this.indexBits;
    this.offsetMask=(1<<this.offsetBits)-1;
    this.indexMask=(1<<this.indexBits)-1;
  }
  decompose(a){
    return {
      offset: a & this.offsetMask,
      index:  (a>>this.offsetBits) & this.indexMask,
      tag:    a>>>(this.offsetBits+this.indexBits)
    };
  }
}

/* ════════════════════════════════════════════════════════
   SECTION 3 — REPLACEMENT POLICIES
════════════════════════════════════════════════════════ */
class FIFOPolicy{
  constructor(){ this.queue=[]; }
  onAccess(){}
  onLoad(t){ this.queue.push(t); }
  evict(){ return this.queue.shift(); }
  remove(t){ const i=this.queue.indexOf(t); if(i>=0)this.queue.splice(i,1); }
  displayOrder(){ return [...this.queue].reverse(); }
}

class _N{ constructor(t){ this.tag=t; this.p=this.n=null; } }
class LRUPolicy{
  constructor(){
    this._m=new Map();
    this._h=new _N(-1); this._t=new _N(-2);
    this._h.n=this._t; this._t.p=this._h;
  }
  _ul(nd){ nd.p.n=nd.n; nd.n.p=nd.p; nd.p=nd.n=null; }
  _iAH(nd){ nd.n=this._h.n; nd.p=this._h; this._h.n.p=nd; this._h.n=nd; }
  _mtf(nd){ this._ul(nd); this._iAH(nd); }
  onAccess(t){ const nd=this._m.get(t); if(nd)this._mtf(nd); }
  onLoad(t){ const nd=new _N(t); this._m.set(t,nd); this._iAH(nd); }
  evict(){
    const lru=this._t.p;
    if(lru===this._h) throw new Error('LRU evict on empty');
    this._ul(lru); this._m.delete(lru.tag); return lru.tag;
  }
  remove(t){ const nd=this._m.get(t); if(nd){this._m.delete(t);this._ul(nd);} }
  lruOrder(){ const r=[]; let c=this._h.n; while(c!==this._t){r.push(c.tag);c=c.n;} return r; }
  displayOrder(){ return this.lruOrder(); }
}

/* ════════════════════════════════════════════════════════
   SECTION 4 — CACHE SET
════════════════════════════════════════════════════════ */
class CacheSet{
  constructor(ways,pol){
    this.ways=ways;
    this.blocks=new Set();
    this.policy=pol==='LRU'?new LRUPolicy():new FIFOPolicy();
  }
  lookup(t){
    if(this.blocks.has(t)){ this.policy.onAccess(t); return true; }
    return false;
  }
  load(t){
    let ev=null;
    if(this.blocks.size<this.ways){
      this.blocks.add(t); this.policy.onLoad(t);
    } else {
      ev=this.policy.evict();
      this.blocks.delete(ev); this.blocks.add(t); this.policy.onLoad(t);
    }
    return ev;
  }
  getWayContents(){
    const ord=this.policy.displayOrder();
    return Array.from({length:this.ways},(_,i)=>i<ord.length?ord[i]:null);
  }
}

/* ════════════════════════════════════════════════════════
   SECTION 5 — CACHE SIMULATOR
════════════════════════════════════════════════════════ */
class CacheSimulator{
  constructor({cacheSize,blockSize,assoc,policy,hitTime,missPenalty}){
    if(!isPow2(cacheSize)) throw new Error('Cache size must be power of 2.');
    if(!isPow2(blockSize)) throw new Error('Block size must be power of 2.');
    if(blockSize>cacheSize) throw new Error('Block > cache.');
    this.hitTime=hitTime; this.missPenalty=missPenalty;
    this.policy=policy.toUpperCase();
    this.totalBlocks=cacheSize/blockSize;
    if(assoc===-1){ this.ways=this.totalBlocks; this.mappingType='Fully Associative'; }
    else if(assoc===1){ this.ways=1; this.mappingType='Direct Mapped'; }
    else{
      if(!isPow2(assoc)||assoc>this.totalBlocks) throw new Error('Invalid associativity.');
      this.ways=assoc; this.mappingType=`${assoc}-Way Set Associative`;
    }
    this.numSets=this.totalBlocks/this.ways;
    this.decomposer=new AddressDecomposer(blockSize,this.numSets);
    this.sets=Array.from({length:this.numSets},()=>new CacheSet(this.ways,this.policy));
    this.hitCount=0; this.missCount=0; this.accessNum=0;
  }
  access(addr){
    const {tag,index,offset}=this.decomposer.decompose(addr);
    const set=this.sets[index];
    const hit=set.lookup(tag);
    let ev=null;
    if(hit) this.hitCount++;
    else { this.missCount++; ev=set.load(tag); }
    this.accessNum++;
    return {accessNum:this.accessNum,address:addr,hex:'0x'+addr.toString(16).toUpperCase().padStart(2,'0'),tag,index,offset,hit,evicted:ev};
  }
  getStats(){
    const total=this.hitCount+this.missCount; if(!total) return null;
    const hr=this.hitCount/total, mr=this.missCount/total;
    return {total,hits:this.hitCount,misses:this.missCount,hitRatio:hr,missRate:mr,amat:this.hitTime+mr*this.missPenalty};
  }
  getCacheState(){ return this.sets.map(s=>s.getWayContents()); }
}

/* ════════════════════════════════════════════════════════
   SECTION 6 — MISS TYPE DETECTOR (3Cs)

   Classifies every cache miss as one of three types:

   COMPULSORY (Cold):  First-ever access to this tag. No cache
     size or mapping strategy could prevent it.
     Detection: tag not in seenTags (globally seen set).

   CONFLICT: The block WAS in a fully-associative cache of the
     same total capacity, but got evicted from the
     set-limited real cache due to set thrashing.
     Detection: real MISS but shadow FA HIT.

   CAPACITY: Even a fully-associative cache of the same total
     size would have missed — the working set is simply
     larger than the cache.
     Detection: real MISS and shadow FA also MISS.

   Shadow FA = LRU fully-associative cache with totalBlocks ways.
════════════════════════════════════════════════════════ */
class MissTypeDetector{
  constructor(totalBlocks){
    // seenTags: all tags ever loaded — used to detect compulsory misses
    this.seenTags=new Set();
    // Shadow fully-associative cache (1 set, all blocks, LRU)
    this.shadow=new CacheSet(totalBlocks,'LRU');
    // Running counters
    this.compulsory=0; this.conflict=0; this.capacity=0;
  }

  /**
   * classify(tag, hitInReal)
   *  — Must be called AFTER sim.access() so hitInReal is known.
   *  — Always keeps the shadow FA in sync (even on HITs).
   *  — Returns 'COMPULSORY'|'CONFLICT'|'CAPACITY'|null (null = HIT).
   */
  classify(tag, hitInReal){
    // Update shadow FA regardless of outcome in the real cache
    const shadowHit=this.shadow.lookup(tag);
    if(!shadowHit) this.shadow.load(tag);

    if(hitInReal){
      this.seenTags.add(tag);
      return null; // HITs have no miss type
    }

    let type;
    if(!this.seenTags.has(tag)){
      // First-ever access to this tag → compulsory (cold miss)
      type='COMPULSORY'; this.compulsory++;
    } else if(shadowHit){
      // Shadow FA had it → the real cache's set-structure caused the eviction
      type='CONFLICT'; this.conflict++;
    } else {
      // Shadow FA also missed → total cache capacity was insufficient
      type='CAPACITY'; this.capacity++;
    }

    this.seenTags.add(tag);
    return type;
  }
}

/* ════════════════════════════════════════════════════════
   SECTION 7 — CHART (Chart.js 4)
════════════════════════════════════════════════════════ */
let hitChart=null;
// Normal mode arrays
let cLabels=[],cVals=[],cPtClrs=[],cPtRad=[];
// Compare mode arrays
let cValsLRU=[],cValsFIFO=[],cPtLRU=[],cPtFIFO=[];
const C_LINE='#00b4ff',C_FILL='rgba(0,180,255,.08)';
const C_HIT='#00e676',C_MISS='#ff4444';
const C_LRU='#00b4ff',C_LRU_F='rgba(0,180,255,.06)';
const C_FIFO='#ffaa00',C_FIFO_F='rgba(255,170,0,.06)';
const C_GRID='rgba(26,51,88,.8)',C_TICK='#4a6882';

function initChart(compareMode){
  cLabels=[]; cVals=[]; cPtClrs=[]; cPtRad=[];
  cValsLRU=[]; cValsFIFO=[]; cPtLRU=[]; cPtFIFO=[];

  if(hitChart){ hitChart.destroy(); hitChart=null; }

  const ctx=$('hitChart').getContext('2d');
  const yAxis={min:0,max:1,
    title:{display:true,text:'Hit Ratio',color:C_TICK,font:{family:"'Barlow Condensed'",size:10,weight:'500'}},
    ticks:{color:C_TICK,font:{family:"'Share Tech Mono'",size:10},stepSize:.25,callback:v=>(v*100).toFixed(0)+'%'},
    grid:{color:C_GRID,drawBorder:false}
  };
  const xAxis={
    title:{display:true,text:'Access Number',color:C_TICK,font:{family:"'Barlow Condensed'",size:10,weight:'500'},padding:{top:2}},
    ticks:{color:C_TICK,font:{family:"'Share Tech Mono'",size:10},maxTicksLimit:12,autoSkip:true},
    grid:{color:C_GRID,drawBorder:false}
  };

  const ttCbs={
    title:items=>`Access #${items[0].label}`,
    label:item=>{
      if(compareMode){
        const lbl=item.datasetIndex===0?'LRU':'FIFO';
        return `${lbl} Hit Ratio: ${(item.raw*100).toFixed(1)}%`;
      }
      if(item.datasetIndex!==0) return null;
      return `Hit Ratio: ${(item.raw*100).toFixed(1)}%`;
    }
  };

  let datasets;
  if(compareMode){
    // Two lines: LRU (cyan) and FIFO (amber), plus 50% reference
    datasets=[
      {label:'LRU',data:cValsLRU,borderColor:C_LRU,borderWidth:2,backgroundColor:C_LRU_F,fill:true,tension:.3,
       pointBackgroundColor:cPtLRU,pointBorderColor:cPtLRU,pointRadius:cPtFIFO.map(()=>3),pointHoverRadius:6,pointBorderWidth:0,clip:false},
      {label:'FIFO',data:cValsFIFO,borderColor:C_FIFO,borderWidth:2,backgroundColor:C_FIFO_F,fill:false,tension:.3,
       pointBackgroundColor:cPtFIFO,pointBorderColor:cPtFIFO,pointRadius:cPtFIFO.map(()=>3),pointHoverRadius:6,pointBorderWidth:0,clip:false},
      {label:'50%',data:[],borderColor:'rgba(255,170,0,.3)',borderWidth:1,borderDash:[4,4],pointRadius:0,fill:false,tension:0},
    ];
  } else {
    datasets=[
      {label:'Hit Ratio',data:cVals,borderColor:C_LINE,borderWidth:2,backgroundColor:C_FILL,fill:true,tension:.35,
       pointBackgroundColor:cPtClrs,pointBorderColor:cPtClrs,pointRadius:cPtRad,pointHoverRadius:6,pointBorderWidth:0,clip:false},
      {label:'50%',data:[],borderColor:'rgba(255,170,0,.3)',borderWidth:1,borderDash:[4,4],pointRadius:0,fill:false,tension:0},
    ];
  }

  hitChart=new Chart(ctx,{
    type:'line',
    data:{labels:cLabels,datasets},
    options:{
      responsive:true,maintainAspectRatio:false,
      animation:{duration:220,easing:'easeOutQuart'},
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{
          display:compareMode,
          labels:{color:C_TICK,font:{family:"'Share Tech Mono'",size:10},usePointStyle:true,pointStyleWidth:8}
        },
        tooltip:{backgroundColor:'#0b1525',borderColor:'#1a3358',borderWidth:1,
          titleColor:'#8fbcdb',bodyColor:'#c5ddf0',
          titleFont:{family:"'Share Tech Mono'"},bodyFont:{family:"'Share Tech Mono'",size:11},
          padding:8,callbacks:ttCbs}
      },
      scales:{x:xAxis,y:yAxis}
    }
  });
}

function updateChartNormal(result,stats){
  if(!hitChart||!stats) return;
  const n=result.accessNum, hr=stats.hitRatio;
  cLabels.push(n); cVals.push(hr);
  cPtClrs.push(result.hit?C_HIT:C_MISS);
  cPtRad.fill(3); cPtRad.push(5);
  // Sync per-point radius array length
  hitChart.data.datasets[0].pointRadius=cPtRad;
  hitChart.data.datasets[1].data=cLabels.map(()=>.5);
  hitChart.update();
  $('chartStep').textContent=`Step ${n}`;
  $('chartHR').textContent=(hr*100).toFixed(1)+'% HR';
  $('chartHR').className=hr>=.5?'badge bg':'badge br';
}

function updateChartCompare(rLRU,stLRU,rFIFO,stFIFO){
  if(!hitChart||!stLRU||!stFIFO) return;
  const n=rLRU.accessNum;
  cLabels.push(n);
  cValsLRU.push(stLRU.hitRatio);  cPtLRU.push(rLRU.hit?C_HIT:C_MISS);
  cValsFIFO.push(stFIFO.hitRatio); cPtFIFO.push(rFIFO.hit?C_HIT:C_MISS);
  hitChart.data.datasets[2].data=cLabels.map(()=>.5);
  // Update point radii
  const radsLRU=cLabels.map((_,i)=>i===cLabels.length-1?5:3);
  hitChart.data.datasets[0].pointRadius=radsLRU;
  hitChart.data.datasets[1].pointRadius=[...radsLRU];
  hitChart.update();
  const hr=stLRU.hitRatio;
  $('chartStep').textContent=`Step ${n}`;
  $('chartHR').textContent=`LRU ${(stLRU.hitRatio*100).toFixed(1)}% / FIFO ${(stFIFO.hitRatio*100).toFixed(1)}%`;
  $('chartHR').className='badge bc';
}

/* ════════════════════════════════════════════════════════
   UI CONTROLLER
════════════════════════════════════════════════════════ */
let sim=null;          // Primary simulator
let simFIFO=null;      // Secondary (compare mode)
let simLRU=null;       // Secondary (compare mode)
let missDetector=null; // Miss type classifier
let trace=[], step=0, running=false, runTimer=null;
let cmpMode=false;     // Comparison mode active flag

const $=id=>document.getElementById(id);
const mkEl=(tag,cls)=>{ const e=document.createElement(tag); if(cls)e.className=cls; return e; };

/* Speed delays: Slow=1200ms, Normal=380ms, Fast=120ms, Turbo=16ms */
const SPEEDS=[1200,380,120,16];
const SPEED_LABELS=['0.25×','1×','4×','Turbo'];
function getDelay(){ return SPEEDS[+$('speedSlider').value]; }

function readCfg(){
  return {cacheSize:+$('cacheSize').value,blockSize:+$('blockSize').value,
          assoc:+$('assoc').value,policy:$('policy').value,
          hitTime:Math.max(1,+$('hitTime').value||1),
          missPenalty:Math.max(1,+$('missPenalty').value||10)};
}

function parseTrace(raw){
  const toks=raw.trim().split(/[\s,]+/).filter(Boolean), res=[];
  for(const t of toks){
    const n=(t.startsWith('0x')||t.startsWith('0X'))?parseInt(t,16):parseInt(t,10);
    if(isNaN(n)||n<0) return null;
    res.push(n);
  }
  return res;
}

function updateBitStrip(){
  try{
    const c=readCfg(), tb=c.cacheSize/c.blockSize;
    const ways=c.assoc===-1?tb:c.assoc, ns=tb/ways;
    const off=log2i(c.blockSize),idx=ns>1?log2i(ns):0,tag=32-off-idx;
    $('bsTag').textContent=tag+'b'; $('bsIdx').textContent=idx+'b'; $('bsOff').textContent=off+'b';
    $('geoTag').textContent=`${ns}sets × ${ways}ways | T:${tag} I:${idx} O:${off}`;
  } catch{}
}

/* ── RESET ──────────────────────────────────────────────── */
function reset(){
  stopRun();
  $('traceErr').textContent='';
  const parsed=parseTrace($('traceIn').value);
  if(!parsed||!parsed.length){
    $('traceErr').textContent=parsed===null?'⚠ Invalid address':'⚠ Enter addresses';
    return;
  }
  trace=parsed;
  $('traceCount').textContent=`${trace.length} addr${trace.length!==1?'s':''}`;
  try{
    const cfg=readCfg();
    sim=new CacheSimulator(cfg);
    if(cmpMode){
      simLRU =new CacheSimulator({...cfg,policy:'LRU'});
      simFIFO=new CacheSimulator({...cfg,policy:'FIFO'});
    }
    missDetector=new MissTypeDetector(sim.totalBlocks);
  } catch(e){ $('traceErr').textContent='⚠ '+e.message; return; }
  step=0;
  $('bMap').textContent=cmpMode?sim.mappingType:sim.mappingType;
  $('bPol').textContent=cmpMode?'LRU + FIFO':sim.policy;
  $('bSet').textContent=`${sim.numSets}×${sim.ways}`;
  $('cmpBadge').style.display=cmpMode?'inline-flex':'none';
  $('logBody').innerHTML=''; $('logH').textContent='0 Hits'; $('logM').textContent='0 Misses';
  initChart(cmpMode);
  renderGrids(-1,null,null);
  updateStats(null);
  updateProgress();
  $('btnNext').disabled=false; $('btnRun').disabled=false;
  $('btnRun').textContent='▶ RUN ALL'; $('btnRun').className='btn btn-run';
  showCapIdle();
}

function showCapIdle(){
  $('capIdle').style.display='flex'; $('capActive').style.display='none'; $('capDone').style.display='none';
}
function showCapDone(){
  $('capIdle').style.display='none'; $('capActive').style.display='none';
  $('capDone').style.display='flex'; $('capDoneTotal').textContent=String(trace.length);
}

/* ── STEP ────────────────────────────────────────────────── */
function doStep(){
  if(!sim||step>=trace.length) return;
  const addr=trace[step];

  // Core simulation
  const r=sim.access(addr);

  // Compare mode: also run the alternate-policy sims
  let rLRU=null, rFIFO=null;
  if(cmpMode){
    rLRU =simLRU.access(addr);
    rFIFO=simFIFO.access(addr);
  }

  step++;

  // Classify miss type using primary sim's result
  const missType=missDetector.classify(r.tag, r.hit);
  r.missType=missType;

  // Update UI
  updateCAP(r, missType);
  renderGrids(r.index, r, cmpMode?{rLRU,rFIFO}:null);
  addLogRow(r, missType);
  updateStats(sim.getStats(), missDetector);
  if(cmpMode) updateChartCompare(rLRU,simLRU.getStats(),rFIFO,simFIFO.getStats());
  else        updateChartNormal(r,sim.getStats());
  updateProgress();

  if(step>=trace.length){
    $('btnNext').disabled=true; $('btnRun').disabled=true;
    showCapDone();
  }
}

/* ── CAP (Current Access Panel) ──────────────────────────── */
function updateCAP(r, missType){
  $('capIdle').style.display='none'; $('capDone').style.display='none'; $('capActive').style.display='block';
  const inner=$('capInner'); inner.classList.remove('animate'); void inner.offsetWidth; inner.classList.add('animate');

  $('capStepNum').textContent=`Step ${r.accessNum} of ${trace.length}`;
  $('capAddrVal').textContent=String(r.address);
  $('capAddrHex').textContent=r.hex;
  $('cbTagV').textContent=r.tag; $('cbIdxV').textContent=r.index; $('cbOffV').textContent=r.offset;

  const badge=$('capBadge');
  badge.className='cap-result-badge '+(r.hit?'hit':'miss');
  badge.textContent=r.hit?'HIT ✓':'MISS ✗';
  $('capEvicted').textContent=r.evicted!==null?`Evicted Tag ${r.evicted}`:'';

  // Miss type badge
  const mtb=$('missTypeBadge');
  if(!missType){ mtb.className='miss-type-badge none'; mtb.textContent='—'; }
  else if(missType==='COMPULSORY'){ mtb.className='miss-type-badge comp'; mtb.textContent='COLD'; }
  else if(missType==='CONFLICT'){   mtb.className='miss-type-badge conf'; mtb.textContent='CONFLICT'; }
  else{                             mtb.className='miss-type-badge cap';  mtb.textContent='CAPACITY'; }

  // Queue
  const q=$('capQueue'); q.innerHTML='';
  const lb=mkEl('span','cq-lbl'); lb.textContent='Queue:'; q.appendChild(lb);
  const cur=mkEl('span','cq-cur'); cur.textContent=String(r.address)+'  ✓'; q.appendChild(cur);
  const upcoming=trace.slice(step,step+7);
  if(!upcoming.length){ const d=mkEl('span','cq-dot'); d.textContent='  — end'; q.appendChild(d); }
  else{
    const d=mkEl('span','cq-dot'); d.textContent='→'; q.appendChild(d);
    upcoming.forEach((a,i)=>{
      const p=mkEl('span','cq-nxt'); p.textContent=String(a);
      if(i===0){ p.style.borderColor='var(--acc)'; p.style.color='var(--acc)'; }
      q.appendChild(p);
    });
    if(trace.length-step>7){ const m=mkEl('span','cq-dot'); m.textContent=`+${trace.length-step-7}`; q.appendChild(m); }
  }
}

/* ── Run All ────────────────────────────────────────────────── */
function startRun(){
  if(running){stopRun();return;}
  if(!sim||step>=trace.length) return;
  running=true;
  $('btnRun').textContent='⏹ STOP'; $('btnRun').className='btn btn-stop';
  $('btnNext').disabled=true;
  function tick(){
    if(!running||step>=trace.length){stopRun();return;}
    doStep();
    if(step<trace.length) runTimer=setTimeout(tick,getDelay());
    else stopRun();
  }
  tick();
}
function stopRun(){
  running=false; clearTimeout(runTimer);
  $('btnRun').textContent='▶ RUN ALL'; $('btnRun').className='btn btn-run';
  if(sim&&step<trace.length) $('btnNext').disabled=false;
}

/* ── Render Grid(s) ──────────────────────────────────────────
   In normal mode:  renders single grid into #gridCont
   In compare mode: renders two side-by-side grids inside #gridsWrap
──────────────────────────────────────────────────────────── */
function buildGrid(simRef,activeSet,result){
  const isLRU=simRef.policy==='LRU', state=simRef.getCacheState(), ns=simRef.numSets, nw=simRef.ways;
  const tbl=mkEl('table','cgrid');
  // Header
  const thead=mkEl('thead'), hr=mkEl('tr');
  const th0=mkEl('th','th-set'); th0.textContent='Set'; hr.appendChild(th0);
  for(let w=0;w<nw;w++){
    const th=mkEl('th','th-way'); let lbl=`Way ${w}`;
    if(nw>1){ if(w===0){lbl+=isLRU?' ✦MRU':' ↑New';th.classList.add('th-mru');} if(w===nw-1){lbl+=' ⚑Evict';th.classList.add('th-lru');} }
    th.textContent=lbl; hr.appendChild(th);
  }
  thead.appendChild(hr); tbl.appendChild(thead);
  // Rows
  const tbody=mkEl('tbody');
  for(let s=0;s<ns;s++){
    const isA=(s===activeSet);
    const row=mkEl('tr',`set-row${isA?' ar':''}`);
    const std=mkEl('td','td-s'), sl=mkEl('div','slbl');
    const sn=mkEl('div','snum'); sn.textContent=String(s); sl.appendChild(sn);
    const sa=mkEl('div','sarr'); sa.textContent='►'; sl.appendChild(sa);
    std.appendChild(sl); row.appendChild(std);
    const ways=state[s];
    for(let w=0;w<nw;w++){
      const tag=ways[w], empty=tag===null;
      let ac=''; if(result&&s===activeSet&&!empty&&tag===result.tag) ac=result.hit?' a-hit':' a-load';
      const td=mkEl('td',`td-w${empty?' empty':' occ'}${ac}`);
      const ci=mkEl('div','ci');
      const ct=mkEl('div','ct'); ct.textContent=empty?'—':`Tag: ${tag}`; ci.appendChild(ct);
      if(!empty&&nw>1){
        const cbs=mkEl('div','cbs');
        const filled=ways.filter(t=>t!==null).length;
        if(w===0){ const b=mkEl('span',`cb ${isLRU?'cb-m':'cb-n'}`); b.textContent=isLRU?'MRU':'NEW'; cbs.appendChild(b); }
        if(w===filled-1&&filled===nw){ const b=mkEl('span',`cb ${isLRU?'cb-l':'cb-o'}`); b.textContent=isLRU?'LRU':'OLD'; cbs.appendChild(b); }
        if(isA&&w===0){ const b=mkEl('span','cb cb-n'); b.textContent='✦'; cbs.appendChild(b); }
        if(cbs.children.length) ci.appendChild(cbs);
      }
      td.appendChild(ci); row.appendChild(td);
    }
    tbody.appendChild(row);
  }
  tbl.appendChild(tbody); return tbl;
}

function renderGrids(activeSet, result, cmpData){
  if(!sim) return;
  const wrap=$('gridsWrap');
  if(!cmpData){
    // Normal single-grid mode
    wrap.classList.remove('cmp-active');
    const cont=$('gridCont');
    cont.style.display='block';
    cont.innerHTML='';
    cont.appendChild(buildGrid(sim,activeSet,result));
  } else {
    // Comparison mode: two grids side by side
    wrap.classList.add('cmp-active');
    const cont=$('gridCont');
    cont.style.display='none'; // hide single grid
    // Clear any existing cmp columns from wrap (except gridCont)
    [...wrap.querySelectorAll('.cmp-col')].forEach(el=>el.remove());

    const {rLRU,rFIFO}=cmpData;
    [
      {simR:simLRU,  r:rLRU,  hdrCls:'lru-hdr',  label:'LRU'},
      {simR:simFIFO, r:rFIFO, hdrCls:'fifo-hdr', label:'FIFO'},
    ].forEach(({simR,r,hdrCls,label})=>{
      const col=mkEl('div','cmp-col');
      const hdr=mkEl('div',`cmp-col-hdr ${hdrCls}`); hdr.textContent=label; col.appendChild(hdr);
      const gw=mkEl('div','cmp-grid-wrap'); gw.appendChild(buildGrid(simR,activeSet,r)); col.appendChild(gw);
      wrap.appendChild(col);
    });
  }
}

/* ── Add log row ──────────────────────────────────────────── */
function addLogRow(r, missType){
  const tbody=$('logBody');
  const prev=tbody.querySelector('tr.latest'); if(prev)prev.classList.remove('latest');
  const row=mkEl('tr','nr latest');
  const mtTxt=missType?{COMPULSORY:'COLD',CONFLICT:'CONFLICT',CAPACITY:'CAPACITY'}[missType]:'—';
  const mtCls=missType?{COMPULSORY:'mt-comp',CONFLICT:'mt-conf',CAPACITY:'mt-cap'}[missType]:'';
  [
    {t:r.accessNum,c:''},
    {t:r.address,c:''},
    {t:r.hex,c:''},
    {t:r.tag,c:'ct2'},
    {t:r.index,c:'ci2'},
    {t:r.offset,c:'co2'},
    {t:r.hit?'HIT ✓':'MISS ✗',c:r.hit?'rh':'rm'},
    {t:mtTxt,c:mtCls},
    {t:r.evicted!==null?`Tag ${r.evicted}`:'—',c:r.evicted!==null?'rev':''},
  ].forEach(({t,c})=>{ const td=mkEl('td',c); td.textContent=t; row.appendChild(td); });
  tbody.prepend(row);
  const st=sim.getStats();
  if(st){ $('logH').textContent=`${st.hits} Hit${st.hits!==1?'s':''}`; $('logM').textContent=`${st.misses} Miss${st.misses!==1?'es':''}`; }
  while(tbody.children.length>300) tbody.removeChild(tbody.lastChild);
}

/* ── Stats bar ──────────────────────────────────────────────── */
function updateStats(st,md){
  const bump=id=>{ const e=$(id); if(!e)return; e.classList.remove('bmp'); void e.offsetWidth; e.classList.add('bmp'); };
  if(!st){
    ['sT','sH','sM','sHR','sAM','sCold','sConf','sCap'].forEach(id=>$(id).textContent='0');
    $('sHR').textContent='—'; $('sAM').textContent='—';
    $('fml').innerHTML='AMAT = Hit Time + Miss Rate × Miss Penalty'; return;
  }
  $('sT').textContent=st.total; $('sH').textContent=st.hits; $('sM').textContent=st.misses;
  $('sHR').textContent=(st.hitRatio*100).toFixed(1)+'%';
  $('sAM').textContent=st.amat.toFixed(2);
  if(md){ $('sCold').textContent=md.compulsory; $('sConf').textContent=md.conflict; $('sCap').textContent=md.capacity; }
  const ht=sim.hitTime,mp=sim.missPenalty;
  $('fml').innerHTML=`AMAT = <span>${ht}</span> + <span>${(st.missRate*100).toFixed(1)}%</span> × <span>${mp}</span> = <span>${st.amat.toFixed(2)} cyc</span>`;
  ['sT','sH','sM','sHR','sAM','sCold','sConf','sCap'].forEach(bump);
}

/* ── Progress ─────────────────────────────────────────────── */
function updateProgress(){
  if(!trace.length){ $('progFill').style.width='0%'; $('progStep').textContent='Step 0'; $('progTotal').textContent='/ 0'; return; }
  $('progFill').style.width=(step/trace.length*100)+'%';
  $('progStep').textContent=`Step ${step}`;
  $('progTotal').textContent=`/ ${trace.length}`;
}

/* ── Live trace validation ────────────────────────────────── */
function valTrace(){
  const raw=$('traceIn').value;
  if(!raw.trim()){ $('traceCount').textContent='0 addresses'; $('traceErr').textContent=''; return; }
  const p=parseTrace(raw);
  $('traceErr').textContent=p===null?'⚠ Invalid address found':'';
  $('traceCount').textContent=p?`${p.length} addr${p.length!==1?'s':''}`:'';
}

/* ════════════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded',()=>{
  $('traceIn').value='0 8 16 0 8 24 16 0 32 8 0 24 8 0 16';
  valTrace(); updateBitStrip();

  ['cacheSize','blockSize','assoc','policy'].forEach(id=>$(id).addEventListener('change',updateBitStrip));
  $('traceIn').addEventListener('input',valTrace);

  // Speed slider
  $('speedSlider').addEventListener('input',()=>{
    $('speedLbl').textContent=SPEED_LABELS[+$('speedSlider').value];
  });

  // Compare mode toggle
  $('btnCmp').addEventListener('click',()=>{
    cmpMode=!cmpMode;
    $('btnCmp').classList.toggle('active',cmpMode);
    $('btnCmp').textContent=cmpMode?'✓ COMPARE MODE ON':'⇌ COMPARE FIFO vs LRU';
    // Disable policy selector in compare mode (both run simultaneously)
    $('policy').disabled=cmpMode;
  });

  $('btnReset').addEventListener('click',reset);

  $('btnNext').addEventListener('click',()=>{ if(!sim)reset(); doStep(); });

  $('btnRun').addEventListener('click',()=>{
    if(!sim)reset(); if(running)stopRun(); else startRun();
  });

  // Keyboard: Space/N = step, R = reset, Enter = run/stop, +/- = speed
  document.addEventListener('keydown',e=>{
    if(e.target.tagName==='TEXTAREA'||e.target.tagName==='INPUT') return;
    if((e.key===' '||e.key==='n'||e.key==='N')&&!$('btnNext').disabled){ e.preventDefault(); doStep(); }
    if(e.key==='r'||e.key==='R') reset();
    if(e.key==='Enter'&&!$('btnRun').disabled){ running?stopRun():startRun(); }
    if(e.key==='+'){
      const s=$('speedSlider'); s.value=Math.min(3,+s.value+1); $('speedLbl').textContent=SPEED_LABELS[+s.value];
    }
    if(e.key==='-'){
      const s=$('speedSlider'); s.value=Math.max(0,+s.value-1); $('speedLbl').textContent=SPEED_LABELS[+s.value];
    }
  });
});
</script>
