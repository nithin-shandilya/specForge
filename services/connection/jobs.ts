import {
    PutCommand,
    QueryCommand,
    GetCommand,
    UpdateCommand,
  } from "@aws-sdk/lib-dynamodb";
  import { randomUUID } from "crypto";
  import { ddb } from "../../pkg/aws/clients";
  import { DynamoTableName } from "../../health/secrets";
  
  /**
   * CREATE JOB
   */
  export async function createJob(
    orgId: string,
    connectionId: string,
    type: "VALIDATE" | "DISCOVER",
    userId: string
  ) {
    const now = new Date().toISOString();
    const jobId = randomUUID();
  
    await ddb.send(
      new PutCommand({
        TableName: DynamoTableName(),
        Item: {
          PK: `ORG#${orgId}`,
          SK: `JOB#${jobId}`,
          entityType: "JOB",
          jobId,
          connectionId,
          type,
          status: "QUEUED",
          error: null,
          createdBy: userId,
          startedAt: now,
          finishedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      })
    );
  
    return { jobId, status: "QUEUED" };
  }
  
  /**
   * UPDATE JOB STATUS
   */
  export async function updateJobStatus(
    orgId: string,
    jobId: string,
    status: "RUNNING" | "SUCCEEDED" | "FAILED",
    error: string | null = null
  ) {
    const now = new Date().toISOString();
  
    await ddb.send(
      new UpdateCommand({
        TableName: DynamoTableName(),
        Key: {
          PK: `ORG#${orgId}`,
          SK: `JOB#${jobId}`,
        },
        UpdateExpression:
          "SET #status = :status, #error = :error, finishedAt = :finishedAt, updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#status": "status",
          "#error": "error",
        },
        ExpressionAttributeValues: {
          ":status": status,
          ":error": error,
          ":finishedAt": now,
          ":updatedAt": now,
        },
      })
    );
  }
  
  /**
   * LIST JOBS
   */
  export async function listJobs(orgId: string) {
    const result = await ddb.send(
      new QueryCommand({
        TableName: DynamoTableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `ORG#${orgId}`,
          ":sk": "JOB#",
        },
      })
    );
  
    return result.Items ?? [];
  }
  
  /**
   * GET JOB
   */
  export async function getJob(orgId: string, jobId: string) {
    const result = await ddb.send(
      new GetCommand({
        TableName: DynamoTableName(),
        Key: {
          PK: `ORG#${orgId}`,
          SK: `JOB#${jobId}`,
        },
      })
    );
  
    return result.Item ?? null;
  }