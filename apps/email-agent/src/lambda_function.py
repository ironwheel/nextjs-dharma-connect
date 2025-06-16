import json
import boto3
import os
from typing import Dict, Any

dynamodb = boto3.resource('dynamodb')
connections_table = dynamodb.Table(os.environ['CONNECTIONS_TABLE'])
sqs = boto3.client('sqs')

# Get environment variables
SQS_QUEUE_URL = os.environ.get('WORK_ORDER_QUEUE_URL')
WEBSOCKET_API_URL = os.environ.get('WEBSOCKET_API_URL')
MGMT_API_URL = WEBSOCKET_API_URL.replace('wss://', 'https://') if WEBSOCKET_API_URL else None
apigwmgmt = boto3.client('apigatewaymanagementapi', endpoint_url=MGMT_API_URL) if MGMT_API_URL else None

def is_step_status_change(record: Dict[str, Any]) -> bool:
    """Check if the change is a step status change."""
    if record['eventName'] != 'MODIFY':
        return False

    old_image = record['dynamodb'].get('OldImage', {})
    new_image = record['dynamodb'].get('NewImage', {})

    # Check if steps were modified
    if 'steps' not in old_image or 'steps' not in new_image:
        return False

    old_steps = old_image['steps']['L']
    new_steps = new_image['steps']['L']

    # Compare step statuses
    for old_step, new_step in zip(old_steps, new_steps):
        old_status = old_step['M']['status']['S']
        new_status = new_step['M']['status']['S']
        if old_status != new_status:
            return True

    return False

def get_connection_ids() -> list:
    """Get all active WebSocket connection IDs."""
    response = connections_table.scan(ProjectionExpression='connectionId')
    return [item['connectionId'] for item in response.get('Items', [])]

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Handle DynamoDB stream events."""
    # Handle $connect and $disconnect
    route_key = event.get('requestContext', {}).get('routeKey')
    if route_key == '$connect':
        connection_id = event['requestContext']['connectionId']
        connections_table.put_item(Item={'connectionId': connection_id})
        return {'statusCode': 200}
    elif route_key == '$disconnect':
        connection_id = event['requestContext']['connectionId']
        connections_table.delete_item(Key={'connectionId': connection_id})
        return {'statusCode': 200}

    # Otherwise, assume DynamoDB stream event
    try:
        for record in event.get('Records', []):
            # Only process records with 'NewImage'
            if 'NewImage' not in record['dynamodb']:
                continue
            # Extract work order ID
            work_order_id = record['dynamodb']['Keys']['id']['S']
            
            # Create message for WebSocket
            ws_message = {
                'type': 'workOrderUpdate',
                'id': work_order_id,
                'eventName': record['eventName'],
                'newImage': record['dynamodb']['NewImage']
            }

            # Send to WebSocket
            for connection_id in get_connection_ids():
                try:
                    apigwmgmt.post_to_connection(
                        Data=json.dumps(ws_message),
                        ConnectionId=connection_id
                    )
                except Exception as e:
                    print(f"Error sending to WebSocket: {e}")

            # If it's a step status change, send to SQS
            if is_step_status_change(record):
                sqs_message = {
                    'id': work_order_id,
                    'eventName': record['eventName'],
                    'newImage': record['dynamodb']['NewImage']
                }
                
                sqs.send_message(
                    QueueUrl=SQS_QUEUE_URL,
                    MessageBody=json.dumps(sqs_message),
                    MessageGroupId=work_order_id  # For FIFO queue
                )

        return {
            'statusCode': 200,
            'body': json.dumps('Success')
        }

    except Exception as e:
        print(f"Error processing event: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps('Error processing event')
        } 