// packages/backend/src/dynamoClient.ts
import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  DeleteCommand,
  PutCommand,
  UpdateCommand,
  BatchGetCommand
} from '@aws-sdk/lib-dynamodb';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-provider-cognito-identity';

// --- Configuration from Environment Variables ---
// These will be read from the environment of the calling application (e.g., student-dashboard API route)
const REGION = process.env.AWS_REGION; // No default, must be set
const IDENTITY_POOL_ID = process.env.AWS_COGNITO_IDENTITY_POOL_ID; // No default, must be set

// Cache docClientInstance per identityPoolId
const docClientInstances: Record<string, DynamoDBDocumentClient> = {};
/**
 * Initializes and returns a singleton DynamoDBDocumentClient instance.
 * Checks for required environment variables (AWS_REGION, AWS_COGNITO_IDENTITY_POOL_ID).
 * @function getDocClient
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable
 * @returns {DynamoDBDocumentClient} The initialized document client.
 * @throws {Error} If essential AWS configuration environment variables are not set or client fails to initialize.
 */
function getDocClient(identityPoolIdOverride?: string) {
  const identityPoolId = identityPoolIdOverride || IDENTITY_POOL_ID;
  if (!REGION) {
    console.error("db-client: AWS_REGION environment variable is not set.");
    throw new Error("Server configuration error: Missing AWS Region.");
  }
  if (!identityPoolId) {
    console.error("db-client: AWS_COGNITO_IDENTITY_POOL_ID environment variable is not set.");
    throw new Error("Server configuration error: Missing AWS Cognito Identity Pool ID.");
  }
  // Return cached instance if exists
  if (docClientInstances[identityPoolId]) {
    return docClientInstances[identityPoolId];
  }
  try {
    const credentials = fromCognitoIdentityPool({
      clientConfig: { region: REGION },
      identityPoolId,
    });
    const ddbBaseClient = new DynamoDBClient({ region: REGION, credentials });
    const docClientInstance = DynamoDBDocumentClient.from(ddbBaseClient);
    docClientInstances[identityPoolId] = docClientInstance;
    return docClientInstance;
  } catch (error) {
    console.error("db-client: Failed to initialize DynamoDBDocumentClient:", error);
    throw new Error("Server configuration error: Could not initialize AWS client.");
  }
}


/**
 * Scan entire table and return all items.
 */
export async function listAll(tableName: string, identityPoolIdOverride?: string) {
  const client = getDocClient(identityPoolIdOverride);
  const items: any[] = [];
  let ExclusiveStartKey;
  do {
    const response = await client.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey,
      })
    );
    if (response.Items) items.push(...response.Items);
    ExclusiveStartKey = response.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/**
 * Count all items in a table efficiently without loading them into memory.
 */
export async function countAll(tableName: string, identityPoolIdOverride?: string) {
  const client = getDocClient(identityPoolIdOverride);
  let totalCount = 0;
  let ExclusiveStartKey;
  do {
    const response = await client.send(
      new ScanCommand({
        TableName: tableName,
        Select: 'COUNT',
        ExclusiveStartKey,
      })
    );
    totalCount += response.Count || 0;
    ExclusiveStartKey = response.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return totalCount;
}

/**
 * Scan table in chunks and return items with lastEvaluatedKey for pagination.
 * Modeled after handleChunkedScanTable from packages/backend-core/src/db-actions.js
 */
export async function listAllChunked(
  tableName: string,
  scanParams: Record<string, any> = {},
  lastEvaluatedKey?: Record<string, any>,
  limit?: number,
  identityPoolIdOverride?: string,
  projectionExpression?: string,
  expressionAttributeNames?: Record<string, string>
) {
  const client = getDocClient(identityPoolIdOverride);
  const baseParams = {
    TableName: tableName,
    ...scanParams,
    ...(limit && { Limit: limit }),
    ...(projectionExpression && { ProjectionExpression: projectionExpression }),
    ...(expressionAttributeNames && { ExpressionAttributeNames: expressionAttributeNames })
  };

  const response = await client.send(
    new ScanCommand({
      ...baseParams,
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    })
  );

  return {
    items: response.Items || [],
    lastEvaluatedKey: response.LastEvaluatedKey,
    Count: response.Count
  };
}

/**
 * Scan entire table with a filter and return all matching items.
 */
export async function listAllFiltered(
  tableName: string,
  fieldName: string,
  fieldValue: string,
  identityPoolIdOverride?: string
) {
  const client = getDocClient(identityPoolIdOverride);
  const items: any[] = [];
  let ExclusiveStartKey;
  console.log("listAllFiltered: tableName:", tableName);
  console.log("listAllFiltered: fieldName:", fieldName);
  console.log("listAllFiltered: fieldValue:", fieldValue);
  do {
    const response = await client.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: `${fieldName} = :fieldValue`,
        ExpressionAttributeValues: {
          ':fieldValue': fieldValue
        },
        ExclusiveStartKey,
      })
    );
    if (response.Items) items.push(...response.Items);
    ExclusiveStartKey = response.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  console.log("listAllFiltered: items:", items.length);
  return items;
}

/**
 * Get a single item by partition key.
 */
export async function getOne(
  tableName: string,
  pkName: string,
  id: string,
  identityPoolIdOverride?: string
) {
  const client = getDocClient(identityPoolIdOverride);
  const { Item } = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: { [pkName]: id },
    })
  );
  return Item;
}

/**
 * Get a single item by composite key (partition + sort key).
 */
export async function getOneWithSort(
  tableName: string,
  pkName: string,
  pkValue: string,
  skName: string,
  skValue: string,
  identityPoolIdOverride?: string
) {
  const client = getDocClient(identityPoolIdOverride);
  const { Item } = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        [pkName]: pkValue,
        [skName]: skValue,
      },
    })
  );
  return Item;
}

/**
 * Put a single item into the table.
 */
export async function putOne(
  tableName: string,
  item: Record<string, any>,
  identityPoolIdOverride?: string
) {
  const client = getDocClient(identityPoolIdOverride);
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
    })
  );
}

/**
 * Update specific attributes of an item in the table.
 */
export async function updateItem(
  tableName: string,
  key: Record<string, any>,
  updateExpression: string,
  expressionAttributeValues: Record<string, any>,
  expressionAttributeNames?: Record<string, string>,
  identityPoolIdOverride?: string
) {
  const client = getDocClient(identityPoolIdOverride);
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: key,
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: expressionAttributeNames,
    })
  );
}

/**
 * Update specific attributes of an item in the table with condition expression.
 * This version includes a condition to ensure the item exists before updating.
 */
export async function updateItemWithCondition(
  tableName: string,
  key: Record<string, any>,
  updateExpression: string,
  expressionAttributeValues: Record<string, any>,
  expressionAttributeNames?: Record<string, string>,
  identityPoolIdOverride?: string
) {
  const client = getDocClient(identityPoolIdOverride);
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: key,
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: expressionAttributeNames,
      ConditionExpression: "attribute_exists(id)",
    })
  );
}

/**
 * Delete a single item by partition key.
 */
export async function deleteOne(
  tableName: string,
  pkName: string,
  id: string,
  identityPoolIdOverride?: string
) {
  const client = getDocClient(identityPoolIdOverride);
  await client.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { [pkName]: id },
    })
  );
}

/**
 * Delete a single item by composite key (partition + sort key).
 */
export async function deleteOneWithSort(
  tableName: string,
  pkName: string,
  pkValue: string,
  skName: string,
  skValue: string,
  identityPoolIdOverride?: string
) {
  const client = getDocClient(identityPoolIdOverride);
  await client.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        [pkName]: pkValue,
        [skName]: skValue,
      },
    })
  );
}

/**
 * Batch get items by their primary keys.
 * DynamoDB BatchGet has a limit of 100 items per request, so this function handles larger batches by chunking.
 */
export async function batchGetItems(
  tableName: string,
  pkName: string,
  ids: string[],
  identityPoolIdOverride?: string
) {
  const client = getDocClient(identityPoolIdOverride);
  const items: any[] = [];

  // DynamoDB BatchGet has a limit of 100 items per request
  const BATCH_SIZE = 100;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);

    const requestItems: Record<string, any> = {
      [tableName]: {
        Keys: batch.map(id => ({ [pkName]: id }))
      }
    };

    const response = await client.send(new BatchGetCommand({ RequestItems: requestItems }));

    if (response.Responses && response.Responses[tableName]) {
      items.push(...response.Responses[tableName]);
    }

    // Handle unprocessed keys (though this shouldn't happen with our batch size)
    if (response.UnprocessedKeys && Object.keys(response.UnprocessedKeys).length > 0) {
      console.warn('Some items were not processed in batch get:', response.UnprocessedKeys);
    }
  }

  return items;
}