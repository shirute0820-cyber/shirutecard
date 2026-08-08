// ==========================================================
// 演出・効果音まわり(共通モジュール)
// app.js / online-app.js の両方から使う。
//
// GameStateは「何が起きたか」(game.uiEvents)しか知らず、DOMやサウンドには
// 一切関与しない。render()の直後にflushUiEvents(game, ...)を呼ぶことで、
// このモジュールがイベントを読み取り、対応する演出・効果音を鳴らす。
// ==========================================================

// ---------------- サウンド(Web Audio APIで簡単な電子音を生成。
// 外部音声ファイル不要で、GitHub Pagesへの追加アセットも不要) ----------------
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  // ブラウザによっては最初のユーザー操作までsuspended状態のことがあるため、都度resumeを試みる
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

function tone({ freq, duration, type = "sine", volume = 0.15, delay = 0, freqEnd = null }) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  const startAt = ctx.currentTime + delay;
  osc.frequency.setValueAtTime(freq, startAt);
  if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), startAt + duration);
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(volume, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

// 短いノイズバースト(破壊音の「ガシャッ」という質感に使う)
function noiseBurst({ duration = 0.15, volume = 0.18, delay = 0, filterFreq = 900 }) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const startAt = ctx.currentTime + delay;
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(filterFreq, startAt);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, startAt);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start(startAt);
  noise.stop(startAt + duration + 0.02);
}

// カードが破壊される瞬間の、少し派手めな音(ノイズバースト+低く落ちる音)
export function playDestroySound() {
  noiseBurst({ duration: 0.18, volume: 0.2, filterFreq: 1400 });
  tone({ freq: 260, freqEnd: 60, duration: 0.35, type: "sawtooth", volume: 0.16, delay: 0.02 });
  tone({ freq: 140, freqEnd: 40, duration: 0.3, type: "square", volume: 0.1, delay: 0.05 });
}

// モンスターがダメージを受けたときの、控えめな短い音
export function playDamageSound() {
  tone({ freq: 340, freqEnd: 180, duration: 0.12, type: "triangle", volume: 0.12 });
}

// プレイヤーが直接ダメージを受けたときの音(モンスター被弾よりわずかに重く)
export function playPlayerDamageSound() {
  tone({ freq: 220, freqEnd: 100, duration: 0.18, type: "triangle", volume: 0.14 });
}

// 回復の、控えめな上昇音
export function playHealSound() {
  tone({ freq: 440, freqEnd: 660, duration: 0.18, type: "sine", volume: 0.12 });
}

// ドローの、ごく短いクリック音
export function playDrawSound() {
  tone({ freq: 700, duration: 0.05, type: "square", volume: 0.06 });
}

// 召喚の、控えめな「ポン」という音
export function playSummonSound() {
  tone({ freq: 300, freqEnd: 500, duration: 0.12, type: "sine", volume: 0.09 });
}

// ---------------- 演出(DOM操作) ----------------

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 指定した要素の位置に、短時間だけ浮かぶテキスト(ダメージ・回復数値など)を出す
export function spawnFloatText(el, text, className) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const div = document.createElement("div");
  div.className = `floating-fx ${className}`;
  div.textContent = text;
  div.style.left = `${rect.left + rect.width / 2}px`;
  div.style.top = `${rect.top + rect.height * 0.3}px`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 950);
}

// 指定した要素の位置に、少し派手めな「破壊」演出を一瞬重ねて表示する
export function spawnDestroyFx(el, defName) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const div = document.createElement("div");
  div.className = "destroy-fx";
  div.style.left = `${rect.left}px`;
  div.style.top = `${rect.top}px`;
  div.style.width = `${rect.width}px`;
  div.style.height = `${rect.height}px`;
  div.innerHTML = `<div class="destroy-fx-label">${escapeHtml(defName)} 破壊!</div>`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 650);
}

// 場に残っているモンスターが被弾したときの、一瞬の赤フラッシュ
export function flashHit(el) {
  if (!el) return;
  el.classList.remove("hit-flash");
  // 再度同じアニメーションを発火させるための強制リフロー
  void el.offsetWidth;
  el.classList.add("hit-flash");
  setTimeout(() => el.classList.remove("hit-flash"), 320);
}

// 召喚時の控えめなポップイン演出
export function popIn(el) {
  if (!el) return;
  el.classList.remove("summon-pop");
  void el.offsetWidth;
  el.classList.add("summon-pop");
  setTimeout(() => el.classList.remove("summon-pop"), 380);
}

// ==========================================================
// game.uiEvents を読み取り、対応する演出・効果音を発火してから空にする。
//
// resolvers: {
//   getMonsterSlotEl(ownerId, slot) => HTMLElement | null,
//     … その所有者・枠番号にあたる盤面上の要素(モンスターがいてもいなくても、
//        枠自体の要素を返すこと。破壊された直後は空き枠になっているため)
//   getPlayerStatsEl(playerId) => HTMLElement | null,
//     … そのプレイヤーのHP表示など、ダメージ・回復ポップアップの基準にする要素
// }
// ==========================================================
export function flushUiEvents(game, resolvers) {
  if (!game || !game.uiEvents || game.uiEvents.length === 0) return;
  const events = game.uiEvents;
  game.uiEvents = [];

  for (const evt of events) {
    switch (evt.type) {
      case "destroy": {
        const el = resolvers.getMonsterSlotEl?.(evt.ownerId, evt.slot);
        spawnDestroyFx(el, evt.defName);
        playDestroySound();
        break;
      }
      case "damageMonster": {
        const el = resolvers.getMonsterSlotEl?.(evt.ownerId, evt.slot);
        flashHit(el);
        spawnFloatText(el, `-${evt.amount}`, "dmg-text");
        playDamageSound();
        break;
      }
      case "damagePlayer": {
        const el = resolvers.getPlayerStatsEl?.(evt.playerId);
        spawnFloatText(el, `-${evt.amount}`, "dmg-text-big");
        playPlayerDamageSound();
        break;
      }
      case "healPlayer": {
        const el = resolvers.getPlayerStatsEl?.(evt.playerId);
        spawnFloatText(el, `+${evt.amount}`, "heal-text");
        playHealSound();
        break;
      }
      case "summon": {
        const el = resolvers.getMonsterSlotEl?.(evt.playerId, evt.slot);
        popIn(el);
        playSummonSound();
        break;
      }
      case "draw": {
        playDrawSound();
        break;
      }
      default:
        break;
    }
  }
}
