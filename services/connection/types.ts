export type ConnectionStatus =
  | "CREATED"
  | "VALIDATION_QUEUED"
  | "VALIDATED"
  | "DISCOVERY_RUNNING"
  | "READY"
  | "FAILED";

export interface ConnectionEndpoint {
  host: string;
  port: number;
  database?: string | null;
  ssl?: boolean | null;
  username: string;       // ✅ added
  password: string;       // ✅ added
}

export interface Connection {
  PK: string;
  SK: string;
  entityType: "CONNECTION";
  version: number;

  orgId: string;
  connectionId: string;
  name: string;
  provider: string;
  endpoint: ConnectionEndpoint;
  status: ConnectionStatus;
  secretArn: string;

  createdAt: string;
  updatedAt: string;
  lastError: string | null;
}