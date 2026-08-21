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
  return migrateThemeRenamesIfNeeded(migrateFromOldFormatIfNeeded());
}

// テーマ名そのものが変更された場合(例: 2026/08/21「赤」→「ドラゴニア」)、
// 既にそのテーマでデッキを組んでいたユーザーの保存データが古い名前のまま
// 残ってしまう。放置すると、そのデッキを開いたときにlistBuildableCardsForTheme()が
// 新テーマ名でしかカードを拾えず、既存の採用カードがデッキ編集画面から
// 消えたように見えてしまう不具合になる。そのため、旧テーマ名→新テーマ名の
// 対応表に沿って、保存データ側を自動的に書き換えておく(2026/08/21新設)。
// 今後また同様のテーマ名変更があれば、この対応表に追記すればよい
const THEME_RENAMES = {
  "赤": "ドラゴニア",
};
function migrateThemeRenamesIfNeeded(data) {
  let changed = false;
  for (const deck of Object.values(data.decks)) {
    if (deck.theme && THEME_RENAMES[deck.theme]) {
      deck.theme = THEME_RENAMES[deck.theme];
      changed = true;
    }
  }
  if (changed) writeDecksData(data);
  return data;
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

// デッキ内で使われている「汎用以外」のテーマ一覧を返す(ドラゴニア・クレリック等)。
// 汎用カードはどのデッキにも組み込めるが、汎用以外のテーマは1デッキにつき1つまでしか
// 混在させられない(例: ドラゴニアテーマとクレリックテーマを同じデッキに入れることはできない)。
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

// 保存されている全デッキの一覧(id・名前・テーマ・合計枚数・有効かどうか)を返す
export function listDecks() {
  const data = loadDecksData();
  return Object.entries(data.decks).map(([id, d]) => {
    const counts = sanitizeCounts(d.counts);
    return {
      id,
      name: d.name,
      theme: d.theme ?? null,
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

// 指定したデッキの中身(id・名前・テーマ・枚数マップ)を返す。存在しなければnull
export function getDeck(id) {
  const data = loadDecksData();
  const d = data.decks[id];
  if (!d) return null;
  return { id, name: d.name, theme: d.theme ?? null, counts: sanitizeCounts(d.counts) };
}

// アクティブなデッキを返す(未設定/削除済みならnull)
export function getActiveDeck() {
  const data = loadDecksData();
  if (!data.activeDeckId || !data.decks[data.activeDeckId]) return null;
  return getDeck(data.activeDeckId);
}

// 新しいデッキを作成してidを返す(最初のデッキなら自動的にアクティブになる)。
// テーマ(汎用以外、例:赤・クレリック)は作成時に必ず1つ選んで固定する。
// 作成後はそのデッキのテーマを変更できない(テーマを変えたい場合は新しいデッキを作る)。
export function createDeck(name, theme) {
  if (!theme || !listNonGenericThemes().includes(theme)) {
    throw new Error("デッキ作成時にはテーマを1つ選んでください");
  }
  const data = loadDecksData();
  const id = generateId();
  data.decks[id] = { name: name?.trim() || "新しいデッキ", theme, counts: {} };
  if (!data.activeDeckId) data.activeDeckId = id;
  writeDecksData(data);
  return id;
}

// テーマが未設定(旧仕様で作られた空デッキ等)のデッキに、既存の枚数構成から
// 推測できる場合はテーマを補完して保存する。判定できない場合はnullを返す
// (呼び出し側でユーザーに選んでもらう必要がある)
export function migrateDeckThemeIfNeeded(id) {
  const data = loadDecksData();
  const d = data.decks[id];
  if (!d) return null;
  if (d.theme) return d.theme;
  const themes = nonGenericThemesUsed(sanitizeCounts(d.counts));
  if (themes.size === 1) {
    d.theme = [...themes][0];
    writeDecksData(data);
    return d.theme;
  }
  return null;
}

// テーマ未設定のデッキ(新規作成直後・旧仕様からの移行等)にテーマを1つ固定する。
// 一度設定したテーマは(このデッキが存在する限り)変更できない
export function setDeckTheme(id, theme) {
  if (!theme || !listNonGenericThemes().includes(theme)) {
    throw new Error("有効なテーマを選んでください");
  }
  const data = loadDecksData();
  const d = data.decks[id];
  if (!d) return;
  if (d.theme && d.theme !== theme) {
    throw new Error(`このデッキのテーマは既に『${d.theme}』に固定されています`);
  }
  d.theme = theme;
  writeDecksData(data);
}

export function renameDeck(id, newName) {
  const data = loadDecksData();
  if (!data.decks[id]) return;
  data.decks[id].name = newName?.trim() || data.decks[id].name;
  writeDecksData(data);
}

// 保存するカード枚数は、そのデッキのテーマ+汎用のカードだけに絞り込む
// (万一テーマ外のカードが紛れ込んでいても、保存時に自動的に除外される安全策)
export function updateDeckCounts(id, counts) {
  const data = loadDecksData();
  const d = data.decks[id];
  if (!d) return;
  const cleaned = sanitizeCounts(counts);
  for (const name of Object.keys(cleaned)) {
    const def = CARD_DEFS[name];
    if (def?.theme && def.theme !== "汎用" && def.theme !== d.theme) delete cleaned[name];
  }
  d.counts = cleaned;
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

// カード一覧画面(新規デッキ作成時のテーマ選択)用: 実在する「汎用以外」のテーマ一覧
// (赤・クレリック等)を、カード定義の登場順で返す
export function listNonGenericThemes() {
  const seen = new Set();
  const themes = [];
  for (const def of listBuildableCards()) {
    if (def.theme && def.theme !== "汎用" && !seen.has(def.theme)) {
      seen.add(def.theme);
      themes.push(def.theme);
    }
  }
  return themes;
}

// 指定したテーマ+汎用のカードだけを返す(デッキ編集画面で使う)
export function listBuildableCardsForTheme(theme) {
  return listBuildableCards().filter((def) => def.theme === "汎用" || def.theme === theme);
}

// 枚数制限0(デッキには入れられない、カード効果でのみ場に出る)カードの一覧を、
// テーマ別に参照表示する用(2026/08/21新規追加)。デッキ構築画面で「このテーマのデッキから
// カード効果で出てくるカードにはどんなものがあるか」を確認できるようにするための一覧
export function listSpecialSummonOnlyCardsForTheme(theme) {
  return Object.values(CARD_DEFS)
    .filter((def) => copyLimitOf(def.name) === 0 && (def.theme === "汎用" || def.theme === theme))
    .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0) || a.name.localeCompare(b.name));
}
