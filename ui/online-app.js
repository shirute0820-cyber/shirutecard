import { GameState } from "../engine/GameState.js";
import { KEYWORDS, CONFIG } from "../engine/constants.js";
import { CARD_DEFS } from "../engine/cardDefinitions.js";
import { serializeGame, hydrateGame } from "../engine/serialization.js";

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
    const { getDatabase, ref, set, onValue, get, update } = await import(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js"
    );

    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    dbRefFns = { ref, set, onValue, get, update };

    status.textContent = "接続しました。部屋を作るか参加してください。";
    document.getElementById("room-code-input").disabled = false;
    document.getElementById("btn-create-room").disabled = false;
    document.getElementById("btn-join-room").disabled = false;
  } catch (err) {
    status.textContent = `接続エラー: ${err.message}\n(貼り付けたJSONの形式や、Realtime Databaseが有効になっているか確認してください)`;
  }
};

document.getElementById("btn-create-room").onclick = async () => {
  const status = document.getElementById("setup-status");
  roomCode = document.getElementById("room-code-input").value.trim() || `room-${Date.now()}`;
  myPlayerId = "p1";

  game = new GameState({
    player1Deck: buildSampleDeck(),
    player2Deck: buildSampleDeck(),
    firstPlayerId: "p1",
    log: pushLog,
  });
  game.startGame();

  try {
    await dbRefFns.set(dbRefFns.ref(db, `rooms/${roomCode}/state`), serializeGame(game));
    await dbRefFns.set(dbRefFns.ref(db, `rooms/${roomCode}/meta`), { hostConnected: true, guestConnected: false });
    status.textContent = `部屋「${roomCode}」を作成しました。相手にこの部屋コードを伝えて「参加する」を押してもらってください。`;
    subscribeToRoom();
    enterGameScreen();
  } catch (err) {
    status.textContent = `部屋作成エラー: ${err.message}`;
  }
};

document.getElementById("btn-join-room").onclick = async () => {
  const status = document.getElementById("setup-status");
  roomCode = document.getElementById("room-code-input").value.trim();
  if (!roomCode) {
    status.textContent = "部屋コードを入力してください。";
    return;
  }
  myPlayerId = "p2";

  try {
    const snap = await dbRefFns.get(dbRefFns.ref(db, `rooms/${roomCode}/state`));
    if (!snap.exists()) {
      status.textContent = "その部屋コードは見つかりませんでした。";
      return;
    }
    game = hydrateGame(snap.val(), { log: pushLog });
    await dbRefFns.update(dbRefFns.ref(db, `rooms/${roomCode}/meta`), { guestConnected: true });
    subscribeToRoom();
    enterGameScreen();
  } catch (err) {
    status.textContent = `参加エラー: ${err.message}`;
  }
};

function subscribeToRoom() {
  dbRefFns.onValue(dbRefFns.ref(db, `rooms/${roomCode}/state`), (snap) => {
    if (!snap.exists()) return;
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
  if (!game.gameStarted) return;
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

function pickMonster(candidates, label) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const listText = candidates.map((m, i) => `${i}: ${m.defName} (${m.currentAtk}/${m.currentHp})`).join("\n");
  const input = window.prompt(`${label}\n${listText}\n番号を入力してください`, "0");
  const idx = Number(input);
  return Number.isInteger(idx) && candidates[idx] ? candidates[idx] : candidates[0];
}
function pickHandCard(candidates, label) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const listText = candidates.map((c, i) => `${i}: ${c.defName}`).join("\n");
  const input = window.prompt(`${label}\n${listText}\n番号を入力してください`, "0");
  const idx = Number(input);
  return Number.isInteger(idx) && candidates[idx] ? candidates[idx] : candidates[0];
}
const PARAM_BUILDERS = {
  投石: ({ opponent }) => ({ targetMonster: pickMonster(opponent.board.filter(Boolean), "対象の敵モンスター") }),
  ドラゴンの眼光: ({ opponent }) => ({ targetMonster: pickMonster(opponent.board.filter(Boolean), "破壊する敵モンスター") }),
  用意周到: ({ player }) => ({ targetHandUid: pickHandCard(player.hand, "保留を付与する手札")?.uid }),
  ドラゴンの血誓: ({ player }) => ({
    discardHandUid: pickHandCard(player.hand.filter((c) => CARD_DEFS[c.defName]?.race === "ドラゴン"), "墓地へ送るドラゴン種の手札")?.uid,
  }),
  滝の試練: ({ player }) => ({ discardHandUid: pickHandCard(player.hand, "捨てる手札")?.uid }),
  リバーススケイル: ({ player }) => ({
    targetMonster: pickMonster(player.board.filter((m) => m && (m.race === "ドラゴン" || m.race === "亜竜")), "攻撃力を上げる自分のモンスター"),
  }),
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
    instance.summonedOnTurn === game.globalTurn && !kws.includes(KEYWORDS.SOKKOU) && !kws.includes(KEYWORDS.TOTSUGEKI);
  if (sick) el.classList.add("sick");
  if (selectedAttacker === instance) el.classList.add("selected");
  el.innerHTML = `<div class="name">${instance.defName}</div><div class="stat-line">${instance.currentAtk} / ${instance.currentHp}</div><div class="keywords">${kws.join(" ")}</div>`;

  const isMyAction = game.gameStarted && game.activePlayerId === myPlayerId;

  if (ownerId === myPlayerId && isMyAction) {
    if (game.canTranscend(myPlayerId, instance)) {
      const btn = document.createElement("button");
      btn.className = "tr-btn";
      btn.textContent = "超越";
      btn.onclick = async (e) => {
        e.stopPropagation();
        try {
          game.useTranscend(myPlayerId, instance, {});
          await pushState();
        } catch (err) {
          alert(err.message);
        }
        render();
      };
      el.appendChild(btn);
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
  const isMyAction = game.gameStarted && game.activePlayerId === myPlayerId;

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
          const params = builder ? builder({ player, opponent }) : {};
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

  const isMyAction = game.activePlayerId === myPlayerId;

  // 「残す1枚」選択モード(自分の番)
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
          const params = builder ? builder({ player, opponent }) : {};
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
          const params = builder ? builder({ player, opponent }) : {};
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

function renderStats(role) {
  const ownerId = role === "me" ? myPlayerId : opponentId();
  const player = game.players[ownerId];
  const el = document.getElementById(`stats-${role}`);
  el.innerHTML = `HP: <b>${player.hp}</b> ／ シールド: <b>${player.shield}</b> ／ コスト: <b>${player.resourceAvailable}/${player.resourceCap}</b> ／ デッキ: ${player.deck.length} ／ ストレージ: ${player.storage.length} ／ 墓地: ${player.graveyard.length}`;

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
  if (!game) return;

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
      : `グローバルターン${game.globalTurn} / ${game.activePlayerId === myPlayerId ? "あなたの番" : "相手の番"}(フェイズ:${game.phase})`;

  renderStats("me");
  renderStats("opponent");
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

  if (game.winner) {
    let banner = document.querySelector(".winner-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "winner-banner";
      document.body.prepend(banner);
    }
    banner.textContent = game.winner === myPlayerId ? "あなたの勝利!" : "相手の勝利...";
  }
}

// ==========================================================
// ボタン操作
// ==========================================================
document.getElementById("btn-mulligan-me").onclick = async () => {
  try {
    game.mulligan(myPlayerId, [...mulliganReturn]);
    await pushState();
  } catch (err) {
    alert(err.message);
    return;
  }
  mulliganReturn = new Set();
  render();
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
