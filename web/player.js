// 網頁簡報播放器：讀同資料夾的 deck.json（由 pptx2web.py 產生）
const deck = await (await fetch('deck.json', { cache: 'no-cache' })).json();
const [W, H] = deck.size;
const EASE = 'cubic-bezier(.65,0,.35,1)';
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const PT = 4 / 3;
document.title = deck.title;

document.body.innerHTML = `<div id="fit"><div id="stage" style="width:${W}px;height:${H}px"></div></div>
<div id="hud"><button id="prev">‹</button><span id="count"></span><button id="next">›</button><button id="fs" title="全螢幕 (F)">⛶</button></div>`;
const stage = document.getElementById('stage'), hud = document.getElementById('hud');
const fit = () => stage.style.transform = `translate(-50%,-50%) scale(${Math.min(innerWidth / W, innerHeight / H)})`;
addEventListener('resize', fit); fit();

/* ---------- 內容 ---------- */
const FALLBACK = { Calibri: 'Carlito', 'Calibri Light': 'Carlito' };
const family = (f, base) => [...(f || []), base].filter(Boolean).flatMap(n => [n, FALLBACK[n]]).filter(Boolean).map(n => `'${n}'`).join(',')
  + (/Songti|Ming|Serif/i.test((f || []).join()) ? ",'Songti TC','Noto Serif TC',serif" : ",'PingFang TC','Noto Sans TC',sans-serif");
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// 排版微調（不改原本的字級與位置）：重點字提亮加粗、內文退一階、中文加字距、多行內文放寬行距
const CJK = /[\u3400-\u9fff]/;
function textHTML(t) {
  const anchor = { t: 'flex-start', ctr: 'center', b: 'flex-end' }[t.anchor] || 'flex-start';
  const runs = t.p.flatMap(p => p.runs.filter(r => r.t && r.t.trim()));
  const count = {}; runs.forEach(r => count[r.sz || 18] = (count[r.sz || 18] || 0) + r.t.length);
  const base = +Object.keys(count).sort((a, b) => count[b] - count[a])[0] || 18;     // 佔最多字的字級＝內文
  const hasEm = runs.some(r => (r.sz || 18) > base * 1.15), lines = t.p.filter(p => p.runs.length).length;
  const ps = t.p.map(p => {
    const align = { ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[p.algn] || 'left';
    const html = p.runs.map(r => {
      if (r.br) return '<br>';
      const sz = r.sz || 18, em = hasEm && sz > base * 1.15, cjk = CJK.test(r.t);
      const track = r.spc ? r.spc * PT + 'px' : cjk ? (sz >= 28 ? '.1em' : '.05em') : '0';
      return `<span style="font-size:${sz * t.scale * PT}px;color:${em ? '#fff' : r.c || t.c};font-family:${family(r.f, t.font)};font-weight:${r.b || em ? 600 : 400};${r.i ? 'font-style:italic;' : ''}letter-spacing:${track};${hasEm && !em ? 'opacity:.72;' : ''}">${esc(r.t)}</span>`;
    }).join('');
    const lh = p.lh ? p.lh * 1.2 : lines > 1 && runs.some(r => CJK.test(r.t)) ? 1.5 : 1.2;
    return `<p style="text-align:${align};line-height:${lh};${html ? '' : `font-size:${(p.sz || 18) * t.scale * PT}px`}">${html || '&nbsp;'}</p>`;
  }).join('');
  return `<div class="tx ${t.wrap ? '' : 'nowrap'}" style="justify-content:${anchor};padding:${t.ins[1]}px ${t.ins[2]}px ${t.ins[3]}px ${t.ins[0]}px">${ps}</div>`;
}

function content(s) {
  const el = document.createElement('div');
  el.className = 'el ' + s.kind; el.dataset.id = s.id;
  if (s.kind === 'pic') {
    const [l, t, r, b] = s.crop || [0, 0, 0, 0], w = 1 - l - r, h = 1 - t - b;
    el.innerHTML = `<img src="${s.img}" style="left:${-l / w * 100}%;top:${-t / h * 100}%;width:${100 / w}%;height:${100 / h}%" draggable="false" alt="">`;
  } else if (s.kind === 'shape') {
    if (s.path) {
      el.innerHTML = `<svg viewBox="0 0 ${s.path.w} ${s.path.h}" preserveAspectRatio="none"><path d="${s.path.d}" fill="${s.path.fill && s.fill ? s.fill : 'none'}" stroke="${s.ln ? s.ln.c : 'none'}" stroke-width="${s.ln ? s.ln.w : 0}" vector-effect="non-scaling-stroke"/></svg>`;
    } else {
      if (s.fill) el.style.background = s.fill;
      if (s.ln) el.style.border = `${s.ln.w}px solid ${s.ln.c}`;
      if (s.radius) el.style.borderRadius = s.radius * Math.min(s.w, s.h) + 'px';
    }
    if (s.text) el.insertAdjacentHTML('beforeend', textHTML(s.text));
  } else if (s.kind === 'line') {
    el.style.setProperty('--c', s.ln.c); el.style.setProperty('--w', s.ln.w + 'px');
    el.classList.toggle('head', s.ln.head); el.classList.toggle('tail', s.ln.tail);
  } else if (s.kind === 'group') {
    for (const c of s.children) { const k = content(c); el.append(k); rel(k, c, s.ch); }
  } else if (s.kind === 'model') {
    el.innerHTML = s.raster ? `<img src="${s.raster}" alt="">` : '';
    model.attach(el, s);
  }
  return el;
}

/* ---------- 幾何 ---------- */
const flip = s => (s.fh || s.fv) && s.kind !== 'line' ? ` scale(${s.fh ? -1 : 1},${s.fv ? -1 : 1})` : '';
function lineEnds(s) {
  let [x1, y1, x2, y2] = s.p;
  if (s.rot) {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2, a = s.rot * Math.PI / 180, c = Math.cos(a), n = Math.sin(a);
    const R = (x, y) => [cx + (x - cx) * c - (y - cy) * n, cy + (x - cx) * n + (y - cy) * c];
    [x1, y1] = R(x1, y1); [x2, y2] = R(x2, y2);
  }
  return [x1, y1, x2, y2];
}
// 最上層物件：舞台上的 px
function geo(s) {
  if (s.kind === 'model') return {};
  if (s.kind === 'line') {
    const [x1, y1, x2, y2] = lineEnds(s);
    return { left: x1 + 'px', top: y1 - s.ln.w / 2 + 'px', width: Math.hypot(x2 - x1, y2 - y1) + 'px', height: s.ln.w + 'px', transform: `rotate(${Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI}deg)` };
  }
  return { left: s.x + 'px', top: s.y + 'px', width: s.w + 'px', height: s.h + 'px', transform: `rotate(${s.rot || 0}deg)` + flip(s) };
}
// 群組裡的物件：相對群組的百分比，群組縮放時跟著縮
function rel(el, c, ch) {
  const pc = (v, o, e) => (v - o) / e * 100 + '%', sz = (v, e) => v / e * 100 + '%';
  if (c.kind === 'line') {
    const [x1, y1, x2, y2] = c.p, vert = Math.abs(x2 - x1) < Math.abs(y2 - y1);
    Object.assign(el.style, vert
      ? { left: pc(x1, ch[0], ch[2]), top: pc(Math.min(y1, y2), ch[1], ch[3]), width: c.ln.w + 'px', height: sz(Math.abs(y2 - y1), ch[3]), marginLeft: -c.ln.w / 2 + 'px', transform: 'none' }
      : { left: pc(Math.min(x1, x2), ch[0], ch[2]), top: pc(y1, ch[1], ch[3]), height: c.ln.w + 'px', width: sz(Math.abs(x2 - x1), ch[2]), marginTop: -c.ln.w / 2 + 'px', transform: 'none' });
    el.className = 'el'; el.style.background = c.ln.c;
    return;
  }
  Object.assign(el.style, { left: pc(c.x, ch[0], ch[2]), top: pc(c.y, ch[1], ch[3]), width: sz(c.w, ch[2]), height: sz(c.h, ch[3]), transform: `rotate(${c.rot || 0}deg)` + flip(c) });
}
function relTree(el, s) { // 重用群組節點時，把子物件的相對位置更新成新的一頁
  if (s.kind !== 'group') return;
  s.children.forEach((c, i) => { const k = el.children[i]; if (k) { rel(k, c, s.ch); relTree(k, c); } });
}

/* ---------- 比對（轉化用） ---------- */
// 內容相同就視為同一個物件；位置大小不算在內
function sig(s) {
  if (s.kind === 'group') return 'g[' + s.children.map(sig).join('|') + ']';
  if (s.kind === 'pic') return 'p:' + s.img + (s.crop || '');
  if (s.kind === 'line') return 'l';
  if (s.kind === 'model') return 'm:' + s.glb;
  return 's:' + JSON.stringify([s.fill, s.ln, s.path?.d, s.radius, s.text?.p, s.text?.c]);
}

/* ---------- 3D 模型 ---------- */
const model = {
  ready: null, cur: null, host: null, anim: null,
  attach(el, s) {
    this.host = el;
    const img = el.querySelector('img');
    if (img) Object.assign(img.style, { left: s.x + 'px', top: s.y + 'px', width: s.w + 'px', height: s.h + 'px' });
    this.cur = this.params(s);
    if (this.canvas) { el.append(this.canvas); if (img) img.style.display = 'none'; this.draw(); }
    else if (!this.ready) this.ready = this.load(s).catch(e => console.warn('3D 模型載入失敗，改用靜態圖', e));
  },
  params(s) { return { s, cx: s.x + s.w / 2, cy: s.y + s.h / 2, view: s.view, euler: s.euler }; },
  async load(s) {
    const THREE = this.T = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(s.glb);
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(W, H, false);
    this.canvas = r.domElement;
    const scene = this.scene = new THREE.Scene();
    // PowerPoint 3D 模型的預設打光：環境光＋三盞點光源
    scene.add(new THREE.AmbientLight(0xffffff, 2.6));
    for (const [c, i, p] of [[[1, .75, .5], 9.77, [.61, 1.97, .454]], [[.4, .6, .95], 12.25, [-1.0546, 1.4203, 1.6009]], [[.868, .727, 1], 3.125, [-1.0483, 1.6127, -.9658]]]) {
      const l = new THREE.PointLight(new THREE.Color(...c), i * 3.4, 0, 2); l.position.set(...p); scene.add(l);
    }
    // PowerPoint 匯出的模型用舊的 specular-glossiness 材質，three.js 不認得會當成全金屬（暗面全黑）：改回一般漫射材質
    gltf.scene.traverse(o => {
      for (const m of [].concat(o.material || [])) {
        const sg = m.userData?.gltfExtensions?.KHR_materials_pbrSpecularGlossiness;
        if (!sg) continue;
        if (sg.diffuseFactor) { m.color.setRGB(...sg.diffuseFactor.slice(0, 3)); m.opacity = sg.diffuseFactor[3] ?? 1; }
        m.metalness = 0; m.roughness = 1 - (sg.glossinessFactor ?? .5) * .6;
      }
    });
    this.pivot = new THREE.Group(); scene.add(this.pivot);
    gltf.scene.scale.setScalar(s.unit); gltf.scene.position.set(...s.pre);
    this.pivot.add(gltf.scene);
    this.camera = new THREE.PerspectiveCamera(s.fov, 1, .05, 50);
    this.camera.position.set(...s.cam); this.camera.lookAt(0, 0, 0);
    if (this.host?.isConnected) { this.host.append(this.canvas); this.host.querySelector('img')?.style.setProperty('display', 'none'); }
    this.draw();
  },
  quat(e) { const T = this.T, d = Math.PI / 180; return new T.Quaternion().setFromEuler(new T.Euler(e[0] * d, e[1] * d, e[2] * d, 'ZXY')); },
  draw(p = this.cur, q) {
    if (!this.canvas || !p) return;
    // 以模型框的中心為投影中心；視角 fov 對應邊長 view 的正方形
    this.camera.setViewOffset(p.view, p.view, p.view / 2 - p.cx, p.view / 2 - p.cy, W, H);
    this.pivot.quaternion.copy(q || this.quat(p.euler));
    this.renderer.render(this.scene, this.camera);
  },
  // 換頁時把位置、大小、角度一起補間
  morph(s, dur) {
    const a = this.cur, b = this.params(s); this.cur = b;
    cancelAnimationFrame(this.anim);
    if (!this.canvas || !dur) return this.draw();
    const qa = this.quat(a.euler), qb = this.quat(b.euler), t0 = performance.now(), mix = (x, y, t) => x + (y - x) * t;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), t = ease(k);
      this.draw({ cx: mix(a.cx, b.cx, t), cy: mix(a.cy, b.cy, t), view: mix(a.view, b.view, t) }, qa.clone().slerp(qb, t));
      if (k < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  },
  snap() { cancelAnimationFrame(this.anim); this.draw(); },
};

/* ---------- 換頁 ---------- */
let cur = -1, nodes = [], layer = null, timers = [], pending = [], stepAt = 0, busy = false;
const later = (fn, ms) => timers.push(setTimeout(fn, ms));
const TRANS = d => ['left', 'top', 'width', 'height', 'transform', 'translate', 'rotate'].map(p => `${p} ${d}ms ${EASE}`).join(',');

function newLayer(slide) {
  const l = document.createElement('div'); l.className = 'layer'; l.style.background = slide.bg;
  const ns = slide.shapes.map((s, i) => {
    const el = content(s); Object.assign(el.style, geo(s)); el.style.zIndex = i; l.append(el);
    return { el, s, anims: [] };
  });
  return [l, ns];
}

// 把還在跑或停在終點的動畫，換成等值的行內樣式，轉化才能從「現在的位置」接著動
function freeze(n) {
  if (!n.anims.length) return;
  const cs = getComputedStyle(n.el), tr = cs.translate, ro = parseFloat(cs.rotate) || 0;
  n.anims.forEach(a => a.cancel()); n.anims = [];
  n.el.style.translate = tr === 'none' ? '0px 0px' : tr;
  n.el.style.rotate = (((ro % 360) + 540) % 360 - 180) + 'deg';
}

function morph(slide, dur) {
  const old = nodes, used = new Set(), next = [];
  old.forEach(freeze);
  const pick = test => old.find(n => !used.has(n) && test(n));
  const pairs = slide.shapes.map(s => {
    const n = pick(n => n.s.kind === s.kind && n.s.id === s.id && (s.kind !== 'pic' || n.s.img === s.img));
    if (n) used.add(n);
    return [s, n];
  });
  for (const p of pairs) if (!p[1]) { const g = sig(p[0]); p[1] = pick(n => sig(n.s) === g) || (p[0].kind === 'model' ? pick(n => n.s.kind === 'model') : null); if (p[1]) used.add(p[1]); }
  layer.style.transition = `background ${dur}ms`; layer.style.background = slide.bg;
  const moving = [];
  pairs.forEach(([s, n], i) => {
    if (n && (sig(n.s) === sig(s) || s.kind === 'line' || s.kind === 'model')) {         // 同一個物件：直接移過去
      n.el.style.zIndex = i; n.el.dataset.id = s.id;
      if (s.kind === 'model') model.morph(s, dur);
      else moving.push(() => { Object.assign(n.el.style, geo(s), { translate: '0px 0px', rotate: '0deg' }); relTree(n.el, s); if (s.kind === 'line') { n.el.style.setProperty('--c', s.ln.c); n.el.classList.toggle('head', s.ln.head); n.el.classList.toggle('tail', s.ln.tail); } });
      n.el.style.transition = TRANS(dur); n.el.querySelectorAll('.el').forEach(k => k.style.transition = TRANS(dur));
      n.s = s; next.push(n);
      return;
    }
    const el = content(s); el.style.zIndex = i; el.style.opacity = 0; layer.append(el);
    if (n) {                                                                                 // 位置對得上、內容不同：邊移邊交叉淡化
      Object.assign(el.style, geo(n.s), { translate: n.el.style.translate, rotate: n.el.style.rotate });
      el.style.transition = n.el.style.transition = TRANS(dur) + `,opacity ${dur * .6}ms ease ${dur * .2}ms`;
      moving.push(() => { Object.assign(el.style, geo(s), { translate: '0px 0px', rotate: '0deg', opacity: 1 }); Object.assign(n.el.style, geo(s), { translate: '0px 0px', rotate: '0deg', opacity: 0 }); });
      later(() => n.el.remove(), dur);
    } else {                                                                                 // 新出現的：淡入
      Object.assign(el.style, geo(s));
      el.style.transition = `opacity ${dur * .5}ms ease ${dur * .35}ms`;
      moving.push(() => el.style.opacity = 1);
    }
    next.push({ el, s, anims: [] });
  });
  for (const n of old) if (!used.has(n)) {                                                   // 消失的：淡出
    n.el.style.transition = `opacity ${dur * .4}ms ease`;
    moving.push(() => n.el.style.opacity = 0);
    later(() => n.el.remove(), dur);
  }
  layer.offsetWidth;                                                                         // 先讓起點樣式生效
  requestAnimationFrame(() => moving.forEach(f => f()));
  nodes = next;
}

function swap(slide, tr) {
  const [l, ns] = newLayer(slide), oldLayer = layer, dur = tr.dur;
  stage.append(l);
  if (tr.type === 'wipe' && oldLayer) {
    const from = { u: 'inset(100% 0 0 0)', d: 'inset(0 0 100% 0)', l: 'inset(0 0 0 100%)', r: 'inset(0 100% 0 0)' }[tr.dir] || 'inset(0 0 0 100%)';
    l.animate([{ clipPath: from }, { clipPath: 'inset(0 0 0 0)' }], { duration: dur, easing: 'ease-in-out' });
  } else if (oldLayer && dur) l.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, easing: 'ease' });
  if (oldLayer) later(() => oldLayer.remove(), dur);
  layer = l; nodes = ns;
}

/* ---------- 物件動畫（路徑、旋轉） ---------- */
function play(step) {
  const spin = {};
  for (const a of step.anims) {
    const n = nodes.find(n => n.s.id === a.id); if (!n) continue;
    const opt = { duration: a.dur, delay: a.t, easing: a.ease ? 'ease-in-out' : 'linear', fill: 'forwards' };
    if (a.type === 'move') n.anims.push(n.el.animate([{ translate: `${a.frm[0]}px ${a.frm[1]}px` }, { translate: `${a.to[0]}px ${a.to[1]}px` }], opt));
    else { const from = spin[a.id] || 0; spin[a.id] = from + a.by; n.anims.push(n.el.animate([{ rotate: from + 'deg' }, { rotate: spin[a.id] + 'deg' }], opt)); }
  }
}

function settle() { // 動畫中又按了一次：直接跳到終點
  timers.forEach(clearTimeout); timers = [];
  stage.querySelectorAll('.layer').forEach(l => { if (l !== layer) l.remove(); else l.getAnimations().forEach(a => a.finish()); });
  const keep = new Set(nodes.map(n => n.el));
  [...layer.children].forEach(el => { if (!keep.has(el)) el.remove(); });
  nodes.forEach(n => { n.el.style.transition = 'none'; n.el.querySelectorAll('.el').forEach(k => k.style.transition = 'none'); n.el.style.opacity = ''; Object.assign(n.el.style, geo(n.s)); });
  model.snap(); busy = false;
}

function show(n, instant) {
  n = Math.max(0, Math.min(deck.slides.length - 1, n));
  if (n === cur) return;
  if (busy) settle();
  const slide = deck.slides[n], tr = instant || cur < 0 ? { type: 'none', dur: 0 } : deck.slides[Math.max(n, cur)].trans;
  // 轉化只在相鄰兩頁之間做；跳頁就直接換
  if (tr.type === 'morph' && Math.abs(n - cur) === 1 && layer) morph(slide, tr.dur); else swap(slide, tr.type === 'morph' ? { type: 'fade', dur: 400 } : tr);
  cur = n; busy = tr.dur > 0;
  pending = slide.steps.slice(); stepAt = 0;
  later(() => { busy = false; while (pending.length && pending[0].auto) play(pending.shift()); }, tr.dur);
  document.getElementById('count').textContent = `${n + 1} / ${deck.slides.length}`;
  history.replaceState(null, '', '#' + (n + 1));
}
function next() { if (!busy && pending.length) play(pending.shift()); else show(cur + 1); }
const prev = () => show(cur - 1);

/* ---------- 操作 ---------- */
const fs = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
// 觸控沒有滑鼠可以晃出選單：點左右兩側翻頁，點中間開關選單
let lastTouch = 0;
document.getElementById('fit').onclick = e => {
  const x = e.clientX / innerWidth;
  if (Date.now() - lastTouch < 700 && x > 1 / 3 && x < 2 / 3) hud.classList.contains('hide') ? wake(5000) : (clearTimeout(idle), hud.classList.add('hide'));
  else x < 1 / 3 ? prev() : next();
};
if (!document.documentElement.requestFullscreen) document.getElementById('fs').hidden = true;   // iPhone 的 Safari 不能把網頁全螢幕
document.getElementById('prev').onclick = prev; document.getElementById('next').onclick = next; document.getElementById('fs').onclick = fs;
addEventListener('keydown', e => {
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); next(); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); prev(); }
  else if (e.key === 'Home') show(0); else if (e.key === 'End') show(deck.slides.length - 1);
  else if (e.key === 'f' || e.key === 'F') fs();
});
let tx = null, ty = 0, idle;
addEventListener('touchstart', e => { lastTouch = Date.now(); tx = e.touches.length === 1 && !e.target.closest('#hud') ? e.touches[0].clientX : null; ty = e.touches[0].clientY; }, { passive: true });
addEventListener('touchend', e => {
  lastTouch = Date.now(); if (tx == null) return;
  const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; tx = null;
  // 兩指縮放、放大檢視中的拖曳、上下滑都不翻頁
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5 && (window.visualViewport?.scale || 1) < 1.05) dx < 0 ? next() : prev();
});
const wake = ms => { hud.classList.remove('hide'); clearTimeout(idle); idle = setTimeout(() => hud.classList.add('hide'), ms > 0 ? ms : 2200); };
addEventListener('mousemove', () => { if (Date.now() - lastTouch > 800) wake(); }); wake();   // 手指點一下也會補發 mousemove，不算
for (const s of deck.slides) for (const x of JSON.stringify(s).matchAll(/"media\/[^"]+\.(?:png|jpe?g)"/gi)) new Image().src = JSON.parse(x[0]);
window.deckPlayer = { show, next, prev, get index() { return cur; }, model };
show((parseInt(location.hash.slice(1)) || 1) - 1, true);
