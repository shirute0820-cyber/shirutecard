import { KEYWORDS, CONFIG, CARD_TYPES } from "./constants.js";
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
    // イベントゾーン(1枠)。「持続イベント」カード(破壊されない限り効果を発動し続ける、
    // 通常のイベントとは別のカード種別)のdefNameのみを保持する。常に0〜1枚。
    // 通常のイベントカードはここを経由せず、発動後すぐgraveyardへ送られる。
    eventZone: null,
    hp: CONFIG.START_HP,
    shield: 0,
    ownTurnCount: 0,
    resourceCap: 0,
    resourceAvailable: 0,
    transcendCooldownUntilOwnTurn: 0, // 自分の「自ターン数」基準でのクールダウン(グローバル/ラウンドとは無関係)
    // 後攻補正②(2026/08/14変更): 追加ドロー2回制から、エクストラコスト2回制に変更。
    // 「そのターンだけ使えるコストを1回復する(ターン上限は超えない)」権利を、合計2回・1ターンに1回まで使える
    secondPlayerBonusCostRemaining: 2,
    secondPlayerBonusCostUsedThisTurn: false,
    // 神の啓示: デッキの一番上に置いたカードが「次の自ターン」にドローされた場合のみ
    // コスト減少を適用するための予約情報。{defName, ownTurnCount, amount} | null
    // ドローされないままそのターンが終わると消滅する(endTurn()で破棄)。
    pendingCostReduction: null,
    poison: 0, // 毒の合計値(2026/08/16トリッカーテーマ追加)
    // ドクター・ベアトラップ①で「毒化」された自分の盤面スロット番号の集合。
    // 解除条件はなく永続(ゲーム終了まで)。ここに含まれるスロットに新たにモンスターが
    // 召喚される(手札から/特殊召喚問わず)たび、そのモンスターへ毒8を自動付与する
    poisonedSlots: new Set(),
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
    // ログ本文(相手クライアントにも表示できるよう、シリアライズ対象として永続化する)。
    // this.log() は外部から渡されたコールバック(画面への即時追記など)を呼びつつ、
    // 同じ内容をlogEntriesにも積む。hydrateGame()側でlogEntriesをスナップショットの
    // 内容へ丸ごと差し替えれば、以後この関数が積む続きの分も自然につながる。
    this.logEntries = [];
    const externalLog = log;
    this.log = (msg) => {
      this.logEntries.push({
        id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        msg,
        ts: Date.now(),
      });
      externalLog(msg);
    };
    this.winner = null;
    this.dragonKilledThisTurnByCombat = false; // 竜餐の祭日などが参照する簡易フラグ
    this.pendingEndPhaseEffects = { p1: [], p2: [] }; // 超越などによる「次のエンドフェイズに1回だけ」の遅延効果
    // 注: 「超越したターンから継続的に毎エンドフェイズ発動する」効果(ダリアバーミリオン・ドラゴン等)は、
    // クロージャをキューに積む方式だとFirebase同期時のhydrateGame()で復元できず消えてしまうため、
    // instance.transcended(シリアライズ対象の通常フィールド)を見るonOwnEndPhaseフックとして
    // effectRegistry.js側に実装している(pendingEndPhaseEffectsのような専用の永続キューは持たない)。
    this.pendingNextPlayerId = null; // endTurn()後、次のプレイヤーがstartTurn()を呼ぶまでの待機状態

    // UI側の演出・効果音のためのイベントキュー。GameStateはDOMやサウンドについて
    // 一切知らないままにしておきたいので、「何が起きたか」だけをここに積んでおき、
    // UI側がrender()の直後にこの配列を読み取って演出を出し、読み終わったら空にする。
    // (シリアライズ対象には含めない。オンライン対戦の相手クライアント側では、
    //  hydrateGame()直後は空配列になるだけで問題ない)
    this.uiEvents = [];
  }

  // UIイベントを1件積む(内部ヘルパー)
  emitUiEvent(evt) {
    this.uiEvents.push(evt);
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
    player.secondPlayerBonusCostUsedThisTurn = false;

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
        m.usedDoubleAttackThisTurn = false; // 天啓の聖女ジャンヌ・ダルク《超越》の2回攻撃用
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

    // 毒によるダメージ処理(トリッカーテーマ、2026/08/16追加)。
    // シールドのスナップショット計算が終わった直後に行う(毒ダメージはシールドを貫通しないため、
    // この時点でシールドが確定していないと正しく消費できない)。
    // 対象は「このプレイヤー自身のターン終了時」に限り、自分の場のモンスターとプレイヤー自身。
    for (const m of [...player.board]) {
      if (m) this.processPoisonTick(player, m);
    }
    this.processPoisonTick(player, player);

    // ドクター・ポイズン②: このカードが自分の場にいる間は、自分のエンドフェイズ時に
    // 敵の場のモンスターも(本来対象外のはずが)例外的に毒ダメージ処理を受ける
    if (player.board.some((m) => m && m.defName === "ドクター・ポイズン")) {
      const opp = this.players[this.opponentOf(player.id)];
      for (const m of [...opp.board]) {
        if (m) this.processPoisonTick(opp, m);
      }
    }

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
      // 超越の無敵は「超越を使った自分のターン中」だけの効果。
      // 以前はstartTurn()側(=このプレイヤーの次の自ターン開始時)でしか解除されなかったため、
      // 相手の1ターン分(=相手のonOwnEndPhase等)にまで無敵が持ち越されてしまうバグがあった
      // (例: 6ターン目に超越→そのターンは無敵で正しいが、次の相手ターンの終了時効果
      //  (オルレアホワイト・ドラゴン等)まで無敵が効いてしまい、本来発動するはずの破壊が
      //  素通りしてしまっていた)。自分のターン終了時点でここで確実に解除する。
      m.invulnerableThisTurn = false;
    }

    // 神の啓示: 対象カードが「次の自ターン」にドローされないままターンが終わった場合、
    // 予約情報を破棄する(効果消滅)。ドローされていた場合はpendingCostReductionは
    // 既にdrawOne()側でnullになっている。
    if (player.pendingCostReduction && player.pendingCostReduction.ownTurnCount === player.ownTurnCount) {
      player.pendingCostReduction = null;
    }
    // 神の啓示のコスト減少は「次のターン」限定のため、そのターンのうちに使われなければ
    // ターン終了時点で手札上のタグも失効させる
    for (const c of player.hand) {
      if (c.costReduction) c.costReduction = 0;
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
      if (player.storage.length === 0) {
        this.log(`${player.id}: デッキ・ストレージがどちらも0枚のため引けません`);
        this.checkWinCondition();
        return false; // 引けるカードなし
      }
      player.deck = shuffle(player.storage);
      player.storage = [];
      this.log(`${player.id}: デッキが尽きたためストレージがデッキに戻った`);
    }
    const defName = player.deck.pop();
    const handCard = { uid: genUid(), defName, hold: false };
    // 神の啓示: 予約されたカードをちょうどこのタイミング(対象の自ターン)で引いた場合のみ、
    // コスト減少タグを付与する(それ以外のタイミングで同名カードを引いても対象外)
    const pending = player.pendingCostReduction;
    if (pending && pending.defName === defName && pending.ownTurnCount === player.ownTurnCount) {
      handCard.costReduction = pending.amount;
      player.pendingCostReduction = null;
      this.log(`${player.id}: 『${defName}』をドロー(このターンのみコスト-${handCard.costReduction})`);
    }
    player.hand.push(handCard);
    this.emitUiEvent({ type: "draw", playerId: player.id });

    // ドクター・ポイズン③等、「自プレイヤーがカードをドローするたび」系のフック。
    // このカードの持ち主自身が引いたときにのみ発火する(相手の場にいる場合は発火しない)
    const opponent = this.players[this.opponentOf(player.id)];
    for (const m of player.board) {
      if (!m) continue;
      const hook = EFFECTS[m.defName]?.onDrawCard;
      if (hook) hook({ game: this, player, opponent, instance: m });
    }
    return true;
  }

  // 後攻補正②：対戦中合計2回まで、そのターンだけ使えるコストを1回復できる。
  // ただし同じターンに2回はできない(別のターンで1回ずつ)。ターンのコスト上限は超えない
  // (2026/08/14変更: 追加ドロー2回制から、エクストラコスト2回制に変更)
  useSecondPlayerBonusCost(playerId) {
    if (playerId !== this.secondPlayerId) throw new Error("先攻はこの権利を持たない");
    const player = this.players[playerId];
    if (player.secondPlayerBonusCostRemaining <= 0) throw new Error("エクストラコストの権利を使い切っています");
    if (player.secondPlayerBonusCostUsedThisTurn) throw new Error("このターンは既に使用しています(別のターンで使ってください)");
    player.secondPlayerBonusCostRemaining -= 1;
    player.secondPlayerBonusCostUsedThisTurn = true;
    player.resourceAvailable = Math.min(player.resourceAvailable + 1, player.resourceCap);
    this.log(
      `${playerId}: 後攻補正のエクストラコストを使用(残り${player.secondPlayerBonusCostRemaining}回) 使えるコスト${player.resourceAvailable}/${player.resourceCap}`
    );
  }

  // ---------------- 召喚 ----------------

  summonFromHand(playerId, handUid, boardSlot, params = {}) {
    const player = this.players[playerId];
    const idx0 = player.hand.findIndex((c) => c.uid === handUid);
    if (idx0 === -1) throw new Error("手札にありません");
    const handEntry = player.hand[idx0];
    const { defName } = handEntry;
    const def = CARD_DEFS[defName];
    if (!def) throw new Error(`未定義カード: ${defName}`);
    if (def.type !== "モンスター") throw new Error("モンスターカードではありません");

    const targetSlot = boardSlot;
    // sacrificeRequirement(異端審問官コーション等): 通常のコストに加えて、
    // 指定した名前のカードを自分の場・手札から墓地へ送ることを追加コストとして要求する召喚方法。
    // 2026/08/14改訂: 以前は「特殊召喚」として通常コストごと免除していたが、これは不具合で、
    // 正しくは通常コストを支払った上での追加コストだったため修正済み(リリース召喚と同じ扱い)
    const isSacrificeSummon = !!def.sacrificeRequirement;
    const cost = this.getEffectiveHandCost(player, handEntry, def); // 神の啓示・竜の里等によるコスト減少を反映

    if (player.resourceAvailable < cost) {
      throw new Error("コストが足りません");
    }

    // リリース召喚でリリースしたモンスターの情報(超越済みだったか等)を、後段のonSummonフックへ
    // 引き継ぐための一時変数(ダリアバーミリオン・ドラゴン等の「リリース元が超越していたら
    // このカードも超越する」を判定するために使用)
    let releasedInstance = null;

    if (def.releaseRequirement) {
      // リリース召喚: どのモンスターをリリースするかは、必ず呼び出し側(UI)が
      // 盤面枠を選んだ上で指定すること(誤操作防止のため、自動選択はしない)
      if (targetSlot === null || targetSlot === undefined) {
        throw new Error(`『${def.releaseRequirement}』がいる枠を選んでください`);
      }
      const releaseTarget = player.board[targetSlot];
      if (!releaseTarget || releaseTarget.defName !== def.releaseRequirement) {
        throw new Error(`『${def.releaseRequirement}』がいる枠を選んでください`);
      }
      releasedInstance = releaseTarget;
      this.sendToGraveyard(player, releaseTarget);
      // リリースしたモンスターがいた枠に、そのまま新しいモンスターを置く(targetSlotは変更不要)
    } else if (isSacrificeSummon) {
      if (targetSlot === null || targetSlot === undefined || player.board[targetSlot]) {
        throw new Error("空いている盤面枠を選んでください");
      }
      const source = params.sacrificeSource; // {from:'board', instance} | {from:'hand', handUid}
      if (!source) throw new Error(`『${def.sacrificeRequirement}』を場または手札から選んでください`);
      if (source.from === "board") {
        const inst = source.instance;
        if (!inst || inst.defName !== def.sacrificeRequirement || !player.board.includes(inst)) {
          throw new Error(`『${def.sacrificeRequirement}』がいる場のカードを選んでください`);
        }
        this.sendToGraveyard(player, inst);
      } else if (source.from === "hand") {
        const c = player.hand.find((h) => h.uid === source.handUid && h.uid !== handUid);
        if (!c || c.defName !== def.sacrificeRequirement) {
          throw new Error(`手札の『${def.sacrificeRequirement}』を選んでください`);
        }
        player.hand.splice(player.hand.indexOf(c), 1);
        player.graveyard.push(c.defName);
      } else {
        throw new Error("送る対象の場所を指定してください");
      }
    } else if (player.board[targetSlot]) {
      throw new Error("その盤面枠は空いていません");
    }

    player.resourceAvailable -= cost;

    // sacrificeSummon側でhand配列が変化している可能性があるため、
    // 自分自身(このカード)のインデックスは改めて探し直す
    const finalIdx = player.hand.findIndex((c) => c.uid === handUid);
    player.hand.splice(finalIdx, 1);

    const instance = createCardInstance(defName, playerId, genUid());
    // 召喚酔いの判定基準は「グローバルターン数」ではなく、このモンスターの所有者自身の
    // 自ターン数(ownTurnCount)を使う(2026/08/21修正、詳細はcanAttack()のコメント参照)
    instance.summonedOnTurn = player.ownTurnCount;
    player.board[targetSlot] = instance;

    this.log(`${playerId}: 『${defName}』を召喚(${targetSlot}枠)`);
    this.emitUiEvent({ type: "summon", playerId, slot: targetSlot, defName });
    this.applyZoneSummonBuff(player, instance);
    this.applyPoisonedSlotEntry(player, instance, targetSlot);
    this.applyBoardAllySummonHooks(player, instance);

    const hook = EFFECTS[defName]?.onSummon;
    if (hook) hook({ game: this, player, opponent: this.players[this.opponentOf(playerId)], instance, params: { ...params, releasedInstance } });

    return instance;
  }

  // 竜の里のような「イベントゾーンにいる間、場に出たドラゴン・亜竜種に+4/+4」系の
  // 常時効果を、召喚経路(手札から/特殊召喚)を問わず一箇所で適用するための共通ヘルパー
  applyZoneSummonBuff(player, instance) {
    if (!player.eventZone) return;
    const hook = EFFECTS[player.eventZone]?.onZoneSummon;
    if (hook) hook({ game: this, player, instance });
  }

  // カード効果によるデッキ外からの特殊召喚(トークン的生成、在庫を消費しない)
  specialSummonToken(playerId, defName, boardSlot, { grantedKeywords = [] } = {}) {
    const player = this.players[playerId];
    if (player.board[boardSlot]) throw new Error("その盤面枠は空いていません");
    const instance = createCardInstance(defName, playerId, genUid());
    // 2026/08/21修正: グローバルターン数(turnNumber)は先攻・後攻で共有されるカウンタの
    // ため、「相手が自分のモンスターを戦闘で破壊し、その結果として自分の場に特殊召喚される」
    // ケース(例:ヒュドラ―の分頭)で、召喚された瞬間はまだ相手のターン中でturnNumberが
    // 据え置きのまま、その後に迎える「自分の」ターンでもturnNumberが変わらないため、
    // 本来2ターン目のはずなのに召喚酔い判定(sick)が誤って継続し、攻撃できなくなる
    // 不具合があった。所有者自身の自ターン数(ownTurnCount)基準に変更することで、
    // 相手ターン中に特殊召喚されても、次に迎える自分のターンには正しく酔いが解ける
    instance.summonedOnTurn = player.ownTurnCount;
    for (const k of grantedKeywords) instance.grantedKeywords.add(k);
    player.board[boardSlot] = instance;
    this.log(`${playerId}: 『${defName}』を特殊召喚(デッキ外生成, ${boardSlot}枠)`);
    this.emitUiEvent({ type: "summon", playerId, slot: boardSlot, defName });
    this.applyZoneSummonBuff(player, instance);
    this.applyPoisonedSlotEntry(player, instance, boardSlot);
    this.applyBoardAllySummonHooks(player, instance);
    return instance;
  }

  // ドクター・ベアトラップ①: 「毒化」された自分の盤面スロットに新たにモンスターが
  // 召喚された場合(手札から/特殊召喚問わず)、そのモンスターへ毒8を自動付与する
  applyPoisonedSlotEntry(player, instance, slot) {
    if (player.poisonedSlots && player.poisonedSlots.has(slot)) {
      this.applyPoisonToMonster(player, instance, 8);
    }
  }

  // 「自分の場に新しいモンスターが召喚されるたび」に発火する汎用フック。
  // 竜の里(イベントゾーン専用のonZoneSummon)とは別に、盤面上の特定モンスターが持つ
  // 「自分が場にいる限り、新しく召喚された味方◯◯は+△/+□される」系の常時効果用
  // (2026/08/16タランチュラ・クイーン等で追加)。召喚されたモンスター自身には発火しない
  applyBoardAllySummonHooks(player, newInstance) {
    for (const m of player.board) {
      if (!m || m === newInstance) continue;
      const hook = EFFECTS[m.defName]?.onAllySummon;
      if (hook) hook({ game: this, player, instance: m, newInstance });
    }
  }

  findEmptySlot(player) {
    return player.board.findIndex((m) => m === null);
  }

  // ---------------- 破壊・死亡処理 ----------------

  sendToGraveyard(player, instance) {
    this._removeFromBoardToGraveyard(player, instance);
    this._maybeResetShieldOnEmptyBoard(player);
    this._triggerLeaveFieldHook(player, instance);
  }

  // sendToGraveyard()を3段階に分けた内部ヘルパー(2026/08/21新設)。
  // コーションのような「複数体を同時に破壊する」効果で、1体ずつ処理すると
  // 起きていた2つの不具合に対応するため:
  //  ①後続の破壊対象がまだ場に残っている間に、先に破壊された1体の離脱時効果
  //   (例:ヒュドラ―の分頭の特殊召喚)が発動してしまい、本来空くはずの枠を
  //   使い切ってしまう(結果、特殊召喚できる体数が減ってしまう)
  //  ②同様の理由で、全体が破壊しきる前に離脱時効果が場を埋め戻してしまい、
  //   「場が0体になった瞬間」が一度も訪れず、シールドがリセットされない
  // これを避けるため、sendManyToGraveyard()では「全員を場から除去→シールド確定
  // →離脱時効果をまとめて発火」の順で処理する
  _removeFromBoardToGraveyard(player, instance) {
    const slot = player.board.indexOf(instance);
    if (slot !== -1) player.board[slot] = null;
    player.graveyard.push(instance.defName);
    this.log(`${player.id}: 『${instance.defName}』が場を離れた(墓地へ)`);
    this.emitUiEvent({ type: "destroy", ownerId: player.id, slot, defName: instance.defName });
  }

  _maybeResetShieldOnEmptyBoard(player) {
    // 場のモンスターが0体になったらシールドは0にリセットする。
    // 以前は「相手ターン中のみ」に限定していたが、自分のターン終了処理では
    // シールドのスナップショット計算(場のHP合計/2を加算)の直後に毒ダメージ処理が
    // 走るため、そこで自分の場が全滅した場合にリセットされない不具合があった
    // (2026/08/21修正)。自分のターン開始時点でシールドは既に0にリセットされている
    // (startTurn側)ため、この条件を外しても自ターン中の挙動には影響しない
    const aliveCount = player.board.filter(Boolean).length;
    if (aliveCount === 0 && player.shield > 0) {
      player.shield = 0;
      this.log(`${player.id}: 場のモンスターが0体になったためシールドをリセット`);
    }
  }

  _triggerLeaveFieldHook(player, instance) {
    // 連動破壊などのフック(例: ゴ・ド・リックの右腕)。opponent は2026/08/16追加
    // (ドクター・ベアトラップ②「場に存在するモンスターすべて」のように、
    //  自分の場だけでなく相手の場も参照するカードに対応するため)
    const hook = EFFECTS[instance.defName]?.onLeaveField;
    if (hook) hook({ game: this, player, opponent: this.players[this.opponentOf(player.id)], instance });
  }

  // 複数体をまとめて破壊する(コーション等、無敵・免疫チェック済みの対象を渡すこと)。
  // 上記_removeFromBoardToGraveyard等のコメント参照
  sendManyToGraveyard(player, instances) {
    for (const instance of instances) this._removeFromBoardToGraveyard(player, instance);
    this._maybeResetShieldOnEmptyBoard(player);
    for (const instance of instances) this._triggerLeaveFieldHook(player, instance);
  }

  // ---------------- 超越 ----------------

  // 超越が解禁されるグローバルターン数(2026/08/14変更: 「4ターン目以降」から
  // 「4ターン目の後攻から」に変更)。
  // ターン数は先攻の行動開始時にのみ進むため、turnNumber=4の期間は必ず
  // 「先攻の4ターン目→後攻の4ターン目」の順で訪れる。後攻はturnNumber=4の
  // 時点(=自分の4ターン目)でそのまま解禁でよいが、先攻はまだ後攻の4ターン目が
  // 来ていないため、先攻側だけ閾値を+1(=5ターン目から)にすることで、
  // 結果的に「後攻の4ターン目以降」だけが解禁されるようにする。
  transcendMinTurnFor(playerId) {
    return playerId === this.secondPlayerId ? CONFIG.TRANSCEND_MIN_TURN : CONFIG.TRANSCEND_MIN_TURN + 1;
  }

  canTranscend(playerId, instance) {
    if (this.turnNumber < this.transcendMinTurnFor(playerId)) return false;
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
    const turnGate = Math.max(0, this.transcendMinTurnFor(playerId) - this.turnNumber);
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
    const turnGate = Math.max(0, this.transcendMinTurnFor(playerId) - this.turnNumber);
    const cooldownGate = Math.max(0, player.transcendCooldownUntilOwnTurn - player.ownTurnCount);
    const turnsLeft = Math.max(turnGate, cooldownGate);
    return { available: turnsLeft === 0, turnsLeft };
  }

  // 超越の共通処理(ステータス増加・無敵付与・召喚酔い中の突撃状態付与・onTranscendフック)。
  // useTranscend(プレイヤーが能動的に使用)とforceTranscend(カード効果による自動発動)の
  // 両方から呼ばれる。呼び出し側でクールダウンの確認・消費だけ分けて行う。
  applyTranscendEffect(playerId, instance, params) {
    const player = this.players[playerId];
    // カードによっては(天啓の聖女ジャンヌ・ダルク等)、通常の「ターン数×2(最大20)」という
    // 増加量を、固定値に置き換えて定義できる(EFFECTS[...].transcendStatBonus)
    const overrideBonus = EFFECTS[instance.defName]?.transcendStatBonus;
    const bonus = overrideBonus !== undefined ? overrideBonus : Math.min(this.turnNumber * 2, CONFIG.TRANSCEND_MAX_BONUS);
    instance.currentAtk += bonus;
    instance.currentHp += bonus;
    instance.transcended = true;
    instance.invulnerableThisTurn = true;

    // 召喚酔い中なら「突撃」状態を一時付与(モンスターへの攻撃のみ、そのターン限り)
    if (instance.summonedOnTurn === player.ownTurnCount && !this.hasKeyword(instance, KEYWORDS.SOKKOU)) {
      instance.attackRestrictionThisTurn = "monsterOnly";
    }

    this.log(`${playerId}: 『${instance.defName}』が超越(+${bonus}/+${bonus})`);

    const hook = EFFECTS[instance.defName]?.onTranscend;
    if (hook) hook({ game: this, player, opponent: this.players[this.opponentOf(playerId)], instance, params });
  }

  useTranscend(playerId, instance, params = {}) {
    if (!this.canTranscend(playerId, instance)) throw new Error("超越を使用できません");
    const player = this.players[playerId];
    this.applyTranscendEffect(playerId, instance, params);
    player.transcendCooldownUntilOwnTurn = player.ownTurnCount + CONFIG.TRANSCEND_COOLDOWN;
  }

  // カード効果による自動的な超越(例:聖旗)。2026/08/08付ルールにより、プレイヤーが
  // 能動的に使う通常の超越とは別扱いとし、「1体につき1回」の制限だけを守り、
  // プレイヤー単位の「3ターンクールダウン」は消費しない(確認・更新しない)。
  forceTranscend(playerId, instance, params = {}) {
    if (instance.transcended) return; // 1体につき1回の制限は自動超越でも適用される
    this.applyTranscendEffect(playerId, instance, params);
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

  // conditionalKeyword: 死神(「相手の場にモンスターがいないとき【速攻】」)のような、
  // 固定付与ではなく参照するたびに条件を再評価するキーワード用のフック
  hasKeyword(instance, keyword) {
    if (instance.baseKeywords.has(keyword) || instance.grantedKeywords.has(keyword)) return true;
    const hook = EFFECTS[instance.defName]?.conditionalKeyword;
    if (!hook) return false;
    const player = this.players[instance.ownerId];
    const opponent = this.players[this.opponentOf(instance.ownerId)];
    const extra = hook({ game: this, player, opponent, instance }) || [];
    return extra.includes(keyword);
  }

  // ---------------- 攻撃・戦闘 ----------------

  canAttack(playerId, instance) {
    if (instance.cannotAttack) return false;
    if (instance.hasAttackedThisTurn) return false;
    if (this.isAttackBlockedByPoison(playerId, instance)) return false;
    // 召喚酔いの判定は、共有のグローバルターン数(turnNumber)ではなく、このモンスターの
    // 所有者(playerId)自身の自ターン数(ownTurnCount)で行う(2026/08/21修正)。
    // turnNumberは先攻・後攻で共有される値のため、例えば「相手ターン中に相手の攻撃で
    // 自分のモンスターが破壊され、その結果このカードが自分の場に特殊召喚された」場合、
    // turnNumber基準だと次に迎える自分のターンでもまだ同じturnNumberのままとなり、
    // 本来は酔いが解けているはずなのに攻撃できない不具合があった(ヒュドラ―の分頭で確認)
    const sick = instance.summonedOnTurn === this.players[playerId].ownTurnCount;
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
      (attackerInstance.summonedOnTurn === player.ownTurnCount &&
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
      let dmg = this.getEffectiveAtk(player, attackerInstance);
      if (!kantsuu && opponent.shield > 0) {
        const absorbed = Math.min(opponent.shield, dmg);
        opponent.shield -= absorbed;
        dmg -= absorbed;
      }
      // 毒の探究者ゴゴ①: 直接攻撃してもプレイヤーのHPは減らせない(シールドは通常通り減らせる。
      // 上のシールド消費計算は既に済んでいるので、ここではHP減少のみをスキップする)
      const blocksDirectDamage = !!EFFECTS[attackerInstance.defName]?.blocksDirectPlayerDamage;
      if (!blocksDirectDamage) opponent.hp -= dmg;
      this.log(`${playerId}: 『${attackerInstance.defName}』がプレイヤーに直接攻撃(${dmg}ダメージ、残りシールド${opponent.shield})`);
      this.emitUiEvent({ type: "damagePlayer", playerId: opponent.id, amount: blocksDirectDamage ? 0 : dmg });
      attackerInstance.hasAttackedThisTurn = true;
      if (this.hasKeyword(attackerInstance, KEYWORDS.ONMITSU)) this.removeStealthOnAttack(attackerInstance);
      this.afterAttack(player, opponent, attackerInstance, "player");
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
    this.afterAttack(player, opponent, attackerInstance, "monster");

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
    // 【確殺】は「交戦した相手をステータス無視で破壊する」効果のため、この交戦の結果は
    // 確殺の判定(下記attackerKakusatsu/defenderKakusatsu)で確定するべきところ、通常の
    // ダメージ計算より前に発動する交戦時トリガー(ドクター・イミュニティ等の毒による
    // 即時ダメージ)がこの時点で確殺持ちを直接破壊してしまうと、確殺自体の判定に
    // 一切たどり着けなくなってしまう不具合があった(2026/08/21修正)。
    // 交戦時トリガーの実行中だけ、確殺持ちをdealDamageToMonster()による破壊から保護する
    // (通常のステータスによる打ち合い自体からは保護しない。確殺は「一方的に相手を破壊する」
    // 効果であって「自分が破壊されない」効果ではないため、下記の通常ダメージ計算・
    // attackerDies/defenderDiesの判定は従来通り)
    attacker._kakusatsuCombatShield = this.hasKeyword(attacker, KEYWORDS.KAKUSATSU);
    defender._kakusatsuCombatShield = this.hasKeyword(defender, KEYWORDS.KAKUSATSU);

    // 毒関連の「交戦時」フック(ドクトゲガエル・デカめのサソリ・ヒュドラ―の分頭・
    // ドクター・イミュニティ等)。通常のダメージ計算より前に実行し、攻撃側・防御側
    // どちらの立場でも交戦したことになる双方に対して発火する
    this.triggerOnCombat(attacker, attackerPlayer, defender, defenderPlayer);
    this.triggerOnCombat(defender, defenderPlayer, attacker, attackerPlayer);

    delete attacker._kakusatsuCombatShield;
    delete defender._kakusatsuCombatShield;

    const attackerInvuln = attacker.invulnerableThisTurn;
    const defenderInvuln = defender.invulnerableThisTurn;

    // 攻撃力はオーラ等(天啓の聖女ジャンヌ・ダルク、忠義の騎士ジル・ド・レェ等)を
    // 反映した「その瞬間の実効値」で計算する
    const attackerAtk = this.getEffectiveAtk(attackerPlayer, attacker);
    const defenderAtk = this.getEffectiveAtk(defenderPlayer, defender);

    if (!defenderInvuln) defender.currentHp -= attackerAtk;
    if (!attackerInvuln) attacker.currentHp -= defenderAtk;

    this.log(
      `戦闘: ${attacker.defName}(${attackerAtk}/${attacker.currentHp}) vs ${defender.defName}(${defenderAtk}/${defender.currentHp})`
    );

    const attackerKakusatsu = this.hasKeyword(attacker, KEYWORDS.KAKUSATSU);
    const defenderKakusatsu = this.hasKeyword(defender, KEYWORDS.KAKUSATSU);

    let attackerDies = attacker.currentHp <= 0;
    let defenderDies = defender.currentHp <= 0;
    if (attackerKakusatsu && !defenderInvuln) defenderDies = true;
    if (defenderKakusatsu && !attackerInvuln) attackerDies = true;

    if (defenderDies) {
      if (this.checkZoneCombatSave(defenderPlayer, defender)) {
        // 竜の里③等: 破壊が無効化された場合、不自然にHPがマイナスのまま残らないよう1に補正する
        defender.currentHp = 1;
      } else {
        this.sendToGraveyard(defenderPlayer, defender);
        if (attacker.race === "ドラゴン") this.dragonKilledThisTurnByCombat = true;
      }
    }
    if (attackerDies) {
      if (this.checkZoneCombatSave(attackerPlayer, attacker)) {
        attacker.currentHp = 1;
      } else {
        this.sendToGraveyard(attackerPlayer, attacker);
        if (defender.race === "ドラゴン") this.dragonKilledThisTurnByCombat = true;
      }
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

  // 「このモンスターが攻撃を行った直後」に呼ばれる汎用フック。
  // 例: 天啓の聖女ジャンヌ・ダルクの《超越》「1ターンに2回攻撃できる」は、
  // 1回目の攻撃直後にhasAttackedThisTurnを1度だけ再度falseへ戻すことで実現する
  // (ドラゴニュート・キングの「敵を破壊したらもう一度攻撃できる」と同じ考え方の汎用化)。
  // targetType: 'player' | 'monster'(2026/08/16追加。直接攻撃かどうかで挙動を分けるカード用。
  // 例: ミニタランチュラ・毒の探究者ゴゴは「相手プレイヤーに直接攻撃したとき」限定の効果を持つ)
  afterAttack(player, opponent, instance, targetType) {
    const hook = EFFECTS[instance.defName]?.onAfterAttack;
    if (hook) hook({ game: this, player, opponent, instance, targetType });
  }

  // 「交戦時」(このモンスターが攻撃側・防御側いずれかとして戦闘に参加したとき)に発火する
  // 汎用フック。resolveCombat()から、攻撃側・防御側の両方に対して呼ばれる
  // (2026/08/16トリッカーテーマ追加。ドクトゲガエル・デカめのサソリ・ヒュドラ―の分頭・
  //  ドクター・イミュニティ等が利用)
  triggerOnCombat(instance, ownerPlayer, enemyInstance, enemyPlayer) {
    const hook = EFFECTS[instance.defName]?.onCombat;
    if (hook) hook({ game: this, player: ownerPlayer, opponent: enemyPlayer, instance, enemyInstance });
  }

  checkWinCondition() {
    for (const pid of ["p1", "p2"]) {
      if (this.players[pid].hp <= 0) {
        this.winner = this.opponentOf(pid);
        this.log(`${this.winner} の勝利!(相手の体力が0)`);
        return;
      }
    }
    // デッキ・ストレージがどちらも0枚の状態でドローに失敗した場合の敗北条件(2026/08/14追加)。
    // drawOne()側で、両方が0でドローできなかった直後にこのメソッドを呼ぶことで判定する
    // (単に一時的にどちらも0枚になっただけでは負けにならず、実際にドローに失敗した瞬間のみ負けとする、
    //  一般的なTCGの「デッキ切れ」と同じ考え方)
    for (const pid of ["p1", "p2"]) {
      const p = this.players[pid];
      if (p.deck.length === 0 && p.storage.length === 0) {
        this.winner = this.opponentOf(pid);
        this.log(`${this.winner} の勝利!(相手のデッキ・ストレージが0枚)`);
        return;
      }
    }
  }

  // ---------------- イベントカード ----------------

  // イベントゾーンにある持続イベントカードを墓地へ送り、ゾーンを空ける。
  // 他カードの効果(将来的な「相手の持続イベントを破壊する」効果等)からも呼び出せるよう、
  // 汎用ヘルパーとして独立させている。ゾーンが元々空なら何もしない。
  // protectedInstance: このカードが場を離れる原因になった(=このカード自身の効果で今まさに
  // 救おうとしている)モンスターがあれば渡す。onZoneLeave側の巻き戻し処理で、そのインスタンスだけは
  // 巻き戻しによる「HPが尽きたら墓地へ送る」自動処理の対象から除外するために使う
  // (竜の里の③効果のように、戻す先から即座にまた破壊してしまうのを防ぐため)。
  destroyEventZoneCard(playerId, reason = "破壊された", protectedInstance = null) {
    const player = this.players[playerId];
    if (!player.eventZone) return;
    const defName = player.eventZone;
    const leaveHook = EFFECTS[defName]?.onZoneLeave;
    if (leaveHook) leaveHook({ game: this, player, protectedInstance });
    player.graveyard.push(defName);
    player.eventZone = null;
    this.emitUiEvent({ type: "eventZoneDestroy", ownerId: player.id, defName });
    this.log(`${player.id}: 持続イベント『${defName}』が${reason}(墓地へ)`);
  }

  // 手札のカードを実際に召喚/発動する際のコストを計算する。
  // 神の啓示によるそのカード固有の一時的なコスト減少(costReduction)に加え、
  // 竜の里のような「イベントゾーンにいる間、条件に合う手札のコストを下げ続ける」
  // 動的な減少もここでまとめて反映する(0未満にはならない)。
  getEffectiveHandCost(player, handEntry, def) {
    let cost = def.cost - (handEntry.costReduction || 0);
    if (player.eventZone) {
      const hook = EFFECTS[player.eventZone]?.zoneHandCostReduction;
      if (hook) cost -= hook({ game: this, player, def });
    }
    return Math.max(0, cost);
  }

  // 自分のイベントゾーンにいる持続イベントの効果で、このインスタンスの戦闘破壊を
  // 無効化できるかを確認し、できる場合はその場で発動する(例: 竜の里)。
  checkZoneCombatSave(player, instance) {
    if (!player.eventZone) return false;
    const hook = EFFECTS[player.eventZone]?.preventCombatDestruction;
    if (!hook) return false;
    return hook({ game: this, player, instance });
  }

  playEvent(playerId, handUid, params = {}) {
    const player = this.players[playerId];
    const idx = player.hand.findIndex((c) => c.uid === handUid);
    if (idx === -1) throw new Error("手札にありません");
    const handEntry = player.hand[idx];
    const { defName } = handEntry;
    const def = CARD_DEFS[defName];
    if (!def) throw new Error(`未定義カード: ${defName}`);
    const isPersistent = def.type === CARD_TYPES.PERSISTENT_EVENT;
    if (def.type !== CARD_TYPES.EVENT && !isPersistent) throw new Error("イベントカードではありません");
    const cost = this.getEffectiveHandCost(player, handEntry, def); // 神の啓示・竜の里等によるコスト減少を反映
    if (player.resourceAvailable < cost) throw new Error("コストが足りません");

    const hook = EFFECTS[defName]?.onEvent;
    // 通常イベントは即時効果が本体のため、実装(onEvent)が無ければ発動不可。
    // 持続イベントは「場に残り続けること」自体が効果になり得るため、
    // 設置と同時に発動する追加効果が無い(onEvent未定義の)カードも許容する。
    if (!hook && !isPersistent) throw new Error(`${defName} のイベント効果が未実装です`);

    const opponent = this.players[this.opponentOf(playerId)];
    // 発動条件・追加コストのチェックは各効果側で行い、満たさなければ例外を投げる
    hook?.({ game: this, player, opponent, params, selfHandUid: handUid });

    player.resourceAvailable -= cost;
    // onEventフック内で他の手札(ドラゴンの血誓・滝の試練・やり直し等)が先に取り除かれ、
    // 配列のインデックスがずれている可能性があるため、自分自身の位置は改めて探し直す
    // (summonFromHandの sacrificeSummon 処理と同じ考え方)。
    const finalIdx = player.hand.findIndex((c) => c.uid === handUid);
    if (finalIdx !== -1) player.hand.splice(finalIdx, 1);

    if (isPersistent) {
      // イベントゾーンには常に最大1枚まで。既に別の持続イベントがある場合は
      // 古い方を墓地へ送ってから、新しい方に置き換える。
      if (player.eventZone) this.destroyEventZoneCard(playerId, "新しい持続イベントに置き換えられ");
      player.eventZone = defName;
      // 設置と同時に発動する「場にいる間ずっと」系の常時効果(例: 竜の里の+4/+4)を、
      // 既に場にいる対象へ即座に適用する。
      const enterHook = EFFECTS[defName]?.onZoneEnter;
      if (enterHook) enterHook({ game: this, player });
      this.emitUiEvent({ type: "eventZoneSet", ownerId: playerId, defName });
      this.log(`${playerId}: 持続イベント『${defName}』をイベントゾーンに設置`);
    } else {
      player.graveyard.push(defName);
      this.log(`${playerId}: イベント『${defName}』を発動`);
    }
  }

  // ---------------- 攻撃力の実効値計算(オーラ対応) ----------------
  // 「基礎値(currentAtk。超越等の恒久バフ・ターン限定の一時バフは通常通りここに含まれる)
  //  ＋ その瞬間の盤面から都度計算するオーラ分」で実効攻撃力を返す。
  // オーラ源が場を離れた瞬間、次にこの関数を呼んだ時点で自動的に反映されるため、
  // バフの付与・除去処理をカード効果側で個別に追いかける必要がない。
  // - auraSelfAtk({game, player, instance}): 自分自身の状態(墓地枚数等)を参照する
  //   常時計算バフ(例: 忠義の騎士ジル・ド・レェ)
  // - auraGiveAtk({game, player, source, target}): 自分以外の場のモンスター全員に
  //   影響を与えるオーラ(例: 天啓の聖女ジャンヌ・ダルク)。targetは対象モンスター(常にsource以外)
  getEffectiveAtk(player, instance) {
    let atk = instance.currentAtk;
    const selfHook = EFFECTS[instance.defName]?.auraSelfAtk;
    if (selfHook) atk += selfHook({ game: this, player, instance });
    for (const other of player.board) {
      if (!other || other === instance) continue;
      const hook = EFFECTS[other.defName]?.auraGiveAtk;
      if (hook) atk += hook({ game: this, player, source: other, target: instance });
    }
    return atk;
  }

  // 忠義の騎士ジル・ド・レェの耐性(「自分の場に聖女がいるとき、戦闘以外のダメージを
  // 受けず、効果で破壊されない」)を、個々のカード効果を書き換えずに一箇所で適用するための
  // ガード。dealDamageToMonster/destroyMonsterの冒頭でチェックする(戦闘によるダメージ・破壊は
  // resolveCombat()がこの2関数を経由せず直接処理しているため、この耐性の対象に自然と含まれない)。
  isImmuneToEffectHarm(player, instance) {
    if (instance.defName !== "忠義の騎士ジル・ド・レェ") return false;
    return player.board.some((m) => m && CARD_DEFS[m.defName]?.race?.includes("聖女"));
  }

  // ---------------- 汎用ヘルパー(効果登録で使い回す) ----------------

  dealDamageToMonster(defenderPlayer, instance, amount) {
    if (instance.invulnerableThisTurn) return;
    if (this.isImmuneToEffectHarm(defenderPlayer, instance)) return;
    const slot = defenderPlayer.board.indexOf(instance);
    instance.currentHp -= amount;
    this.emitUiEvent({ type: "damageMonster", ownerId: defenderPlayer.id, slot, amount, defName: instance.defName });
    // 【確殺】保護中(resolveCombat()の交戦時トリガー実行中)は、このダメージで破壊されない。
    // 確殺自身の「ステータス無視で相手を破壊する」判定に必ずたどり着けるようにするための処置
    if (instance.currentHp <= 0 && !instance._kakusatsuCombatShield) this.sendToGraveyard(defenderPlayer, instance);
  }

  dealDamageToAllEnemyMonsters(opponent, amount) {
    for (const m of [...opponent.board]) {
      if (m) this.dealDamageToMonster(opponent, m, amount);
    }
  }

  destroyMonster(ownerPlayer, instance) {
    if (instance.invulnerableThisTurn) return;
    if (this.isImmuneToEffectHarm(ownerPlayer, instance)) return;
    this.sendToGraveyard(ownerPlayer, instance);
  }

  // destroyMonster()の複数体版(2026/08/21新設。コーション「相手の場にいるモンスターを
  // すべて破壊する」等が利用)。無敵・免疫チェックは個別に適用したうえで、実際に破壊できる
  // 対象だけをsendManyToGraveyard()でまとめて処理する(全体除去→シールド確定→離脱時効果、
  // という正しい順序で解決するため。詳細はsendManyToGraveyard()のコメント参照)。
  // 戻り値: 実際に破壊された(無敵・免疫で守られなかった)インスタンスの配列
  destroyMonsters(ownerPlayer, instances) {
    const targets = instances.filter(
      (instance) => !instance.invulnerableThisTurn && !this.isImmuneToEffectHarm(ownerPlayer, instance)
    );
    if (targets.length > 0) this.sendManyToGraveyard(ownerPlayer, targets);
    return targets;
  }

  healPlayer(player, amount) {
    player.hp = Math.min(player.hp + amount, CONFIG.MAX_HP);
    this.log(`${player.id}: 体力が${amount}回復(現在${player.hp})`);
    this.emitUiEvent({ type: "healPlayer", playerId: player.id, amount });
  }

  // イベント効果や超越の継続効果など、戦闘以外の直接プレイヤーへのダメージ用の共通ヘルパー。
  // こちらは「貫通」タイプで、シールドを無視して直接HPを削る
  dealDamageToPlayer(player, amount) {
    player.hp -= amount;
    this.log(`${player.id}: 直接${amount}ダメージ(残りHP${player.hp})`);
    this.emitUiEvent({ type: "damagePlayer", playerId: player.id, amount });
    this.checkWinCondition();
  }

  // カード効果によるプレイヤーへのダメージのうち、通常の直接攻撃・毒ダメージと同様に
  // シールドで防げるもの用の共通ヘルパー(2026/08/21新設)。dealDamageToPlayer()との違いは
  // シールドを無視するかどうかのみ。カードの意図に応じてどちらを使うか使い分けること
  // (火刑に処されし聖女の超越効果は、以前dealDamageToPlayer()でシールドを無視していたが、
  // 本来はシールドで防げる仕様のため、こちらに変更された)
  dealShieldableDamageToPlayer(player, amount) {
    let dmg = amount;
    if (player.shield > 0) {
      const absorbed = Math.min(player.shield, dmg);
      player.shield -= absorbed;
      dmg -= absorbed;
    }
    player.hp -= dmg;
    this.log(`${player.id}: 効果により${amount}ダメージ(シールド消費後の実ダメージ${dmg}、残りHP${player.hp})`);
    this.emitUiEvent({ type: "damagePlayer", playerId: player.id, amount: dmg });
    this.checkWinCondition();
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

  // ---------------- 毒(トリッカーテーマ、2026/08/16追加) ----------------

  // 毒の増減を一箇所で行うための共通ヘルパー。target.poison を直接書き換えず、
  // 必ずこの関数を経由すること。増減量(delta)をEFFECTS[...].onPoisonChangedへ
  // 通知するために必要(例: デカめのサソリ「毒の合計分体力が増加する」は、毒が
  // 増減するたびにcurrentHpを連動させる常時計算として実装している)。
  setPoisonAmount(ownerPlayer, target, newAmount) {
    const clamped = Math.max(0, newAmount);
    const delta = clamped - (target.poison || 0);
    target.poison = clamped;
    if (delta !== 0 && target.defName) {
      const hook = EFFECTS[target.defName]?.onPoisonChanged;
      if (hook) hook({ game: this, player: ownerPlayer, instance: target, delta });
    }
  }

  applyPoisonToMonster(ownerPlayer, instance, amount) {
    if (amount <= 0) return;
    this.setPoisonAmount(ownerPlayer, instance, (instance.poison || 0) + amount);
    this.log(`${ownerPlayer.id}: 『${instance.defName}』に毒${amount}を付与(合計${instance.poison})`);
    this.emitUiEvent({ type: "poisonApplied", ownerId: ownerPlayer.id, targetType: "monster", defName: instance.defName, amount });
  }

  applyPoisonToPlayer(player, amount) {
    if (amount <= 0) return;
    this.setPoisonAmount(player, player, (player.poison || 0) + amount);
    this.log(`${player.id}: 自身に毒${amount}を付与(合計${player.poison})`);
    this.emitUiEvent({ type: "poisonApplied", ownerId: player.id, targetType: "player", amount });
  }

  applyPoisonToAllEnemyMonsters(opponent, amount) {
    for (const m of [...opponent.board]) {
      if (m) this.applyPoisonToMonster(opponent, m, amount);
    }
  }

  // ポイズン・ラボが(自分・相手どちらの場でも)イベントゾーンに存在する限り、
  // 場に存在するモンスターに付与された毒は、ダメージを受けた後の自動減少(-4)が起こらなくなる
  isPoisonDecayDisabled() {
    return this.players.p1.eventZone === "ポイズン・ラボ" || this.players.p2.eventZone === "ポイズン・ラボ";
  }

  // 相手の場にドクター・ニューロトキシンがいる場合、毒が付与されている自分のモンスターは
  // 攻撃できない(ドクター・ニューロトキシンの静的効果。canAttack()から呼ばれる)
  isAttackBlockedByPoison(playerId, instance) {
    if (!(instance.poison > 0)) return false;
    const opponent = this.players[this.opponentOf(playerId)];
    return opponent.board.some((m) => m && m.defName === "ドクター・ニューロトキシン");
  }

  // エンドフェイズの毒ダメージ処理(1体/1人分)。呼び出し元(endTurn())で
  // 「シールドのスナップショット計算が終わった後」というタイミングを保証すること。
  // - 【抗体】持ちのモンスターはダメージを無効化するが、毒の値自体は通常通り減少する
  // - 超越の無敵(invulnerableThisTurn)中は、ダメージ・減少どちらも発生しない
  //   (ダメージを全く受けていない扱いのため。抗体は「ダメージだけ無効」という
  //    明示的な仕様があるためこれとは扱いを分けている)
  // - ポイズン・ラボが場にある間は減少処理そのものを止める
  processPoisonTick(ownerPlayer, target) {
    const amount = target.poison || 0;
    if (amount <= 0) return;
    const isMonster = target !== ownerPlayer;
    if (isMonster && target.invulnerableThisTurn) return;
    const koutai = isMonster && this.hasKeyword(target, KEYWORDS.KOUTAI);
    if (!koutai) {
      if (isMonster) this.dealDamageToMonster(ownerPlayer, target, amount);
      else this.dealPoisonDamageToPlayer(ownerPlayer, amount);
    }
    if (!this.isPoisonDecayDisabled()) {
      this.setPoisonAmount(ownerPlayer, target, Math.max(0, target.poison - 4));
    }
  }

  // 毒によるプレイヤーへのダメージ。シールドを貫通しない(攻撃時のシールド消費と同じ考え方)
  dealPoisonDamageToPlayer(player, amount) {
    let dmg = amount;
    if (player.shield > 0) {
      const absorbed = Math.min(player.shield, dmg);
      player.shield -= absorbed;
      dmg -= absorbed;
    }
    player.hp -= dmg;
    this.log(`${player.id}: 毒により${amount}ダメージ(シールド消費後の実ダメージ${dmg}、残りHP${player.hp})`);
    this.emitUiEvent({ type: "damagePlayer", playerId: player.id, amount: dmg, source: "poison" });
    this.checkWinCondition();
  }

  // ---------------- 持続イベントの起動効果(ポイズン・ラボ③用に新設) ----------------
  // 既存のcanActivateAbility/activateAbilityは「場のモンスター」専用のため、
  // イベントゾーンに置かれた持続イベント自身が持つ起動効果には対応できない。
  // そのための並行した仕組みとして新設する。
  canActivateZoneAbility(playerId) {
    const player = this.players[playerId];
    if (!player.eventZone) return false;
    return !!EFFECTS[player.eventZone]?.onZoneActivate;
  }

  activateZoneAbility(playerId, params = {}) {
    if (!this.canActivateZoneAbility(playerId)) throw new Error("この持続イベントの起動効果は使用できません");
    const player = this.players[playerId];
    const hook = EFFECTS[player.eventZone]?.onZoneActivate;
    hook({ game: this, player, opponent: this.players[this.opponentOf(playerId)], params });
  }
}
