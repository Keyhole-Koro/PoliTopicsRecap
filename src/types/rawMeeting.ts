export type RawSpeechRecord = {
  speechID: string;
  speechOrder: number;
  speaker: string;
  speakerYomi?: string | null;
  speakerGroup?: string | null;
  speakerPosition?: string | null;
  speakerRole?: string | null;
  speech: string;
  startPage?: number;
  createTime?: string;
  updateTime?: string;
  speechURL?: string;
};

export type RawMeetingRecord = {
  issueID: string;
  imageKind?: string;
  searchObject?: number;
  session: number;
  nameOfHouse: string;
  nameOfMeeting: string;
  issue?: string;
  date: string;
  closing?: string | null;
  speechRecord: RawSpeechRecord[];
};

export type RawMeetingPayload = {
  meeting: RawMeetingRecord;
  ingestedAt: string;
  source: "kokkai.ndl";
};
