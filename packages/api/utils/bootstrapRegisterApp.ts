import { DynamoDBClient as AwsDynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import path from "path";
import dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.DYNAMODB_TABLE_ACTIONS_PROFILES || "actions.profiles";

const dynamoClient = new AwsDynamoDBClient({ region: REGION });

const actions = [
    "GET/table/students",
    "GET/table/events",
    "POST/table/prompts",
    "POST/table/students"
];

async function run() {
    console.log(`Updating ${TABLE_NAME} for host "register"...`);
    try {
        await dynamoClient.send(new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: { profile: { S: "register" } },
            UpdateExpression: "SET actions = :a",
            ExpressionAttributeValues: {
                ":a": { L: actions.map(a => ({ S: a })) }
            }
        }));
        console.log("Successfully updated actions list.");
    } catch (error) {
        console.error("Error updating table:", error);
        process.exit(1);
    }
}

run();
