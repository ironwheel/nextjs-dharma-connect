import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from '@aws-cdk/aws-apigatewayv2-alpha';
import * as apigateway_integrations from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda_event_sources from 'aws-cdk-lib/aws-lambda-event-sources';

export class EmailAgentStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // DynamoDB table for work orders
        const workOrdersTable = new dynamodb.Table(this, 'WorkOrdersTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
        });

        // DynamoDB table for WebSocket connections
        const connectionsTable = new dynamodb.Table(this, 'WebSocketConnections', {
            partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev, change to RETAIN for prod
        });

        // SQS FIFO queue for work order processing
        const workOrderQueue = new sqs.Queue(this, 'WorkOrderQueue', {
            queueName: 'work-order-queue.fifo',
            fifo: true,
            contentBasedDeduplication: true,
            visibilityTimeout: cdk.Duration.seconds(300),
        });

        // WebSocket API
        const api = new apigateway.WebSocketApi(this, 'WorkOrderWebSocketApi', {
            apiName: 'WorkOrderWebSocketApi',
            connectRouteOptions: {
                integration: new apigateway_integrations.WebSocketLambdaIntegration('ConnectIntegration', new lambda.Function(this, 'ConnectHandler', {
                    runtime: lambda.Runtime.PYTHON_3_9,
                    handler: 'lambda_function.lambda_handler',
                    code: lambda.Code.fromAsset('../src'),
                    environment: {
                        WORK_ORDERS_TABLE: workOrdersTable.tableName,
                        WORK_ORDER_QUEUE_URL: workOrderQueue.queueUrl,
                        CONNECTIONS_TABLE: connectionsTable.tableName,
                    },
                }))
            },
            disconnectRouteOptions: {
                integration: new apigateway_integrations.WebSocketLambdaIntegration('DisconnectIntegration', new lambda.Function(this, 'DisconnectHandler', {
                    runtime: lambda.Runtime.PYTHON_3_9,
                    handler: 'lambda_function.lambda_handler',
                    code: lambda.Code.fromAsset('../src'),
                    environment: {
                        CONNECTIONS_TABLE: connectionsTable.tableName,
                    },
                }))
            },
        });

        // WebSocket Stage
        const stage = new apigateway.WebSocketStage(this, 'WebSocketStage', {
            webSocketApi: api,
            stageName: 'prod',
            autoDeploy: true,
        });

        // Lambda function to handle DynamoDB stream events
        const streamHandler = new lambda.Function(this, 'StreamHandler', {
            runtime: lambda.Runtime.PYTHON_3_9,
            handler: 'lambda_function.lambda_handler',
            code: lambda.Code.fromAsset('../src'),
            environment: {
                WORK_ORDERS_TABLE: workOrdersTable.tableName,
                WORK_ORDER_QUEUE_URL: workOrderQueue.queueUrl,
                WEBSOCKET_API_URL: stage.url,
                CONNECTIONS_TABLE: connectionsTable.tableName,
            },
            timeout: cdk.Duration.seconds(30),
        });

        // Grant permissions
        workOrdersTable.grantReadWriteData(streamHandler);
        workOrderQueue.grantSendMessages(streamHandler);
        api.grantManageConnections(streamHandler);
        connectionsTable.grantReadWriteData(streamHandler);

        // Add DynamoDB stream as event source
        streamHandler.addEventSource(new lambda_event_sources.DynamoEventSource(workOrdersTable, {
            startingPosition: lambda.StartingPosition.LATEST,
            batchSize: 1,
            retryAttempts: 3,
        }));

        // Outputs
        new cdk.CfnOutput(this, 'WorkOrdersTableName', {
            value: workOrdersTable.tableName,
        });

        new cdk.CfnOutput(this, 'WorkOrderQueueUrl', {
            value: workOrderQueue.queueUrl,
        });

        new cdk.CfnOutput(this, 'WebSocketApiUrl', {
            value: stage.url,
        });

        new cdk.CfnOutput(this, 'ConnectionsTableName', {
            value: connectionsTable.tableName,
        });
    }
} 