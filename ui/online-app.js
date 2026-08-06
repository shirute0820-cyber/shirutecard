import { GameState } from "../engine/GameState.js";
import { KEYWORDS, CONFIG } from "../engine/constants.js";
import { CARD_DEFS } from "../engine/cardDefinitions.js";
import { serializeGame, hydrateGame } from "../engine/serialization.js";
import {
  DECK_SIZE,
  copyLimitOf,
  expandDeckCounts,
  totalCount,
  validateDeck,
  saveDeck,
  loadDeck,
  listBuildableCards,
} from "./deckBuilder.js";

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
// テスト用デッキ(engine/cardDefinitions.js の全カードを使用)
// ==========================================================
function buildSampleDeck() {
  const list = [];
  for (const [name, def] of Object.entries(CARD_DEFS)) {
    const copies = def.copyLimit ?? CONFIG.DEFAULT_COPY_LIMIT;
    for (let i = 0; i < Math.min(copies, 2); i++) list.push(name);
  }
  return list;
}

// ==========================================================
// デッキ構築(このブラウザに保存される、自分用の40枚デッキ)
// ==========================================================
const DECK_SLOT = "mydeck";
let myDeckCounts = loadDeck(DECK_SLOT) ?? {};
let deckBuilderDraft = null; // 編集中の一時的な枚数マップ(キャンセルで破棄できるようにする)

function myDeckIsValid() {
  return validateDeck(myDeckCounts).length === 0;
}

function updateDeckStatusLabel() {
  const label = document.getElementById("deck-status-label");
  const total = totalCount(myDeckCounts);
  if (myDeckIsValid()) {
    label.textContent = `準備OK(${total}/${DECK_SIZE}枚)`;
    label.style.color = "var(--good)";
  } else {
    label.textContent = `未完成(${total}/${DECK_SIZE}枚) — 「デッキを編集する」から40枚に揃えてください`;
    label.style.color = "var(--danger)";
  }
}

function openDeckBuilder() {
  deckBuilderDraft = { ...myDeckCounts };
  document.getElementById("setup-screen").style.display = "none";
  document.getElementById("deck-screen").style.display = "block";
  renderDeckBuilder();
}

function closeDeckBuilder() {
  document.getElementById("deck-screen").style.display = "none";
  document.getElementById("setup-screen").style.display = "block";
}

function renderDeckBuilder() {
  const listEl = document.getElementById("deck-card-list");
  listEl.innerHTML = "";
  for (const def of listBuildableCards()) {
    const n = deckBuilderDraft[def.name] ?? 0;
    const limit = copyLimitOf(def.name);
    const el = document.createElement("div");
    el.className = `deck-card theme-${def.theme ?? ""}`;
    el.innerHTML = `
      <div class="name">${def.name}</div>
      <div class="meta">コスト${def.cost ?? "?"} ${def.type ?? ""} ${def.theme ? `/ ${def.theme}` : ""}</div>
      <div class="qty-row">
        <button data-action="minus">-</button>
        <span>${n} / ${limit}</span>
        <button data-action="plus">+</button>
      </div>
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

document.getElementById("btn-open-deck-builder").onclick = openDeckBuilder;
document.getElementById("btn-deck-cancel").onclick = closeDeckBuilder;
document.getElementById("btn-deck-save").onclick = () => {
  const errors = validateDeck(deckBuilderDraft);
  if (errors.length > 0) return;
  myDeckCounts = { ...deckBuilderDraft };
  saveDeck(DECK_SLOT, myDeckCounts);
  updateDeckStatusLabel();
  closeDeckBuilder();
};

updateDeckStatusLabel();

// ==========================================================
// Firebase接続まわり
// ==========================================================
let db = null;
let dbRefFns = null; // { ref, set, onValue, get, update }
let roomCode = null;
let myPlayerId = null; // "p1" | "p2"
let game = null;
let suppressNextPush = false; // 自分が書き込んだ直後のonValueで二重処理しないためのフラグ(実害はないが無駄な再描画を減らす)

document.getElementById("btn-connect").onclick = async () => {
  const status = document.getElementById("setup-status");
  try {
    const configText = document.getElementById("firebase-config-input").value;
    const firebaseConfig = JSON.parse(configText);

    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    const { getDatabase, ref, set, onValue, get, update, runTransaction } = await import(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js"
    );

    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    dbRefFns = { ref, set, onValue, get, update, runTransaction };

    status.textContent = "接続しました。部屋を作るか参加してください。";
    document.getElementById("room-code-input").disabled = false;
    document.getElementById("btn-create-room").disabled = false;
    document.getElementById("btn-join-room").disabled = false;
    document.getElementById("btn-rejoin-host").disabled = false;
  } catch (err) {
    status.textContent = `接続エラー: ${err.message}\n(貼り付けたJSONの形式や、Realtime Databaseが有効になっているか確認してください)`;
  }
};

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
    // 再接続したい場合は「参加する」/「先攻として再接続する」を使う。
    const existingSnap = await dbRefFns.get(dbRefFns.ref(db, `rooms/${roomCode}/meta`));
    if (existingSnap.exists()) {
      status.textContent =
        "この部屋コードは既に使われています。再接続したい場合は「参加する」または「先攻として再接続する」を使ってください。";
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
      hostDeck: expandDeckCounts(myDeckCounts),
    });
    status.textContent = `部屋「${roomCode}」を作成しました。相手にこの部屋コードを伝えて「参加する」を押してもらってください。`;
    subscribeToRoom();
    subscribeToMetaForInit();
    enterGameScreen();
  } catch (err) {
    status.textContent = `部屋作成エラー: ${err.message}`;
  }
};

document.getElementById("btn-join-room").onclick = async () => {
  await connectExistingRoom("p2");
};

document.getElementById("btn-rejoin-host").onclick = async () => {
  await connectExistingRoom("p1");
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
      // 後攻としての初回参加: 自分のデッキを提出する
      if (!myDeckIsValid()) {
        status.textContent = "先に「デッキを編集する」から40枚のデッキを組んでください。";
        return;
      }
      if (!meta.guestDeck) {
        await dbRefFns.update(dbRefFns.ref(db, `rooms/${roomCode}/meta`), {
          guestConnected: true,
          guestDeck: expandDeckCounts(myDeckCounts),
        });
      }
      status.textContent = "デッキを提出しました。相手の準備が整い次第、対戦が始まります。";
    } else {
      status.textContent = "部屋の準備ができ次第、対戦が始まります(相手の参加を待っています)。";
    }

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
        const initGame = new GameState({
          player1Deck: meta.hostDeck,
          player2Deck: meta.guestDeck,
          firstPlayerId: "p1",
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
    if (suppressNextPush) {
      suppressNextPush = false;
      return;
    }
    game = hydrateGame(snap.val(), { log: pushLog });
    keepSelection = null;
    selectedAttacker = null;
    selectedHandCard = null;
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
  suppressNextPush = true;
  await dbRefFns.set(dbRefFns.ref(db, `rooms/${roomCode}/state`), serializeGame(game));
}

function enterGameScreen() {
  document.getElementById("setup-screen").style.display = "none";
  document.getElementById("game-screen").style.display = "block";
  document.getElementById("my-role-label").textContent = `(あなたは${myPlayerId === "p1" ? "先攻" : "後攻"})`;
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

  const banner = document.querySelector(".winner-banner");
  if (banner) banner.remove();

  document.getElementById("game-screen").style.display = "none";
  document.getElementById("setup-screen").style.display = "block";
  document.getElementById("setup-status").textContent = message ?? "";
}

document.getElementById("btn-return-home").onclick = async () => {
  const code = roomCode;
  // 先にローカルをホーム画面へ戻してから、Firebase側の部屋データを削除する。
  // (削除に失敗しても、少なくとも自分はホームに戻れる状態にしておく)
  returnToHomeScreen("部屋をリセットしてホーム画面に戻りました。");
  try {
    await dbRefFns.set(dbRefFns.ref(db, `rooms/${code}/state`), null);
    await dbRefFns.set(dbRefFns.ref(db, `rooms/${code}/meta`), null);
  } catch (err) {
    // 削除に失敗しても、既にローカルはホーム画面に戻っているので致命的ではない
    console.error("部屋の削除に失敗しました:", err);
  }
};

function opponentId() {
  return myPlayerId === "p1" ? "p2" : "p1";
}

// ==========================================================
// UI状態(app.jsと同様のパターン)
// ==========================================================
let selectedHandCard = null;
let selectedAttacker = null;
let keepSelection = null;
let mulliganReturn = new Set();

const CANCELLED = Symbol("cancelled");

function pickMonster(candidates, label) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const listText = candidates.map((m, i) => `${i}: ${m.defName} (${m.currentAtk}/${m.currentHp})`).join("\n");
  const input = window.prompt(`${label}\n${listText}\n番号を入力してください`, "0");
  if (input === null) return CANCELLED;
  const idx = Number(input);
  return Number.isInteger(idx) && candidates[idx] ? candidates[idx] : candidates[0];
}
function pickHandCard(candidates, label) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const listText = candidates.map((c, i) => `${i}: ${c.defName}`).join("\n");
  const input = window.prompt(`${label}\n${listText}\n番号を入力してください`, "0");
  if (input === null) return CANCELLED;
  const idx = Number(input);
  return Number.isInteger(idx) && candidates[idx] ? candidates[idx] : candidates[0];
}
const PARAM_BUILDERS = {
  投石: ({ opponent }) => {
    const t = pickMonster(opponent.board.filter(Boolean), "対象の敵モンスター");
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
  ドラゴンの眼光: ({ opponent }) => {
    const t = pickMonster(opponent.board.filter(Boolean), "破壊する敵モンスター");
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
  用意周到: ({ player, selfUid }) => {
    const c = pickHandCard(player.hand.filter((c) => c.uid !== selfUid), "保留を付与する手札");
    if (c === CANCELLED) return null;
    return { targetHandUid: c?.uid };
  },
  ドラゴンの血誓: ({ player, selfUid }) => {
    const c = pickHandCard(player.hand.filter((c) => c.uid !== selfUid && CARD_DEFS[c.defName]?.race === "ドラゴン"), "墓地へ送るドラゴン種の手札");
    if (c === CANCELLED) return null;
    return { discardHandUid: c?.uid };
  },
  滝の試練: ({ player, selfUid }) => {
    const c = pickHandCard(player.hand.filter((c) => c.uid !== selfUid), "捨てる手札");
    if (c === CANCELLED) return null;
    return { discardHandUid: c?.uid };
  },
  リバーススケイル: ({ player }) => {
    const t = pickMonster(player.board.filter((m) => m && (m.race === "ドラゴン" || m.race === "亜竜")), "攻撃力を上げる自分のモンスター");
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
};

const TRANSCEND_PARAM_BUILDERS = {
  福音受けし者: ({ opponent }) => {
    const t = pickMonster(opponent.board.filter(Boolean), "《超越》で破壊する敵モンスター");
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
  老練の竜使い: ({ player }) => {
    const t = pickMonster(
      player.board.filter((m) => m && (m.race === "ドラゴン" || m.race === "亜竜")),
      "《超越》で貫通を付与する自分のドラゴン・亜竜種"
    );
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
};

function keywordSet(instance) {
  return new Set([...instance.baseKeywords, ...instance.grantedKeywords]);
}

// ==========================================================
// レンダリング(自分視点/相手視点)
// ==========================================================
function renderMonsterCard(ownerId, instance) {
  const el = document.createElement("div");
  el.className = "card";
  const kws = [...keywordSet(instance)];
  const sick =
    instance.summonedOnTurn === game.turnNumber && !kws.includes(KEYWORDS.SOKKOU) && !kws.includes(KEYWORDS.TOTSUGEKI);
  if (sick) el.classList.add("sick");
  if (selectedAttacker === instance) el.classList.add("selected");
  el.innerHTML = `<div class="name">${instance.defName}</div><div class="stat-line">${instance.currentAtk} / ${instance.currentHp}</div><div class="keywords">${kws.join(" ")}</div>`;

  const isMyAction = game.gameStarted && !game.winner && game.activePlayerId === myPlayerId;

  if (ownerId === myPlayerId && isMyAction) {
    const trStatus = game.transcendStatus(myPlayerId, instance);
    if (trStatus.available) {
      const btn = document.createElement("button");
      btn.className = "tr-btn";
      btn.textContent = "超越(使用可能)";
      btn.onclick = async (e) => {
        e.stopPropagation();
        const player = game.players[myPlayerId];
        const opponent = game.players[opponentId()];
        const builder = TRANSCEND_PARAM_BUILDERS[instance.defName];
        const params = builder ? builder({ player, opponent }) : {};
        if (params === null) return; // 対象選択をキャンセル → 超越自体を中断
        try {
          game.useTranscend(myPlayerId, instance, params);
          await pushState();
        } catch (err) {
          alert(err.message);
        }
        render();
      };
      el.appendChild(btn);
    } else if (!trStatus.usedUp) {
      const label = document.createElement("div");
      label.className = "tr-countdown";
      label.textContent = `超越まであと${trStatus.turnsLeft}ターン`;
      el.appendChild(label);
    }
    el.onclick = () => {
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

  player.board.forEach((m, slot) => {
    if (m) {
      container.appendChild(renderMonsterCard(ownerId, m));
    } else {
      const el = renderEmptySlot();
      if (role === "me" && isMyAction && selectedHandCard && selectedHandCard.type === "モンスター") {
        el.classList.remove("empty-slot");
        el.textContent = "ここに召喚";
        el.onclick = async () => {
          const opponent = game.players[opponentId()];
          const builder = PARAM_BUILDERS[selectedHandCard.defName];
          const params = builder ? builder({ player, opponent, selfUid: selectedHandCard.uid }) : {};
          if (params === null) {
            // 対象選択をキャンセルした場合は、召喚自体を中断する(相手に公開しない)
            render();
            return;
          }
          try {
            game.summonFromHand(myPlayerId, selectedHandCard.uid, slot, params);
            await pushState();
          } catch (err) {
            alert(err.message);
          }
          selectedHandCard = null;
          render();
        };
      }
      container.appendChild(el);
    }
  });

  const eventZone = document.createElement("div");
  eventZone.className = "card empty-slot event-zone";
  eventZone.textContent = "イベントゾーン";
  container.appendChild(eventZone);
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
      el.className = "card";
      const marked = mulliganReturn.has(c.uid);
      if (marked) el.classList.add("selected");
      el.innerHTML = `<div class="name">${c.defName}${marked ? "(戻す)" : ""}</div><div class="stat-line">コスト${def?.cost ?? "?"}</div>`;
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
      el.className = "card";
      const chosen = keepSelection.chosenUid === c.uid;
      if (chosen) el.classList.add("selected");
      el.innerHTML = `<div class="name">${c.defName}</div><div class="stat-line">コスト${def?.cost ?? "?"}</div>`;
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
    el.className = "card" + (def?.type === "イベント" ? " event" : "");
    if (selectedHandCard?.uid === c.uid) el.classList.add("selected");
    el.innerHTML = `<div class="name">${c.defName}${c.hold ? " (保留)" : ""}</div><div class="stat-line">コスト${def?.cost ?? "?"} ${def?.type ?? ""}</div>${def?.type === "モンスター" ? `<div class="stat-line">${def.atk}/${def.hp}</div>` : ""}`;

    if (isMyAction) {
      el.onclick = async () => {
        if (def?.type === "イベント") {
          const opponent = game.players[opponentId()];
          const builder = PARAM_BUILDERS[c.defName];
          const params = builder ? builder({ player, opponent, selfUid: c.uid }) : {};
          if (params === null) return; // 対象選択をキャンセル → 発動自体を中断(相手に公開しない)
          try {
            game.playEvent(myPlayerId, c.uid, params);
            await pushState();
          } catch (err) {
            alert(err.message);
          }
          render();
          return;
        }
        if (def?.releaseRequirement) {
          const opponent = game.players[opponentId()];
          const builder = PARAM_BUILDERS[c.defName];
          const params = builder ? builder({ player, opponent, selfUid: c.uid }) : {};
          if (params === null) return; // 対象選択をキャンセル → 召喚自体を中断
          try {
            game.summonFromHand(myPlayerId, c.uid, null, params);
            await pushState();
          } catch (err) {
            alert(err.message);
          }
          render();
          return;
        }
        selectedHandCard = selectedHandCard?.uid === c.uid ? null : { uid: c.uid, defName: c.defName, type: def?.type };
        render();
      };
    }
    container.appendChild(el);
  }
}

const ZONE_LABELS = { deck: "デッキ", storage: "ストレージ", graveyard: "墓地", exile: "除外" };

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
  const el = document.getElementById(`stats-${role}`);
  el.innerHTML = `HP: <b>${player.hp}</b> ／ シールド: <b>${player.shield}</b> ／ コスト: <b>${player.resourceAvailable}/${player.resourceCap}</b> ／
    デッキ: <span class="zone-link" data-zone="deck">${player.deck.length}</span> ／
    ストレージ: <span class="zone-link" data-zone="storage">${player.storage.length}</span> ／
    墓地: <span class="zone-link" data-zone="graveyard">${player.graveyard.length}</span> ／
    除外: <span class="zone-link" data-zone="exile">${(player.exile ?? []).length}</span>`;
  for (const link of el.querySelectorAll(".zone-link")) {
    link.onclick = () => openZoneModal(ownerId, link.dataset.zone);
  }

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

function render() {
  if (!game) {
    // 対戦相手のデッキがまだ揃っていない(部屋作成直後/参加直後)の待機状態
    document.getElementById("turn-info").textContent = "相手の準備を待っています...";
    return;
  }

  if (!game.gameStarted) {
    document.getElementById("turn-info").textContent = "マリガンフェーズ";
    renderStats("me");
    renderStats("opponent");
    renderBoard("me");
    renderBoard("opponent");
    renderHand("me");
    renderHand("opponent");

    document.getElementById("btn-end-turn").style.display = "none";
    document.getElementById("btn-confirm-keep").style.display = "none";
    document.getElementById("btn-attack-face").style.display = "none";
    document.getElementById("btn-cancel-select").style.display = "none";

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
  document.getElementById("btn-attack-face").style.display = "";
  document.getElementById("btn-cancel-select").style.display = "";

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

    document.getElementById("btn-attack-face").style.display = "none";
    document.getElementById("btn-cancel-select").style.display = "none";
    document.getElementById("btn-end-turn").style.display = "none";
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

  const isMyAction = game.activePlayerId === myPlayerId;
  document.getElementById("btn-attack-face").disabled = !selectedAttacker || !isMyAction;
  document.getElementById("btn-end-turn").style.display = isMyAction && !keepSelection ? "" : "none";
  document.getElementById("btn-confirm-keep").style.display = keepSelection ? "" : "none";
  document.getElementById("selection-info").textContent = keepSelection
    ? `次ターン手札:残す${CONFIG.HAND_KEEP_SIZE}枚まで選択中(未選択のまま確定すると「何も残さない」)`
    : selectedAttacker
    ? `選択中: ${selectedAttacker.defName}(攻撃対象は相手モンスターをクリック、またはプレイヤーへ直接攻撃ボタン)`
    : selectedHandCard
    ? `選択中の手札: ${selectedHandCard.defName}(空き枠をクリックして召喚)`
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

document.getElementById("btn-end-turn").onclick = async () => {
  if (keepSelection) return;
  if (!game.gameStarted || game.activePlayerId !== myPlayerId) return;
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

document.getElementById("btn-attack-face").onclick = async () => {
  if (!selectedAttacker) return;
  try {
    game.attack(myPlayerId, selectedAttacker, { type: "player" });
    await pushState();
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
