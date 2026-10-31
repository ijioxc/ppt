/* 刷題引擎：所有科目共用。題目資料放在 exams/<id>.js，由 play.html?exam=<id> 載入 */
const pick=(a,b,s=1)=>a+s*Math.floor(Math.random()*(Math.floor((b-a)/s)+1));
function fmt(v){
  if(!isFinite(v)) return '—';
  const r=Math.round(v*1e6)/1e6;
  if(Number.isInteger(r)) return String(r);
  const a=Math.abs(v);
  return String(parseFloat(v.toFixed(a>=10?1:2)));
}
function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function makeOpts(b){
  let correct,wrongs;
  if(b.correct){correct=b.correct;wrongs=b.wrongs}
  else{correct=fmt(b.ans)+b.unit;wrongs=b.wr.map(v=>fmt(v)+b.unit)}
  const set=[correct];
  for(const w of wrongs){if(set.length<4&&!set.includes(w)&&!w.startsWith('—'))set.push(w)}
  const fill=[1.25,0.8,1.5,0.6,3,0.3];let i=0;
  while(set.length<4&&b.ans!==undefined&&i<fill.length){const w=fmt(b.ans*fill[i++])+b.unit;if(!set.includes(w))set.push(w)}
  const opts=shuffle(set);
  return{opts,ci:opts.indexOf(correct)};
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const $=s=>document.querySelector(s);
const L='ABCDEF';
const qImg=q=>q.img?`<a class="q-img" href="${esc(q.img)}" target="_blank" rel="noopener" aria-label="在新分頁開啟附圖"><img src="${esc(q.img)}" alt="${esc(q.short)} 附圖" loading="lazy"></a>`:'';

/* ---------- 進度（只存在這台裝置的瀏覽器，每個科目分開） ---------- */
const storeKey=id=>'quiz:'+id;
function loadProgress(id){try{return JSON.parse(localStorage.getItem(storeKey(id)))||null}catch(e){return null}}

const QUIZ={register(exam){QUIZ.exam=exam;boot(exam)}};

function boot(E){
  const BANK=E.bank,GEN=E.gen||{},Q=Object.fromEntries(BANK.map(q=>[q.id,q]));
  const CALC_IDS=BANK.filter(q=>q.gen).map(q=>q.id),TOTAL=BANK.length;
  const setLabel=id=>(E.sets.find(s=>s.id===id)||{}).label||'';
  let S={rec:{},wrong:[],scope:'all',order:'seq'};
  const saved=loadProgress(E.id);if(saved&&saved.rec)S=Object.assign(S,saved);
  const save=()=>{try{localStorage.setItem(storeKey(E.id),JSON.stringify(S))}catch(e){}};
  const rec=id=>S.rec[id]||(S.rec[id]={o:null,v:0});
  function status(id){
    const r=S.rec[id];if(!r)return'';
    if(S.wrong.includes(id))return'bad';
    if(r.o==='ok'&&(!Q[id].gen||r.v>=2))return'mast';
    if(r.o==='ok')return'ok';
    return r.o==='bad'?'bad':'';
  }
  const mastered=()=>BANK.filter(q=>status(q.id)==='mast').length;

  /* 頁面骨架 */
  document.title=E.title+'・刷題本';
  $('#eyebrow').textContent=E.eyebrow||'';
  $('#title').textContent=E.title;
  const scopeEl=$('#scope');
  scopeEl.innerHTML=`<option value="all">全部（${TOTAL} 題）</option>`
    +(E.sets.length>1?E.sets.map(s=>`<option value="${s.id}">只刷${esc(s.label)}</option>`).join(''):'')
    +(CALC_IDS.length?`<option value="calc">計算特訓（無限換數字）</option>`:'')
    +`<option value="wrong">只刷錯題</option>`;

  /* 刷題流程 */
  let queue=[],pos=0,cur=null,round={ok:0,n:0};
  function buildQueue(){
    let ids;
    if(S.scope==='wrong')ids=BANK.map(q=>q.id).filter(id=>S.wrong.includes(id));
    else if(S.scope==='calc')ids=[];
    else if(S.scope==='all')ids=BANK.map(q=>q.id);
    else ids=BANK.filter(q=>String(q.set)===String(S.scope)).map(q=>q.id);
    queue=S.order==='rnd'?shuffle(ids):ids;pos=0;round={ok:0,n:0};
  }
  function load(id,variant){
    const q=Q[id];
    stopSpeech();
    if(q.sol){
      cur={id,self:true,text:q.q,revealed:false,done:false,pick:-1,ci:0,opts:[]};
    }else if(variant){
      const g=GEN[q.gen],b=g.build(g.rand()),m=makeOpts(b);
      cur={id,variant:true,text:b.q,opts:m.opts,ci:m.ci,steps:b.steps,exp:'',done:false,pick:-1};
    }else{
      const order=shuffle(q.o.map((_,i)=>i));
      cur={id,variant:false,text:q.q,opts:order.map(i=>q.o[i]),ci:order.indexOf(q.a),
        steps:q.gen?GEN[q.gen].build(GEN[q.gen].orig).steps:null,exp:q.exp,done:false,pick:-1};
    }
    render();
  }
  function next(){
    if(S.scope==='calc'){load(CALC_IDS[Math.floor(Math.random()*CALC_IDS.length)],true);return}
    pos++;
    if(pos>=queue.length){cur=null;render();return}
    load(queue[pos],false);
  }
  function start(){
    buildQueue();
    if(S.scope==='calc'&&CALC_IDS.length){next();return}
    if(!queue.length){cur=null;render();return}
    load(queue[0],false);
  }
  const canSpeak=()=>'speechSynthesis' in window;
  let speaking=false;
  function stopSpeech(){if(canSpeak())window.speechSynthesis.cancel();speaking=false}
  function toggleSpeech(){
    const q=Q[cur.id];if(!q.script||!canSpeak())return;
    if(speaking){stopSpeech();render();return}
    stopSpeech();
    const u=new SpeechSynthesisUtterance(q.script.replace(/\n/g,' '));
    u.lang='en-US';u.rate=.9;
    u.onend=()=>{speaking=false;render()};
    window.speechSynthesis.speak(u);speaking=true;render();
  }
  function answer(i){
    if(!cur||cur.done||(!cur.self&&i>=cur.opts.length))return;
    cur.done=true;cur.pick=i;
    const ok=i===cur.ci,r=rec(cur.id);
    if(cur.variant){if(ok)r.v++}else r.o=ok?'ok':'bad';
    if(!ok){if(!S.wrong.includes(cur.id))S.wrong.push(cur.id)}
    else if(r.o==='ok')S.wrong=S.wrong.filter(x=>x!==cur.id);
    round.n++;if(ok)round.ok++;
    save();render();
    const fb=document.getElementById('nextbtn');if(fb)fb.focus({preventScroll:true});
  }

  /* 畫面 */
  function renderStats(){
    const done=BANK.filter(q=>S.rec[q.id]&&S.rec[q.id].o).length;
    $('#stats').innerHTML=`<div class="stat m"><b>${mastered()}<small>/${TOTAL}</small></b><span>精通</span></div>
    <div class="stat"><b>${done}</b><span>做過原題</span></div>
    <div class="stat w"><b>${S.wrong.length}</b><span>錯題</span></div>`;
    $('#wcnt').textContent=S.wrong.length?S.wrong.length:'';
  }
  function renderCard(){
    const c=$('#card');
    if(S.scope==='calc')$('#pos').textContent=`計算特訓 · 這輪 ${round.ok}/${round.n}`;
    else $('#pos').textContent=cur?`第 ${pos+1} / ${queue.length} 題 · 這輪答對 ${round.ok}`:'';
    if(!cur){
      if(S.scope==='wrong'&&!queue.length){c.innerHTML=`<div class="empty"><b>錯題本是空的</b>答錯的題目會自動收進來，答對原題後就會移出。</div>`;return}
      const pct=round.n?Math.round(round.ok/round.n*100):0;
      c.innerHTML=`<div class="done"><div class="note">這輪完成</div><div class="big">${round.ok} / ${round.n}</div><p>答對率 ${pct}%。${S.wrong.length?`還有 ${S.wrong.length} 題在錯題本。`:'錯題本已清空。'}</p>
        <div class="acts">${S.wrong.length?`<button class="btn pri" data-act="dowrong">刷錯題（${S.wrong.length}）</button>`:''}<button class="btn${S.wrong.length?'':' pri'}" data-act="again">隨機再來一輪</button></div></div>`;
      return;
    }
    const q=Q[cur.id],st=status(cur.id);
    let h=`<div class="meta"><span class="chip">${esc(setLabel(q.set))} · ${q.no?esc(q.no):`第 ${q.n} 題`}</span><span class="chip">${esc(q.topic)}</span>`;
    if(cur.variant)h+=`<span class="chip var">換數字版</span>`;
    if(st==='mast')h+=`<span class="chip mast">已精通</span>`;
    h+=`</div>`;
    if(q.script){
      h+=`<div class="listen">${canSpeak()?`<button class="btn" data-act="speak">${speaking?'停止':'朗讀對話'}</button>`:''}
      <details class="deep"${cur.done||!canSpeak()?' open':''}><summary>聽力原文</summary><div class="in script">${q.scriptTitle?`<b>${esc(q.scriptTitle)}</b>\n\n`:''}${esc(q.script)}</div></details></div>`;
    }
    h+=`<p class="qtext">${esc(cur.text)}</p>${qImg(q)}`;
    if(cur.self){
      h+=`<div class="wk">${q.html}</div>`;
      if(!cur.revealed){
        h+=`<p class="hint">先在紙上算完，再看解答。</p><div class="acts"><button class="btn pri" id="nextbtn" data-act="reveal">看解答<kbd>Enter</kbd></button></div>`;
      }else{
        h+=`<div class="wk wk-sol">${q.sol}</div>`;
        if(!cur.done)h+=`<div class="acts"><button class="btn pri" data-self="1">我算對了<kbd>1</kbd></button><button class="btn" data-self="0">還不會<kbd>2</kbd></button></div>`;
        else h+=`<div class="fb"><div class="verdict ${cur.pick===cur.ci?'ok':'bad'}">${cur.pick===cur.ci?'記為會了':'收進錯題本了'}</div></div><div class="acts"><button class="btn pri" id="nextbtn" data-act="next">下一題<kbd>Enter</kbd></button></div>`;
      }
      c.innerHTML=h;return;
    }
    h+=`<div class="opts">`;
    cur.opts.forEach((o,i)=>{
      let cls='opt';
      if(cur.done){if(i===cur.ci)cls+=' right';else if(i===cur.pick)cls+=' wrong';else cls+=' dim'}
      h+=`<button class="${cls}" data-opt="${i}" ${cur.done?'disabled':''}><span class="k">${L[i]}</span><span class="t">${esc(o)}</span></button>`;
    });
    h+=`</div>`;
    if(!cur.done){
      h+=`<p class="hint">按 1–${cur.opts.length} 或 A–${L[cur.opts.length-1]} 作答。選項順序每次打亂，要記的是內容，不是字母。</p>`;
    }else{
      const ok=cur.pick===cur.ci;
      h+=`<div class="fb"><div class="verdict ${ok?'ok':'bad'}">${ok?'答對了':'答錯了'} <span class="ansline">正解：${L[cur.ci]}. ${esc(cur.opts[cur.ci])}</span></div>`;
      if(cur.exp)h+=`<div class="box"><h3>解釋</h3><p>${esc(cur.exp)}</p></div>`;
      if(cur.steps)h+=`<div class="box"><h3>計算步驟</h3><ol class="steps">${cur.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol></div>`;
      if(q.deep)h+=`<details class="deep"${ok?'':' open'}><summary>看懂為什麼（觀念與陷阱）</summary><div class="in">${q.deep}</div></details>`;
      const r=rec(cur.id);
      if(q.gen&&r.o==='ok'&&r.v<2)h+=`<p class="note">這題要精通：原題答對 ＋ 換數字答對 2 次（目前 ${r.v}/2）。</p>`;
      h+=`</div><div class="acts"><button class="btn pri" id="nextbtn" data-act="next">${S.scope==='calc'?'下一題（隨機）':'下一題'}<kbd>Enter</kbd></button>`;
      if(q.gen)h+=`<button class="btn" data-act="variant">同一題換數字<kbd>N</kbd></button>`;
      h+=`</div>`;
    }
    c.innerHTML=h;
  }
  function renderMap(){
    let h=`<h2>${TOTAL} 題進度（點格子跳到該題）</h2>`;
    E.sets.forEach(s=>{
      const qs=BANK.filter(q=>q.set===s.id);
      h+=`<div class="maprow"><span class="lb">${esc(s.label)}</span><div class="cells">`;
      qs.forEach(q=>{
        h+=`<button class="cell ${status(q.id)}${cur&&cur.id===q.id?' cur':''}" data-jump="${q.id}" title="${esc(q.short)}" aria-label="${esc(s.label)} 第${q.n}題 ${esc(q.short)}">${q.n}</button>`;
      });
      h+=`</div></div>`;
    });
    h+=`<div class="legend"><span><i></i>還沒做</span><span><i class="l-bad"></i>錯題</span><span><i class="l-ok"></i>答對過</span><span><i class="l-mast"></i>${CALC_IDS.length?'精通（計算題要再換數字對 2 次）':'精通'}</span></div>`;
    $('#map').innerHTML=h;
  }
  let resetArm=false;
  const resetHtml=()=>`<p><button class="reset${resetArm?' arm':''}" data-act="reset">${resetArm?'再按一次確定清除這科的進度':'清除這科的進度'}</button></p>`;
  function renderWrong(){
    const v=$('#v-wrong');
    if(!S.wrong.length){v.innerHTML=`<div class="card empty"><b>目前沒有錯題</b>去「刷題」做一輪，答錯的會自動收進來。</div>`+resetHtml();return}
    const ids=BANK.map(q=>q.id).filter(id=>S.wrong.includes(id));
    v.innerHTML=`<div class="bar"><button class="btn pri" data-act="dowrong">全部重刷（${ids.length} 題）</button><span class="note">答對原題就會移出錯題本。</span></div>
    <div class="wl">${ids.map(id=>{const q=Q[id];return`<div class="wi"><div class="tt"><small>${esc(setLabel(q.set))} 第 ${q.n} 題 · ${esc(q.topic)}</small>${esc(q.short)}</div><button class="btn" data-jump="${id}">練這題</button></div>`}).join('')}</div>`+resetHtml();
  }
  function renderLearn(){
    let h='';
    if(E.formulas&&E.formulas.length)h+=`<h2>公式總表</h2><div class="tblwrap"><table><thead><tr><th>公式</th><th>用途</th><th>出處</th></tr></thead><tbody>${E.formulas.map(f=>`<tr><td class="fm">${f[0]}</td><td>${f[1]}</td><td>${f[2]}</td></tr>`).join('')}</tbody></table></div>`;
    if(E.unitNote)h+=`<p class="note">${esc(E.unitNote)}</p>`;
    E.sets.forEach(s=>{
      h+=`<h2>${esc(s.label)}：依觀念分組</h2>`;
      const qs=BANK.filter(q=>q.set===s.id);
      [...new Set(qs.map(q=>q.topic))].forEach(t=>{
        h+=`<div class="grp"><h3>${esc(t)}</h3>`;
        qs.filter(q=>q.topic===t).forEach(q=>{
          h+=`<details class="item"><summary><span class="dot ${status(q.id)}"></span><span class="no">${q.no?esc(q.no):`第 ${q.n} 題`}</span><span class="tt">${esc(q.short)}</span></summary>
          <div class="in">${q.sol?`<div class="wk">${q.html}</div><div class="wk wk-sol">${q.sol}</div>`:`<p class="qtext-sm">${esc(q.q)}</p>${qImg(q)}<p class="ans">答案：${esc(q.o[q.a])}</p><p>${esc(q.exp)}</p>${q.deep||''}`}
          <p><button class="btn" data-jump="${q.id}">去練這題</button></p></div></details>`;
        });
        h+=`</div>`;
      });
    });
    $('#v-learn').innerHTML=h;
  }
  let view='drill';
  function render(){
    renderStats();
    if(view==='drill'){renderCard();renderMap()}
    if(view==='wrong')renderWrong();
    if(view==='learn')renderLearn();
  }
  function show(v){
    view=v;
    document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected',t.dataset.v===v));
    ['drill','wrong','learn'].forEach(x=>$('#v-'+x).hidden=x!==v);
    resetArm=false;render();
  }
  function jump(id){
    show('drill');
    let i=queue.indexOf(id);
    if(i<0||S.scope==='calc'){S.scope='all';S.order='seq';scopeEl.value='all';$('#order').value='seq';save();buildQueue();i=queue.indexOf(id)}
    pos=i;load(id,false);
    window.scrollTo({top:0,behavior:'smooth'});
  }

  /* 事件 */
  document.addEventListener('click',e=>{
    const t=e.target.closest('[data-opt],[data-self],[data-act],[data-jump],.tab');if(!t)return;
    if(t.classList.contains('tab'))return show(t.dataset.v);
    if(t.dataset.opt!==undefined)return answer(+t.dataset.opt);
    if(t.dataset.self!==undefined)return answer(t.dataset.self==='1'?0:1);
    if(t.dataset.jump)return jump(t.dataset.jump);
    const a=t.dataset.act;
    if(a==='next')next();
    else if(a==='variant')load(cur.id,true);
    else if(a==='speak')toggleSpeech();
    else if(a==='reveal'){cur.revealed=true;render()}
    else if(a==='again'){S.order='rnd';$('#order').value='rnd';save();start()}
    else if(a==='dowrong'){S.scope='wrong';scopeEl.value='wrong';save();show('drill');start()}
    else if(a==='reset'){
      if(!resetArm){resetArm=true;render();return}
      S.rec={};S.wrong=[];resetArm=false;save();start();render();
    }
  });
  scopeEl.addEventListener('change',e=>{S.scope=e.target.value;save();start()});
  $('#order').addEventListener('change',e=>{S.order=e.target.value;save();start()});
  document.addEventListener('keydown',e=>{
    if(view!=='drill'||!cur||e.metaKey||e.ctrlKey||e.altKey)return;
    if(e.target.tagName==='SELECT')return;
    const k=e.key.toLowerCase();
    if(cur.self&&!cur.done){
      if(!cur.revealed&&k==='enter'){e.preventDefault();cur.revealed=true;render()}
      else if(cur.revealed&&(k==='1'||k==='2')){e.preventDefault();answer(k==='1'?0:1)}
      return;
    }
    if(!cur.done){const i='123456'.indexOf(k)>=0?'123456'.indexOf(k):'abcdef'.indexOf(k);if(i>=0&&i<cur.opts.length){e.preventDefault();answer(i)}}
    else if(k==='enter'||k==='arrowright'){e.preventDefault();next()}
    else if(k==='n'&&Q[cur.id].gen&&!cur.self){e.preventDefault();load(cur.id,true)}
  });

  if(![...scopeEl.options].some(o=>o.value===String(S.scope)))S.scope='all';
  scopeEl.value=S.scope;$('#order').value=S.order;
  start();
}

/* 依網址 ?exam=<id> 載入題庫 */
(function(){
  const id=new URLSearchParams(location.search).get('exam')||'';
  const fail=m=>{$('#card').innerHTML=`<div class="empty"><b>${m}</b><a href="./">回科目列表</a></div>`};
  if(!/^[a-z0-9-]+$/.test(id))return fail('網址沒有指定科目');
  const s=document.createElement('script');
  s.src=`exams/${id}.js`;
  s.onerror=()=>fail('找不到這個科目的題庫');
  document.head.appendChild(s);
})();
