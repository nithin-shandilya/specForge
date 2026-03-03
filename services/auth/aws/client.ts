import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { createHmac } from "crypto";
import {
  AWSRegion,
  CognitoClientId,
  CognitoClientSecret,
} from "../../../health/secrets";

// Initialize the Cognito Client
export const cognitoClient = new CognitoIdentityProviderClient({
  region: AWSRegion(),
});

export const getClientId = () => CognitoClientId();

/**
 * Calculates the SecretHash required by Cognito when
 * an App Client has a Client Secret configured.
 */
export function calculateSecretHash(username: string): string | undefined {
  const secretValue = CognitoClientSecret();
  if (!secretValue) return undefined;

  return createHmac("sha256", secretValue)
    .update(username + CognitoClientId())
    .digest("base64");
}