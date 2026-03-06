import {
    SecretsManagerClient,
    CreateSecretCommand,
    GetSecretValueCommand,
    DeleteSecretCommand,
  } from "@aws-sdk/client-secrets-manager";
  import { AWSRegion } from "../../health/secrets";
  
  const sm = new SecretsManagerClient({ region: AWSRegion() });
  
  /**
   * Store DB credentials in Secrets Manager
   * Path: conn/<orgId>/<connectionId>
   */
  export async function storeSecret(
    orgId: string,
    connectionId: string,
    credentials: { username: string; password: string }
  ): Promise<string> {
    const secretName = `conn/${orgId}/${connectionId}`;
  
    const result = await sm.send(
      new CreateSecretCommand({
        Name: secretName,
        SecretString: JSON.stringify(credentials),
      })
    );
  
    return result.ARN!;
  }
  
  /**
   * Fetch DB credentials from Secrets Manager
   */
  export async function getSecret(
    secretArn: string
  ): Promise<{ username: string; password: string }> {
    const result = await sm.send(
      new GetSecretValueCommand({
        SecretId: secretArn,
      })
    );
  
    return JSON.parse(result.SecretString!);
  }
  
  /**
   * Delete secret (for connection deletion)
   */
  export async function deleteSecret(secretArn: string): Promise<void> {
    await sm.send(
      new DeleteSecretCommand({
        SecretId: secretArn,
        ForceDeleteWithoutRecovery: true,
      })
    );
  }