import { KEYWORDS, CARD_TYPES } from "./constants.js";

// カード定義は「宣言的なデータ」として持たせる。
// 固有効果(誘発・常時・超越追加効果)は effectRegistry.js 側で
// カード名をキーに後から登録する(カード追加のたびにエンジン本体を
// 書き換えずに済むようにするための分離)。

export const CARD_DEFS = {
  ゴブリン: {
    theme: "汎用",
    effect: "効果なし。",
    name: "ゴブリン", type: CARD_TYPES.MONSTER, cost: 1, atk: 4, hp: 4,
    race: "闇", keywords: [],
  },
  ただの傭兵: {
    theme: "汎用",
    effect: "効果なし。",
    name: "ただの傭兵", type: CARD_TYPES.MONSTER, cost: 2, atk: 4, hp: 8,
    race: "光", keywords: [],
  },
  リビングウォール: {
    theme: "汎用",
    effect: "【挑発】",
    name: "リビングウォール", type: CARD_TYPES.MONSTER, cost: 5, atk: 0, hp: 20,
    race: "闇", keywords: [KEYWORDS.CHOUHATSU],
  },
  天翔ける騎士: {
    theme: "汎用",
    effect: "【速攻】【確殺】",
    name: "天翔ける騎士", type: CARD_TYPES.MONSTER, cost: 6, atk: 16, hp: 16,
    race: "光", keywords: [KEYWORDS.SOKKOU, KEYWORDS.KAKUSATSU],
  },
  死神: {
    theme: "汎用",
    effect: "【貫通】",
    name: "死神", type: CARD_TYPES.MONSTER, cost: 9, atk: 32, hp: 4,
    race: "闇", keywords: [KEYWORDS.KANTSUU],
  },
  投石: { name: "投石", type: CARD_TYPES.EVENT, cost: 1 , theme: "汎用", effect: "相手モンスター1体に4ダメージ。" },
  やり直し: { name: "やり直し", type: CARD_TYPES.EVENT, cost: 1 , theme: "汎用", effect: "カードを1枚ドローする。" },
  祈り: { name: "祈り", type: CARD_TYPES.EVENT, cost: 1 , theme: "汎用", effect: "自分の体力を4回復する。" },
  痛いのは嫌なので: { name: "痛いのは嫌なので", type: CARD_TYPES.EVENT, cost: 2 , theme: "汎用", effect: "自分のシールド値を8上げる。" },
  用意周到: { name: "用意周到", type: CARD_TYPES.EVENT, cost: 3 , theme: "汎用", effect: "自分の手札1枚に「保留」を付与する。" },
  明日から本気出す: { name: "明日から本気出す", type: CARD_TYPES.EVENT, cost: 3 , theme: "汎用", effect: "ストレージのカードをすべてデッキに戻す。" },
  シールドバッシュ: { name: "シールドバッシュ", type: CARD_TYPES.EVENT, cost: 5 , theme: "汎用", effect: "相手のシールド値を0にする。" },
  福音受けし者: {
    theme: "汎用",
    effect: "場に出たとき、相手の場にいるモンスターすべてに4ダメージ。≪超越≫相手の場にいるモンスター1体を破壊する。",
    name: "福音受けし者", type: CARD_TYPES.MONSTER, cost: 3, atk: 8, hp: 8,
    race: "光", keywords: [],
  },

  // --- 赤テーマ(仮) ---
  ドラゴンの卵: {
    theme: "赤",
    effect: "攻撃できない。",
    name: "ドラゴンの卵", type: CARD_TYPES.MONSTER, cost: 1, atk: 0, hp: 12,
    race: "ドラゴン", keywords: [], cannotAttack: true,
  },
  ワイバーン: {
    theme: "赤",
    effect: "効果なし。",
    name: "ワイバーン", type: CARD_TYPES.MONSTER, cost: 1, atk: 8, hp: 4,
    race: "亜竜", keywords: [],
  },
  洞窟を守る地竜: {
    theme: "赤",
    effect: "【挑発】《超越》自分の場に『洞窟を守る地竜』2体を特殊召喚する。",
    name: "洞窟を守る地竜", type: CARD_TYPES.MONSTER, cost: 2, atk: 4, hp: 12,
    race: "亜竜", keywords: [KEYWORDS.CHOUHATSU],
  },
  エリマキドラゴン: {
    theme: "赤",
    effect: "場に出たとき、カードを1枚ドローする。",
    name: "エリマキドラゴン", type: CARD_TYPES.MONSTER, cost: 2, atk: 8, hp: 8,
    race: "ドラゴン", keywords: [],
  },
  老練の竜使い: {
    theme: "赤",
    effect: "手札から召喚したとき、場に存在するドラゴン種を+8/0する。≪超越≫自分の場にいるドラゴン・亜竜種1体に【貫通】を付与する。",
    name: "老練の竜使い", type: CARD_TYPES.MONSTER, cost: 3, atk: 12, hp: 4,
    race: "竜人", keywords: [],
  },
  レッドドラゴン: {
    theme: "赤",
    effect: "【突撃】①召喚するとき、自分の場にある『ドラゴンの卵』を墓地に送らなければならない。②場に出たとき、相手の場にいるモンスター1体に16ダメージを与える。",
    name: "レッドドラゴン", type: CARD_TYPES.MONSTER, cost: 3, atk: 16, hp: 8,
    race: "ドラゴン", keywords: [KEYWORDS.TOTSUGEKI],
    releaseRequirement: "ドラゴンの卵",
  },
  ブルードラゴン: {
    theme: "赤",
    effect: "【挑発】①召喚するとき、自分の場にある『ドラゴンの卵』を墓地に送らなければならない。②場に出たとき、相手の場にいるモンスターすべてに8ダメージを与える。",
    name: "ブルードラゴン", type: CARD_TYPES.MONSTER, cost: 3, atk: 8, hp: 16,
    race: "ドラゴン", keywords: [KEYWORDS.CHOUHATSU],
    releaseRequirement: "ドラゴンの卵",
  },
  スピア・ワイバーン: {
    theme: "赤",
    effect: "【貫通】【速攻】",
    name: "スピア・ワイバーン", type: CARD_TYPES.MONSTER, cost: 3, atk: 12, hp: 8,
    race: "亜竜", keywords: [KEYWORDS.KANTSUU, KEYWORDS.SOKKOU],
  },
  クロデカス・ワイバーン: {
    theme: "赤",
    effect: "手札から召喚されたとき、自分の場にワイバーン2体を特殊召喚する。自分の場にいるワイバーンは【速攻】を持つ。",
    name: "クロデカス・ワイバーン", type: CARD_TYPES.MONSTER, cost: 4, atk: 8, hp: 12,
    race: "亜竜", keywords: [],
  },
  右腕を失くしたゴ・ド・リック: {
    theme: "赤",
    effect: "場に出たとき『ゴ・ド・リックの右腕』を特殊召喚する。それは、【挑発】を持つ。≪超越≫『ゴ・ド・リックの右腕』を+8/+4し、【突撃】を付与する。",
    name: "右腕を失くしたゴ・ド・リック", type: CARD_TYPES.MONSTER, cost: 5, atk: 16, hp: 12,
    race: "竜人", keywords: [],
  },
  ゴ・ド・リックの右腕: {
    theme: "赤",
    effect: "『右腕を失くしたゴ・ド・リック』が自分の場から離れたとき、このカードを破壊する。",
    name: "ゴ・ド・リックの右腕", type: CARD_TYPES.MONSTER, cost: 5, atk: 4, hp: 20,
    race: "ドラゴン", keywords: [], copyLimit: 0, // デッキ投入不可、特殊召喚専用
  },
  ドラゴニュート・キング: {
    theme: "赤",
    effect: "【隠密】【突撃】①場に出たとき、デッキから竜人種1体を手札に加える。②1ターンに1度、敵を破壊したとき、もう一度攻撃できるようになる。≪超越≫敵を破壊したとき、相手に8ダメージを与える。",
    name: "ドラゴニュート・キング", type: CARD_TYPES.MONSTER, cost: 7, atk: 20, hp: 16,
    race: "竜人", keywords: [KEYWORDS.ONMITSU],
  },
  竜餐の祭日: { name: "竜餐の祭日", type: CARD_TYPES.EVENT, cost: 0 , theme: "赤", effect: "ドラゴン種が戦闘によってモンスターを破壊したターンに使用できる。カードを1枚ドローする。" },
  ドラゴンの血誓: { name: "ドラゴンの血誓", type: CARD_TYPES.EVENT, cost: 1 , theme: "赤", effect: "手札のドラゴン種1体を墓地に送ることで発動可能。デッキから2枚ドローする。" },
  リバーススケイル: { name: "リバーススケイル", type: CARD_TYPES.EVENT, cost: 1 , theme: "赤", effect: "自分の場に存在する亜竜・ドラゴン種1体の攻撃力をターン終了時まで8アップする。" },
  ドラゴンの招集: { name: "ドラゴンの招集", type: CARD_TYPES.EVENT, cost: 2 , theme: "赤", effect: "自分の場にドラゴン種のモンスターがいるときに発動可能。墓地にある亜竜種2体をデッキに戻す。" },
  滝の試練: { name: "滝の試練", type: CARD_TYPES.EVENT, cost: 2 , theme: "赤", effect: "手札を1枚捨てることで発動可能。デッキ・ストレージからドラゴン種1体を手札に加える。" },
  エッグ・シーフ: {
    theme: "赤",
    effect: "①場に出たとき、デッキ・ストレージから『ドラゴンの卵』1枚を手札に加える。②場から離れたとき、墓地にある『ドラゴンの卵』をすべてデッキに加える。",
    name: "エッグ・シーフ", type: CARD_TYPES.MONSTER, cost: 2, atk: 8, hp: 4,
    race: "盗賊", keywords: [],
  },
  ドラゴンの眼光: { name: "ドラゴンの眼光", type: CARD_TYPES.EVENT, cost: 3 , theme: "赤", effect: "自分の場にドラゴン種がいるとき、相手の場にいるモンスター1体を破壊できる。" },
  デスラトル: { name: "デスラトル", type: CARD_TYPES.EVENT, cost: 4 , theme: "赤", effect: "自分の場・手札から亜竜種2体を墓地に送ることで発動可能。相手の場にいるモンスター2体に16ダメージを与える。" },
  オルレアホワイト・ドラゴン: {
    theme: "赤",
    effect: "①召喚するとき、自分の場にある『ドラゴンの卵』を墓地に送らなければならない。②1ターンに1度発動可能。手札からドラゴン種1体を除外する。ターン終了時まで攻撃力がリリースしたモンスターの攻撃力分アップする。③自分のエンドフェイズ時、相手の場にいるこのモンスターより体力が低いモンスターを破壊する。≪超越≫カードを2枚ドローする。",
    name: "オルレアホワイト・ドラゴン", type: CARD_TYPES.MONSTER, cost: 5, atk: 4, hp: 20,
    race: "ドラゴン", keywords: [], releaseRequirement: "ドラゴンの卵",
  },
  ダリアバーミリオン・ドラゴン: {
    theme: "赤",
    effect: "【速攻】①召喚するとき、自分の場にある『レッドドラゴン』を墓地に送らなければならない。②場に出たとき、相手の場にいるモンスター1体に24ダメージを与える。その後、自分の場にいる亜竜種すべてに「速攻」を付与する。≪超越≫自分のエンドフェイズ時、相手プレイヤーに20ダメージ与える。",
    name: "ダリアバーミリオン・ドラゴン", type: CARD_TYPES.MONSTER, cost: 6, atk: 24, hp: 16,
    race: "ドラゴン", keywords: [KEYWORDS.SOKKOU], releaseRequirement: "レッドドラゴン",
  },
  デルフィニウムアズール・ドラゴン: {
    theme: "赤",
    effect: "【挑発】①召喚するとき、自分の場にある『ブルードラゴン』を墓地に送らなければならない。②場に出たとき、相手の場にいるモンスターすべてに12ダメージを与える。その後、墓地にいる亜竜種1体を「挑発」を付与した状態で自分の場に特殊召喚できる。≪超越≫自分のエンドフェイズ時、プレイヤーの体力を24回復する。",
    name: "デルフィニウムアズール・ドラゴン", type: CARD_TYPES.MONSTER, cost: 6, atk: 12, hp: 28,
    race: "ドラゴン", keywords: [KEYWORDS.CHOUHATSU], releaseRequirement: "ブルードラゴン",
  },
  エンダーリコリス・ワイバーン: {
    theme: "赤",
    effect: "【速攻】①このカードは特殊召喚できない。②場に出たとき、墓地の亜竜種を2体まで自分の場に特殊召喚できる。≪超越≫自分の場にいる亜竜種を+8/+4し、【挑発】を付与する。",
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
