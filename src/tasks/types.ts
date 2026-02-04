export type TaskStatus = "ingested" | "pending" | "remake" | "completed";
export type ChunkStatus = "pending" | "completed";
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
  based_on_orders?: number[];
};

export type AttachedAssets = {
  speakerMetadataUrl: string;
};

export type TaskItem = {
  pk: string; // internal task ID (hash of session + house + issueID)
  status: TaskStatus;
  llm?: string;
  llmModel?: string;
  retryAttempts?: number;
  createdAt: string;
  updatedAt: string;
  processingMode?: ProcessingMode;
  prompt_version?: string;
  prompt_url?: string;
  raw_url?: string;
  raw_hash?: string;
  maxInputToken?: number;
  meeting: Meeting;
  result_url?: string;
  chunks?: ChunkItem[];
  attachedAssets: AttachedAssets;
};
