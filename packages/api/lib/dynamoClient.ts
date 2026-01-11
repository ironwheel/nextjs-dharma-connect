/**
 * @file packages/api/lib/dynamoClient.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Defines a client for interacting with DynamoDB.
 */

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
  BatchGetCommand,
  QueryCommand
} from '@aws-sdk/lib-dynamodb';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { fromWebToken } from "@aws-sdk/credential-provider-web-identity";

// --- Configuration from Environment Variables ---

function getAwsRegion() {
  return process.env.AWS_REGION;
}



// Cache docClientInstance per roleArn (or 'default')
interface CachedClient {
  client: DynamoDBDocumentClient;
  expiration: number | null; // Timestamp in ms
  token?: string; // The specific OIDC token used to create this client
}
const docClientInstances: Record<string, CachedClient> = {};

/**
 * @async
 * @function getDocClient
 * @description Initializes and returns a singleton DynamoDBDocumentClient instance.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @returns {Promise<DynamoDBDocumentClient>} The initialized document client.
 * @throws {Error} If essential AWS configuration environment variables are not set or client fails to initialize.
 */
async function getDocClient(roleArnOverride?: string, oidcToken?: string): Promise<DynamoDBDocumentClient> {
  const REGION = getAwsRegion();
  if (!REGION) {
    console.error("db-client: AWS_REGION environment variable is not set.");
    throw new Error("Server configuration error: Missing AWS Region.");
  }

  const cacheKey = roleArnOverride || 'default';

  // Return cached instance if exists
  // Return cached instance if exists and valid
  // Return cached instance if exists and valid
  const cached = docClientInstances[cacheKey];
  if (cached) {
    const now = Date.now();
    const EXPIRATION_BUFFER_MS = 5 * 60 * 1000; // 5 minutes buffer

    // Check if the provided OIDC token matches the one used to create the cached client
    const tokenMismatch = oidcToken && cached.token !== oidcToken;

    if (!tokenMismatch) {
      // If expiration is null (e.g. default credentials), assume valid always (or handled by AWS SDK default chain)
      // If expiration is set, check if it is still valid with buffer
      if (cached.expiration === null || cached.expiration > (now + EXPIRATION_BUFFER_MS)) {
        return cached.client;
      }
      console.log(`db-client: Cached client for ${cacheKey} expired or about to expire (TTL: ${new Date(cached.expiration).toISOString()}). Re-creating.`);
    } else {
      console.log(`db-client: OIDC token changed for ${cacheKey}. Re-creating client.`);
    }
  }

  try {
    let baseCredentials;
    // Prefer passed OIDC token. If not present, we will fall back to default credentials (local dev)
    const tokenToUse = oidcToken;

    if (tokenToUse) {
      const defaultRoleArn = process.env.DEFAULT_GUEST_ROLE_ARN;
      if (!defaultRoleArn) {
        throw new Error("Server configuration error: Missing DEFAULT_GUEST_ROLE_ARN.");
      }
      console.log("db-client: OIDC Token detected. Using fromWebToken.");
      baseCredentials = fromWebToken({
        roleArn: defaultRoleArn,
        webIdentityToken: tokenToUse,
        roleSessionName: "VercelSession"
      });
    }

    let ddbBaseClient: DynamoDBClient;
    let expiration: number | null = null;

    if (roleArnOverride) {
      // Assume the specified role (Auth Role) using the Base Credentials (Guest Role)
      const stsClient = new STSClient({
        region: REGION,
        credentials: baseCredentials // Use OIDC credentials if available, otherwise default chain
      });
      const assumeRoleCommand = new AssumeRoleCommand({
        RoleArn: roleArnOverride,
        RoleSessionName: 'DharmaConnectSession',
      });
      const { Credentials } = await stsClient.send(assumeRoleCommand);

      if (!Credentials || !Credentials.AccessKeyId || !Credentials.SecretAccessKey || !Credentials.SessionToken) {
        throw new Error("Failed to obtain temporary credentials from STS.");
      }

      ddbBaseClient = new DynamoDBClient({
        region: REGION,
        credentials: {
          accessKeyId: Credentials.AccessKeyId,
          secretAccessKey: Credentials.SecretAccessKey,
          sessionToken: Credentials.SessionToken,
        },
      });
      if (Credentials.Expiration) {
        expiration = Credentials.Expiration.getTime();
      }
    } else {
      // Use default credential provider chain or explicit OIDC
      ddbBaseClient = new DynamoDBClient({
        region: REGION,
        credentials: baseCredentials
      });
    }

    const docClientInstance = DynamoDBDocumentClient.from(ddbBaseClient);
    docClientInstances[cacheKey] = { client: docClientInstance, expiration, token: oidcToken };
    return docClientInstance;
  } catch (error) {
    console.error("db-client: Failed to initialize DynamoDBDocumentClient:", error);

    // Enhanced error logging for diagnosis
    const tokenToUse = oidcToken;
    if (tokenToUse) {
      console.error("db-client: OIDC Token length:", tokenToUse.length);
    } else {
      console.log("db-client: OIDC Token is missing (or not passed).");
    }
    console.log("db-client: AWS_REGION:", REGION);

    throw new Error("Server configuration error: Could not initialize AWS client.");
  }
}

/**
 * @async
 * @function listAll
 * @description Scan entire table and return all items.
 * @param {string} tableName - The name of the table to scan.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @returns {Promise<any[]>} A promise that resolves to an array of items.
 * @throws {Error} When AWS operation fails or table cannot be scanned.
 */
export async function listAll(tableName: string, roleArnOverride?: string, oidcToken?: string) {
  const client = await getDocClient(roleArnOverride, oidcToken);
  const items: any[] = [];
  let ExclusiveStartKey;
  try {
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
  } catch (error) {
    console.error(`Failed to scan table ${tableName}:`, error);
    if (error instanceof Error) {
      throw new Error(`Failed to scan table ${tableName}: ${error.message}`);
    }
    throw new Error(`Failed to scan table ${tableName}: Unknown error occurred`);
  }
}

/**
 * @async
 * @function countAll
 * @description Count all items in a table efficiently without loading them into memory.
 * @param {string} tableName - The name of the table to count.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @returns {Promise<number>} A promise that resolves to the total number of items.
 * @throws {Error} When AWS operation fails or table cannot be counted.
 */
export async function countAll(tableName: string, roleArnOverride?: string, oidcToken?: string) {
  const client = await getDocClient(roleArnOverride, oidcToken);
  let totalCount = 0;
  let ExclusiveStartKey;
  try {
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
  } catch (error) {
    console.error(`Failed to count items in table ${tableName}:`, error);
    if (error instanceof Error) {
      throw new Error(`Failed to count items in table ${tableName}: ${error.message}`);
    }
    throw new Error(`Failed to count items in table ${tableName}: Unknown error occurred`);
  }
}

/**
 * @async
 * @function listAllChunked
 * @description Scan table in chunks and return items with lastEvaluatedKey for pagination.
 * @param {string} tableName - The name of the table to scan.
 * @param {Record<string, any>} scanParams - Optional scan parameters.
 * @param {Record<string, any>} lastEvaluatedKey - Optional last evaluated key for pagination.
 * @param {number} limit - Optional limit for the number of items to return.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @param {string} projectionExpression - Optional projection expression.
 * @param {Record<string, string>} expressionAttributeNames - Optional expression attribute names.
 * @returns {Promise<any>} A promise that resolves to an object containing the items and the last evaluated key.
 * @throws {Error} When AWS operation fails or table cannot be scanned.
 */
export async function listAllChunked(
  tableName: string,
  scanParams: Record<string, any> = {},
  lastEvaluatedKey?: Record<string, any>,
  limit?: number,
  roleArnOverride?: string,
  projectionExpression?: string,
  expressionAttributeNames?: Record<string, string>,
  oidcToken?: string
) {
  const client = await getDocClient(roleArnOverride, oidcToken);
  const baseParams = {
    TableName: tableName,
    ...scanParams,
    ...(limit && { Limit: limit }),
    ...(projectionExpression && { ProjectionExpression: projectionExpression }),
    ...(expressionAttributeNames && { ExpressionAttributeNames: expressionAttributeNames })
  };

  try {
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
  } catch (error) {
    console.error(`Failed to scan table ${tableName} in chunks:`, error);
    if (error instanceof Error) {
      throw new Error(`Failed to scan table ${tableName} in chunks: ${error.message}`);
    }
    throw new Error(`Failed to scan table ${tableName} in chunks: Unknown error occurred`);
  }
}

/**
 * @async
 * @function listAllFiltered
 * @description Scan entire table with a filter and return all matching items.
 * @param {string} tableName - The name of the table to scan.
 * @param {string} fieldName - The name of the field to filter on.
 * @param {string} fieldValue - The value of the field to filter on.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @returns {Promise<any[]>} A promise that resolves to an array of matching items.
 * @throws {Error} When AWS operation fails or table cannot be filtered.
 */
export async function listAllFiltered(
  tableName: string,
  fieldName: string,
  fieldValue: string,
  roleArnOverride?: string,
  oidcToken?: string
) {
  const client = await getDocClient(roleArnOverride, oidcToken);
  const items: any[] = [];
  let ExclusiveStartKey;
  console.log("listAllFiltered: tableName:", tableName);
  console.log("listAllFiltered: fieldName:", fieldName);
  console.log("listAllFiltered: fieldValue:", fieldValue);
  try {
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
  } catch (error) {
    console.error(`Failed to filter table ${tableName}:`, error);
    if (error instanceof Error) {
      throw new Error(`Failed to filter table ${tableName}: ${error.message}`);
    }
    throw new Error(`Failed to filter table ${tableName}: Unknown error occurred`);
  }
}

/**
 * @async
 * @function getOne
 * @description Get a single item by partition key.
 * @param {string} tableName - The name of the table to get the item from.
 * @param {string} pkName - The name of the partition key.
 * @param {string} id - The ID of the item to get.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @returns {Promise<any>} A promise that resolves to the item.
 * @throws {Error} When AWS operation fails or item cannot be retrieved from the table.
 */
export async function getOne(
  tableName: string,
  pkName: string,
  id: string,
  roleArnOverride?: string,
  oidcToken?: string
) {
  const client = await getDocClient(roleArnOverride, oidcToken);
  try {
    const { Item } = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { [pkName]: id },
      })
    );
    return Item;
  } catch (error) {
    console.error(`Failed to get item from table ${tableName}:`, error);
    if (error instanceof Error) {
      throw new Error(`Failed to get item from table ${tableName}: ${error.message}`);
    }
    throw new Error(`Failed to get item from table ${tableName}: Unknown error occurred`);
  }
}

/**
 * @async
 * @function getOneWithSort
 * @description Get a single item by composite key (partition + sort key).
 * @param {string} tableName - The name of the table to get the item from.
 * @param {string} pkName - The name of the partition key.
 * @param {string} pkValue - The value of the partition key.
 * @param {string} skName - The name of the sort key.
 * @param {string} skValue - The value of the sort key.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @returns {Promise<any>} A promise that resolves to the item.
 * @throws {Error} When AWS operation fails or item cannot be retrieved from the table.
 */
export async function getOneWithSort(
  tableName: string,
  pkName: string,
  pkValue: string,
  skName: string,
  skValue: string,
  roleArnOverride?: string,
  oidcToken?: string
) {
  const client = await getDocClient(roleArnOverride, oidcToken);
  try {
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
  } catch (error) {
    console.error(`Failed to get item with sort key from table ${tableName}:`, error);
    if (error instanceof Error) {
      throw new Error(`Failed to get item with sort key from table ${tableName}: ${error.message}`);
    }
    throw new Error(`Failed to get item with sort key from table ${tableName}: Unknown error occurred`);
  }
}

/**
 * @async
 * @function putOne
 * @description Put a single item into the table.
 * @param {string} tableName - The name of the table to put the item into.
 * @param {Record<string, any>} item - The item to put into the table.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @returns {Promise<void>}
 * @throws {Error} When AWS operation fails or item cannot be put into the table.
 */
export async function putOne(
  tableName: string,
  item: Record<string, any>,
  roleArnOverride?: string,
  oidcToken?: string
) {
  const client = await getDocClient(roleArnOverride, oidcToken);
  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
      })
    );
  } catch (error) {
    console.error(`Failed to put item into table ${tableName}:`, error);
    if (error instanceof Error) {
      throw new Error(`Failed to put item into table ${tableName}: ${error.message}`);
    }
    throw new Error(`Failed to put item into table ${tableName}: Unknown error occurred`);
  }
}

/**
 * @async
 * @function putOneWithCondition
 * @description Put a single item into the table with a condition expression.
 * @param {string} tableName - The name of the table to put the item into.
 * @param {Record<string, any>} item - The item to put into the table.
 * @param {string} conditionExpression - The condition expression to evaluate.
 * @param {Record<string, any>} expressionAttributeValues - Optional expression attribute values.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @returns {Promise<void>}
 * @throws {Error} When AWS operation fails or item cannot be put into the table.
 */
export async function putOneWithCondition(
  tableName: string,
  item: Record<string, any>,
  conditionExpression: string,
  expressionAttributeValues?: Record<string, any>,
  roleArnOverride?: string,
  oidcToken?: string
) {
  const client = await getDocClient(roleArnOverride, oidcToken);
  try {
    const params: any = {
      TableName: tableName,
      Item: item,
      ConditionExpression: conditionExpression,
    };

    if (expressionAttributeValues && Object.keys(expressionAttributeValues).length > 0) {
      params.ExpressionAttributeValues = expressionAttributeValues;
    }

    await client.send(new PutCommand(params));
  } catch (error) {
    console.error(`Failed to put item with condition into table ${tableName}:`, error);
    if (error instanceof Error) {
      if (error.name === 'ConditionalCheckFailedException') {
        throw new Error(`Condition check failed for item in table ${tableName}: ${error.message}`);
      }
      throw new Error(`Failed to put item with condition into table ${tableName}: ${error.message}`);
    }
    throw new Error(`Failed to put item with condition into table ${tableName}: Unknown error occurred`);
  }
}

/**
 * @async
 * @function updateItem
 * @description Update specific attributes of an item in the table.
 * @param {string} tableName - The name of the table to update the item in.
 * @param {Record<string, any>} key - The key of the item to update.
 * @param {string} updateExpression - The update expression.
 * @param {Record<string, any>} expressionAttributeValues - The expression attribute values.
 * @param {Record<string, string>} expressionAttributeNames - The expression attribute names.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @returns {Promise<void>}
 * @throws {Error} When AWS operation fails or item cannot be updated in the table.
 */
export async function updateItem(
  tableName: string,
  key: Record<string, any>,
  updateExpression: string,
  expressionAttributeValues: Record<string, any>,
  expressionAttributeNames?: Record<string, string>,
  roleArnOverride?: string,
  oidcToken?: string
) {
  const client = await getDocClient(roleArnOverride, oidcToken);
  try {
    const updateParams: any = {
      TableName: tableName,
      Key: key,
      UpdateExpression: updateExpression,
    };

    // Only include ExpressionAttributeValues if it's not empty (needed for REMOVE operations)
    if (Object.keys(expressionAttributeValues).length > 0) {
      updateParams.ExpressionAttributeValues = expressionAttributeValues;
    }

    // Only include ExpressionAttributeNames if provided
    if (expressionAttributeNames) {
      updateParams.ExpressionAttributeNames = expressionAttributeNames;
    }

    await client.send(new UpdateCommand(updateParams));
  } catch (error) {
    console.error(`Failed to update item in table ${tableName}:`, error);
    if (error instanceof Error) {
      throw new Error(`Failed to update item in table ${tableName}: ${error.message}`);
    }
    throw new Error(`Failed to update item in table ${tableName}: Unknown error occurred`);
  }
}

/**
 * @async
 * @function updateItemWithCondition
 * @description Update specific attributes of an item in the table with condition expression.
 * @param {string} tableName - The name of the table to update the item in.
 * @param {string} key - The key of the item to update.
 * @param {string} updateExpression - The update expression.
 * @param {Record<string, any>} expressionAttributeValues - The expression attribute values.
 * @param {Record<string, string>} expressionAttributeNames - The expression attribute names.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @returns {Promise<void>}
 * @throws {Error} When AWS operation fails, item cannot be updated, or condition expression fails.
 */
export async function updateItemWithCondition(
  tableName: string,
  key: Record<string, any>,
  updateExpression: string,
  expressionAttributeValues: Record<string, any>,
  expressionAttributeNames?: Record<string, string>,
  roleArnOverride?: string,
  oidcToken?: string
) {
  const client = await getDocClient(roleArnOverride, oidcToken);
  try {
    const updateParams: any = {
      TableName: tableName,
      Key: key,
      UpdateExpression: updateExpression,
      ConditionExpression: "attribute_exists(id)",
    };

    // Only include ExpressionAttributeValues if it's not empty (needed for REMOVE operations)
    if (Object.keys(expressionAttributeValues).length > 0) {
      updateParams.ExpressionAttributeValues = expressionAttributeValues;
    }

    // Only include ExpressionAttributeNames if provided
    if (expressionAttributeNames) {
      updateParams.ExpressionAttributeNames = expressionAttributeNames;
    }

    await client.send(new UpdateCommand(updateParams));
  } catch (error) {
    console.error(`Failed to update item with condition in table ${tableName}:`, error);
    if (error instanceof Error) {
      // Check for specific AWS error types
      if (error.name === 'ConditionalCheckFailedException') {
        throw new Error(`Condition check failed for item in table ${tableName}: Item does not exist or condition not met`);
      }
      throw new Error(`Failed to update item with condition in table ${tableName}: ${error.message}`);
    }
    throw new Error(`Failed to update item with condition in table ${tableName}: Unknown error occurred`);
  }
}

/**
 * @async
 * @function deleteOne
 * @description Delete a single item by partition key.
 * @param {string} tableName - The name of the table to delete the item from.
 * @param {string} pkName - The name of the partition key.
 * @param {string} id - The ID of the item to delete.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @returns {Promise<void>}
 * @throws {Error} When AWS operation fails or item cannot be deleted from the table.
 */
export async function deleteOne(
  tableName: string,
  pkName: string,
  id: string,
  roleArnOverride?: string,
  oidcToken?: string
) {
  const client = await getDocClient(roleArnOverride, oidcToken);
  try {
    await client.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { [pkName]: id },
      })
    );
  } catch (error) {
    console.error(`Failed to delete item from table ${tableName}:`, error);
    if (error instanceof Error) {
      throw new Error(`Failed to delete item from table ${tableName}: ${error.message}`);
    }
    throw new Error(`Failed to delete item from table ${tableName}: Unknown error occurred`);
  }
}

/**
 * @async
 * @function deleteOneWithSort
 * @description Delete a single item by composite key (partition + sort key).
 * @param {string} tableName - The name of the table to delete the item from.
 * @param {string} pkName - The name of the partition key.
 * @param {string} pkValue - The value of the partition key.
 * @param {string} skName - The name of the sort key.
 * @param {string} skValue - The value of the sort key.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @returns {Promise<void>}
 * @throws {Error} When AWS operation fails or item cannot be deleted from the table.
 */
export async function deleteOneWithSort(
  tableName: string,
  pkName: string,
  pkValue: string,
  skName: string,
  skValue: string,
  roleArnOverride?: string,
  oidcToken?: string
) {
  const client = await getDocClient(roleArnOverride, oidcToken);
  try {
    await client.send(
      new DeleteCommand({
        TableName: tableName,
        Key: {
          [pkName]: pkValue,
          [skName]: skValue,
        },
      })
    );
  } catch (error) {
    console.error(`Failed to delete item with sort key from table ${tableName}:`, error);
    if (error instanceof Error) {
      throw new Error(`Failed to delete item with sort key from table ${tableName}: ${error.message}`);
    }
    throw new Error(`Failed to delete item with sort key from table ${tableName}: Unknown error occurred`);
  }
}

/**
 * @async
 * @function batchGetItems
 * @description Batch get items by their primary keys.
 * @param {string} tableName - The name of the table to get the items from.
 * @param {string} pkName - The name of the primary key.
 * @param {string[]} ids - An array of IDs to get.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @returns {Promise<any[]>} A promise that resolves to an array of items.
 * @throws {Error} When AWS operation fails or items cannot be retrieved from the table.
 */
export async function batchGetItems(
  tableName: string,
  pkName: string,
  ids: string[],
  roleArnOverride?: string,
  oidcToken?: string
) {
  const client = await getDocClient(roleArnOverride, oidcToken);
  const items: any[] = [];

  // DynamoDB BatchGet has a limit of 100 items per request
  const BATCH_SIZE = 100;

  try {
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
  } catch (error) {
    console.error(`Failed to batch get items from table ${tableName}:`, error);
    if (error instanceof Error) {
      throw new Error(`Failed to batch get items from table ${tableName}: ${error.message}`);
    }
    throw new Error(`Failed to batch get items from table ${tableName}: Unknown error occurred`);
  }
}

/**
 * @async
 * @function listAllQueryBeginsWithSortKey
 * @description Query items by a partition key and a sort key that begins with a certain value.
 * @param {string} tableName - The name of the table to query.
 * @param {string} primaryKeyName - The name of the primary key.
 * @param {string} primaryKeyValue - The value of the primary key.
 * @param {string} sortKeyName - The name of the sort key.
 * @param {string} sortKeyValue - The value the sort key should begin with.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @returns {Promise<any[]>} A promise that resolves to an array of items.
 * @throws {Error} When AWS operation fails or table cannot be queried.
 */
async function listAllQueryBeginsWithSortKey(
  tableName: string,
  primaryKeyName: string,
  primaryKeyValue: string,
  sortKeyName: string,
  sortKeyValue: string,
  roleArnOverride?: string,
  oidcToken?: string
) {
  const client = await getDocClient(roleArnOverride, oidcToken);
  const items: any[] = [];
  let ExclusiveStartKey;

  try {
    do {
      const response = await client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: `${primaryKeyName} = :pk AND begins_with(${sortKeyName}, :sk_prefix)`,
          ExpressionAttributeValues: {
            ':pk': primaryKeyValue,
            ':sk_prefix': sortKeyValue,
          },
          ExclusiveStartKey,
        })
      );
      if (response.Items) items.push(...response.Items);
      ExclusiveStartKey = response.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    return items;
  } catch (error) {
    console.error(`Failed to query table ${tableName}:`, error);
    if (error instanceof Error) {
      throw new Error(`Failed to query table ${tableName}: ${error.message}`);
    }
    throw new Error(`Failed to query table ${tableName}: Unknown error occurred`);
  }
}

/**
 * @async
 * @function listAllQueryBeginsWithSortKeyMultiple
 * @description Query items by multiple partition keys with a begins_with condition on the sort key.
 * @param {string} tableName - The name of the table to query.
 * @param {string} primaryKeyName - The name of the primary key.
 * @param {string} primaryKeyValues - A comma-separated string of primary key values.
 * @param {string} sortKeyName - The name of the sort key.
 * @param {string} sortKeyValue - The value the sort key should begin with.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @returns {Promise<Record<string, any[]>>} A promise that resolves to a record of items, where the keys are the primary key values.
 * @throws {Error} When AWS operation fails or table cannot be queried.
 */
export async function listAllQueryBeginsWithSortKeyMultiple(
  tableName: string,
  primaryKeyName: string,
  primaryKeyValues: string,
  sortKeyName: string,
  sortKeyValue: string,
  roleArnOverride?: string,
  oidcToken?: string
) {
  const primaryKeyList = primaryKeyValues.split(',');
  const results: Record<string, any[]> = {};

  console.log("listAllQueryBeginsWithSortKeyMultiple: primaryKeyList:", primaryKeyList);
  console.log("listAllQueryBeginsWithSortKeyMultiple: tableName:", tableName);
  console.log("listAllQueryBeginsWithSortKeyMultiple: primaryKeyName:", primaryKeyName);
  console.log("listAllQueryBeginsWithSortKeyMultiple: sortKeyName:", sortKeyName);
  console.log("listAllQueryBeginsWithSortKeyMultiple: sortKeyValue:", sortKeyValue);

  try {
    const queryPromises = primaryKeyList.map(async (primaryKeyValue) => {
      const items = await listAllQueryBeginsWithSortKey(
        tableName,
        primaryKeyName,
        primaryKeyValue.trim(),
        sortKeyName,
        sortKeyValue,
        roleArnOverride,
        oidcToken
      );
      results[primaryKeyValue.trim()] = items;
      console.log("listAllQueryBeginsWithSortKeyMultiple: results:", results);
    });

    await Promise.all(queryPromises);
    return results;
  } catch (error) {
    console.error(`Failed to query multiple partition keys in table ${tableName}:`, error);
    if (error instanceof Error) {
      throw new Error(`Failed to query multiple partition keys in table ${tableName}: ${error.message}`);
    }
    throw new Error(`Failed to query multiple partition keys in table ${tableName}: Unknown error occurred`);
  }
}