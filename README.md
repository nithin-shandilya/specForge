# SpecForge Backend

Multi-tenant backend for database connection management with Cognito auth, org-scoped RBAC, schema discovery, and job tracking.

---

## Setup Instructions

### 1. Clone and install

```bash
git clone https://github.com/nithin-shandilya/specForge.git
cd specForge
pnpm install
```

### 2. Install Encore CLI

Follow https://encore.dev/docs/install for your OS.

### 3. AWS — Create DynamoDB Table

Go to AWS Console → DynamoDB → Create table:

- **Table name:** `app-table`
- **Partition key:** `PK` (String)
- **Sort key:** `SK` (String)
- **Capacity:** On-demand

Then go to the **Indexes** tab and create a GSI:

- **Index name:** `GSI1`
- **Partition key:** `GSI1PK` (String)
- **Projected attributes:** All

### 4. AWS — Create Cognito User Pool

Go to AWS Console → Cognito → Create user pool:

- **Sign-in:** Email
- **Password policy:** Your choice (minimum 8 chars recommended)
- **Verification:** Email

Create an **App Client**:

- **Type:** Confidential client (generates a client secret)
- **Auth flows:** Enable `ALLOW_USER_PASSWORD_AUTH`

Create two **Groups**:

- `platform_admin`
- `user`

### 5. Set Encore Secrets

Run each command and paste the value when prompted:

```bash
encore secret set AWSRegion
# paste: us-east-1 (or your region)

encore secret set CognitoUserPoolId
# paste: us-east-1_xxxxxxxx (from Cognito console)

encore secret set CognitoClientId
# paste: your app client ID

encore secret set CognitoClientSecret
# paste: your app client secret

encore secret set DynamoTableName
# paste: app-table
```

### 6. Configure AWS Credentials

Make sure your machine has AWS credentials configured (via `aws configure` or environment variables) with permissions for DynamoDB and Cognito.

### 7. Run

```bash
encore run
```

The dashboard opens at http://localhost:9400

---

## File Map — What's Where

### `health/`

| File | Contains |
|------|----------|
| `api.ts` | `GET /test-aws` — health check, tests AWS connectivity |
| `secrets.ts` | All 5 secret declarations (AWSRegion, CognitoUserPoolId, etc.) |

### `services/auth/`

| File | Contains |
|------|----------|
| `api.ts` | `POST /v1/auth/register` — signup with email + password |
| | `POST /v1/auth/confirm` — verify email with code |
| | `POST /v1/auth/login` — returns idToken, accessToken, refreshToken |
| | `GET /v1/auth/me` — current user profile (requires token) |
| | `POST /v1/auth/change-password` — change password (requires token) |
| `auth.ts` | JWT verification using aws-jwt-verify + Encore Gateway |
| `aws/client.ts` | Cognito SDK client + SecretHash calculation |
| `cognito-db.ts` | User lookups — getUserByEmail, getUserById, updateUser |

### `services/org/`

| File | Contains |
|------|----------|
| `api.ts` | `POST /v1/orgs` — create org (caller becomes owner) |
| | `GET /v1/orgs` — list orgs for current user |
| | `GET /v1/orgs/:orgId` — get org details (viewer+) |
| | `GET /v1/orgs/:orgId/members` — list members (admin+) |
| | `POST /v1/orgs/:orgId/members` — add member by email (admin+) |
| | `GET /v1/me` — identity + org memberships |
| `db.ts` | DynamoDB operations — createOrgInDB, getMembership |
| `auth_utils.ts` | RBAC engine — `authorizeOrg(orgId, userId, minRole)` |

### `services/connection/`

| File | Contains |
|------|----------|
| `api.ts` | `POST /v1/orgs/:orgId/connections` — create connection (member+) |
| | `GET /v1/orgs/:orgId/connections` — list connections (viewer+) |
| | `GET /v1/orgs/:orgId/connections/:id` — get connection (viewer+) |
| | `DELETE /v1/orgs/:orgId/connections/:id` — soft delete (admin+) |
| | `POST .../connections/:id/validate` — test DB connectivity (member+) |
| | `POST .../connections/:id/discover` — discover schemas (member+) |
| | `GET .../connections/:id/schemas` — get stored discovery result (viewer+) |
| | `POST .../connections/:id/selections` — save table selection (member+) |
| | `GET .../connections/:id/selections` — list selections (viewer+) |
| | `GET /v1/orgs/:orgId/jobs` — list jobs (viewer+) |
| | `GET /v1/orgs/:orgId/jobs/:jobId` — get job status (viewer+) |
| `db.ts` | DynamoDB operations — connections, discovery, selections |
| `jobs.ts` | Job tracking — createJob, updateJobStatus, listJobs, getJob |
| `types.ts` | TypeScript interfaces — Connection, ConnectionEndpoint, ConnectionStatus |

### `pkg/aws/`

| File | Contains |
|------|----------|
| `clients.ts` | Shared DynamoDB DocumentClient instance (used by all services) |

---

## RBAC Roles

| Role | Can Do |
|------|--------|
| org_viewer | Read org, connections, schemas, selections, jobs |
| org_member | Viewer + create connections, validate, discover, save selections |
| org_admin | Member + manage members, delete connections |
| org_owner | Same as admin (auto-assigned to org creator) |

---

## Testing Flow

1. **Register** → `POST /v1/auth/register` with email, password, name
2. **Confirm** → `POST /v1/auth/confirm` with email and verification code from email
3. **Login** → `POST /v1/auth/login` — copy the `idToken` from response
4. **Use token** → Add header `Authorization: Bearer <idToken>` to all subsequent calls
5. **Create org** → `POST /v1/orgs` with `{ "name": "My Company" }`
6. **Create connection** → `POST /v1/orgs/:orgId/connections` with DB credentials
7. **Validate** → `POST .../connections/:id/validate`
8. **Discover** → `POST .../connections/:id/discover`
9. **Get schemas** → `GET .../connections/:id/schemas`
10. **Save selection** → `POST .../connections/:id/selections`
11. **Check jobs** → `GET /v1/orgs/:orgId/jobs`

---

## DynamoDB Data Model

Single table `app-table` with PK/SK pattern:

| Entity | PK | SK |
|--------|----|----|
| Org | `ORG#<orgId>` | `METADATA` |
| Membership | `ORG#<orgId>` | `USER#<userId>` |
| Connection | `ORG#<orgId>` | `CONN#<connectionId>` |
| Discovery | `ORG#<orgId>` | `DISC#<connectionId>` |
| Selection | `ORG#<orgId>` | `SEL#<connectionId>#<selectionId>` |
| Job | `ORG#<orgId>` | `JOB#<jobId>` |

GSI1 (`GSI1PK`) enables reverse lookup: given a userId, find all orgs they belong to.
