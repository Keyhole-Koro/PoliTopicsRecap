export const PROMPT_VERSION = "2025-10-02.1";

export const instruction_common = `【目的】
国会議事録をAIで要約し、一般の読者にもわかりやすく説明すること。専門用語や制度に不慣れな人でも「何が決まり、何が議論され、次に何が起こるか」が直感的に掴める要約データを作成してください。

タスクは2モード:
- chunk: 会議全体の一部（発言群）を処理し、reduce統合を見越した middle_summary を中心に出力。soft_language_summary と summary は必須。
- reduce: 全 chunk 出力（特に middle_summary と participants）を統合し、会議全体の summary / soft_language_summary に加え、title / category / description / date / participants を生成。

厳守:
- middle_summary は「1トピック=1要点」。重複回避、結論/対立/未決/宿題/担当/期限/金額を明示できる範囲で。
- すべての要点に based_on_orders（発言 order 配列）を付与。
- 余談や定型挨拶は除外。推測や創作は禁止。
- summary / soft_language_summary / middle_summary は Markdown の機能を自由に使ってよい。
- すべての出力に prompt_version を含める（現在値: ${PROMPT_VERSION}）。`;

const no_code_fence_warning = "出力は必ず純粋なJSON文字列のみ（バックティックやコードブロック禁止）。";

export const instruction_chunk = `【chunkモードの出力指針】
- middle_summary（必須）: reduce統合に最適化した最小要点の列。
- soft_language_summary（必須）: このchunk範囲を一般読者向けにやさしく説明。
- summary（必須）: このchunk範囲の詳細要約。
- dialogs/participants/terms/keywords: このchunkに現れた範囲で必要なもののみ。
- title / category / description / date は出力しない（reduceで決定）。
- ${no_code_fence_warning}`;

export const instruction_reduce = `【reduceモードの出力指針】
- 全chunkの middle_summary を統合し、重複排除・矛盾解消・網羅性確保。
- participants は chunk由来の重複/別表記を正規化し、一人につき要旨を統合。役職や所属は可能なら統合、曖昧なら空欄可。
- keywords は会議全体の主要テーマ/論点/政策ワードを重複排除し、priority を high/medium/low で付与。
- 出力は title / category / description / date / summary / soft_language_summary / participants / keywords。
- summary 構成（推奨）: 決定事項 / 主要論点と立場 / 未決・宿題 / 次に起こること（担当・期限） / 重要数値。
- based_on_orders は統合後に参照した order のユニオンまたは代表範囲。
- dialogs / terms は出力しない。
- ${no_code_fence_warning}`;

export const output_format_chunk = `### 出力フォーマット（chunk）

{
  "prompt_version": "${PROMPT_VERSION}",
  "id": "文字列 (議事録ID 例: issueID)",

  "middle_summary": [
    {
      "based_on_orders": [4,5],
      "summary": "reduceで統合しやすい1要点（決定/対立/未決/宿題/担当/期限/金額を簡潔に）"
    }
  ],

  "soft_language_summary": {
    "based_on_orders": [1,2,3],
    "summary": "やさしい言葉での説明（このchunk範囲）"
  },
  "summary": {
    "based_on_orders": [1,2,3],
    "summary": "このchunk範囲の詳細要約"
  },

  "dialogs": [
    {
      "order": 1,
      "summary": "発言内容の要約",
      "soft_language": "原文を崩さずやさしく言い換えた文章",
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
  "id": "文字列 (議事録ID 例: issueID)",

  "title": "要点がひと目で分かる見出し（最終）",
  "category": "会議全体を表すカテゴリ（主要テーマや種別を簡潔に）",
  "description": "1〜2文＋必要なら箇条書きで全体像をひと目で伝える",
  "date": "開催日 (YYYY-MM-DD) または 空文字",

  "summary": {
    "based_on_orders": [1,2,3,4,5],
    "summary": "会議全体の最終要約（決定事項/主要論点/未決・宿題/次に起こること/重要数値を簡潔に）"
  },
  "soft_language_summary": {
    "based_on_orders": [1,2,3,4,5],
    "summary": "会議全体をやさしい言葉で説明した要約"
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
export const buildTestReduceInput = (issueID: string): string => {
  return `${TEST_PROMPT_INPUT}

[meta]
議事録ID: ${issueID}
上記IDを必ずそのまま"id"として出力すること。`;
};
