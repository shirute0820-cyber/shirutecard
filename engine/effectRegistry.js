import { KEYWORDS, CONFIG } from "./constants.js";

// カード名をキーに、フックを登録する。
// onSummon({game, player, instance, params})    … 場に出たとき
// onTranscend({game, player, instance, params}) … 超越の追加効果(基本効果に加えて発動)
// onLeaveField({game, player, opponent, instance})        … 場を離れたとき(墓地送りになった直後)
// onEvent({game, player, opponent, params})     … イベントカード発動時
// onOwnEndPhase({game, player, instance})       … 自分のエンドフェイズ時、場にいる限り毎ターン判定
// onKillInCombat({game, player, opponent, instance}) … このカードが攻撃側として敵を戦闘で破壊したとき
// onActivate({game, player, opponent, instance, params}) … 「1ターンに1度発動可能」等の起動効果
//   (summonedOnTurn/超越/イベントに紐付かない、プレイヤーが任意タイミングで発動するモンスター効果。
//    1体につき1つを想定し、onceEffectUsedThisTurn.ability で毎ターン自動リセットされる)
//
// --- 2026/08/16 トリッカーテーマ(毒)追加分の新規フック ---
// onCombat({game, player, opponent, instance, enemyInstance}) … 交戦時(攻撃側・防御側どちらでも)、
//   通常のダメージ計算より前に発火。攻撃側・防御側の両方に対して個別に呼ばれる
// onAfterAttack の params に targetType('player'|'monster') が追加された。直接攻撃かどうかで
//   挙動を分けるカード(ミニタランチュラ・毒の探究者ゴゴ等)が利用する
// onDrawCard({game, player, opponent, instance}) … このカードの持ち主が自分でカードを1枚
//   ドローするたびに発火(ドクター・ポイズン③)
// onPoisonChanged({game, player, instance, delta}) … このカード自身の毒の値が変化するたびに
//   発火。常時計算で体力等に反映させたいカード用(デカめのサソリ②)
// onZoneActivate({game, player, opponent, params}) … 持続イベント(イベントゾーン設置カード)
//   自身が持つ、プレイヤーが任意タイミングで発動できる起動効果(ポイズン・ラボ③)
// onAllySummon({game, player, instance, newInstance}) … 自分の場に新しいモンスターが
//   召喚されるたびに発火。「自分が場にいる限り、新しく出た味方◯◯は+△/+□される」系の
//   常時効果用(タランチュラベイビー②、実装はタランチュラ・クイーン側)
// blocksDirectPlayerDamage: true … 相手プレイヤーへ直接攻撃してもHPを減らせない
//   (シールドは通常通り消費できる。毒の探究者ゴゴ①)
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
    // 2026/08 改訂: 「1ドロー」から「手札2枚をストレージに移してから2ドロー」に変更。
    // 対象の2枚はplayEvent側でまだ手札から取り除かれていない(このカード自身も含む)ため、
    // 自分自身(selfHandUid)は候補から除外する。手札(自分自身を除く)が2枚以下のときは
    // 選択の余地がないため自動的に全部ストレージへ移す(用意周到等と同じ考え方)。
    onEvent({ game, player, params, selfHandUid }) {
      const poolUids = player.hand.filter((c) => c.uid !== selfHandUid).map((c) => c.uid);
      const targetUids =
        params.discardHandUids && params.discardHandUids.length > 0
          ? params.discardHandUids.filter((uid) => poolUids.includes(uid))
          : poolUids;
      for (const uid of targetUids) {
        const idx = player.hand.findIndex((c) => c.uid === uid);
        if (idx !== -1) {
          const [card] = player.hand.splice(idx, 1);
          player.storage.push(card.defName);
        }
      }
      game.forceDraw(player, 2);
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
  // 2026/08 追加: 「①相手の場にモンスターが存在しないとき、これは【速攻】を持つ」。
  // 固定付与ではなく、参照するたびに再判定する条件付きキーワードのため、
  // grantedKeywordsではなくconditionalKeywordフック(hasKeyword側で都度評価)で実装する。
  死神: {
    conditionalKeyword({ opponent }) {
      return opponent.board.some(Boolean) ? [] : [KEYWORDS.SOKKOU];
    },
  },
  // 2026/08/21新規実装: スプレッドシートには存在していたが、cardDefinitions.js側に
  // カード定義自体が漏れており発動できない状態だった(未定義カードエラーになる)。
  // 「手札のイベント(通常/持続とも)を1枚墓地に送ることで発動できる」という発動コストを
  // ドラゴンの血誓・滝の試練と同じparams.discardHandUidパターンで実装する。
  タイフーン: {
    onEvent({ game, player, opponent, params }) {
      const discard = player.hand.find((c) => c.uid === params.discardHandUid);
      if (!discard) throw new Error("墓地へ送る手札のイベントカードを指定してください");
      const discardDef = CARD_DEFS[discard.defName];
      if (!discardDef || (discardDef.type !== "イベント" && discardDef.type !== "持続イベント")) {
        throw new Error("墓地へ送るカードはイベント(または持続イベント)である必要があります");
      }
      player.hand.splice(player.hand.indexOf(discard), 1);
      player.graveyard.push(discard.defName);
      // 対象(相手のイベントゾーン)が無ければ、コストだけ支払って不発になる
      // (レッドドラゴン・ブルードラゴン等と同じ「対象が見つからなければ何もしない」設計)
      if (opponent.eventZone) {
        game.destroyEventZoneCard(opponent.id, "『タイフーン』の効果で");
      }
    },
  },

  // ---------- ドラゴニアテーマ(旧・赤テーマ) ----------
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

      // どのドラゴン種を加えるかはプレイヤーが選ぶ(UI側のPARAM_BUILDERSで候補を
      // 提示し、選ばれた名前をfetchDefNameとして受け取る。デッキ優先・ストレージは
      // デッキに無い場合のみ参照)
      const chosenName = params.fetchDefName;
      if (!chosenName) throw new Error("デッキ・ストレージから手札に加えるドラゴン種を指定してください");

      const fromDeckIdx = player.deck.indexOf(chosenName);
      if (fromDeckIdx !== -1) {
        player.deck.splice(fromDeckIdx, 1);
        player.hand.push({ uid: `t${Date.now()}${Math.random()}`, defName: chosenName, hold: false });
        return;
      }
      const fromStorageIdx = player.storage.indexOf(chosenName);
      if (fromStorageIdx !== -1) {
        player.storage.splice(fromStorageIdx, 1);
        player.hand.push({ uid: `t${Date.now()}${Math.random()}`, defName: chosenName, hold: false });
        return;
      }
      throw new Error("指定されたカードがデッキ・ストレージに見つかりません");
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
  // 2026/08 追加: 初の「持続イベント(イベントゾーン設置型)」カード。
  // ①手札のドラゴン種のコスト-1 → zoneHandCostReduction(コスト計算のたびに動的評価、GameState.getEffectiveHandCost経由)
  // ②自分の場のドラゴン・亜竜+4/+4 → イベントゾーンに設置された瞬間(onZoneEnter)に既存の対象へ、
  //    以後の召喚のたびに(onZoneSummon)新規の対象へ、それぞれ実際にcurrentAtk/currentHpへ加算する方式。
  //    (このゲームにはアタック値のような「実効値オーバーレイ」の仕組みがHPには無いため、天啓の聖女ジャンヌ・ダルクの
  //    オーラのような常時計算方式ではなく、他の恒久バフ効果と同じ直接加算方式を採用。
  //    このカードがイベントゾーンを離れるとき(onZoneLeave)に、付与した分を正確に巻き戻す)
  // ③自分の元コスト6以上のドラゴンが戦闘で破壊されるとき、竜の里自身を墓地へ送ることで破壊を無効化する。
  //    「できる」効果だが、竜の里を温存するより大型ドラゴンを守る方が基本的に得なため、
  //    現状は条件を満たせば自動的に無効化する簡易実装にしている(プレイヤーが選べるようにする場合は要相談)。
  竜の里: {
    zoneHandCostReduction({ def }) {
      return def.race === "ドラゴン" ? 1 : 0;
    },
    onZoneEnter({ player }) {
      for (const m of player.board) {
        if (m && (m.race === "ドラゴン" || m.race === "亜竜")) {
          m.currentAtk += 4;
          m.currentHp += 4;
          m.ryuunoSatoBuffed = true;
        }
      }
    },
    onZoneSummon({ instance }) {
      if (instance.race === "ドラゴン" || instance.race === "亜竜") {
        instance.currentAtk += 4;
        instance.currentHp += 4;
        instance.ryuunoSatoBuffed = true;
      }
    },
    onZoneLeave({ game, player, protectedInstance }) {
      for (const m of player.board) {
        if (m && m.ryuunoSatoBuffed) {
          m.currentAtk -= 4;
          m.currentHp -= 4;
          delete m.ryuunoSatoBuffed;
          if (m !== protectedInstance && m.currentHp <= 0) game.sendToGraveyard(player, m);
        }
      }
    },
    preventCombatDestruction({ game, player, instance }) {
      const def = CARD_DEFS[instance.defName];
      if (!def || def.race !== "ドラゴン" || (def.cost ?? 0) < 6) return false;
      game.destroyEventZoneCard(player.id, "戦闘による破壊を無効化するため自ら", instance);
      return true;
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
    // 2026/08改訂: 「亜竜種2体を墓地へ送って2体に16ダメージ」から
    // 「亜竜種1体を墓地へ送って2体に12ダメージ」に変更
    onEvent({ game, player, opponent, params }) {
      const chosen = params.sacrifices; // [{from:'board'|'hand', ref}] を1つ渡す想定
      if (!chosen || chosen.length !== 1) throw new Error("場・手札から亜竜種1体を指定してください");

      // 相手の場にモンスターが0体なら、そもそも発動できない(コストだけ支払わされることを防ぐため
      // 対象確認はコスト消費より先に行う)
      const targets = params.targetMonsters ?? opponent.board.filter(Boolean).slice(0, 2);
      if (targets.length === 0) {
        throw new Error("相手の場にモンスターが存在しないため発動できません");
      }

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
      for (const t of targets) game.dealDamageToMonster(opponent, t, 12);
    },
  },
  オルレアホワイト・ドラゴン: {
    // ②1ターンに1度発動可能。手札からドラゴン種1体を除外する。
    // ターン終了時まで攻撃力が、除外したモンスターの攻撃力分アップする。
    onActivate({ game, player, instance, params }) {
      const card = player.hand.find((c) => c.uid === params.exileHandUid);
      if (!card) throw new Error("除外する手札のドラゴン種を指定してください");
      if (CARD_DEF_RACE(card.defName) !== "ドラゴン") throw new Error("ドラゴン種の手札を指定してください");
      const idx = player.hand.indexOf(card);
      player.hand.splice(idx, 1);
      player.exile.push(card.defName);
      const buffAmount = CARD_DEFS[card.defName]?.atk ?? 0;
      instance.currentAtk += buffAmount;
      instance.tempAtkThisTurn += buffAmount; // ターン終了時まで(endTurn()で自動的に元へ戻る)
      game.log(`${player.id}: オルレアホワイト・ドラゴンが『${card.defName}』を除外し、攻撃力+${buffAmount}(ターン終了時まで)`);
    },
    onOwnEndPhase({ game, player, opponent, instance }) {
      // 正: 敵モンスターの現在HPが「このカードの現在の攻撃力(超越・オーラ等の増加分も含む)」より
      // 低いものをすべて破壊する(誤って自身のHPと比較していたバグを修正)
      const myAtk = game.getEffectiveAtk(player, instance);
      for (const m of [...opponent.board]) {
        if (m && m.currentHp < myAtk) {
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
      // 説明文の「自分の場にいるすべての『ゴ・ド・リックの右腕』」に対応するため、
      // 1体だけでなく該当する全コピーを対象にする
      const migis = player.board.filter((m) => m && m.defName === "ゴ・ド・リックの右腕");
      for (const migi of migis) {
        migi.currentAtk += 8;
        migi.currentHp += 4;
        migi.grantedKeywords.add(KEYWORDS.TOTSUGEKI);
        migi.grantedKeywords.add(KEYWORDS.KAKUSATSU);
      }
    },
    onLeaveField({ game, player }) {
      const migi = player.board.find((m) => m && m.defName === "ゴ・ド・リックの右腕");
      if (migi) game.sendToGraveyard(player, migi);
    },
  },
  ダリアバーミリオン・ドラゴン: {
    onSummon({ game, player, opponent, instance, params }) {
      const target = params.targetMonster ?? opponent.board.find(Boolean);
      if (target) game.dealDamageToMonster(opponent, target, 24);
      game.grantKeywordToOwnRaces(player, ["亜竜"], KEYWORDS.SOKKOU);
      // ①効果で墓地に送った『レッドドラゴン』が超越していたとき、このカードは超越する
      if (params.releasedInstance?.transcended) {
        game.forceTranscend(player.id, instance);
      }
    },
    // 「超越したターンから、この効果は有効となる。自分のエンドフェイズ時、相手プレイヤーに
    // 20ダメージ与える」= 超越した以降、毎エンドフェイズ継続的に発動する(1回きりではない)。
    // instance.transcended はシリアライズ対象の通常フィールドなので、オンライン対戦での
    // hydrateGame()を挟んでも正しく継続する(onTranscend側でクロージャを予約する方式だと消えてしまうため採用しない)
    onOwnEndPhase({ game, player, opponent, instance }) {
      if (!instance.transcended) return;
      game.dealDamageToPlayer(opponent, 20);
      game.log(`${player.id}: ダリアバーミリオン・ドラゴンの超越効果で相手に20ダメージ`);
    },
  },
  デルフィニウムアズール・ドラゴン: {
    onSummon({ game, player, opponent, instance, params }) {
      game.dealDamageToAllEnemyMonsters(opponent, 12);
      // ①効果で墓地に送った『ブルードラゴン』が超越していたとき、このカードは超越する
      if (params?.releasedInstance?.transcended) {
        game.forceTranscend(player.id, instance);
      }
      const eligible = player.graveyard.filter((n) => CARD_DEF_RACE(n) === "亜竜");
      if (eligible.length === 0) return;
      // 詳しい説明文:「墓地に存在する亜竜種を1体選び」= 複数いる場合はプレイヤーが選ぶ
      // (以前はplayer.graveyard.find()で常に先頭の1体を自動選択しており、選択権がなかったバグを修正)
      const chosenName = eligible.length === 1 ? eligible[0] : (params?.reviveTarget ?? eligible[0]);
      const slot = game.findEmptySlot(player);
      if (slot === -1) return;
      player.graveyard.splice(player.graveyard.indexOf(chosenName), 1);
      game.specialSummonToken(player.id, chosenName, slot, { grantedKeywords: [KEYWORDS.CHOUHATSU] });
    },
    // ダリアバーミリオン・ドラゴンと同様、超越した以降は毎エンドフェイズ継続的に発動する
    onOwnEndPhase({ game, player, instance }) {
      if (!instance.transcended) return;
      game.healPlayer(player, 24);
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
      game.buffOwnRace(player, "亜竜", 8, 8);
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
    onKillInCombat({ game, player, opponent, instance }) {
      // ①1ターンに1度、敵を破壊したとき、もう一度攻撃できるようになる
      if (!instance.onceEffectUsedThisTurn.dragonyuteKing) {
        instance.onceEffectUsedThisTurn.dragonyuteKing = true;
        instance.hasAttackedThisTurn = false;
        game.log(`${player.id}: ドラゴニュート・キングが撃破ボーナスでもう一度攻撃可能に`);
      }
      // ≪超越≫したターンから有効になる、①とは別枠の効果:
      // 敵を破壊したとき、相手に12ダメージを与える(①の1ターン1度制限を消費しない)
      if (instance.transcended) {
        game.dealDamageToPlayer(opponent, 12);
        game.log(`${player.id}: ドラゴニュート・キングの超越効果で相手に12ダメージ`);
      }
    },
  },

  // ---------- 聖女テーマ(友人考案) ----------
  忠義の騎士ジル・ド・レェ: {
    // ①「自分の場に聖女がいる間、戦闘以外のダメージを受けず、効果でも破壊されない」耐性は
    // GameState.isImmuneToEffectHarm()側で一括判定しているため、ここには実装不要
    // (個々のカード効果を書き換えずに済ませるための設計。詳しくは開発記録を参照)。
    // ②このカードの攻撃力は、自分の墓地の『天啓の聖女ジャンヌ・ダルク』の枚数×4分、
    // 常に(都度計算で)アップする
    auraSelfAtk({ player }) {
      const count = player.graveyard.filter((n) => n === "天啓の聖女ジャンヌ・ダルク").length;
      return count * 4;
    },
  },
  神託の修道士: {
    onSummon({ game, player }) {
      if (player.hp >= CONFIG.MAX_HP) {
        game.drawOne(player);
      } else {
        game.healPlayer(player, 8);
      }
    },
  },
  天啓の聖女ジャンヌ・ダルク: {
    // ①自分の場にいる他モンスター全員に+4を配るオーラ。同名が複数体いれば重複する
    // (各ジャンヌが「自分以外全員」に+4を配るだけなので、特別な軽減処理は不要)
    auraGiveAtk() {
      return 4;
    },
    // 《超越》1ターンに2回攻撃できるようになる。
    // 2026/08改訂: 以前は独自の固定+12/+12(transcendStatBonus)を持たせていたが、
    // 仕様上は他のモンスターと同じ「ターン数×2(最大20)」の通常計算式に統一されたため、
    // 上書き設定を撤廃した(2回攻撃の追加効果のみ残す)。
    onAfterAttack({ instance }) {
      // 超越済みなら、1ターンに1度だけ「もう一度攻撃可能」状態に戻す
      if (instance.transcended && !instance.usedDoubleAttackThisTurn) {
        instance.usedDoubleAttackThisTurn = true;
        instance.hasAttackedThisTurn = false;
      }
    },
  },
  神の啓示: {
    onEvent({ game, player, params }) {
      if (player.storage.length === 0) throw new Error("ストレージにカードがありません");
      const chosenName = params?.fetchDefName ?? player.storage[0];
      const idx = player.storage.indexOf(chosenName);
      if (idx === -1) throw new Error("指定されたカードがストレージに見つかりません");
      player.storage.splice(idx, 1);
      player.deck.push(chosenName); // デッキの一番上(=次に引かれる位置)に置く
      player.pendingCostReduction = { defName: chosenName, ownTurnCount: player.ownTurnCount + 1, amount: 3 };
      game.log(`${player.id}: 『${chosenName}』をデッキの一番上に置いた(次の自ターンに引けばコスト-3)`);
    },
  },
  聖騎士ライル: {
    // 「敵を攻撃して破壊したとき」= 戦闘による撃破のみが対象(onKillInCombatは
    // resolveCombat()経由の戦闘勝利時にしか呼ばれないため、効果による破壊は含まれない)
    onKillInCombat({ game, player }) {
      game.drawOne(player);
    },
  },
  聖女カトリーヌ: {
    // 「できる」= 任意効果。対象候補が無ければ何もしない
    onSummon({ player, params }) {
      const name = params?.fetchDefName;
      if (!name) return;
      const src = params.fromDeck ? player.deck : player.storage;
      const idx = src.indexOf(name);
      if (idx === -1) return;
      src.splice(idx, 1);
      player.hand.push({ uid: `t${Date.now()}${Math.random()}`, defName: name, hold: false });
    },
  },
  オルレアンの民兵: {
    onSummon({ game, player }) {
      const slot = game.findEmptySlot(player);
      if (slot === -1) return; // 自分の場に空きがなければ発動しない
      // specialSummonToken()はonSummonフックを再発火させないため、これ以上連鎖しない
      game.specialSummonToken(player.id, "オルレアンの民兵", slot);
    },
  },
  聖旗: {
    onEvent({ game, player }) {
      const slot1 = game.findEmptySlot(player);
      if (slot1 === -1) throw new Error("自分の場に空きがありません");
      const jeanne = game.specialSummonToken(player.id, "天啓の聖女ジャンヌ・ダルク", slot1);
      const slot2 = game.findEmptySlot(player);
      if (slot2 !== -1) {
        game.specialSummonToken(player.id, "忠義の騎士ジル・ド・レェ", slot2);
      }
      // 4ターン目以降のみ、この効果で出したジャンヌを自動的に超越させる
      // (カード効果による自動超越のため、プレイヤーの3ターンクールダウンは消費しない)
      if (game.turnNumber >= CONFIG.TRANSCEND_MIN_TURN) {
        game.forceTranscend(player.id, jeanne);
      }
    },
  },
  大天使ミカエル: {
    onSummon({ game, player, opponent, params }) {
      const target = params?.targetMonster ?? opponent.board.find(Boolean);
      if (target) game.destroyMonster(opponent, target);
      game.healPlayer(player, 16);
    },
  },
  異端審問官コーション: {
    onSummon({ game, opponent }) {
      const targets = opponent.board.filter(Boolean);
      // 2026/08/21修正: 以前は1体ずつdestroyMonster()していたため、「相手の場全体が
      // 破壊しきる前に、先に破壊されたモンスターの離脱時効果(ヒュドラ―の分頭の
      // 特殊召喚等)が発動してしまい、まだ破壊されていない他のモンスターの分だけ
      // 場の空きが埋まっていて、本来出せるはずの体数が出せない」「場が一度も
      // 0体にならないため、シールドがリセットされない」という2つの不具合があった。
      // まとめて破壊するdestroyMonsters()に変更し、「全滅→シールド確定→
      // 離脱時効果(分頭の特殊召喚)」の順で正しく解決されるようにする
      const destroyed = game.destroyMonsters(opponent, targets);
      if (destroyed.length > 0) game.dealDamageToPlayer(opponent, destroyed.length * 4);
    },
  },
  火刑に処されし聖女: {
    onSummon({ game, player, opponent, instance, params }) {
      const count = player.graveyard.filter((n) => n === "天啓の聖女ジャンヌ・ダルク").length;
      if (count >= 1) {
        const target = params?.targetMonster ?? opponent.board.find(Boolean);
        if (target) game.destroyMonster(opponent, target);
      }
      if (count >= 2) {
        instance.currentAtk += 4;
        instance.currentHp += 4;
      }
      if (count >= 3) {
        const slot = game.findEmptySlot(player);
        if (slot !== -1) game.specialSummonToken(player.id, "忠義の騎士ジル・ド・レェ", slot);
      }
      if (count >= 4) {
        instance.grantedKeywords.add(KEYWORDS.SOKKOU);
      }
    },
    onTranscend({ game, opponent }) {
      game.dealShieldableDamageToPlayer(opponent, 40);
    },
  },

  // ---------- トリッカーテーマ(毒、2026/08/16追加) ----------
  解毒爆薬剤: {
    onEvent({ game, player, opponent, params }) {
      const target = params?.targetMonster;
      const owner = target && player.board.includes(target) ? player
        : target && opponent.board.includes(target) ? opponent
        : null;
      if (!owner || !(target.poison > 0)) throw new Error("毒が付与されているモンスターを指定してください");
      const amount = target.poison;
      game.setPoisonAmount(owner, target, 0);
      game.dealDamageToMonster(owner, target, amount);
    },
  },
  ミニタランチュラ: {
    onSummon({ game, player }) {
      const slot = game.findEmptySlot(player);
      if (slot === -1) return;
      // specialSummonToken()はonSummonフックを再発火させないため、これ以上連鎖しない
      game.specialSummonToken(player.id, "ミニタランチュラ", slot);
    },
    onAfterAttack({ game, opponent, targetType }) {
      if (targetType === "player") game.applyPoisonToPlayer(opponent, 4);
    },
  },
  毒滴: {
    onEvent({ game, player, opponent, params }) {
      const target = params?.target; // {type:'monster', instance} | {type:'player'}
      if (!target) throw new Error("毒を付与する対象を選んでください");
      if (target.type === "monster") {
        const owner = player.board.includes(target.instance) ? player
          : opponent.board.includes(target.instance) ? opponent
          : null;
        if (!owner) throw new Error("場に存在するモンスターを指定してください");
        game.applyPoisonToMonster(owner, target.instance, 8);
      } else if (target.type === "player") {
        game.applyPoisonToPlayer(opponent, 8);
      } else {
        throw new Error("不正な対象です");
      }
    },
  },
  毒食み: {
    onEvent({ game, player }) {
      game.applyPoisonToPlayer(player, 8);
      player.resourceAvailable = Math.min(player.resourceAvailable + 2, player.resourceCap);
    },
  },
  ドクトゲガエル: {
    onCombat({ game, opponent, enemyInstance }) {
      if (enemyInstance) game.applyPoisonToMonster(opponent, enemyInstance, 4);
    },
  },
  // ①設置条件「自分の場に「科学者」がいるとき」はonEventで検証のみ行う(持続イベントの
  //   設置と同時に発動する即時効果は無いため、onEvent自体は副作用を持たない)。
  // ②の「毒の自動減少を止める」はGameState.isPoisonDecayDisabled()側で判定。
  // ③は場のモンスター起動効果とは別枠の、イベントゾーンカード自身の起動効果(onZoneActivate)。
  ポイズン・ラボ: {
    onEvent({ player }) {
      if (!player.board.some((m) => m && m.race === "科学者")) {
        throw new Error("自分の場に「科学者」がいないと設置できません");
      }
    },
    onZoneActivate({ game, player, opponent, params }) {
      const sac = params?.sacrificeMonster;
      if (!sac || !player.board.includes(sac) || sac.race !== "毒性生物") {
        throw new Error("自分の場の「毒性生物」1体を選んでください");
      }
      const target = params?.target; // {type:'monster', instance, owner} | {type:'player', player}
      if (!target) throw new Error("毒を付与する対象を選んでください");
      game.sendToGraveyard(player, sac);
      if (target.type === "monster") {
        game.applyPoisonToMonster(target.owner, target.instance, 4);
      } else if (target.type === "player") {
        game.applyPoisonToPlayer(target.player, 4);
      } else {
        throw new Error("不正な対象です");
      }
    },
  },
  ハリマンボン: {
    onTranscend({ game, player }) {
      const spawned = [];
      for (let i = 0; i < 2; i++) {
        const slot = game.findEmptySlot(player);
        if (slot === -1) break;
        spawned.push(game.specialSummonToken(player.id, "ハリマンボン", slot));
      }
      for (const inst of spawned) {
        inst.currentAtk += 8;
        inst.currentHp += 8;
      }
    },
  },
  ドクター・トキシン: {
    // 「1ターンに1度発動可能」= 既存のonActivate機構(onceEffectUsedThisTurn.abilityで
    // 毎ターン自動リセット)をそのまま利用
    onActivate({ game, player, opponent, params }) {
      const target = params?.targetMonster;
      const owner = target && player.board.includes(target) ? player
        : target && opponent.board.includes(target) ? opponent
        : null;
      if (!owner) throw new Error("場に存在するモンスターを指定してください");
      game.applyPoisonToMonster(owner, target, 8);
    },
  },
  テトロドトキシンフィッシュ: {
    onSummon({ game, opponent }) {
      game.applyPoisonToAllEnemyMonsters(opponent, 8);
    },
  },
  // 「毒が付与されている相手モンスターは攻撃できない」はGameState.isAttackBlockedByPoison()側で
  // 一括判定しているため、ここには実装不要(忠義の騎士ジル・ド・レェの耐性と同じ設計方針)
  ドクター・ニューロトキシン: {
    onTranscend({ game, opponent }) {
      game.applyPoisonToAllEnemyMonsters(opponent, 12);
    },
  },
  デカめのサソリ: {
    onCombat({ game, player, opponent, instance, enemyInstance }) {
      if (enemyInstance) game.applyPoisonToMonster(opponent, enemyInstance, 4);
      game.applyPoisonToMonster(player, instance, 4);
    },
    // ②毒の合計分体力が増加する(常時計算)。竜の里と同じ「直接加算方式」で、
    // 毒が増減するたびにcurrentHpを連動させる(このゲームにはHPの実効値オーバーレイの
    // 仕組みが無いため、他の恒久バフ効果と同じ方式に合わせている)
    onPoisonChanged({ instance, delta }) {
      instance.currentHp += delta;
    },
  },
  阿毒叫喚: {
    onEvent({ game, player, opponent }) {
      for (const m of [...player.board]) if (m) game.applyPoisonToMonster(player, m, 20);
      for (const m of [...opponent.board]) if (m) game.applyPoisonToMonster(opponent, m, 20);
    },
  },
  ドクター・イミュニティ: {
    onSummon({ game, player }) {
      game.applyPoisonToPlayer(player, 16);
    },
    // ②交戦時、ダメージ計算前に自分の毒の合計分、交戦している敵モンスターにダメージを与える
    onCombat({ game, opponent, enemyInstance, player }) {
      if (enemyInstance) game.dealDamageToMonster(opponent, enemyInstance, player.poison || 0);
    },
    // ③自分のエンドフェイズ時、毒の合計分回復してから毒を0にする。
    // このフックはendTurn()内で「毒のダメージ処理」より前に実行されるため、
    // 結果的にそのターンの毒による自傷ダメージは発生しなくなる(意図通りの挙動)
    onOwnEndPhase({ game, player }) {
      const amount = player.poison || 0;
      if (amount > 0) {
        game.healPlayer(player, amount);
        game.setPoisonAmount(player, player, 0);
      }
    },
    onTranscend({ game, player }) {
      game.setPoisonAmount(player, player, (player.poison || 0) * 2);
    },
  },
  毒の探究者ゴゴ: {
    blocksDirectPlayerDamage: true,
    onAfterAttack({ game, player, opponent, instance, targetType }) {
      if (targetType !== "player") return;
      const amount = instance.poison || 0;
      if (amount > 0) {
        game.applyPoisonToPlayer(opponent, amount);
        game.setPoisonAmount(player, instance, 0);
      }
    },
    onTranscend({ game, player, instance }) {
      game.applyPoisonToMonster(player, instance, 8);
      instance.grantedKeywords.add(KEYWORDS.SOKKOU);
    },
  },
  // ①相手の場2つを毒化(onSummon)。以降そのスロットに召喚されたモンスターへの自動毒付与は
  // GameState.applyPoisonedSlotEntry()側(summonFromHand/specialSummonToken双方から呼ばれる)で処理。
  // ②このカードが墓地に送られたとき、場に存在するモンスターすべてに毒12を付与する
  // (2026/08/16修正: 当初「1体選んで毒16」だったが、対象選択がどのタイミングでも
  // 墓地送りになりうるカードと相性が悪かったため、対象選択不要な「全体に毒12」へ
  // shirute側で仕様変更。これにより対象選択UIの実装は不要になった)
  ドクター・ベアトラップ: {
    onSummon({ game, opponent, params }) {
      const slots = (params?.poisonSlots ?? [0, 1]).slice(0, 2);
      for (const s of slots) opponent.poisonedSlots.add(s);
      game.log(`${opponent.id}: 場の${slots.join(",")}番枠が毒化された(以降このスロットに召喚されたモンスターへ毒8)`);
    },
    onLeaveField({ game, player, opponent }) {
      for (const m of [...player.board]) if (m) game.applyPoisonToMonster(player, m, 12);
      for (const m of [...opponent.board]) if (m) game.applyPoisonToMonster(opponent, m, 12);
    },
  },
  ドクター・ポイズン: {
    onSummon({ game, player, opponent }) {
      for (const m of [...player.board]) if (m) game.applyPoisonToMonster(player, m, 30);
      for (const m of [...opponent.board]) if (m) game.applyPoisonToMonster(opponent, m, 30);
    },
    // ②「敵の場のモンスターも毒ダメージを受ける」はGameState.endTurn()側でこのカードの
    // 存在を直接チェックして処理している(自分のエンドフェイズという特殊なタイミングで
    // 相手の場を処理する例外的な効果のため)
    onDrawCard({ game, player, opponent }) {
      for (const m of [...player.board]) if (m) game.applyPoisonToMonster(player, m, 8);
      for (const m of [...opponent.board]) if (m) game.applyPoisonToMonster(opponent, m, 8);
      game.applyPoisonToPlayer(opponent, 8);
    },
  },
  "ヒュドラ―の分頭": {
    onSummon({ game, instance }) {
      const options = [KEYWORDS.TOTSUGEKI, KEYWORDS.CHOUHATSU, KEYWORDS.ONMITSU, KEYWORDS.KAKUSATSU];
      const chosen = options[Math.floor(Math.random() * options.length)];
      instance.grantedKeywords.add(chosen);
      // 2026/08/21修正: ①でランダムに付与されたキーワードが何なのかログに一切出ておらず、
      // 場に出た本人にも相手にも分からない不具合があった。何が付与されたか必ずログに残す
      game.log(`${instance.defName}: 【${chosen}】を獲得した`);
    },
    onCombat({ game, opponent, enemyInstance }) {
      if (enemyInstance) game.applyPoisonToPlayer(opponent, 4);
    },
    // ③場から離れたとき、自プレイヤーのHPを8回復する
    onLeaveField({ game, player }) {
      game.healPlayer(player, 8);
    },
  },
  "九頭竜ヒュドラ―": {
    onAfterAttack({ game, opponent, instance }) {
      // ①攻撃したとき(直接攻撃・モンスターへの攻撃を問わない)、相手の場全体に毒8
      game.applyPoisonToAllEnemyMonsters(opponent, 8);
      // ②1ターンに2回攻撃できる(超越条件なしの常時効果。ジャンヌ・ダルクの超越限定版とは異なり、
      // 場にいる限り常に有効)
      if (!instance.usedDoubleAttackThisTurn) {
        instance.usedDoubleAttackThisTurn = true;
        instance.hasAttackedThisTurn = false;
      }
    },
    // ③墓地に送られるとき、自分の場に『ヒュドラ―の分頭』を最大3体特殊召喚する
    onLeaveField({ game, player }) {
      for (let i = 0; i < 3; i++) {
        const slot = game.findEmptySlot(player);
        if (slot === -1) break;
        game.specialSummonToken(player.id, "ヒュドラ―の分頭", slot);
      }
    },
  },
  タランチュラベイビー: {
    // 「破壊されたとき」= このゲームでは戦闘・効果いずれの理由でも墓地送りは
    // sendToGraveyard()に一本化されているため、他カードの「場を離れたとき」系と同様に
    // onLeaveFieldで実装する
    // ②『タランチュラ・クイーン』が自分の場に存在するとき、このカードは+4/+8される、は
    // タランチュラ・クイーン側の常時効果(auraGiveAtk / 直接HP加算)として実装済みのため
    // ここには実装不要
    onLeaveField({ game, player, opponent }) {
      game.drawOne(player);
      // タランチュラ・クイーン③: 自分の場に『タランチュラ・クイーン』が存在するとき、
      // このカードが破壊されると相手プレイヤーに毒4を付与する(効果自体はクイーン側の
      // カードテキストだが、発火元はベイビー自身の場離脱のためここで判定する)
      const hasQueen = player.board.some((m) => m && m.defName === "タランチュラ・クイーン");
      if (hasQueen) game.applyPoisonToPlayer(opponent, 8);
    },
  },
  "タランチュラ・クイーン": {
    onSummon({ game, player }) {
      // ②の巻き戻し用マーキング: このクイーンが場に出た時点で既に存在する
      // 『タランチュラベイビー』へ先にHP+8を直接付与しておく(このゲームにはHPの実効値
      // オーバーレイの仕組みが無いため、竜の里と同じ直接加算方式)。
      // ①のトークン生成より先に行うことで、新規に出す2体への二重付与を避ける
      // (新規召喚分はonAllySummon側で1回だけ付与される)
      for (const m of player.board) {
        if (m && m.defName === "タランチュラベイビー" && !m.tarantulaQueenBuffed) {
          m.currentHp += 8;
          m.tarantulaQueenBuffed = true;
        }
      }
      // ①場に出たとき、『タランチュラベイビー』2体を自分の場に出す。それは【突撃】を持つ
      for (let i = 0; i < 2; i++) {
        const slot = game.findEmptySlot(player);
        if (slot === -1) break;
        game.specialSummonToken(player.id, "タランチュラベイビー", slot, { grantedKeywords: [KEYWORDS.TOTSUGEKI] });
      }
    },
    // このクイーンが場にいる間、新たに召喚された『タランチュラベイビー』にもHP+8を直接付与
    onAllySummon({ newInstance }) {
      if (newInstance.defName === "タランチュラベイビー" && !newInstance.tarantulaQueenBuffed) {
        newInstance.currentHp += 8;
        newInstance.tarantulaQueenBuffed = true;
      }
    },
    // ②の攻撃力+4分は常時計算のオーラとして実装(このゲームのATKには実効値オーバーレイの
    // 仕組みがあるため、HPと違って直接加算しなくてよい)。対象を『タランチュラベイビー』のみに絞る
    auraGiveAtk({ target }) {
      return target.defName === "タランチュラベイビー" ? 4 : 0;
    },
    // ②1ターンに1度発動可能。自分の場に空きがあれば『タランチュラベイビー』1体を特殊召喚する
    // (新規に出したベイビーへのHP+8はonAllySummon側で自動付与される)
    onActivate({ game, player }) {
      const slot = game.findEmptySlot(player);
      if (slot === -1) throw new Error("自分の場に空きがありません");
      game.specialSummonToken(player.id, "タランチュラベイビー", slot);
    },
    onLeaveField({ game, player }) {
      // このクイーンが場を離れるとき、直接加算していたHP+8分を巻き戻す(竜の里のonZoneLeaveと同じ考え方)
      for (const m of player.board) {
        if (m && m.tarantulaQueenBuffed) {
          m.currentHp -= 8;
          delete m.tarantulaQueenBuffed;
          if (m.currentHp <= 0) game.sendToGraveyard(player, m);
        }
      }
      // ③(自分の場に存在する『タランチュラベイビー』が破壊されたとき、相手に毒4)は
      // タランチュラベイビー側のonLeaveFieldで判定するように変更(2026/08/16修正)。
      // 旧仕様の「クイーン自身が破壊されたときベイビー2体を特殊召喚」は廃止
    },
    onTranscend({ game, player }) {
      // 超越した瞬間の1回きりの恒久バフ(②の継続オーラ・直接加算とは別枠、デフォルトルール通り)
      for (const m of player.board) {
        if (m && m.defName === "タランチュラベイビー") {
          m.currentAtk += 12;
          m.currentHp += 8;
        }
      }
    },
  },
};

// 墓地・デッキ・ストレージには defName(文字列)しか積んでいないため、
// 種族参照が必要な効果のために簡易ルックアップを用意する。
import { CARD_DEFS } from "./cardDefinitions.js";
function CARD_DEF_RACE(defName) {
  return CARD_DEFS[defName]?.race ?? null;
}
