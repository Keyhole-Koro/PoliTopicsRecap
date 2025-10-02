import { LambdaClient, UpdateEventSourceMappingCommand } from "@aws-sdk/client-lambda";
import { SchedulerClient, CreateScheduleCommand } from "@aws-sdk/client-scheduler";

export interface ResumeScheduleInput {
  /** Unique schedule name for EventBridge Scheduler */
  name: string;
  /** Event Source Mapping UUID to toggle */
  uuid: string;
  /** ISO timestamp for resume (e.g. "2025-09-29T10:30:00") */
  resumeIsoTime: string;
  /** Time zone for schedule expression (e.g. "Asia/Tokyo"). Defaults to "UTC". */
  timezone?: string;
  /** IAM Role ARN used by Scheduler to invoke the AWS SDK action */
  roleArn: string;
  /**
   * Target ARN for Scheduler to call.
   * Usually: "arn:aws:scheduler:::aws-sdk:lambda:updateEventSourceMapping"
   */
  targetArn: string;
  /** AWS region (both Lambda & Scheduler). Defaults to "ap-northeast-1". */
  region?: string;
}

export interface DisableNowInput {
  /** Event Source Mapping UUID to disable */
  uuid: string;
  /** AWS region. Defaults to "ap-northeast-1". */
  region?: string;
}

/**
 * Disable the Lambda Event Source Mapping immediately (no Scheduler).
 */
export async function disableEventSourceMappingNow(input: DisableNowInput) {
  const region = input.region ?? "ap-northeast-1";
  const lambda = new LambdaClient({ region });

  // Call Lambda API to disable the mapping right now
  const cmd = new UpdateEventSourceMappingCommand({
    UUID: input.uuid,
    Enabled: false,
  });

  try {
    const res = await lambda.send(cmd);
    console.log(`Disabled ESM ${input.uuid}`, { state: res.State, lastModified: res.LastModified });
    return res;
  } catch (err) {
    console.error("Failed to disable Event Source Mapping:", err);
    throw err;
  }
}

/**
 * Create a one-time EventBridge Scheduler schedule that will ENABLE the mapping at a given time.
 */
export async function scheduleResume(input: ResumeScheduleInput) {
  const {
    name,
    uuid,
    resumeIsoTime,
    timezone = "UTC",
    roleArn,
    targetArn,
    region = "ap-northeast-1",
  } = input;

  const scheduler = new SchedulerClient({ region });

  // Build a one-time "at()" schedule to enable the mapping later
  const cmd = new CreateScheduleCommand({
    Name: name,
    ScheduleExpression: `at(${resumeIsoTime})`,
    ScheduleExpressionTimezone: timezone,
    FlexibleTimeWindow: { Mode: "OFF" },
    Target: {
      // Target ARN is passed-in so you can swap APIs if needed
      Arn: targetArn,
      RoleArn: roleArn,
      // Payload for the selected AWS SDK action
      Input: JSON.stringify({
        UUID: uuid,
        Enabled: true, // enable at the scheduled time
      }),
    },
  });

  try {
    const res = await scheduler.send(cmd);
    console.log(`Created resume schedule "${name}" at ${resumeIsoTime} (${timezone})`);
    return res;
  } catch (err) {
    console.error("Failed to create resume schedule:", err);
    throw err;
  }
}

/** Example usage */
async function example() {
  const uuid = "<EVENT_SOURCE_MAPPING_UUID>";
  const roleArn = "arn:aws:iam::<ACCOUNT_ID>:role/<SchedulerRole>";
  const targetArn = "arn:aws:scheduler:::aws-sdk:lambda:updateEventSourceMapping";

  // 1) Disable now
  await disableEventSourceMappingNow({ uuid, region: "ap-northeast-1" });

  // 2) Resume at a specific time (JST)
  await scheduleResume({
    name: "resume-sqs-lambda-20250929-1030",
    uuid,
    resumeIsoTime: "2025-09-29T10:30:00",
    timezone: "Asia/Tokyo",
    roleArn,
    targetArn,
    region: "ap-northeast-1",
  });
}

// example(); // Uncomment to run
