import { GameState } from "./GameState.js";

// Firebase Realtime Databaseはundefinedを許容しない/Setやクラスインスタンスを
// そのまま保存できないため、プレーンなJSONに変換する必要がある。
// serializeGame() でスナップショットを作り、hydrateGame() で元に戻す。
//
// オンライン対戦のモデル：
// 「今アクティブなプレイヤーのクライアントだけが本物のGameStateを操作し、
//   行動のたびにスナップショットをFirebaseへ書き込む。もう片方のクライアントは
//   スナップショットを受け取ってhydrateGame()で再構築し、描画するだけ(自分の
//   ターンが来るまでは一切ミューテーションしない)」
// これにより、乱数(シャッフル等)のずれによる状態不一致を避けられる。

function serializeMonster(m) {
  if (!m) return null;
  return {
    instanceId: m.instanceId,
    ownerId: m.ownerId,
    defName: m.defName,
    type: m.type,
    cost: m.cost,
    race: m.race,
    baseAtk: m.baseAtk,
    baseHp: m.baseHp,
    currentAtk: m.currentAtk,
    currentHp: m.currentHp,
    cannotAttack: m.cannotAttack,
    baseKeywords: [...m.baseKeywords],
    grantedKeywords: [...m.grantedKeywords],
    summonedOnTurn: m.summonedOnTurn,
    hasAttackedThisTurn: m.hasAttackedThisTurn,
    transcended: m.transcended,
    invulnerableThisTurn: m.invulnerableThisTurn,
    attackRestrictionThisTurn: m.attackRestrictionThisTurn ?? null,
    canBeSpecialSummoned: m.canBeSpecialSummoned,
    onceEffectUsedThisTurn: m.onceEffectUsedThisTurn ?? {},
  };
}

function deserializeMonster(o) {
  if (!o) return null;
  return {
    ...o,
    baseKeywords: new Set(o.baseKeywords ?? []),
    grantedKeywords: new Set(o.grantedKeywords ?? []),
    attackRestrictionThisTurn: o.attackRestrictionThisTurn ?? null,
    onceEffectUsedThisTurn: o.onceEffectUsedThisTurn ?? {},
  };
}

function serializeHandCard(c) {
  return { uid: c.uid, defName: c.defName, hold: !!c.hold };
}

// 盤面はスパース(歯抜け)なオブジェクトとして保存する。
// [null, monster, null, null] のような「全部null」に近い配列をそのまま
// Firebaseへ書き込むと、値がnullの項目は自動的に消え、最悪「board」という
// 項目自体が丸ごと消えてしまう(=読み込み側でundefinedになりクラッシュする)。
// そのため、存在するモンスターの枠番号だけをキーとして書き込み、
// 復元時に4枠ぶんのnull配列へ展開し直す。
function serializeBoard(board) {
  const o = {};
  board.forEach((m, i) => {
    if (m) o[i] = serializeMonster(m);
  });
  return o;
}

function deserializeBoard(o) {
  const board = [null, null, null, null];
  if (o) {
    for (const [i, m] of Object.entries(o)) {
      board[Number(i)] = deserializeMonster(m);
    }
  }
  return board;
}

function serializePlayer(p) {
  return {
    id: p.id,
    deck: [...p.deck],
    hand: p.hand.map(serializeHandCard),
    storage: [...p.storage],
    graveyard: [...p.graveyard],
    board: serializeBoard(p.board),
    hp: p.hp,
    shield: p.shield,
    ownTurnCount: p.ownTurnCount,
    resourceCap: p.resourceCap,
    resourceAvailable: p.resourceAvailable,
    transcendCooldownUntilGlobalTurn: p.transcendCooldownUntilGlobalTurn,
    secondPlayerBonusDrawsRemaining: p.secondPlayerBonusDrawsRemaining,
    secondPlayerBonusDrawUsedThisTurn: p.secondPlayerBonusDrawUsedThisTurn,
  };
}

// Firebaseは値が空配列/null/undefinedのキーを書き込み時に取り除いてしまうため、
// 復元側では欠けている可能性のある項目すべてに安全なデフォルト値を補う。
function deserializePlayer(o) {
  return {
    ...o,
    deck: o.deck ?? [],
    hand: (o.hand ?? []).map((c) => ({ ...c })),
    storage: o.storage ?? [],
    graveyard: o.graveyard ?? [],
    board: deserializeBoard(o.board),
  };
}

// 稼働中のGameStateを、Firebaseに書き込めるプレーンなJSONへ変換する
export function serializeGame(game) {
  return {
    players: {
      p1: serializePlayer(game.players.p1),
      p2: serializePlayer(game.players.p2),
    },
    firstPlayerId: game.firstPlayerId,
    secondPlayerId: game.secondPlayerId,
    globalTurn: game.globalTurn,
    activePlayerId: game.activePlayerId,
    pendingNextPlayerId: game.pendingNextPlayerId ?? null,
    phase: game.phase,
    winner: game.winner ?? null,
    dragonKilledThisTurnByCombat: game.dragonKilledThisTurnByCombat,
    gameStarted: game.gameStarted,
    mulliganDone: game.mulliganDone ?? { p1: false, p2: false },
    // 予約された遅延効果(関数)はそのままでは保存できないため、
    // 「未実行の遅延効果がある」ことだけ保持し、実際の関数はホスト側の
    // メモリにある間だけ有効とする(オンライン対戦での既知の簡略化ポイント)。
    pendingEndPhaseEffectCounts: {
      p1: (game.pendingEndPhaseEffects?.p1 ?? []).length,
      p2: (game.pendingEndPhaseEffects?.p2 ?? []).length,
    },
    updatedAt: Date.now(),
  };
}

// スナップショットから、通常のGameStateメソッドがそのまま使える
// 稼働可能なGameStateインスタンスを再構築する。
export function hydrateGame(snapshot, { log = () => {} } = {}) {
  const game = new GameState({ player1Deck: [], player2Deck: [], firstPlayerId: snapshot.firstPlayerId, log });

  game.players.p1 = deserializePlayer(snapshot.players.p1);
  game.players.p2 = deserializePlayer(snapshot.players.p2);
  game.secondPlayerId = snapshot.secondPlayerId;
  game.globalTurn = snapshot.globalTurn;
  game.activePlayerId = snapshot.activePlayerId;
  game.pendingNextPlayerId = snapshot.pendingNextPlayerId ?? null;
  game.phase = snapshot.phase;
  game.winner = snapshot.winner ?? null;
  game.dragonKilledThisTurnByCombat = !!snapshot.dragonKilledThisTurnByCombat;
  game.gameStarted = !!snapshot.gameStarted;
  game.mulliganDone = snapshot.mulliganDone ?? { p1: false, p2: false };
  game.pendingEndPhaseEffects = { p1: [], p2: [] }; // 遅延効果の関数自体は復元不可(下記の注意点を参照)

  return game;
}
