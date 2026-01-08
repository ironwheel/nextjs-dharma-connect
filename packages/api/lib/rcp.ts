/**
 * @file packages/api/lib/rcp.ts
 * @description RCP (Restrict Content Pro) integration.
 */
import axios from 'axios';
import { tableGetConfig } from './tableConfig';
import { getOne } from './dynamoClient';

// Configuration
const KM_RCP_API_KEY = process.env.KM_RCP_API_KEY;
const KM_RCP_API_HOST = process.env.KM_RCP_API_HOST || 'https://kalapamedia.com';

if (!KM_RCP_API_KEY) {
    console.error("KM_RCP_API_KEY is not set.");
}

/**
 * @function findParticipant
 * @description Finds a participant by ID in DynamoDB.
 */
async function findParticipant(id: string, oidcToken?: string): Promise<any> {
    const tableCfg = tableGetConfig('students');
    return await getOne(tableCfg.tableName, tableCfg.pk, id, process.env.AUTH_ROLE_ARN, oidcToken);
}

export async function rcpFind(pid: string, oidcToken?: string) {
    if (!pid) throw new Error("Missing pid");

    let clientData;
    try {
        clientData = await findParticipant(pid, oidcToken);
    } catch (err: any) {
        throw new Error(`Participant not found: ${err.message}`);
    }

    if (!clientData || !clientData.email) {
        throw new Error("Participant email not found");
    }

    const config = {
        method: 'get',
        url: `${KM_RCP_API_HOST}/wp-json/rcp/v1/customers`,
        params: { 'user_email': clientData.email },
        headers: {
            'Authorization': 'Basic ' + KM_RCP_API_KEY
        }
    };

    try {
        const res = await axios(config);
        return {
            pid: pid,
            email: clientData.email,
            rcpData: res.data,
        };
    } catch (err: any) {
        throw new Error(`Bad response to RCP customers request: ${err.message}`);
    }
}

export async function rcpCreateMembership(pid: string, cid: string, level: string, oidcToken?: string) {
    if (!pid || !cid || !level) throw new Error("Missing required parameters (pid, cid, level)");

    // Verify participant exists
    try {
        const exists = await findParticipant(pid, oidcToken);
        if (!exists) throw new Error("Participant not found in DB");
    } catch (err: any) {
        throw new Error(`Participant check failed: ${err.message}`);
    }

    const config = {
        method: 'post',
        url: `${KM_RCP_API_HOST}/wp-json/rcp/v1/memberships/new`,
        params: {
            'customer_id': cid,
            'object_id': level,
            'status': 'active',
            'notes': 'Created by JS automation'
        },
        headers: {
            'Authorization': 'Basic ' + KM_RCP_API_KEY
        }
    };

    try {
        const res = await axios(config);
        return {
            pid: pid,
            rcpData: res.data,
        };
    } catch (err: any) {
        // Log the full error for debugging but throw a cleaner message
        console.error("rcpCreateMembership fails:", JSON.stringify(err));
        throw new Error(`Bad response to RCP membership request: ${err.message}`);
    }
}
