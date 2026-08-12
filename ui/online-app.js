import { GameState } from "../engine/GameState.js";
import { KEYWORDS, CONFIG } from "../engine/constants.js";
import { CARD_DEFS } from "../engine/cardDefinitions.js";
import { serializeGame, hydrateGame } from "../engine/serialization.js";
import { flushUiEvents } from "./fx.js";
import { setupRulesModal } from "./rules.js";
import {
  DECK_SIZE,
  copyLimitOf,
  expandDeckCounts,
  totalCount,
  validateDeck,
  listBuildableCards,
  listDecks,
  createDeck,
  renameDeck,
  updateDeckCounts,
  deleteDeck,
  getDeck,
  getActiveDeck,
  setActiveDeckId,
} from "./deckBuilder.js";

// ==========================================================
// アプリバージョン表示(ホーム画面右上)
// GitHub上のコードを更新したのに画面が古いまま(=まだ反映されていない/
// ブラウザキャッシュが残っている)のか、更新後の新しい不具合なのかを
// 見分けやすくするための目印。コードを変更するたびに、この値を更新すること。
// ==========================================================
const APP_VERSION = "2026-08-12.1";
document.getElementById("app-version-label").textContent = `Ver. ${APP_VERSION}`;

// ホーム画面・対戦画面、どちらの「ルール」ボタンも常設(動的に再生成されない)ため、
// ここで一度だけ結びつけておけばよい
setupRulesModal();

// ==========================================================
// ログ(画面上の簡易ログパネル用)
// ==========================================================
function pushLog(msg) {
  const el = document.getElementById("log-content");
  if (!el) return;
  const line = document.createElement("div");
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// ==========================================================
// デッキ構築(複数デッキをこのブラウザに保存できる)
// ==========================================================
let editingDeckId = null; // デッキ編集画面で今どのデッキを編集しているか
let deckBuilderDraft = null; // 編集中の一時的な枚数マップ(保存を押すまで確定しない)

function myDeckIsValid() {
  const active = getActiveDeck();
  return !!active && validateDeck(active.counts).length === 0;
}

function renderDeckList() {
  const container = document.getElementById("deck-list");
  container.innerHTML = "";
  const decks = listDecks();
  const activeDeck = getActiveDeck();

  if (decks.length === 0) {
    container.innerHTML = `<p style="font-size:12px;color:var(--muted);">まだデッキがありません。「+ 新しいデッキを作る」から作成してください。</p>`;
    return;
  }

  for (const d of decks) {
    const isActive = activeDeck?.id === d.id;
    const row = document.createElement("div");
    row.className = "deck-row" + (isActive ? " active" : "");
    row.innerHTML = `
      <div class="deck-row-top">
        ${isActive ? '<span class="active-badge">対戦で使用中</span>' : ""}
        <span class="deck-name">${d.name}</span>
      </div>
      <div class="deck-row-bottom">
        <span class="deck-meta ${d.valid ? "" : "ng"}">${d.total}/${DECK_SIZE}枚${d.valid ? "" : "(未完成)"}</span>
        <button data-action="select" ${isActive ? "disabled" : ""}>これを使う</button>
        <button data-action="edit">編集(名前変更も可)</button>
        <button data-action="delete" class="danger">削除</button>
        <button data-action="delete-confirm" class="danger" style="display:none;">本当に削除</button>
      </div>
    `;
    row.querySelector('[data-action="select"]').onclick = () => {
      setActiveDeckId(d.id);
      renderDeckList();
    };
    row.querySelector('[data-action="edit"]').onclick = () => openDeckBuilder(d.id);
    // window.confirm はブラウザ環境によっては動作しないため、
    // ボタンを2段階(削除 → 本当に削除)にして代替する
    row.querySelector('[data-action="delete"]').onclick = () => {
      row.querySelector('[data-action="delete"]').style.display = "none";
      row.querySelector('[data-action="delete-confirm"]').style.display = "";
    };
    row.querySelector('[data-action="delete-confirm"]').onclick = () => {
      deleteDeck(d.id);
      renderDeckList();
    };
    container.appendChild(row);
  }
}

document.getElementById("btn-new-deck").onclick = () => {
  // window.prompt はブラウザ環境によっては動作しないため使わない。
  // 仮の名前で作成し、編集画面(名前欄あり)を開く
  const id = createDeck(`新しいデッキ${listDecks().length + 1}`);
  openDeckBuilder(id);
};

function openDeckBuilder(deckId) {
  const d = getDeck(deckId);
  if (!d) return;
  editingDeckId = deckId;
  deckBuilderDraft = { ...d.counts };
  document.getElementById("deck-name-input").value = d.name;
  document.getElementById("setup-screen").style.display = "none";
  document.getElementById("deck-screen").style.display = "block";
  renderDeckBuilder();
}

function closeDeckBuilder() {
  editingDeckId = null;
  deckBuilderDraft = null;
  document.getElementById("deck-screen").style.display = "none";
  document.getElementById("setup-screen").style.display = "block";
  renderDeckList();
}

function renderDeckBuilder() {
  const listEl = document.getElementById("deck-card-list");
  listEl.innerHTML = "";
  for (const def of listBuildableCards()) {
    const n = deckBuilderDraft[def.name] ?? 0;
    const limit = copyLimitOf(def.name);
    const el = document.createElement("div");
    el.className = `deck-card theme-${def.theme ?? ""} ${cardTierClass(def)}`;
    el.innerHTML = `
      <div class="name">${def.name}</div>
      <div class="meta">コスト${costHtml(def.cost)} ${def.type ?? ""} ${def.theme ? `/ ${def.theme}` : ""}</div>
      <div class="qty-row">
        <button data-action="minus">-</button>
        <span>${n} / ${limit}</span>
        <button data-action="plus">+</button>
      </div>
      ${cardEffectTooltipHtml(def.name)}
    `;
    el.querySelector('[data-action="minus"]').onclick = () => {
      if (n > 0) deckBuilderDraft[def.name] = n - 1;
      if (deckBuilderDraft[def.name] === 0) delete deckBuilderDraft[def.name];
      renderDeckBuilder();
    };
    const plusBtn = el.querySelector('[data-action="plus"]');
    plusBtn.disabled = n >= limit;
    plusBtn.onclick = () => {
      deckBuilderDraft[def.name] = n + 1;
      renderDeckBuilder();
    };
    listEl.appendChild(el);
  }

  const total = totalCount(deckBuilderDraft);
  const countEl = document.getElementById("deck-count");
  countEl.textContent = `${total}/${DECK_SIZE}`;
  countEl.className = "count " + (total === DECK_SIZE ? "ok" : "ng");

  const errors = validateDeck(deckBuilderDraft);
  document.getElementById("deck-errors").textContent = errors.join("\n");
  document.getElementById("btn-deck-save").disabled = errors.length > 0;
}

document.getElementById("btn-deck-cancel").onclick = closeDeckBuilder;
document.getElementById("btn-deck-save").onclick = () => {
  const errors = validateDeck(deckBuilderDraft);
  if (errors.length > 0) return;
  const newName = document.getElementById("deck-name-input").value;
  renameDeck(editingDeckId, newName);
  updateDeckCounts(editingDeckId, deckBuilderDraft);
  closeDeckBuilder();
};

renderDeckList();

// ==========================================================
// Firebase接続まわり
// ==========================================================
let db = null;
let dbRefFns = null; // { ref, set, onValue, get, update }
let roomCode = null;
let myPlayerId = null; // "p1" | "p2"
let game = null;
// 自分の書き込みが少し間を置いて2回続く(例:召喚→すぐ超越、など)と、
// 1回分しか吸収できない単純なbooleanフラグ(旧suppressNextPush)では、
// 2回目の書き込みのエコーを「相手からの更新」と誤認して自分のgameを
// 巻き戻してしまうことがあった(結果、直前の超越等の変更が消え、以後の
// 操作が古い状態に対して行われて「攻撃できません」等の不可解なエラーになる)。
// これを避けるため、各スナップショットのupdatedAt(書き込み時刻)を比較し、
// 「自分が既に知っている時刻以下のスナップショットは無視する」方式にする。
let localStateVersion = 0;

const FIREBASE_CONFIG_STORAGE_KEY = "cardgame-firebase-config";

// 部屋コードごとに「自分がp1(作った側)/p2(参加した側)のどちらだったか」を
// このブラウザに保存しておく。「再接続する」ボタンで、部屋コードだけから
// 役割を自動的に判定するために使う。
const ROOM_PLAYER_STORAGE_KEY = "cardgame-room-player-map";

function saveRoomPlayerRole(code, playerId) {
  let map = {};
  try {
    map = JSON.parse(localStorage.getItem(ROOM_PLAYER_STORAGE_KEY) || "{}");
  } catch {
    map = {};
  }
  map[code] = playerId;
  localStorage.setItem(ROOM_PLAYER_STORAGE_KEY, JSON.stringify(map));
}

function getSavedRoomPlayerRole(code) {
  try {
    const map = JSON.parse(localStorage.getItem(ROOM_PLAYER_STORAGE_KEY) || "{}");
    return map[code] ?? null;
  } catch {
    return null;
  }
}

async function connectFirebase(configText) {
  const status = document.getElementById("setup-status");
  const firebaseConfig = JSON.parse(configText);

  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const { getDatabase, ref, set, onValue, get, update, runTransaction } = await import(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js"
  );

  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  dbRefFns = { ref, set, onValue, get, update, runTransaction };

  // 次回以降は毎回貼り付けなくて済むよう、このブラウザに保存しておく
  localStorage.setItem(FIREBASE_CONFIG_STORAGE_KEY, configText);

  status.textContent = "接続しました。部屋を作るか参加してください。";
  document.getElementById("room-code-input").disabled = false;
  document.getElementById("btn-create-room").disabled = false;
  document.getElementById("btn-join-room").disabled = false;
  document.getElementById("btn-reconnect-room").disabled = false;
}

document.getElementById("btn-connect").onclick = async () => {
  const status = document.getElementById("setup-status");
  try {
    await connectFirebase(document.getElementById("firebase-config-input").value);
  } catch (err) {
    status.textContent = `接続エラー: ${err.message}\n(貼り付けたJSONの形式や、Realtime Databaseが有効になっているか確認してください)`;
  }
};

document.getElementById("btn-forget-firebase-config").onclick = () => {
  localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
  document.getElementById("firebase-config-input").value = "";
  document.getElementById("setup-status").textContent = "保存していたFirebase設定を削除しました。";
};

// 保存済みのFirebase設定があれば、貼り付け直す手間を省くため自動的に接続を試みる
(async () => {
  const saved = localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY);
  if (!saved) return;
  document.getElementById("firebase-config-input").value = saved;
  const status = document.getElementById("setup-status");
  status.textContent = "保存済みのFirebase設定で自動接続しています...";
  try {
    await connectFirebase(saved);
  } catch (err) {
    status.textContent = `自動接続エラー: ${err.message}\n(内容を確認して「接続」を押し直してください)`;
  }
})();

document.getElementById("btn-create-room").onclick = async () => {
  const status = document.getElementById("setup-status");
  if (!myDeckIsValid()) {
    status.textContent = "先に「デッキを編集する」から40枚のデッキを組んでください。";
    return;
  }
  roomCode = document.getElementById("room-code-input").value.trim() || `room-${Date.now()}`;
  myPlayerId = "p1";
  roomWasReset = false;
  game = null;

  try {
    // 既に同じ部屋コードが存在する場合、誤って上書き(ゲームリセット)しないようにする。
    // 再接続したい場合は「参加する」/「部屋を作った側として再接続する」を使う。
    const existingSnap = await dbRefFns.get(dbRefFns.ref(db, `rooms/${roomCode}/meta`));
    if (existingSnap.exists()) {
      status.textContent =
        "この部屋コードは既に使われています。再接続したい場合は「参加する」または「部屋を作った側として再接続する」を使ってください。";
      return;
    }
  } catch (err) {
    status.textContent = `確認エラー: ${err.message}`;
    return;
  }

  try {
    // この時点ではまだ対戦を初期化しない(後攻のデッキがまだ分からないため)。
    // 自分のデッキだけを保存し、両者のデッキが揃ってから対戦を作る。
    await dbRefFns.set(dbRefFns.ref(db, `rooms/${roomCode}/meta`), {
      hostConnected: true,
      guestConnected: false,
      hostDeck: expandDeckCounts(getActiveDeck().counts),
    });
    saveRoomPlayerRole(roomCode, "p1");
    status.textContent = `部屋「${roomCode}」を作成しました。相手にこの部屋コードを伝えて「参加する」を押してもらってください。`;
    subscribeToRoom();
    subscribeToMetaForInit();
    enterGameScreen();
  } catch (err) {
    status.textContent = `部屋作成エラー: ${err.message}`;
  }
};

document.getElementById("btn-join-room").onclick = async () => {
  // 「参加する」は常に後攻(p2)としての初回参加専用
  await connectExistingRoom("p2");
};

document.getElementById("btn-reconnect-room").onclick = async () => {
  // 「再接続する」は、作った側(p1)・参加した側(p2)のどちらでも使える。
  // このブラウザに保存された「部屋コード→役割」の記録から自動的に判定する。
  const status = document.getElementById("setup-status");
  const code = document.getElementById("room-code-input").value.trim();
  if (!code) {
    status.textContent = "部屋コードを入力してください。";
    return;
  }
  const savedRole = getSavedRoomPlayerRole(code);
  if (!savedRole) {
    status.textContent =
      "このブラウザにはこの部屋の役割情報が見つかりませんでした。以前このブラウザで「部屋を作る」または「参加する」を行った部屋のみ、「再接続する」が使えます。";
    return;
  }
  await connectExistingRoom(savedRole);
};

async function connectExistingRoom(playerId) {
  const status = document.getElementById("setup-status");
  roomCode = document.getElementById("room-code-input").value.trim();
  if (!roomCode) {
    status.textContent = "部屋コードを入力してください。";
    return;
  }
  myPlayerId = playerId;
  roomWasReset = false;
  game = null;

  try {
    // 既に対戦が始まっている(state が存在する)なら、再接続として扱う
    const stateSnap = await dbRefFns.get(dbRefFns.ref(db, `rooms/${roomCode}/state`));
    if (stateSnap.exists()) {
      saveRoomPlayerRole(roomCode, playerId);
      game = hydrateGame(stateSnap.val(), { log: pushLog });
      subscribeToRoom();
      enterGameScreen();
      return;
    }

    // まだ対戦が始まっていない場合
    const metaSnap = await dbRefFns.get(dbRefFns.ref(db, `rooms/${roomCode}/meta`));
    if (!metaSnap.exists()) {
      status.textContent = "その部屋コードは見つかりませんでした。";
      return;
    }
    const meta = metaSnap.val();

    if (playerId === "p2") {
      if (!meta.guestDeck) {
        // 後攻としての初回参加: 自分のデッキを提出する
        if (!myDeckIsValid()) {
          status.textContent = "先に「デッキを編集する」から40枚のデッキを組んでください。";
          return;
        }
        await dbRefFns.update(dbRefFns.ref(db, `rooms/${roomCode}/meta`), {
          guestConnected: true,
          guestDeck: expandDeckCounts(getActiveDeck().counts),
        });
      }
      status.textContent = "デッキを提出しました。相手の準備が整い次第、対戦が始まります。";
    } else {
      status.textContent = "部屋の準備ができ次第、対戦が始まります(相手の参加を待っています)。";
    }

    saveRoomPlayerRole(roomCode, playerId);
    subscribeToRoom();
    subscribeToMetaForInit();
    enterGameScreen();
  } catch (err) {
    status.textContent = `参加エラー: ${err.message}`;
  }
}

// 両者のデッキ(host/guest)が揃ったら、どちらかのクライアントが対戦を初期化する。
// 同時に両方が初期化を試みても、Firebaseのトランザクションにより一度しか成功しない。
function subscribeToMetaForInit() {
  dbRefFns.onValue(dbRefFns.ref(db, `rooms/${roomCode}/meta`), async (snap) => {
    if (!snap.exists()) return;
    const meta = snap.val();
    if (!meta.hostDeck || !meta.guestDeck) return;

    try {
      const stateRef = dbRefFns.ref(db, `rooms/${roomCode}/state`);
      await dbRefFns.runTransaction(stateRef, (currentData) => {
        if (currentData !== null) return currentData; // 既に初期化済みなら何もしない
        // 先攻・後攻をランダムに抽選する(p1=部屋を作った人、p2=参加した人、
        // という役割はここでは変えず、「どちらが先攻か」だけを50%で決める)
        const firstPlayerId = Math.random() < 0.5 ? "p1" : "p2";
        const initGame = new GameState({
          player1Deck: meta.hostDeck,
          player2Deck: meta.guestDeck,
          firstPlayerId,
          log: () => {},
        });
        initGame.startGame();
        return serializeGame(initGame);
      });
    } catch (err) {
      console.error("対戦初期化エラー:", err);
    }
  });
}

let roomWasReset = false; // 自分/相手がホームに戻って部屋をリセットした後、二重処理を防ぐフラグ

function subscribeToRoom() {
  dbRefFns.onValue(dbRefFns.ref(db, `rooms/${roomCode}/state`), (snap) => {
    if (!snap.exists()) {
      // 部屋が削除された(誰かが「ホーム画面に戻る」を押した)場合、
      // まだゲーム画面にいるならホームに戻す。既に自分でリセット済みなら何もしない。
      if (!roomWasReset && game) {
        returnToHomeScreen("相手がホーム画面に戻ったため、この対戦は終了しました。");
      }
      return;
    }
    const incoming = snap.val();
    // 自分の書き込みのエコー、または既に反映済みの(自分の方が新しい)スナップショットは無視する。
    // これにより、短い間隔で連続して自分が書き込んだ場合(例:召喚した直後に超越する、等)でも、
    // 古いスナップショットで自分のgameを巻き戻してしまうことがなくなる。
    if ((incoming.updatedAt ?? 0) <= localStateVersion) return;
    localStateVersion = incoming.updatedAt ?? localStateVersion;
    game = hydrateGame(incoming, { log: pushLog });
    keepSelection = null;
    selectedAttacker = null;
    selectedHandCard = null;
    endGameConfirmPending = false;
    transcendSelectMode = false;
    render();
    maybeStartMyTurn();
  });
}

// endTurn()の後は「between」状態になり、次のプレイヤー本人がstartTurn()を
// 呼ぶまで待機する。自分がその次のプレイヤーなら、ここで自動的に処理する
// (選択が要らなければ即startTurn、必要なら選択UIを出す)。
async function maybeStartMyTurn() {
  if (!game || !game.gameStarted) return;
  if (game.phase !== "between" || game.pendingNextPlayerId !== myPlayerId) return;
  const needed = game.peekKeepSelection(myPlayerId);
  if (needed) {
    keepSelection = { nonHold: needed, chosenUid: null };
    render();
    return;
  }
  game.startTurn(myPlayerId);
  await pushState();
  render();
}

async function pushState() {
  const payload = serializeGame(game);
  localStateVersion = payload.updatedAt;
  await dbRefFns.set(dbRefFns.ref(db, `rooms/${roomCode}/state`), payload);
}

function enterGameScreen() {
  document.getElementById("setup-screen").style.display = "none";
  document.getElementById("game-screen").style.display = "block";
  document.getElementById("my-role-label").textContent = "(準備中...)";
  document.getElementById("me-label").textContent = `自分(${myPlayerId})`;
  document.getElementById("opponent-label").textContent = `相手(${opponentId()})`;
  render();
  maybeStartMyTurn();
}

// ゲーム画面からホーム画面(部屋作成/参加の入力画面)へ戻る。
// ローカルの状態をきれいにリセットするだけで、Firebase側のデータには触れない
// (部屋の削除はbtn-return-homeのクリック時のみ、かつ1回だけ行う)。
function returnToHomeScreen(message) {
  roomWasReset = true;
  game = null;
  selectedAttacker = null;
  selectedHandCard = null;
  keepSelection = null;
  mulliganReturn = new Set();
  endGameConfirmPending = false;

  const banner = document.querySelector(".winner-banner");
  if (banner) banner.remove();

  document.getElementById("game-screen").style.display = "none";
  document.getElementById("setup-screen").style.display = "block";
  document.getElementById("setup-status").textContent = message ?? "";
}

// 部屋のデータ(state/meta)を削除してホーム画面に戻る共通処理。
// 破壊的操作のため、対象の部屋コード(codeとして呼び出し時点の値を固定でキャプチャ)
// のみを削除するようスコープを絞っている。ローカルの画面遷移を先に行ってから
// Firebase側を削除する(削除に失敗しても、少なくとも自分はホームに戻れる状態にする)。
async function deleteRoomDataAndGoHome(message) {
  const code = roomCode;
  returnToHomeScreen(message);
  try {
    await dbRefFns.set(dbRefFns.ref(db, `rooms/${code}/state`), null);
    await dbRefFns.set(dbRefFns.ref(db, `rooms/${code}/meta`), null);
  } catch (err) {
    console.error("部屋の削除に失敗しました:", err);
  }
}

document.getElementById("btn-return-home").onclick = async () => {
  await deleteRoomDataAndGoHome("部屋をリセットしてホーム画面に戻りました。");
};

// 「ゲームを終了する」：勝敗が決まる前でも、対戦中いつでも中断できるようにする。
// 誤操作で対戦データが消えてしまうと取り返しがつかないため、window.confirmではなく
// 既存の削除ボタンと同様の「押す→本当に終了する、の2段階ボタン」方式にする。
document.getElementById("btn-end-game").onclick = () => {
  endGameConfirmPending = true;
  render();
};

document.getElementById("btn-end-game-confirm").onclick = async () => {
  endGameConfirmPending = false;
  await deleteRoomDataAndGoHome("ゲームを終了し、部屋をリセットしてホーム画面に戻りました。");
};

function opponentId() {
  return myPlayerId === "p1" ? "p2" : "p1";
}

// ==========================================================
// UI状態(app.jsと同様のパターン)
// ==========================================================
let selectedHandCard = null;
let selectedAttacker = null;
let draggedHandCard = null; // ドラッグ中の手札(クリック選択とは独立に管理): { uid, defName, type, releaseRequirement } | null
let keepSelection = null;
let mulliganReturn = new Set();
let endGameConfirmPending = false; // 「ゲームを終了する」の2段階確認(誤操作防止のため)
let transcendSelectMode = false; // 左列の「超越」ボックスをクリックした後、対象モンスターの選択待ちかどうか

export const CANCELLED = Symbol("cancelled");

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
      btn.textContent = renderLabel(item);
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

export async function pickMonster(candidates, label) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  return pickFromList(candidates, label, (m) => `${m.defName} (${m.currentAtk}/${m.currentHp})`);
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
// {from:'board'|'hand', ref} の形で、選んだ順に最大2件返す。
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
// 「〜できる」系の複数選択(最大max体)。1体ずつ選んでいき、いつでも
// 「これ以上選ばない」で打ち切れる(0体選択も可能=完全に任意)。
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
// モンスターインスタンスを対象に、ちょうどmax体を選ばせる用(デスラトル等、
// 「〜体を選び、それぞれに」という必須選択のケース。キャンセルはCANCELLEDを返す)
async function pickMonstersUpTo(candidates, max, label) {
  const pool = [...candidates];
  const chosen = [];
  while (chosen.length < max && pool.length > 0) {
    const pick = await pickFromList(
      pool,
      `${label}(あと${max - chosen.length}体)`,
      (m) => `${m.defName} (${m.currentAtk}/${m.currentHp})`
    );
    if (pick === CANCELLED) return CANCELLED;
    chosen.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  }
  return chosen;
}
const PARAM_BUILDERS = {
  投石: async ({ opponent }) => {
    const t = await pickMonster(opponent.board.filter(Boolean), "対象の敵モンスター");
    if (t === CANCELLED) return null;
    return { targetMonster: t };
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
  ドラゴンの血誓: async ({ player, selfUid }) => {
    const c = await pickHandCard(player.hand.filter((c) => c.uid !== selfUid && CARD_DEFS[c.defName]?.race === "ドラゴン"), "墓地へ送るドラゴン種の手札");
    if (c === CANCELLED) return null;
    return { discardHandUid: c?.uid };
  },
  滝の試練: async ({ player, selfUid }) => {
    const discard = await pickHandCard(player.hand.filter((c) => c.uid !== selfUid), "捨てる手札");
    if (discard === CANCELLED) return null;
    if (!discard) return null;

    // デッキ優先・デッキに無ければストレージから、ドラゴン種をプレイヤーが選ぶ
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
      targets = board; // 選択の余地がない(0〜2体)ため自動対象
    } else {
      targets = await pickMonstersUpTo(board, 2, "16ダメージを与える敵モンスター");
      if (targets === CANCELLED) return null;
    }
    return { sacrifices, targetMonsters: targets };
  },
  リバーススケイル: async ({ player }) => {
    const t = await pickMonster(player.board.filter((m) => m && (m.race === "ドラゴン" || m.race === "亜竜")), "攻撃力を上げる自分のモンスター");
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
  ドラゴンの招集: async ({ player }) => {
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
};

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
};

// ==========================================================
// 手札からの召喚・イベント発動の共通処理
// (クリック操作・ドラッグ&ドロップ操作の両方から呼び出す)
// ==========================================================

// handCard: { uid, defName, type, releaseRequirement }
// slot: モンスターを置く盤面枠(リリース召喚の場合は、リリース対象がいる枠を指定する)
async function trySummonToSlot(handCard, slot) {
  const player = game.players[myPlayerId];
  const opponent = game.players[opponentId()];
  const builder = PARAM_BUILDERS[handCard.defName];
  let params;
  try {
    params = builder ? await builder({ player, opponent, selfUid: handCard.uid }) : {};
  } catch (err) {
    alert(`対象選択中にエラーが発生しました: ${err.message}`);
    selectedHandCard = null;
    draggedHandCard = null;
    render();
    return;
  }
  if (params === null) {
    selectedHandCard = null;
    draggedHandCard = null;
    render();
    return;
  }
  try {
    game.summonFromHand(myPlayerId, handCard.uid, slot, params);
    await pushState();
  } catch (err) {
    alert(err.message);
  }
  selectedHandCard = null;
  draggedHandCard = null;
  render();
}

async function tryPlayEvent(handCard) {
  const player = game.players[myPlayerId];
  const opponent = game.players[opponentId()];
  const builder = PARAM_BUILDERS[handCard.defName];
  let params;
  try {
    params = builder ? await builder({ player, opponent, selfUid: handCard.uid }) : {};
  } catch (err) {
    alert(`対象選択中にエラーが発生しました: ${err.message}`);
    selectedHandCard = null;
    draggedHandCard = null;
    render();
    return;
  }
  if (params === null) {
    selectedHandCard = null;
    draggedHandCard = null;
    render();
    return;
  }
  try {
    game.playEvent(myPlayerId, handCard.uid, params);
    await pushState();
  } catch (err) {
    alert(err.message);
  }
  selectedHandCard = null;
  draggedHandCard = null;
  render();
}

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
function costHtml(cost) {
  return `<span class="cost-num">${cost ?? "?"}</span>`;
}

// カードの枠色クラス判定(イベント/1〜3コスト/4〜7コスト/8,9コスト)
function cardTierClass(def) {
  if (!def) return "";
  if (def.type === "イベント") return "event";
  const cost = def.cost;
  if (cost == null) return "";
  if (cost <= 3) return "tier-low";
  if (cost <= 7) return "tier-mid";
  return "tier-high";
}

// ==========================================================
// レンダリング(自分視点/相手視点)
// ==========================================================
function renderMonsterCard(ownerId, instance) {
  const el = document.createElement("div");
  el.className = "card " + cardTierClass(CARD_DEFS[instance.defName]);
  const slot = game.players[ownerId].board.indexOf(instance);
  el.dataset.slot = String(slot);
  const kws = [...keywordSet(instance)];
  const sick =
    instance.summonedOnTurn === game.turnNumber && !kws.includes(KEYWORDS.SOKKOU) && !kws.includes(KEYWORDS.TOTSUGEKI);
  if (sick) el.classList.add("sick");
  if (selectedAttacker === instance) el.classList.add("selected");
  el.innerHTML = `<div class="race-line">${instance.race ?? ""}</div><div class="name monster-name">${instance.defName}</div><div class="stat-line">${instance.currentAtk} / ${instance.currentHp}</div><div class="keywords">${kws.join(" ")}</div>${cardEffectTooltipHtml(instance.defName)}`;

  const isMyAction = game.gameStarted && !game.winner && game.activePlayerId === myPlayerId;

  // リリース召喚の対象候補(自分のターン中、選択中/ドラッグ中の手札のリリース条件に一致する場合)
  const releaseReq = selectedHandCard?.releaseRequirement ?? draggedHandCard?.releaseRequirement ?? null;
  const isReleaseCandidate = ownerId === myPlayerId && isMyAction && releaseReq === instance.defName;

  if (ownerId === myPlayerId && isMyAction && selectedHandCard?.releaseRequirement === instance.defName) {
    el.classList.add("release-target");
    el.onclick = (e) => {
      e.stopPropagation();
      const handCard = selectedHandCard;
      trySummonToSlot(handCard, slot);
    };
  } else if (ownerId === myPlayerId && isMyAction) {
    // 超越がまだ使えない状態の残りターン数・使用可否は左列の常設「超越」ボックスに
    // プレイヤー単位で表示・操作するため、モンスターカード上には超越ボタンを置かない

    // 「1ターンに1度発動可能」等の起動効果(onActivate)を持つカードは、
    // このターン未使用ならモンスターカード上に専用ボタンを表示する
    if (game.canActivateAbility(myPlayerId, instance)) {
      const abilityBtn = document.createElement("button");
      abilityBtn.className = "tr-btn";
      abilityBtn.textContent = "起動効果を使う";
      abilityBtn.onclick = async (e) => {
        e.stopPropagation();
        const player = game.players[myPlayerId];
        const opponent = game.players[opponentId()];
        const builder = ACTIVATE_PARAM_BUILDERS[instance.defName];
        let params;
        try {
          params = builder ? await builder({ player, opponent }) : {};
        } catch (err) {
          alert(`対象選択中にエラーが発生しました: ${err.message}`);
          render();
          return;
        }
        if (params === null) {
          render();
          return; // 対象選択をキャンセル → 発動自体を中断
        }
        try {
          game.activateAbility(myPlayerId, instance, params);
          await pushState();
        } catch (err) {
          alert(err.message);
        }
        render();
      };
      el.appendChild(abilityBtn);
    }

    if (transcendSelectMode) el.classList.add("transcend-candidate");
    el.onclick = async () => {
      if (transcendSelectMode) {
        transcendSelectMode = false;
        const player = game.players[myPlayerId];
        const opponent = game.players[opponentId()];
        const builder = TRANSCEND_PARAM_BUILDERS[instance.defName];
        let params;
        try {
          params = builder ? await builder({ player, opponent }) : {};
        } catch (err) {
          alert(`対象選択中にエラーが発生しました: ${err.message}`);
          render();
          return;
        }
        if (params === null) {
          render();
          return; // 対象選択をキャンセル → 超越自体を中断
        }
        try {
          game.useTranscend(myPlayerId, instance, params);
          await pushState();
        } catch (err) {
          alert(err.message);
        }
        render();
        return;
      }
      selectedAttacker = selectedAttacker === instance ? null : instance;
      render();
    };
  } else if (ownerId !== myPlayerId && isMyAction) {
    el.onclick = async () => {
      if (!selectedAttacker) return;
      try {
        game.attack(myPlayerId, selectedAttacker, { type: "monster", instance });
        await pushState();
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
      if (draggedHandCard && draggedHandCard.releaseRequirement === instance.defName) {
        trySummonToSlot(draggedHandCard, slot);
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

function renderBoard(role) {
  const ownerId = role === "me" ? myPlayerId : opponentId();
  const container = document.getElementById(`board-${role}`);
  container.innerHTML = "";
  if (!game.gameStarted) return;
  const player = game.players[ownerId];
  const isMyAction = game.gameStarted && !game.winner && game.activePlayerId === myPlayerId;
  const clickSummonMode =
    role === "me" && isMyAction && selectedHandCard?.type === "モンスター" && !selectedHandCard?.releaseRequirement;

  player.board.forEach((m, slot) => {
    if (m) {
      container.appendChild(renderMonsterCard(ownerId, m));
    } else {
      const el = renderEmptySlot();
      el.dataset.slot = String(slot);
      if (clickSummonMode) {
        el.classList.remove("empty-slot");
        el.textContent = "ここに召喚";
        el.onclick = () => trySummonToSlot(selectedHandCard, slot);
      }
      // ドラッグ&ドロップ: 通常召喚(リリース不要)の手札を、この空き枠へドロップできる
      if (role === "me" && isMyAction) {
        el.ondragover = (e) => {
          if (draggedHandCard && draggedHandCard.type === "モンスター" && !draggedHandCard.releaseRequirement) {
            e.preventDefault();
            el.classList.add("drag-target");
          }
        };
        el.ondragleave = () => el.classList.remove("drag-target");
        el.ondrop = (e) => {
          e.preventDefault();
          el.classList.remove("drag-target");
          if (draggedHandCard && draggedHandCard.type === "モンスター" && !draggedHandCard.releaseRequirement) {
            trySummonToSlot(draggedHandCard, slot);
          }
        };
      }
      container.appendChild(el);
    }
  });

  // イベントゾーン(自分側のみ): イベントカードをドラッグ&ドロップで発動できるようにする
  if (role === "me") {
    const eventZoneEl = document.getElementById("event-zone-me");
    if (eventZoneEl) {
      const canDropEvent = isMyAction;
      eventZoneEl.ondragover = (e) => {
        if (canDropEvent && draggedHandCard && draggedHandCard.type === "イベント") {
          e.preventDefault();
          eventZoneEl.classList.add("drag-target");
        }
      };
      eventZoneEl.ondragleave = () => eventZoneEl.classList.remove("drag-target");
      eventZoneEl.ondrop = (e) => {
        e.preventDefault();
        eventZoneEl.classList.remove("drag-target");
        if (canDropEvent && draggedHandCard && draggedHandCard.type === "イベント") {
          tryPlayEvent(draggedHandCard);
        }
      };
    }
  }
}

function renderHand(role) {
  const ownerId = role === "me" ? myPlayerId : opponentId();
  const container = document.getElementById(`hand-${role}`);
  container.innerHTML = "";
  const player = game.players[ownerId];

  // 相手の手札は中身を見せない(枚数だけ)
  if (role === "opponent") {
    for (let i = 0; i < player.hand.length; i++) {
      const el = document.createElement("div");
      el.className = "hidden-hand-card card";
      container.appendChild(el);
    }
    return;
  }

  // マリガン画面(自分視点)
  if (!game.gameStarted) {
    const done = game.mulliganDone[myPlayerId];
    for (const c of player.hand) {
      const def = CARD_DEFS[c.defName];
      const el = document.createElement("div");
      el.className = "card " + cardTierClass(def);
      const marked = mulliganReturn.has(c.uid);
      if (marked) el.classList.add("selected");
      el.innerHTML = `<div class="name">${c.defName}${marked ? "(戻す)" : ""}</div><div class="stat-line">コスト${costHtml(def?.cost)}</div>${cardEffectTooltipHtml(c.defName)}`;
      if (!done) {
        el.onclick = () => {
          if (marked) mulliganReturn.delete(c.uid);
          else mulliganReturn.add(c.uid);
          render();
        };
      } else {
        el.style.opacity = "0.5";
      }
      container.appendChild(el);
    }
    return;
  }

  const isMyAction = !game.winner && game.activePlayerId === myPlayerId;
  if (keepSelection) {
    for (const c of keepSelection.nonHold) {
      const def = CARD_DEFS[c.defName];
      const el = document.createElement("div");
      el.className = "card " + cardTierClass(def);
      const chosen = keepSelection.chosenUid === c.uid;
      if (chosen) el.classList.add("selected");
      el.innerHTML = `<div class="name">${c.defName}</div><div class="stat-line">コスト${costHtml(def?.cost)}</div>${cardEffectTooltipHtml(c.defName)}`;
      el.onclick = () => {
        keepSelection.chosenUid = chosen ? null : c.uid;
        render();
      };
      container.appendChild(el);
    }
    for (const c of player.hand.filter((h) => h.hold)) {
      const el = document.createElement("div");
      el.className = "card";
      el.style.opacity = "0.6";
      el.innerHTML = `<div class="name">${c.defName} (保留・自動で残る)</div>`;
      container.appendChild(el);
    }
    return;
  }

  for (const c of player.hand) {
    const def = CARD_DEFS[c.defName];
    const el = document.createElement("div");
    el.className = "card " + cardTierClass(def);
    if (selectedHandCard?.uid === c.uid) el.classList.add("selected");
    el.innerHTML = `<div class="name">${c.defName}${c.hold ? " (保留)" : ""}</div><div class="stat-line">コスト${costHtml(def?.cost)} ${def?.type ?? ""}</div>${def?.type === "モンスター" ? `<div class="stat-line">${def.atk}/${def.hp}</div>` : ""}${cardEffectTooltipHtml(c.defName)}`;

    if (isMyAction) {
      el.onclick = () => {
        if (def?.type === "イベント") {
          tryPlayEvent({ uid: c.uid, defName: c.defName, type: def.type });
          return;
        }
        // モンスターカードは、通常召喚(空き枠を選ぶ)・リリース召喚(リリース対象の枠を選ぶ)
        // いずれも、まずはこのカードを「選択中」にするだけにする(誤操作防止のため、
        // クリック1回で即座に召喚してしまうことはない)
        selectedHandCard =
          selectedHandCard?.uid === c.uid
            ? null
            : { uid: c.uid, defName: c.defName, type: def?.type, releaseRequirement: def?.releaseRequirement ?? null };
        render();
      };
      // ドラッグ&ドロップ: 手札のカードを盤面(モンスター)・イベントゾーン(イベント)へ
      // ドラッグして発動できるようにする(マウス操作向け。タッチ操作には非対応)
      el.draggable = true;
      el.ondragstart = (e) => {
        draggedHandCard = { uid: c.uid, defName: c.defName, type: def?.type, releaseRequirement: def?.releaseRequirement ?? null };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", c.uid);
        render();
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
// (このファイルはowner playerIdではなく role="me"|"opponent" でDOM要素を
//  持っているため、ownerIdからroleへ変換してから探す)
// ==========================================================
function roleOf(ownerId) {
  return ownerId === myPlayerId ? "me" : "opponent";
}
function getMonsterSlotEl(ownerId, slot) {
  const container = document.getElementById(`board-${roleOf(ownerId)}`);
  if (!container) return null;
  return container.querySelector(`[data-slot="${slot}"]`);
}
function getPlayerStatsEl(playerId) {
  return document.getElementById(`hp-value-${roleOf(playerId)}`);
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
    for (const [name, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const row = document.createElement("div");
      row.textContent = count > 1 ? `${name} ×${count}` : name;
      contentEl.appendChild(row);
    }
  }
  document.getElementById("zone-modal-overlay").style.display = "flex";
}

function closeZoneModal() {
  document.getElementById("zone-modal-overlay").style.display = "none";
}

function renderStats(role) {
  const ownerId = role === "me" ? myPlayerId : opponentId();
  const player = game.players[ownerId];

  // 常設のミニステータス欄は、後攻追加ドローボタンの設置場所としてのみ使う
  // (HP・コストは左列/右列の専用ボックスに表示するため、ここにはテキストを出さない)
  const el = document.getElementById(`stats-${role}`);
  el.innerHTML = "";

  // 盤面まわりの常設ゾーン(シールド・HP・超越・ストレージ・除外・コスト・墓地・デッキ)
  document.getElementById(`shield-value-${role}`).textContent = player.shield;
  document.getElementById(`hp-value-${role}`).textContent = player.hp;
  document.getElementById(`cost-value-${role}`).textContent = `${player.resourceAvailable}/${player.resourceCap}`;

  const trStatus = game.playerTranscendAvailability(ownerId);
  const trBox = document.getElementById(`transcend-box-${role}`);
  const trValue = document.getElementById(`transcend-value-${role}`);
  trBox.classList.toggle("available", trStatus.available);
  trValue.textContent = trStatus.available ? "使用可能" : `あと${trStatus.turnsLeft}ターン`;

  document.getElementById(`storage-count-${role}`).textContent = player.storage.length;
  document.getElementById(`exile-count-${role}`).textContent = (player.exile ?? []).length;
  document.getElementById(`graveyard-count-${role}`).textContent = player.graveyard.length;
  document.getElementById(`deck-count-${role}`).textContent = player.deck.length;

  document.getElementById(`storage-zone-${role}`).onclick = () => openZoneModal(ownerId, "storage");
  document.getElementById(`exile-zone-${role}`).onclick = () => openZoneModal(ownerId, "exile");
  document.getElementById(`graveyard-zone-${role}`).onclick = () => openZoneModal(ownerId, "graveyard");
  document.getElementById(`deck-zone-${role}`).onclick = () => openZoneModal(ownerId, "deck");

  if (role === "me" && ownerId === game.secondPlayerId) {
    const canUse =
      game.gameStarted &&
      game.activePlayerId === myPlayerId &&
      player.secondPlayerBonusDrawsRemaining > 0 &&
      !player.secondPlayerBonusDrawUsedThisTurn;
    const btn = document.createElement("button");
    btn.textContent = `後攻追加ドローを使う(残り${player.secondPlayerBonusDrawsRemaining}回)`;
    btn.disabled = !canUse;
    btn.onclick = async () => {
      try {
        game.useSecondPlayerBonusDraw(myPlayerId);
        await pushState();
      } catch (err) {
        alert(err.message);
      }
      render();
    };
    el.appendChild(btn);
  }
}

// 「ゲームを終了する」関連ボタンの表示切り替え。render()の冒頭で必ず呼び出す。
// 勝敗が決まった後は、専用の「ホーム画面に戻る」ボタン(1クリックで確定)に一本化し、
// こちらの2段階確認ボタンは表示しない(二重の削除導線を作らないため)。
function updateEndGameButtons() {
  const showEndGameOption = !game || !game.winner;
  document.getElementById("btn-end-game").style.display =
    showEndGameOption && !endGameConfirmPending ? "" : "none";
  document.getElementById("btn-end-game-confirm").style.display =
    showEndGameOption && endGameConfirmPending ? "" : "none";
}

// 「ターン終了」ボタン(自分側のデッキの下に常設)の表示・ラベル・クリック処理を一括管理。
// render()の冒頭で必ず呼び出す。
// - 勝敗が決まった後、または「残す手札」選択中(confirm-keepボタンを使う)は非表示
// - マリガン中は「ドローフェイズ」(押せない)
// - 相手のターン中は「相手ターン中」(押せない)
// - 自分が行動できるときだけ「ターン終了」(押せる)
function updateTurnActionButton() {
  const btn = document.getElementById("btn-end-turn");
  if (!game || game.winner || keepSelection) {
    btn.style.display = "none";
    return;
  }
  btn.style.display = "";
  if (!game.gameStarted) {
    btn.textContent = "ドローフェイズ";
    btn.disabled = true;
    btn.onclick = null;
  } else if (game.activePlayerId !== myPlayerId) {
    btn.textContent = "相手ターン中";
    btn.disabled = true;
    btn.onclick = null;
  } else {
    btn.textContent = "ターン終了";
    btn.disabled = false;
    btn.onclick = async () => {
      selectedAttacker = null;
      selectedHandCard = null;
      try {
        game.endTurn();
        await pushState();
      } catch (err) {
        alert(err.message);
        return;
      }
      render();
      // 自分が(1対1なので基本起こらないが)次のプレイヤーでもあるケースに備えて確認
      await maybeStartMyTurn();
    };
  }
}

// モンスターを選択中に相手の手札ゾーンをクリックすると、プレイヤーへの直接攻撃になる。
// 選択中かつ行動可能なときだけ、相手の手札ゾーンにヒント表示とクリック操作を付与する。
// render()の冒頭で必ず呼び出す。
function updateAttackFaceZone() {
  const zone = document.getElementById("hand-opponent");
  const canAttackFace = !!(
    game &&
    game.gameStarted &&
    !game.winner &&
    game.activePlayerId === myPlayerId &&
    !keepSelection &&
    selectedAttacker
  );
  zone.classList.toggle("attack-target-hint", canAttackFace);
  zone.onclick = canAttackFace
    ? async () => {
        try {
          game.attack(myPlayerId, selectedAttacker, { type: "player" });
          await pushState();
        } catch (err) {
          alert(err.message);
        }
        selectedAttacker = null;
        render();
      }
    : null;
}

// 現在ターン中のプレイヤーの盤面(area-me / area-opponent)に色付き枠のハイライトを付ける。
// render()の冒頭で必ず呼び出す。
function updateActiveTurnHighlight() {
  const activeIsMe = !!(game && game.gameStarted && !game.winner && game.activePlayerId === myPlayerId);
  const activeIsOpponent = !!(game && game.gameStarted && !game.winner && game.activePlayerId === opponentId());
  document.getElementById("area-me").classList.toggle("active-turn", activeIsMe);
  document.getElementById("area-opponent").classList.toggle("active-turn", activeIsOpponent);
}

// 左列の「超越」ボックス(自分側)を、超越が使える状態のときだけクリック可能にする。
// クリックすると「超越するモンスターを場から選ぶ」待機モードに入る(モンスター本体の
// 超越ボタンは廃止し、この左列ボックス経由の選択方式に統一する)。
// render()の冒頭で必ず呼び出す。
function updateTranscendBox() {
  const box = document.getElementById("transcend-box-me");
  const isMyAction = !!(game && game.gameStarted && !game.winner && game.activePlayerId === myPlayerId);
  const avail = isMyAction ? game.playerTranscendAvailability(myPlayerId) : { available: false };
  box.classList.toggle("clickable-zone", !!avail.available);
  box.classList.toggle("selecting", transcendSelectMode);
  box.onclick = avail.available
    ? () => {
        transcendSelectMode = !transcendSelectMode;
        selectedAttacker = null; // 超越選択中は「攻撃対象選択」と混同しないよう解除しておく
        render();
      }
    : null;
  if (!avail.available && transcendSelectMode) {
    // 超越が使えなくなった(手番が変わった等)のに選択待ちのまま残らないようにする
    transcendSelectMode = false;
  }
}

function render() {
  renderInner();
  if (game) flushUiEvents(game, { getMonsterSlotEl, getPlayerStatsEl });
}

function renderInner() {
  updateEndGameButtons();
  updateTurnActionButton();
  updateAttackFaceZone();
  updateActiveTurnHighlight();
  updateTranscendBox();

  if (!game) {
    // 対戦相手のデッキがまだ揃っていない(部屋作成直後/参加直後)の待機状態
    document.getElementById("turn-info").textContent = "相手の準備を待っています...";
    return;
  }

  // 先攻・後攻の抽選結果が確定したら、役割表示を更新する
  document.getElementById("my-role-label").textContent =
    `(あなたは${myPlayerId === game.firstPlayerId ? "先攻" : "後攻"})`;

  if (!game.gameStarted) {
    document.getElementById("turn-info").textContent = "マリガンフェーズ";
    renderStats("me");
    renderStats("opponent");
    renderBoard("me");
    renderBoard("opponent");
    renderHand("me");
    renderHand("opponent");

    document.getElementById("btn-confirm-keep").style.display = "none";

    const btnM = document.getElementById("btn-mulligan-me");
    btnM.style.display = "";
    btnM.disabled = game.mulliganDone[myPlayerId];
    btnM.textContent = game.mulliganDone[myPlayerId]
      ? "マリガン済み(相手を待っています)"
      : `マリガン確定(戻す${mulliganReturn.size}枚)`;
    document.getElementById("selection-info").textContent =
      "戻したいカードをクリックして選び、準備ができたら確定してください(0枚のままでもOK)";
    return;
  }

  document.getElementById("btn-mulligan-me").style.display = "none";

  document.getElementById("turn-info").textContent =
    game.phase === "between"
      ? "手番切り替え中..."
      : `ターン${game.turnNumber} / ${game.activePlayerId === myPlayerId ? "あなたの番" : "相手の番"}(フェイズ:${game.phase})`;

  renderStats("me");
  renderStats("opponent");

  if (game.winner) {
    // 勝敗が決まったら、盤面・手札は最終状態を表示するだけにして
    // それ以上の操作は一切受け付けないようにする
    renderBoard("me");
    renderBoard("opponent");
    renderHand("me");
    renderHand("opponent");

    document.getElementById("btn-confirm-keep").style.display = "none";
    document.getElementById("selection-info").textContent = "";
    document.getElementById("btn-return-home").style.display = "";

    let banner = document.querySelector(".winner-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "winner-banner";
      document.body.prepend(banner);
    }
    banner.textContent = game.winner === myPlayerId ? "あなたの勝利!" : "相手の勝利...";
    return;
  }

  document.getElementById("btn-return-home").style.display = "none";
  renderBoard("me");
  renderBoard("opponent");
  renderHand("me");
  renderHand("opponent");

  document.getElementById("btn-confirm-keep").style.display = keepSelection ? "" : "none";
  document.getElementById("selection-info").textContent = keepSelection
    ? `次ターン手札:残す${CONFIG.HAND_KEEP_SIZE}枚まで選択中(未選択のまま確定すると「何も残さない」)`
    : selectedAttacker
    ? `選択中: ${selectedAttacker.defName}(攻撃対象は相手モンスターをクリック、または相手の手札ゾーンをクリックでプレイヤーへ直接攻撃)`
    : selectedHandCard
    ? `選択中の手札: ${selectedHandCard.defName}(${
        selectedHandCard.releaseRequirement
          ? `『${selectedHandCard.releaseRequirement}』がいる枠をクリックしてリリース召喚`
          : "空き枠をクリックして召喚"
      })`
    : "";
}

// ==========================================================
// ボタン操作
// ==========================================================
document.getElementById("btn-mulligan-me").onclick = async () => {
  const returnUids = [...mulliganReturn];
  // 通常のpushState(その場の内容を丸ごと書き込む方式)ではなく、Firebase側の
  // 「今まさに保存されている最新の状態」を見てから計算するトランザクションを使う。
  // 相手も同じタイミングでマリガンを確定した場合、お互いの書き込みが
  // 上書きし合って片方の完了フラグが消えてしまう競合を避けるため。
  try {
    const stateRef = dbRefFns.ref(db, `rooms/${roomCode}/state`);
    const result = await dbRefFns.runTransaction(stateRef, (currentData) => {
      if (currentData === null) return currentData; // 部屋がまだ存在しない(異常系)ので何もしない
      const tempGame = hydrateGame(currentData, { log: () => {} });
      if (tempGame.mulliganDone[myPlayerId]) return currentData; // 既に確定済みなら変更しない(再試行対策)
      tempGame.mulligan(myPlayerId, returnUids);
      return serializeGame(tempGame);
    });
    if (result.committed && result.snapshot.exists()) {
      game = hydrateGame(result.snapshot.val(), { log: pushLog });
    }
  } catch (err) {
    alert(err.message);
    return;
  }
  mulliganReturn = new Set();
  render();
  await maybeStartMyTurn();
};

document.getElementById("btn-confirm-keep").onclick = async () => {
  if (!keepSelection) return;
  try {
    game.startTurn(myPlayerId, keepSelection.chosenUid);
    await pushState();
  } catch (err) {
    alert(err.message);
    return;
  }
  keepSelection = null;
  render();
};

document.getElementById("zone-modal-close").onclick = closeZoneModal;
document.getElementById("zone-modal-overlay").onclick = (e) => {
  if (e.target.id === "zone-modal-overlay") closeZoneModal();
};
