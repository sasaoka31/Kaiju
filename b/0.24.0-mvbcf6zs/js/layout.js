// レイアウト: トップバーとサイドバーに並ぶもの(ボタン・バー・区切りの線・すきま)を、持って好きな所へ動かす。
//   メニュー →「レイアウト」(Windows 版は、上のメニューの「ヘルプ」の横にも)で始めて、「完了」で終える。
//   その間は、ボタンを押しても動かない(持って動かすだけ)。下の箱には、置いていないものが並ぶ。箱へ入れると、バーから外れる。
//   並びは state.topbar / state.sidebar(ITEMS の id の配列)。区切りの線とすきまは、いくつでも置ける
import { state, emit } from './state.js';
import { ITEMS } from './actions.js';
import { drawBars, closePops, itemIcon } from './ui.js';
import { DEFAULT_TOPBAR, DEFAULT_SIDEBAR } from './prefs.js';
import { escapeHtml } from './modal.js';
import { say } from './messages.js';

const $ = (id) => document.getElementById(id);
const ZONES = { topbar: 'topbar-actions', sidebar: 'sidebar-left' };
const ONE = (id) => !!ITEMS[id].part; // 1つしか置けないもの(サイズ・不透明度のバー。ほかは、同じものをいくつ置いてもよい。0.18.0)
let active = false;
let D = null; // 持って動かしている最中: { id, from('topbar' | 'sidebar' | 'tray'), idx, ghost, mark, to, at }

export const isLayout = () => active;

function drawTray() {
  const tray = $('layout-tray');
  tray.textContent = '';
  const used = new Set([...state.topbar, ...state.sidebar]);
  for (const [id, a] of Object.entries(ITEMS)) {
    if (used.has(id) && ONE(id)) continue;
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.tray = id;
    const icon = a.sep ? '<i class="tb-sep"></i>' : a.gap ? '<i class="gap-icon">↔</i>' : a.icon || a.png || state.icons[id] ? itemIcon(id, 18) : `<i class="txt">${escapeHtml(a.text || '')}</i>`;
    b.innerHTML = `${icon}<span>${escapeHtml(a.label)}</span>`;
    tray.append(b);
  }
}

export function toggleLayout(on = !active) {
  if (on === active) return;
  active = on;
  if (on) closePops();
  document.body.classList.toggle('layout-mode', on);
  $('layout-bar').hidden = !on;
  if (on) drawTray();
  say(on ? 'layoutOn' : 'layoutOff');
}

export function resetLayout() {
  state.topbar = [...DEFAULT_TOPBAR];
  state.sidebar = [...DEFAULT_SIDEBAR];
  state.layoutCustom = false; // はじめの並びに戻した(これからは、その版のはじめの並びについていく)
  drawBars();
  if (active) drawTray();
  emit('settings');
  say('layoutReset');
}

// (x, y) の下にあるバー(か箱)と、そこでの入る位置
function target(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  if (el.closest('#layout-bar')) return { to: 'tray' };
  for (const [zone, boxId] of Object.entries(ZONES)) {
    // トップバーは、メニューのボタンの上や、バーの空いた所でもよい
    const box = $(boxId), hit = zone === 'topbar' ? el.closest('#topbar') : el.closest('#' + boxId);
    if (!hit) continue;
    const items = [...box.children].filter((c) => c.dataset.item !== undefined);
    let at = items.length;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (zone === 'topbar' ? x < r.left + r.width / 2 : y < r.top + r.height / 2) { at = i; break; }
    }
    return { to: zone, at, before: items[at] || null, box };
  }
  return null;
}

function move(e) {
  if (!D) return;
  e.preventDefault();
  D.ghost.style.transform = `translate3d(${e.clientX - D.gx}px, ${e.clientY - D.gy}px, 0)`;
  D.mark.remove();
  const t = target(e.clientX, e.clientY);
  D.t = t;
  $('layout-bar').classList.toggle('drop', t?.to === 'tray' && D.from !== 'tray');
  if (t && t.to !== 'tray') {
    D.mark.className = 'layout-mark ' + t.to;
    t.box.insertBefore(D.mark, t.before);
  }
}

function end(e) {
  if (!D) return;
  const d = D;
  D = null;
  d.ghost.remove();
  d.mark.remove();
  d.el.classList.remove('lifted');
  $('layout-bar').classList.remove('drop');
  document.removeEventListener('pointermove', move, true);
  for (const type of ['pointerup', 'pointercancel']) document.removeEventListener(type, end, true);
  const t = e.type === 'pointerup' ? d.t : null;
  if (!t || (t.to === 'tray' && d.from === 'tray')) return;
  if (t.to !== 'tray' && ITEMS[d.id].sideOnly && t.to !== 'sidebar') { say('layoutSideOnly'); return; }
  let at = t.at;
  if (d.from !== 'tray') {
    state[d.from].splice(d.idx, 1);
    if (d.from === t.to && d.idx < at) at--;
  }
  if (t.to !== 'tray') state[t.to].splice(at, 0, d.id);
  state.layoutCustom = true; // 自分で変えた並びは、アップデートしても、そのまま
  drawBars();
  drawTray();
  emit('settings');
}

function begin(e, el, id, from) {
  const r = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.classList.add('layout-ghost');
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  document.body.append(ghost);
  el.classList.add('lifted');
  D = { id, from, idx: Number(el.dataset.idx), el, ghost, mark: document.createElement('span'), gx: e.clientX - r.left, gy: e.clientY - r.top, t: null };
  ghost.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
  document.addEventListener('pointermove', move, true);
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, end, true);
}

// レイアウトを変えている間は、ふつうの操作(押す・描く)を止めて、持って動かすだけにする
document.addEventListener('pointerdown', (e) => {
  if (!active) return;
  if (e.target.closest('.lb-btn, .modal-backdrop')) return;
  e.stopPropagation();
  e.preventDefault();
  if (D || e.button > 0) return;
  const chip = e.target.closest('[data-tray]');
  if (chip) { begin(e, chip, chip.dataset.tray, 'tray'); return; }
  const el = e.target.closest('[data-item]');
  const zone = el && Object.keys(ZONES).find((z) => el.parentElement === $(ZONES[z]));
  if (zone) begin(e, el, el.dataset.item, zone);
}, true);
for (const type of ['click', 'dblclick', 'contextmenu']) {
  document.addEventListener(type, (e) => {
    if (!active || e.target.closest('.lb-btn, .modal-backdrop')) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}
window.addEventListener('keydown', (e) => { if (active && e.key === 'Escape') { e.stopPropagation(); toggleLayout(false); } }, true);
$('layout-done').onclick = () => toggleLayout(false);
$('layout-reset').onclick = resetLayout;
// 色とデザイン: レイアウトを終えて、設定(見た目)を開く
// 箱は、指でなぞっても送れない(なぞると、ボタンを持つことになる)ので、▲ ▼ で送る
$('layout-up').onclick = () => { $('layout-tray').scrollTop -= 90; };
$('layout-down').onclick = () => { $('layout-tray').scrollTop += 90; };
$('layout-layer').onclick = () => { toggleLayout(false); emit('open-layer-ctl'); };
$('layout-look').onclick = () => { toggleLayout(false); emit('open-settings'); };
