import { secret } from "encore.dev/config";

export const AWSRegion = secret("AWSRegion");
export const CognitoUserPoolId = secret("CognitoUserPoolId");
export const CognitoClientId = secret("CognitoClientId");
export const CognitoClientSecret = secret("CognitoClientSecret");
export const DynamoTableName = secret("DynamoTableName");