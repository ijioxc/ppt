// 旁白＝一筆帳：全頁連號，標出記在誰的帳上（攻方／守方／軍工／備註），有數字時列出金額列
const ACCT = {atk: '攻方', def: '守方', ind: '軍工', note: '備註'};
const allSteps = [...document.querySelectorAll('.step')];
allSteps.forEach((s, i) => {
  const acct = s.dataset.acct || 'note', [k, v] = (s.dataset.amt || '').split('|');
  const e = document.createElement('div');
  e.className = 'entry ' + acct;
  e.innerHTML = `<div class="entry-h"><b>${ACCT[acct]}</b><span>${String(i + 1).padStart(2, '0')} / ${allSteps.length}</span></div>`;
  e.appendChild(s.querySelector('p'));
  if (v) e.insertAdjacentHTML('beforeend', `<div class="entry-a"><span>${k}</span><b>${v}</b></div>`);
  s.appendChild(e);
});

// 捲動步驟：每一步佔一個畫面並自動吸附；步驟捲過畫面一半時切換圖解。區塊加上 s1…sn（累積）與 n{n}（僅目前）
const sections = [...document.querySelectorAll('.scrolly')].map(sec => {
  const credit = sec.querySelector(':scope > .credit');
  if (credit) sec.querySelector('.sticky').appendChild(credit);  // 來源註記固定在圖解畫面左下
  return {sec, ps: [...sec.querySelectorAll('.step')], n: 0};
});
function update() {
  const line = innerHeight * 0.5;
  sections.forEach(s => {
    let n = 1;
    s.ps.forEach((p, i) => { if (p.getBoundingClientRect().top < line) n = i + 1; });
    if (n === s.n) return;
    s.n = n;
    s.sec.className = (s.sec.dataset.base ||= s.sec.className) + ' ' + Array.from({length: n}, (_, i) => 's' + (i + 1)).join(' ') + ' n' + n;
    s.sec.dispatchEvent(new CustomEvent('step', {detail: n}));
  });
}
let tick = false;
addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(() => { tick = false; update(); }); } }, {passive: true});
addEventListener('resize', update);

// 成本對比：205 架無人機
const dgrid = document.getElementById('dgrid');
for (let i = 0; i < 210; i++) dgrid.appendChild(document.createElement('i'));
const dcount = document.getElementById('dcount');
document.getElementById('cost').addEventListener('step', e => {
  const n = [1, 1, 82, 205][e.detail - 1];
  [...dgrid.children].forEach((el, i) => el.classList.toggle('on', i < n));
  dcount.textContent = n;
});

// 庫存：233 格，每格 10 枚
const sgrid = document.getElementById('sgrid');
for (let i = 0; i < 233; i++) {
  const el = document.createElement('i');
  if (i < 153) el.className = 'used';
  if (i >= 93 && i < 153) el.className = 'used prod';
  sgrid.appendChild(el);
}
const snum = document.getElementById('snum'), slab = document.getElementById('slab');
document.getElementById('stock').addEventListener('step', e => {
  const t = [
    ['2,330', '枚愛國者攔截彈，開戰前的美國庫存'],
    ['約 800', '枚，開戰不到半年後剩下的數量'],
    ['600', '枚，一年的產量（紅框）'],
    ['約 1.8 兆元', '七年期補貨合約的上限'],
  ][e.detail - 1];
  snum.textContent = t[0]; slab.textContent = t[1];
});

// 七個站：到過的站亮起（on），目前這一站展開（now）
const sts = [...document.querySelectorAll('#money .st')];
document.getElementById('money').addEventListener('step', e => {
  sts.forEach((el, i) => { el.classList.toggle('on', i < e.detail); el.classList.toggle('now', i === e.detail - 1); });
});

// 地圖
const HIT = new Set(['368', '414', '048', '634', '784', '682', '196']);
// [名稱, 文字經度, 文字緯度, 樣式, 目標經度, 目標緯度, 對齊]：小國的名字放在空白處，拉線指到國家
const LABELS = [
  ['伊朗', 54.5, 32.5, 'iran'], ['伊拉克', 43.5, 33, ''], ['沙烏地阿拉伯', 44.5, 23.2, ''],
  ['科威特', 44.6, 28.5, '', 47.55, 29.3, 'end'], ['巴林', 47.0, 26.5, '', 50.55, 26.05, 'end'],
  ['卡達', 47.8, 25.0, '', 51.15, 25.3, 'end'], ['阿聯', 60.5, 22.3, 'out', 54.6, 23.9, 'start'],
  ['賽普勒斯', 30.2, 33.0, 'out', 33.2, 35.0, 'end'],
];
const POINTS = [
  ['第五艦隊總部', 50.58, 26.22, -10, 18, 'end'], ['棕櫚島飯店', 55.14, 25.11, 10, 14, 'start'],
  ['拉斯坦努拉煉油廠', 50.16, 26.64, -10, -8, 'end'], ['拉斯拉凡天然氣站', 51.55, 25.9, 10, -8, 'start'],
];
const svg = d3.select('#mapsvg');
let world;
function draw() {
  if (!world) return;
  const el = svg.node(), w = el.clientWidth, h = el.clientHeight;
  svg.attr('viewBox', `0 0 ${w} ${h}`).selectAll('*').remove();
  const box = {type: 'Feature', geometry: {type: 'MultiPoint', coordinates: [[21, 12], [66, 44]]}};
  // 寬螢幕：地圖靠右，左下留給文字框；窄螢幕：地圖在上，文字框在下
  const wide = w >= 980;
  const proj = d3.geoMercator().fitExtent(wide ? [[w * 0.36, 70], [w - 20, h - 50]] : [[10, 64], [w - 10, h * 0.6]], box);
  const path = d3.geoPath(proj);
  svg.append('g').selectAll('path').data(world).join('path')
    .attr('d', path)
    .attr('class', d => 'c' + (d.id === '364' ? ' iran' : HIT.has(d.id) ? ' hit' : ''));
  const circle = d3.geoCircle().center([51.39, 35.69]).radius(2500 / 111.19).precision(1);
  svg.append('path').attr('class', 'range').attr('d', path(circle()));
  const lg = svg.append('g');
  LABELS.filter(d => d[4]).forEach(d => {
    const [x, y] = proj([d[1], d[2]]), [tx, ty] = proj([d[4], d[5]]);
    const x0 = x + (d[6] === 'end' ? 6 : -6), y0 = y - 5;
    lg.append('line').attr('class', 'lead ' + d[3]).attr('x1', x0).attr('y1', y0).attr('x2', tx).attr('y2', ty);
    lg.append('circle').attr('class', 'lead dot ' + d[3]).attr('cx', tx).attr('cy', ty).attr('r', 2.5);
  });
  svg.append('g').selectAll('text').data(LABELS).join('text')
    .attr('class', d => 'lbl ' + d[3]).style('text-anchor', d => d[6] || null)
    .attr('x', d => proj([d[1], d[2]])[0]).attr('y', d => proj([d[1], d[2]])[1]).text(d => d[0]);
  const g = svg.append('g');
  POINTS.forEach(d => {
    const [x, y] = proj([d[1], d[2]]);
    g.append('circle').attr('class', 'pt').attr('cx', x).attr('cy', y).attr('r', 5);
    g.append('text').attr('class', 'ptl').attr('x', x + d[3]).attr('y', y + d[4]).attr('text-anchor', d[5]).text(d[0]);
  });
  [['德黑蘭', 51.39, 35.69], ['雅典', 23.73, 37.98]].forEach(d => {
    const [x, y] = proj([d[1], d[2]]);
    g.append('circle').attr('class', 'city').attr('cx', x).attr('cy', y).attr('r', 5);
    g.append('text').attr('class', 'cityl').attr('x', x + 9).attr('y', y - 9).text(d[0]);
  });
}
d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json').then(t => {
  world = topojson.feature(t, t.objects.countries).features;
  draw();
});
addEventListener('resize', draw);

update();

// 滾輪提示：開始滑動後淡出
{
  const hint = document.querySelector('.scroll-hint');
  if (hint) addEventListener('scroll', () => hint.classList.toggle('gone', scrollY > 40), {passive: true});
}
