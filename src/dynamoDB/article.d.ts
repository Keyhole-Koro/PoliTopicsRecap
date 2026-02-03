export type BaseSummary = {
  based_on_orders: number[];
  summary: string;
};

export type Summary = BaseSummary;
export type SoftLanguageSummary = BaseSummary;
export type MiddleSummary = BaseSummary;

export type DialogSectionTitle =
  | "主張"
  | "説明"
  | "質問"
  | "回答"
  | "根拠"
  | "影響"
  | "次の対応"
  | "決定";

export type DialogSection = {
  title: DialogSectionTitle;
  bullets: string[];
};

export type Dialog = {
  order: number;
  summary_sections: DialogSection[];
  reaction?: "賛成" | "反対" | "質問" | "回答" | "中立";
  qa?: {
    ask: {
      question: string;
      who: string;
      orders: number[];
    };
    answer: string;
    answer_orders: number[];
  } | {
    ask: {
      question: string;
      who: string;
      orders: number[];
    };
    answer: string;
    answer_orders: number[];
  }[];
  original_text: string;
  speaker: string;
  speakerYomi?: string | null;
  speakerGroup?: string | null;
  speakerPosition?: string | null;
  position?: string;
};

export type Participant = {
  name: string;
  position?: string;
  summary: string;
  based_on_orders?: number[];
};

export type KeywordPriority = "high" | "medium" | "low";

export type Keyword = {
  keyword: string;
  priority: KeywordPriority;
};

export type Term = {
  term: string;
  definition: string;
};

export default interface Article {
  id: string;
  issueID?: string;
  title: string;
  date: string;  // ISO string or "YYYY-MM-DD" (will be normalized to ISO UTC)
  month: string; // "YYYY-MM" (will be normalized to align with `date`)
  imageKind: "会議録" | "目次" | "索引" | "附録" | "追録";
  session: number;
  nameOfHouse: string;
  nameOfMeeting: string;
  categories: string[];
  description: string;

  key_points: string[];
  summary: Summary;
  soft_language_summary: SoftLanguageSummary;
  middle_summary: MiddleSummary[];
  dialogs: Dialog[];
  participants: Participant[];
  keywords: Keyword[];
  terms: Term[];
}
