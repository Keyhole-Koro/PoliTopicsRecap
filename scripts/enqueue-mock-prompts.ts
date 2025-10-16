// scripts/enqueue-mock-prompts.ts
import "dotenv/config";
import { randomUUID } from "crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

import { getAwsBaseConfig, getS3ClientConfig } from "../src/utils/aws";
import type { MapPromptTaskMessage } from "../src/sqs/map";
import type { ReducePromptTaskMessage } from "../src/sqs/reduce";
import {
  PROMPT_VERSION,
  chunk_prompt,
  reduce_prompt,
} from "./prompts";

// ===== Types that match your LLM input contract =====
export interface RawMeetingData {
  numberOfRecords: number;
  numberOfReturn: number;
  startRecord: number;
  nextRecordPosition: number;
  meetingRecord: RawMeetingRecord[];
}
export interface RawMeetingRecord {
  issueID: string;
  imageKind: string;
  searchObject: number;
  session: number;
  nameOfHouse: string;
  nameOfMeeting: string;
  issue: string;
  date: string;
  closing: string | null;
  speechRecord: RawSpeechRecord[];
}
export interface RawSpeechRecord {
  speechID: string;
  speechOrder: number;
  speaker: string;
  speakerYomi: string | null;
  speakerGroup: string | null;
  speakerPosition: string | null;
  speakerRole: string | null;
  speech: string;
  startPage: number;
  createTime: string;
  updateTime: string;
  speechURL: string;
}

// ===== Mock data definitions (Japanese content) =====
type MapFixture = {
  sessionLabel: string;
  date: string; // YYYY-MM-DD
  house: string;
  meeting: string;
  issueTitle: string;
  participants: { name: string; position?: string | null; group?: string | null }[];
  dialogs: { order: number; speaker: string; summary: string; soft: string }[];
  points: { based_on_orders: number[]; summary: string }[];
  softSummary: { based_on_orders: number[]; summary: string };
  terms?: { term: string; definition: string }[];
  keywords?: { keyword: string; priority: "high" | "medium" | "low" }[];
};

const mapFixtures: MapFixture[] = [
  {
    sessionLabel: "午前セッション – 予算執行の可視化",
    date: new Date().toISOString().slice(0, 10),
    house: "衆議院",
    meeting: "教育近代化に関する特別委員会",
    issueTitle: "教育助成金の執行管理・透明化",
    participants: [
      { name: "佐藤なおみ", position: "委員長" },
      { name: "伊藤けん", position: "議員" },
      { name: "林りこ", position: "副大臣", group: "文部科学省" },
    ],
    dialogs: [
      { order: 1, speaker: "佐藤なおみ", summary: "助成金の執行を追跡するダッシュボードの必要性を提起。", soft: "お金の流れを誰でも見える形にしましょう、という話です。" },
      { order: 2, speaker: "伊藤けん", summary: "STEM助成の交付が遅い理由と改善計画の説明を要求。", soft: "なぜ遅れているのか、どう直すのかをはっきりさせましょう。" },
      { order: 3, speaker: "林りこ", summary: "報告経路に滞りがあると認め、隔週で進捗を公開すると回答。", soft: "2週間に1回、進み具合をきちんと出します、という約束です。" },
    ],
    points: [
      { based_on_orders: [1, 2, 3], summary: "助成金執行の可視化を強化。担当: 文科省。隔週アップデートで遅延是正（期限: 2週間おき）。" },
    ],
    softSummary: {
      based_on_orders: [1, 2, 3],
      summary: "助成金の扱いをもっと見える化して、遅れをなくすために、2週間ごとの進捗報告を始める方針になりました。",
    },
    terms: [{ term: "STEM助成", definition: "理数・技術教育のための助成金。" }],
    keywords: [{ keyword: "助成金の可視化", priority: "high" }],
  },
  {
    sessionLabel: "午後セッション – デジタル授業の実証",
    date: new Date().toISOString().slice(0, 10),
    house: "衆議院",
    meeting: "教育近代化に関する特別委員会",
    issueTitle: "デジタル教室の実証と全国展開",
    participants: [
      { name: "高橋エレナ", position: "教授" },
      { name: "黒田マーティン", position: "労組代表" },
      { name: "佐藤なおみ", position: "委員長" },
    ],
    dialogs: [
      { order: 1, speaker: "高橋エレナ", summary: "AI支援の授業で生徒の参加が15%増加という成果を共有。", soft: "AIの手助けで、授業に参加する生徒が前より増えました。" },
      { order: 2, speaker: "黒田マーティン", summary: "導入には教員研修や準備時間の確保が不可欠と主張。", soft: "先生たちにとって無理がないよう、学ぶ時間や準備の時間が必要です。" },
      { order: 3, speaker: "佐藤なおみ", summary: "全国展開前に実施準備度の基準を公表する計画を示した。", soft: "どこまで準備できたら始められるか、基準を先に示します。" },
    ],
    points: [
      { based_on_orders: [1, 2, 3], summary: "AI支援授業の効果は確認。全国展開には教員研修と準備時間の確保が前提。文科省が準備度基準を公表予定。" },
    ],
    softSummary: {
      based_on_orders: [1, 2, 3],
      summary: "AIで授業が良くなっている一方、先生の準備や学ぶ時間もセットで用意しようという話でした。",
    },
    terms: [{ term: "実装準備度", definition: "導入可否を判断するための基準。" }],
    keywords: [{ keyword: "AI支援授業", priority: "high" }],
  },
];

// ===== Helpers: build RawMeetingData per fixture =====
function buildRawMeetingData(issueID: string, fixture: MapFixture, nowISO: string): RawMeetingData {
  const speechRecords: RawSpeechRecord[] = fixture.dialogs.map((d, idx) => {
    const speakerMeta = fixture.participants.find((p) => p.name === d.speaker) ?? { name: d.speaker };
    return {
      speechID: `${issueID}-${d.order}`,
      speechOrder: d.order,
      speaker: d.speaker,
      speakerYomi: null,
      speakerGroup: speakerMeta.group ?? null,
      speakerPosition: speakerMeta.position ?? null,
      speakerRole: null,
      speech: `${d.soft}\n\n【要旨】${d.summary}`,
      startPage: 1 + idx,
      createTime: nowISO,
      updateTime: nowISO,
      speechURL: "",
    };
  });

  const record: RawMeetingRecord = {
    issueID,
    imageKind: "text",
    searchObject: 0,
    session: 1,
    nameOfHouse: fixture.house,
    nameOfMeeting: fixture.meeting,
    issue: fixture.issueTitle,
    date: fixture.date,
    closing: null,
    speechRecord: speechRecords,
  };

  return {
    numberOfRecords: 1,
    numberOfReturn: 1,
    startRecord: 1,
    nextRecordPosition: 0,
    meetingRecord: [record],
  };
}

// ===== Helper: endpoint & URL normalize =====
function resolveEndpoint(): string {
  return process.env.AWS_ENDPOINT_URL_S3 ?? process.env.AWS_ENDPOINT_URL ?? "http://localstack:4566";
}

// ===== Main enqueue logic =====
async function main(): Promise<void> {
  const queueUrl = process.env.PROMPT_QUEUE_URL;
  console.log("Using PROMPT_QUEUE_URL:", queueUrl);
  if (!queueUrl) throw new Error("PROMPT_QUEUE_URL is required.");

  const bucketName =
    process.env.PROMPT_BUCKET_NAME ??
    process.env.PROMPT_BUCKET ??
    process.env.PROMPT_RESULTS_BUCKET;
  if (!bucketName) throw new Error("PROMPT_BUCKET_NAME or equivalent is required.");

  const endpoint = resolveEndpoint();

  // ---- Clients
  const awsBase = getAwsBaseConfig();
  const s3Config = getS3ClientConfig();

  const s3Client = new S3Client({
    ...s3Config,
    endpoint,
    forcePathStyle: true,
    bucketEndpoint: false,
  });

  const sqsClient = new SQSClient(awsBase);

  const runId = randomUUID();
  const nowISO = new Date().toISOString();
  const prefix = `demo/${nowISO.replace(/[:.]/g, "-")}-${runId}`;

  const chunkResultUrls: string[] = [];
  const mapPromptUris: string[] = [];
  const reduceIssueID = `EDU-OVERSIGHT-${runId.slice(0, 8).toUpperCase()}`;

  // Enqueue MAP (chunk) messages
  for (let i = 0; i < mapFixtures.length; i += 1) {
    const fixture = mapFixtures[i];
    const mapNum = i + 1;
    const issueID = `${reduceIssueID}-CH${mapNum}`;

    const input = buildRawMeetingData(issueID, fixture, nowISO);
    const inputKey = `${prefix}/map-${mapNum}-input.json`;
    const resultKey = `${prefix}/map-${mapNum}-result.json`;
    const promptKey = `${prefix}/map-${mapNum}-prompt.txt`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: inputKey,
        Body: JSON.stringify(input, null, 2),
        ContentType: "application/json",
      }),
    );

    const promptText = chunk_prompt(JSON.stringify(input, null, 2));

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: promptKey,
        Body: promptText,
        ContentType: "text/plain; charset=utf-8",
      }),
    );

    const mapMessage: MapPromptTaskMessage = {
      type: "map",
      url: `s3://${bucketName}/${inputKey}`,
      result_url: `s3://${bucketName}/${resultKey}`,
      llm: "gemini",
      llmModel: "gemini-2.5-pro",
      retryAttempts: 0,
      meta: {
        runId,
        sessionLabel: fixture.sessionLabel,
        seededBy: "enqueue-mock-prompts",
        prompt_version: PROMPT_VERSION,
        prompt_s3_uri: `s3://${bucketName}/${promptKey}`,
      },
    };

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(mapMessage),
      }),
    );

    chunkResultUrls.push(`s3://${bucketName}/${resultKey}`);
    mapPromptUris.push(`s3://${bucketName}/${promptKey}`);
  }

  // Enqueue REDUCE message
  const meetingMeta = {
    issueID: reduceIssueID,
    nameOfMeeting: "教育近代化に関する特別委員会",
    nameOfHouse: "衆議院",
    date: nowISO.slice(0, 10),
    numberOfSpeeches: mapFixtures.reduce((sum, f) => sum + f.dialogs.length, 0),
  };

  const reduceInput = {
    meeting: meetingMeta,
    chunk_result_urls: chunkResultUrls,
    note:
      "全chunkの middle_summary と participants を統合し、based_on_orders はユニオンまたは代表範囲で示してください。",
  };

  const reducePromptKey = `${prefix}/reduce-prompt.txt`;
  const reducePromptText = reduce_prompt(JSON.stringify(reduceInput, null, 2));

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: reducePromptKey,
      Body: reducePromptText,
      ContentType: "text/plain; charset=utf-8",
    }),
  );

  const reducePromptUri = `s3://${bucketName}/${reducePromptKey}`;

  const reduceMessage: ReducePromptTaskMessage = {
    type: "reduce",
    chunk_result_urls: chunkResultUrls,
    prompt: reducePromptText,
    issueID: reduceIssueID,
    meeting: meetingMeta,
    llm: "gemini",
    llmModel: "gemini-2.5-pro",
    retryAttempts: 0,
    meta: {
      runId,
      seededBy: "enqueue-mock-prompts",
      purpose: "pre-deployment recap rehearsal",
      prompt_version: PROMPT_VERSION,
      prompt_s3_uri: reducePromptUri,
    },
  };

  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(reduceMessage),
    }),
  );

  console.log("✅ Seeded mock map & reduce (prompt+input) messages:", {
    queueUrl,
    bucketName,
    runId,
    mapMessages: mapFixtures.length,
    reduceMessages: 1,
    chunkResultUrls,
    mapPromptUris,
    reducePromptUri,
  });

  sqsClient.destroy();
  s3Client.destroy();
}

main().catch((err) => {
  console.error("❌ Failed to enqueue mock prompts:", err);
  process.exitCode = 1;
});
