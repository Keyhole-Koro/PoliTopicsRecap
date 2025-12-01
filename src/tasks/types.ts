export type TaskStatus = "pending" | "completed";
export type ChunkStatus = "notReady" | "ready";
export type ProcessingMode = "direct" | "chunked";

export type Meeting = {
  issueID: string;
  nameOfMeeting: string;
  nameOfHouse: string;
  date: string;
  numberOfSpeeches: number;
};

export type ChunkItem = {
  id: string;
  prompt_key: string;
  prompt_url: string;
  result_url: string;
  status: ChunkStatus;
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
};
