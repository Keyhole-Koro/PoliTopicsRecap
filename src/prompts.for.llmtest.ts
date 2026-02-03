export const PROMPT_VERSION = "6.1";

export const instruction_common = `【目的】
国会議事録をAIで要約し、一般の読者にもわかりやすく説明すること。専門用語や制度に不慣れな人でも「何が決まり、何が議論され、次に何が起こるか」が直感的に掴める要約データを作成してください。

タスクは2モード:
- chunk: 会議全体の一部（発言群）を処理し、reduce統合を見越した middle_summary を中心に出力。soft_language_summary と summary は必須。
- reduce: 全 chunk 出力（特に middle_summary と participants）を統合し、会議全体の summary / soft_language_summary に加え、title / category / description / date / key_points / participants を生成。

厳守:
- middle_summary は「1トピック=1要点」。重複回避、結論/対立/未決/宿題/担当/期限/金額を明示できる範囲で。
- すべての要点に based_on_orders（発言 order 配列）を付与。
- 余談や定型挨拶は除外。推測や創作は禁止。
- summary / middle_summary は Markdown の機能を自由に使ってよい。
- dialogs は summary_sections のみで要点を表現する（summary / soft_language は出力しない）。
- summary_sections は必須。各要素は { "title": "主張", "bullets": ["要点1", "要点2"] } の配列で、title は固定セットのみ（「主張」「説明」「質問」「回答」「根拠」「影響」「次の対応」「決定」）。
- dialogs の summary_sections / qa は内容を重複させない。qa がある場合、質問・回答の内容は section に書かない。
- dialogs は入力の [order N] ごとに **必ず1件ずつ** 出力する（欠落・重複は禁止）。order 値は入力の [order N] と完全一致させる。
- soft_language_summary は箇条書きにせず、短い文章で書く（です/ます調・短文）。硬い制度語は可能なら言い換え、必要なら短い補足（例:「歳出=使うお金」）を括弧で添える。各文は短くし、冗長説明や強い断定・感情表現は禁止。
- 質問→回答が明確な場合、回答側の dialog に qa（配列）を付与する（質問側は reaction=質問のみで可）。
  - qa は複数質問に対応するため配列にする。
  - qa[].ask.question は「質問内容」そのものを記述する。
  - qa[].ask.who は質問者名、qa[].ask.orders は質問の order 配列（number[]）。
  - qa[].answer は回答要旨、qa[].answer_orders は回答の order 配列（number[]）。
  - qa[].ask.question / qa[].answer は1文で簡潔に。
- summary / soft_language_summary / middle_summary の本文には (order: 1) のような注記は書かない。order参照は本文末尾に \`[[orders:1,2,3]]\` のみ許可（数字・カンマ・ハイフンのみ、空白なし）。
- id は入力の [meta] にある内部IDをそのまま出力すること（issueIDと一致しない場合がある）。
- すべての出力に prompt_version を含める（現在値: ${PROMPT_VERSION}）。`;

const no_code_fence_warning = "出力は必ず純粋なJSON文字列のみ（バックティックやコードブロック禁止）。";

export const instruction_chunk = `【chunkモードの出力指針】
- middle_summary（必須）: reduce統合に最適化した最小要点の列。
- soft_language_summary（必須）: このchunk範囲を一般読者向けにやさしく説明。
- summary（必須）: このchunk範囲の詳細要約。
- dialogs/participants/terms/keywords: このchunkに現れた範囲で必要なもののみ。
- title / category / description / date は出力しない（reduceで決定）。
- 入力に [context before] / [context after] がある場合は、chunk外の前後発言。質問→回答などの関係把握に使ってよいが、dialogsはchunk内の発言のみ出力する。
- [chunk] 内の [order N] は **すべて dialogs に1件ずつ** 出力すること（欠落・重複禁止）。
- ${no_code_fence_warning}`;

export const instruction_reduce = `【reduceモードの出力指針】
- 全chunkの middle_summary を統合し、重複排除・矛盾解消・網羅性確保。
- key_points は会議の要点を3〜5点の箇条書きでまとめる。
- participants は chunk由来の重複/別表記を正規化し、一人につき要旨を統合。役職や所属は可能なら統合、曖昧なら空欄可。
- keywords は会議全体の主要テーマ/論点/政策ワードを重複排除し、priority を high/medium/low で付与。
- 出力は title / category / description / date / key_points / summary / soft_language_summary / participants / keywords。
- summary 構成（推奨）: 決定事項 / 主要論点と立場 / 未決・宿題 / 次に起こること（担当・期限） / 重要数値。
- based_on_orders は統合後に参照した order のユニオンまたは代表範囲。
- dialogs / terms は出力しない。
- ${no_code_fence_warning}`;

export const output_format_chunk = `### 出力フォーマット（chunk）

{
  "prompt_version": "${PROMPT_VERSION}",
  "id": "文字列 (内部ID。入力の[meta]にあるIDをそのまま出力)",

  "middle_summary": [
    {
      "based_on_orders": [4,5],
      "summary": "reduceで統合しやすい1要点（決定/対立/未決/宿題/担当/期限/金額を簡潔に） [[orders:4,5]]"
    }
  ],

  "soft_language_summary": {
    "based_on_orders": [1,2,3],
    "summary": "やさしい言葉での説明（このchunk範囲）です。[[orders:1,2,3]]"
  },
  "summary": {
    "based_on_orders": [1,2,3],
    "summary": "このchunk範囲の詳細要約 [[orders:1-3]]"
  },

  "dialogs": [
    {
      "order": 1,
      "summary_sections": [
        { "title": "主張", "bullets": ["要点1"] },
        { "title": "説明", "bullets": ["要点2"] },
        { "title": "決定", "bullets": ["合意した方針"] }
      ],
      "qa": [
        {
          "ask": {
            "question": "△△について今後の方針は？",
            "who": "〇〇議員",
            "orders": [1,2]
          },
          "answer": "□□大臣が…と回答",
          "answer_orders": [3]
        }
      ],
    }
  ],

  "participants": [
    { "name": "話者名", "position": "役職（不明可）", "summary": "この人の発言要旨（chunk範囲）" }
  ],

  "terms": [
    { "term": "専門用語", "definition": "その説明（chunkで出たもののみ）" }
  ],

  "keywords": [
    { "keyword": "代表表記", "priority": "high | medium | low" }
  ]
}
`;

export const output_format_reduce = `### 出力フォーマット（reduce）

{
  "prompt_version": "${PROMPT_VERSION}",
  "id": "文字列 (内部ID。入力の[meta]にあるIDをそのまま出力)",

  "title": "要点がひと目で分かる見出し（最終）",
  "category": "会議全体を表すカテゴリ（主要テーマや種別を簡潔に）",
  "description": "1〜2文＋必要なら箇条書きで全体像をひと目で伝える",
  "date": "開催日 (YYYY-MM-DD) または 空文字",
  "key_points": [
    "会議全体の要点1",
    "会議全体の要点2",
    "会議全体の要点3"
  ],

  "summary": {
    "based_on_orders": [1,2,3,4,5],
    "summary": "会議全体の最終要約（決定事項/主要論点/未決・宿題/次に起こること/重要数値を簡潔に） [[orders:1-5]]"
  },
  "soft_language_summary": {
    "based_on_orders": [1,2,3,4,5],
    "summary": "会議全体をやさしい言葉で説明した要約です。[[orders:1-5]]"
  },

  "participants": [
    {
      "name": "話者名（重複統合後）",
      "position": "役職（分かれば）",
      "summary": "この人の発言要旨（会議全体を統合）",
      "based_on_orders": [10,14,29]
    }
  ],

  "keywords": [
    { "keyword": "代表表記", "priority": "high | medium | low" }
  ]
}
`;

export const chunk_prompt = (input: string): string => {
  return `${instruction_common}
${instruction_chunk}
${output_format_chunk}
### 入力
${input}`;
};

export const reduce_prompt = (input: string): string => {
  return `${instruction_common}
${instruction_reduce}
${output_format_reduce}
### 入力
${input}`;
};

export const TEST_PROMPT_INPUT = `会議名: 予算委員会 第3号
開催日: 2025-02-10

[order 1] 委員長が開会を宣言し、補正予算案の審議目的を確認。
[order 2] 財務大臣が総額8兆円の補正案の概要と災害復旧枠を説明。
[order 3] 野党議員が災害復旧費の執行遅延と自治体負担増を指摘し、期限と担当部署を質す。
[order 4] 大臣が執行指針を3月末までに示し、地方支援を強化すると回答。
[order 5] 与党議員が中小企業向け利子補給制度の実績と拡充計画を質問。
[order 6] 経産省が対象業種を広げ、金利補助率を1.5%→2.0%に引き上げる案を報告。
[order 7] 複数委員が防災投資の長期計画とKPI開示を求め、政府は夏までに骨子をまとめると説明。`;
export const buildTestReduceInput = (taskId: string): string => {
  return `${TEST_PROMPT_INPUT}

[meta]
内部ID: ${taskId}
上記IDを必ずそのまま"id"として出力すること。`;
};
