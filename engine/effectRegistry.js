import { KEYWORDS } from "./constants.js";

// カード名をキーに、フックを登録する。
// onSummon({game, player, instance, params})    … 場に出たとき
// onTranscend({game, player, instance, params}) … 超越の追加効果(基本効果に加えて発動)
// onLeaveField({game, player, instance})        … 場を離れたとき(墓地送りになった直後)
// onEvent({game, player, opponent, params})     … イベントカード発動時
// onOwnEndPhase({game, player, instance})       … 自分のエンドフェイズ時、場にいる限り毎ターン判定
// onKillInCombat({game, player, instance})      … このカードが攻撃側として敵を戦闘で破壊したとき
//
// 新しいカードを追加するときは、ここに1エントリ足すだけでよく、
// GameState.js 本体を書き換える必要はない。
// params は summonFromHand / useTranscend / playEvent の呼び出し側から
// 対象選択(例:「敵モンスター1体を選ぶ」)などを渡すために使う。

export const EFFECTS = {
  // ---------- 汎用 ----------
  投石: {
    onEvent({ game, opponent, params }) {
      const target = params.targetMonster;
      if (!target || !opponent.board.includes(target)) throw new Error("対象の敵モンスターを指定してください");
      game.dealDamageToMonster(opponent, target, 4);
    },
  },
  やり直し: {
    onEvent({ game, player }) {
      game.drawOne(player);
    },
  },
  祈り: {
    onEvent({ game, player }) {
      game.healPlayer(player, 4);
    },
  },
  痛いのは嫌なので: {
    onEvent({ player }) {
      player.shield += 8;
    },
  },
  用意周到: {
    onEvent({ player, params }) {
      const card = player.hand.find((c) => c.uid === params.targetHandUid);
      if (!card) throw new Error("保留を付与する手札を指定してください");
      card.hold = true;
    },
  },
  明日から本気出す: {
    onEvent({ player }) {
      player.deck.push(...player.storage);
      player.storage = [];
    },
  },
  シールドバッシュ: {
    onEvent({ opponent }) {
      opponent.shield = 0;
    },
  },
  福音受けし者: {
    onSummon({ game, opponent }) {
      game.dealDamageToAllEnemyMonsters(opponent, 4);
    },
    onTranscend({ game, opponent, params }) {
      const target = params.targetMonster ?? opponent.board.find(Boolean);
      if (target) game.destroyMonster(opponent, target);
    },
  },

  // ---------- 赤テーマ ----------
  竜餐の祭日: {
    onEvent({ game, player }) {
      if (!game.dragonKilledThisTurnByCombat) {
        throw new Error("このターン、ドラゴン種が戦闘でモンスターを破壊していないと使用できません");
      }
      game.drawOne(player);
    },
  },
  ドラゴンの血誓: {
    onEvent({ game, player, params }) {
      const card = player.hand.find((c) => c.uid === params.discardHandUid);
      if (!card) throw new Error("墓地へ送る手札のドラゴン種を指定してください");
      const idx = player.hand.indexOf(card);
      player.hand.splice(idx, 1);
      player.graveyard.push(card.defName);
      game.forceDraw(player, 2);
    },
  },
  リバーススケイル: {
    onEvent({ player, params }) {
      const target = params.targetMonster;
      if (!target || !player.board.includes(target)) throw new Error("対象の自分のモンスターを指定してください");
      target.currentAtk += 8;
      target.tempAtkThisTurn += 8; // ターン終了時まで(endTurn()で自動的に元へ戻る)
    },
  },
  ドラゴンの招集: {
    onEvent({ player, params }) {
      if (!player.board.some((m) => m && m.race === "ドラゴン")) {
        throw new Error("自分の場にドラゴン種がいないと発動できません");
      }
      const eligible = player.graveyard.filter((n) => CARD_DEF_RACE(n) === "亜竜");
      if (eligible.length === 0) {
        throw new Error("墓地に亜竜種がいないと発動できません");
      }
      let chosenNames;
      if (params?.returnTargets && params.returnTargets.length > 0) {
        chosenNames = [];
        const pool = [...eligible];
        for (const n of params.returnTargets.slice(0, 2)) {
          const idx = pool.indexOf(n);
          if (idx !== -1) {
            chosenNames.push(n);
            pool.splice(idx, 1);
          }
        }
      } else {
        // 選択の余地がない(1体のみ)場合、または選択が渡されなかった場合は上から(最大2体)戻す
        chosenNames = eligible.slice(0, 2);
      }
      for (const n of chosenNames) {
        const idx = player.graveyard.indexOf(n);
        if (idx !== -1) {
          player.graveyard.splice(idx, 1);
          player.deck.push(n);
        }
      }
    },
  },
  滝の試練: {
    onEvent({ player, params }) {
      const discard = player.hand.find((c) => c.uid === params.discardHandUid);
      if (!discard) throw new Error("捨てる手札を指定してください");
      player.hand.splice(player.hand.indexOf(discard), 1);
      player.graveyard.push(discard.defName);

      const fromDeckIdx = player.deck.findIndex((n) => CARD_DEF_RACE(n) === "ドラゴン");
      if (fromDeckIdx !== -1) {
        const [n] = player.deck.splice(fromDeckIdx, 1);
        player.hand.push({ uid: `t${Date.now()}${Math.random()}`, defName: n, hold: false });
        return;
      }
      const fromStorageIdx = player.storage.findIndex((n) => CARD_DEF_RACE(n) === "ドラゴン");
      if (fromStorageIdx !== -1) {
        const [n] = player.storage.splice(fromStorageIdx, 1);
        player.hand.push({ uid: `t${Date.now()}${Math.random()}`, defName: n, hold: false });
      }
    },
  },
  エッグ・シーフ: {
    onSummon({ player }) {
      // ①場に出たとき、デッキ・ストレージから『ドラゴンの卵』を1枚手札に加える(デッキ優先)
      const fromDeckIdx = player.deck.findIndex((n) => n === "ドラゴンの卵");
      if (fromDeckIdx !== -1) {
        const [n] = player.deck.splice(fromDeckIdx, 1);
        player.hand.push({ uid: `t${Date.now()}${Math.random()}`, defName: n, hold: false });
        return;
      }
      const fromStorageIdx = player.storage.findIndex((n) => n === "ドラゴンの卵");
      if (fromStorageIdx !== -1) {
        const [n] = player.storage.splice(fromStorageIdx, 1);
        player.hand.push({ uid: `t${Date.now()}${Math.random()}`, defName: n, hold: false });
      }
    },
    onLeaveField({ player }) {
      // ②場から離れたとき、墓地にある『ドラゴンの卵』をすべてデッキに加える
      player.graveyard = player.graveyard.filter((n) => {
        if (n === "ドラゴンの卵") {
          player.deck.push(n);
          return false;
        }
        return true;
      });
    },
  },
  ドラゴンの眼光: {
    onEvent({ game, player, opponent, params }) {
      if (!player.board.some((m) => m && m.race === "ドラゴン")) {
        throw new Error("自分の場にドラゴン種がいないと発動できません");
      }
      const target = params.targetMonster;
      if (!target || !opponent.board.includes(target)) throw new Error("対象の敵モンスターを指定してください");
      game.destroyMonster(opponent, target);
    },
  },
  エリマキドラゴン: {
    onSummon({ game, player }) {
      game.drawOne(player);
    },
  },
  洞窟を守る地竜: {
    onTranscend({ game, player }) {
      for (let i = 0; i < 2; i++) {
        const slot = game.findEmptySlot(player);
        if (slot === -1) break;
        game.specialSummonToken(player.id, "洞窟を守る地竜", slot);
      }
    },
  },
  老練の竜使い: {
    onSummon({ game, player }) {
      game.buffOwnRace(player, "ドラゴン", 8, 0);
    },
    onTranscend({ game, player, params }) {
      const target =
        params.targetMonster ?? player.board.find((m) => m && (m.race === "ドラゴン" || m.race === "亜竜"));
      if (target) target.grantedKeywords.add(KEYWORDS.KANTSUU);
    },
  },
  レッドドラゴン: {
    onSummon({ game, opponent, params }) {
      const target = params.targetMonster ?? opponent.board.find(Boolean);
      if (target) game.dealDamageToMonster(opponent, target, 16);
    },
  },
  ブルードラゴン: {
    onSummon({ game, opponent }) {
      game.dealDamageToAllEnemyMonsters(opponent, 8);
    },
  },
  クロデカス・ワイバーン: {
    onSummon({ game, player }) {
      for (let i = 0; i < 2; i++) {
        const slot = game.findEmptySlot(player);
        if (slot === -1) break;
        game.specialSummonToken(player.id, "ワイバーン", slot);
      }
      for (const m of player.board) {
        if (m && m.defName === "ワイバーン") m.grantedKeywords.add(KEYWORDS.SOKKOU);
      }
    },
  },
  デスラトル: {
    onEvent({ game, player, opponent, params }) {
      const sources = [...player.board.filter(Boolean), ...player.hand].filter((c) =>
        c.race === "亜竜" || CARD_DEF_RACE(c.defName) === "亜竜"
      );
      const chosen = params.sacrifices; // [{from:'board'|'hand', ref}] を2つ渡す想定
      if (!chosen || chosen.length !== 2) throw new Error("場・手札から亜竜種2体を指定してください");
      for (const c of chosen) {
        if (c.from === "board") {
          game.sendToGraveyard(player, c.ref);
        } else {
          const idx = player.hand.indexOf(c.ref);
          if (idx !== -1) {
            player.hand.splice(idx, 1);
            player.graveyard.push(c.ref.defName);
          }
        }
      }
      const targets = params.targetMonsters ?? opponent.board.filter(Boolean).slice(0, 2);
      for (const t of targets) game.dealDamageToMonster(opponent, t, 16);
    },
  },
  オルレアホワイト・ドラゴン: {
    onOwnEndPhase({ game, opponent, instance }) {
      // 正: 敵モンスターの現在HPが「このカードの現在の攻撃力(超越等の増加分も含む)」より
      // 低いものをすべて破壊する(誤って自身のHPと比較していたバグを修正)
      for (const m of [...opponent.board]) {
        if (m && m.currentHp < instance.currentAtk) {
          game.destroyMonster(opponent, m);
        }
      }
    },
    onTranscend({ game, player }) {
      game.forceDraw(player, 2);
    },
  },
  右腕を失くしたゴ・ド・リック: {
    onSummon({ game, player }) {
      const slot = game.findEmptySlot(player);
      if (slot === -1) return;
      game.specialSummonToken(player.id, "ゴ・ド・リックの右腕", slot, {
        grantedKeywords: [KEYWORDS.CHOUHATSU],
      });
    },
    onTranscend({ game, player }) {
      const migi = player.board.find((m) => m && m.defName === "ゴ・ド・リックの右腕");
      if (!migi) return;
      migi.currentAtk += 8;
      migi.currentHp += 4;
      migi.grantedKeywords.add(KEYWORDS.TOTSUGEKI);
    },
    onLeaveField({ game, player }) {
      const migi = player.board.find((m) => m && m.defName === "ゴ・ド・リックの右腕");
      if (migi) game.sendToGraveyard(player, migi);
    },
  },
  ダリアバーミリオン・ドラゴン: {
    onSummon({ game, player, opponent, params }) {
      const target = params.targetMonster ?? opponent.board.find(Boolean);
      if (target) game.dealDamageToMonster(opponent, target, 24);
      game.grantKeywordToOwnRaces(player, ["亜竜"], KEYWORDS.SOKKOU);
    },
    onTranscend({ game, player, opponent }) {
      game.queueEndPhaseEffect(player.id, () => {
        opponent.hp -= 20;
        game.log(`${player.id}: ダリアバーミリオン・ドラゴンの超越効果で相手に20ダメージ`);
        game.checkWinCondition();
      });
    },
  },
  デルフィニウムアズール・ドラゴン: {
    onSummon({ game, player, opponent }) {
      game.dealDamageToAllEnemyMonsters(opponent, 12);
      const grave = player.graveyard.find((n) => CARD_DEF_RACE(n) === "亜竜");
      if (grave) {
        const slot = game.findEmptySlot(player);
        if (slot !== -1) {
          player.graveyard.splice(player.graveyard.indexOf(grave), 1);
          game.specialSummonToken(player.id, grave, slot, { grantedKeywords: [KEYWORDS.CHOUHATSU] });
        }
      }
    },
    onTranscend({ game, player }) {
      game.queueEndPhaseEffect(player.id, () => {
        game.healPlayer(player, 24);
      });
    },
  },
  エンダーリコリス・ワイバーン: {
    onSummon({ game, player, params }) {
      const eligible = player.graveyard.filter((n) => CARD_DEF_RACE(n) === "亜竜");
      let chosen;
      if (params?.reviveTargets && params.reviveTargets.length > 0) {
        // UI側で選択された対象を優先する(存在確認しつつ、同名重複も1体ずつ正しく消費する)
        chosen = [];
        const pool = [...eligible];
        for (const n of params.reviveTargets.slice(0, 2)) {
          const idx = pool.indexOf(n);
          if (idx !== -1) {
            chosen.push(n);
            pool.splice(idx, 1);
          }
        }
      } else {
        // 選択の余地がない(2体以下)場合、または選択が渡されなかった場合は全て(最大2体)蘇生する
        chosen = eligible.slice(0, 2);
      }
      for (const n of chosen) {
        const slot = game.findEmptySlot(player);
        if (slot === -1) break;
        player.graveyard.splice(player.graveyard.indexOf(n), 1);
        game.specialSummonToken(player.id, n, slot);
      }
    },
    onTranscend({ game, player }) {
      game.buffOwnRace(player, "亜竜", 8, 4);
      game.grantKeywordToOwnRaces(player, ["亜竜"], KEYWORDS.CHOUHATSU);
    },
  },
  ドラゴニュート・キング: {
    onSummon({ game, player }) {
      const idx = player.deck.findIndex((n) => CARD_DEF_RACE(n) === "竜人");
      if (idx !== -1) {
        const [n] = player.deck.splice(idx, 1);
        player.hand.push({ uid: `t${Date.now()}${Math.random()}`, defName: n, hold: false });
      }
    },
    onKillInCombat({ game, player, instance }) {
      if (instance.onceEffectUsedThisTurn.dragonyuteKing) return;
      instance.onceEffectUsedThisTurn.dragonyuteKing = true;
      instance.hasAttackedThisTurn = false;
      game.log(`${player.id}: ドラゴニュート・キングが撃破ボーナスでもう一度攻撃可能に`);
    },
  },
};

// 墓地・デッキ・ストレージには defName(文字列)しか積んでいないため、
// 種族参照が必要な効果のために簡易ルックアップを用意する。
import { CARD_DEFS } from "./cardDefinitions.js";
function CARD_DEF_RACE(defName) {
  return CARD_DEFS[defName]?.race ?? null;
}
