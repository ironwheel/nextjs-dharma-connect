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
import { fromCognitoIdentityPool } from '@aws-sdk/credential-provider-cognito-identity';

// --- Configuration from Environment Variables ---
// These will be read from the environment of the calling application (e.g., student-dashboard API route)
const REGION = process.env.AWS_REGION; // No default, must be set
const IDENTITY_POOL_ID = process.env.AWS_COGNITO_IDENTITY_POOL_ID; // No default, must be set

// Cache docClientInstance per identityPoolId
const docClientInstances: Record<string, DynamoDBDocumentClient> = {};

/**
 * @function getDocClient
 * @description Initializes and returns a singleton DynamoDBDocumentClient instance.
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
 * @async
 * @function listAll
 * @description Scan entire table and return all items.
 * @param {string} tableName - The name of the table to scan.
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable.
 * @returns {Promise<any[]>} A promise that resolves to an array of items.
 * @throws {Error} When AWS operation fails or table cannot be scanned.
 */
export async function listAll(tableName: string, identityPoolIdOverride?: string) {
  const client = getDocClient(identityPoolIdOverride);
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
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable.
 * @returns {Promise<number>} A promise that resolves to the total number of items.
 * @throws {Error} When AWS operation fails or table cannot be counted.
 */
export async function countAll(tableName: string, identityPoolIdOverride?: string) {
  const client = getDocClient(identityPoolIdOverride);
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
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable.
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
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable.
 * @returns {Promise<any[]>} A promise that resolves to an array of matching items.
 * @throws {Error} When AWS operation fails or table cannot be filtered.
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
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable.
 * @returns {Promise<any>} A promise that resolves to the item.
 * @throws {Error} When AWS operation fails or item cannot be retrieved from the table.
 */
export async function getOne(
  tableName: string,
  pkName: string,
  id: string,
  identityPoolIdOverride?: string
) {
  const client = getDocClient(identityPoolIdOverride);
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
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable.
 * @returns {Promise<any>} A promise that resolves to the item.
 * @throws {Error} When AWS operation fails or item cannot be retrieved from the table.
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
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable.
 * @returns {Promise<void>}
 * @throws {Error} When AWS operation fails or item cannot be put into the table.
 */
export async function putOne(
  tableName: string,
  item: Record<string, any>,
  identityPoolIdOverride?: string
) {
  const client = getDocClient(identityPoolIdOverride);
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
 * @function updateItem
 * @description Update specific attributes of an item in the table.
 * @param {string} tableName - The name of the table to update the item in.
 * @param {Record<string, any>} key - The key of the item to update.
 * @param {string} updateExpression - The update expression.
 * @param {Record<string, any>} expressionAttributeValues - The expression attribute values.
 * @param {Record<string, string>} expressionAttributeNames - The expression attribute names.
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable.
 * @returns {Promise<void>}
 * @throws {Error} When AWS operation fails or item cannot be updated in the table.
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
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable.
 * @returns {Promise<void>}
 * @throws {Error} When AWS operation fails, item cannot be updated, or condition expression fails.
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
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable.
 * @returns {Promise<void>}
 * @throws {Error} When AWS operation fails or item cannot be deleted from the table.
 */
export async function deleteOne(
  tableName: string,
  pkName: string,
  id: string,
  identityPoolIdOverride?: string
) {
  const client = getDocClient(identityPoolIdOverride);
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
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable.
 * @returns {Promise<void>}
 * @throws {Error} When AWS operation fails or item cannot be deleted from the table.
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
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable.
 * @returns {Promise<any[]>} A promise that resolves to an array of items.
 * @throws {Error} When AWS operation fails or items cannot be retrieved from the table.
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
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable.
 * @returns {Promise<any[]>} A promise that resolves to an array of items.
 * @throws {Error} When AWS operation fails or table cannot be queried.
 */
async function listAllQueryBeginsWithSortKey(
  tableName: string,
  primaryKeyName: string,
  primaryKeyValue: string,
  sortKeyName: string,
  sortKeyValue: string,
  identityPoolIdOverride?: string
) {
  const client = getDocClient(identityPoolIdOverride);
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
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable.
 * @returns {Promise<Record<string, any[]>>} A promise that resolves to a record of items, where the keys are the primary key values.
 * @throws {Error} When AWS operation fails or table cannot be queried.
 */
export async function listAllQueryBeginsWithSortKeyMultiple(
  tableName: string,
  primaryKeyName: string,
  primaryKeyValues: string,
  sortKeyName: string,
  sortKeyValue: string,
  identityPoolIdOverride?: string
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
        identityPoolIdOverride
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