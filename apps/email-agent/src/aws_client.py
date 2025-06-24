import boto3
from botocore.exceptions import ClientError
from datetime import datetime
from typing import Dict, List, Optional
import os
import json

from .config import config
from .models import WorkOrder, WorkOrderUpdate

# Use settings from the centralized config object
DYNAMODB_TABLE = config.work_orders_table
SQS_QUEUE_URL = config.sqs_queue_url
WEBSOCKET_API_URL = config.websocket_api_url
CONNECTIONS_TABLE = config.connections_table
EVENTS_TABLE = config.events_table

class AWSClient:
    def __init__(self):
        self.dynamodb = boto3.resource('dynamodb', region_name=config.aws_region)
        self.sqs = boto3.client('sqs', region_name=config.aws_region)
        
        if not WEBSOCKET_API_URL:
            raise ValueError("WEBSOCKET_API_URL environment variable is not set")
        
        # Parse the WebSocket URL to get the API ID and stage
        try:
            # Remove any protocol prefix (wss:// or https://)
            url = WEBSOCKET_API_URL.replace('wss://', '').replace('https://', '')
            
            # Split into parts
            parts = url.split('.')
            if len(parts) < 2:
                raise ValueError(f"Invalid WebSocket URL format: {WEBSOCKET_API_URL}")
            
            # The first part should be the API ID
            api_id = parts[0]
            
            # The last part should be the stage (split by / and take the last part)
            stage = parts[-1].split('/')[-1]
            
            # Construct the Management API endpoint
            mgmt_api_url = f"https://{api_id}.execute-api.{config.aws_region}.amazonaws.com/{stage}"
            
            # Create the API Gateway Management API client
            self.apigateway = boto3.client(
                'apigatewaymanagementapi',
                endpoint_url=mgmt_api_url,
                region_name=config.aws_region
            )
            self.table = self.dynamodb.Table(DYNAMODB_TABLE)
            
        except Exception as e:
            print(f"[ERROR] Error parsing WebSocket URL: {str(e)}")
            raise

    def get_work_order(self, id: str) -> Optional[WorkOrder]:
        try:
            response = self.table.get_item(Key={'id': id})
            if 'Item' in response:
                work_order = WorkOrder.from_dict(response['Item'])
                return work_order
            return None
        except ClientError as e:
            print(f"Error getting work order: {e}")
            return None

    def update_work_order(self, update: dict) -> bool:
        try:
            # Get the current work order
            current = self.get_work_order(update['id'])
            if not current:
                print(f"Work order not found: {update['id']}")
                return False

            # Prepare the update expression and values
            update_expressions = []
            expression_attribute_names = {}
            expression_attribute_values = {}
            
            # Handle each field in the updates
            for key, value in update['updates'].items():
                if key == 'steps':
                    # Handle steps specially - convert to DynamoDB format
                    if value and isinstance(value[0], dict):
                        # Convert regular format to DynamoDB format
                        dynamodb_steps = []
                        for step in value:
                            dynamodb_step = {
                                'name': {'S': step['name']},
                                'status': {'S': step['status']},
                                'message': {'S': step['message']},
                                'isActive': {'BOOL': step['isActive']},
                                'startTime': {'NULL': True} if step.get('startTime') is None else {'S': step['startTime']},
                                'endTime': {'NULL': True} if step.get('endTime') is None else {'S': step['endTime']}
                            }
                            dynamodb_steps.append(dynamodb_step)
                        value = dynamodb_steps
                    
                    update_expressions.append(f"#{key} = :{key}")
                    expression_attribute_names[f"#{key}"] = key
                    expression_attribute_values[f":{key}"] = value
                else:
                    # Handle other fields normally
                    update_expressions.append(f"#{key} = :{key}")
                    expression_attribute_names[f"#{key}"] = key
                    expression_attribute_values[f":{key}"] = value
            
            # Always update the updatedAt timestamp
            update_expressions.append("#updatedAt = :updatedAt")
            expression_attribute_names["#updatedAt"] = "updatedAt"
            expression_attribute_values[":updatedAt"] = datetime.utcnow().isoformat()

            # Update the work order in DynamoDB
            self.table.update_item(
                Key={'id': update['id']},
                UpdateExpression=f"SET {', '.join(update_expressions)}",
                ExpressionAttributeNames=expression_attribute_names,
                ExpressionAttributeValues=expression_attribute_values
            )

            # Get the updated work order for WebSocket notification
            updated_work_order = self.get_work_order(update['id'])
            if updated_work_order:
                work_order_data = updated_work_order.dict()
                
                # Ensure locked status is preserved and included in the update
                # Get the current locked status from DynamoDB to make sure it's accurate
                try:
                    response = self.table.get_item(Key={'id': update['id']})
                    if 'Item' in response:
                        current_item = response['Item']
                        # Extract locked status from DynamoDB format
                        locked = current_item.get('locked', {}).get('BOOL', False) if isinstance(current_item.get('locked'), dict) else current_item.get('locked', False)
                        locked_by = current_item.get('lockedBy', {}).get('S') if isinstance(current_item.get('lockedBy'), dict) else current_item.get('lockedBy')
                        
                        # Update the work order data with the current locked status
                        work_order_data['locked'] = locked
                        work_order_data['lockedBy'] = locked_by
                        
                        print(f"[DEBUG] Current locked status from DynamoDB: locked={locked}, lockedBy={locked_by}")
                except Exception as e:
                    print(f"[DEBUG] Error getting current locked status: {e}")
                
                print(f"[DEBUG] Sending WebSocket update for work order {update['id']}")
                print(f"[DEBUG] Work order data: {work_order_data}")
                print(f"[DEBUG] Steps data: {work_order_data.get('steps', [])}")
                print(f"[DEBUG] Locked status in WebSocket update: {work_order_data.get('locked')}, lockedBy: {work_order_data.get('lockedBy')}")
                self._send_websocket_update(update['id'], work_order_data)
            
            return True
        except ClientError as e:
            print(f"Error updating work order: {e}")
            return False

    def _send_websocket_update(self, work_order_id: str, work_order_data: dict):
        """Send a WebSocket update with the complete work order data."""
        try:
            # Get all connection IDs from DynamoDB
            response = self.dynamodb.Table(CONNECTIONS_TABLE).scan(
                ProjectionExpression='connectionId'
            )
            
            if not response.get('Items'):
                return
            
            # Create the message
            message = {
                'type': 'workOrderUpdate',
                'workOrder': work_order_data
            }

            # Ensure all enum values are converted to strings
            def convert_enums(obj):
                if isinstance(obj, dict):
                    return {k: convert_enums(v) for k, v in obj.items()}
                elif isinstance(obj, list):
                    return [convert_enums(item) for item in obj]
                elif hasattr(obj, 'value'):  # Handle Enum types
                    return obj.value
                elif hasattr(obj, 'dict'):  # Handle objects with dict() method (like Step, WorkOrder)
                    return convert_enums(obj.dict())
                elif hasattr(obj, 'to_dict'):  # Handle objects with to_dict() method
                    return convert_enums(obj.to_dict())
                return obj

            # Convert any enum values to strings
            serializable_message = convert_enums(message)

            # Send to all connections
            for item in response.get('Items', []):
                try:
                    connection_id = item['connectionId']
                    self.apigateway.post_to_connection(
                        Data=json.dumps(serializable_message),
                        ConnectionId=connection_id
                    )
                except Exception as e:
                    print(f"[ERROR] Error sending to WebSocket connection {item['connectionId']}: {str(e)}")
                    
                    # If the connection is gone, remove it from DynamoDB
                    if isinstance(e, self.apigateway.exceptions.GoneException):
                        try:
                            self.dynamodb.Table(CONNECTIONS_TABLE).delete_item(
                                Key={'connectionId': item['connectionId']}
                            )
                        except Exception as delete_error:
                            print(f"[ERROR] Error removing stale connection: {str(delete_error)}")
        except Exception as e:
            print(f"[ERROR] Error in _send_websocket_update: {str(e)}")

    def lock_work_order(self, id: str, agent_id: str) -> bool:
        try:
            self.table.update_item(
                Key={'id': id},
                UpdateExpression="SET #locked = :locked, #lockedBy = :lockedBy, #updatedAt = :updatedAt",
                ExpressionAttributeNames={
                    "#locked": "locked",
                    "#lockedBy": "lockedBy",
                    "#updatedAt": "updatedAt"
                },
                ExpressionAttributeValues={
                    ":locked": True,
                    ":lockedBy": agent_id,
                    ":updatedAt": datetime.utcnow().isoformat(),
                    ":false": False
                },
                ConditionExpression="attribute_exists(id) AND #locked = :false"
            )
            return True
        except ClientError as e:
            print(f"Error locking work order: {e}")
            return False

    def unlock_work_order(self, id: str) -> bool:
        print(f"[DEBUG] Unlocking work order: {id}")
        try:
            result = self.table.update_item(
                Key={'id': id},
                UpdateExpression="SET #locked = :locked, #lockedBy = :lockedBy, #updatedAt = :updatedAt",
                ExpressionAttributeNames={
                    "#locked": "locked",
                    "#lockedBy": "lockedBy",
                    "#updatedAt": "updatedAt"
                },
                ExpressionAttributeValues={
                    ":locked": False,
                    ":lockedBy": None,
                    ":updatedAt": datetime.utcnow().isoformat()
                },
                ReturnValues='ALL_NEW'
            )
            print(f"[DEBUG] Successfully unlocked work order {id}")
            print(f"[DEBUG] Updated item: {result.get('Attributes', {})}")
            return True
        except ClientError as e:
            print(f"Error unlocking work order: {e}")
            return False

    def receive_sqs_messages(self, max_messages: int = 1) -> List[Dict]:
        try:
            response = self.sqs.receive_message(
                QueueUrl=SQS_QUEUE_URL,
                MaxNumberOfMessages=max_messages,
                WaitTimeSeconds=5  # Reduced from 20 to 5 seconds for faster response
            )
            return response.get('Messages', [])
        except ClientError as e:
            print(f"Error receiving SQS messages: {e}")
            return []

    def delete_sqs_message(self, receipt_handle: str) -> bool:
        try:
            self.sqs.delete_message(
                QueueUrl=SQS_QUEUE_URL,
                ReceiptHandle=receipt_handle
            )
            return True
        except ClientError as e:
            print(f"Error deleting SQS message: {e}")
            return False

    def unlock_all_work_orders(self) -> int:
        """Unlock all locked work orders. Returns the number of work orders unlocked."""
        try:
            # Scan for locked work orders
            response = self.dynamodb.Table(DYNAMODB_TABLE).scan(
                FilterExpression='#locked = :locked',
                ExpressionAttributeNames={'#locked': 'locked'},
                ExpressionAttributeValues={':locked': True}
            )
            
            # Unlock each work order
            unlocked_count = 0
            for item in response.get('Items', []):
                self.dynamodb.Table(DYNAMODB_TABLE).update_item(
                    Key={'id': item['id']},
                    UpdateExpression='SET #locked = :locked, #lockedBy = :lockedBy',
                    ExpressionAttributeNames={
                        '#locked': 'locked',
                        '#lockedBy': 'lockedBy'
                    },
                    ExpressionAttributeValues={
                        ':locked': False,
                        ':lockedBy': None
                    }
                )
                unlocked_count += 1
            
            return unlocked_count
        except Exception as e:
            print(f"[DEBUG] Error unlocking work orders: {str(e)}")
            return 0

    def scan_table(self, table_name: str) -> List[Dict]:
        """
        Scan an entire DynamoDB table and return all items.
        
        Args:
            table_name: Name of the DynamoDB table to scan
            
        Returns:
            List of all items in the table
            
        Raises:
            Exception: If the scan operation fails
        """
        try:
            print(f"[DEBUG] Scanning table: {table_name}")
            table = self.dynamodb.Table(table_name)
            items = []
            
            # Use pagination to get all items
            last_evaluated_key = None
            while True:
                if last_evaluated_key:
                    response = table.scan(ExclusiveStartKey=last_evaluated_key)
                else:
                    response = table.scan()
                
                items.extend(response.get('Items', []))
                
                # Check if there are more items
                last_evaluated_key = response.get('LastEvaluatedKey')
                if not last_evaluated_key:
                    break
            
            print(f"[DEBUG] Scanned {len(items)} items from table: {table_name}")
            return items
            
        except Exception as e:
            print(f"[DEBUG] Error scanning table {table_name}: {str(e)}")
            raise Exception(f"Failed to scan table {table_name}: {str(e)}")

    def get_active_websocket_connections(self) -> List[str]:
        """Get all active WebSocket connection IDs."""
        try:
            response = self.dynamodb.Table(CONNECTIONS_TABLE).scan(
                ProjectionExpression='connectionId'
            )
            return [item['connectionId'] for item in response.get('Items', [])]
        except Exception as e:
            print(f"[DEBUG] Error getting WebSocket connections: {str(e)}")
            return []

    def display_websocket_connections(self):
        """Display active WebSocket connections in a formatted way."""
        connections = self.get_active_websocket_connections()
        if connections:
            print(f"\n[WEBSOCKET] Active connections ({len(connections)}):")
            for i, conn_id in enumerate(connections, 1):
                # Truncate the connection ID for cleaner display
                short_id = conn_id[:8] + "..." if len(conn_id) > 8 else conn_id
                print(f"[WEBSOCKET]   {i}. {short_id}")
        else:
            print("\n[WEBSOCKET] No active connections")
        print()  # Add spacing

    def cleanup_stale_connections(self):
        """Test all connections and remove stale ones from DynamoDB."""
        connections = self.get_active_websocket_connections()
        if not connections:
            return 0
        
        cleaned_count = 0
        for conn_id in connections:
            try:
                # Send a test message to check if connection is alive
                self.apigateway.post_to_connection(
                    Data=json.dumps({'type': 'heartbeat', 'timestamp': datetime.utcnow().isoformat()}),
                    ConnectionId=conn_id
                )
            except Exception as e:
                # If connection is gone, remove it from DynamoDB
                if isinstance(e, self.apigateway.exceptions.GoneException):
                    try:
                        self.dynamodb.Table(CONNECTIONS_TABLE).delete_item(
                            Key={'connectionId': conn_id}
                        )
                        print(f"[WEBSOCKET] Removed stale connection: {conn_id[:8]}...")
                        cleaned_count += 1
                    except Exception as delete_error:
                        print(f"[WEBSOCKET] Error removing stale connection: {str(delete_error)}")
        
        if cleaned_count > 0:
            print(f"[WEBSOCKET] Cleaned up {cleaned_count} stale connections")
        
        return cleaned_count

    def get_event(self, event_code: str) -> Optional[Dict]:
        """Get an event record from the events table."""
        try:
            events_table = self.dynamodb.Table(EVENTS_TABLE)
            response = events_table.get_item(Key={'aid': event_code})
            if 'Item' in response:
                return response['Item']
            return None
        except ClientError as e:
            print(f"Error getting event: {e}")
            return None

    def _get_full_language_name(self, language_code: str) -> str:
        """Convert two-letter language code to full language name."""
        language_mapping = {
            'EN': 'English',
            'FR': 'French', 
            'SP': 'Spanish',
            'DE': 'German',
            'IT': 'Italian',
            'PT': 'Portuguese',
            'RU': 'Russian',
            'ZH': 'Chinese',
            'JA': 'Japanese',
            'KO': 'Korean',
            'AR': 'Arabic',
            'HI': 'Hindi',
            'TH': 'Thai',
            'VI': 'Vietnamese',
            'NL': 'Dutch',
            'SV': 'Swedish',
            'NO': 'Norwegian',
            'DA': 'Danish',
            'FI': 'Finnish',
            'PL': 'Polish',
            'CZ': 'Czech',
            'HU': 'Hungarian',
            'RO': 'Romanian',
            'BG': 'Bulgarian',
            'HR': 'Croatian',
            'SR': 'Serbian',
            'SK': 'Slovak',
            'SL': 'Slovenian',
            'ET': 'Estonian',
            'LV': 'Latvian',
            'LT': 'Lithuanian',
            'MT': 'Maltese',
            'EL': 'Greek',
            'HE': 'Hebrew',
            'TR': 'Turkish',
            'UK': 'Ukrainian',
            'BE': 'Belarusian',
            'KA': 'Georgian',
            'AM': 'Armenian',
            'AZ': 'Azerbaijani',
            'KK': 'Kazakh',
            'KY': 'Kyrgyz',
            'UZ': 'Uzbek',
            'TG': 'Tajik',
            'TM': 'Turkmen',
            'MN': 'Mongolian',
            'MY': 'Burmese',
            'KM': 'Khmer',
            'LO': 'Lao',
            'NE': 'Nepali',
            'BN': 'Bengali',
            'SI': 'Sinhala',
            'ML': 'Malayalam',
            'TA': 'Tamil',
            'TE': 'Telugu',
            'KN': 'Kannada',
            'GU': 'Gujarati',
            'PA': 'Punjabi',
            'OR': 'Odia',
            'AS': 'Assamese',
            'MR': 'Marathi',
            'SA': 'Sanskrit',
            'SD': 'Sindhi',
            'UR': 'Urdu',
            'FA': 'Persian',
            'PS': 'Pashto',
            'KU': 'Kurdish',
            'SO': 'Somali',
            'SW': 'Swahili',
            'YO': 'Yoruba',
            'IG': 'Igbo',
            'HA': 'Hausa',
            'ZU': 'Zulu',
            'XH': 'Xhosa',
            'AF': 'Afrikaans',
            'IS': 'Icelandic',
            'FO': 'Faroese',
            'GL': 'Galician',
            'EU': 'Basque',
            'CA': 'Catalan',
            'OC': 'Occitan',
            'CO': 'Corsican',
            'BR': 'Breton',
            'CY': 'Welsh',
            'GA': 'Irish',
            'GD': 'Scottish Gaelic',
            'KW': 'Cornish',
            'GV': 'Manx',
            'MT': 'Maltese',
            'SQ': 'Albanian',
            'MK': 'Macedonian',
            'BS': 'Bosnian',
            'ME': 'Montenegrin'
        }
        
        full_name = language_mapping.get(language_code.upper())
        if full_name:
            return full_name
        else:
            print(f"[WARNING] Unknown language code '{language_code}', using code as-is")
            return language_code

    def update_event_embedded_emails(self, event_code: str, sub_event: str, stage: str, language: str, s3_url: str) -> bool:
        """Update the embeddedEmails field in an event record."""
        try:
            print(f"[DEBUG] update_event_embedded_emails called with:")
            print(f"  Event Code: {event_code}")
            print(f"  Sub Event: {sub_event}")
            print(f"  Stage: {stage}")
            print(f"  Language Code: {language}")
            print(f"  S3 URL: {s3_url}")
            print(f"  Events Table: {EVENTS_TABLE}")
            
            # Convert language code to full name
            full_language_name = self._get_full_language_name(language)
            print(f"  Full Language Name: {full_language_name}")
            
            events_table = self.dynamodb.Table(EVENTS_TABLE)
            
            # First, try to get the current event to verify it exists
            print(f"[DEBUG] Checking if event {event_code} exists...")
            current_event = events_table.get_item(Key={'aid': event_code})
            if 'Item' not in current_event:
                print(f"[ERROR] Event {event_code} not found in events table")
                print(f"[ERROR] Available events table: {EVENTS_TABLE}")
                return False
            
            event_data = current_event['Item']
            print(f"[DEBUG] Event {event_code} found, current structure:")
            print(f"  Event data: {event_data}")
            
            # Check if the nested path exists
            sub_events = event_data.get('subEvents', {})
            if sub_event not in sub_events:
                print(f"[DEBUG] Sub event '{sub_event}' not found, creating it")
                # Create the sub event structure
                sub_events[sub_event] = {}
            
            if 'embeddedEmails' not in sub_events[sub_event]:
                print(f"[DEBUG] embeddedEmails not found in sub event, creating it")
                sub_events[sub_event]['embeddedEmails'] = {}
            
            if stage not in sub_events[sub_event]['embeddedEmails']:
                print(f"[DEBUG] Stage '{stage}' not found in embeddedEmails, creating it")
                sub_events[sub_event]['embeddedEmails'][stage] = {}
            
            # Now update the specific language using full language name
            sub_events[sub_event]['embeddedEmails'][stage][full_language_name] = s3_url
            
            print(f"[DEBUG] Updated sub_events structure:")
            print(f"  New sub_events: {sub_events}")
            
            # Update the entire subEvents field
            result = events_table.update_item(
                Key={'aid': event_code},
                UpdateExpression="SET subEvents = :subEvents",
                ExpressionAttributeValues={
                    ":subEvents": sub_events
                },
                ReturnValues='ALL_NEW'
            )
            
            print(f"[DEBUG] Update successful, updated item:")
            print(f"  Updated data: {result.get('Attributes', {})}")
            print(f"[DEBUG] Updated embeddedEmails for {event_code}/{sub_event}/{stage}/{full_language_name}: {s3_url}")
            return True
        except ClientError as e:
            print(f"[ERROR] DynamoDB ClientError updating event embeddedEmails:")
            print(f"  Error Code: {e.response['Error']['Code']}")
            print(f"  Error Message: {e.response['Error']['Message']}")
            print(f"  Event Code: {event_code}")
            print(f"  Sub Event: {sub_event}")
            print(f"  Stage: {stage}")
            print(f"  Language Code: {language}")
            print(f"  Full Language Name: {self._get_full_language_name(language)}")
            print(f"  S3 URL: {s3_url}")
            print(f"  Events Table: {EVENTS_TABLE}")
            return False
        except Exception as e:
            print(f"[ERROR] Unexpected error updating event embeddedEmails:")
            print(f"  Error Type: {type(e).__name__}")
            print(f"  Error Message: {str(e)}")
            print(f"  Event Code: {event_code}")
            print(f"  Sub Event: {sub_event}")
            print(f"  Stage: {stage}")
            print(f"  Language Code: {language}")
            print(f"  Full Language Name: {self._get_full_language_name(language)}")
            print(f"  S3 URL: {s3_url}")
            print(f"  Events Table: {EVENTS_TABLE}")
            return False 