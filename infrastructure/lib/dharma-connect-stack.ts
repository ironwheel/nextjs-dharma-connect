import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from '@aws-cdk/aws-apigatewayv2-alpha';
import * as apigateway_integrations from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda_event_sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';

export class DharmaConnectStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // DynamoDB table for work orders
        const workOrdersTable = new dynamodb.Table(this, 'WorkOrdersTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
        });

        // Import existing students table (foundations.participants)
        const studentsTable = dynamodb.Table.fromTableName(this, 'StudentsTable', 'foundations.participants');

        // DynamoDB table for work order WebSocket connections
        const workOrderConnectionsTable = new dynamodb.Table(this, 'WorkOrderConnections', {
            partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev, change to RETAIN for prod
        });

        // DynamoDB table for student WebSocket connections
        const studentConnectionsTable = new dynamodb.Table(this, 'StudentConnections', {
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

        // CloudWatch Log Group for Lambda function
        const lambdaLogGroup = new logs.LogGroup(this, 'WebSocketHandlerLogGroup', {
            logGroupName: `/aws/lambda/DharmaConnectStack-WebSocketHandler47C0AA1A-vRTubbtfIusz`,
            retention: logs.RetentionDays.ONE_WEEK, // Adjust retention as needed
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev, change to RETAIN for prod
        });

        // Single consolidated Lambda function for all WebSocket operations
        const webSocketHandler = new lambda.Function(this, 'WebSocketHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('../apps/websocket-lambda'),
            environment: {
                WORK_ORDERS_TABLE: workOrdersTable.tableName,
                STUDENTS_TABLE: 'foundations.participants', // Use the actual table name
                WORK_ORDER_QUEUE_URL: workOrderQueue.queueUrl,
                WORK_ORDER_CONNECTIONS_TABLE: workOrderConnectionsTable.tableName,
                STUDENT_CONNECTIONS_TABLE: studentConnectionsTable.tableName,
            },
            timeout: cdk.Duration.seconds(30),
            logGroup: lambdaLogGroup, // Associate the log group with the Lambda function
        });

        // WebSocket API
        const api = new apigateway.WebSocketApi(this, 'DharmaConnectWebSocketApi', {
            apiName: 'DharmaConnectWebSocketApi',
            connectRouteOptions: {
                integration: new apigateway_integrations.WebSocketLambdaIntegration('ConnectIntegration', webSocketHandler)
            },
            disconnectRouteOptions: {
                integration: new apigateway_integrations.WebSocketLambdaIntegration('DisconnectIntegration', webSocketHandler)
            },
            defaultRouteOptions: {
                integration: new apigateway_integrations.WebSocketLambdaIntegration('DefaultIntegration', webSocketHandler)
            }
        });

        // WebSocket Stage
        const stage = new apigateway.WebSocketStage(this, 'WebSocketStage', {
            webSocketApi: api,
            stageName: 'prod',
            autoDeploy: true,
        });

        // Update handler environment with API URL (use stage URL to include stage name)
        webSocketHandler.addEnvironment('WEBSOCKET_API_URL', stage.url);

        // Grant all necessary permissions to the single handler
        workOrdersTable.grantReadWriteData(webSocketHandler);
        studentsTable.grantReadWriteData(webSocketHandler);
        workOrderQueue.grantSendMessages(webSocketHandler);
        api.grantManageConnections(webSocketHandler);
        workOrderConnectionsTable.grantReadWriteData(webSocketHandler);
        studentConnectionsTable.grantReadWriteData(webSocketHandler);

        // Add DynamoDB stream as event source for the students table
        // Get the stream ARN from the existing table
        const studentsStreamArn = 'arn:aws:dynamodb:us-east-1:011754621643:table/foundations.participants/stream/2025-07-17T19:07:03.193';

        webSocketHandler.addEventSource(new lambda_event_sources.DynamoEventSource(
            dynamodb.Table.fromTableAttributes(this, 'StudentsTableStream', {
                tableName: 'foundations.participants',
                tableStreamArn: studentsStreamArn,
            }), {
            startingPosition: lambda.StartingPosition.LATEST,
            batchSize: 1,
            retryAttempts: 3,
        }
        ));

        // Outputs
        new cdk.CfnOutput(this, 'WorkOrdersTableName', {
            value: workOrdersTable.tableName,
        });

        new cdk.CfnOutput(this, 'WorkOrderQueueUrl', {
            value: workOrderQueue.queueUrl,
        });

        new cdk.CfnOutput(this, 'WebSocketApiUrl', {
            value: stage.url,
            exportName: 'WebSocketApiUrl',
        });

        new cdk.CfnOutput(this, 'AWS_WEBSOCKET_API_URL', {
            value: stage.url,
            exportName: 'AWS-WEBSOCKET-API-URL',
        });

        new cdk.CfnOutput(this, 'WorkOrderConnectionsTableName', {
            value: workOrderConnectionsTable.tableName,
        });

        new cdk.CfnOutput(this, 'StudentConnectionsTableName', {
            value: studentConnectionsTable.tableName,
        });

        new cdk.CfnOutput(this, 'StudentsTableName', {
            value: studentsTable.tableName,
        });

        new cdk.CfnOutput(this, 'WebSocketHandlerName', {
            value: webSocketHandler.functionName,
        });
    }
} 