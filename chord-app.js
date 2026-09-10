/* BASS 和弦音与琶音速查 — 交互逻辑
 * 依赖 chord-engine.js：TUNINGS（贝斯调弦）、CHORD_TYPES、PITCH_SHARP/PITCH_FLAT、
 * mod12 / noteName / chordSemitones / chordSymbol / CHORD_TYPE_MAP / fretboardPositions。
 * 贝斯不弹六弦和弦图，所以本页只展示：
 *   1) 当前和弦组成音在贝斯指板上的全部可弹位置（根/3/5/7 分级数标色）
 *   2) 一条推荐的上行琶音路径（1-3-5-7 最顺手走向）
 */

"use strict";

const STORAGE_KEY = "bass-chord-finder-settings";

const DEFAULT_STATE = {
  root: 0,           // C
  typeId: "maj7",
  tuningId: "standard",
  accidental: "sharp",
  labelMode: "note", // note | degree
  fretRange: { min: 0, max: 12 },
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === "object") {
      return {
        root: Number.isFinite(saved.root) ? Number(saved.root) % 12 : DEFAULT_STATE.root,
        typeId: CHORD_TYPE_MAP[saved.typeId] ? saved.typeId : DEFAULT_STATE.typeId,
        tuningId: TUNINGS[saved.tuningId] ? saved.tuningId : DEFAULT_STATE.tuningId,
        accidental: saved.accidental === "flat" ? "flat" : "sharp",
        labelMode: saved.labelMode === "degree" ? "degree" : "note",
        fretRange: (saved.fretRange && Number.isFinite(saved.fretRange.min) && Number.isFinite(saved.fretRange.max))
          ? { min: saved.fretRange.min, max: saved.fretRange.max }
          : { ...DEFAULT_STATE.fretRange },
      };
    }
  } catch {
    // 忽略
  }
  return { ...DEFAULT_STATE, fretRange: { ...DEFAULT_STATE.fretRange } };
}

const state = loadState();

/* ===================== 贝斯常用和弦类型 ===================== */
// 仅展示贝斯手最常用类型；其他延伸/变化属七等仍用 chord-engine 全部类型
const BASS_TYPE_GROUPS = [
  { key: "triad", cn: "三和弦" },
  { key: "fourth", cn: "七和弦" },
  { key: "extended", cn: "延伸" },
  { key: "altered", cn: "变化属七" },
  { key: "addsus", cn: "加音 / 挂留" },
];

const PREFERRED_TYPE_IDS = [
  "major", "minor", "dim", "aug",
  "maj7", "m7", "7", "m7b5", "dim7", "mMaj7",
  "9", "m9", "13",
  "7b9", "7#11", "7alt",
  "sus2", "sus4", "add9",
];

/* ===================== 元素引用 ===================== */
const elements = {
  tuningSelect: document.querySelector("#tuningSelect"),
  tuningDesc: document.querySelector("#tuningDesc"),
  accidentalSwitch: document.querySelector("#accidentalSwitch"),
  rootButtons: document.querySelector("#rootButtons"),
  typeGroups: document.querySelector("#typeGroups"),
  fretRangeMin: document.querySelector("#fretRangeMin"),
  fretRangeMax: document.querySelector("#fretRangeMax"),
  fretRangeMinInput: document.querySelector("#fretRangeMinInput"),
  fretRangeMaxInput: document.querySelector("#fretRangeMaxInput"),
  fretRangeFill: document.querySelector("#fretRangeFill"),
  labelSwitch: document.querySelector("#labelSwitch"),
  chordName: document.querySelector("#chordName"),
  chordSymbol: document.querySelector("#chordSymbol"),
  noteChips: document.querySelector("#noteChips"),
  degreeChips: document.querySelector("#degreeChips"),
  theoryDesc: document.querySelector("#theoryDesc"),
  chordFretboard: document.querySelector("#chordFretboard"),
  fretNumbers: document.querySelector("#fretNumbers"),
  arpPath: document.querySelector("#arpPath"),
};

function noteNameLocal(semi) {
  return noteName(semi, state.accidental);
}

/* ===================== 状态辅助 ===================== */
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function getChordType() {
  return CHORD_TYPE_MAP[state.typeId];
}

function getChordNotes() {
  const type = getChordType();
  const semis = chordSemitones(state.root, type); // [semi, ...]
  // 包装为 {semi, label}，方便后续渲染与琶音选位
  return semis.map((s, i) => ({ semi: s, label: (type.labels && type.labels[i]) || degreeLabelFor(i) }));
}

/* ===================== 指板 SVG 渲染 ===================== */
function chordFbLayout(stringCount, frets) {
  const leftPad = 56;
  const colW = 44;
  const rowH = 38;
  const openX = leftPad - 16;
  const pad = { t: 28, r: frets >= 22 ? 16 : 0, b: 18, l: leftPad };
  const rightEdge = leftPad + (frets - 0) * colW;
  const w = rightEdge + pad.r;
  const h = pad.t + stringCount * rowH + pad.b;
  // 最低音弦在顶（chord-engine 索引 0 = 最低音）
  const order = Array.from({ length: stringCount }, (_, k) => stringCount - 1 - k);
  return { leftPad, colW, rowH, pad, rightEdge, w, h, order, openX, stringCount };
}

function chordFretX(L, fret) {
  return fret <= 0 ? L.openX : L.leftPad + (fret - 1) * L.colW + L.colW / 2;
}

function chordStringWidth(si, thin, thick) {
  return +(thin + (si / 5) * (thick - thin)).toFixed(2);
}

const CHORD_DOT_COLORS = {
  root: "#ef6a4d",    // 暖橙
  3:    "#7aa2d4",    // 冷蓝
  5:    "#9bc494",    // 草绿
  7:    "#cba6e3",    // 紫
  extra:"#f0c674",    // 9/11/13 等延伸音
};

function dotColorForDegree(idx, total) {
  // 0=根 1=3 2=5 3=7 4+=延伸
  if (idx === 0) return CHORD_DOT_COLORS.root;
  if (idx === 1) return CHORD_DOT_COLORS[3];
  if (idx === 2) return CHORD_DOT_COLORS[5];
  if (idx === 3) return CHORD_DOT_COLORS[7];
  return CHORD_DOT_COLORS.extra;
}

function degreeLabelFor(idx) {
  if (idx === 0) return "1";
  if (idx === 1) return "3";
  if (idx === 2) return "5";
  if (idx === 3) return "7";
  return "9/11/13";
}

function buildChordFretboardSVG(notes, tuning, opts = {}) {
  const stringCount = tuning.pitches.length;
  const frets = opts.frets ?? state.fretRange.max;
  const startFret = Math.max(0, opts.startFret ?? state.fretRange.min);
  const endFret = Math.min(frets, opts.endFret ?? state.fretRange.max);
  const L = chordFbLayout(stringCount, frets);
  const { leftPad, colW, rowH, pad, rightEdge, w, h, order } = L;

  // 收集该和弦所有音高在指板上的位置
  const noteSet = new Set(notes.map((n) => n.semi));
  const positions = fretboardPositions(state.root, { intervals: notes.map((n) => mod12(n.semi - state.root)) }, tuning.pitches, { frets })
    .filter((p) => p.fret >= startFret && p.fret <= endFret)
    .filter((p) => noteSet.has(mod12(tuning.pitches[p.si] + p.fret)));

  // 给每个 position 找到它是和弦中第几个音（决定颜色 / 标签）
  const semiToIndex = new Map();
  notes.forEach((n, idx) => semiToIndex.set(n.semi, idx));
  const semiToLabel = new Map();
  notes.forEach((n, idx) => {
    semiToLabel.set(n.semi, degreeLabelFor(idx));
  });

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="和弦音在贝斯指板上的位置（${startFret}–${endFret} 品）" class="full-fretboard chord-fretboard">`
  );
  // 背景板
  parts.push(`<rect x="${leftPad - colW / 2}" y="${pad.t - 4}" width="${rightEdge - leftPad + colW / 2}" height="${rowH * stringCount + 8}" rx="10" fill="#2b2436" />`);
  // 弦枕（0品）粗线
  if (startFret === 0) {
    parts.push(`<rect x="${leftPad - 4}" y="${pad.t - 4}" width="6" height="${rowH * stringCount + 8}" fill="#d6c8b6" />`);
  } else {
    // 把位起始
    parts.push(`<text x="${leftPad - 8}" y="${pad.t + rowH * stringCount / 2 + 4}" text-anchor="end" font-family="Inter" font-size="13" fill="#d6c8b6">${startFret}品</text>`);
  }
  // 弦（从底到顶画线：order 是 [n-1..0] = 从顶到底）
  for (let k = 0; k < stringCount; k += 1) {
    const si = order[k];
    const y = pad.t + k * rowH + rowH / 2;
    const sw = chordStringWidth(si, 2.4, 5.6);
    parts.push(`<line x1="${leftPad - 30}" y1="${y}" x2="${rightEdge}" y2="${y}" stroke="#d6c8b6" stroke-width="${sw}" stroke-linecap="round" />`);
    // 弦名
    const openSemi = tuning.pitches[si];
    parts.push(`<text x="${leftPad - 36}" y="${y + 4}" text-anchor="end" font-family="Inter" font-size="13" font-weight="600" fill="#d6c8b6">${noteNameLocal(openSemi)}</text>`);
  }
  // 品丝
  for (let f = startFret; f <= endFret; f += 1) {
    const x = leftPad + (f - startFret) * colW;
    const isNut = startFret === 0 && f === 0;
    if (isNut) continue;
    parts.push(`<line x1="${x}" y1="${pad.t - 2}" x2="${x}" y2="${pad.t + rowH * stringCount + 2}" stroke="#5a4a64" stroke-width="${f === startFret ? 3 : 1.4}" />`);
  }
  // 品记
  const realFrets = [3, 5, 7, 9, 15, 17, 19, 21];
  const doubleFrets = [12, 24];
  realFrets.forEach((f) => {
    if (f < startFret || f > endFret) return;
    const x = leftPad + (f - startFret) * colW;
    const y = pad.t + (stringCount === 5 ? 2 : 1.5) * rowH - rowH * 0.0;
    // 中央位置：4 弦取 2/4 索引（即第 1.5 行），5 弦取 2.5 行
    const midRow = stringCount === 5 ? 2 : 1.5;
    const yc = pad.t + midRow * rowH;
    parts.push(`<circle cx="${x}" cy="${yc}" r="5" fill="#6f5d7c" />`);
  });
  doubleFrets.forEach((f) => {
    if (f < startFret || f > endFret) return;
    const x = leftPad + (f - startFret) * colW;
    const y1 = pad.t + rowH * 0.8;
    const y2 = pad.t + rowH * (stringCount - 0.8);
    parts.push(`<circle cx="${x}" cy="${y1}" r="5" fill="#6f5d7c" />`);
    parts.push(`<circle cx="${x}" cy="${y2}" r="5" fill="#6f5d7c" />`);
  });

  // 音点
  positions.forEach((p) => {
    const semi = mod12(tuning.pitches[p.si] + p.fret);
    const idx = semiToIndex.get(semi);
    if (idx === undefined) return;
    const k = order.indexOf(p.si);
    if (k < 0) return;
    const x = chordFretX(L, p.fret);
    const y = pad.t + k * rowH + rowH / 2;
    const fill = dotColorForDegree(idx, notes.length);
    const isRoot = idx === 0;
    const r = isRoot ? 13 : 10;
    const labelCenter = state.labelMode === "note" ? noteNameLocal(semi) : semiToLabel.get(semi) || "";
    parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="#1a1322" stroke-width="1.5" />`);
    parts.push(`<text x="${x}" y="${y + 4}" text-anchor="middle" font-family="Inter" font-size="${isRoot ? 12 : 10}" font-weight="700" fill="#1a1322">${labelCenter}</text>`);
  });

  parts.push(`</svg>`);
  return parts.join("");
}

/* ===================== 琶音路径推荐 ===================== */
function pickArpeggioPath(notes, tuning) {
  // 在所选品格范围内，按"最低根音"为起点，按半音序数升序找就近的 1-3-5-7 路径
  // 目标：每个和弦音至少 1 个位置，相邻音位置尽量在同一把位（避免大跳）
  const { min, max } = state.fretRange;
  const stringCount = tuning.pitches.length;
  const used = []; // [{si, fret, semi, idx}]

  // 起点：选最低根音位置（在范围内）。"最低" = 最粗弦（si 最小）且最低品
  const candidates = notes.map((n, idx) => ({ n, idx }));
  let startFret = null;
  let startSi = null;
  for (const { n, idx } of candidates) {
    if (idx !== 0) continue;
    const positions = positionsForSemi(tuning, n.semi, min, max);
    if (positions.length === 0) continue;
    // 按 [si asc, fret asc] 取第一
    const best = positions.slice().sort((a, b) => a.si - b.si || a.fret - b.fret)[0];
    startFret = best.fret;
    startSi = best.si;
    used.push({ si: best.si, fret: best.fret, semi: n.semi, idx });
    break;
  }
  if (startFret == null) {
    // 没找到根音
    return [];
  }
  let curFret = startFret;
  for (let i = 1; i < notes.length; i += 1) {
    const target = notes[i];
    const pos = positionsForSemi(tuning, target.semi, min, max);
    if (pos.length === 0) {
      used.push(null);
      continue;
    }
    // 优先选与 curFret 距离最近的（4 品内为佳）
    pos.sort((a, b) => {
      const da = Math.abs(a.fret - curFret) + (a.si !== startSi ? 1 : 0) * 0.2;
      const db = Math.abs(b.fret - curFret) + (b.si !== startSi ? 1 : 0) * 0.2;
      return da - db;
    });
    const pick = pos[0];
    used.push({ si: pick.si, fret: pick.fret, semi: target.semi, idx: i });
    curFret = pick.fret;
  }
  return used.filter(Boolean);
}

function positionsForSemi(tuning, semi, minFret, maxFret) {
  const out = [];
  for (let si = 0; si < tuning.pitches.length; si += 1) {
    for (let f = minFret; f <= maxFret; f += 1) {
      if (mod12(tuning.pitches[si] + f) === mod12(semi)) {
        out.push({ si, fret: f });
      }
    }
  }
  return out;
}

function stringName(si, tuning) {
  // 显示成 1弦/2弦... 1弦 = 索引 stringCount-1（最细）
  const pos = tuning.pitches.length - si;
  const labels = ["一", "二", "三", "四", "五", "六"];
  return `${labels[pos - 1] || pos}弦`;
}

function renderArpPath(used, tuning, notes) {
  if (!used.length) {
    elements.arpPath.innerHTML = `<p class="arp-empty">当前指板范围内没有此和弦的根音，请把范围扩大或换调。</p>`;
    return;
  }
  const list = used.map((p, i) => {
    if (!p) {
      return `<li class="arp-step arp-miss"><span class="arp-idx">${i + 1}</span><span class="arp-name">—</span><span class="arp-loc">范围内未找到</span></li>`;
    }
    const color = dotColorForDegree(p.idx, notes.length);
    const note = noteNameLocal(p.semi);
    return `<li class="arp-step">
      <span class="arp-idx" style="background:${color}">${i + 1}</span>
      <span class="arp-name">${note}</span>
      <span class="arp-loc">${stringName(p.si, tuning)}${p.fret}品</span>
    </li>`;
  }).join('<li class="arp-arrow" aria-hidden="true">→</li>');
  elements.arpPath.innerHTML = `<ol class="arp-list">${list}</ol>`;
}

/* ===================== 渲染 ===================== */
function renderFretNumbers() {
  const { min, max } = state.fretRange;
  elements.fretRangeMin.textContent = String(min);
  elements.fretRangeMax.textContent = String(max);
  elements.fretRangeMinInput.value = String(min);
  elements.fretRangeMaxInput.value = String(max);
  const totalFret = 22;
  const minPct = (min / totalFret) * 100;
  const maxPct = (max / totalFret) * 100;
  elements.fretRangeFill.style.left = `${minPct}%`;
  elements.fretRangeFill.style.width = `${maxPct - minPct}%`;

  // 指板品数数字行
  const numbers = [];
  for (let f = min; f <= max; f += 1) {
    numbers.push(`<span class="fret-num">${f}</span>`);
  }
  elements.fretNumbers.innerHTML = numbers.join("");
}

function renderRootButtons() {
  const arr = Array.from({ length: 12 }, (_, i) => i);
  elements.rootButtons.innerHTML = arr.map((i) => {
    const n = noteName(i, state.accidental);
    const active = i === state.root;
    return `<button type="button" class="root-btn ${active ? "active" : ""}" data-root="${i}" aria-pressed="${active}">${n}</button>`;
  }).join("");
}

function renderTypeGroups() {
  const html = BASS_TYPE_GROUPS.map((g) => {
    const types = CHORD_TYPES.filter((t) => t.group === g.key && (PREFERRED_TYPE_IDS.includes(t.id) || true));
    const buttons = types.map((t) => {
      const active = t.id === state.typeId;
      const sym = t.suffix ? `${t.suffix}` : "maj";
      return `<button type="button" class="type-btn ${active ? "active" : ""}" data-type="${t.id}" aria-pressed="${active}" title="${t.cn}">${t.cn}<small>${sym}</small></button>`;
    }).join("");
    return `<div class="type-group"><div class="type-group-label">${g.cn}</div><div class="type-buttons">${buttons}</div></div>`;
  }).join("");
  elements.typeGroups.innerHTML = html;
}

function renderChordCard(notes) {
  const type = getChordType();
  const rootName = noteName(state.root, state.accidental);
  elements.chordName.textContent = `${rootName} ${type.cn}`;
  elements.chordSymbol.textContent = chordSymbol(state.root, type, state.accidental);
  elements.noteChips.innerHTML = notes.map((n) => `<span class="tone-chip">${noteName(n.semi, state.accidental)}</span>`).join("");
  elements.degreeChips.innerHTML = notes.map((n, i) => `<span class="interval-chip" data-idx="${i}">${degreeLabelFor(i)}</span>`).join("");
  elements.theoryDesc.textContent = type.desc;
}

function renderFretboard(notes, tuning) {
  elements.chordFretboard.innerHTML = buildChordFretboardSVG(notes, tuning);
  renderFretNumbers();
}

function renderAll() {
  const notes = getChordNotes();
  const tuning = TUNINGS[state.tuningId];
  elements.tuningSelect.value = state.tuningId;
  elements.tuningDesc.textContent = tuning.desc;
  renderChordCard(notes);
  renderFretboard(notes, tuning);
  renderArpPath(pickArpeggioPath(notes, tuning), tuning, notes);
  saveState();
}

/* ===================== 事件 ===================== */
elements.tuningSelect.addEventListener("change", (e) => {
  state.tuningId = e.target.value;
  renderAll();
});

elements.rootButtons.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-root]");
  if (!btn) return;
  state.root = Number(btn.dataset.root);
  renderRootButtons();
  renderAll();
});

elements.typeGroups.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-type]");
  if (!btn) return;
  state.typeId = btn.dataset.type;
  renderTypeGroups();
  renderAll();
});

elements.accidentalSwitch.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-acc]");
  if (!btn) return;
  state.accidental = btn.dataset.acc;
  elements.accidentalSwitch.querySelectorAll("button").forEach((b) => {
    const on = b === btn;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  renderAll();
});

elements.labelSwitch.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-label]");
  if (!btn) return;
  state.labelMode = btn.dataset.label;
  elements.labelSwitch.querySelectorAll("button").forEach((b) => {
    const on = b === btn;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  renderAll();
});

function setFretRange(min, max) {
  min = Math.max(0, Math.min(22, Math.round(min)));
  max = Math.max(1, Math.min(22, Math.round(max)));
  if (min > max) [min, max] = [max, min];
  if (min === state.fretRange.min && max === state.fretRange.max) return;
  state.fretRange = { min, max };
  renderAll();
}

elements.fretRangeMinInput.addEventListener("input", (e) => {
  let min = Number(elements.fretRangeMinInput.value);
  let max = Number(elements.fretRangeMaxInput.value);
  if (e.target === elements.fretRangeMinInput && min > max) max = min;
  if (e.target === elements.fretRangeMaxInput && max < min) min = max;
  setFretRange(min, max);
});
elements.fretRangeMaxInput.addEventListener("input", (e) => {
  let min = Number(elements.fretRangeMinInput.value);
  let max = Number(elements.fretRangeMaxInput.value);
  if (e.target === elements.fretRangeMinInput && min > max) max = min;
  if (e.target === elements.fretRangeMaxInput && max < min) min = max;
  setFretRange(min, max);
});
[elements.fretRangeMinInput, elements.fretRangeMaxInput].forEach((input) => {
  input.addEventListener("change", () => {
    const min = Number(elements.fretRangeMinInput.value);
    const max = Number(elements.fretRangeMaxInput.value);
    setFretRange(min, max);
  });
});

/* ===================== 初始化 ===================== */
try {
  renderRootButtons();
  renderTypeGroups();
  renderAll();
} catch (e) {
  // 任何初始化错误都暴露到控制台，便于排查
  console.error("[chord-app] init failed:", e && e.message, e && e.stack);
  throw e;
}
