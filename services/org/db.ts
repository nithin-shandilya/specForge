import {
    TransactWriteCommand,
    GetCommand,
  } from "@aws-sdk/lib-dynamodb";
  import { ddb } from "../../pkg/aws/clients";
  import { DynamoTableName } from "../../health/secrets";
  
  export type Role =
    | "org_owner"
    | "org_admin"
    | "org_member"
    | "org_viewer";
  
  export interface Membership {
    orgId: string;
    userId: string;
    email: string;
    role: Role;
  }
  
  export async function getMembership(
    orgId: string,
    userId: string
  ): Promise<Membership | null> {
    const res = await ddb.send(
      new GetCommand({
        TableName: DynamoTableName(),
        Key: {
          PK: `ORG#${orgId}`,
          SK: `USER#${userId}`,
        },
      })
    );
  
    return (res.Item as Membership) ?? null;
  }
  
  export async function createOrgInDB(
    orgId: string,
    name: string,
    ownerId: string,
    email: string
  ) {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: DynamoTableName(),
              Item: {
                PK: `ORG#${orgId}`,
                SK: "METADATA",
                name,
                createdAt: new Date().toISOString()
              },
            },
          },
          {
            Put: {
              TableName: DynamoTableName(),
              Item: {
                PK: `ORG#${orgId}`,
                SK: `USER#${ownerId}`,
                GSI1PK: `USER#${ownerId}`,
                orgId,
                userId: ownerId,
                email,
                role: "org_owner",
              },
            },
          },
        ],
      })
    );
  }