// packages/api/lib/dispatch.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { tables, TableConfig } from './tableConfig';
import { websockets, WebSocketConfig, websocketGetConfig } from './websocketConfig';
import { listAll, listAllChunked, getOne, deleteOne, updateItem, updateItemWithCondition, listAllFiltered, putOne, countAll } from './dynamoClient';
import { verificationEmailSend, verificationEmailCallback, createToken, getViews, getViewsWritePermission, getViewsExportCSV, getViewsHistoryPermission, authGetLink, getActionsProfiles, getAuthList, getViewsProfiles, getActionsProfileForHost, getAllActionsForUser, putAuthItem } from './authUtils';
import { serialize } from 'cookie';
import { v4 as uuidv4 } from 'uuid';
import { sendWorkOrderMessage } from './sqsClient';

async function dispatchTable(
  resource: string,
  id: string | undefined,
  req: NextApiRequest,
  res: NextApiResponse
) {
  const cfg = tables.find((t: TableConfig) => t.resource === resource);
  if (!cfg) {
    return res.status(404).json({ error: `Unknown resource: ${resource}` });
  }

  const tableName = process.env[cfg.envVar]!;
  if (!tableName) throw new Error(`Missing env var: ${cfg.envVar}`);

  // LIST
  if (req.method === 'GET' && !id && cfg.ops.includes('list')) {
    const items = await listAll(tableName);
    return res.status(200).json(items);
  }

  // LIST CHUNKED (POST method for chunked scanning)
  if (req.method === 'POST' && !id && req.body && req.body.limit) {
    const { limit, lastEvaluatedKey, scanParams = {} } = req.body;
    const result = await listAllChunked(tableName, scanParams, lastEvaluatedKey, limit);
    return res.status(200).json(result);
  }

  // LIST CHUNKED (special case when id is "chunked")
  if (req.method === 'POST' && id === 'chunked' && req.body && req.body.limit) {
    const { limit, lastEvaluatedKey, scanParams = {} } = req.body;
    const result = await listAllChunked(tableName, scanParams, lastEvaluatedKey, limit);
    return res.status(200).json(result);
  }

  // LIST FILTERED (POST method for filtered scanning)
  if (req.method === 'POST' && id === 'filtered' && req.body && req.body.filterFieldName && req.body.filterFieldValue) {
    const { filterFieldName, filterFieldValue } = req.body;
    const items = await listAllFiltered(tableName, filterFieldName, filterFieldValue);
    return res.status(200).json({ items });
  }

  // COUNT (POST method for counting items)
  if (req.method === 'POST' && id === 'count' && cfg.ops.includes('count')) {
    const count = await countAll(tableName);
    return res.status(200).json({ count });
  }

  // GET ONE
  if (req.method === 'GET' && id && cfg.ops.includes('get')) {
    const item = await getOne(tableName, cfg.pk, id);
    return item ? res.status(200).json(item) : res.status(404).json({ error: `${resource} ${id} not found` });
  }

  // PUT ONE (upsert)
  if (req.method === 'PUT' && id && cfg.ops.includes('put')) {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid request body for PUT' });
    }
    // Upsert the item using the provided body
    await putOne(tableName, req.body);
    return res.status(200).json({ success: true });
  }

  // UPDATE ITEM (POST method for updating specific fields)
  if (req.method === 'POST' && id && req.body && req.body.fieldName && req.body.fieldValue !== undefined) {
    const { fieldName, fieldValue } = req.body;

    // Handle reserved keywords by using expression attribute names
    const expressionAttributeNames = { '#fieldName': fieldName };
    const updateExpression = `SET #fieldName = :fieldValue`;
    const expressionAttributeValues = { ':fieldValue': fieldValue };

    // Use conditional update for work-orders to prevent recreating deleted items
    if (resource === 'work-orders') {
      try {
        await updateItemWithCondition(tableName, { [cfg.pk]: id }, updateExpression, expressionAttributeValues, expressionAttributeNames);
        return res.status(200).json({ success: true });
      } catch (error: any) {
        // If the item doesn't exist, return success since the goal (unlocked state) is achieved
        if (error.name === 'ConditionalCheckFailedException') {
          console.log(`[API] Work order ${id} does not exist, skipping update`);
          return res.status(200).json({ success: true });
        }
        throw error;
      }
    } else {
      await updateItem(tableName, { [cfg.pk]: id }, updateExpression, expressionAttributeValues, expressionAttributeNames);
      return res.status(200).json({ success: true });
    }
  }

  // DELETE
  if (req.method === 'DELETE' && id && cfg.ops.includes('delete')) {
    await deleteOne(tableName, cfg.pk, id);
    return res.status(204).end();
  }

  // Method Not Allowed
  const allowed: string[] = [];
  if (cfg.ops.includes('list')) allowed.push('GET');
  if (cfg.ops.includes('get')) allowed.push('GET');
  if (cfg.ops.includes('delete')) allowed.push('DELETE');
  if (cfg.ops.includes('put')) allowed.push('PUT');
  if (cfg.ops.includes('count')) allowed.push('POST'); // Allow POST for count operations
  allowed.push('POST'); // Allow POST for updates and filtered queries
  res.setHeader('Allow', allowed);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}

async function dispatchAuth(
  action: string,
  id: string | undefined,
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Extract parameters from request headers and body
  const pid = req.headers['x-user-id'] as string;
  const hash = req.headers['x-verification-hash'] as string;
  const host = req.headers['x-host'] as string;
  const deviceFingerprint = req.headers['x-device-fingerprint'] as string;
  const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || null;

  // Validate required parameters
  if (!pid || !hash || !host || !deviceFingerprint) {
    return res.status(400).json({ error: 'Missing required authentication parameters' });
  }

  try {
    switch (action) {
      case 'verificationEmailSend':
        const sendResult = await verificationEmailSend(pid, hash, host, deviceFingerprint, clientIp);
        return res.status(200).json({ success: sendResult });
      case 'verificationEmailCallback':
        if (!id) {
          return res.status(400).json({ error: 'Verification token ID is required for callback' });
        }
        const callbackResult = await verificationEmailCallback(pid, hash, host, deviceFingerprint, id);
        return res.status(200).json(callbackResult);
      case 'getViews':
        const viewsListData = await getViews(pid, host);
        console.log('dispatchAuth getViews: returning views data:', { views: viewsListData });
        return res.status(200).json({ views: viewsListData });
      case 'viewsWritePermission':
        const viewsWritePermission = await getViewsWritePermission(pid, host);
        return res.status(200).json({ viewsWritePermission });
      case 'viewsExportCSV':
        const exportCSV = await getViewsExportCSV(pid, host);
        return res.status(200).json({ exportCSV });
      case 'viewsHistoryPermission':
        const studentHistory = await getViewsHistoryPermission(pid, host);
        return res.status(200).json({ studentHistory });
      case 'getLink':
        const { domainName, studentId } = req.body;
        if (!domainName || !studentId) {
          return res.status(400).json({ error: 'Missing required parameters: domainName, studentId' });
        }
        const accessLink = await authGetLink(domainName, studentId);
        return res.status(200).json({ accessLink });
      case 'getActionsProfiles':
        const profileNames = await getActionsProfiles();
        return res.status(200).json({ profileNames });
      case 'getAuthList':
        const authRecords = await getAuthList();
        return res.status(200).json({ authRecords });
      case 'getViewsProfiles':
        const viewsProfileNames = await getViewsProfiles();
        return res.status(200).json({ viewsProfileNames });
      case 'putAuthItem':
        const { authRecord } = req.body;
        if (!authRecord || !authRecord.id) {
          return res.status(400).json({ error: 'Missing required parameters: authRecord with id' });
        }
        await putAuthItem(authRecord.id, authRecord);
        return res.status(200).json({ success: true });
      default:
        return res.status(404).json({ error: `Unknown auth action: ${action}` });
    }
  } catch (error: any) {
    console.error(`Auth action ${action} failed:`, error);
    return res.status(500).json({ error: error.message || 'Authentication action failed' });
  }
}

async function dispatchWebSocket(
  resource: string,
  action: string,
  id: string | undefined,
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Extract parameters from request headers
  const pid = req.headers['x-user-id'] as string;
  const hash = req.headers['x-verification-hash'] as string;
  const host = req.headers['x-host'] as string;
  const deviceFingerprint = req.headers['x-device-fingerprint'] as string;

  // Validate required parameters
  if (!pid || !hash || !host || !deviceFingerprint) {
    return res.status(400).json({ error: 'Missing required authentication parameters' });
  }

  try {
    // Get WebSocket configuration
    const wsConfig = websocketGetConfig(resource);

    switch (action) {
      case 'connect':
        // Create a JWT token for WebSocket authentication using the centralized createToken function
        const websocketActions = ['websocket:connect'];
        const token = createToken(pid, deviceFingerprint, websocketActions);

        let url = `${wsConfig.websocketUrl}?token=${token}`;
        if (resource === 'students') {
          url += '&tableType=students';
        } else if (resource === 'work-orders') {
          url += '&tableType=work-orders';
        }
        console.log("DISPATCH: websocket url: ", url);
        // Return the WebSocket URL with token and tableType if needed
        return res.status(200).json({
          websocketUrl: url,
          token: token
        });
      case 'connectnotoken':
        // Return the WebSocket URL without token for testing error handling
        console.log("DISPATCH: websocket url (no token): ", wsConfig.websocketUrl);

        // Return the WebSocket URL without token
        return res.status(200).json({
          websocketUrl: wsConfig.websocketUrl,
          token: null
        });
      default:
        return res.status(404).json({ error: `Unknown websocket action: ${action}` });
    }
  } catch (error: any) {
    console.error(`WebSocket action ${action} failed:`, error);
    return res.status(500).json({ error: error.message || 'WebSocket action failed' });
  }
}

async function dispatchSQS(
  action: string,
  id: string | undefined,
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Extract parameters from request headers
  const pid = req.headers['x-user-id'] as string;
  const hash = req.headers['x-verification-hash'] as string;
  const host = req.headers['x-host'] as string;
  const deviceFingerprint = req.headers['x-device-fingerprint'] as string;

  // Validate required parameters
  if (!pid || !hash || !host || !deviceFingerprint) {
    return res.status(400).json({ error: 'Missing required authentication parameters' });
  }

  try {
    switch (action) {
      case 'send':
        const { workOrderId, stepName, action: messageAction } = req.body;

        if (!workOrderId || !stepName || !messageAction) {
          return res.status(400).json({ error: 'Missing required parameters: workOrderId, stepName, action' });
        }

        if (!['start', 'stop'].includes(messageAction)) {
          return res.status(400).json({ error: 'Invalid action. Must be "start" or "stop"' });
        }

        // Use the new SQS client
        console.log(`[SQS-SEND] Sending work order message:`, { workOrderId, stepName, action: messageAction });
        console.log(`[SQS-SEND] Timestamp: ${new Date().toISOString()}`);

        try {
          // Send SQS message to email-agent
          const result = await sendWorkOrderMessage(workOrderId, stepName, messageAction);
          console.log(`[SQS-SEND] SUCCESS: Sent ${messageAction} message for work order ${workOrderId}, step ${stepName}`);
          return res.status(200).json({ success: true, messageId: result.MessageId });
        } catch (error: any) {
          console.error(`[SQS-SEND] ERROR: Failed to send ${messageAction} message for work order ${workOrderId}, step ${stepName}:`, error);
          return res.status(500).json({ error: error.message || 'Failed to send SQS message' });
        }
      default:
        return res.status(404).json({ error: `Unknown SQS action: ${action}` });
    }
  } catch (error: any) {
    console.error(`SQS action ${action} failed:`, error);
    return res.status(500).json({ error: error.message || 'SQS action failed' });
  }
}

export async function dispatch(
  slug: string[],
  req: NextApiRequest,
  res: NextApiResponse
) {
  const [subsystem, ...rest] = slug;

  console.log("DISPATCH: slug:", slug);

  switch (subsystem) {
    case 'table':
      // Table URLs: /api/table/[resource]/[id]
      const [tableResource, tableId] = rest;
      console.log("DISPATCH: subsystem:", subsystem, "resource:", tableResource, "action:", req.method, "id:", tableId);
      return await dispatchTable(tableResource, tableId, req, res);
    case 'auth':
      // Auth URLs: /api/auth/[action]/[id]
      const [authAction, authId] = rest;
      console.log("DISPATCH: subsystem:", subsystem, "action:", authAction, "id:", authId);
      return await dispatchAuth(authAction, authId, req, res);
    case 'websocket':
      // WebSocket URLs: /api/websocket/[resource]/[action]
      const [websocketResource, websocketAction] = rest;
      console.log("DISPATCH: subsystem:", subsystem, "resource:", websocketResource, "action:", websocketAction);
      return await dispatchWebSocket(websocketResource, websocketAction, undefined, req, res);
    case 'sqs':
      // SQS URLs: /api/sqs/[action]
      const [sqsAction] = rest;
      console.log("DISPATCH: subsystem:", subsystem, "action:", sqsAction);
      return await dispatchSQS(sqsAction, undefined, req, res);
    default:
      return res.status(404).json({ error: `Unknown subsystem: ${subsystem}` });
  }
}