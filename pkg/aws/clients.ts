import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { AWSRegion } from "../../health/secrets";

const region = AWSRegion();

const ddbClient = new DynamoDBClient({ region });
export const ddb = DynamoDBDocumentClient.from(ddbClient);

export const cognito = new CognitoIdentityProviderClient({ region });