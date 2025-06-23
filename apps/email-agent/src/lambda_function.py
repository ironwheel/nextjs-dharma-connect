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

# Print the full WebSocket URL for debugging
print(f"[DEBUG] Full WEBSOCKET_API_URL: {WEBSOCKET_API_URL}")

# Parse the WebSocket URL to get the API endpoint, ensuring the stage is included
if WEBSOCKET_API_URL:
    url = WEBSOCKET_API_URL.replace('wss://', '').replace('https://', '')
    parts = url.split('/')
    domain = parts[0]
    stage = parts[1] if len(parts) > 1 else ''
    if stage:
        MGMT_API_URL = f"https://{domain}/{stage}"
    else:
        MGMT_API_URL = f"https://{domain}"
    print(f"[DEBUG] Management API URL: {MGMT_API_URL}")
else:
    MGMT_API_URL = None
    print("[ERROR] WEBSOCKET_API_URL environment variable is not set")

apigwmgmt = boto3.client('apigatewaymanagementapi', endpoint_url=MGMT_API_URL) if MGMT_API_URL else None

def get_connection_ids() -> list:
    """Get all active WebSocket connection IDs."""
    response = connections_table.scan(ProjectionExpression='connectionId')
    return [item['connectionId'] for item in response.get('Items', [])]

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Handle DynamoDB stream events."""
    print(f"[DEBUG] Received event: {json.dumps(event)}")
    
    # Handle $connect and $disconnect
    route_key = event.get('requestContext', {}).get('routeKey')
    if route_key == '$connect':
        connection_id = event['requestContext']['connectionId']
        print(f"[DEBUG] New WebSocket connection: {connection_id}")
        connections_table.put_item(Item={'connectionId': connection_id})
        return {'statusCode': 200}
    elif route_key == '$disconnect':
        connection_id = event['requestContext']['connectionId']
        print(f"[DEBUG] WebSocket disconnection: {connection_id}")
        connections_table.delete_item(Key={'connectionId': connection_id})
        return {'statusCode': 200}
    elif route_key == '$default':
        # Handle regular messages
        connection_id = event['requestContext']['connectionId']
        print(f"[DEBUG] Received message from connection {connection_id}")
        try:
            body = json.loads(event.get('body', '{}'))
            print(f"[DEBUG] Message body: {body}")
            if body.get('type') == 'ping':
                print(f"[DEBUG] Received ping from {connection_id}")
                if not apigwmgmt:
                    print("[ERROR] apigwmgmt client is not initialized")
                    return {'statusCode': 500, 'body': 'WebSocket API URL not configured'}
                
                response_data = {
                    'type': 'connectionId',
                    'connectionId': connection_id
                }
                print(f"[DEBUG] Sending response: {response_data}")
                
                try:
                    apigwmgmt.post_to_connection(
                        Data=json.dumps(response_data),
                        ConnectionId=connection_id
                    )
                    print(f"[DEBUG] Successfully sent connection ID {connection_id} to client")
                except Exception as e:
                    print(f"[ERROR] Failed to send connection ID: {str(e)}")
                    return {'statusCode': 500, 'body': str(e)}
                    
                return {'statusCode': 200}
        except Exception as e:
            print(f"[ERROR] Error handling message: {str(e)}")
            return {'statusCode': 500, 'body': str(e)}

    # Otherwise, assume DynamoDB stream event
    try:
        print(f"[DEBUG] Processing DynamoDB stream event with {len(event.get('Records', []))} records")
        
        for record in event.get('Records', []):
            print(f"[DEBUG] Processing record: eventName={record.get('eventName')}, tableName={record.get('eventSourceARN', '').split('/')[-1]}")
            
            # Only process records with 'NewImage'
            if 'NewImage' not in record['dynamodb']:
                print(f"[DEBUG] Skipping record without NewImage")
                continue
                
            # Extract work order ID
            work_order_id = record['dynamodb']['Keys']['id']['S']
            print(f"[DEBUG] Processing work order: {work_order_id}")
            
            # Check if this is a lock/unlock event
            new_image = record['dynamodb']['NewImage']
            old_image = record['dynamodb'].get('OldImage', {})
            
            # Extract locked status from new and old images
            new_locked = new_image.get('locked', {}).get('BOOL', False) if isinstance(new_image.get('locked'), dict) else new_image.get('locked', False)
            old_locked = old_image.get('locked', {}).get('BOOL', False) if isinstance(old_image.get('locked'), dict) else old_image.get('locked', False)
            
            new_locked_by = new_image.get('lockedBy', {}).get('S') if isinstance(new_image.get('lockedBy'), dict) else new_image.get('lockedBy')
            old_locked_by = old_image.get('lockedBy', {}).get('S') if isinstance(old_image.get('lockedBy'), dict) else old_image.get('lockedBy')
            
            print(f"[DEBUG] Lock status change: old_locked={old_locked}, new_locked={new_locked}")
            print(f"[DEBUG] LockedBy change: old_lockedBy={old_locked_by}, new_lockedBy={new_locked_by}")
            
            # Create message for WebSocket
            ws_message = {
                'type': 'workOrderUpdate',
                'id': work_order_id,
                'eventName': record['eventName'],
                'newImage': record['dynamodb']['NewImage']
            }

            print(f"[DEBUG] Sending WebSocket message: {json.dumps(ws_message, default=str)}")

            # Send to WebSocket
            connection_ids = get_connection_ids()
            print(f"[DEBUG] Sending to {len(connection_ids)} WebSocket connections")
            
            for connection_id in connection_ids:
                try:
                    apigwmgmt.post_to_connection(
                        Data=json.dumps(ws_message),
                        ConnectionId=connection_id
                    )
                    print(f"[DEBUG] Successfully sent to connection {connection_id}")
                except apigwmgmt.exceptions.GoneException:
                    # Connection is gone, remove it from the table
                    print(f"Connection {connection_id} is gone, removing from table")
                    connections_table.delete_item(Key={'connectionId': connection_id})
                except Exception as e:
                    print(f"Error sending to WebSocket: {e}")

        return {
            'statusCode': 200,
            'body': json.dumps('Success')
        }

    except Exception as e:
        print(f"[ERROR] Error processing event: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps('Error processing event')
        } 