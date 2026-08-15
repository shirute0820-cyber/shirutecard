import { GameState } from "../engine/GameState.js";
import { KEYWORDS, CONFIG, CARD_TYPES } from "../engine/constants.js";
import { CARD_DEFS } from "../engine/cardDefinitions.js";
import { flushUiEvents } from "./fx.js";
import { setupRulesModal } from "./rules.js";

setupRulesModal();

// ==========================================================
// ログ
// ==========================================================
// game.logEntries(p1・p2どちらの行動も含む全履歴)を丸ごと読み取って
// パネルを再構築する。新しいログが常に上に来るよう、最新のものから順に描画する。
// カード名(『...』で囲まれた部分)は少し太字で強調する。
const logEl = document.getElementById("log-content");
function escapeHtmlLog(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function formatLogMessage(msg) {
  return escapeHtmlLog(msg).replace(/『([^『』]+)』/g, "『<strong>$1</strong>』");
}
function pushLog() {
  // GameStateのthis.log()から毎回呼ばれるが、実際の描画はrenderLog()が
  // game.logEntriesから毎回丸ごと再構築するため、ここでは何もしない。
}
function renderLog() {
  if (!logEl) return;
  const entries = game?.logEntries ?? [];
  logEl.innerHTML = entries
    .slice()
    .reverse()
    .map((e) => `<div>${formatLogMessage(e.msg)}</div>`)
    .join("");
}

// ==========================================================
// テスト用デッキ(スプレッドシートの全カードを最低1枚ずつ、
// コピー可能なものは3枚まで積んだ簡易デッキ)
// ==========================================================
function buildSampleDeck() {
  const list = [];
  for (const [name, def] of Object.entries(CARD_DEFS)) {
    const copies = def.copyLimit ?? CONFIG.DEFAULT_COPY_LIMIT;
    for (let i = 0; i < Math.min(copies, 2); i++) list.push(name);
  }
  return list;
}

const game = new GameState({
  player1Deck: buildSampleDeck(),
  player2Deck: buildSampleDeck(),
  firstPlayerId: "p1",
  log: pushLog,
});
game.startGame();

// ==========================================================
// UI状態
// ==========================================================
let selectedHandCard = null; // { playerId, uid, defName, type, releaseRequirement } | null
let selectedAttacker = null; // instance
let draggedHandCard = null; // ドラッグ中の手札(クリック選択とは独立に管理): { playerId, uid, defName, type, releaseRequirement } | null
let keepSelection = null; // 次ターン開始時「残す1枚」選択中: { playerId, nonHold: [...], chosenUid: null } | null
let mulliganReturn = { p1: new Set(), p2: new Set() }; // ゲーム開始時マリガンで「デッキに戻す」に選んだ手札uid

// カード効果に渡すパラメータを組み立てる。対象が2件以上あるときは
// クリックで選べるモーダルを表示する(window.promptはブラウザ環境によって
// 動かないことがあるため使用しない)。
//
// キャンセル(モーダルの「キャンセル」を押す)は、実際に選択を求めた場合のみ
// 検知できる。CANCELLEDを返すことで、呼び出し側(PARAM_BUILDERS)が
// カード発動そのものを中断できるようにする。
export const CANCELLED = Symbol("cancelled");

// 選択肢の要素からカード名(defName)を推測する(効果テキスト表示用)。
// pickCardName(文字列そのもの)・pickMonster/pickHandCard(.defNameを持つ)・
// デスラトル等の{from,ref}型・異端審問官コーション等の{from,instance}型をカバーする。
function resolveDefNameForPicker(item) {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    if (item.defName) return item.defName;
    if (item.ref && item.ref.defName) return item.ref.defName;
    if (item.instance && item.instance.defName) return item.instance.defName;
  }
  return null;
}
function pickFromList(items, label, renderLabel, cancelLabel = "キャンセル") {
  return new Promise((resolve) => {
    const overlay = document.getElementById("picker-modal-overlay");
    const title = document.getElementById("picker-modal-title");
    const list = document.getElementById("picker-modal-list");
    const cancelBtn = document.getElementById("picker-modal-cancel");

    title.textContent = label;
    list.innerHTML = "";
    for (const item of items) {
      const btn = document.createElement("button");
      btn.className = "picker-item";
      const defName = resolveDefNameForPicker(item);
      const def = defName ? CARD_DEFS[defName] : null;
      const labelText = renderLabel(item);
      // 選択肢を選ぶ前に効果文を確認できるよう、名前の下に効果テキストを常時表示する
      // (ホバーが効かないタッチ操作でも見えるようにするため、hoverツールチップ方式は使わない)
      btn.innerHTML = def?.effect
        ? `<div class="picker-item-name">${escapeHtml(labelText)}</div><div class="picker-item-effect">${escapeHtml(def.effect)}</div>`
        : escapeHtml(labelText);
      btn.onclick = () => {
        overlay.style.display = "none";
        resolve(item);
      };
      list.appendChild(btn);
    }
    cancelBtn.textContent = cancelLabel;
    cancelBtn.onclick = () => {
      overlay.style.display = "none";
      resolve(CANCELLED);
    };
    overlay.style.display = "flex";
  });
}

// モンスターの実効攻撃力(オーラ等を反映した表示用の値)。所有者はownerIdから引く
function effAtk(m) {
  return game.getEffectiveAtk(game.players[m.ownerId], m);
}

export async function pickMonster(candidates, label) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  return pickFromList(candidates, label, (m) => `${m.defName} (${effAtk(m)}/${m.currentHp})`);
}

export async function pickHandCard(candidates, label) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  return pickFromList(candidates, label, (c) => c.defName);
}
// デッキ・ストレージ等、defName(文字列)の一覧から1枚を選ばせる用(滝の試練 等)。
// 同名カードは1つにまとめて表示する(どの物理的な1枚を選んでも結果は同じため)。
async function pickCardName(names, label) {
  const unique = [...new Set(names)];
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0];
  return pickFromList(unique, label, (n) => n);
}
// 場・手札から「亜竜種を合計2体」選ばせる用(デスラトル)。
async function pickSacrifices(player, max, label) {
  const boardPool = player.board.filter((m) => m && m.race === "亜竜").map((m) => ({ from: "board", ref: m, label: `[場] ${m.defName}` }));
  const handPool = player.hand.filter((c) => CARD_DEFS[c.defName]?.race === "亜竜").map((c) => ({ from: "hand", ref: c, label: `[手札] ${c.defName}` }));
  const pool = [...boardPool, ...handPool];
  const chosen = [];
  while (chosen.length < max && pool.length > 0) {
    const pick = await pickFromList(pool, `${label}(あと${max - chosen.length}体)`, (p) => p.label);
    if (pick === CANCELLED) return CANCELLED;
    chosen.push({ from: pick.from, ref: pick.ref });
    pool.splice(pool.indexOf(pick), 1);
  }
  return chosen;
}
// モンスターインスタンスをちょうどmax体選ばせる用(デスラトルの対象選択等)
async function pickMonstersUpTo(candidates, max, label) {
  const pool = [...candidates];
  const chosen = [];
  while (chosen.length < max && pool.length > 0) {
    const pick = await pickFromList(pool, `${label}(あと${max - chosen.length}体)`, (m) => `${m.defName} (${effAtk(m)}/${m.currentHp})`);
    if (pick === CANCELLED) return CANCELLED;
    chosen.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  }
  return chosen;
}
// 「〜できる」系の複数選択(最大max体)。1体ずつ選んでいき、いつでも
// 「これ以上選ばない」で打ち切れる(0体選択も可能=完全に任意)。
// (online-app.jsに存在しローカル版に無かったため2026/08/12に追加)
async function pickUpTo(names, max, label) {
  const pool = [...names];
  const chosen = [];
  while (chosen.length < max && pool.length > 0) {
    const cancelLabel = chosen.length > 0 ? `これ以上選ばない(${chosen.length}体で確定)` : "誰も選ばない";
    const pick = await pickFromList(pool, `${label}(あと${max - chosen.length}体まで選択可)`, (n) => n, cancelLabel);
    if (pick === CANCELLED) break;
    chosen.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  }
  return chosen;
}

// 毒を付与する対象(場のモンスター1体、またはプレイヤー)を選ばせる汎用ピッカー
// (2026/08/16トリッカーテーマ追加。毒滴・ポイズン・ラボ③で使用)。
// includeSelfPlayer: 自分自身も対象候補に含めるか(毒滴は含めない=相手のみ、
// ポイズン・ラボ③は含める=自分・相手どちらも選べる)。
// 戻り値: { kind:'monster', instance, owner } | { kind:'player', player } | CANCELLED | null(候補無し)
async function pickPoisonTarget(player, opponent, label, { includeSelfPlayer = false } = {}) {
  const pool = [];
  for (const m of player.board) if (m) pool.push({ kind: "monster", instance: m, owner: player, label: `[自分の場] ${m.defName}` });
  for (const m of opponent.board) if (m) pool.push({ kind: "monster", instance: m, owner: opponent, label: `[相手の場] ${m.defName}` });
  if (includeSelfPlayer) pool.push({ kind: "player", player, label: "自分自身" });
  pool.push({ kind: "player", player: opponent, label: "相手プレイヤー" });
  if (pool.length === 0) return null;
  const pick = pool.length === 1 ? pool[0] : await pickFromList(pool, label, (p) => p.label);
  return pick;
}

// PARAM_BUILDERSは、キャンセルされたらnullを返す(=カード発動自体を中断する合図)。
// それ以外は通常通りparamsオブジェクトを返す。すべて非同期(モーダル待ち)。
const PARAM_BUILDERS = {
  投石: async ({ opponent }) => {
    const t = await pickMonster(opponent.board.filter(Boolean), "対象の敵モンスター");
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
  レッドドラゴン: async ({ opponent }) => {
    // 詳しい説明文:「相手の場にいるモンスター1体を選び」= プレイヤーが選ぶ
    // (以前はPARAM_BUILDERSが未登録で、常に盤面の先頭のモンスターへ自動的にダメージが入っており、
    //  選択権がなかったバグを修正。online-app.jsと同内容をローカル版にも反映)
    const t = await pickMonster(opponent.board.filter(Boolean), "16ダメージを与える敵モンスター");
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
  ダリアバーミリオン・ドラゴン: async ({ opponent }) => {
    const t = await pickMonster(opponent.board.filter(Boolean), "24ダメージを与える敵モンスター");
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
  デルフィニウムアズール・ドラゴン: async ({ player }) => {
    const eligible = player.graveyard.filter((n) => CARD_DEFS[n]?.race === "亜竜");
    if (eligible.length <= 1) return {};
    const chosen = await pickCardName(eligible, "特殊召喚して蘇生する亜竜種");
    if (chosen === CANCELLED) return null;
    return { reviveTarget: chosen };
  },
  ドラゴンの眼光: async ({ opponent }) => {
    const t = await pickMonster(opponent.board.filter(Boolean), "破壊する敵モンスター");
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
  用意周到: async ({ player, selfUid }) => {
    const c = await pickHandCard(player.hand.filter((c) => c.uid !== selfUid), "保留を付与する手札");
    if (c === CANCELLED) return null;
    return { targetHandUid: c?.uid };
  },
  やり直し: async ({ player, selfUid }) => {
    // 2026/08改訂: 手札2枚をストレージに移してから2ドローする効果に変更。
    // 自分自身(やり直し本体)は候補から除外。残り手札が2枚以下なら選択の余地がないため自動(全部移す)。
    const pool = player.hand.filter((c) => c.uid !== selfUid);
    if (pool.length <= 2) return {};
    const remaining = [...pool];
    const chosen = [];
    for (let i = 0; i < 2; i++) {
      const pick = await pickHandCard(remaining, `ストレージに移す手札(あと${2 - i}枚)`);
      if (pick === CANCELLED || !pick) return null;
      chosen.push(pick.uid);
      remaining.splice(remaining.indexOf(pick), 1);
    }
    return { discardHandUids: chosen };
  },
  タイフーン: async ({ player, selfUid }) => {
    const pool = player.hand.filter(
      (c) => c.uid !== selfUid && (CARD_DEFS[c.defName]?.type === CARD_TYPES.EVENT || CARD_DEFS[c.defName]?.type === CARD_TYPES.PERSISTENT_EVENT)
    );
    if (pool.length === 0) {
      alert("墓地へ送れるイベントカードが手札にありません");
      return null;
    }
    const c = pool.length === 1 ? pool[0] : await pickHandCard(pool, "墓地へ送るイベントカード");
    if (c === CANCELLED) return null;
    return { discardHandUid: c.uid };
  },
  ドラゴンの血誓: async ({ player, selfUid }) => {
    const c = await pickHandCard(
      player.hand.filter((c) => c.uid !== selfUid && CARD_DEFS[c.defName]?.race === "ドラゴン"),
      "墓地へ送るドラゴン種の手札"
    );
    if (c === CANCELLED) return null;
    return { discardHandUid: c?.uid };
  },
  滝の試練: async ({ player, selfUid }) => {
    const discard = await pickHandCard(player.hand.filter((c) => c.uid !== selfUid), "捨てる手札");
    if (discard === CANCELLED) return null;
    if (!discard) return null;
    const deckDragons = player.deck.filter((n) => CARD_DEFS[n]?.race === "ドラゴン");
    const useDeck = deckDragons.length > 0;
    const pool = useDeck ? deckDragons : player.storage.filter((n) => CARD_DEFS[n]?.race === "ドラゴン");
    if (pool.length === 0) {
      alert("デッキ・ストレージにドラゴン種が見つかりません");
      return null;
    }
    const fetchName = await pickCardName(pool, `${useDeck ? "デッキ" : "ストレージ"}から手札に加えるドラゴン種`);
    if (fetchName === CANCELLED || !fetchName) return null;
    return { discardHandUid: discard.uid, fetchDefName: fetchName };
  },
  リバーススケイル: async ({ player }) => {
    const t = await pickMonster(
      player.board.filter((m) => m && (m.race === "ドラゴン" || m.race === "亜竜")),
      "攻撃力を上げる自分のモンスター"
    );
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
  デスラトル: async ({ player, opponent }) => {
    const sacrifices = await pickSacrifices(player, 2, "墓地へ送る亜竜種を選択");
    if (sacrifices === CANCELLED) return null;
    if (sacrifices.length !== 2) {
      alert("自分の場・手札に、墓地へ送れる亜竜種が合計2体必要です");
      return null;
    }
    const board = opponent.board.filter(Boolean);
    let targets;
    if (board.length <= 2) {
      targets = board;
    } else {
      targets = await pickMonstersUpTo(board, 2, "16ダメージを与える敵モンスター");
      if (targets === CANCELLED) return null;
    }
    return { sacrifices, targetMonsters: targets };
  },
  ドラゴンの招集: async ({ player }) => {
    // online-app.jsに存在しローカル版に無かった選択ロジックを追加(2026/08/12)
    const eligible = player.graveyard.filter((n) => CARD_DEFS[n]?.race === "亜竜");
    if (eligible.length <= 1) return {}; // 選択の余地がない(0または1体)ため自動判定
    const chosen = await pickUpTo(eligible, 2, "デッキに戻す亜竜種");
    return { returnTargets: chosen };
  },
  エンダーリコリス・ワイバーン: async ({ player }) => {
    const eligible = player.graveyard.filter((n) => CARD_DEFS[n]?.race === "亜竜");
    if (eligible.length <= 2) return {}; // 選択の余地がないため、自動で(最大2体)蘇生する
    const chosen = await pickUpTo(eligible, 2, "墓地から蘇生する亜竜種");
    return { reviveTargets: chosen };
  },

  // ---------- クレリックテーマ ----------
  大天使ミカエル: async ({ opponent }) => {
    const t = await pickMonster(opponent.board.filter(Boolean), "破壊する敵モンスター");
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
  火刑に処されし聖女: async ({ player, opponent }) => {
    const count = player.graveyard.filter((n) => n === "天啓の聖女ジャンヌ・ダルク").length;
    if (count < 1) return {}; // 墓地にジャンヌがいなければ、この効果は発動しない(対象選択も不要)
    const t = await pickMonster(opponent.board.filter(Boolean), "破壊する敵モンスター");
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
  聖女カトリーヌ: async ({ player }) => {
    // 「できる」= 任意効果。デッキ優先、無ければストレージから、コスト2以下の聖女種を選ぶ
    const filter = (n) => {
      const d = CARD_DEFS[n];
      return d && d.race?.includes("聖女") && (d.cost ?? 99) <= 2;
    };
    const deckPool = player.deck.filter(filter);
    const usingDeck = deckPool.length > 0;
    const pool = usingDeck ? deckPool : player.storage.filter(filter);
    if (pool.length === 0) return {}; // 対象候補が無ければ何もしない
    const chosen = await pickCardName(pool, `${usingDeck ? "デッキ" : "ストレージ"}から手札に加える聖女(コスト2以下)`);
    if (chosen === CANCELLED || !chosen) return {};
    return { fetchDefName: chosen, fromDeck: usingDeck };
  },
  異端審問官コーション: async ({ player, selfUid }) => {
    const boardSources = player.board
      .filter((m) => m && m.defName === "天啓の聖女ジャンヌ・ダルク")
      .map((inst) => ({ from: "board", instance: inst, label: `[場] ${inst.defName}` }));
    const handSources = player.hand
      .filter((c) => c.uid !== selfUid && c.defName === "天啓の聖女ジャンヌ・ダルク")
      .map((c) => ({ from: "hand", handUid: c.uid, label: `[手札] ${c.defName}` }));
    const pool = [...boardSources, ...handSources];
    if (pool.length === 0) {
      alert("自分の場・手札に『天啓の聖女ジャンヌ・ダルク』が必要です");
      return null;
    }
    const pick = pool.length === 1 ? pool[0] : await pickFromList(pool, "墓地へ送る『天啓の聖女ジャンヌ・ダルク』", (p) => p.label);
    if (pick === CANCELLED) return null;
    return {
      sacrificeSource:
        pick.from === "board" ? { from: "board", instance: pick.instance } : { from: "hand", handUid: pick.handUid },
    };
  },
  // 以前はPARAM_BUILDERSに未登録で、常にstorage[0]が自動選択されてしまい
  // プレイヤーが対象を選べないバグがあった(online-app.jsと同内容をローカル版にも反映)
  神の啓示: async ({ player }) => {
    if (player.storage.length === 0) return null; // 発動条件を満たさない
    const chosen = await pickCardName(player.storage, "デッキの一番上に置くカード(次の自ターン、コスト-3)");
    if (chosen === CANCELLED || !chosen) return null;
    return { fetchDefName: chosen };
  },

  // ---------- トリッカーテーマ(毒、2026/08/16追加) ----------
  解毒爆薬剤: async ({ player, opponent }) => {
    const pool = [...player.board.filter((m) => m && m.poison > 0), ...opponent.board.filter((m) => m && m.poison > 0)];
    if (pool.length === 0) {
      alert("毒が付与されているモンスターがいません");
      return null;
    }
    const t = await pickMonster(pool, "毒を解除するモンスター");
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
  毒滴: async ({ player, opponent }) => {
    const pick = await pickPoisonTarget(player, opponent, "毒8を付与する対象", { includeSelfPlayer: false });
    if (pick === CANCELLED || !pick) return null;
    if (pick.kind === "monster") return { target: { type: "monster", instance: pick.instance } };
    return { target: { type: "player" } };
  },
  ドクター・ベアトラップ: async ({ opponent }) => {
    const slots = [0, 1, 2, 3];
    const chosen = [];
    for (let i = 0; i < 2; i++) {
      const pool = slots.filter((s) => !chosen.includes(s));
      const pick = await pickFromList(
        pool,
        `毒化する相手の場(あと${2 - i}箇所)`,
        (s) => (opponent.board[s] ? `${s}番枠(${opponent.board[s].defName})` : `${s}番枠(空き)`)
      );
      if (pick === CANCELLED) return null;
      chosen.push(pick);
    }
    return { poisonSlots: chosen };
  },
};

// 超越の追加効果で対象選択が必要なカード。効果文に「ランダム」と書かれていない
// 限り、原則プレイヤーが選ぶ(福音受けし者・老練の竜使い)。
// こちらもキャンセルでnullを返し、超越そのものを中断する。
const TRANSCEND_PARAM_BUILDERS = {
  福音受けし者: async ({ opponent }) => {
    const t = await pickMonster(opponent.board.filter(Boolean), "《超越》で破壊する敵モンスター");
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
  老練の竜使い: async ({ player }) => {
    const t = await pickMonster(
      player.board.filter((m) => m && (m.race === "ドラゴン" || m.race === "亜竜")),
      "《超越》で貫通を付与する自分のドラゴン・亜竜種"
    );
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
};

// 「1ターンに1度発動可能」等の起動効果(onActivate)用の対象選択ビルダー
const ACTIVATE_PARAM_BUILDERS = {
  オルレアホワイト・ドラゴン: async ({ player }) => {
    const c = await pickHandCard(
      player.hand.filter((c) => CARD_DEFS[c.defName]?.race === "ドラゴン"),
      "除外するドラゴン種の手札"
    );
    if (c === CANCELLED) return null;
    if (!c) {
      alert("除外できるドラゴン種の手札がありません");
      return null;
    }
    return { exileHandUid: c.uid };
  },
  ドクター・トキシン: async ({ player, opponent }) => {
    const pool = [...player.board.filter(Boolean), ...opponent.board.filter(Boolean)];
    if (pool.length === 0) {
      alert("場にモンスターがいません");
      return null;
    }
    const t = await pickMonster(pool, "毒8を付与するモンスター");
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
};

// 持続イベント(イベントゾーン設置カード)自身が持つ起動効果(onZoneActivate)用の
// 対象選択ビルダー(2026/08/16トリッカーテーマ追加。ポイズン・ラボ③用)
const ZONE_ACTIVATE_PARAM_BUILDERS = {
  ポイズン・ラボ: async ({ player, opponent }) => {
    const sacPool = player.board.filter((m) => m && m.race === "毒性生物");
    if (sacPool.length === 0) {
      alert("自分の場に「毒性生物」がいません");
      return null;
    }
    const sac = await pickMonster(sacPool, "墓地へ送る「毒性生物」");
    if (sac === CANCELLED) return null;
    const pick = await pickPoisonTarget(player, opponent, "毒4を付与する対象", { includeSelfPlayer: true });
    if (pick === CANCELLED || !pick) return null;
    const target =
      pick.kind === "monster"
        ? { type: "monster", instance: pick.instance, owner: pick.owner }
        : { type: "player", player: pick.player };
    return { sacrificeMonster: sac, target };
  },
};

// ==========================================================
// 手札からの召喚・イベント発動の共通処理
// (クリック操作・ドラッグ&ドロップ操作の両方から呼び出す)
// ==========================================================

// handCard: { playerId, uid, defName, type, releaseRequirement }
// slot: モンスターを置く盤面枠(リリース召喚の場合は、リリース対象がいる枠を指定する)
async function trySummonToSlot(playerId, handCard, slot) {
  const player = game.players[playerId];
  const opponent = game.players[game.opponentOf(playerId)];
  const builder = PARAM_BUILDERS[handCard.defName];
  const params = builder ? await builder({ player, opponent, selfUid: handCard.uid }) : {};
  if (params === null) {
    // 対象選択をキャンセルした場合は、召喚自体を中断する
    selectedHandCard = null;
    draggedHandCard = null;
    render();
    return;
  }
  try {
    game.summonFromHand(playerId, handCard.uid, slot, params);
  } catch (err) {
    alert(err.message);
  }
  selectedHandCard = null;
  draggedHandCard = null;
  render();
}

async function tryPlayEvent(playerId, handCard) {
  const player = game.players[playerId];
  const opponent = game.players[game.opponentOf(playerId)];
  const builder = PARAM_BUILDERS[handCard.defName];
  const params = builder ? await builder({ player, opponent, selfUid: handCard.uid }) : {};
  if (params === null) {
    selectedHandCard = null;
    draggedHandCard = null;
    render();
    return;
  }
  try {
    game.playEvent(playerId, handCard.uid, params);
  } catch (err) {
    alert(err.message);
  }
  selectedHandCard = null;
  draggedHandCard = null;
  render();
}

// ==========================================================
// レンダリング
// ==========================================================
function keywordSet(instance) {
  return new Set([...instance.baseKeywords, ...instance.grantedKeywords]);
}

// カード効果のホバーツールチップ・コスト強調表示用のヘルパー
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function cardEffectTooltipHtml(defName) {
  const def = CARD_DEFS[defName];
  if (!def?.effect) return "";
  return `<div class="card-effect-tooltip">${escapeHtml(def.effect)}</div>`;
}
// カードの「種類」(race。光/闇/亜竜/ドラゴン/聖女/騎士等)を表示する行。
// イベント系カードにはraceが無いため、その場合は何も表示しない。
// (2026/08/14追加: 種類が確認できる場面が少ないというフィードバックを受け、
//  盤面のモンスター表示で既に使っていた.race-lineのスタイルを他の表示箇所にも共通で使う)
function raceLineHtml(defName) {
  const def = CARD_DEFS[defName];
  if (!def?.race) return "";
  return `<div class="race-line">${escapeHtml(def.race)}</div>`;
}
// カードの「種類・タイプ・ステータス」をまとめた1行(ゾーン確認モーダル等、簡潔な表示が必要な場面用)
function cardTypeSummary(defName) {
  const def = CARD_DEFS[defName];
  if (!def) return "";
  const parts = [];
  if (def.race) parts.push(def.race);
  parts.push(def.type ?? "");
  if (def.type === CARD_TYPES.MONSTER) parts.push(`${def.atk}/${def.hp}`);
  if (def.cost != null) parts.push(`コスト${def.cost}`);
  return parts.filter(Boolean).join(" ・ ");
}
function costHtml(cost, originalCost) {
  // originalCostが渡され、costより高い場合は神の啓示等によるコスト減少を可視化する
  if (originalCost != null && cost != null && originalCost > cost) {
    return `<span class="cost-num cost-reduced"><s>${originalCost}</s> ${cost}</span>`;
  }
  return `<span class="cost-num">${cost ?? "?"}</span>`;
}

// カードの枠色クラス判定(イベント/1〜3コスト/4〜7コスト/8,9コスト)
function isEventType(type) {
  return type === CARD_TYPES.EVENT || type === CARD_TYPES.PERSISTENT_EVENT;
}
function cardTierClass(def) {
  if (!def) return "";
  if (isEventType(def.type)) return "event";
  const cost = def.cost;
  if (cost == null) return "";
  if (cost <= 3) return "tier-low";
  if (cost <= 7) return "tier-mid";
  return "tier-high";
}

function renderMonsterCard(playerId, instance, slot) {
  const el = document.createElement("div");
  el.className = "card " + cardTierClass(CARD_DEFS[instance.defName]);
  el.dataset.slot = String(slot);
  const kws = [...keywordSet(instance)];
  const sick = instance.summonedOnTurn === game.turnNumber && !kws.includes(KEYWORDS.SOKKOU) && !kws.includes(KEYWORDS.TOTSUGEKI);
  if (sick) el.classList.add("sick");
  if (selectedAttacker === instance) el.classList.add("selected");

  el.innerHTML = `
    <div class="race-line">${instance.race ?? ""}</div>
    <div class="name monster-name">${instance.defName}</div>
    <div class="stat-line">${effAtk(instance)} / ${instance.currentHp}</div>
    ${instance.poison > 0 ? `<div class="stat-line poison-line">毒${instance.poison}</div>` : ""}
    <div class="keywords">${kws.join(" ")}</div>
    ${cardEffectTooltipHtml(instance.defName)}
  `;

  // リリース召喚の対象候補(自分のターン中、選択中の手札のリリース条件に一致する場合)。
  // クリック選択・ドラッグ&ドロップのどちらでも、この枠へ向けて召喚できるようにする。
  const isReleaseCandidate =
    playerId === game.activePlayerId &&
    !game.winner &&
    instance.defName === (selectedHandCard?.releaseRequirement ?? draggedHandCard?.releaseRequirement) &&
    playerId === (selectedHandCard?.playerId ?? draggedHandCard?.playerId ?? playerId);

  if (playerId === game.activePlayerId && !game.winner && selectedHandCard?.releaseRequirement === instance.defName) {
    el.classList.add("release-target");
    el.onclick = (e) => {
      e.stopPropagation();
      const handCard = selectedHandCard;
      trySummonToSlot(playerId, handCard, slot);
    };
  } else if (playerId === game.activePlayerId && !game.winner) {
    if (game.canActivateAbility(playerId, instance)) {
      const abilityBtn = document.createElement("button");
      abilityBtn.className = "tr-btn";
      abilityBtn.textContent = "起動効果を使う";
      abilityBtn.onclick = async (e) => {
        e.stopPropagation();
        const player = game.players[playerId];
        const opponent = game.players[game.opponentOf(playerId)];
        const builder = ACTIVATE_PARAM_BUILDERS[instance.defName];
        const params = builder ? await builder({ player, opponent }) : {};
        if (params === null) {
          render();
          return;
        }
        try {
          game.activateAbility(playerId, instance, params);
        } catch (err) {
          alert(err.message);
        }
        render();
      };
      el.appendChild(abilityBtn);
    }
    const trStatus = game.transcendStatus(playerId, instance);
    if (trStatus.available) {
      const btn = document.createElement("button");
      btn.className = "tr-btn";
      btn.textContent = "超越(使用可能)";
      btn.onclick = async (e) => {
        e.stopPropagation();
        const player = game.players[playerId];
        const opponent = game.players[game.opponentOf(playerId)];
        const builder = TRANSCEND_PARAM_BUILDERS[instance.defName];
        const params = builder ? await builder({ player, opponent }) : {};
        if (params === null) return; // 対象選択をキャンセル → 超越自体を中断
        try {
          game.useTranscend(playerId, instance, params);
        } catch (err) {
          alert(err.message);
        }
        render();
      };
      el.appendChild(btn);
    }
    // 超越がまだ使えない状態の残りターン数は、左列の常設「超越」ボックスに
    // プレイヤー単位で表示済みのため、モンスターごとには表示しない
    el.onclick = () => {
      selectedAttacker = selectedAttacker === instance ? null : instance;
      render();
    };
  } else if (!game.winner) {
    // 相手モンスター: 攻撃対象として選択中なら攻撃実行
    el.onclick = () => {
      if (!selectedAttacker) return;
      try {
        game.attack(game.activePlayerId, selectedAttacker, { type: "monster", instance });
      } catch (err) {
        alert(err.message);
      }
      selectedAttacker = null;
      render();
    };
  }

  // ドラッグ&ドロップ: このモンスターがリリース召喚の対象になり得る場合、
  // ここへ手札のカードをドロップして召喚できるようにする
  if (isReleaseCandidate) {
    el.ondragover = (e) => {
      e.preventDefault();
      el.classList.add("drag-target");
    };
    el.ondragleave = () => el.classList.remove("drag-target");
    el.ondrop = (e) => {
      e.preventDefault();
      el.classList.remove("drag-target");
      if (draggedHandCard && draggedHandCard.releaseRequirement === instance.defName && draggedHandCard.playerId === playerId) {
        trySummonToSlot(playerId, draggedHandCard, slot);
      }
    };
  }

  return el;
}

function renderEmptySlot() {
  const el = document.createElement("div");
  el.className = "card empty-slot";
  el.textContent = "空き";
  return el;
}

function renderBoard(playerId) {
  const container = document.getElementById(`board-${playerId}`);
  container.innerHTML = "";
  const player = game.players[playerId];
  const clickSummonMode =
    playerId === game.activePlayerId &&
    !game.winner &&
    selectedHandCard?.type === "モンスター" &&
    !selectedHandCard?.releaseRequirement;

  player.board.forEach((m, slot) => {
    if (m) {
      container.appendChild(renderMonsterCard(playerId, m, slot));
    } else {
      const el = renderEmptySlot();
      el.dataset.slot = String(slot);
      if (clickSummonMode) {
        el.classList.remove("empty-slot");
        el.textContent = "ここに召喚";
        el.onclick = () => trySummonToSlot(playerId, selectedHandCard, slot);
      }
      // ドラッグ&ドロップ: 通常召喚(リリース不要)の手札を、この空き枠へドロップできる
      const isActiveOwnEmptySlot = playerId === game.activePlayerId && !game.winner;
      if (isActiveOwnEmptySlot) {
        el.ondragover = (e) => {
          if (draggedHandCard && draggedHandCard.type === "モンスター" && !draggedHandCard.releaseRequirement && draggedHandCard.playerId === playerId) {
            e.preventDefault();
            el.classList.add("drag-target");
          }
        };
        el.ondragleave = () => el.classList.remove("drag-target");
        el.ondrop = (e) => {
          e.preventDefault();
          el.classList.remove("drag-target");
          if (draggedHandCard && draggedHandCard.type === "モンスター" && !draggedHandCard.releaseRequirement && draggedHandCard.playerId === playerId) {
            trySummonToSlot(playerId, draggedHandCard, slot);
          }
        };
      }
      container.appendChild(el);
    }
  });

  // イベントゾーン: 持続イベントがあればカード表示、無ければ通常のラベル表示。
  // ドラッグ&ドロップでイベントカード(通常・持続とも)を発動できるようにする
  const eventZoneEl = document.getElementById(`event-zone-${playerId}`);
  if (eventZoneEl) {
    const zoneDefName = player.eventZone;
    if (zoneDefName) {
      const zoneDef = CARD_DEFS[zoneDefName];
      eventZoneEl.innerHTML = `
        <div class="zone-label">イベント<br />ゾーン</div>
        <div class="card event-zone-card">
          <div class="name"><strong>${escapeHtml(zoneDefName)}</strong></div>
          <div class="stat-line">コスト${costHtml(zoneDef?.cost)} 持続</div>
          ${cardEffectTooltipHtml(zoneDefName)}
        </div>
      `;
      eventZoneEl.classList.add("occupied");
      // 持続イベント自身が持つ起動効果(ポイズン・ラボ③等。2026/08/16追加)
      if (playerId === game.activePlayerId && !game.winner && game.canActivateZoneAbility(playerId)) {
        const cardEl = eventZoneEl.querySelector(".event-zone-card");
        const btn = document.createElement("button");
        btn.className = "tr-btn";
        btn.textContent = "起動効果を使う";
        btn.onclick = async (e) => {
          e.stopPropagation();
          const player = game.players[playerId];
          const opponent = game.players[game.opponentOf(playerId)];
          const builder = ZONE_ACTIVATE_PARAM_BUILDERS[zoneDefName];
          const params = builder ? await builder({ player, opponent }) : {};
          if (params === null) {
            render();
            return;
          }
          try {
            game.activateZoneAbility(playerId, params);
          } catch (err) {
            alert(err.message);
          }
          render();
        };
        cardEl.appendChild(btn);
      }
    } else {
      eventZoneEl.innerHTML = `<div class="zone-label">イベント<br />ゾーン</div>`;
      eventZoneEl.classList.remove("occupied");
    }
    const canDropEvent = playerId === game.activePlayerId && !game.winner;
    eventZoneEl.ondragover = (e) => {
      if (canDropEvent && draggedHandCard && isEventType(draggedHandCard.type) && draggedHandCard.playerId === playerId) {
        e.preventDefault();
        eventZoneEl.classList.add("drag-target");
      }
    };
    eventZoneEl.ondragleave = () => eventZoneEl.classList.remove("drag-target");
    eventZoneEl.ondrop = (e) => {
      e.preventDefault();
      eventZoneEl.classList.remove("drag-target");
      if (canDropEvent && draggedHandCard && isEventType(draggedHandCard.type) && draggedHandCard.playerId === playerId) {
        tryPlayEvent(playerId, draggedHandCard);
      }
    };
  }
}

function renderHand(playerId) {
  const container = document.getElementById(`hand-${playerId}`);
  container.innerHTML = "";
  const player = game.players[playerId];

  // ゲーム開始時のマリガン画面
  if (!game.gameStarted) {
    const done = game.mulliganDone[playerId];
    for (const c of player.hand) {
      const def = CARD_DEFS[c.defName];
      const el = document.createElement("div");
      el.className = "card " + cardTierClass(def);
      const marked = mulliganReturn[playerId].has(c.uid);
      if (marked) el.classList.add("selected");
      el.innerHTML = `${raceLineHtml(c.defName)}<div class="name">${c.defName}${marked ? "(戻す)" : ""}</div><div class="stat-line">コスト${costHtml(def?.cost)} ${def?.type ?? ""}</div>${def?.type === CARD_TYPES.MONSTER ? `<div class="stat-line">${def.atk}/${def.hp}</div>` : ""}${cardEffectTooltipHtml(c.defName)}`;
      if (!done) {
        el.onclick = () => {
          if (marked) mulliganReturn[playerId].delete(c.uid);
          else mulliganReturn[playerId].add(c.uid);
          render();
        };
      } else {
        el.style.opacity = "0.5";
      }
      container.appendChild(el);
    }
    return;
  }

  // 次のプレイヤーのターン開始時「残す1枚」選択モード中は、専用の選択UIに切り替える
  if (keepSelection && playerId === keepSelection.playerId) {
    for (const c of keepSelection.nonHold) {
      const def = CARD_DEFS[c.defName];
      const el = document.createElement("div");
      el.className = "card " + cardTierClass(def);
      const chosen = keepSelection.chosenUid === c.uid;
      if (chosen) el.classList.add("selected");
      el.innerHTML = `${raceLineHtml(c.defName)}<div class="name">${c.defName}</div><div class="stat-line">コスト${costHtml(def?.cost)} ${def?.type ?? ""}</div>${def?.type === CARD_TYPES.MONSTER ? `<div class="stat-line">${def.atk}/${def.hp}</div>` : ""}${cardEffectTooltipHtml(c.defName)}`;
      el.onclick = () => {
        keepSelection.chosenUid = chosen ? null : c.uid;
        render();
      };
      container.appendChild(el);
    }
    for (const c of player.hand.filter((h) => h.hold)) {
      const def = CARD_DEFS[c.defName];
      const el = document.createElement("div");
      el.className = "card";
      el.style.opacity = "0.6";
      el.innerHTML = `${raceLineHtml(c.defName)}<div class="name">${c.defName} (保留・自動で残る)</div><div class="stat-line">コスト${costHtml(def?.cost)} ${def?.type ?? ""}</div>${def?.type === CARD_TYPES.MONSTER ? `<div class="stat-line">${def.atk}/${def.hp}</div>` : ""}${cardEffectTooltipHtml(c.defName)}`;
      container.appendChild(el);
    }
    return;
  }

  for (const c of player.hand) {
    const def = CARD_DEFS[c.defName];
    // 神の啓示のcostReductionに加え、竜の里のような「イベントゾーンにいる間の動的な
    // コスト軽減」も表示に反映する(2026/08/15: 竜の里追加で発覚した表示漏れの修正。
    // 神の啓示のときと同じ「実際に払うコストと表示が食い違う」問題を再発させないための対応)
    const effectiveCost = def?.cost != null ? game.getEffectiveHandCost(player, c, def) : def?.cost;
    const el = document.createElement("div");
    el.className = "card " + cardTierClass(def);
    if (selectedHandCard?.uid === c.uid) el.classList.add("selected");
    el.innerHTML = `
      ${raceLineHtml(c.defName)}
      <div class="name">${c.defName}${c.hold ? " (保留)" : ""}</div>
      <div class="stat-line">コスト${costHtml(effectiveCost, def?.cost)} ${def?.type ?? ""}</div>
      ${def?.type === "モンスター" ? `<div class="stat-line">${def.atk}/${def.hp}</div>` : ""}
      ${cardEffectTooltipHtml(c.defName)}
    `;
    if (playerId === game.activePlayerId && !game.winner) {
      el.onclick = () => {
        if (isEventType(def?.type)) {
          tryPlayEvent(playerId, { playerId, uid: c.uid, defName: c.defName, type: def.type });
          return;
        }
        // モンスターカードは、通常召喚(空き枠を選ぶ)・リリース召喚(リリース対象の枠を選ぶ)
        // いずれも、まずはこのカードを「選択中」にするだけにする(誤操作防止のため、
        // クリック1回で即座に召喚してしまうことはない)
        selectedHandCard =
          selectedHandCard?.uid === c.uid
            ? null
            : { playerId, uid: c.uid, defName: c.defName, type: def?.type, releaseRequirement: def?.releaseRequirement ?? null };
        render();
      };
      // ドラッグ&ドロップ: 手札のカードを盤面(モンスター)・イベントゾーン(イベント)へ
      // ドラッグして発動できるようにする(マウス操作向け。タッチ操作には非対応)
      el.draggable = true;
      el.ondragstart = (e) => {
        draggedHandCard = { playerId, uid: c.uid, defName: c.defName, type: def?.type, releaseRequirement: def?.releaseRequirement ?? null };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", c.uid);
        render(); // ドロップ先のハイライト判定を反映させるため再描画
      };
      el.ondragend = () => {
        draggedHandCard = null;
        render();
      };
    }
    container.appendChild(el);
  }
}

const ZONE_LABELS = { deck: "デッキ", storage: "ストレージ", graveyard: "墓地", exile: "除外" };

// ==========================================================
// 演出・効果音: game.uiEvents を読み取る際に使う要素解決ヘルパー
// ==========================================================
function getMonsterSlotEl(ownerId, slot) {
  const container = document.getElementById(`board-${ownerId}`);
  if (!container) return null;
  return container.querySelector(`[data-slot="${slot}"]`);
}
function getPlayerStatsEl(playerId) {
  return document.getElementById(`stats-${playerId}`);
}

function openZoneModal(playerId, zoneKey) {
  const player = game.players[playerId];
  const cards = player[zoneKey] ?? [];
  const counts = new Map();
  for (const name of cards) counts.set(name, (counts.get(name) ?? 0) + 1);

  document.getElementById("zone-modal-title").textContent = `${playerId} の${ZONE_LABELS[zoneKey] ?? zoneKey}(${cards.length}枚)`;
  const contentEl = document.getElementById("zone-modal-content");
  contentEl.innerHTML = "";
  if (counts.size === 0) {
    contentEl.innerHTML = "<div>(空)</div>";
  } else {
    // 名前だけの一覧では種類・ステータス・効果が分からず選びにくいとのフィードバックを受け、
    // 手札等と同じ情報量(種類・タイプ・ステータス・効果文)を1枚ずつ表示する形に変更(2026/08/14)
    for (const [name, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const def = CARD_DEFS[name];
      const row = document.createElement("div");
      row.className = "zone-modal-card";
      row.innerHTML = `
        <div class="zone-modal-card-head">
          <span class="zone-modal-card-name">${escapeHtml(name)}${count > 1 ? ` ×${count}` : ""}</span>
        </div>
        <div class="zone-modal-card-meta">${escapeHtml(cardTypeSummary(name))}</div>
        ${def?.effect ? `<div class="zone-modal-card-effect">${escapeHtml(def.effect)}</div>` : ""}
      `;
      contentEl.appendChild(row);
    }
  }
  document.getElementById("zone-modal-overlay").style.display = "flex";
}

function closeZoneModal() {
  document.getElementById("zone-modal-overlay").style.display = "none";
}

function renderStats(playerId) {
  const player = game.players[playerId];

  // 常設のミニステータス(HP・コスト・後攻エクストラコスト)
  const el = document.getElementById(`stats-${playerId}`);
  el.innerHTML = `
    HP: <b>${player.hp}</b> ／
    コスト: <b>${player.resourceAvailable}/${player.resourceCap}</b>
    ${player.poison > 0 ? ` ／ 毒: <b class="poison-value">${player.poison}</b>` : ""}
    ${
      player.id === game.secondPlayerId
        ? `<button id="bonus-cost-btn" ${
            player.secondPlayerBonusCostRemaining <= 0 || player.secondPlayerBonusCostUsedThisTurn ? "disabled" : ""
          }>後攻エクストラコストを使う(残り${player.secondPlayerBonusCostRemaining}回${
            player.secondPlayerBonusCostUsedThisTurn ? "・このターンは使用済み" : ""
          })</button>`
        : ""
    }
  `;
  const bonusBtn = document.getElementById("bonus-cost-btn");
  if (bonusBtn) {
    bonusBtn.onclick = () => {
      try {
        game.useSecondPlayerBonusCost(playerId);
      } catch (err) {
        alert(err.message);
      }
      render();
    };
  }

  // 盤面まわりの常設ゾーン(シールド・超越・ストレージ・除外・墓地・デッキ)
  document.getElementById(`shield-value-${playerId}`).textContent = player.shield;

  const trStatus = game.playerTranscendAvailability(playerId);
  const trBox = document.getElementById(`transcend-box-${playerId}`);
  const trValue = document.getElementById(`transcend-value-${playerId}`);
  trBox.classList.toggle("available", trStatus.available);
  trValue.textContent = trStatus.available ? "使用可能" : `あと${trStatus.turnsLeft}ターン`;

  document.getElementById(`storage-count-${playerId}`).textContent = player.storage.length;
  document.getElementById(`exile-count-${playerId}`).textContent = (player.exile ?? []).length;
  document.getElementById(`graveyard-count-${playerId}`).textContent = player.graveyard.length;
  document.getElementById(`deck-count-${playerId}`).textContent = player.deck.length;

  document.getElementById(`storage-zone-${playerId}`).onclick = () => openZoneModal(playerId, "storage");
  document.getElementById(`exile-zone-${playerId}`).onclick = () => openZoneModal(playerId, "exile");
  document.getElementById(`graveyard-zone-${playerId}`).onclick = () => openZoneModal(playerId, "graveyard");
  document.getElementById(`deck-zone-${playerId}`).onclick = () => openZoneModal(playerId, "deck");
}

function render() {
  renderInner();
  renderLog();
  flushUiEvents(game, { getMonsterSlotEl, getPlayerStatsEl });
}

function renderInner() {
  if (!game.gameStarted) {
    document.getElementById("turn-info").textContent = "マリガンフェーズ(両者とも準備ができたら確定してください)";
    renderStats("p1");
    renderStats("p2");
    document.getElementById("board-p1").innerHTML = "";
    document.getElementById("board-p2").innerHTML = "";
    renderHand("p1");
    renderHand("p2");

    document.getElementById("btn-end-turn").style.display = "none";
    document.getElementById("btn-confirm-keep").style.display = "none";
    document.getElementById("btn-attack-face").style.display = "none";
    document.getElementById("btn-cancel-select").style.display = "none";

    const btnM1 = document.getElementById("btn-mulligan-p1");
    const btnM2 = document.getElementById("btn-mulligan-p2");
    btnM1.style.display = "";
    btnM2.style.display = "";
    btnM1.disabled = game.mulliganDone.p1;
    btnM2.disabled = game.mulliganDone.p2;
    btnM1.textContent = game.mulliganDone.p1 ? "P1: マリガン済み" : `P1: マリガン確定(戻す${mulliganReturn.p1.size}枚)`;
    btnM2.textContent = game.mulliganDone.p2 ? "P2: マリガン済み" : `P2: マリガン確定(戻す${mulliganReturn.p2.size}枚)`;
    document.getElementById("selection-info").textContent =
      "戻したいカードをクリックして選び、準備ができたら各プレイヤーの確定ボタンを押してください(0枚のままでもOK)";
    return;
  }

  document.getElementById("btn-mulligan-p1").style.display = "none";
  document.getElementById("btn-mulligan-p2").style.display = "none";
  document.getElementById("btn-attack-face").style.display = "";
  document.getElementById("btn-cancel-select").style.display = "";

  document.getElementById("turn-info").textContent =
    `ターン${game.turnNumber} / ${game.activePlayerId}のターン(フェイズ:${game.phase})`;

  renderStats("p1");
  renderStats("p2");

  if (game.winner) {
    // 勝敗が決まったら、盤面・手札は最終状態を表示するだけにして
    // クリック操作は一切受け付けないようにする(誤操作防止)
    renderBoard("p1");
    renderBoard("p2");
    renderHand("p1");
    renderHand("p2");
    document.getElementById("btn-attack-face").style.display = "none";
    document.getElementById("btn-cancel-select").style.display = "none";
    document.getElementById("btn-end-turn").style.display = "none";
    document.getElementById("btn-confirm-keep").style.display = "none";
    document.getElementById("selection-info").textContent = "";

    let banner = document.querySelector(".winner-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "winner-banner";
      document.body.prepend(banner);
    }
    banner.innerHTML = "";
    const text = document.createElement("span");
    text.textContent = `${game.winner} の勝利!`;
    banner.appendChild(text);
    const restartBtn = document.createElement("button");
    restartBtn.textContent = "新しい対戦を始める";
    restartBtn.style.marginLeft = "12px";
    restartBtn.onclick = () => location.reload();
    banner.appendChild(restartBtn);
    return;
  }

  renderBoard("p1");
  renderBoard("p2");
  renderHand("p1");
  renderHand("p2");

  document.getElementById("btn-attack-face").disabled = !selectedAttacker;
  document.getElementById("btn-end-turn").style.display = keepSelection ? "none" : "";
  document.getElementById("btn-confirm-keep").style.display = keepSelection ? "" : "none";
  document.getElementById("selection-info").textContent = keepSelection
    ? `${keepSelection.playerId}の次ターン手札:残す${CONFIG.HAND_KEEP_SIZE}枚まで選択中(クリックで選択/解除、未選択のまま確定すると「何も残さない」)`
    : selectedAttacker
    ? `選択中: ${selectedAttacker.defName}(攻撃対象は相手モンスターをクリック、またはプレイヤーへ直接攻撃ボタン)`
    : selectedHandCard
    ? `選択中の手札: ${selectedHandCard.defName}(${
        selectedHandCard.releaseRequirement
          ? `『${selectedHandCard.releaseRequirement}』がいる枠をクリックしてリリース召喚`
          : "空き枠をクリックして召喚"
      })`
    : "";
}

document.getElementById("btn-end-turn").onclick = () => {
  if (keepSelection) return; // 選択モード中はこのボタンでは何もしない(専用の確定ボタンを使う)
  selectedAttacker = null;
  selectedHandCard = null;

  const nextId = game.opponentOf(game.activePlayerId);
  try {
    game.endTurn();
  } catch (err) {
    alert(err.message);
    return;
  }
  const needed = game.peekKeepSelection(nextId);
  if (needed) {
    keepSelection = { playerId: nextId, nonHold: needed, chosenUid: null };
    render();
    return;
  }
  game.startTurn(nextId);
  render();
};

document.getElementById("btn-confirm-keep").onclick = () => {
  if (!keepSelection) return;
  // chosenUidがnullのままなら「何も残さない」という明示的な選択として扱う
  try {
    game.startTurn(keepSelection.playerId, keepSelection.chosenUid);
  } catch (err) {
    alert(err.message);
    return;
  }
  keepSelection = null;
  render();
};

document.getElementById("btn-attack-face").onclick = () => {
  if (!selectedAttacker) return;
  try {
    game.attack(game.activePlayerId, selectedAttacker, { type: "player" });
  } catch (err) {
    alert(err.message);
  }
  selectedAttacker = null;
  render();
};

document.getElementById("btn-cancel-select").onclick = () => {
  selectedAttacker = null;
  selectedHandCard = null;
  render();
};

document.getElementById("zone-modal-close").onclick = closeZoneModal;
document.getElementById("zone-modal-overlay").onclick = (e) => {
  if (e.target.id === "zone-modal-overlay") closeZoneModal();
};

document.getElementById("btn-mulligan-p1").onclick = () => {
  try {
    game.mulligan("p1", [...mulliganReturn.p1]);
  } catch (err) {
    alert(err.message);
    return;
  }
  mulliganReturn.p1 = new Set();
  render();
};

document.getElementById("btn-mulligan-p2").onclick = () => {
  try {
    game.mulligan("p2", [...mulliganReturn.p2]);
  } catch (err) {
    alert(err.message);
    return;
  }
  mulliganReturn.p2 = new Set();
  render();
};

render();
