import { GameState } from "../engine/GameState.js";
import { KEYWORDS, CONFIG } from "../engine/constants.js";
import { CARD_DEFS } from "../engine/cardDefinitions.js";

// ==========================================================
// ログ
// ==========================================================
const logEl = document.getElementById("log-content");
function pushLog(msg) {
  const line = document.createElement("div");
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

// ==========================================================
// テスト用デッキ(スプレッドシートの全カードを最低1枚ずつ、
// コピー可能なものは3枚まで積んだ簡易デッキ)
// ==========================================================
function buildSampleDeck() {
  const list = [];
  for (const [name, def] of Object.entries(CARD_DEFS)) {
    const copies = def.copyLimit ?? CONFIG.DEFAULT_COPY_LIMIT;
    for (let i = 0; i < Math.min(copies, 2); i++) list.push(name);
  }
  return list;
}

const game = new GameState({
  player1Deck: buildSampleDeck(),
  player2Deck: buildSampleDeck(),
  firstPlayerId: "p1",
  log: pushLog,
});
game.startGame();

// ==========================================================
// UI状態
// ==========================================================
let selectedHandCard = null; // { playerId, uid, defName, type }
let selectedAttacker = null; // instance
let keepSelection = null; // 次ターン開始時「残す1枚」選択中: { playerId, nonHold: [...], chosenUid: null } | null
let mulliganReturn = { p1: new Set(), p2: new Set() }; // ゲーム開始時マリガンで「デッキに戻す」に選んだ手札uid

// カード効果に渡すパラメータを組み立てる。対象が2件以上あるときは
// クリックで選べるモーダルを表示する(window.promptはブラウザ環境によって
// 動かないことがあるため使用しない)。
//
// キャンセル(モーダルの「キャンセル」を押す)は、実際に選択を求めた場合のみ
// 検知できる。CANCELLEDを返すことで、呼び出し側(PARAM_BUILDERS)が
// カード発動そのものを中断できるようにする。
export const CANCELLED = Symbol("cancelled");

function pickFromList(items, label, renderLabel) {
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

// PARAM_BUILDERSは、キャンセルされたらnullを返す(=カード発動自体を中断する合図)。
// それ以外は通常通りparamsオブジェクトを返す。すべて非同期(モーダル待ち)。
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
    const c = await pickHandCard(
      player.hand.filter((c) => c.uid !== selfUid && CARD_DEFS[c.defName]?.race === "ドラゴン"),
      "墓地へ送るドラゴン種の手札"
    );
    if (c === CANCELLED) return null;
    return { discardHandUid: c?.uid };
  },
  滝の試練: async ({ player, selfUid }) => {
    const c = await pickHandCard(player.hand.filter((c) => c.uid !== selfUid), "捨てる手札");
    if (c === CANCELLED) return null;
    return { discardHandUid: c?.uid };
  },
  リバーススケイル: async ({ player }) => {
    const t = await pickMonster(
      player.board.filter((m) => m && (m.race === "ドラゴン" || m.race === "亜竜")),
      "攻撃力を上げる自分のモンスター"
    );
    if (t === CANCELLED) return null;
    return { targetMonster: t };
  },
};

// 超越の追加効果で対象選択が必要なカード。効果文に「ランダム」と書かれていない
// 限り、原則プレイヤーが選ぶ(福音受けし者・老練の竜使い)。
// こちらもキャンセルでnullを返し、超越そのものを中断する。
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

// ==========================================================
// レンダリング
// ==========================================================
function keywordSet(instance) {
  return new Set([...instance.baseKeywords, ...instance.grantedKeywords]);
}

function renderMonsterCard(playerId, instance, slot) {
  const el = document.createElement("div");
  el.className = "card";
  const kws = [...keywordSet(instance)];
  const sick = instance.summonedOnTurn === game.turnNumber && !kws.includes(KEYWORDS.SOKKOU) && !kws.includes(KEYWORDS.TOTSUGEKI);
  if (sick) el.classList.add("sick");
  if (selectedAttacker === instance) el.classList.add("selected");

  el.innerHTML = `
    <div class="name">${instance.defName}</div>
    <div class="stat-line">${instance.currentAtk} / ${instance.currentHp}</div>
    <div class="keywords">${kws.join(" ")}</div>
  `;

  if (playerId === game.activePlayerId && !game.winner) {
    const trStatus = game.transcendStatus(playerId, instance);
    if (trStatus.available) {
      const btn = document.createElement("button");
      btn.className = "tr-btn";
      btn.textContent = "超越(使用可能)";
      btn.onclick = async (e) => {
        e.stopPropagation();
        const player = game.players[playerId];
        const opponent = game.players[game.opponentOf(playerId)];
        const builder = TRANSCEND_PARAM_BUILDERS[instance.defName];
        const params = builder ? await builder({ player, opponent }) : {};
        if (params === null) return; // 対象選択をキャンセル → 超越自体を中断
        try {
          game.useTranscend(playerId, instance, params);
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
  } else if (!game.winner) {
    // 相手モンスター: 攻撃対象として選択中なら攻撃実行
    el.onclick = () => {
      if (!selectedAttacker) return;
      try {
        game.attack(game.activePlayerId, selectedAttacker, { type: "monster", instance });
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

function renderBoard(playerId) {
  const container = document.getElementById(`board-${playerId}`);
  container.innerHTML = "";
  const player = game.players[playerId];
  player.board.forEach((m, slot) => {
    if (m) {
      container.appendChild(renderMonsterCard(playerId, m, slot));
    } else {
      const el = renderEmptySlot();
      if (playerId === game.activePlayerId && !game.winner && selectedHandCard && selectedHandCard.type === "モンスター") {
        el.classList.remove("empty-slot");
        el.textContent = "ここに召喚";
        el.onclick = async () => {
          const opponent = game.players[game.opponentOf(playerId)];
          const builder = PARAM_BUILDERS[selectedHandCard.defName];
          const params = builder ? await builder({ player, opponent, selfUid: selectedHandCard.uid }) : {};
          if (params === null) {
            // 対象選択をキャンセルした場合は、召喚自体を中断する(相手に公開しない)
            render();
            return;
          }
          try {
            game.summonFromHand(playerId, selectedHandCard.uid, slot, params);
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

  // イベントゾーン(現状の実装ではイベントは即座に解決されるため常に空。
  // ルール上の見た目を合わせるための表示専用の5枠目)
  const eventZone = document.createElement("div");
  eventZone.className = "card empty-slot event-zone";
  eventZone.textContent = "イベントゾーン";
  container.appendChild(eventZone);
}

function renderHand(playerId) {
  const container = document.getElementById(`hand-${playerId}`);
  container.innerHTML = "";
  const player = game.players[playerId];

  // ゲーム開始時のマリガン画面
  if (!game.gameStarted) {
    const done = game.mulliganDone[playerId];
    for (const c of player.hand) {
      const def = CARD_DEFS[c.defName];
      const el = document.createElement("div");
      el.className = "card";
      const marked = mulliganReturn[playerId].has(c.uid);
      if (marked) el.classList.add("selected");
      el.innerHTML = `<div class="name">${c.defName}${marked ? "(戻す)" : ""}</div><div class="stat-line">コスト${def?.cost ?? "?"} ${def?.type ?? ""}</div>`;
      if (!done) {
        el.onclick = () => {
          if (marked) mulliganReturn[playerId].delete(c.uid);
          else mulliganReturn[playerId].add(c.uid);
          render();
        };
      } else {
        el.style.opacity = "0.5";
      }
      container.appendChild(el);
    }
    return;
  }

  // 次のプレイヤーのターン開始時「残す1枚」選択モード中は、専用の選択UIに切り替える
  if (keepSelection && playerId === keepSelection.playerId) {
    for (const c of keepSelection.nonHold) {
      const def = CARD_DEFS[c.defName];
      const el = document.createElement("div");
      el.className = "card";
      const chosen = keepSelection.chosenUid === c.uid;
      if (chosen) el.classList.add("selected");
      el.innerHTML = `<div class="name">${c.defName}</div><div class="stat-line">コスト${def?.cost ?? "?"} ${def?.type ?? ""}</div>`;
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
    el.innerHTML = `
      <div class="name">${c.defName}${c.hold ? " (保留)" : ""}</div>
      <div class="stat-line">コスト${def?.cost ?? "?"} ${def?.type ?? ""}</div>
      ${def?.type === "モンスター" ? `<div class="stat-line">${def.atk}/${def.hp}</div>` : ""}
    `;
    if (playerId === game.activePlayerId && !game.winner) {
      el.onclick = async () => {
        if (def?.type === "イベント") {
          const opponent = game.players[game.opponentOf(playerId)];
          const builder = PARAM_BUILDERS[c.defName];
          const params = builder ? await builder({ player, opponent, selfUid: c.uid }) : {};
          if (params === null) return; // 対象選択をキャンセル → 発動自体を中断(相手に公開しない)
          try {
            game.playEvent(playerId, c.uid, params);
          } catch (err) {
            alert(err.message);
          }
          render();
          return;
        }
        if (def?.releaseRequirement) {
          // リリース召喚カードは、リリース対象がいた枠にそのまま出るため
          // 空き枠を選ばせず、クリックした時点で即座に召喚を試みる
          const opponent = game.players[game.opponentOf(playerId)];
          const builder = PARAM_BUILDERS[c.defName];
          const params = builder ? await builder({ player, opponent, selfUid: c.uid }) : {};
          if (params === null) return; // 対象選択をキャンセル → 召喚自体を中断
          try {
            game.summonFromHand(playerId, c.uid, null, params);
          } catch (err) {
            alert(err.message);
          }
          render();
          return;
        }
        selectedHandCard = selectedHandCard?.uid === c.uid ? null : { playerId, uid: c.uid, defName: c.defName, type: def?.type };
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

function renderStats(playerId) {
  const player = game.players[playerId];
  const el = document.getElementById(`stats-${playerId}`);

  el.innerHTML = `
    HP: <b>${player.hp}</b> ／
    シールド: <b>${player.shield}</b> ／
    コスト: <b>${player.resourceAvailable}/${player.resourceCap}</b> ／
    デッキ: <span class="zone-link" data-zone="deck" data-owner="${playerId}">${player.deck.length}</span> ／
    ストレージ: <span class="zone-link" data-zone="storage" data-owner="${playerId}">${player.storage.length}</span> ／
    墓地: <span class="zone-link" data-zone="graveyard" data-owner="${playerId}">${player.graveyard.length}</span> ／
    除外: <span class="zone-link" data-zone="exile" data-owner="${playerId}">${(player.exile ?? []).length}</span>
    ${
      player.id === game.secondPlayerId
        ? `<button id="bonus-draw-btn" ${
            player.secondPlayerBonusDrawsRemaining <= 0 || player.secondPlayerBonusDrawUsedThisTurn ? "disabled" : ""
          }>後攻追加ドローを使う(残り${player.secondPlayerBonusDrawsRemaining}回${
            player.secondPlayerBonusDrawUsedThisTurn ? "・このターンは使用済み" : ""
          })</button>`
        : ""
    }
  `;
  for (const link of el.querySelectorAll(".zone-link")) {
    link.onclick = () => openZoneModal(link.dataset.owner, link.dataset.zone);
  }
  const bonusBtn = document.getElementById("bonus-draw-btn");
  if (bonusBtn) {
    bonusBtn.onclick = () => {
      try {
        game.useSecondPlayerBonusDraw(playerId);
      } catch (err) {
        alert(err.message);
      }
      render();
    };
  }
}

function render() {
  if (!game.gameStarted) {
    document.getElementById("turn-info").textContent = "マリガンフェーズ(両者とも準備ができたら確定してください)";
    renderStats("p1");
    renderStats("p2");
    document.getElementById("board-p1").innerHTML = "";
    document.getElementById("board-p2").innerHTML = "";
    renderHand("p1");
    renderHand("p2");

    document.getElementById("btn-end-turn").style.display = "none";
    document.getElementById("btn-confirm-keep").style.display = "none";
    document.getElementById("btn-attack-face").style.display = "none";
    document.getElementById("btn-cancel-select").style.display = "none";

    const btnM1 = document.getElementById("btn-mulligan-p1");
    const btnM2 = document.getElementById("btn-mulligan-p2");
    btnM1.style.display = "";
    btnM2.style.display = "";
    btnM1.disabled = game.mulliganDone.p1;
    btnM2.disabled = game.mulliganDone.p2;
    btnM1.textContent = game.mulliganDone.p1 ? "P1: マリガン済み" : `P1: マリガン確定(戻す${mulliganReturn.p1.size}枚)`;
    btnM2.textContent = game.mulliganDone.p2 ? "P2: マリガン済み" : `P2: マリガン確定(戻す${mulliganReturn.p2.size}枚)`;
    document.getElementById("selection-info").textContent =
      "戻したいカードをクリックして選び、準備ができたら各プレイヤーの確定ボタンを押してください(0枚のままでもOK)";
    return;
  }

  document.getElementById("btn-mulligan-p1").style.display = "none";
  document.getElementById("btn-mulligan-p2").style.display = "none";
  document.getElementById("btn-attack-face").style.display = "";
  document.getElementById("btn-cancel-select").style.display = "";

  document.getElementById("turn-info").textContent =
    `ターン${game.turnNumber} / ${game.activePlayerId}のターン(フェイズ:${game.phase})`;

  renderStats("p1");
  renderStats("p2");

  if (game.winner) {
    // 勝敗が決まったら、盤面・手札は最終状態を表示するだけにして
    // クリック操作は一切受け付けないようにする(誤操作防止)
    renderBoard("p1");
    renderBoard("p2");
    renderHand("p1");
    renderHand("p2");
    document.getElementById("btn-attack-face").style.display = "none";
    document.getElementById("btn-cancel-select").style.display = "none";
    document.getElementById("btn-end-turn").style.display = "none";
    document.getElementById("btn-confirm-keep").style.display = "none";
    document.getElementById("selection-info").textContent = "";

    let banner = document.querySelector(".winner-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "winner-banner";
      document.body.prepend(banner);
    }
    banner.innerHTML = "";
    const text = document.createElement("span");
    text.textContent = `${game.winner} の勝利!`;
    banner.appendChild(text);
    const restartBtn = document.createElement("button");
    restartBtn.textContent = "新しい対戦を始める";
    restartBtn.style.marginLeft = "12px";
    restartBtn.onclick = () => location.reload();
    banner.appendChild(restartBtn);
    return;
  }

  renderBoard("p1");
  renderBoard("p2");
  renderHand("p1");
  renderHand("p2");

  document.getElementById("btn-attack-face").disabled = !selectedAttacker;
  document.getElementById("btn-end-turn").style.display = keepSelection ? "none" : "";
  document.getElementById("btn-confirm-keep").style.display = keepSelection ? "" : "none";
  document.getElementById("selection-info").textContent = keepSelection
    ? `${keepSelection.playerId}の次ターン手札:残す${CONFIG.HAND_KEEP_SIZE}枚まで選択中(クリックで選択/解除、未選択のまま確定すると「何も残さない」)`
    : selectedAttacker
    ? `選択中: ${selectedAttacker.defName}(攻撃対象は相手モンスターをクリック、またはプレイヤーへ直接攻撃ボタン)`
    : selectedHandCard
    ? `選択中の手札: ${selectedHandCard.defName}(空き枠をクリックして召喚)`
    : "";
}

document.getElementById("btn-end-turn").onclick = () => {
  if (keepSelection) return; // 選択モード中はこのボタンでは何もしない(専用の確定ボタンを使う)
  selectedAttacker = null;
  selectedHandCard = null;

  const nextId = game.opponentOf(game.activePlayerId);
  try {
    game.endTurn();
  } catch (err) {
    alert(err.message);
    return;
  }
  const needed = game.peekKeepSelection(nextId);
  if (needed) {
    keepSelection = { playerId: nextId, nonHold: needed, chosenUid: null };
    render();
    return;
  }
  game.startTurn(nextId);
  render();
};

document.getElementById("btn-confirm-keep").onclick = () => {
  if (!keepSelection) return;
  // chosenUidがnullのままなら「何も残さない」という明示的な選択として扱う
  try {
    game.startTurn(keepSelection.playerId, keepSelection.chosenUid);
  } catch (err) {
    alert(err.message);
    return;
  }
  keepSelection = null;
  render();
};

document.getElementById("btn-attack-face").onclick = () => {
  if (!selectedAttacker) return;
  try {
    game.attack(game.activePlayerId, selectedAttacker, { type: "player" });
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

document.getElementById("btn-mulligan-p1").onclick = () => {
  try {
    game.mulligan("p1", [...mulliganReturn.p1]);
  } catch (err) {
    alert(err.message);
    return;
  }
  mulliganReturn.p1 = new Set();
  render();
};

document.getElementById("btn-mulligan-p2").onclick = () => {
  try {
    game.mulligan("p2", [...mulliganReturn.p2]);
  } catch (err) {
    alert(err.message);
    return;
  }
  mulliganReturn.p2 = new Set();
  render();
};

render();
