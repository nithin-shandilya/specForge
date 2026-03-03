import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { randomUUID } from "crypto";
import { createOrgInDB, Membership, Role } from "./db";
import { ddb } from "../../pkg/aws/clients";
import { DynamoTableName } from "../../health/secrets";
import { PutCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { authorizeOrg } from "./auth_utils";
import { getUserByEmail } from "../auth/cognito-db";

/**
 * =========================
 * GET /v1/me
 * =========================
 */
export const getMe = api(
  {
    method: "GET",
    path: "/v1/me",
    expose: true,
    auth: true,
  },
  async () => {
    const auth = getAuthData()!;

    const res = await ddb.send(
      new QueryCommand({
        TableName: DynamoTableName(),
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :u",
        ExpressionAttributeValues: {
          ":u": `USER#${auth.userID}`,
        },
      })
    );

    return {
      identity: { userID: auth.userID, email: auth.email },
      memberships: (res.Items ?? []) as Membership[],
    };
  }
);

/**
 * =========================
 * POST /v1/orgs
 * =========================
 */
export const createOrg = api(
  {
    method: "POST",
    path: "/v1/orgs",
    expose: true,
    auth: true,
  },
  async ({ name }: { name: string }) => {
    const auth = getAuthData()!;
    const orgId = randomUUID();

    await createOrgInDB(orgId, name, auth.userID, auth.email);

    return { orgId, name };
  }
);

/**
 * =========================
 * GET /v1/orgs
 * =========================
 */
export const listOrgs = api(
  {
    method: "GET",
    path: "/v1/orgs",
    expose: true,
    auth: true,
  },
  async () => {
    const auth = getAuthData()!;

    const res = await ddb.send(
      new QueryCommand({
        TableName: DynamoTableName(),
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :u",
        ExpressionAttributeValues: {
          ":u": `USER#${auth.userID}`,
        },
      })
    );

    const memberships = (res.Items ?? []) as Membership[];

    const orgs = await Promise.all(
      memberships.map(async (m) => {
        const orgRes = await ddb.send(
          new GetCommand({
            TableName: DynamoTableName(),
            Key: {
              PK: `ORG#${m.orgId}`,
              SK: "METADATA",
            },
          })
        );
        return {
          orgId: m.orgId,
          name: orgRes.Item?.name,
          role: m.role,
        };
      })
    );

    return orgs;
  }
);

/**
 * =========================
 * GET /v1/orgs/:orgId
 * =========================
 */
export const getOrg = api(
  {
    method: "GET",
    path: "/v1/orgs/:orgId",
    expose: true,
    auth: true,
  },
  async ({ orgId }: { orgId: string }) => {
    const auth = getAuthData()!;

    await authorizeOrg(orgId, auth.userID, "org_viewer");

    const res = await ddb.send(
      new GetCommand({
        TableName: DynamoTableName(),
        Key: {
          PK: `ORG#${orgId}`,
          SK: "METADATA",
        },
      })
    );

    if (!res.Item) throw APIError.notFound("Org not found");

    return res.Item;
  }
);

/**
 * =========================
 * GET /v1/orgs/:orgId/members
 * =========================
 */
export const listMembers = api(
  {
    method: "GET",
    path: "/v1/orgs/:orgId/members",
    expose: true,
    auth: true,
  },
  async ({ orgId }: { orgId: string }) => {
    const auth = getAuthData()!;

    await authorizeOrg(orgId, auth.userID, "org_admin");

    const res = await ddb.send(
      new QueryCommand({
        TableName: DynamoTableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `ORG#${orgId}`,
          ":sk": "USER#",
        },
      })
    );

    return (res.Items ?? []).map((item: any) => ({
      userId: item.userId,
      email: item.email,
      role: item.role,
    }));
  }
);

/**
 * =========================
 * POST /v1/orgs/:orgId/members
 * =========================
 */
export const addMember = api(
  {
    method: "POST",
    path: "/v1/orgs/:orgId/members",
    expose: true,
    auth: true,
  },
  async ({
    orgId,
    email,
    role,
  }: {
    orgId: string;
    email: string;
    role: Role;
  }) => {
    const auth = getAuthData()!;

    await authorizeOrg(orgId, auth.userID, "org_admin");

    const targetUser = await getUserByEmail(email);
    if (!targetUser) throw APIError.notFound("User not found in Cognito");

    const targetUserId = targetUser.id;

    await ddb.send(
      new PutCommand({
        TableName: DynamoTableName(),
        Item: {
          PK: `ORG#${orgId}`,
          SK: `USER#${targetUserId}`,
          GSI1PK: `USER#${targetUserId}`,
          orgId,
          userId: targetUserId,
          email,
          role,
        },
      })
    );

    return { success: true };
  }
);