import { api } from "encore.dev/api";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { AWSRegion } from "./secrets";

export const testAWS = api(
  { expose: true, method: "GET", path: "/test-aws", auth: false },
  async () => {
    const client = new DynamoDBClient({ region: AWSRegion() });

    const data = await client.send(new ListTablesCommand({}));

    return {
      status: "Success",
      region: AWSRegion(),
      tables: data.TableNames,
    };
  }
);