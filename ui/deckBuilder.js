import { CARD_DEFS } from "../engine/cardDefinitions.js";
import { CONFIG } from "../engine/constants.js";

export const DECK_SIZE = 40;
const DECKS_KEY = "cardgame-decks";
const OLD_SINGLE_DECK_KEY = "cardgame-deck-mydeck"; // 旧・単一デッキ版からの移行用

function generateId() {
  return `deck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readRawDecksData() {
  try {
    const raw = localStorage.getItem(DECKS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // 壊れたデータは無視して新規扱いにする
  }
  return null;
}

function writeDecksData(data) {
  localStorage.setItem(DECKS_KEY, JSON.stringify(data));
}

// 複数デッキ管理の導入前(単一デッキのみ保存していたバージョン)からの移行。
// 新形式のデータが無く、旧形式のデータが残っていれば1つだけデッキとして取り込む。
function migrateFromOldFormatIfNeeded() {
  const existing = readRawDecksData();
  if (existing) return existing;

  let migrated = { decks: {}, activeDeckId: null };
  try {
    const oldRaw = localStorage.getItem(OLD_SINGLE_DECK_KEY);
    if (oldRaw) {
      const counts = JSON.parse(oldRaw);
      const id = generateId();
      migrated = { decks: { [id]: { name: "マイデッキ1", counts } }, activeDeckId: id };
    }
  } catch {
    // 移行に失敗しても致命的ではないので無視する
  }
  writeDecksData(migrated);
  return migrated;
}

function loadDecksData() {
  return migrateFromOldFormatIfNeeded();
}

export function copyLimitOf(defName) {
  const def = CARD_DEFS[defName];
  return def?.copyLimit ?? CONFIG.DEFAULT_COPY_LIMIT;
}

// カード名 -> 採用枚数 のマップから、実際にデッキへ積む配列(名前を枚数分繰り返したもの)を作る
export function expandDeckCounts(counts) {
  const list = [];
  for (const [name, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) list.push(name);
  }
  return list;
}

export function totalCount(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

// デッキ内で使われている「汎用以外」のテーマ一覧を返す(赤・パラディン等)。
// 汎用カードはどのデッキにも組み込めるが、汎用以外のテーマは1デッキにつき1つまでしか
// 混在させられない(例: 赤テーマとパラディンテーマを同じデッキに入れることはできない)。
export function nonGenericThemesUsed(counts) {
  const themes = new Set();
  for (const name of Object.keys(counts)) {
    const def = CARD_DEFS[name];
    if (def && def.theme && def.theme !== "汎用") themes.add(def.theme);
  }
  return themes;
}

export function validateDeck(counts) {
  const errors = [];
  const total = totalCount(counts);
  if (total !== DECK_SIZE) {
    errors.push(`デッキ枚数は${DECK_SIZE}枚ちょうどにしてください(現在${total}枚)`);
  }
  for (const [name, n] of Object.entries(counts)) {
    if (!CARD_DEFS[name]) {
      errors.push(`未定義のカードです: ${name}`);
      continue;
    }
    const limit = copyLimitOf(name);
    if (n > limit) {
      errors.push(`『${name}』は最大${limit}枚までです(現在${n}枚)`);
    }
    if (n < 0) {
      errors.push(`『${name}』の枚数が不正です`);
    }
  }
  const nonGenericThemes = nonGenericThemesUsed(counts);
  if (nonGenericThemes.size > 1) {
    errors.push(`異なるテーマのカードは同じデッキに組み込めません(${[...nonGenericThemes].join("・")}が混在しています)`);
  }
  return errors;
}

function sanitizeCounts(counts) {
  const cleaned = {};
  for (const [name, n] of Object.entries(counts ?? {})) {
    if (!CARD_DEFS[name]) continue;
    const limit = copyLimitOf(name);
    const v = Math.max(0, Math.min(Number(n) || 0, limit));
    if (v > 0) cleaned[name] = v;
  }
  return cleaned;
}

// ---------------- 複数デッキ管理 ----------------

// 保存されている全デッキの一覧(id・名前・合計枚数・有効かどうか)を返す
export function listDecks() {
  const data = loadDecksData();
  return Object.entries(data.decks).map(([id, d]) => {
    const counts = sanitizeCounts(d.counts);
    return {
      id,
      name: d.name,
      total: totalCount(counts),
      valid: validateDeck(counts).length === 0,
    };
  });
}

export function getActiveDeckId() {
  return loadDecksData().activeDeckId;
}

export function setActiveDeckId(id) {
  const data = loadDecksData();
  if (!data.decks[id]) return;
  data.activeDeckId = id;
  writeDecksData(data);
}

// 指定したデッキの中身(id・名前・枚数マップ)を返す。存在しなければnull
export function getDeck(id) {
  const data = loadDecksData();
  const d = data.decks[id];
  if (!d) return null;
  return { id, name: d.name, counts: sanitizeCounts(d.counts) };
}

// アクティブなデッキを返す(未設定/削除済みならnull)
export function getActiveDeck() {
  const data = loadDecksData();
  if (!data.activeDeckId || !data.decks[data.activeDeckId]) return null;
  return getDeck(data.activeDeckId);
}

// 新しいデッキを作成してidを返す(最初のデッキなら自動的にアクティブになる)
export function createDeck(name) {
  const data = loadDecksData();
  const id = generateId();
  data.decks[id] = { name: name?.trim() || "新しいデッキ", counts: {} };
  if (!data.activeDeckId) data.activeDeckId = id;
  writeDecksData(data);
  return id;
}

export function renameDeck(id, newName) {
  const data = loadDecksData();
  if (!data.decks[id]) return;
  data.decks[id].name = newName?.trim() || data.decks[id].name;
  writeDecksData(data);
}

export function updateDeckCounts(id, counts) {
  const data = loadDecksData();
  if (!data.decks[id]) return;
  data.decks[id].counts = sanitizeCounts(counts);
  writeDecksData(data);
}

export function deleteDeck(id) {
  const data = loadDecksData();
  delete data.decks[id];
  if (data.activeDeckId === id) {
    const remaining = Object.keys(data.decks);
    data.activeDeckId = remaining.length > 0 ? remaining[0] : null;
  }
  writeDecksData(data);
}

// カードをコスト順→名前順で並べた、デッキ構築画面用の一覧(デッキに入れられないカードは除外)
export function listBuildableCards() {
  return Object.values(CARD_DEFS)
    .filter((def) => copyLimitOf(def.name) > 0)
    .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0) || a.name.localeCompare(b.name));
}
