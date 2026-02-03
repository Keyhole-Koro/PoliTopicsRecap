export const PROMPT_VERSION = "6.1";

export const instruction_common = `【目的】
国会議事録をAIで要約し、一般の読者にもわかりやすく説明すること。専門用語や制度に不慣れな人でも「何が決まり、何が議論され、次に何が起こるか」が直感的に掴める要約データを作成してください。

タスクは3モード:
- chunk: 会議全体の一部（発言群）を処理し、reduce統合を見越した middle_summary を中心に出力。soft_language_summary と summary は必須。
- reduce: 全 chunk 出力（特に middle_summary と participants）を統合し、会議全体の summary / soft_language_summary に加え、title / category / description / date / participants / key_points を生成。
- single_chunk: 会議全体が1chunkで収まる場合に chunk / reduce の両出力を同時に提供。chunkセクションは chunkモード同等、reduceセクションは reduceモード同等の厳密さで記述する。

厳守:
- middle_summary は「1トピック=1要点」。重複回避、結論/対立/未決/宿題/担当/期限/金額を明示できる範囲で。
- すべての要点に based_on_orders（発言 order 配列）を付与。
- 余談や定型挨拶は除外。推測や創作は禁止。
- summary は Markdown を必ず活用する（見出し＋箇条書きは必須）。プレーンテキストのみは禁止。
- summary は見出し（## / ###）＋箇条書き（-）を必須とし、視認性を優先する。
- middle_summary.summary は **ラベル** ＋短い箇条書きを必須とし、1トピック内に留める。
- 数値/期限/担当がある場合は GFM 表（| 区切り）で整理する。該当なしの場合は表を出さない。
- JSON 文字列内の改行は \\n を使う（実際の改行・コードフェンス・HTMLは不可）。
- id は入力の [meta] にある内部IDをそのまま出力すること（issueIDと一致しない場合がある）。
- dialogs の各発言には、発言の性質を表す reaction を必ず付与すること（賛成 / 反対 / 質問 / 回答 / 中立 のいずれか1つ）。
- dialogs は summary_sections のみで要点を表現する（summary / soft_language は出力しない）。
- summary_sections は必須。各要素は { "title": "主張", "bullets": [{ "point": "...", "quote": "...", "detail": "..." }] } の配列で、title は固定セットのみ（「主張」「説明」「質問」「回答」「根拠」「影響」「次の対応」「決定」）。
- bullets の要素は **オブジェクト**。point / quote / detail は**全て必須**で省略禁止。
- quote は発言原文に忠実な引用。detail は要点の補足で、読者の理解補助が目的。
- dialogs の summary_sections / qa は内容を重複させない。qa がある場合、質問・回答の内容は section に書かない。
- dialogs は入力の [order N] ごとに **必ず1件ずつ** 出力する（欠落・重複は禁止）。order 値は入力の [order N] と完全一致させる。
- soft_language_summary は箇条書きにせず、短い文章で書く（です/ます調・短文）。硬い制度語は可能なら言い換え、必要なら短い補足（例:「歳出=使うお金」）を括弧で添える。各文は短くし、冗長説明や強い断定・感情表現は禁止。
- 質問→回答が明確な場合、回答側の dialog に qa（配列）を付与する（質問側は reaction=質問のみで可）。
  - qa は複数質問に対応するため配列にする。
  - qa[].ask.question は「質問内容」そのものを記述する（例: "△△について今後の方針は？"）。
  - qa[].ask.who は質問者名、qa[].ask.orders は質問の order 配列（number[]）。
  - qa[].answer は回答要旨、qa[].answer_orders は回答の order 配列（number[]）。
  - qa[].ask.question / qa[].answer は1文で簡潔に。
- summary / soft_language_summary / middle_summary の本文には (order: 1) のような注記は書かない。order参照は本文末尾に \`[[orders:1,2,3]]\` のみ許可（数字・カンマ・ハイフンのみ、空白なし）。
- すべての出力に prompt_version を含める（現在値: ${PROMPT_VERSION}）。`;

export const instruction_chunk = `【chunkモードの出力指針】
- middle_summary（必須）: reduce統合に最適化した最小要点の列。
- soft_language_summary（必須）: このchunk範囲を一般読者向けにやさしく説明。
- summary（必須）: このchunk範囲の詳細要約。
- dialogs/participants/terms/keywords: このchunkに現れた範囲で必要なもののみ。
- title / category / description / date は出力しない（reduceで決定）。
 - 入力に [context before] / [context after] がある場合は、chunk外の前後発言。質問→回答などの関係把握に使ってよいが、dialogsはchunk内の発言のみ出力する。
 - [chunk] 内の [order N] は **すべて dialogs に1件ずつ** 出力すること（欠落・重複禁止）。

補足:
- middle_summaryのsummaryには必ず論点の背景（誰が、どの立場で、何を主張/回答したか）を1文以上で含め、based_on_ordersの順序と自然に対応させること。
- soft_language_summaryは「このchunkの意味」を新規読者にストーリーとして伝える。個人名・役職・具体的数値や締切が登場した場合は、分かる範囲で自然文に織り込む。
- participantsのsummaryでは、reduce処理者が議事録原文を追い直さなくても意図を理解できるよう、1〜2文で発言意図とアクションを明示する。`;

export const instruction_reduce = `【reduceモードの出力指針】
- 全chunkの middle_summary を統合し、重複排除・矛盾解消・網羅性確保。
- participants は chunk由来の重複/別表記を正規化し、一人につき要旨を統合。役職や所属は可能なら統合、曖昧なら空欄可。
- 出力は title / category / description / date / summary / soft_language_summary / participants / key_points。
- description は一般読者が「なぜ重要か」「自分にどう関係するか」を直感的に掴める内容にする（1〜2文＋必要なら箇条書き）。
- summary 構成（推奨）: 決定事項 / 主要論点と立場 / 未決・宿題 / 次に起こること（担当・期限） / 重要数値。
- key_points: 記事のTL;DR（要約）として、議論の核心・結論・影響を3点程度の箇条書きで簡潔にまとめる。
- based_on_orders は統合後に参照した order のユニオンまたは代表範囲。
- dialogs / terms / keywords は出力しない。`;

export const instruction_single_chunk = `【single_chunkモード（統合出力）の指針】
- 出力は chunk / reduce に分けず、single_chunk として1つのJSONに統合する。
- middle_summary・dialogs・terms・keywords は chunk粒度として作成する。
- title / category / description / date / summary / soft_language_summary / participants / key_points は meeting粒度として完成形で出力する。
- description は一般読者が「なぜ重要か」「自分にどう関係するか」が分かる内容（1〜2文＋必要なら箇条書き）にする。
- summary は middle_summary の要点を昇華・統合した構造化要約とする。
- chunk粒度と meeting粒度で内容を矛盾させない。
- based_on_orders は該当するすべての要約・participantsに必ず付与する。
- dialogs の reaction、数値・担当者・期限の明示など、共通の厳守事項はすべて維持する。
- single_chunk でも [order N] ごとに dialogs を必ず1件ずつ出力する。欠落・重複は禁止。`;

export const output_format_chunk = `### 出力フォーマット（chunk）

{
  "prompt_version": "${PROMPT_VERSION}",
  "id": "文字列 (内部ID。入力の[meta]にあるIDをそのまま出力)",

  "middle_summary": [
    {
      "based_on_orders": [4,5],
      "summary": "**論点:** reduceで統合しやすい1要点\\n- **結論:** ... [[orders:4,5]]\\n- **担当/期限:** ... [[orders:4,5]]"
    }
  ],

  "soft_language_summary": {
    "based_on_orders": [1,2,3],
    "summary": "このchunkのポイントは...です。[[orders:1,2]]\\n生活への影響は...です。[[orders:2,3]]"
  },
  "summary": {
    "based_on_orders": [1,2,3],
    "summary": "## 決定事項\\n- **結論:** ... [[orders:1,2]]\\n- **担当:** ... [[orders:2,3]]\\n## 主要論点\\n- ... [[orders:1,3]]\\n## 未決・宿題\\n- ... [[orders:3]]\\n### 数値・期限（該当時のみ）\\n|項目|内容|\\n|---|---|\\n|予算|...|"
  },

  "dialogs": [
    {
      "order": 1,
      "summary_sections": [
        { "title": "主張", "bullets": [{ "point": "要点1", "quote": "引用（過不足なく）", "detail": "補足（過不足なく）" }] },
        { "title": "説明", "bullets": [{ "point": "要点2", "quote": "引用（過不足なく）", "detail": "補足（過不足なく）" }] },
        { "title": "決定", "bullets": [{ "point": "合意した方針", "quote": "引用（過不足なく）", "detail": "補足（過不足なく）" }] }
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
      "reaction": "賛成" / 賛成 / 反対 / 質問 / 回答 / 中立 のいずれか1つ
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
  "description": "一般読者が「なぜ重要か」「自分にどう関係するか」が分かる内容（1〜2文＋必要なら箇条書き）",
  "date": "開催日 (YYYY-MM-DD) または 空文字",

  "key_points": [
    "TL;DR要点1 (核心)",
    "TL;DR要点2 (結論)",
    "TL;DR要点3 (影響)"
  ],

  "summary": {
    "based_on_orders": [1,2,3,4,5],
    "summary": "## 決定事項\\n- **結論:** ... [[orders:1,2,3]]\\n- **担当:** ... [[orders:3,4]]\\n## 主要論点と立場\\n- ... [[orders:2-5]]\\n## 未決・宿題\\n- ... [[orders:4,5]]\\n## 次に起こること\\n- ... [[orders:5]]\\n### 重要数値・期限（該当時のみ）\\n|項目|内容|\\n|---|---|\\n|期限|...|"
  },
  "soft_language_summary": {
    "based_on_orders": [1,2,3,4,5],
    "summary": "会議の全体像は...です。[[orders:1,2]]\\n暮らしへの影響は...です。[[orders:4,5]]"
  },

  "participants": [
    {
      "name": "話者名（重複統合後）",
      "position": "役職（分かれば）",
      "summary": "この人の発言要旨（会議全体を統合）",
      "based_on_orders": [10,14,29] // 代表となる発言 order
    }
  ]
}
`;

export const output_format_single_chunk = `### 出力フォーマット（single_chunk・統合）

{
  "prompt_version": "${PROMPT_VERSION}",
  "id": "文字列 (内部ID。入力の[meta]にあるIDをそのまま出力)",

  "title": "single chunkから導く会議全体の見出し",
  "category": "会議全体を表すカテゴリ",
  "description": "一般読者が「なぜ重要か」「自分にどう関係するか」が分かる内容（1〜2文＋必要なら箇条書き）",
  "date": "開催日 (YYYY-MM-DD) または 空文字",

  "key_points": [
    "TL;DR要点1 (核心)",
    "TL;DR要点2 (結論)",
    "TL;DR要点3 (影響)"
  ],

  "middle_summary": [
    {
      "based_on_orders": [4,5],
      "summary": "reduce統合に最適化した1要点（chunk粒度） [[orders:4,5]]"
    }
  ],

  "soft_language_summary": {
    "based_on_orders": [1,2,3],
    "summary": "会議の全体像は...です。[[orders:1,2]]\\n暮らしへの影響は...です。[[orders:2,3]]"
  },
  "summary": {
    "based_on_orders": [1,2,3,4,5],
    "summary": "## 決定事項\\n- **結論:** ... [[orders:1,2]]\\n- **担当:** ... [[orders:2,3]]\\n## 主要論点\\n- ... [[orders:1,3,4]]\\n## 未決・宿題\\n- ... [[orders:4,5]]\\n## 次に起こること\\n- ... [[orders:5]]\\n### 重要数値・期限（該当時のみ）\\n|項目|内容|\\n|---|---|\\n|予算|...|"
  },

  "dialogs": [
    {
      "order": 1,
      "summary_sections": [
        { "title": "主張", "bullets": [{ "point": "要点1", "quote": "引用（過不足なく）", "detail": "補足（過不足なく）" }] },
        { "title": "説明", "bullets": [{ "point": "要点2", "quote": "引用（過不足なく）", "detail": "補足（過不足なく）" }] },
        { "title": "決定", "bullets": [{ "point": "合意した方針", "quote": "引用（過不足なく）", "detail": "補足（過不足なく）" }] }
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
      "reaction": "賛成 / 反対 / 質問 / 回答 / 中立 のいずれか1つ"
    }
  ],

  "participants": [
    {
      "name": "話者名",
      "position": "役職（不明可）",
      "summary": "この人の発言要旨（会議全体）"
    }
  ],

  "terms": [
    {
      "term": "専門用語",
      "definition": "chunkで出た用語の説明"
    }
  ],

  "keywords": [
    {
      "keyword": "代表表記",
      "priority": "high | medium | low"
    }
  ]
}
`;

export const chunk_prompt = (input: string): string => {
  return `${instruction_common}\n${instruction_chunk}\n${output_format_chunk}\n### 入力\n${input}`;
};

export const reduce_prompt = (input: string): string => {
  return `${instruction_common}\n${instruction_reduce}\n${output_format_reduce}\n### 入力\n${input}`;
};

export const single_chunk_prompt = (input: string): string => {
  return `${instruction_common}
${instruction_single_chunk}
${output_format_single_chunk}
### 入力
${input}`;
};
