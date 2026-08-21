// ==========================================================
// 更新情報(パッチノート)モーダル(共通モジュール)
//
// 【運用ルール】
// ・カードの「効果」や「ステータス(コスト/攻撃力/体力等)」が実際に変わった
//   ときだけ、下の PATCH_NOTES に追記する。
// ・不具合・バグ修正のみ(効果やステータスの意図した値は変わっていない)の
//   場合は書かない。プレイヤーに見せる必要がないため。
// ・書式が「変更前 → 変更後」になっている行は、自動で色分け表示される。
// ・RETENTION_DAYS で指定した日数より古いエントリは、削除しなくても
//   自動的にプレイヤー側の画面には表示されなくなる(ソート・整理の
//   ために、気が向いたときに古い記述をこのファイルから消してもらって構わない)。
//
// 【書き方の例】
// {
//   date: "2026-08-15",              // その変更をリリースした日
//   entries: [
//     { card: "ゴブリン", changes: ["攻撃力: 4 → 6"] },
//     { card: "祈り", changes: ["効果: 体力を4回復する。 → 体力を6回復する。"] },
//   ],
// },
//
// 1体のカードで複数箇所変わった場合は changes 配列に複数行入れればOK。
// ==========================================================

// この日数より古い日付のエントリは一覧に表示されなくなる
export const RETENTION_DAYS = 14;

export const PATCH_NOTES = [
  {
    date: "2026-08-21",
    entries: [
      {
        card: "デカめのサソリ",
        changes: ["効果: ①交戦時、お互いのモンスターに毒8を付与する。 → ①交戦時、お互いのモンスターに毒4を付与する。"],
      },
      {
        card: "テーマ名変更",
        changes: ["「赤」テーマの名称を「ドラゴニア」に変更しました(カードの中身・効果に変更はありません)"],
      },
      {
        card: "タイフーン",
        changes: ["新規追加: コスト2 / 手札のイベントを1枚墓地に送ることで発動できる。相手のイベントゾーンにあるカードを破壊する。"],
      },
      {
        card: "ヒュドラ―の分頭",
        changes: ["攻撃力: 12 → 8"],
      },
      {
        card: "ドクター・ニューロトキシン",
        changes: ["効果: 【抗体】毒が付与されている相手モンスターは攻撃できない。≪超越≫相手の場に存在するモンスターすべてに毒12を付与する。 → 毒が付与されている相手モンスターは攻撃できない。≪超越≫相手の場に存在するモンスターすべてに毒12を付与する。(誤って付いていた【抗体】を削除)"],
      },
      {
        card: "タランチュラ・クイーン",
        changes: ["効果: ③自分の場に存在する『タランチュラ・ベイビー』が破壊されたとき、相手プレイヤーに毒4を付与する。 → ③自分の場に存在する『タランチュラ・ベイビー』が破壊されたとき、相手プレイヤーに毒8を付与する。"],
      },
      {
        card: "火刑に処されし聖女",
        changes: ["効果: ≪超越≫相手のHPに40ダメージ与える。(シールドを無視) → ≪超越≫相手プレイヤーに40ダメージ与える。(シールドで防げるように変更)"],
      },
    ],
  },
  {
    date: "2026-08-16",
    entries: [
      {
        card: "ドクター・ポイズン",
        changes: [
          "効果: ③自プレイヤーがカードを1枚ドローするたび、場に存在するすべてのモンスターに毒8を付与する。 → ③自プレイヤーがカードを1枚ドローするたび、場に存在するすべてのモンスターと相手プレイヤーに毒8を付与する。",
        ],
      },
      {
        card: "ヒュドラ―の分頭",
        changes: ["効果: 「③場から離れたとき、自プレイヤーのHPを8回復する。」を追加"],
      },
      {
        card: "タランチュラベイビー",
        changes: ["効果: 「②『タランチュラ・クイーン』が自分の場に存在するとき、このカードは+4/+8される。」を追加(既存の常時効果をベイビー側のカードテキストとして明記)"],
      },
      {
        card: "タランチュラ・クイーン",
        changes: [
          "効果: ②このカードが存在する限り、自分の場に存在する『タランチュラベイビー』は+4/+8される。 → ②1ターンに1度発動可能。自分の場に『タランチュラベイビー』1体を特殊召喚する。(常時+4/+8の効果はタランチュラベイビー側のカードテキストとして存続)",
          "効果: ③破壊されたとき『タランチュラベイビー』2体を自分の場に出す。 → ③自分の場に存在する『タランチュラ・ベイビー』が破壊されたとき、相手プレイヤーに毒4を付与する。",
        ],
      },
    ],
  },
  {
    date: "2026-08-14",
    entries: [
      { card: "死神", changes: ["効果: 【貫通】 → 【貫通】①相手の場にモンスターが存在しないとき、これは【速攻】を持つ。"] },
      { card: "やり直し", changes: ["効果: カードを1枚ドローする。 → 自分の手札2枚をストレージに移す。その後、カードを2枚ドローする。"] },
      { card: "シールドバッシュ", changes: ["コスト: 5 → 4"] },
      { card: "ただの傭兵", changes: ["攻撃力: 4 → 8"] },
      { card: "用意周到", changes: ["コスト: 3 → 2"] },
      { card: "ドラゴンの卵", changes: ["体力: 12 → 8", "効果: 攻撃できない。 → 【隠密】攻撃できない。"] },
      { card: "オルレアンの民兵", changes: ["体力: 12 → 8"] },
      { card: "エッグ・シーフ", changes: ["体力: 4 → 8"] },
      {
        card: "デスラトル",
        changes: [
          "効果: 自分の場・手札から亜竜種2体を墓地に送ることで発動可能。相手の場にいるモンスター2体に16ダメージを与える。 → 自分の場・手札から亜竜種1体を墓地に送ることで発動可能。相手の場にいるモンスター2体に12ダメージを与える。",
        ],
      },
      { card: "右腕を失くしたゴ・ド・リック", changes: ["効果: 超越時に付与するキーワードが【突撃】のみ → 【突撃】【確殺】に変更"] },
      {
        card: "ダリアバーミリオン・ドラゴン",
        changes: ["効果: 「①効果で墓地に送った『レッドドラゴン』が超越していたとき、このカードは超越する」を追加"],
      },
      {
        card: "デルフィニウムアズール・ドラゴン",
        changes: ["効果: 「①効果で墓地に送った『ブルードラゴン』が超越していたとき、このカードは超越する」を追加"],
      },
      { card: "エンダーリコリス・ワイバーン", changes: ["効果: 超越時の体力上昇量が+4 → +8に変更(攻撃力上昇量+8は変更なし)"] },
      { card: "ドラゴニュート・キング", changes: ["効果: 超越時に与えるダメージが8 → 12に変更"] },
      {
        card: "天啓の聖女ジャンヌ・ダルク",
        changes: ["効果: 超越時のステータス上昇が固定+12/+12 → 他のモンスターと同じ通常の超越計算式(ターン数×2、最大20)に変更"],
      },
      {
        card: "異端審問官コーション",
        changes: ["召喚条件: 通常コスト7を支払わず特殊召喚できる扱いだった(不具合) → 通常コスト7を支払った上で、追加コストとして『天啓の聖女ジャンヌ・ダルク』を場・手札から墓地に送ることで召喚できるように修正"],
      },
    ],
  },
  // ここに追記していく(新しいものを配列の先頭に追加すると管理しやすい)
];

function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysSince(dateStr) {
  const ms = new Date().setHours(0, 0, 0, 0) - parseDate(dateStr).setHours(0, 0, 0, 0);
  return Math.floor(ms / 86400000);
}

// 表示対象(RETENTION_DAYS以内)のエントリだけを、日付降順で返す
export function visiblePatchNotes() {
  return PATCH_NOTES
    .filter((day) => daysSince(day.date) <= RETENTION_DAYS)
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 「変更前 → 変更後」の形式なら、変更前を打ち消し線+ミュート色、
// 変更後を強調色で表示する。矢印を含まない自由記述の行はそのまま表示する。
function renderChangeLine(line) {
  const idx = line.indexOf("→");
  if (idx === -1) return escapeHtml(line);
  const before = line.slice(0, idx).trim();
  const after = line.slice(idx + 1).trim();
  return `<span class="patch-before">${escapeHtml(before)}</span> → <span class="patch-after">${escapeHtml(after)}</span>`;
}

function renderPatchNotesHTML() {
  const days = visiblePatchNotes();
  if (days.length === 0) {
    return `<p class="patch-empty">現在、直近${RETENTION_DAYS}日以内のカード更新はありません。</p>`;
  }
  return days
    .map((day) => {
      const items = day.entries
        .map((e) => {
          const lines = e.changes.map((c) => `<li>${renderChangeLine(c)}</li>`).join("");
          return `<div class="patch-card"><p class="patch-card-name">${escapeHtml(e.card)}</p><ul>${lines}</ul></div>`;
        })
        .join("");
      return `<div class="patch-day"><p class="patch-date">${escapeHtml(day.date)}</p>${items}</div>`;
    })
    .join("");
}

const LAST_SEEN_KEY = "cardgame-patchnotes-lastseen";

function latestVisibleDate() {
  const days = visiblePatchNotes();
  return days.length > 0 ? days[0].date : null;
}

// ホーム画面のボタンに「未読(NEW)」バッジを付けるかどうかを判定する
function hasUnread() {
  const latest = latestVisibleDate();
  if (!latest) return false;
  const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
  return !lastSeen || lastSeen < latest;
}

function markAllSeen() {
  const latest = latestVisibleDate();
  if (latest) localStorage.setItem(LAST_SEEN_KEY, latest);
}

function refreshBadges() {
  const unread = hasUnread();
  for (const btn of document.querySelectorAll(".btn-open-patchnotes")) {
    btn.classList.toggle("has-unread", unread);
  }
}

// モーダルの開閉を、その時点でページ上に存在する全ての .btn-open-patchnotes
// ボタンに結びつける。rules.js の setupRulesModal() と同じ使い方。
export function setupPatchNotesModal() {
  const overlay = document.getElementById("patch-modal-overlay");
  const content = document.getElementById("patch-modal-content");
  const closeBtn = document.getElementById("btn-close-patchnotes");
  if (!overlay || !content || !closeBtn) return;

  content.innerHTML = renderPatchNotesHTML();
  refreshBadges();

  const openPatchNotes = () => {
    content.innerHTML = renderPatchNotesHTML(); // 開くたびに最新の日数フィルタで再描画
    overlay.style.display = "flex";
    content.scrollTop = 0;
    markAllSeen();
    refreshBadges();
  };
  const closePatchNotes = () => {
    overlay.style.display = "none";
  };

  closeBtn.onclick = closePatchNotes;
  overlay.onclick = (e) => {
    if (e.target === overlay) closePatchNotes();
  };

  for (const btn of document.querySelectorAll(".btn-open-patchnotes")) {
    btn.onclick = openPatchNotes;
  }
}
