// ==========================================================
// 定数定義
// ==========================================================

export const KEYWORDS = Object.freeze({
  SOKKOU: "速攻",     // 召喚酔い無視、プレイヤー/モンスターどちらも攻撃可
  TOTSUGEKI: "突撃",  // 召喚酔い無視だがモンスターへの攻撃のみ
  KANTSUU: "貫通",    // シールド無視でプレイヤーに直接ダメージ
  CHOUHATSU: "挑発",  // 相手はこのモンスターしか攻撃対象にできない
  ONMITSU: "隠密",    // 攻撃対象にならない(自身が攻撃すると解除)
  KAKUSATSU: "確殺",  // 交戦した相手をステータス無視で破壊
});

export const PHASES = Object.freeze({
  DRAW: "draw",
  ACTION: "action",
  END: "end",
});

export const CARD_TYPES = Object.freeze({
  MONSTER: "モンスター",
  EVENT: "イベント",
  // 破壊されない限り効果を発動し続ける「持続イベント」。イベントゾーンに設置され、
  // 発動後すぐ墓地へ送られる通常のイベントとは異なり、場に残り続ける(2026/08/13ルール確定)。
  PERSISTENT_EVENT: "持続イベント",
});

export const CONFIG = Object.freeze({
  BOARD_MONSTER_SLOTS: 4,
  EVENT_ZONE_SLOTS: 1,
  START_HP: 80,
  MAX_HP: 80, // 回復効果があっても体力はこの値を超えない
  HAND_DRAW_SIZE: 5,               // 自ターン開始時に常に引く枚数
  INITIAL_HAND_SIZE: 5,            // ゲーム開始時、マリガン前に両者へ配る枚数
  SECOND_PLAYER_FIRST_TURN_BONUS: 1, // 後攻1ターン目のみ追加で引く枚数(5+1=6枚)
  HAND_KEEP_SIZE: 1,               // 自ターン開始時、保留以外で残せる枚数
  DEFAULT_COPY_LIMIT: 3,
  RESOURCE_START: 3,
  RESOURCE_MAX: 9,
  RESOURCE_STEP: 2,
  RESOURCE_STEP_EVERY_N_OWN_TURNS: 2,
  TRANSCEND_MIN_TURN: 4,      // 後攻はグローバル4ターン目(=自分の4ターン目)から、先攻はその1ターン後(5ターン目)から使用可能
                               // (2026/08/14変更: 「4ターン目以降」から「4ターン目の後攻から」に変更。
                               //  実際の判定はGameState.transcendMinTurnFor()を参照)
  TRANSCEND_COOLDOWN: 3,      // 使用後3ターンは(誰であっても)再使用不可
  TRANSCEND_MAX_BONUS: 20,    // 攻撃力・体力の増加量はターン数×2だが、この値で頭打ち
});
