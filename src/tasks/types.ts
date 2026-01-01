export type TaskStatus = "pending" | "completed";
export type ChunkStatus = "notReady" | "ready";
export type ProcessingMode = "single_chunk" | "chunked";

export type Meeting = {
  issueID: string;
  nameOfMeeting: string;
  nameOfHouse: string;
  date: string;
  numberOfSpeeches: number;
  session: number;
};

export type ChunkItem = {
  id: string;
  prompt_key: string;
  prompt_url: string;
  result_url: string;
  status: ChunkStatus;
};

export type AttachedAssets = {
  speakerMetadataUrl: string;
};

export type TaskItem = {
  pk: string;
  status: TaskStatus;
  llm: string;
  llmModel: string;
  retryAttempts: number;
  createdAt: string;
  updatedAt: string;
  processingMode: ProcessingMode;
  prompt_url: string;
  meeting: Meeting;
  result_url: string;
  chunks?: ChunkItem[];
  attachedAssets: AttachedAssets;
};
