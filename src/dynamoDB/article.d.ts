export default interface Article {
  id: string;
  title: string;
  date: string;  // ISO string or "YYYY-MM-DD" (will be normalized to ISO UTC)
  month: string; // "YYYY-MM" (will be normalized to align with `date`)
  imageKind: "会議録" | "目次" | "索引" | "附録" | "追録";
  session: number;
  nameOfHouse: string;
  nameOfMeeting: string;
  categories: string[];
  description: string;

  summary: Summary;
  soft_summary: SoftSummary;
  middle_summary: MiddleSummary[];
  dialogs: Dialog[];
  participants: Participant[];
  keywords: Keyword[];
  terms: Term[];
}
