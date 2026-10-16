// 画面の部品: トップバー(並びは設定で変えられる)、サイドバー(ツール・サイズ・不透明度)、
// 押すと出るパネル(ブラシ・バケツ・レイヤー・カラー・メニュー・色の調整)
import { state, on, emit, requestRender, currentBrush } from './state.js';
import { ITEMS, iconHtml } from './actions.js';
import { BLENDS, createCanvas } from './doc.js';
import { Stroke, hexRgb, BRUSHES, loadTip } from './brush.js';
import * as layers from './layers.js';
import { toggleSelectMode } from './select.js';
import { setMoveMode } from './transform.js';
import { beginAdjust, endAdjust, initAdjust, isAdjusting, ADJUST_POPS } from './adjust.js';
import { openModal, escapeHtml } from './modal.js';
import { say } from './messages.js';
import { newItems } from './prefs.js';

const $ = (id) => document.getElementById(id);
const HOLD = 450; // 長押しとみなす時間(ms)

// ---- 押すと出るパネル(ウィンドウ) ----
// ウィンドウ(ブラシ・バケツ・レイヤー・色・色相彩度明るさ・シャープ・ノイズ)は、3つの出し方ができる(state.win[id].mode):
//   'pop'   … ボタンを押すと出て、外を押すと閉じる(はじめ)
//   'float' … 小窓。画面の中で独立して、出したままになる。上の帯を持って動かせる(ウィンドウを長押しで切り替え)
//   'dock'  … 右に固める。右の端に縦に並ぶ(Kodai のカラー・線と塗りのパネルと同じ形)
// 小窓と、右に固めたものには、上の帯に「右に固める / 小窓に戻す」と「閉じる」のボタンが出る。
// 絵の調整のウィンドウ(ADJUST_POPS)は、「適用」か「やめる」で閉じる(外を押しても閉じない。起動のときに出し直すこともしない)

const TOOL_POP = { brush: 'pop-brush', eraser: 'pop-brush', fill: 'pop-fill' };
const WINDOWS = ['pop-brush', 'pop-fill', 'pop-layers', 'pop-color', 'pop-hsb', 'pop-sharpen', 'pop-noise', 'pop-levels', 'pop-tool', 'pop-more'];
const WIN_HOLD = 150; // ウィンドウを小窓にする長押し(ほかの長押しの 1/3。小窓を元に戻す長押しは、動かそうとして戻ってしまわないよう HOLD のまま)
const HOLD_SLOP = 12; // 長押しのあいだ、これより動いたら長押しではない(指は少しぶれるので、広め)
const modeOf = (id) => state.win[id]?.mode || 'pop';
const pinned = (id) => modeOf(id) !== 'pop'; // 小窓・右に固めたもの(外を押しても閉じない)
const isAdjust = (id) => id in ADJUST_POPS;

// 開いているパネルを閉じる。小窓・右に固めたものと、絵の調整(「適用」か「やめる」で閉じる)は残す
export function closePops() {
  for (const p of document.querySelectorAll('.pop.open')) {
    if (pinned(p.id) || isAdjust(p.id)) continue;
    p.classList.remove('open');
  }
  $('size-pop').classList.remove('open');
  layoutPops();
}

// 絵の調整をやめて(元の絵に戻して)、そのウィンドウを閉じる
export function closeAdjust() {
  endAdjust(false);
  for (const id of Object.keys(ADJUST_POPS)) $(id).classList.remove('open');
  layoutPops();
}

// レイヤーと色を両方出しているときは、色を左にずらして並べる(小窓などは、置いた所のまま)。右の列は、中身があるときだけ出す
function layoutPops() {
  const both = $('pop-layers').classList.contains('open') && $('pop-color').classList.contains('open');
  $('pop-color').classList.toggle('shift', both && !pinned('pop-color') && !pinned('pop-layers'));
  $('dock-right').classList.toggle('has', WINDOWS.some((id) => modeOf(id) === 'dock' && $(id).classList.contains('open')));
  for (const b of document.querySelectorAll('[data-action="hsb"]')) b.classList.toggle('active', $('pop-hsb').classList.contains('open'));
  // ウィンドウを出すボタン(レイヤー・色など)は、出している間、押した感じにする
  for (const b of document.querySelectorAll('[data-pop]')) b.classList.toggle('open', !!$(b.dataset.pop)?.classList.contains('open'));
}

// 小窓の位置は transform で動かす(left / top を変えるより軽い。持って動かしても、中身を描き直さない)
function placeWin(p, w) {
  // 画面の外に出ないように
  w.x = Math.min(Math.max(0, w.x), Math.max(0, window.innerWidth - 120));
  w.y = Math.min(Math.max(0, w.y), Math.max(0, window.innerHeight - 60));
  p.style.transform = `translate3d(${Math.round(w.x)}px, ${Math.round(w.y)}px, 0)`;
}

function applyWin(id) {
  const p = $(id), w = state.win[id], mode = modeOf(id);
  p.classList.toggle('float', mode === 'float');
  p.classList.toggle('dock', mode === 'dock');
  // 右に固めたものは、右の列の中に入れる。それ以外は、画面の上に重ねる
  const home = mode === 'dock' ? $('dock-right') : document.body;
  if (p.parentElement !== home) { if (home === document.body) home.insertBefore(p, $('modal-root')); else home.append(p); }
  if (mode === 'float') placeWin(p, w);
  else p.style.transform = '';
  const dock = p.querySelector('.win-dock');
  dock.classList.toggle('on', mode === 'dock');
  dock.title = mode === 'dock' ? '小窓に戻す' : '右に固める(右の端に並べる)';
  layoutPops();
}

const DEFAULT_POS = { 'pop-layers': [-316, 60], 'pop-color': [-640, 60] }; // ほかは、左のバーの横

// 出し方を変える: 'pop'(元に戻す)/ 'float'(小窓)/ 'dock'(右に固める)。pos を省くと、今出ている場所(出ていなければ、決まった場所)
export function setWin(id, mode, pos = null) {
  const p = $(id), w = (state.win[id] ||= { mode: 'pop' });
  if (mode === 'float') {
    if (!pos && p.classList.contains('open') && modeOf(id) === 'pop') { const r = p.getBoundingClientRect(); pos = { x: r.left, y: r.top }; }
    if (!pos && w.x === undefined) { const [x, y] = DEFAULT_POS[id] || [70, 60]; pos = { x: x < 0 ? window.innerWidth + x : x, y }; }
    if (pos) { w.x = pos.x; w.y = pos.y; }
  }
  w.mode = mode;
  applyWin(id);
  if (mode !== 'pop') openPop(id);
  layoutPops();
  emit('settings');
}

// 閉じる。小窓は、閉じたら元の出し方に戻す(次に出すときは、いつもの場所から。置いた場所は覚えない)
function closeWin(id) {
  if (isAdjust(id)) endAdjust(false);
  $(id).classList.remove('open');
  if (modeOf(id) === 'float') {
    state.win[id] = { mode: 'pop' };
    applyWin(id);
    emit('settings');
  }
  layoutPops();
}

function initWindows() {
  for (const id of WINDOWS) {
    const p = $(id), head = p.querySelector('.pop-head');
    state.win[id] ||= { mode: 'pop' };
    // 上の帯の右はし: 「右に固める / 小窓に戻す」「閉じる」(小窓・右に固めたときだけ見える。絵は Kodai で描いたもの)
    const ctl = document.createElement('span');
    ctl.className = 'win-ctl';
    ctl.innerHTML = '<button class="win-dock ico" style="--icon: url(&quot;icons/dock-right.png&quot;)"></button><button class="win-close ico" title="閉じる" style="--icon: url(&quot;icons/close.png&quot;)"></button>';
    head.append(ctl);
    ctl.querySelector('.win-dock').onclick = () => setWin(id, modeOf(id) === 'dock' ? 'float' : 'dock');
    ctl.querySelector('.win-close').onclick = () => closeWin(id);
    // ウィンドウを長押し(ボタン・スライダー・レイヤーの行などの上は除く): 小窓にする / 元に戻す。
    // 小窓のときは、上の帯を持って動かせる(ブラウザのウィンドウと同じ感覚: 持ったらすぐ、指についてくる)
    p.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target.closest('button, input, select, canvas, label, summary, .layer-item')) return;
      const w = state.win[id];
      const x0 = e.clientX, y0 = e.clientY;
      let wx = w.x || 0, wy = w.y || 0;
      let moved = false, raf = 0;
      // 上の帯を持って動かすと、そのまま小窓になって、指についてくる(長押しを待たなくてよい。0.16.0)。右に固めたものは、動かさない
      const drag = modeOf(id) !== 'dock' && !!e.target.closest('.pop-head');
      const timer = setTimeout(() => {
        if (moved) return;
        stop();
        const next = modeOf(id) === 'pop' ? 'float' : 'pop';
        setWin(id, next);
        say(next === 'float' ? 'floatOn' : 'floatOff');
      }, modeOf(id) === 'pop' ? WIN_HOLD : HOLD);
      if (drag) { try { p.setPointerCapture(e.pointerId); } catch { /* つかめなくても続ける */ } }
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < (drag ? 5 : HOLD_SLOP)) return;
        moved = true;
        clearTimeout(timer);
        if (!drag) return;
        if (modeOf(id) === 'pop') {
          // まだ小窓でなければ、今出ている場所のまま、小窓にする
          const r = p.getBoundingClientRect();
          setWin(id, 'float', { x: r.left, y: r.top });
          wx = r.left; wy = r.top;
        }
        if (modeOf(id) !== 'float') return;
        w.x = wx + ev.clientX - x0;
        w.y = wy + ev.clientY - y0;
        // 画面の描き直しに合わせて、1回だけ動かす(速く動かしても、たまらない)
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; placeWin(p, w); });
      };
      const stop = () => {
        clearTimeout(timer);
        for (const t of ['pointerup', 'pointercancel']) p.removeEventListener(t, stop);
        p.removeEventListener('pointermove', move);
        cancelAnimationFrame(raf);
        if (drag && moved) { placeWin(p, w); emit('settings'); }
      };
      p.addEventListener('pointermove', move);
      for (const t of ['pointerup', 'pointercancel']) p.addEventListener(t, stop);
      if (drag) e.preventDefault();
    });
    applyWin(id);
  }
  window.addEventListener('resize', () => { for (const id of WINDOWS) if (modeOf(id) === 'float') applyWin(id); });
}

export function openPop(id) {
  const p = $(id);
  if (p.classList.contains('open')) return;
  // 絵の調整は、1つずつ(ほかの調整は、やめて閉じる)
  if (isAdjust(id)) { closeAdjust(); if (!beginAdjust(ADJUST_POPS[id])) return; }
  for (const o of document.querySelectorAll('.pop.open')) if (!pinned(o.id) && !isAdjust(o.id)) o.classList.remove('open');
  p.classList.add('open');
  if (id === 'pop-layers') drawLayers();
  if (id === 'pop-brush') { drawBrushList(); drawBrushEditor(); }
  if (id === 'pop-color') drawPicker();
  if (id === 'pop-tool') drawToolPop();
  if (id === 'pop-more') drawMore();
  layoutPops();
}

export function togglePop(id) {
  if ($(id).classList.contains('open')) closeWin(id);
  else openPop(id);
}

function initPops() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pop]');
    if (b) togglePop(b.dataset.pop);
  });
  // パネルの外を押したら閉じる(キャンバスなら、そのまま描き始められる)
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.pop, [data-pop], .tool-btn, #size-pop, .vslider, .modal-backdrop')) return;
    // 指でキャンバスを押したときは、ここでは閉じない(描き始めるときに、app.js が閉じる)。
    // 2本指のタップ(元に戻す)・3本指のタップ(やり直し)で、レイヤーなどのパネルが閉じないように
    if (e.pointerType === 'touch' && e.target.id === 'view') return;
    closePops();
  }, true);
  // メニューは、選んだら閉じる
  $('pop-menu').addEventListener('click', (e) => { if (e.target.closest('button')) $('pop-menu').classList.remove('open'); });
  initWindows();
  initAdjust(closeWin);
}

function drawPins() {
  for (const id of WINDOWS) applyWin(id);
  $('menu-finger').innerHTML = `指で描く<kbd>${state.fingerDraw ? 'オン' : 'オフ(ペンだけ)'}</kbd>`;
}

// 左右反転して表示しているあいだは、そのボタンの色も反転する
function drawFlip() {
  for (const b of document.querySelectorAll('[data-action="flipView"]')) b.classList.toggle('on', !!state.view?.flip);
}

// ---- 色(HSV で持つ。灰色にしても色相を忘れないように) ----

const hsv = { h: 0, s: 0, v: 0 };
const RECENT = 10, PALETTE = 30; // 色の履歴と、よく使う色のマスの数(1段 10 マス)

function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return '#' + [f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// 丸い選び方(state.colorWheel = 'circle'): まわりの輪 = 色相、中の丸 = あざやかさ(右へ)と明るさ(上へ)。
// 中の丸は、四角(横 = あざやかさ、縦 = 明るさ)を、丸に引きのばしたもの(左上 = 白、右上 = その色、下 = 黒)
const WHEEL = { size: 520, ro: 256, ri: 188, rd: 166, n: 166 }; // キャンバスの px(見た目の2倍)。n = 中の丸を作る細かさ
const HUE_TURN = 30; // 色相の輪を回す角度(度)。赤が、右上(時計の2時)に来る
let wheelRing = null;
const wheelDisc = { h: -1, c: null };
const sqToDisc = (x, y) => ({ u: x * Math.sqrt(1 - (y * y) / 2), v: y * Math.sqrt(1 - (x * x) / 2) });
function discToSq(u, v) {
  const t = u * u - v * v, q = 2 * Math.SQRT2, r = (n) => Math.sqrt(Math.max(0, n));
  const cl = (n) => Math.min(1, Math.max(-1, n));
  return { x: cl((r(2 + t + q * u) - r(2 + t - q * u)) / 2), y: cl((r(2 - t + q * v) - r(2 - t - q * v)) / 2) };
}

function drawWheel() {
  const cv = $('color-wheel'), x = cv.getContext('2d'), { size, ro, ri, rd, n } = WHEEL, c = size / 2;
  x.clearRect(0, 0, size, size);
  if (!wheelRing) {
    // 色相の輪(右上が赤。そこから左回りに、黄・緑・青)。1回作って、使い回す
    wheelRing = createCanvas(size, size);
    const r = wheelRing.getContext('2d');
    r.lineWidth = ro - ri;
    for (let i = 0; i < 360; i++) {
      r.strokeStyle = `hsl(${i}, 100%, 50%)`;
      r.beginPath();
      r.arc(c, c, (ro + ri) / 2, (-(i + HUE_TURN + 1.3) * Math.PI) / 180, (-(i + HUE_TURN - 0.3) * Math.PI) / 180);
      r.stroke();
    }
  }
  x.drawImage(wheelRing, 0, 0);
  const hk = Math.round(hsv.h) % 360;
  if (wheelDisc.h !== hk) {
    // 中の丸は、色相が変わったときだけ作り直す
    wheelDisc.c ||= createCanvas(n, n);
    const img = new ImageData(n, n), d = img.data;
    for (let py = 0, i = 0; py < n; py++) {
      for (let px = 0; px < n; px++, i += 4) {
        let u = ((px + 0.5) / n) * 2 - 1, v = ((py + 0.5) / n) * 2 - 1;
        const l = Math.hypot(u, v);
        if (l > 1.03) continue;
        if (l > 1) { u /= l; v /= l; }
        const q = discToSq(u, v), s = (q.x + 1) / 2, val = (1 - q.y) / 2;
        for (let k = 0; k < 3; k++) { const m = ([5, 3, 1][k] + hk / 60) % 6; d[i + k] = 255 * (val - val * s * Math.max(0, Math.min(m, 4 - m, 1))); }
        d[i + 3] = 255;
      }
    }
    wheelDisc.c.getContext('2d').putImageData(img, 0, 0);
    wheelDisc.h = hk;
  }
  x.save();
  x.beginPath(); x.arc(c, c, rd, 0, Math.PI * 2); x.clip();
  x.imageSmoothingEnabled = true;
  x.drawImage(wheelDisc.c, c - rd - 2, c - rd - 2, rd * 2 + 4, rd * 2 + 4);
  x.restore();
  const ring = (px, py, r) => {
    x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.6)'; x.beginPath(); x.arc(px, py, r + 2, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 3; x.strokeStyle = '#fff'; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.stroke();
  };
  const ha = (-(hsv.h + HUE_TURN) * Math.PI) / 180, hr = (ro + ri) / 2;
  ring(c + Math.cos(ha) * hr, c + Math.sin(ha) * hr, (ro - ri) / 2 - 5);
  const p = sqToDisc(hsv.s * 2 - 1, 1 - hsv.v * 2);
  ring(c + p.u * rd, c + p.v * rd, 13);
}

// 色のパネルの形と、出すもの(設定と、パネルの中のボタンで変わる)
function applyColorUi() {
  const circle = state.colorWheel === 'circle', u = state.colorUi;
  $('color-wheel').hidden = !circle;
  $('pop-color').classList.toggle('wheel', circle);
  $('pop-color').classList.toggle('no-extra', !u.extras);
  $('pop-color').classList.toggle('no-outline', !u.outline);
  $('sw-box').style.display = u.swatches ? '' : 'none';
  $('sw-toggle').classList.toggle('on', !!u.swatches);
}

function drawPicker() {
  if (state.colorWheel === 'circle') { drawWheel(); return; }
  const sv = $('color-sv'), x = sv.getContext('2d'), w = sv.width, h = sv.height;
  x.fillStyle = `hsl(${hsv.h}, 100%, 50%)`;
  x.fillRect(0, 0, w, h);
  let g = x.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  const px = hsv.s * w, py = (1 - hsv.v) * h;
  x.lineWidth = 2;
  x.strokeStyle = '#000'; x.beginPath(); x.arc(px, py, 7, 0, Math.PI * 2); x.stroke();
  x.strokeStyle = '#fff'; x.beginPath(); x.arc(px, py, 5.5, 0, Math.PI * 2); x.stroke();

  const hue = $('color-hue'), y = hue.getContext('2d');
  g = y.createLinearGradient(0, 0, 0, hue.height);
  for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60}, 100%, 50%)`);
  y.fillStyle = g; y.fillRect(0, 0, hue.width, hue.height);
  const hy = (hsv.h / 360) * hue.height;
  y.fillStyle = '#fff'; y.fillRect(0, hy - 2, hue.width, 4);
  y.strokeStyle = '#000'; y.lineWidth = 1; y.strokeRect(0.5, hy - 2.5, hue.width - 1, 5);
}

function syncColor(fromPicker = false) {
  if (!fromPicker) {
    const n = rgbToHsv(hexRgb(state.fg));
    if (n.s > 0 && n.v > 0) hsv.h = n.h;
    hsv.s = n.s;
    hsv.v = n.v;
  }
  $('sw-fg').style.background = state.fg;
  $('sw-bg').style.background = state.bg;
  for (const d of document.querySelectorAll('#color-dot')) d.style.background = state.fg;
  if (document.activeElement !== $('in-hex')) $('in-hex').value = state.fg.toUpperCase();
  // CMYK の目安(インクの割合。色の見本帳や印刷所の数字とは、少しちがうことがある)
  const { r, g, b } = hexRgb(state.fg), k = 1 - Math.max(r, g, b) / 255, pc = (v) => Math.round((k >= 1 ? 0 : (1 - v / 255 - k) / (1 - k)) * 100);
  $('cmyk-read').textContent = `C ${pc(r)}  M ${pc(g)}  Y ${pc(b)}  K ${Math.round(k * 100)}`;
  drawPicker();
  if ($('pop-brush').classList.contains('open')) drawBrushList();
}

// 描いた色・塗った色を、色の履歴に入れる(新しい順)
function noteColor() {
  const c = state.fg, list = state.recentColors;
  const i = list.indexOf(c);
  if (i === 0) return;
  if (i > 0) list.splice(i, 1);
  list.unshift(c);
  list.length = Math.min(list.length, RECENT);
  drawSwatches();
  emit('settings');
}

// 色の履歴と、よく使う色(自分で並べる)。どちらも四角いマス。
//   履歴: 押すと、その色になる
//   よく使う色: 空いたマスを押すと、今の色を登録。色のあるマスを押すと、その色になる。長押しで、今の色に入れ替え(同じ色なら、外す)
function drawSwatches() {
  const cell = (col) => {
    const b = document.createElement('button');
    if (col) { b.style.background = col; b.title = col.toUpperCase(); } else b.className = 'empty';
    return b;
  };
  const rc = $('recent-colors');
  rc.textContent = '';
  for (let i = 0; i < RECENT; i++) {
    const col = state.recentColors[i], b = cell(col);
    if (col) b.onclick = () => { state.fg = col; emit('color'); };
    else b.disabled = true;
    rc.append(b);
  }
  const pal = $('palette');
  pal.textContent = '';
  if (!Array.isArray(state.palette)) state.palette = [];
  while (state.palette.length < PALETTE) state.palette.push(null);
  state.palette.slice(0, PALETTE).forEach((col, i) => {
    const b = cell(col);
    b.dataset.slot = i;
    const put = (c) => { state.palette[i] = c; say(c ? 'paletteSet' : 'paletteClear'); drawSwatches(); emit('settings'); };
    let timer = 0, held = false;
    b.addEventListener('pointerdown', () => {
      held = false;
      timer = setTimeout(() => { held = true; put(col === state.fg ? null : state.fg); }, HOLD);
    });
    for (const t of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(t, () => clearTimeout(timer));
    b.onclick = () => {
      if (held) { held = false; return; }
      if (col) { state.fg = col; emit('color'); } else put(state.fg);
    };
    pal.append(b);
  });
}

// el の上でのドラッグ。fn(横 0〜1, 縦 0〜1)、end()、hold()(押したまま止めていたとき。動かしたあとに止めたときも)
function dragOn(el, fn, end, hold, holdMs = HOLD) {
  el.addEventListener('pointerdown', (e) => {
    try { el.setPointerCapture(e.pointerId); } catch { /* つかめなくても続ける */ }
    let held = false, timer = 0;
    let ax = e.clientX, ay = e.clientY; // 止まっているとみなす所
    // 押してすぐの長押しは HOLD、動かしたあとは、少し長め(値を見ながらゆっくり動かしているだけ、を拾わない)
    const arm = (ms) => { clearTimeout(timer); if (hold) timer = setTimeout(() => { held = true; hold(); }, ms); };
    const apply = (ev) => {
      const r = el.getBoundingClientRect();
      fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
    };
    const move = (ev) => {
      const far = Math.hypot(ev.clientX - ax, ev.clientY - ay);
      if (held) { if (far <= 10) return; held = false; } // 長押しのあと、はっきり動かしたら、続きから
      if (far > 4) { ax = ev.clientX; ay = ev.clientY; arm(holdMs + 250); }
      apply(ev);
    };
    apply(e);
    arm(holdMs);
    const up = () => {
      clearTimeout(timer);
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      end?.();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

function initColor() {
  const picked = () => { state.fg = hsvToHex(hsv); syncColor(true); requestRender(); };
  dragOn($('color-sv'), (u, v) => { hsv.s = u; hsv.v = 1 - v; picked(); }, () => emit('color'));
  dragOn($('color-hue'), (_u, v) => { hsv.h = Math.min(359.9, v * 360); picked(); }, () => emit('color'));
  // 丸い選び方: 押した所が、輪か中の丸かで、変えるものが決まる(離すまで、そのまま)
  let zone = null;
  dragOn($('color-wheel'), (u, v) => {
    const { size, ri, rd } = WHEEL, px = (u - 0.5) * size, py = (v - 0.5) * size;
    zone ||= Math.hypot(px, py) > (ri + rd) / 2 ? 'hue' : 'sv';
    if (zone === 'hue') hsv.h = Math.min(359.9, ((-Math.atan2(py, px) * 180) / Math.PI - HUE_TURN + 720) % 360);
    else {
      let du = px / rd, dv = py / rd;
      const l = Math.hypot(du, dv);
      if (l > 1) { du /= l; dv /= l; }
      const q = discToSq(du, dv);
      hsv.s = (q.x + 1) / 2;
      hsv.v = (1 - q.y) / 2;
    }
    picked();
  }, () => { zone = null; emit('color'); });
  $('sw-toggle').onclick = () => { state.colorUi.swatches = !state.colorUi.swatches; applyColorUi(); emit('settings'); };
  $('in-hex').addEventListener('change', (e) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(e.target.value.trim());
    if (m) state.fg = '#' + m[1].toLowerCase();
    e.target.blur();
    emit('color');
  });
  $('sw-bg').onclick = swapColors;
  $('btn-swap').onclick = swapColors;
  $('btn-default').onclick = () => { state.fg = '#000000'; state.bg = '#ffffff'; emit('color'); };
  on('color', () => syncColor());
}

export function swapColors() {
  [state.fg, state.bg] = [state.bg, state.fg];
  emit('color');
}

// ---- トップバーとサイドバー(state.topbar / state.sidebar の並びで作る。並びは、レイアウト(layout.js)で自由に変えられる) ----
// 置けるものは actions.js の ITEMS。ボタンのほかに、sep(区切りの線)・gap(すきま。残りの幅を埋める)・size / opacity(縦のバー。サイドバーだけ)

let pickTool = () => {};
const BARS = { topbar: 'topbar-actions', sidebar: 'sidebar-left' };
// 前からある id(ほかの所や動作確認が、この名前で探す)
const ITEM_ID = { undo: 'btn-undo', redo: 'btn-redo', zoom: 'zoom-side', flipView: 'btn-flip', hsb: 'btn-hsb', layers: 'btn-layers', color: 'btn-color' };

// ブラシ・消しゴム・バケツ: 押す = そのツールにする。選んでいる状態でもう一度押すと、ブラシの一覧 / バケツの設定が出る。
// 長押しでも、一覧 / 設定が出る。設定で「ブラシの長押しでスポイト」をオンにしていれば、ブラシの長押しはスポイト
function sideTool(b, id) {
  let timer = 0, held = false;
  b.addEventListener('pointerdown', () => {
    held = false;
    timer = setTimeout(() => {
      held = true;
      if (id !== 'brush' || !state.holdPick) { pickTool(id); openPop(TOOL_POP[id]); return; }
      startPick();
    }, HOLD);
  });
  for (const t of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(t, () => clearTimeout(timer));
  b.onclick = () => {
    if (held) { held = false; return; }
    if (state.pickReturn === id) { pickTool(id); return; } // スポイトをやめて、ブラシに戻る
    if (state.tool === id) { togglePop(TOOL_POP[id]); return; }
    closePops();
    pickTool(id);
  };
}

// ボタンの絵。チャーム(state.icons[id] = 自分で選んだ画像)があれば、それを出す
export function itemIcon(id, size = 22) {
  const url = state.icons?.[id];
  return url ? `<img class="charm-img" alt="" draggable="false" src="${url}" style="width:${size}px;height:${size}px">` : iconHtml(ITEMS[id], size);
}

function makeItem(id) {
  const a = ITEMS[id];
  if (!a) return null;
  if (a.sep || a.gap) { const s = document.createElement('span'); s.className = a.sep ? 'tb-sep' : 'bar-gap'; return s; }
  if (a.part) return $(a.part); // サイズ・不透明度のバー(1つだけある部品を、置いた所へ動かす)
  const b = document.createElement('button');
  b.className = a.text && id !== 'zoom' ? 'tool-btn text' : 'tool-btn';
  b.title = `${a.label}${a.hint ? '(' + a.hint + ')' : ''}`;
  if (ITEM_ID[id]) b.id = ITEM_ID[id];
  if (id === 'color') b.innerHTML = '<span id="color-dot"></span>';
  else if (id !== 'zoom') b.innerHTML = a.text && !state.icons?.[id] ? escapeHtml(a.text) : itemIcon(id);
  if (a.pop) b.dataset.pop = a.pop;
  else if (a.side) { b.dataset.tool = id; sideTool(b, id); }
  else if (a.tool) {
    b.dataset.tool = id;
    b.onclick = () => {
      // 選択ツールをもう一度押すと、囲み方(なぞる / 四角)を切り替える。設定のあるツールは、もう一度押すと、設定が出る
      if (state.tool === id && id === 'select') { toggleSelectMode(); return; }
      if (state.tool === id && a.opts) { togglePop('pop-tool'); return; }
      closePops();
      pickTool(id);
    };
  } else {
    b.dataset.action = a.action || id; // 押したときの中身は app.js(data-action のボタンをまとめて受けている)
  }
  return b;
}

export function drawBars() {
  // 1つだけある部品(バー)は、消さないように、いったん置き場に戻す
  for (const el of document.querySelectorAll('.vslider')) $('bar-parts').append(el);
  for (const [zone, boxId] of Object.entries(BARS)) {
    const box = $(boxId);
    box.textContent = '';
    state[zone].forEach((id, i) => {
      const el = makeItem(id);
      if (!el || (ITEMS[id].sideOnly && zone !== 'sidebar')) return;
      el.dataset.item = id;
      el.dataset.idx = i;
      box.append(el);
    });
  }
  syncBars();
}
export const drawTopbar = drawBars;

// バーのボタンの見た目を、今の状態に合わせる(選んでいるツール・元に戻せるか・拡大率・左右反転・重ね方・色)
function syncBars() {
  markTools();
  drawFlip();
  drawSidebar();
  const set = (sel, fn) => { for (const b of document.querySelectorAll(sel)) fn(b); };
  set('[data-action="undo"]', (b) => { b.disabled = !state.history.canUndo; });
  set('[data-action="redo"]', (b) => { b.disabled = !state.history.canRedo; });
  if (state.view) {
    const deg = Math.round((state.view.rot * 180) / Math.PI);
    set('#zoom-side', (b) => { b.innerHTML = `${Math.round(state.view.zoom * 100)}%${deg ? `<br>${deg}°` : ''}`; });
  }
  const l = state.doc?.active;
  set('.tool-btn[data-action="blendToggle"]', (b) => { b.title = `重ね方の切り替え(今: ${blendName(l?.blend || 'normal')})`; b.classList.toggle('on', !!l && l.blend !== state.blendFav[0]); });
  set('[data-action="clipToggle"]', (b) => b.classList.toggle('on', !!l?.clip));
  set('#color-dot', (d) => { d.style.background = state.fg; });
  set('[data-action="hsb"]', (b) => b.classList.toggle('active', $('pop-hsb').classList.contains('open')));
  // オン / オフのあるボタン
  const flags = { quickMask: !!state.maskMode, symmetry: state.symmetry !== 'off', grid: state.showGrid, rulers: state.showRulers, cmyk: state.cmyk, lockLayer: !!l?.locked };
  for (const [id, on] of Object.entries(flags)) set(`[data-action="${id}"]`, (b) => b.classList.toggle('on', on));
  $('view').classList.toggle('cmyk', state.cmyk);
  // 切り抜きツールの間だけ出る帯
  const crop = state.tool === 'crop';
  $('crop-bar').hidden = !crop;
  if (crop) $('crop-info').textContent = state.crop ? `${state.crop.w} × ${state.crop.h} px に切り抜きます` : 'キャンバスをなぞって、残したい範囲を囲んでください';
}

// ---- そのほかの機能(バーに置いていないもの、ぜんぶ。押すと、バーのボタンと同じように働く) ----

function drawMore() {
  const box = $('more-body');
  box.textContent = '';
  const used = new Set([...state.topbar, ...state.sidebar]);
  for (const [id, a] of Object.entries(ITEMS)) {
    if (used.has(id) || a.sep || a.gap || a.part || id === 'more') continue;
    const row = document.createElement('label');
    row.className = 'more-item';
    row.title = a.hint || '';
    const name = document.createElement('span');
    name.textContent = a.label;
    row.append(makeItem(id), name);
    box.append(row);
  }
  syncBars();
}

// ---- 今のツールの設定(図形・グラデーション・指先・模様ペン・スタンプ) ----

// いくつかから1つ選ぶボタンの並び
function seg(label, options, cur, pick) {
  const w = document.createElement('div');
  w.className = 'opt';
  w.innerHTML = `<span>${label}</span><div class="seg"></div>`;
  for (const [id, text] of options) {
    const b = document.createElement('button');
    b.textContent = text;
    b.className = id === cur ? 'on' : '';
    b.onclick = () => { pick(id); drawToolPop(); emit('settings'); };
    w.querySelector('.seg').append(b);
  }
  return w;
}

function drawToolPop() {
  const body = $('tool-body'), t = state.tool;
  body.textContent = '';
  $('tool-title').textContent = `${ITEMS[t]?.label || 'ツール'}の設定`;
  const save = () => emit('settings');
  if (t === 'shape') {
    const o = state.shape;
    body.append(opts(
      seg('形', [['rect', '四角'], ['ellipse', '楕円'], ['line', '直線'], ['triangle', '三角']], o.kind, (v) => { o.kind = v; }),
      check('中を塗りつぶす', o.fill, (v) => { o.fill = v; save(); }, 'オフにすると、線だけの図形になる(直線は、いつも線)'),
      slider('線の太さ', 1, 100, o.width, (v) => v + ' px', (v) => { o.width = v; save(); }),
      hint('キャンバスをなぞると、描画色で図形が描けます。Shift を押していると、正方形・正円・45° ずつの線になります。'),
    ));
  } else if (t === 'gradient') {
    const o = state.gradient;
    body.append(opts(
      seg('形', [['linear', '線形'], ['radial', '円形']], o.kind, (v) => { o.kind = v; }),
      seg('色', [['bg', '描画色 → 背景色'], ['clear', '描画色 → 透明']], o.to, (v) => { o.to = v; }),
      hint('押した所から離した所へ、色がなめらかに変わります。今のレイヤーの全体(選択範囲があれば、その中)に塗ります。'),
    ));
  } else if (t === 'smudge') {
    body.append(opts(
      slider('強さ', 5, 100, state.smudge.strength, (v) => v + '%', (v) => { state.smudge.strength = v; save(); }, '大きいほど、色が長くのびる'),
      hint('なぞった向きに、絵をのばします。大きさと硬さは、ブラシで選んでいるブラシのもの(左のバーで変えられます)です。'),
    ));
  } else if (t === 'pattern') {
    const o = state.pattern;
    const items = [seg('線の色', [['shade', '下の色を暗く / 明るく'], ['lum', '明るさだけ合わせる']], o.mode, (v) => { o.mode = v; })];
    if (o.mode === 'shade') items.push(slider('明るさの差', -60, 60, o.shade, (v) => (v < 0 ? `${-v}% 暗く` : v > 0 ? `${v}% 明るく` : '同じ色'), (v) => { o.shade = v; save(); }, '下の色から、どれだけ暗く(左)・明るく(右)するか'));
    items.push(
      check('何も描いていない所には描かない', o.onlyPainted, (v) => { o.onlyPainted = v; save(); }, '絵のある所(用紙は数えない)の上にだけ、線が出る。外すと、何もない所は白い紙として描く'),
      hint(o.mode === 'shade'
        ? '線の色が、通った所の下の色を少し暗く(明るく)した色になります。描画色は使いません。大きさと硬さは、ブラシで選んでいるブラシのもの(左のバーで変えられます)です。'
        : '描画色の色みのまま、明るさだけが、通った所の下の色と同じになります。大きさと硬さは、ブラシで選んでいるブラシのもの(左のバーで変えられます)です。'),
    );
    body.append(opts(...items));
  } else if (t === 'stamp') {
    const b = document.createElement('button');
    b.textContent = 'コピー元を選び直す';
    b.onclick = () => { state.cloneSrc = state.cloneOff = null; say('stampReset'); requestRender(); };
    body.append(opts(b, hint('はじめに押した所が、コピー元になります。そのあとなぞると、コピー元のまわりの絵が、ずれを保ったまま写ります。キーボードがあるときは、Alt を押しながら押しても、コピー元を選び直せます。写すのは、今のレイヤーの絵です。')));
  } else {
    body.append(hint('このツールには、設定がありません。'));
  }
}

// 重ね方を切り替える(設定の2つ。はじめは 通常 ⇄ 乗算)/ マスクをクリップを切り替える
export function toggleBlend() {
  const l = state.doc.active, [a, b] = state.blendFav;
  if (l) layers.setLayerProp(l, 'blend', l.blend === a ? b : a);
}
export function toggleClip() {
  const l = state.doc.active;
  if (l) layers.setLayerProp(l, 'clip', !l.clip);
}

function markTools() {
  const picking = state.tool === 'eyedropper' ? state.pickReturn : null; // ブラシのボタンの長押しで出したスポイト
  for (const b of document.querySelectorAll('.tool-btn[data-tool]')) {
    b.classList.toggle('active', b.dataset.tool === state.tool || (!!picking && b.dataset.tool === picking));
  }
}

// スポイトにする: ポインターがスポイトの形になり、絵を押すと色を拾って、ブラシに戻る
function startPick() {
  closePops();
  if (state.tool !== 'brush') pickTool('brush');
  pickTool('eyedropper');
  state.pickReturn = 'brush';
  markTools();
  say('pickStart');
}

// ---- 設定の部品 ----

// サイズのスライダーは、小さい方を細かく(0〜1 → 1〜500px)
const MAX_SIZE = 2000;
const sizeFromPos = (v) => Math.max(1, Math.round(MAX_SIZE ** v * 10) / 10);
const posFromSize = (s) => Math.log(Math.max(1, s)) / Math.log(MAX_SIZE);
const fmtSize = (s) => (s < 10 ? String(Math.round(s * 10) / 10) : String(Math.round(s)));

export function slider(label, min, max, value, fmt, onInput, title = '', shown = null) {
  const w = document.createElement('label');
  w.className = 'opt';
  w.title = title;
  w.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" value="${value}"><em></em>`;
  const input = w.querySelector('input'), em = w.querySelector('em');
  em.textContent = shown ?? fmt(Number(input.value)); // スライダーの目盛りに丸める前の、今の値
  input.oninput = () => { em.textContent = fmt(Number(input.value)); onInput(Number(input.value)); };
  return w;
}

export function check(label, value, onChange, title = '') {
  const w = document.createElement('label');
  w.className = 'opt check';
  w.title = title;
  w.innerHTML = `<input type="checkbox"${value ? ' checked' : ''}>${label}`;
  w.querySelector('input').onchange = (e) => onChange(e.target.checked);
  return w;
}

function hint(text) {
  const s = document.createElement('div');
  s.className = 'opt-hint';
  s.textContent = text;
  return s;
}

function opts(...items) {
  const d = document.createElement('div');
  d.className = 'opts';
  d.append(...items);
  return d;
}

// ---- サイドバー: サイズ(登録した目盛りつき)と不透明度 ----

const SNAP = 0.035; // 目盛りの近くでは、そこに吸いつく
const SIZE_HOLD = 700; // サイズのバーの長押し(登録のボタンを出す)。ほかの長押しより長め(好きな大きさに合わせている最中に、出てしまわないように。0.17.0)

function bubble(el, text) {
  const b = $('vs-bubble');
  const r = el.getBoundingClientRect(), a = $('canvas-area').getBoundingClientRect();
  b.textContent = text;
  b.style.top = `${r.top - a.top + r.height / 2}px`;
  b.classList.add('show');
}

const isMarked = (b) => (b.marks || []).some((m) => Math.abs(m - b.size) < 0.05);

function drawSidebar() {
  markTools();
  const b = currentBrush();
  for (const id of ['vs-size', 'vs-opacity']) $(id).style.display = b ? '' : 'none';
  if (!b) return;
  // つまみが枠からはみ出さないよう、上下 9px ずつ内側で動かす
  const at = (v) => `calc(${(1 - v) * 100}% + ${Math.round((v - 0.5) * 18)}px)`;
  const thumb = (id, v) => { $(id).querySelector('.vs-thumb').style.top = at(v); };
  thumb('vs-size', posFromSize(b.size));
  thumb('vs-opacity', b.opacity);
  const marks = $('vs-size').querySelector('.vs-marks');
  marks.textContent = '';
  for (const m of b.marks || []) {
    const i = document.createElement('i');
    i.style.top = at(posFromSize(m));
    marks.append(i);
  }
  $('btn-mark').textContent = isMarked(b) ? `${fmtSize(b.size)} px の登録を解除` : `${fmtSize(b.size)} px を登録`;
}

function initSidebar() {
  dragOn($('vs-size'), (_u, v) => {
    const b = currentBrush();
    if (!b) return;
    $('size-pop').classList.remove('open');
    const pos = 1 - v;
    // 登録したサイズの近くなら、そこに吸いつく
    const snapped = (b.marks || []).filter((m) => Math.abs(posFromSize(m) - pos) < SNAP).sort((p, q) => Math.abs(posFromSize(p) - pos) - Math.abs(posFromSize(q) - pos))[0];
    b.size = snapped ?? sizeFromPos(pos);
    bubble($('vs-size'), `${fmtSize(b.size)} px${snapped ? '(登録)' : ''}`);
    drawSidebar();
    requestRender();
  }, () => { $('vs-bubble').classList.remove('show'); emit('brush'); }, () => {
    // 長押し(バーを動かしたあと、そのまま止めていても): 今のサイズを登録 / 解除するボタンを、バーの横に出す
    drawSidebar();
    const p = $('size-pop'), r = $('vs-size').getBoundingClientRect(), a = $('canvas-area').getBoundingClientRect();
    $('vs-bubble').classList.remove('show');
    p.style.top = `${r.top - a.top + r.height / 2}px`;
    p.classList.add('open');
  }, SIZE_HOLD);
  dragOn($('vs-opacity'), (_u, v) => {
    const b = currentBrush();
    if (!b) return;
    b.opacity = Math.max(0.01, Math.round((1 - v) * 100) / 100);
    bubble($('vs-opacity'), `不透明度 ${Math.round(b.opacity * 100)}%`);
    drawSidebar();
  }, () => { $('vs-bubble').classList.remove('show'); emit('brush'); });
  // 今のサイズを登録する / 解除する
  $('btn-mark').onclick = () => {
    const b = currentBrush();
    if (!b) return;
    b.marks ||= [];
    const i = b.marks.findIndex((m) => Math.abs(m - b.size) < 0.05);
    if (i >= 0) { b.marks.splice(i, 1); say('markOff', { size: fmtSize(b.size) }); }
    else { b.marks.push(b.size); say('markOn', { size: fmtSize(b.size) }); }
    $('size-pop').classList.remove('open');
    emit('brush');
  };
  on('tool', drawSidebar);
  on('brush', drawSidebar);
}

// ---- ブラシのパネル: 一覧(そのブラシで引いた線が見本)・新しいブラシ・設定 ----

let tipTimer = 0;
const tipReady = () => { clearTimeout(tipTimer); tipTimer = setTimeout(() => emit('brush'), 60); };

function drawBrushList() {
  const box = $('brush-list');
  const tool = state.tool === 'eraser' ? 'eraser' : 'brush';
  $('brush-title').textContent = tool === 'eraser' ? '消しゴム' : 'ブラシ';
  box.textContent = '';
  $('brush-pick').hidden = tool !== 'brush'; // スポイトは、ブラシのときだけ
  for (const b of state.brushes.filter((x) => !!x.erase === (tool === 'eraser'))) {
    const row = document.createElement('button');
    row.className = 'brush-item' + (state.brushId[tool] === b.id ? ' active' : '');
    row.dataset.brush = b.id;
    const c = createCanvas(260, 60);
    const x = c.getContext('2d');
    x.scale(2, 2);
    // 見本: 細く入って太くなり、細く抜ける S 字。大きいブラシは見本に入る大きさに縮める
    const k = Math.min(1, 14 / b.size);
    const s = new Stroke(x, { ...b, size: b.size * k, smooth: 0, erase: false }, b.erase || state.fg === '#ffffff' ? '#9aa1ab' : state.fg);
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, px = 10 + t * 110, py = 15 + Math.sin(t * Math.PI * 2) * 6, p = Math.sin(t * Math.PI) ** 0.8;
      if (i === 0) s.begin(px, py, p); else s.add(px, py, p);
    }
    s.end();
    x.globalAlpha = 1;
    if (b.opacity < 1) { x.globalCompositeOperation = 'destination-in'; x.fillStyle = `rgba(0,0,0,${b.opacity})`; x.fillRect(0, 0, 130, 30); }
    const label = document.createElement('span');
    label.innerHTML = `${escapeHtml(b.name)}<em>${fmtSize(b.size)}</em>`;
    row.append(c, label);
    if (b.tip) loadTip(b.tip, tipReady); // 形のあるブラシ: 絵が読み込めたら、見本を描き直す
    row.onclick = () => {
      state.brushId[tool] = b.id;
      // スタンプ・指先・模様ペンは、ブラシを借りているだけなので、ツールはそのまま
      if (state.tool !== tool && !['stamp', 'smudge', 'pattern'].includes(state.tool)) emit('request-tool', tool);
      else emit('tool');
    };
    box.append(row);
  }
}

function drawBrushEditor() {
  const body = $('brush-editor-body');
  body.textContent = '';
  const b = currentBrush();
  if (!b) return;
  // スライダーを動かしている最中は、一覧の見本とサイドバーだけ描き直す(設定の欄は作り直さない)
  const changed = () => { drawBrushList(); drawSidebar(); requestRender(); emit('settings'); };
  const pct = (v) => v + '%';
  const nameRow = document.createElement('div');
  nameRow.className = 'name-row';
  const name = document.createElement('input');
  name.type = 'text';
  name.id = 'brush-name';
  name.value = b.name;
  name.maxLength = 20;
  name.title = 'ブラシの名前';
  name.onchange = () => { b.name = name.value.trim() || b.name; name.value = b.name; changed(); };
  const del = document.createElement('button');
  del.id = 'btn-brush-del';
  del.textContent = b.custom ? '削除' : '初期設定に戻す';
  del.title = b.custom ? 'このブラシを削除' : 'このブラシを、初めの設定に戻す';
  del.onclick = () => (b.custom ? deleteBrush(b) : resetBrush(b));
  nameRow.append(name, del);
  body.append(nameRow, opts(
    slider('サイズ', 0, 100, Math.round(posFromSize(b.size) * 100), (v) => fmtSize(sizeFromPos(v / 100)) + ' px', (v) => { b.size = sizeFromPos(v / 100); changed(); }, '', fmtSize(b.size) + ' px'),
    slider('不透明度', 1, 100, Math.round(b.opacity * 100), pct, (v) => { b.opacity = v / 100; changed(); }, '1本の線の濃さの上限'),
    slider('流量', 1, 100, Math.round(b.flow * 100), pct, (v) => { b.flow = v / 100; changed(); }, '重ねるほど濃くなる速さ'),
    slider('硬さ', 0, 100, Math.round(b.hardness * 100), pct, (v) => { b.hardness = v / 100; changed(); }, 'ふちのくっきりさ'),
    slider('間隔', 2, 150, Math.round(b.spacing * 100), pct, (v) => { b.spacing = v / 100; changed(); }, '判を押す間隔。大きくすると点々になる'),
    slider('丸さ', 10, 100, Math.round((b.round ?? 1) * 100), pct, (v) => { b.round = v / 100; changed(); }, '小さくすると平たい筆になる'),
    slider('角度', 0, 180, b.angle || 0, (v) => v + '°', (v) => { b.angle = v; changed(); }, '平たい筆の向き'),
    slider('散らし', 0, 200, Math.round((b.scatter || 0) * 100), pct, (v) => { b.scatter = v / 100; changed(); }, '判をばらまく(スプレーや葉っぱのような線)'),
    slider('ざらつき', 0, 100, Math.round(b.grain * 100), pct, (v) => { b.grain = v / 100; changed(); }, '紙の目(鉛筆・パステルのような線)'),
    slider('入りの細さ', 0, 100, Math.round((1 - b.minSize) * 100), pct, (v) => { b.minSize = 1 - v / 100; changed(); }, '筆圧が弱いときに、どこまで細くなるか'),
    slider('手ぶれ補正', 0, 20, b.smooth, (v) => String(v), (v) => { b.smooth = v; emit('settings'); }, '大きいほど線がなめらかに(少し遅れてついてくる)'),
    check('筆圧でサイズが変わる', b.pSize, (v) => { b.pSize = v; changed(); }, 'マウス・指のときは、速さで太さが変わります'),
    check('筆圧で濃さが変わる', b.pFlow, (v) => { b.pFlow = v; changed(); }),
  ));
}

function drawBrushGlobal() {
  const box = $('brush-global');
  box.textContent = '';
  box.append(opts(
    slider('線との隙間', 0, 100, state.lineGap, (v) => (v ? v + ' px' : 'なし'), (v) => { state.lineGap = v; emit('settings'); }, 'すでにある線から、この距離以内には色が乗らない(線のまわりに、塗れない帯ができる)'),
    check('同じ色にはくっつく', state.lineGapSame, (v) => { state.lineGapSame = v; emit('settings'); }, '今の描画色と同じ色の所には、隙間をあけない(同じ色で塗り足せる)'),
  ));
}

function newBrush() {
  const src = currentBrush();
  if (!src) return;
  let n = 1;
  while (state.brushes.some((b) => b.name === `新しいブラシ ${n}`)) n++;
  const b = { ...structuredClone(src), id: 'custom-' + Date.now().toString(36), name: `新しいブラシ ${n}`, custom: true, marks: [] };
  state.brushes.push(b);
  state.brushId[b.erase ? 'eraser' : 'brush'] = b.id;
  $('brush-editor').open = true;
  emit('tool');
  say('brushNew', { name: b.name });
  $('brush-list').querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

function deleteBrush(b) {
  const tool = b.erase ? 'eraser' : 'brush';
  state.brushes.splice(state.brushes.indexOf(b), 1);
  state.brushId[tool] = state.brushes.find((x) => !!x.erase === !!b.erase).id;
  emit('tool');
}

function resetBrush(b) {
  const d = BRUSHES.find((x) => x.id === b.id);
  if (!d) return;
  for (const k of Object.keys(b)) delete b[k];
  Object.assign(b, structuredClone(d));
  emit('tool');
}

// ---- バケツのパネル ----

function drawFill() {
  const box = $('fill-body');
  box.textContent = '';
  // 境目にする絵: どちらか1つ
  const ref = (id, label, title) => check(label, state.fillRef === id, () => { state.fillRef = id; drawFill(); emit('settings'); }, title);
  box.append(opts(
    ref('layer', '現在のレイヤーを参照', '今のレイヤーの絵だけを境目にして塗る(ほかのレイヤーの線は、ないものとして塗る)'),
    ref('canvas', 'キャンバスを参照', '見えている絵ぜんぶを境目にして塗る(線画が別のレイヤーにあっても、その線で止まる)'),
    slider('隙間閉じ', 0, 100, state.fillGap, (v) => (v ? v + ' px' : 'なし'), (v) => { state.fillGap = v; emit('settings'); }, '線が完全にくっついていなくても、切れ目がこの幅より狭ければ、そこからもれずに塗れる'),
    slider('線へのはみ出し', 0, 20, state.fillExpand, (v) => v + ' px', (v) => { state.fillExpand = v; emit('settings'); }, '塗る範囲をこれだけ広げて、線の下にもぐらせる(線とのあいだに白いすき間が残らない)'),
    slider('色の許容', 0, 128, state.fillTolerance, (v) => String(v), (v) => { state.fillTolerance = v; emit('settings'); }, '大きいほど、似た色まで広く塗る'),
    hint('「キャンバスを参照」は、見えている絵を境目にして、今のレイヤーに塗ります。線画の下のレイヤーに塗ると、線がきれいに残ります。隙間閉じを大きくすると、その幅より細い所は塗り残しが出ます。'),
  ));
}

// ---- レイヤーのパネル ----

const CLIP_ARROW = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v6a3 3 0 0 0 3 3h6M10 8l3 3-3 3"/></svg>'; // 下へおりて右を向く矢印(上の帯のクリッピングのボタンと同じ形)
let closedId = null; // 「選んだレイヤーに欄を出す」のとき、右にスライドして、欄をしまったレイヤーの id
let swiped = null; // 左にスライドして、クリッピング・ゴミ箱・大きい絵を出しているレイヤーの id
const FOLDER = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>';
const blendName = (id) => BLENDS.find((b) => b[0] === id)?.[1] || id;

// レイヤーの絵のある範囲(おおよそ。小さく縮めて調べるので、速い)。何も描いていなければ null
// **レイヤーの絵を、読み戻し用の絵に直接描かない**(0.18.0。直接描くと、レイヤーまるごと(キャンバスの大きさ)の読み戻しが、1枚につき6回走っていた。
// レイヤーのパネルを出したまま描くと、1本描くたびに、全部のレイヤーでそれが起きて、描くのが遅くなっていた)。
// いったん、ふつうの小さい絵に縮めて描き(ここまでは速い)、その小さい絵だけを読み戻す。調べた範囲は、レイヤーごとに覚えておき、絵が変わったレイヤーだけ調べ直す
let probe = null, probeSmall = null;
let boundsCache = new WeakMap();
function roughBounds(l, doc) {
  if (boundsCache.has(l)) return boundsCache.get(l);
  const b = measureBounds(l, doc);
  boundsCache.set(l, b);
  return b;
}
// 履歴が動いたとき: 絵が変わったかもしれないレイヤーの分を、忘れる
function forgetBounds() {
  const h = state.history, tops = [h.undoStack[h.undoStack.length - 1], h.redoStack[h.redoStack.length - 1]].filter(Boolean);
  if (!tops.length || tops.some((e) => !e.layer || e.structure)) { boundsCache = new WeakMap(); return; }
  for (const e of tops) boundsCache.delete(e.layer);
  if (state.doc?.active) boundsCache.delete(state.doc.active);
}
function measureBounds(l, doc) {
  const P = 96, k = P / Math.max(doc.w, doc.h), w = Math.max(1, Math.round(doc.w * k)), h = Math.max(1, Math.round(doc.h * k));
  probeSmall ||= createCanvas(P, P).getContext('2d');
  probe ||= createCanvas(P, P).getContext('2d', { willReadFrequently: true });
  probeSmall.clearRect(0, 0, P, P);
  probeSmall.imageSmoothingEnabled = true;
  probeSmall.imageSmoothingQuality = 'high';
  for (let i = 0; i < 6; i++) probeSmall.drawImage(l.canvas, 0, 0, w, h); // 重ねて描いて、小さな点やうすい線も見落とさないように
  probe.clearRect(0, 0, P, P);
  probe.drawImage(probeSmall.canvas, 0, 0);
  const d = probe.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 3; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      if (!d[i]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0 / k, y: y0 / k, w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k };
}

// 一覧が、下まで入りきらないときに出る、細いスクロールバー(右はし)
function syncLayerScroll() {
  const list = $('layer-list'), bar = $('layer-scroll');
  const over = list.scrollHeight > list.clientHeight + 1;
  bar.style.display = over ? 'block' : 'none';
  if (!over) return;
  const h = Math.max(24, (list.clientHeight * list.clientHeight) / list.scrollHeight);
  bar.style.height = h + 'px';
  bar.style.top = ((list.clientHeight - h) * list.scrollTop) / (list.scrollHeight - list.clientHeight) + 'px';
}

function drawLayers() {
  const doc = state.doc;
  if (!doc) return;
  const list = $('layer-list');
  const scroll = list.scrollTop;
  // 欄(#layer-ctl)は1つだけ。行の中に出していたら、消されないように、しまう所へ戻す。欄は「今のレイヤー」に効くので、スライドした行が今のレイヤーでなくなったら、戻す
  $('layer-ctl-home').append($('layer-ctl'));
  if (swiped !== null && swiped !== doc.activeId) swiped = null;
  if (closedId !== doc.activeId) closedId = null;
  // 欄を出す行: 「選んだレイヤーに出す」(はじめ)なら、今のレイヤー(右にスライドして、しまった行は除く。まとめて選んでいるときも、出さない)。そうでなければ、左にスライドした行
  const openId = state.layerUi.onSelect !== false ? (closedId === doc.activeId || state.multi.length ? null : doc.activeId) : swiped;
  list.textContent = '';
  const active = doc.active;
  const multi = new Set(state.multi);
  const rows = (nodes, depth) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const l = nodes[i];
      const row = document.createElement('div');
      const open = openId === l.id; // 欄を出す行: 大きい絵と、不透明度・重ね方・複製・ロック・削除など
      row.className = 'layer-item' + (l === active ? ' active' : multi.has(l.id) ? ' multi' : '') + (l.clip ? ' clipped' : '') + (open ? ' swiped' : '');
      row.dataset.id = l.id;
      row.style.paddingLeft = `${8 + depth * 18}px`;
      // 下にクリップしているレイヤーは、下向きの矢印
      if (l.clip) { const m = document.createElement('span'); m.className = 'clip-mark'; m.innerHTML = CLIP_ARROW; m.title = '下にクリップしている'; row.append(m); }
      if (l.isGroup) {
        const f = document.createElement('button');
        f.className = 'fold';
        f.textContent = l.open ? '▾' : '▸';
        f.title = '中身を開く / たたむ';
        const icon = document.createElement('span');
        icon.className = 'folder';
        icon.innerHTML = FOLDER;
        row.append(f, icon);
      } else {
        // ふだんは小さい絵。左にスライドした行は、大きい絵(大きさは、設定)
        const tw = open ? Math.min(220, Math.max(48, state.layerUi.thumb || 96)) : 30;
        const th = createCanvas(tw * 2, Math.max(16, Math.round(tw * 2 * doc.h / doc.w)));
        th.style.width = tw + 'px';
        th.className = 'thumb';
        // 小さい絵は、レイヤー全体ではなく、描いてある所を大きく見せる(小さな部品も、何が描いてあるか分かるように)
        const bd = roughBounds(l, doc);
        if (bd) {
          const pad = Math.max(bd.w, bd.h) * 0.12 + 2;
          const bx = Math.max(0, bd.x - pad), by = Math.max(0, bd.y - pad), bw = Math.min(doc.w, bd.x + bd.w + pad) - bx, bh = Math.min(doc.h, bd.y + bd.h + pad) - by;
          const k = Math.min(th.width / bw, th.height / bh), tx = th.getContext('2d');
          tx.imageSmoothingQuality = 'high';
          tx.drawImage(l.canvas, bx, by, bw, bh, (th.width - bw * k) / 2, (th.height - bh * k) / 2, bw * k, bh * k);
        } else row.dataset.empty = '1';
        row.append(th);
      }
      const name = document.createElement('span');
      name.className = 'lname';
      name.textContent = l.name + (l.lockAlpha ? ' ◪' : '') + (l.text ? ' Ｔ' : '');
      // ロックの印(Kodai で描いた鍵。名前と見分けやすいよう、灰色)
      const lock = l.locked ? Object.assign(document.createElement('i'), { className: 'lock-mark', title: 'ロックしている' }) : null;
      const info = document.createElement('em');
      info.textContent = (l.blend !== 'normal' ? blendName(l.blend) + ' ' : '') + (l.opacity < 1 ? Math.round(l.opacity * 100) + '%' : '');
      const eye = document.createElement('button');
      eye.className = 'eye' + (l.visible ? '' : ' off');
      eye.title = '表示 / 非表示。ここを上下になぞると、まとめて選べる';
      eye.textContent = l.visible ? '●' : '○';
      // 左にスライドした行は、絵の右に、欄(#layer-ctl)だけ(名前・空の印・表示の丸は出さない。0.20.0。ユーザー「まとまってるとありがたい」)
      if (open) {
        const side = Object.assign(document.createElement('div'), { className: 'row-side' });
        side.append($('layer-ctl'));
        row.append(side);
      } else {
        row.append(name);
        if (lock) row.append(lock);
        row.append(info);
        // 何も描いていないレイヤーには、「空」の印
        if (row.dataset.empty) { const m = document.createElement('i'); m.className = 'empty-mark'; m.textContent = '空'; m.title = 'このレイヤーには、何も描いていない'; row.append(m); }
        row.append(eye);
      }
      list.append(row);
      if (l.isGroup && l.open) rows(l.children, depth + 1);
    }
  };
  rows(doc.layers, 0);
  list.scrollTop = scroll;
  syncLayerScroll();
  // 重ね方: ボタン1つ。押すたびに、設定の2つ(はじめは 通常 / 乗算)を切り替える。ボタンには、今の重ね方を出す
  const cur = active?.blend || 'normal';
  const tg = $('blend-toggle');
  tg.textContent = blendName(cur);
  tg.classList.toggle('on', cur !== state.blendFav[0]);
  $('layer-blend').value = cur;
  $('layer-opacity').value = Math.round((active?.opacity ?? 1) * 100);
  $('layer-opacity-val').textContent = Math.round((active?.opacity ?? 1) * 100) + '%';
  $('layer-lock').checked = !!active?.lockAlpha;
  $('layer-lock').disabled = !!active?.isGroup;
  $('layer-clip').checked = !!active?.clip;
}

// 設定で隠してある項目(ほかの合成モード・アルファロック・名前・▲▼・解除)を、出す / 隠す
export function applyLayerUi() {
  const u = state.layerUi;
  // 欄に出すものと、その並び(state.layerCtl)。前からの設定(レイヤーのパネルに出すもののチェック)でも、出る
  const list = state.layerCtl, legacy = { blendAll: u.allBlends, alphaLock: u.alphaLock };
  for (const el of document.querySelectorAll('#layer-ctl [data-ctl]')) {
    const id = el.dataset.ctl, at = list.indexOf(id), old = !!(el.dataset.opt ? u[el.dataset.opt] : legacy[id]);
    el.hidden = at < 0 && !old;
    el.style.order = at < 0 ? 90 : at;
  }
  $('layer-more').hidden = !u.allBlends && !u.alphaLock && !list.includes('blendAll') && !list.includes('alphaLock');
  $('layer-blend').hidden = !u.allBlends && !list.includes('blendAll');
  $('lock-row').hidden = !u.alphaLock && !list.includes('alphaLock');
  if ($('pop-layers').classList.contains('open')) drawLayers();

}

export async function renameLayer(l = state.doc.active) {
  if (!l) return;
  const { value, body } = await openModal({
    title: '名前を変更',
    body: `<label>名前 <input type="text" id="rn-name" value="${escapeHtml(l.name)}"></label>`,
    buttons: [{ label: 'キャンセル', value: null }, { label: 'OK', value: 'ok', primary: true }],
  });
  const n = body.querySelector('#rn-name').value.trim();
  if (value === 'ok' && n) layers.setLayerProp(l, 'name', n);
}

// 一覧の操作(一覧そのものに1回だけ付ける。行は描き直すたびに作り直されるので):
//   押す = 選ぶ(Shift / Ctrl で足す) / 持って動かす = 並べ替え(指は、少し押してから動かす。すぐ動かすと一覧のスクロール) /
//   右はしの ● を押す = 表示の切り替え、上下になぞる = まとめて選ぶ
function initLayerList() {
  const list = $('layer-list');
  let g = null; // 今の操作
  const rowAt = (y) => {
    for (const r of list.querySelectorAll('.layer-item')) {
      const b = r.getBoundingClientRect();
      if (y >= b.top && y < b.bottom) return r;
    }
    return null;
  };
  const nodeOf = (row) => (row ? state.doc.find(Number(row.dataset.id)) : null);
  const clearDrop = () => { for (const r of list.querySelectorAll('.drop-above, .drop-below, .drop-into')) r.classList.remove('drop-above', 'drop-below', 'drop-into'); };

  list.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.layer-item');
    if (!row || e.button > 0) return;
    if (e.target.closest('#layer-ctl')) return; // 左にスライドして出た欄(重ね方・不透明度・ボタン)は、そのまま使える
    const node = nodeOf(row);
    if (!node) return;
    // ほかの行を触ったら、スライドして出したものは戻す
    if (swiped !== null && swiped !== node.id) { swiped = null; drawLayers(); }
    if (e.target.closest('.fold')) { node.open = !node.open; drawLayers(); return; }
    try { list.setPointerCapture(e.pointerId); } catch { /* つかめなくても続ける */ }
    g = { node, id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), touch: e.pointerType === 'touch', eye: !!e.target.closest('.eye'), mode: null, add: e.shiftKey || e.ctrlKey || e.metaKey, lastY: e.clientY };
    e.preventDefault();
  });

  list.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    if (!g.mode) {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 6) return;
      // 横になぞった: 左 = クリッピング・ゴミ箱・大きい絵を出す、右 = 戻す
      if (!g.eye && Math.abs(e.clientX - g.x) > Math.abs(e.clientY - g.y) * 1.5) g.mode = 'swipe';
      else if (g.eye) g.mode = 'sweep';
      else if (g.touch && performance.now() - g.t < 220) g.mode = 'scroll';
      else {
        g.mode = 'drag';
        // 選んでいないレイヤーを持ったら、それだけを動かす
        const picked = layers.selectedNodes();
        g.nodes = picked.includes(g.node) ? picked : [g.node];
        if (!picked.includes(g.node)) layers.setActive(g.node.id);
        list.classList.add('dragging');
      }
    }
    if (g.mode === 'scroll') {
      list.scrollTop -= e.clientY - g.lastY;
      g.lastY = e.clientY;
    } else if (g.mode === 'sweep') {
      // なぞった範囲の行を、まとめて選ぶ
      const rows = [...list.querySelectorAll('.layer-item')];
      const a = rows.findIndex((r) => Number(r.dataset.id) === g.node.id), b = rows.indexOf(rowAt(e.clientY));
      if (a < 0 || b < 0) return;
      const ids = rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => Number(r.dataset.id));
      state.doc.activeId = g.node.id;
      state.multi = ids.filter((id) => id !== g.node.id);
      for (const r of rows) {
        const id = Number(r.dataset.id);
        r.classList.toggle('active', id === g.node.id);
        r.classList.toggle('multi', id !== g.node.id && ids.includes(id));
      }
      g.swept = true;
    } else if (g.mode === 'drag') {
      clearDrop();
      const row = rowAt(e.clientY), target = nodeOf(row);
      g.target = null;
      if (!target || g.nodes.includes(target)) return;
      const b = row.getBoundingClientRect(), f = (e.clientY - b.top) / b.height;
      const where = target.isGroup ? (f < 0.35 ? 'above' : 'into') : f < 0.5 ? 'above' : 'below';
      if (target.paper && where === 'below') return;
      g.target = target;
      g.where = where;
      row.classList.add('drop-' + where);
    }
  });

  const end = (e) => {
    if (!g || e.pointerId !== g.id) return;
    const d = g;
    g = null;
    clearDrop();
    list.classList.remove('dragging');
    if (e.type === 'pointercancel') { drawLayers(); return; }
    if (d.mode === 'drag') { if (d.target) layers.moveNodes(d.nodes, d.target, d.where); else drawLayers(); return; }
    if (d.mode === 'sweep') { emit('layers'); return; }
    if (d.mode === 'scroll') return;
    if (d.mode === 'swipe') {
      const left = e.clientX - d.x < -16;
      swiped = left ? d.node.id : null;
      closedId = left ? null : d.node.id; // 右にスライド: 欄をしまう(ほかのレイヤーを選ぶまで)
      // 欄は「今のレイヤー」に効くので、スライドした行を、今のレイヤーにする
      if (swiped !== null && swiped !== state.doc.activeId) layers.setActive(swiped); else drawLayers();
      return;
    }
    // 動かさずに離した
    if (d.eye) { layers.setLayerProp(d.node, 'visible', !d.node.visible); return; }
    // すばやく2回 = 名前を変更
    const now = performance.now();
    if (lastTap.id === d.node.id && now - lastTap.t < 380) { lastTap.id = null; renameLayer(d.node); return; }
    lastTap.id = d.node.id;
    lastTap.t = now;
    layers.setActive(d.node.id, d.add);
  };
  const lastTap = { id: null, t: 0 };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  list.addEventListener('scroll', syncLayerScroll);
  window.addEventListener('resize', syncLayerScroll);
  // 一覧の外を触ったら、スライドして出したものは戻す
  document.addEventListener('pointerdown', (e) => {
    if (swiped === null || e.target.closest('#layer-list')) return;
    swiped = null;
    drawLayers();
  }, true);
}

function initLayers() {
  const sel = $('layer-blend');
  for (const [id, label] of BLENDS) sel.add(new Option(label, id));
  sel.onchange = () => { const l = state.doc.active; if (l) layers.setLayerProp(l, 'blend', sel.value); sel.blur(); };
  $('blend-toggle').onclick = toggleBlend;
  $('layer-opacity').oninput = (e) => {
    const l = state.doc.active;
    if (!l) return;
    l.opacity = Number(e.target.value) / 100;
    $('layer-opacity-val').textContent = e.target.value + '%';
    state.dirty = true;
    requestRender();
  };
  $('layer-opacity').onchange = () => emit('layers');
  $('layer-lock').onchange = (e) => { const l = state.doc.active; if (l && !l.isGroup) layers.setLayerProp(l, 'lockAlpha', e.target.checked); };
  $('layer-clip').onchange = (e) => { const l = state.doc.active; if (l) layers.setLayerProp(l, 'clip', e.target.checked); };
  initLayerList();
  on('layers', drawLayers);
  on('layers', syncBars);
  for (const evt of ['flags', 'mask', 'crop', 'tool']) on(evt, syncBars);
  on('tool', () => { if ($('pop-tool').classList.contains('open')) drawToolPop(); });
  on('brush', () => { for (const b of state.brushes) if (b.tip) loadTip(b.tip, requestRender); });
  // そのほかの機能は、選んだら閉じる(小窓・右に固めたときは、出したまま)
  $('pop-more').addEventListener('click', (e) => { if (e.target.closest('.more-item') && !pinned('pop-more')) closeWin('pop-more'); });
  on('doc', syncBars);
  on('doc', drawLayers);
  // 描いたあとの小さい絵(サムネイル)は、パネルを開いているときだけ、少し待ってから更新
  let timer = 0;
  on('doc', () => { boundsCache = new WeakMap(); });
  on('history', () => {
    forgetBounds();
    if (!$('pop-layers').classList.contains('open')) return;
    clearTimeout(timer);
    timer = setTimeout(drawLayers, 250);
  });
}

// ---- 移動・変形の帯(画面の下)、画面の色合い、ボタンの大きさ ----

function drawMoveBar() {
  $('move-bar').hidden = state.tool !== 'move' || document.body.classList.contains('layout-mode');
  for (const b of document.querySelectorAll('[data-move-mode]')) b.classList.toggle('on', b.dataset.moveMode === state.moveMode);
  $('move-ratio').checked = state.moveKeepRatio;
}

function initMoveBar() {
  for (const b of document.querySelectorAll('[data-move-mode]')) b.onclick = () => setMoveMode(b.dataset.moveMode);
  $('move-ratio').onchange = (e) => { state.moveKeepRatio = e.target.checked; emit('settings'); };
  for (const evt of ['tool', 'move-mode']) on(evt, drawMoveBar);
}

// 画面の色合い(state.theme)と、左のバーのボタンの大きさ(state.iconSize)を、画面に入れる。色は styles.css の変数
// 色とデザイン(state.look): バーとタブの色・敷く素材を、自分で決められる。タブは、決めなければバーと同じ(色も素材も)。
// 色の明るさを見て、文字・ボタン・線の色を、読めるように作る(明るい色なら、暗い文字)
function tones(hex) {
  const { r, g, b } = hexRgb(hex), dark = (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
  const mix = (k, to) => '#' + [r, g, b].map((v) => Math.round(v + (to - v) * k).toString(16).padStart(2, '0')).join('');
  return dark
    ? { text: '#e4e6ea', muted: '#9aa1ab', p2: mix(0.12, 255), border: mix(0.22, 255), bg: mix(0.28, 0) }
    : { text: '#1b1c1f', muted: '#565b63', p2: mix(0.1, 0), border: mix(0.28, 0), bg: mix(0.4, 255) };
}
function scopeCss(sel, bgVar, color, img, tone) {
  const t = tones(tone || color || '#1b1c1f');
  return `${sel}{${color ? `${bgVar}:${color};` : ''}--text:${t.text};--muted:${t.muted};--panel-2:${t.p2};--border:${t.border};--bg:${t.bg};color:${t.text};`
    + `${img ? `background-image:url("${img}") !important;` : ''}}\n`;
}

export function applyLook() {
  const root = document.documentElement, k = state.look;
  root.dataset.theme = state.theme;
  root.dataset.icons = state.iconSize;
  root.dataset.hand = state.leftHanded ? 'left' : 'right'; // 左利きモード(styles.css の 0.24.0)
  // サイズ・不透明度のバーの形(角丸 / 串団子)と、つまみに入れる絵(チャーム)
  root.dataset.bar = state.barStyle;
  root.dataset.charm = state.barCharm ? '1' : '';
  root.style.setProperty('--charm', state.barCharm ? `url("${state.barCharm}")` : 'none');
  let css = '';
  if (k.bar || k.barImg) css += scopeCss('#topbar,#sidebar-left,#dock-right', '--bar', k.bar, k.barImg, k.barImg ? k.barTone : null);
  // タブ(押すと出るパネル): 自分の色・素材がなければ、バーと同じ
  const popColor = k.pop || k.bar, popImg = k.popImg || (k.pop ? null : k.barImg);
  if (popColor || popImg) css += scopeCss('.pop,#move-bar,#crop-bar', '--pop-bg', popColor, popImg, popImg ? (k.popImg ? k.popTone : k.barTone) : null) + '.pop.dock{background-image:none !important}\n';
  let st = $('look-style');
  if (!st) { st = document.createElement('style'); st.id = 'look-style'; document.head.append(st); }
  st.textContent = css;
  if (k.canvas) root.style.setProperty('--canvas-bg', k.canvas); else root.style.removeProperty('--canvas-bg');
  state.canvasBg = getComputedStyle(root).getPropertyValue('--canvas-bg').trim() || '#2a2b2f';
  requestRender();
}

// ---- タイトル・ズーム ----

function fileName() {
  return state.filePath ? state.filePath.split(/[\\/]/).pop() : '無題';
}

function drawTitle() {
  document.title = `${state.dirty ? '● ' : ''}${fileName()} - Kaiju${state.appVersion ? ' v' + state.appVersion : ''}`;
  syncBars();
  $('app-version').textContent = `Kaiju${state.appVersion ? ' v' + state.appVersion : ''}${state.doc ? ` / ${state.doc.w} × ${state.doc.h} px` : ''}${state.offlineReady ? ' / オフラインで使えます' : ''}`;
  $('splash-text').textContent = `Kaiju${state.appVersion ? ' v' + state.appVersion : ''}`;
}

// 設定を変えたあとに、画面の部品を作り直す
export function refreshUi() {
  applyLook();
  applyColorUi();
  drawPicker();
  drawMoveBar();
  drawBars();
  applyLayerUi();
  drawPins();
  drawLayers();
  drawBrushGlobal();
  drawFill();
}

export function initUI(setTool) {
  pickTool = setTool;
  initPops();
  initColor();
  initSidebar();
  initLayers();
  initMoveBar();
  $('btn-brush-new').onclick = newBrush;
  $('brush-pick').onclick = startPick;
  const brushPop = () => { if ($('pop-brush').classList.contains('open')) { drawBrushList(); drawBrushEditor(); } };
  on('tool', brushPop);
  on('brush', brushPop);
  on('title', drawTitle);
  on('history', drawTitle);
  on('doc', drawTitle);
  on('stroke', noteColor);
  on('settings', drawPins);
  on('selection', markTools);
  // 色の調整の最中に、レイヤーや絵が変わるような操作をしたら、調整はやめる
  on('layers', () => { if (isAdjusting() && !Object.keys(ADJUST_POPS).some((id) => $(id).classList.contains('open'))) endAdjust(false); });
  on('zoom', () => {
    syncBars(); // キャンバスの拡大率(回しているときは、角度も)と、左右反転のボタン
  });
  let toastTimer = 0;
  on('toast', (msg) => {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  });
  refreshUi();
  syncColor();
  drawSwatches();
  for (const id of WINDOWS) if (pinned(id) && !isAdjust(id)) openPop(id);
  // アップデートで機能が増えたとき: バーの並びを自分で変えている人には、並びを変えずに、増えたことだけを知らせる
  if (newItems.length) setTimeout(() => say('newItems', { count: newItems.length }), 1200);
  // 起動のとき: 右下に、アイコンとバージョンを少しのあいだ出す
  setTimeout(() => $('splash').classList.add('hide'), 4500);
}
