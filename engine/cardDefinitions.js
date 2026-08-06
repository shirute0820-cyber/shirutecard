import { KEYWORDS, CARD_TYPES } from "./constants.js";

// カード定義は「宣言的なデータ」として持たせる。
// 固有効果(誘発・常時・超越追加効果)は effectRegistry.js 側で
// カード名をキーに後から登録する(カード追加のたびにエンジン本体を
// 書き換えずに済むようにするための分離)。

export const CARD_DEFS = {
  ゴブリン: {
    theme: "汎用",
    name: "ゴブリン", type: CARD_TYPES.MONSTER, cost: 1, atk: 4, hp: 4,
    race: "闇", keywords: [],
  },
  ただの傭兵: {
    theme: "汎用",
    name: "ただの傭兵", type: CARD_TYPES.MONSTER, cost: 2, atk: 4, hp: 8,
    race: "光", keywords: [],
  },
  リビングウォール: {
    theme: "汎用",
    name: "リビングウォール", type: CARD_TYPES.MONSTER, cost: 5, atk: 0, hp: 20,
    race: "闇", keywords: [KEYWORDS.CHOUHATSU],
  },
  天翔ける騎士: {
    theme: "汎用",
    name: "天翔ける騎士", type: CARD_TYPES.MONSTER, cost: 6, atk: 16, hp: 16,
    race: "光", keywords: [KEYWORDS.SOKKOU, KEYWORDS.KAKUSATSU],
  },
  死神: {
    theme: "汎用",
    name: "死神", type: CARD_TYPES.MONSTER, cost: 9, atk: 32, hp: 4,
    race: "闇", keywords: [KEYWORDS.KANTSUU],
  },
  投石: { name: "投石", type: CARD_TYPES.EVENT, cost: 1 , theme: "汎用" },
  やり直し: { name: "やり直し", type: CARD_TYPES.EVENT, cost: 1 , theme: "汎用" },
  祈り: { name: "祈り", type: CARD_TYPES.EVENT, cost: 1 , theme: "汎用" },
  痛いのは嫌なので: { name: "痛いのは嫌なので", type: CARD_TYPES.EVENT, cost: 2 , theme: "汎用" },
  用意周到: { name: "用意周到", type: CARD_TYPES.EVENT, cost: 3 , theme: "汎用" },
  明日から本気出す: { name: "明日から本気出す", type: CARD_TYPES.EVENT, cost: 3 , theme: "汎用" },
  シールドバッシュ: { name: "シールドバッシュ", type: CARD_TYPES.EVENT, cost: 5 , theme: "汎用" },
  福音受けし者: {
    theme: "汎用",
    name: "福音受けし者", type: CARD_TYPES.MONSTER, cost: 3, atk: 8, hp: 8,
    race: "光", keywords: [],
  },

  // --- 赤テーマ(仮) ---
  ドラゴンの卵: {
    theme: "赤",
    name: "ドラゴンの卵", type: CARD_TYPES.MONSTER, cost: 1, atk: 0, hp: 12,
    race: "ドラゴン", keywords: [], cannotAttack: true,
  },
  ワイバーン: {
    theme: "赤",
    name: "ワイバーン", type: CARD_TYPES.MONSTER, cost: 1, atk: 8, hp: 4,
    race: "亜竜", keywords: [],
  },
  洞窟を守る地竜: {
    theme: "赤",
    name: "洞窟を守る地竜", type: CARD_TYPES.MONSTER, cost: 2, atk: 4, hp: 12,
    race: "亜竜", keywords: [KEYWORDS.CHOUHATSU],
  },
  エリマキドラゴン: {
    theme: "赤",
    name: "エリマキドラゴン", type: CARD_TYPES.MONSTER, cost: 2, atk: 8, hp: 8,
    race: "ドラゴン", keywords: [],
  },
  老練の竜使い: {
    theme: "赤",
    name: "老練の竜使い", type: CARD_TYPES.MONSTER, cost: 3, atk: 12, hp: 4,
    race: "竜人", keywords: [],
  },
  レッドドラゴン: {
    theme: "赤",
    name: "レッドドラゴン", type: CARD_TYPES.MONSTER, cost: 3, atk: 16, hp: 8,
    race: "ドラゴン", keywords: [KEYWORDS.TOTSUGEKI],
    releaseRequirement: "ドラゴンの卵",
  },
  ブルードラゴン: {
    theme: "赤",
    name: "ブルードラゴン", type: CARD_TYPES.MONSTER, cost: 3, atk: 8, hp: 16,
    race: "ドラゴン", keywords: [KEYWORDS.CHOUHATSU],
    releaseRequirement: "ドラゴンの卵",
  },
  スピア・ワイバーン: {
    theme: "赤",
    name: "スピア・ワイバーン", type: CARD_TYPES.MONSTER, cost: 3, atk: 12, hp: 8,
    race: "亜竜", keywords: [KEYWORDS.KANTSUU, KEYWORDS.SOKKOU],
  },
  クロデカス・ワイバーン: {
    theme: "赤",
    name: "クロデカス・ワイバーン", type: CARD_TYPES.MONSTER, cost: 4, atk: 8, hp: 12,
    race: "亜竜", keywords: [],
  },
  右腕を失くしたゴ・ド・リック: {
    theme: "赤",
    name: "右腕を失くしたゴ・ド・リック", type: CARD_TYPES.MONSTER, cost: 5, atk: 16, hp: 12,
    race: "竜人", keywords: [],
  },
  ゴ・ド・リックの右腕: {
    theme: "赤",
    name: "ゴ・ド・リックの右腕", type: CARD_TYPES.MONSTER, cost: 5, atk: 4, hp: 20,
    race: "ドラゴン", keywords: [], copyLimit: 0, // デッキ投入不可、特殊召喚専用
  },
  ドラゴニュート・キング: {
    theme: "赤",
    name: "ドラゴニュート・キング", type: CARD_TYPES.MONSTER, cost: 7, atk: 20, hp: 16,
    race: "竜人", keywords: [KEYWORDS.ONMITSU],
  },
  竜餐の祭日: { name: "竜餐の祭日", type: CARD_TYPES.EVENT, cost: 0 , theme: "赤" },
  ドラゴンの血誓: { name: "ドラゴンの血誓", type: CARD_TYPES.EVENT, cost: 1 , theme: "赤" },
  リバーススケイル: { name: "リバーススケイル", type: CARD_TYPES.EVENT, cost: 1 , theme: "赤" },
  ドラゴンの招集: { name: "ドラゴンの招集", type: CARD_TYPES.EVENT, cost: 2 , theme: "赤" },
  滝の試練: { name: "滝の試練", type: CARD_TYPES.EVENT, cost: 2 , theme: "赤" },
  エッグ・シーフ: {
    theme: "赤",
    name: "エッグ・シーフ", type: CARD_TYPES.MONSTER, cost: 2, atk: 8, hp: 4,
    race: "盗賊", keywords: [],
  },
  ドラゴンの眼光: { name: "ドラゴンの眼光", type: CARD_TYPES.EVENT, cost: 3 , theme: "赤" },
  デスラトル: { name: "デスラトル", type: CARD_TYPES.EVENT, cost: 4 , theme: "赤" },
  オルレアホワイト・ドラゴン: {
    theme: "赤",
    name: "オルレアホワイト・ドラゴン", type: CARD_TYPES.MONSTER, cost: 5, atk: 4, hp: 20,
    race: "ドラゴン", keywords: [], releaseRequirement: "ドラゴンの卵",
  },
  ダリアバーミリオン・ドラゴン: {
    theme: "赤",
    name: "ダリアバーミリオン・ドラゴン", type: CARD_TYPES.MONSTER, cost: 6, atk: 24, hp: 16,
    race: "ドラゴン", keywords: [KEYWORDS.SOKKOU], releaseRequirement: "レッドドラゴン",
  },
  デルフィニウムアズール・ドラゴン: {
    theme: "赤",
    name: "デルフィニウムアズール・ドラゴン", type: CARD_TYPES.MONSTER, cost: 6, atk: 12, hp: 28,
    race: "ドラゴン", keywords: [KEYWORDS.CHOUHATSU], releaseRequirement: "ブルードラゴン",
  },
  エンダーリコリス・ワイバーン: {
    theme: "赤",
    name: "エンダーリコリス・ワイバーン", type: CARD_TYPES.MONSTER, cost: 8, atk: 28, hp: 28,
    race: "亜竜", keywords: [KEYWORDS.SOKKOU], cannotBeSpecialSummoned: true,
  },
};

export function createCardInstance(defName, ownerId, instanceId) {
  const def = CARD_DEFS[defName];
  if (!def) throw new Error(`未定義のカードです: ${defName}`);
  return {
    instanceId,
    ownerId,
    defName: def.name,
    type: def.type,
    cost: def.cost,
    race: def.race ?? null,
    baseAtk: def.atk ?? 0,
    baseHp: def.hp ?? 0,
    currentAtk: def.atk ?? 0,
    currentHp: def.hp ?? 0,
    cannotAttack: !!def.cannotAttack,
    baseKeywords: new Set(def.keywords ?? []),
    grantedKeywords: new Set(), // カード効果で後から付与。場を離れると自動消滅(インスタンス破棄で自然に達成)
    summonedOnTurn: null,       // グローバルターン数
    hasAttackedThisTurn: false,
    transcended: false,
    invulnerableThisTurn: false,
    attackRestriction: null,    // 'monsterOnly' 等、そのターン限定の攻撃制限
    canBeSpecialSummoned: !def.cannotBeSpecialSummoned,
    onceEffectUsedThisTurn: {}, // 「1ターンに1度」系の個別フラグ置き場
  };
}
