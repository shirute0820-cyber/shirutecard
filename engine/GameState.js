import { KEYWORDS, CONFIG } from "./constants.js";
import { CARD_DEFS, createCardInstance } from "./cardDefinitions.js";
import { EFFECTS } from "./effectRegistry.js";

let uidCounter = 0;
const genUid = () => `c${++uidCounter}`;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createPlayer(id, deckList) {
  return {
    id,
    deck: shuffle(deckList),
    hand: [],       // {uid, defName, hold}
    storage: [],     // defName[]
    graveyard: [],   // defName[]
    exile: [],       // defName[] (「除外」ゾーン)
    board: new Array(CONFIG.BOARD_MONSTER_SLOTS).fill(null),
    hp: CONFIG.START_HP,
    shield: 0,
    ownTurnCount: 0,
    resourceCap: 0,
    resourceAvailable: 0,
    transcendCooldownUntilOwnTurn: 0, // 自分の「自ターン数」基準でのクールダウン(グローバル/ラウンドとは無関係)
    secondPlayerBonusDrawsRemaining: 2, // 後攻補正②(合計2回、ただし1ターンに1回まで)
    secondPlayerBonusDrawUsedThisTurn: false,
  };
}

export class GameState {
  constructor({ player1Deck, player2Deck, firstPlayerId = "p1", log = () => {} }) {
    this.players = {
      p1: createPlayer("p1", player1Deck),
      p2: createPlayer("p2", player2Deck),
    };
    this.firstPlayerId = firstPlayerId;
    this.secondPlayerId = firstPlayerId === "p1" ? "p2" : "p1";
    // 「ターン数」は先攻・後攻共通のラウンド数。先攻の行動が始まるたびに+1され、
    // 後攻の行動中は先攻と同じ値のまま(例:1ターン目=先攻の初手+後攻の初手、
    // 後攻のターンが終わって先攻に戻るタイミングで2ターン目になる)。
    this.turnNumber = 0;
    this.activePlayerId = null;
    this.phase = null;
    this.log = log;
    this.winner = null;
    this.dragonKilledThisTurnByCombat = false; // 竜餐の祭日などが参照する簡易フラグ
    this.pendingEndPhaseEffects = { p1: [], p2: [] }; // 超越などによる「次のエンドフェイズに1回だけ」の遅延効果
    // 注: 「超越したターンから継続的に毎エンドフェイズ発動する」効果(ダリアバーミリオン・ドラゴン等)は、
    // クロージャをキューに積む方式だとFirebase同期時のhydrateGame()で復元できず消えてしまうため、
    // instance.transcended(シリアライズ対象の通常フィールド)を見るonOwnEndPhaseフックとして
    // effectRegistry.js側に実装している(pendingEndPhaseEffectsのような専用の永続キューは持たない)。
    this.pendingNextPlayerId = null; // endTurn()後、次のプレイヤーがstartTurn()を呼ぶまでの待機状態
  }

  opponentOf(playerId) {
    return playerId === "p1" ? "p2" : "p1";
  }

  // ---------------- ターン進行 ----------------

  startGame() {
    // 両者に初期手札5枚を配る。ここではまだターンを開始しない。
    // 各プレイヤーがmulligan()を呼び終えると、自動的に先攻のターン1が始まる。
    this.forceDraw(this.players.p1, CONFIG.INITIAL_HAND_SIZE);
    this.forceDraw(this.players.p2, CONFIG.INITIAL_HAND_SIZE);
    this.mulliganDone = { p1: false, p2: false };
    this.gameStarted = false;
    this.log("両者に初期手札5枚を配布。マリガンを行ってください");
  }

  // ゲーム開始時のマリガン。returnUids に指定した手札をデッキに戻し、
  // 同じ枚数だけ新たにドローする(0枚指定=マリガンしない、も可能)。
  // 両者がこれを終えると、自動的に先攻のターン1が始まる。
  mulligan(playerId, returnUids = []) {
    if (this.gameStarted) throw new Error("マリガンはゲーム開始前のみ行えます");
    const player = this.players[playerId];
    if (this.mulliganDone[playerId]) throw new Error("既にマリガンは済んでいます");

    const returning = [];
    for (const uid of returnUids) {
      const idx = player.hand.findIndex((c) => c.uid === uid);
      if (idx === -1) throw new Error("指定された手札が見つかりません");
      returning.push(player.hand[idx]);
    }

    player.hand = player.hand.filter((c) => !returning.includes(c));
    player.deck.push(...returning.map((c) => c.defName));
    player.deck = shuffle(player.deck);
    this.forceDraw(player, returning.length);
    this.mulliganDone[playerId] = true;
    this.log(`${playerId}: マリガンで${returning.length}枚をデッキに戻し、${returning.length}枚ドローした`);

    if (this.mulliganDone.p1 && this.mulliganDone.p2) {
      this.gameStarted = true;
      // ターン1は選択不要(前ターンが存在しないため)なので、そのまま自動的に開始してよい
      this.startTurn(this.firstPlayerId);
    }
  }

  // keepUid: 2ターン目以降、保留以外の手札が1枚以上ある場合に必須。
  //   - 具体的なuidを渡す: そのカードを1枚残す
  //   - null を渡す: 何も残さない(あえて全て手放して5枚引き直す、という選択)
  //   - 未指定(undefined): 保留以外の手札が1枚以上あるのに判断がされていない状態としてエラーになる
  //
  // 重要: これは「次の手番になるプレイヤー本人」が呼ぶメソッド。
  // (オンライン対戦では、ターンを終えた側のクライアントが次のプレイヤーの
  //  手札選択を代わりに決めることはできないため、endTurn()とは意図的に分離している)
  startTurn(playerId, keepUid = undefined) {
    if (this.pendingNextPlayerId !== undefined && this.pendingNextPlayerId !== null && this.pendingNextPlayerId !== playerId) {
      throw new Error("今はこのプレイヤーのターンを開始できません");
    }
    const player = this.players[playerId];
    const isFirstOwnTurn = player.ownTurnCount === 0;

    // 状態を変更する前に、選択が必要かどうかを先に確定させる
    // (途中で例外を投げてもグローバルターン等が進んでしまわないようにするため)
    let keep = null;
    let hold = null;
    if (!isFirstOwnTurn) {
      hold = player.hand.filter((c) => c.hold);
      const nonHold = player.hand.filter((c) => !c.hold);
      if (nonHold.length === 0) {
        keep = [];
      } else if (keepUid === undefined) {
        throw new Error(
          `残すカードを選んでください(保留以外の手札が${nonHold.length}枚あります。0枚選んで何も残さないことも可能です)`
        );
      } else if (keepUid === null) {
        keep = []; // 明示的に「何も残さない」を選択
      } else {
        const c = nonHold.find((card) => card.uid === keepUid);
        if (!c) throw new Error("指定された手札が見つかりません");
        keep = [c];
      }
    }

    this.activePlayerId = playerId;
    this.pendingNextPlayerId = null;
    player.ownTurnCount += 1;

    // 「ターン数」は先攻の行動が始まったときだけ進む(先攻・後攻共通のラウンド数)。
    // 例: 1ターン目=先攻の初手+後攻の初手。後攻のターンが終わって先攻に戻る
    // タイミングで2ターン目になる。
    if (playerId === this.firstPlayerId) {
      this.turnNumber += 1;
    }

    // リソース上限更新
    const steps = Math.floor((player.ownTurnCount - 1) / CONFIG.RESOURCE_STEP_EVERY_N_OWN_TURNS);
    player.resourceCap = Math.min(
      CONFIG.RESOURCE_START + steps * CONFIG.RESOURCE_STEP,
      CONFIG.RESOURCE_MAX
    );
    player.resourceAvailable = player.resourceCap;

    // シールドは自ターン開始時に0
    player.shield = 0;
    this.dragonKilledThisTurnByCombat = false;
    player.secondPlayerBonusDrawUsedThisTurn = false;

    // ドローフェイズ
    this.phase = "draw";
    if (isFirstOwnTurn) {
      // 先攻・後攻ともに初期手札(マリガン済み)がそのまま初手。
      // 後攻のみ、自分のターンが来たタイミングで優遇分+1枚をドローする。
      if (playerId === this.secondPlayerId) {
        this.forceDraw(player, CONFIG.SECOND_PLAYER_FIRST_TURN_BONUS);
      }
    } else {
      const toStorage = player.hand.filter((c) => !c.hold && !keep.includes(c));
      player.storage.push(...toStorage.map((c) => c.defName));
      player.hand = [...keep, ...hold];
      this.forceDraw(player, CONFIG.HAND_DRAW_SIZE);
    }

    // 各モンスターの召喚酔い判定用フラグ・攻撃済みフラグ・「1ターンに1度」系フラグをリセット
    for (const m of player.board) {
      if (m) {
        m.hasAttackedThisTurn = false;
        m.invulnerableThisTurn = false;
        m.onceEffectUsedThisTurn = {};
      }
    }

    this.phase = "action";
    this.log(
      `--- ターン${this.turnNumber}: ${playerId}のターン(自ターン${player.ownTurnCount}) 開始 コスト上限${player.resourceCap} 手札${player.hand.length}枚 ---`
    );
  }

  // UIが「次のプレイヤーに選択を促す必要があるか」を、状態を変えずに確認するためのヘルパー
  // 戻り値: 選択不要ならnull、必要なら選択肢となる手札配列
  peekKeepSelection(playerId) {
    const player = this.players[playerId];
    if (player.ownTurnCount === 0) return null; // 最初の自ターンは選択不要
    const nonHold = player.hand.filter((c) => !c.hold);
    if (nonHold.length === 0) return null;
    return nonHold;
  }

  // 「残す1枚」を選んでいる最中(=まだstartTurn()が呼ばれておらずコスト上限が
  // 更新されていない)の段階でも、次のターンのコスト上限がいくつになるかを
  // 状態を変えずに確認できるヘルパー。マリガンの判断材料として使う。
  peekNextResourceCap(playerId) {
    const player = this.players[playerId];
    const nextOwnTurnCount = player.ownTurnCount + 1;
    const steps = Math.floor((nextOwnTurnCount - 1) / CONFIG.RESOURCE_STEP_EVERY_N_OWN_TURNS);
    return Math.min(CONFIG.RESOURCE_START + steps * CONFIG.RESOURCE_STEP, CONFIG.RESOURCE_MAX);
  }

  // 自分の手番を終える。次のプレイヤーのターンは開始しない
  // (次のプレイヤー本人が startTurn() を呼ぶまで「between」状態で待機する)
  endTurn() {
    const player = this.players[this.activePlayerId];
    this.phase = "end";

    // 自分のエンドフェイズ時に発動するカード効果(常時監視型)
    for (const m of [...player.board]) {
      if (!m) continue;
      const hook = EFFECTS[m.defName]?.onOwnEndPhase;
      if (hook) hook({ game: this, player, opponent: this.players[this.opponentOf(player.id)], instance: m });
    }

    // 超越などによって予約された、自分のエンドフェイズ時の遅延効果(1回限り、実行後にクリア)
    const pending = this.pendingEndPhaseEffects[player.id];
    this.pendingEndPhaseEffects[player.id] = [];
    for (const fn of pending) fn();

    // シールドのスナップショット計算(ターン終了時)
    // 「痛いのは嫌なので」等のシールド増加効果で既に加算されている分を上書きしないよう、
    // リセットではなく加算する
    const hpSum = player.board.reduce((sum, m) => sum + (m ? m.currentHp : 0), 0);
    player.shield += Math.floor(hpSum / 2);

    // 「ターン終了時まで」の一時的なステータス上昇(例:リバーススケイル)を元に戻す。
    // シールドのスナップショット計算(直前)には、この一時バフがかかった状態の
    // HPを反映させたいため、シールド計算より後にここで戻す。
    for (const m of player.board) {
      if (!m) continue;
      if (m.tempAtkThisTurn) {
        m.currentAtk -= m.tempAtkThisTurn;
        m.tempAtkThisTurn = 0;
      }
      if (m.tempHpThisTurn) {
        m.currentHp -= m.tempHpThisTurn;
        m.tempHpThisTurn = 0;
      }
    }

    this.log(`${this.activePlayerId} ターン終了。手札${player.hand.length}枚、シールド${player.shield}`);

    const nextId = this.opponentOf(this.activePlayerId);
    const nextPlayer = this.players[nextId];

    // マリガン(残す1枚を選ぶ)の判断材料として、次のプレイヤーのコスト上限・シールドは
    // ターン開始(startTurn)を待たず、この時点で確定させておく。
    // (以前は表示上のプレビューだけで、実際の値の更新はstartTurnまで遅れていたため、
    //  マリガン中に見えるコスト・シールドが古い値のままになってしまっていた)
    const nextOwnTurnCount = nextPlayer.ownTurnCount + 1;
    const steps = Math.floor((nextOwnTurnCount - 1) / CONFIG.RESOURCE_STEP_EVERY_N_OWN_TURNS);
    nextPlayer.resourceCap = Math.min(
      CONFIG.RESOURCE_START + steps * CONFIG.RESOURCE_STEP,
      CONFIG.RESOURCE_MAX
    );
    nextPlayer.resourceAvailable = nextPlayer.resourceCap;
    nextPlayer.shield = 0;

    this.activePlayerId = null;
    this.phase = "between";
    this.pendingNextPlayerId = nextId;
  }

  // ---------------- ドロー・手札 ----------------

  forceDraw(player, n) {
    for (let i = 0; i < n; i++) this.drawOne(player);
  }

  drawOne(player) {
    if (player.deck.length === 0) {
      if (player.storage.length === 0) return false; // 引けるカードなし
      player.deck = shuffle(player.storage);
      player.storage = [];
      this.log(`${player.id}: デッキが尽きたためストレージがデッキに戻った`);
    }
    const defName = player.deck.pop();
    player.hand.push({ uid: genUid(), defName, hold: false });
    return true;
  }

  // 後攻補正②：対戦中合計2回まで追加ドロー可能。ただし同じターンに2回はできない(別のターンで1回ずつ)
  useSecondPlayerBonusDraw(playerId) {
    if (playerId !== this.secondPlayerId) throw new Error("先攻はこの権利を持たない");
    const player = this.players[playerId];
    if (player.secondPlayerBonusDrawsRemaining <= 0) throw new Error("追加ドローの権利を使い切っています");
    if (player.secondPlayerBonusDrawUsedThisTurn) throw new Error("このターンは既に使用しています(別のターンで使ってください)");
    player.secondPlayerBonusDrawsRemaining -= 1;
    player.secondPlayerBonusDrawUsedThisTurn = true;
    this.drawOne(player);
    this.log(`${playerId}: 後攻補正の追加ドローを使用(残り${player.secondPlayerBonusDrawsRemaining}回)`);
  }

  // ---------------- 召喚 ----------------

  summonFromHand(playerId, handUid, boardSlot, params = {}) {
    const player = this.players[playerId];
    const idx = player.hand.findIndex((c) => c.uid === handUid);
    if (idx === -1) throw new Error("手札にありません");
    const { defName } = player.hand[idx];
    const def = CARD_DEFS[defName];
    if (!def) throw new Error(`未定義カード: ${defName}`);
    if (def.type !== "モンスター") throw new Error("モンスターカードではありません");
    if (player.resourceAvailable < def.cost) throw new Error("コストが足りません");

    let targetSlot = boardSlot;

    if (def.releaseRequirement) {
      const releaseIdx = player.board.findIndex(
        (m) => m && m.defName === def.releaseRequirement
      );
      if (releaseIdx === -1) {
        throw new Error(`『${def.releaseRequirement}』をリリースしないと召喚できません`);
      }
      this.sendToGraveyard(player, player.board[releaseIdx]);
      // リリースしたモンスターがいた枠に、そのまま新しいモンスターを置く
      targetSlot = releaseIdx;
    } else if (player.board[targetSlot]) {
      throw new Error("その盤面枠は空いていません");
    }

    player.resourceAvailable -= def.cost;
    player.hand.splice(idx, 1);

    const instance = createCardInstance(defName, playerId, genUid());
    instance.summonedOnTurn = this.turnNumber;
    player.board[targetSlot] = instance;

    this.log(`${playerId}: 『${defName}』を召喚(${targetSlot}枠)`);

    const hook = EFFECTS[defName]?.onSummon;
    if (hook) hook({ game: this, player, opponent: this.players[this.opponentOf(playerId)], instance, params });

    return instance;
  }

  // カード効果によるデッキ外からの特殊召喚(トークン的生成、在庫を消費しない)
  specialSummonToken(playerId, defName, boardSlot, { grantedKeywords = [] } = {}) {
    const player = this.players[playerId];
    if (player.board[boardSlot]) throw new Error("その盤面枠は空いていません");
    const instance = createCardInstance(defName, playerId, genUid());
    instance.summonedOnTurn = this.turnNumber;
    for (const k of grantedKeywords) instance.grantedKeywords.add(k);
    player.board[boardSlot] = instance;
    this.log(`${playerId}: 『${defName}』を特殊召喚(デッキ外生成, ${boardSlot}枠)`);
    return instance;
  }

  findEmptySlot(player) {
    return player.board.findIndex((m) => m === null);
  }

  // ---------------- 破壊・死亡処理 ----------------

  sendToGraveyard(player, instance) {
    const slot = player.board.indexOf(instance);
    if (slot !== -1) player.board[slot] = null;
    player.graveyard.push(instance.defName);
    this.log(`${player.id}: 『${instance.defName}』が場を離れた(墓地へ)`);

    // 相手ターン中に自分の場のモンスターが0体になったらシールドは0にリセット
    const aliveCount = player.board.filter(Boolean).length;
    if (aliveCount === 0 && this.activePlayerId !== player.id) {
      player.shield = 0;
      this.log(`${player.id}: 場のモンスターが0体になったためシールドをリセット`);
    }

    // 連動破壊などのフック(例: ゴ・ド・リックの右腕)
    const hook = EFFECTS[instance.defName]?.onLeaveField;
    if (hook) hook({ game: this, player, instance });
  }

  // ---------------- 超越 ----------------

  canTranscend(playerId, instance) {
    if (this.turnNumber < CONFIG.TRANSCEND_MIN_TURN) return false;
    if (instance.transcended) return false;
    const player = this.players[playerId];
    if (player.ownTurnCount < player.transcendCooldownUntilOwnTurn) return false;
    return true;
  }

  // UI表示用: このモンスターが超越を使えるまで、あと何ターンかを返す。
  // 戻り値: { usedUp: true } … このモンスターは超越済みで二度と使えない
  //         { available: true } … 今すぐ使える
  //         { available: false, turnsLeft: N } … あとN(自分の)ターンで使える
  transcendStatus(playerId, instance) {
    if (instance.transcended) return { usedUp: true, available: false, turnsLeft: null };
    const player = this.players[playerId];
    const turnGate = Math.max(0, CONFIG.TRANSCEND_MIN_TURN - this.turnNumber);
    const cooldownGate = Math.max(0, player.transcendCooldownUntilOwnTurn - player.ownTurnCount);
    const turnsLeft = Math.max(turnGate, cooldownGate);
    return { usedUp: false, available: turnsLeft === 0, turnsLeft };
  }

  // UI表示用(プレイヤー単位のサマリー): 個々のモンスターの「超越済みか」は考慮せず、
  // 「解禁ターンに達しているか」「クールダウン中でないか」という、このプレイヤー全体に
  // 共通する2つの条件だけで、超越が使える状態かどうかを返す。
  // (盤面左列に常設する「超越」ステータス表示用。対象モンスターがまだ1体もいなくても表示できる)
  playerTranscendAvailability(playerId) {
    const player = this.players[playerId];
    const turnGate = Math.max(0, CONFIG.TRANSCEND_MIN_TURN - this.turnNumber);
    const cooldownGate = Math.max(0, player.transcendCooldownUntilOwnTurn - player.ownTurnCount);
    const turnsLeft = Math.max(turnGate, cooldownGate);
    return { available: turnsLeft === 0, turnsLeft };
  }

  useTranscend(playerId, instance, params = {}) {
    if (!this.canTranscend(playerId, instance)) throw new Error("超越を使用できません");
    const player = this.players[playerId];

    const bonus = Math.min(this.turnNumber * 2, CONFIG.TRANSCEND_MAX_BONUS);
    instance.currentAtk += bonus;
    instance.currentHp += bonus;
    instance.transcended = true;
    instance.invulnerableThisTurn = true;

    // 召喚酔い中なら「突撃」状態を一時付与(モンスターへの攻撃のみ、そのターン限り)
    if (instance.summonedOnTurn === this.turnNumber && !this.hasKeyword(instance, KEYWORDS.SOKKOU)) {
      instance.attackRestrictionThisTurn = "monsterOnly";
    }

    player.transcendCooldownUntilOwnTurn = player.ownTurnCount + CONFIG.TRANSCEND_COOLDOWN;

    this.log(`${playerId}: 『${instance.defName}』が超越(+${bonus}/+${bonus})`);

    const hook = EFFECTS[instance.defName]?.onTranscend;
    if (hook) hook({ game: this, player, opponent: this.players[this.opponentOf(playerId)], instance, params });
  }

  // ---------------- 起動効果(「1ターンに1度発動可能」等、召喚・超越・イベントに
  // 紐付かない、モンスター単位の任意発動効果。例:オルレアホワイト・ドラゴン②) ----------------
  // 同一モンスターにつき効果は基本1つを想定し、共通のフラグ(onceEffectUsedThisTurn.ability)
  // で「このターン使用済みか」を管理する(startTurn()で毎ターン自動的にリセットされる)。
  canActivateAbility(playerId, instance) {
    const player = this.players[playerId];
    if (!player.board.includes(instance)) return false;
    const hook = EFFECTS[instance.defName]?.onActivate;
    if (!hook) return false;
    if (instance.onceEffectUsedThisTurn.ability) return false;
    return true;
  }

  activateAbility(playerId, instance, params = {}) {
    if (!this.canActivateAbility(playerId, instance)) throw new Error("この起動効果は今は使用できません");
    const player = this.players[playerId];
    const hook = EFFECTS[instance.defName]?.onActivate;
    hook({ game: this, player, opponent: this.players[this.opponentOf(playerId)], instance, params });
    instance.onceEffectUsedThisTurn.ability = true;
  }

  hasKeyword(instance, keyword) {
    return instance.baseKeywords.has(keyword) || instance.grantedKeywords.has(keyword);
  }

  // ---------------- 攻撃・戦闘 ----------------

  canAttack(playerId, instance) {
    if (instance.cannotAttack) return false;
    if (instance.hasAttackedThisTurn) return false;
    const sick = instance.summonedOnTurn === this.turnNumber;
    if (!sick) return true;
    if (this.hasKeyword(instance, KEYWORDS.SOKKOU)) return true;
    if (this.hasKeyword(instance, KEYWORDS.TOTSUGEKI)) return true;
    if (instance.attackRestrictionThisTurn === "monsterOnly") return true;
    return false;
  }

  // target: { type: 'player' } または { type: 'monster', instance }
  attack(playerId, attackerInstance, target) {
    if (!this.canAttack(playerId, attackerInstance)) throw new Error("このモンスターは攻撃できません");
    const player = this.players[playerId];
    const opponentId = this.opponentOf(playerId);
    const opponent = this.players[opponentId];

    const restrictedToMonsterOnly =
      (attackerInstance.summonedOnTurn === this.turnNumber &&
        !this.hasKeyword(attackerInstance, KEYWORDS.SOKKOU) &&
        (this.hasKeyword(attackerInstance, KEYWORDS.TOTSUGEKI) ||
          attackerInstance.attackRestrictionThisTurn === "monsterOnly"));

    const isFirstPlayerTurn1 = playerId === this.firstPlayerId && player.ownTurnCount === 1;

    const taunts = opponent.board.filter((m) => m && this.hasKeyword(m, KEYWORDS.CHOUHATSU));

    if (target.type === "player") {
      if (isFirstPlayerTurn1) throw new Error("先攻1ターン目はプレイヤーへ直接攻撃できません");
      if (restrictedToMonsterOnly) throw new Error("このターンはモンスターへの攻撃のみ可能です");
      if (taunts.length > 0) throw new Error("挑発持ちがいるため直接攻撃できません");

      const kantsuu = this.hasKeyword(attackerInstance, KEYWORDS.KANTSUU);
      let dmg = attackerInstance.currentAtk;
      if (!kantsuu && opponent.shield > 0) {
        const absorbed = Math.min(opponent.shield, dmg);
        opponent.shield -= absorbed;
        dmg -= absorbed;
      }
      opponent.hp -= dmg;
      this.log(`${playerId}: 『${attackerInstance.defName}』がプレイヤーに直接攻撃(${dmg}ダメージ、残りシールド${opponent.shield})`);
      attackerInstance.hasAttackedThisTurn = true;
      if (this.hasKeyword(attackerInstance, KEYWORDS.ONMITSU)) this.removeStealthOnAttack(attackerInstance);
      this.checkWinCondition();
      return;
    }

    // モンスターへの攻撃
    const defender = target.instance;
    if (this.hasKeyword(defender, KEYWORDS.ONMITSU) && !this.hasKeyword(defender, KEYWORDS.CHOUHATSU)) {
      throw new Error("隠密を持つモンスターは攻撃対象にできません");
    }
    if (taunts.length > 0 && !taunts.includes(defender)) {
      throw new Error("挑発持ちがいるため、そちらを攻撃しなければなりません");
    }

    this.resolveCombat(attackerInstance, defender, player, opponent);
    attackerInstance.hasAttackedThisTurn = true;
    if (this.hasKeyword(attackerInstance, KEYWORDS.ONMITSU)) this.removeStealthOnAttack(attackerInstance);

    // 「敵を破壊したとき、もう一度攻撃できる」系のフック(例: ドラゴニュート・キング)
    const stillAlive = player.board.includes(attackerInstance);
    const defenderDied = !opponent.board.includes(defender);
    if (stillAlive && defenderDied) {
      const hook = EFFECTS[attackerInstance.defName]?.onKillInCombat;
      if (hook) hook({ game: this, player, opponent, instance: attackerInstance });
    }
    // 防御側(攻撃された側)の隠密は解除されない(解除は「自身が攻撃した」場合のみ)
  }

  resolveCombat(attacker, defender, attackerPlayer, defenderPlayer) {
    const attackerInvuln = attacker.invulnerableThisTurn;
    const defenderInvuln = defender.invulnerableThisTurn;

    if (!defenderInvuln) defender.currentHp -= attacker.currentAtk;
    if (!attackerInvuln) attacker.currentHp -= defender.currentAtk;

    this.log(
      `戦闘: ${attacker.defName}(${attacker.currentAtk}/${attacker.currentHp}) vs ${defender.defName}(${defender.currentAtk}/${defender.currentHp})`
    );

    const attackerKakusatsu = this.hasKeyword(attacker, KEYWORDS.KAKUSATSU);
    const defenderKakusatsu = this.hasKeyword(defender, KEYWORDS.KAKUSATSU);

    let attackerDies = attacker.currentHp <= 0;
    let defenderDies = defender.currentHp <= 0;
    if (attackerKakusatsu && !defenderInvuln) defenderDies = true;
    if (defenderKakusatsu && !attackerInvuln) attackerDies = true;

    if (defenderDies) {
      this.sendToGraveyard(defenderPlayer, defender);
      if (attacker.race === "ドラゴン") this.dragonKilledThisTurnByCombat = true;
    }
    if (attackerDies) {
      this.sendToGraveyard(attackerPlayer, attacker);
      if (defender.race === "ドラゴン") this.dragonKilledThisTurnByCombat = true;
    }
  }

  // 「次のエンドフェイズに1回だけ」発動する効果を予約する。
  // 注意: これはクロージャをその場で積む方式のため、次のendTurn()が呼ばれる前に
  // オンライン対戦でhydrateGame()を挟む(相手のターンをまたぐ)ケースでは復元されず消える。
  // 同じターン内の遅延処理(例:攻撃直後のエンドフェイズ)のような用途に限定して使うこと。
  // 「超越したターン以降ずっと」のような複数ターンにまたがる継続効果には使わず、
  // instance.transcended 等のシリアライズされるフィールドを見るonOwnEndPhaseフックで実装すること
  // (ダリアバーミリオン・ドラゴン、デルフィニウムアズール・ドラゴンの実装を参照)。
  queueEndPhaseEffect(playerId, fn) {
    this.pendingEndPhaseEffects[playerId].push(fn);
  }

  // 攻撃を行うと隠密は解除される(このモンスター自身が攻撃した場合)
  removeStealthOnAttack(instance) {
    instance.grantedKeywords.delete(KEYWORDS.ONMITSU);
    instance.baseKeywords.delete(KEYWORDS.ONMITSU);
  }

  checkWinCondition() {
    for (const pid of ["p1", "p2"]) {
      if (this.players[pid].hp <= 0) {
        this.winner = this.opponentOf(pid);
        this.log(`${this.winner} の勝利!`);
      }
    }
  }

  // ---------------- イベントカード ----------------

  playEvent(playerId, handUid, params = {}) {
    const player = this.players[playerId];
    const idx = player.hand.findIndex((c) => c.uid === handUid);
    if (idx === -1) throw new Error("手札にありません");
    const { defName } = player.hand[idx];
    const def = CARD_DEFS[defName];
    if (!def) throw new Error(`未定義カード: ${defName}`);
    if (def.type !== "イベント") throw new Error("イベントカードではありません");
    if (player.resourceAvailable < def.cost) throw new Error("コストが足りません");

    const hook = EFFECTS[defName]?.onEvent;
    if (!hook) throw new Error(`${defName} のイベント効果が未実装です`);

    const opponent = this.players[this.opponentOf(playerId)];
    // 発動条件・追加コストのチェックは各効果側で行い、満たさなければ例外を投げる
    hook({ game: this, player, opponent, params });

    player.resourceAvailable -= def.cost;
    player.hand.splice(idx, 1);
    player.graveyard.push(defName);
    this.log(`${playerId}: イベント『${defName}』を発動`);
  }

  // ---------------- 汎用ヘルパー(効果登録で使い回す) ----------------

  dealDamageToMonster(defenderPlayer, instance, amount) {
    if (instance.invulnerableThisTurn) return;
    instance.currentHp -= amount;
    if (instance.currentHp <= 0) this.sendToGraveyard(defenderPlayer, instance);
  }

  dealDamageToAllEnemyMonsters(opponent, amount) {
    for (const m of [...opponent.board]) {
      if (m) this.dealDamageToMonster(opponent, m, amount);
    }
  }

  destroyMonster(ownerPlayer, instance) {
    if (instance.invulnerableThisTurn) return;
    this.sendToGraveyard(ownerPlayer, instance);
  }

  healPlayer(player, amount) {
    player.hp = Math.min(player.hp + amount, CONFIG.MAX_HP);
    this.log(`${player.id}: 体力が${amount}回復(現在${player.hp})`);
  }

  buffOwnRace(player, race, atkDelta, hpDelta) {
    for (const m of player.board) {
      if (m && m.race === race) {
        m.currentAtk += atkDelta;
        m.currentHp += hpDelta;
      }
    }
  }

  grantKeywordToOwnRaces(player, races, keyword) {
    for (const m of player.board) {
      if (m && races.includes(m.race)) m.grantedKeywords.add(keyword);
    }
  }
}
