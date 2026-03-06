import {
  PutCommand,
  QueryCommand,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import { randomUUID } from "crypto";
import type { Connection, ConnectionEndpoint } from "./types";
import { Client } from "pg";

import { ddb } from "../../pkg/aws/clients";
import { DynamoTableName } from "../../health/secrets";
import { storeSecret, getSecret } from "../../pkg/aws/secrets";

/**
 * CREATE CONNECTION
 */
export async function createConnection(
  orgId: string,
  name: string,
  provider: string,
  endpoint: ConnectionEndpoint
): Promise<Connection> {
  const now = new Date().toISOString();
  const connectionId = randomUUID();

  // Store credentials in Secrets Manager
  const arn = await storeSecret(orgId, connectionId, {
    username: endpoint.username,
    password: endpoint.password,
  });

  const item: Connection = {
    PK: `ORG#${orgId}`,
    SK: `CONN#${connectionId}`,
    entityType: "CONNECTION",
    version: 1,

    orgId,
    connectionId,
    name,
    provider,
    endpoint: {
      host: endpoint.host,
      port: endpoint.port,
      database: endpoint.database || null,
      ssl: endpoint.ssl || null,
    },
    status: "CREATED",
    secretArn: arn,

    createdAt: now,
    updatedAt: now,
    lastError: null,
  };

  await ddb.send(
    new PutCommand({
      TableName: DynamoTableName(),
      Item: item,
    })
  );

  return item;
}

/**
 * LIST CONNECTIONS
 */
export async function listConnections(orgId: string): Promise<Connection[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: DynamoTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `ORG#${orgId}`,
        ":sk": "CONN#",
      },
    })
  );

  return (result.Items ?? []) as Connection[];
}

/**
 * GET CONNECTION
 */
export async function getConnection(
  orgId: string,
  connectionId: string
): Promise<Connection | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: DynamoTableName(),
      Key: {
        PK: `ORG#${orgId}`,
        SK: `CONN#${connectionId}`,
      },
    })
  );

  return (result.Item as Connection) ?? null;
}

/**
 * DELETE (SOFT DELETE)
 */
export async function deleteConnection(
  orgId: string,
  connectionId: string
): Promise<void> {
  const now = new Date().toISOString();

  await ddb.send(
    new UpdateCommand({
      TableName: DynamoTableName(),
      Key: {
        PK: `ORG#${orgId}`,
        SK: `CONN#${connectionId}`,
      },
      UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": "DELETED",
        ":updatedAt": now,
      },
    })
  );
}

/**
 * UPDATE CONNECTION STATUS
 */
export async function updateConnectionStatus(
  orgId: string,
  connectionId: string,
  status: Connection["status"],
  lastError: string | null = null
): Promise<void> {
  const now = new Date().toISOString();

  await ddb.send(
    new UpdateCommand({
      TableName: DynamoTableName(),
      Key: {
        PK: `ORG#${orgId}`,
        SK: `CONN#${connectionId}`,
      },
      UpdateExpression:
        "SET #status = :status, updatedAt = :updatedAt, lastError = :lastError",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": status,
        ":updatedAt": now,
        ":lastError": lastError,
      },
    })
  );
}

/**
 * DISCOVER SCHEMA
 */
export async function discoverSchema(orgId: string, connectionId: string) {
  // 1. Fetch connection from DynamoDB
  const conn = await getConnection(orgId, connectionId);
  if (!conn) throw new Error("Connection not found");

  const { host, port, database } = conn.endpoint;

  // 2. Fetch credentials from Secrets Manager
  const creds = await getSecret(conn.secretArn);
  const { username, password } = creds;

  // 3. Create Postgres client
  const client = new Client({
    host,
    port,
    user: username,
    password: password,
    database: database || "postgres",
  });

  // 4. Connect
  await client.connect();

  // 5. Fetch tables
  const res = await client.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name
  `);

  // 6. Close
  await client.end();

  // 7. Group by schema
  const grouped: Record<string, { tableName: string }[]> = {};
  for (const row of res.rows) {
    if (!grouped[row.table_schema]) {
      grouped[row.table_schema] = [];
    }
    grouped[row.table_schema].push({ tableName: row.table_name });
  }

  // 8. Format result
  const discoveredAt = new Date().toISOString();
  const schemas = Object.keys(grouped).map((schema) => ({
    schemaName: schema,
    tables: grouped[schema],
  }));

  // 9. Store discovery result in DynamoDB
  await ddb.send(
    new PutCommand({
      TableName: DynamoTableName(),
      Item: {
        PK: `ORG#${orgId}`,
        SK: `DISC#${connectionId}`,
        entityType: "DISCOVERY_RESULT",
        connectionId,
        discoveredAt,
        schemas,
        createdAt: discoveredAt,
        updatedAt: discoveredAt,
      },
    })
  );

  // 10. Update connection status to READY
  await updateConnectionStatus(orgId, connectionId, "READY", null);

  return {
    status: "READY",
    discoveredAt,
    schemas,
  };
}

/**
 * GET DISCOVERY RESULT
 */
export async function getDiscoveryResult(orgId: string, connectionId: string) {
  const result = await ddb.send(
    new GetCommand({
      TableName: DynamoTableName(),
      Key: {
        PK: `ORG#${orgId}`,
        SK: `DISC#${connectionId}`,
      },
    })
  );

  if (!result.Item) return null;

  return {
    status: "READY",
    discoveredAt: result.Item.discoveredAt,
    schemas: result.Item.schemas,
  };
}

/**
 * SAVE SELECTION
 */
export async function saveSelection(
  orgId: string,
  connectionId: string,
  selected: { schemaName: string; tables: string[] }[],
  userId: string
) {
  const now = new Date().toISOString();
  const selectionId = randomUUID();

  await ddb.send(
    new PutCommand({
      TableName: DynamoTableName(),
      Item: {
        PK: `ORG#${orgId}`,
        SK: `SEL#${connectionId}#${selectionId}`,
        entityType: "SELECTION",
        connectionId,
        selectionId,
        selected,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      },
    })
  );

  return { selectionId, createdAt: now };
}

/**
 * LIST SELECTIONS
 */
export async function listSelections(orgId: string, connectionId: string) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: DynamoTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `ORG#${orgId}`,
        ":sk": `SEL#${connectionId}#`,
      },
    })
  );

  return result.Items ?? [];
}