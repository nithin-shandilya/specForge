import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import {
  createConnection,
  listConnections,
  getConnection,
  deleteConnection,
  updateConnectionStatus,
  discoverSchema,
  getDiscoveryResult,
  saveSelection,
  listSelections,
} from "./db";
import { createJob, updateJobStatus, listJobs, getJob } from "./jobs";
import { authorizeOrg } from "../org/auth_utils";
import { getSecret } from "../../pkg/aws/secrets";

/**
 * TYPES
 */
interface CreateConnectionRequest {
  orgId: string;
  name: string;
  provider: string;
  endpoint: {
    host: string;
    port: number;
    database?: string | null;
    ssl?: boolean | null;
    username: string;
    password: string;
  };
}

interface OrgParams {
  orgId: string;
}

interface ConnectionParams {
  orgId: string;
  connectionId: string;
}

/**
 * Remove secretArn and password before sending to frontend
 */
function sanitize(connection: any) {
  const { secretArn, ...rest } = connection;
  const { password, username, ...safeEndpoint } = rest.endpoint ?? {};
  return { ...rest, endpoint: safeEndpoint };
}

/**
 * CREATE CONNECTION
 */
export const create = api(
  {
    method: "POST",
    path: "/v1/orgs/:orgId/connections",
    expose: true,
    auth: true,
  },
  async ({ orgId, name, provider, endpoint }: CreateConnectionRequest) => {
    const auth = getAuthData()!;
    await authorizeOrg(orgId, auth.userID, "org_member");

    const conn = await createConnection(orgId, name, provider, endpoint);
    return {
      connectionId: conn.connectionId,
      status: conn.status,
    };
  }
);

/**
 * LIST CONNECTIONS
 */
export const list = api(
  {
    method: "GET",
    path: "/v1/orgs/:orgId/connections",
    expose: true,
    auth: true,
  },
  async ({ orgId }: OrgParams) => {
    const auth = getAuthData()!;
    await authorizeOrg(orgId, auth.userID, "org_viewer");

    const conns = await listConnections(orgId);
    return conns.map(sanitize);
  }
);

/**
 * GET CONNECTION
 */
export const get = api(
  {
    method: "GET",
    path: "/v1/orgs/:orgId/connections/:connectionId",
    expose: true,
    auth: true,
  },
  async ({ orgId, connectionId }: ConnectionParams) => {
    const auth = getAuthData()!;
    await authorizeOrg(orgId, auth.userID, "org_viewer");

    const conn = await getConnection(orgId, connectionId);
    if (!conn) throw APIError.notFound("Connection not found");
    return sanitize(conn);
  }
);

/**
 * DELETE CONNECTION
 */
export const remove = api(
  {
    method: "DELETE",
    path: "/v1/orgs/:orgId/connections/:connectionId",
    expose: true,
    auth: true,
  },
  async ({ orgId, connectionId }: ConnectionParams) => {
    const auth = getAuthData()!;
    await authorizeOrg(orgId, auth.userID, "org_admin");

    await deleteConnection(orgId, connectionId);
    return { success: true };
  }
);

/**
 * VALIDATE CONNECTION
 */
export const validate = api(
  {
    method: "POST",
    path: "/v1/orgs/:orgId/connections/:connectionId/validate",
    expose: true,
    auth: true,
  },
  async ({ orgId, connectionId }: ConnectionParams) => {
    const auth = getAuthData()!;
    await authorizeOrg(orgId, auth.userID, "org_member");

    const job = await createJob(orgId, connectionId, "VALIDATE", auth.userID);
    await updateConnectionStatus(orgId, connectionId, "VALIDATION_QUEUED", null);

    try {
      await updateJobStatus(orgId, job.jobId, "RUNNING");

      const conn = await getConnection(orgId, connectionId);
      if (!conn) throw new Error("Connection not found");

      const { host, port, database } = conn.endpoint;

      // Fetch credentials from Secrets Manager
      const creds = await getSecret(conn.secretArn);
      const { username, password } = creds;

      const { Client } = await import("pg");
      const client = new Client({
        host,
        port,
        database: database || "postgres",
        user: username,
        password: password,
      });

      await client.connect();
      await client.end();

      await updateConnectionStatus(orgId, connectionId, "VALIDATED", null);
      await updateJobStatus(orgId, job.jobId, "SUCCEEDED");

      return { jobId: job.jobId, status: "VALIDATED" };
    } catch (err: any) {
      await updateConnectionStatus(orgId, connectionId, "FAILED", err.message);
      await updateJobStatus(orgId, job.jobId, "FAILED", err.message);

      return { jobId: job.jobId, status: "FAILED", error: err.message };
    }
  }
);

/**
 * SCHEMA DISCOVERY
 */
export const discover = api(
  {
    method: "POST",
    path: "/v1/orgs/:orgId/connections/:connectionId/discover",
    expose: true,
    auth: true,
  },
  async (params: { orgId: string; connectionId: string }) => {
    const auth = getAuthData()!;
    await authorizeOrg(params.orgId, auth.userID, "org_member");

    const { orgId, connectionId } = params;

    const job = await createJob(orgId, connectionId, "DISCOVER", auth.userID);
    await updateConnectionStatus(orgId, connectionId, "DISCOVERY_RUNNING", null);

    try {
      await updateJobStatus(orgId, job.jobId, "RUNNING");

      const result = await discoverSchema(orgId, connectionId);

      await updateJobStatus(orgId, job.jobId, "SUCCEEDED");

      return { jobId: job.jobId, ...result };
    } catch (err: any) {
      await updateConnectionStatus(orgId, connectionId, "FAILED", err.message);
      await updateJobStatus(orgId, job.jobId, "FAILED", err.message);

      throw APIError.internal(err.message);
    }
  }
);

/**
 * GET SCHEMAS (retrieve stored discovery result)
 */
export const schemas = api(
  {
    method: "GET",
    path: "/v1/orgs/:orgId/connections/:connectionId/schemas",
    expose: true,
    auth: true,
  },
  async ({ orgId, connectionId }: ConnectionParams) => {
    const auth = getAuthData()!;
    await authorizeOrg(orgId, auth.userID, "org_viewer");

    const result = await getDiscoveryResult(orgId, connectionId);
    if (!result) throw APIError.notFound("No discovery result found. Run discover first.");
    return result;
  }
);

/**
 * SAVE SELECTION
 */
export const createSelection = api(
  {
    method: "POST",
    path: "/v1/orgs/:orgId/connections/:connectionId/selections",
    expose: true,
    auth: true,
  },
  async (params: {
    orgId: string;
    connectionId: string;
    selected: { schemaName: string; tables: string[] }[];
  }) => {
    const auth = getAuthData()!;
    await authorizeOrg(params.orgId, auth.userID, "org_member");

    const result = await saveSelection(
      params.orgId,
      params.connectionId,
      params.selected,
      auth.userID
    );
    return result;
  }
);

/**
 * LIST SELECTIONS
 */
export const getSelections = api(
  {
    method: "GET",
    path: "/v1/orgs/:orgId/connections/:connectionId/selections",
    expose: true,
    auth: true,
  },
  async (params: { orgId: string; connectionId: string }) => {
    const auth = getAuthData()!;
    await authorizeOrg(params.orgId, auth.userID, "org_viewer");

    const selections = await listSelections(params.orgId, params.connectionId);
    return selections;
  }
);

/**
 * LIST JOBS
 */
export const getJobs = api(
  {
    method: "GET",
    path: "/v1/orgs/:orgId/jobs",
    expose: true,
    auth: true,
  },
  async ({ orgId }: { orgId: string }) => {
    const auth = getAuthData()!;
    await authorizeOrg(orgId, auth.userID, "org_viewer");

    const jobs = await listJobs(orgId);
    return jobs;
  }
);

/**
 * GET JOB
 */
export const getJobById = api(
  {
    method: "GET",
    path: "/v1/orgs/:orgId/jobs/:jobId",
    expose: true,
    auth: true,
  },
  async ({ orgId, jobId }: { orgId: string; jobId: string }) => {
    const auth = getAuthData()!;
    await authorizeOrg(orgId, auth.userID, "org_viewer");

    const job = await getJob(orgId, jobId);
    if (!job) throw APIError.notFound("Job not found");
    return job;
  }
);