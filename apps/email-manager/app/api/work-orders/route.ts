import { NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { v4 as uuidv4 } from 'uuid'

const client = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(client)

const WORK_ORDERS_TABLE = process.env.DYNAMODB_TABLE_WORK_ORDERS || 'WorkOrders'

export async function GET() {
    try {
        const command = new QueryCommand({
            TableName: WORK_ORDERS_TABLE,
            KeyConditionExpression: 'status = :status',
            ExpressionAttributeValues: {
                ':status': 'pending'
            }
        })

        const response = await docClient.send(command)
        return NextResponse.json({ workOrders: response.Items || [] })
    } catch (error) {
        console.error('Error fetching work orders:', error)
        return NextResponse.json({ error: 'Failed to fetch work orders' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        const { eventCode, subEvent, stage, language, subject, account, createdBy, steps } = await request.json()

        const workOrder = {
            id: uuidv4(),
            eventCode,
            subEvent,
            stage,
            language,
            subject,
            account,
            createdBy,
            status: 'pending',
            steps: steps.map((step: any) => ({
                ...step,
                status: 'pending'
            })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }

        const command = new PutCommand({
            TableName: WORK_ORDERS_TABLE,
            Item: workOrder
        })

        await docClient.send(command)
        return NextResponse.json({ id: workOrder.id })
    } catch (error) {
        console.error('Error creating work order:', error)
        return NextResponse.json({ error: 'Failed to create work order' }, { status: 500 })
    }
}

export async function PUT(request: Request) {
    try {
        const { id, eventCode, subEvent, stage, language, subject, account, createdBy, steps } = await request.json()

        const command = new UpdateCommand({
            TableName: WORK_ORDERS_TABLE,
            Key: { id },
            UpdateExpression: 'SET eventCode = :eventCode, subEvent = :subEvent, stage = :stage, language = :language, subject = :subject, account = :account, createdBy = :createdBy, steps = :steps, updatedAt = :updatedAt',
            ConditionExpression: 'attribute_exists(id) AND #status <> :running',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':running': 'running',
                ':eventCode': eventCode,
                ':subEvent': subEvent,
                ':stage': stage,
                ':language': language,
                ':subject': subject,
                ':account': account,
                ':createdBy': createdBy,
                ':steps': steps,
                ':updatedAt': new Date().toISOString()
            }
        })

        await docClient.send(command)
        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error updating work order:', error)
        return NextResponse.json({ error: 'Failed to update work order' }, { status: 500 })
    }
}

export async function DELETE(request: Request) {
    try {
        const { id } = await request.json()

        const command = new DeleteCommand({
            TableName: WORK_ORDERS_TABLE,
            Key: { id },
            ConditionExpression: '#status <> :running',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':running': 'running'
            }
        })

        await docClient.send(command)
        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting work order:', error)
        return NextResponse.json({ error: 'Failed to delete work order' }, { status: 500 })
    }
} 