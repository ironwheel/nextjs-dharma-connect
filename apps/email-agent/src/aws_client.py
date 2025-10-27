import boto3
from botocore.exceptions import ClientError
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional
import os
import json
import time

from .config import (
    STUDENT_TABLE, POOLS_TABLE, PROMPTS_TABLE, EVENTS_TABLE, 
    EMAIL_BURST_SIZE, EMAIL_RECOVERY_SLEEP_SECS, DRYRUN_RECIPIENTS_TABLE, SEND_RECIPIENTS_TABLE,
    config
)
from .models import WorkOrder, WorkOrderUpdate

# Use settings from the centralized config object
DYNAMODB_TABLE = config.work_orders_table
SQS_QUEUE_URL = config.sqs_queue_url
WEBSOCKET_API_URL = config.websocket_api_url
CONNECTIONS_TABLE = config.connections_table
EVENTS_TABLE = config.events_table

# Import table names from config
STAGES_TABLE = os.getenv('DYNAMODB_TABLE_STAGES', 'stages')

# Cache configuration
CACHE_REFRESH_INTERVAL_SECS = int(os.getenv('CACHE_REFRESH_INTERVAL_SECS', '600'))  # 10 minutes default

class TableCacheManager:
    """Manages caching for DynamoDB table scans to reduce redundant full table scans."""
    
    def __init__(self, logging_config=None):
        self.cache = {}  # table_name -> {'data': [...], 'last_refresh': timestamp}
        self.last_sqs_invalidation = 0
        self.last_sleeping_refresh = time.time()  # Initialize to now to avoid huge interval on first use
        self.logging_config = logging_config
    
    def log(self, level, message):
        """Log a message if the level is enabled."""
        if self.logging_config:
            self.logging_config.log(level, message)
        else:
            # Fallback to always logging if no config provided
            print(message)
    
    def invalidate_all_caches(self, reason: str):
        """Invalidate all table caches."""
        self.cache.clear()
        self.last_sqs_invalidation = time.time()
        self.log('debug', f"[CACHE] Invalidated all caches: {reason}")
    
    def should_refresh_cache(self, table_name: str, has_sleeping_work_orders: bool) -> bool:
        """
        Determine if cache should be refreshed based on invalidation rules.
        
        Args:
            table_name: Name of the table being accessed
            has_sleeping_work_orders: Whether there are currently sleeping work orders
            
        Returns:
            True if cache should be refreshed, False otherwise
        """
        current_time = time.time()
        
        # If no cache exists for this table, always refresh
        if table_name not in self.cache:
            print(f"[CACHE] No cache exists for {table_name}, will refresh (no cache entry)")
            return True
        
        # If there are sleeping work orders, refresh every CACHE_REFRESH_INTERVAL_SECS
        if has_sleeping_work_orders:
            time_since_refresh = current_time - self.last_sleeping_refresh
            if time_since_refresh >= CACHE_REFRESH_INTERVAL_SECS:
                print(f"[CACHE] Sleeping work orders detected, cache refresh interval reached ({time_since_refresh:.1f}s >= {CACHE_REFRESH_INTERVAL_SECS}s) for {table_name}")
                self.last_sleeping_refresh = current_time
                return True
            else:
                print(f"[CACHE] Using cached data for {table_name} (sleeping work orders, {time_since_refresh:.1f}s < {CACHE_REFRESH_INTERVAL_SECS}s)")
                return False
        
        # If no sleeping work orders, refresh on every call (immediate invalidation)
        if not has_sleeping_work_orders:
            print(f"[CACHE] No sleeping work orders, refreshing cache for {table_name} (immediate invalidation)")
            return True
        
        return False
    
    def get_cached_data(self, table_name: str) -> Optional[List[Dict]]:
        """Get cached data for a table if it exists and is valid."""
        if table_name in self.cache:
            print(f"[CACHE] Returning cached data for {table_name} ({len(self.cache[table_name]['data'])} items)")
            return self.cache[table_name]['data']
        print(f"[CACHE] No cached data for {table_name}")
        return None
    
    def set_cached_data(self, table_name: str, data: List[Dict]):
        """Set cached data for a table."""
        self.cache[table_name] = {
            'data': data,
            'last_refresh': time.time()
        }
        print(f"[CACHE] Cached {len(data)} items for table {table_name}")
        self.log('debug', f"[CACHE] Cached {len(data)} items for table {table_name}")

class AWSClient:
    def __init__(self, logging_config=None):
        self.dynamodb = boto3.resource('dynamodb', region_name=config.aws_region)
        self.sqs = boto3.client('sqs', region_name=config.aws_region)
        self.logging_config = logging_config
        self.cache_manager = TableCacheManager(logging_config)
        
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

    def log(self, level, message):
        """Log a message if the level is enabled."""
        if self.logging_config:
            self.logging_config.log(level, message)
        else:
            # Fallback to always logging if no config provided
            print(message)

    def invalidate_cache_on_sqs_start(self):
        """Invalidate all caches when an SQS start message is received."""
        self.cache_manager.invalidate_all_caches("SQS start message received")

    def has_sleeping_work_orders(self) -> bool:
        """Check if there are any sleeping work orders."""
        try:
            response = self.table.scan(
                FilterExpression='#state = :sleeping',
                ExpressionAttributeNames={'#state': 'state'},
                ExpressionAttributeValues={':sleeping': 'Sleeping'},
            )
            sleeping_items = response.get('Items', [])
            sleeping_ids = [item.get('id', 'unknown') for item in sleeping_items]
            print(f"[CACHE-DEBUG] has_sleeping_work_orders: found {len(sleeping_items)} sleeping work orders: {sleeping_ids}")
            return len(sleeping_items) > 0
        except Exception as e:
            print(f"[CACHE-DEBUG] Error checking for sleeping work orders: {e}")
            self.log('debug', f"[CACHE] Error checking for sleeping work orders: {e}")
            return False

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
                        
                        self.log('debug', f"[DEBUG] Current locked status from DynamoDB: locked={locked}, lockedBy={locked_by}")
                except Exception as e:
                    self.log('debug', f"[DEBUG] Error getting current locked status: {e}")
                
                self.log('debug', f"[DEBUG] Sending WebSocket update for work order {update['id']}")
                self.log('debug', f"[DEBUG] Work order data: {work_order_data}")
                self.log('debug', f"[DEBUG] Steps data: {work_order_data.get('steps', [])}")
                self.log('debug', f"[DEBUG] Locked status in WebSocket update: {work_order_data.get('locked')}, lockedBy: {work_order_data.get('lockedBy')}")
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
                elif hasattr(obj, 'isoformat'):  # Handle datetime objects
                    return obj.isoformat()
                else:
                    return obj

            # Convert the message
            message = convert_enums(message)

            # Send to all connections
            for item in response['Items']:
                connection_id = item['connectionId']
                try:
                    self.apigateway.post_to_connection(
                        Data=json.dumps(message),
                        ConnectionId=connection_id
                    )
                except Exception as e:
                    # If connection is gone, remove it from DynamoDB
                    if isinstance(e, self.apigateway.exceptions.GoneException):
                        try:
                            self.dynamodb.Table(CONNECTIONS_TABLE).delete_item(
                                Key={'connectionId': connection_id}
                            )
                            print(f"[WEBSOCKET] Removed stale connection: {connection_id[:8]}...")
                        except Exception as delete_error:
                            print(f"[WEBSOCKET] Error removing stale connection: {str(delete_error)}")
                    else:
                        print(f"[WEBSOCKET] Error sending message to connection {connection_id[:8]}...: {str(e)}")

        except Exception as e:
            print(f"[WEBSOCKET] Error in _send_websocket_update: {str(e)}")

    def lock_work_order(self, id: str, agent_id: str) -> bool:
        """Lock a work order for processing by this agent."""
        try:
            # Try to update the work order with a lock
            self.table.update_item(
                Key={'id': id},
                UpdateExpression='SET locked = :locked, lockedBy = :lockedBy',
                ConditionExpression='attribute_not_exists(locked) OR locked = :false',
                ExpressionAttributeValues={
                    ':locked': True,
                    ':lockedBy': agent_id,
                    ':false': False
                }
            )
            return True
        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                # Work order is already locked
                return False
            else:
                print(f"Error locking work order: {e}")
                return False

    def unlock_work_order(self, id: str) -> bool:
        """Unlock a work order."""
        try:
            self.table.update_item(
                Key={'id': id},
                UpdateExpression='SET locked = :locked, lockedBy = :empty',
                ExpressionAttributeValues={
                    ':locked': False,
                    ':empty': ""
                }
            )
            return True
        except ClientError as e:
            print(f"Error unlocking work order: {e}")
            return False

    def receive_sqs_messages(self, max_messages: int = 1) -> List[Dict]:
        """Receive messages from SQS queue."""
        try:
            response = self.sqs.receive_message(
                QueueUrl=SQS_QUEUE_URL,
                MaxNumberOfMessages=max_messages,
                WaitTimeSeconds=1
            )
            return response.get('Messages', [])
        except ClientError as e:
            print(f"Error receiving SQS messages: {e}")
            return []

    def delete_sqs_message(self, receipt_handle: str) -> bool:
        """Delete a message from SQS queue."""
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
        """Unlock all work orders that are currently locked."""
        try:
            # Scan for locked work orders
            response = self.table.scan(
                FilterExpression='locked = :true',
                ExpressionAttributeValues={':true': True}
            )
            
            unlocked_count = 0
            for item in response.get('Items', []):
                try:
                    self.table.update_item(
                        Key={'id': item['id']},
                        UpdateExpression='SET locked = :false, lockedBy = :empty',
                        ExpressionAttributeValues={
                            ':false': False,
                            ':empty': ""
                        }
                    )
                    unlocked_count += 1
                except Exception as e:
                    print(f"Error unlocking work order {item['id']}: {e}")
            
            return unlocked_count
        except Exception as e:
            print(f"Error unlocking all work orders: {e}")
            return 0

    def scan_table(self, table_name: str) -> List[Dict]:
        """
        Scan an entire DynamoDB table and return all items.
        Now includes caching to reduce redundant scans, except for the work order table which is never cached.
        """
        try:
            print(f"[CACHE-DEBUG] scan_table({table_name}) called")
            # Never cache the work order table
            work_order_table_names = {self.table.name, getattr(config, 'work_orders_table', None)}
            if table_name in work_order_table_names:
                print(f"[CACHE] Work order table '{table_name}' detected, always performing fresh scan (never cached).")
                table = self.dynamodb.Table(table_name)
                items = []
                last_evaluated_key = None
                while True:
                    if last_evaluated_key:
                        response = table.scan(ExclusiveStartKey=last_evaluated_key)
                    else:
                        response = table.scan()
                    items.extend(response.get('Items', []))
                    last_evaluated_key = response.get('LastEvaluatedKey')
                    if not last_evaluated_key:
                        break
                print(f"[CACHE] Fresh scan complete for work order table {table_name}, {len(items)} items loaded.")
                return items
            # For all other tables, use cache logic
            has_sleeping_work_orders = self.has_sleeping_work_orders()
            if self.cache_manager.should_refresh_cache(table_name, has_sleeping_work_orders):
                print(f"[CACHE] Performing fresh scan of table: {table_name}")
                table = self.dynamodb.Table(table_name)
                items = []
                last_evaluated_key = None
                while True:
                    if last_evaluated_key:
                        response = table.scan(ExclusiveStartKey=last_evaluated_key)
                    else:
                        response = table.scan()
                    items.extend(response.get('Items', []))
                    last_evaluated_key = response.get('LastEvaluatedKey')
                    if not last_evaluated_key:
                        break
                self.cache_manager.set_cached_data(table_name, items)
                print(f"[CACHE] Fresh scan complete for {table_name}, {len(items)} items loaded and cached.")
            else:
                print(f"[CACHE] scan_table({table_name}) filled from cache, {len(self.cache_manager.get_cached_data(table_name))} items.")
                items = self.cache_manager.get_cached_data(table_name)
                if items is None:
                    print(f"[CACHE] No cached data for {table_name}, falling back to fresh scan.")
                    return self.scan_table(table_name)
                print(f"[CACHE] Using cached data for {table_name}: {len(items)} items")
            return items
        except Exception as e:
            print(f"[CACHE-DEBUG] Error in scan_table({table_name}): {e}")
            self.log('debug', f"[CACHE] Error scanning table {table_name}: {str(e)}")
            raise Exception(f"Failed to scan table {table_name}: {str(e)}")

    def get_active_websocket_connections(self) -> List[str]:
        """Get all active WebSocket connection IDs."""
        try:
            response = self.dynamodb.Table(CONNECTIONS_TABLE).scan(
                ProjectionExpression='connectionId'
            )
            return [item['connectionId'] for item in response.get('Items', [])]
        except Exception as e:
            self.log('debug', f"[DEBUG] Error getting WebSocket connections: {str(e)}")
            return []

    def display_websocket_connections(self):
        """Display active WebSocket connections in a formatted way."""
        connections = self.get_active_websocket_connections()
        if connections:
            self.log('websocket', f"\n[WEBSOCKET] Active connections ({len(connections)}):")
            for i, conn_id in enumerate(connections, 1):
                # Truncate the connection ID for cleaner display
                short_id = conn_id[:8] + "..." if len(conn_id) > 8 else conn_id
                self.log('websocket', f"[WEBSOCKET]   {i}. {short_id}")
        else:
            self.log('websocket', "\n[WEBSOCKET] No active connections")
        self.log('websocket', "")  # Add spacing

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

    def get_student(self, student_id: str) -> Optional[Dict]:
        """Get a student record from the student table."""
        try:
            student_table = self.dynamodb.Table(STUDENT_TABLE)
            response = student_table.get_item(Key={'id': student_id})
            if 'Item' in response:
                return response['Item']
            return None
        except ClientError as e:
            print(f"Error getting student: {e}")
            return None

    def get_s3_object_content(self, s3_url: str) -> Optional[str]:
        """Get the content of an S3 object from its URL."""
        try:
            # Parse S3 URL to get bucket and key
            # URL format: https://bucket-name.s3.amazonaws.com/key
            if not s3_url.startswith('https://'):
                raise ValueError("Invalid S3 URL format")
            
            # Remove https:// prefix
            url_parts = s3_url[8:].split('/')
            if len(url_parts) < 3:
                raise ValueError("Invalid S3 URL format")
            
            bucket_name = url_parts[0].split('.')[0]  # Remove .s3.amazonaws.com
            key = '/'.join(url_parts[1:])
            
            # Get S3 object
            s3 = boto3.client('s3', region_name=config.aws_region)
            response = s3.get_object(Bucket=bucket_name, Key=key)
            
            # Read content as string
            content = response['Body'].read().decode('utf-8')
            return content
            
        except Exception as e:
            print(f"Error getting S3 object content: {e}")
            return None

    def update_student_emails(self, student_id: str, emails: Dict) -> bool:
        """Update the emails field of a student record."""
        try:
            student_table = self.dynamodb.Table(STUDENT_TABLE)
            student_table.update_item(
                Key={'id': student_id},
                UpdateExpression='SET #emails = :emails',
                ExpressionAttributeNames={'#emails': 'emails'},
                ExpressionAttributeValues={':emails': emails}
            )
            return True
        except ClientError as e:
            print(f"Error updating student emails: {e}")
            return False

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
            'CS': 'Czech',
            'SV': 'Swedish',
            'NO': 'Norwegian',
            'DA': 'Danish',
            'FI': 'Finnish',
            'PL': 'Polish',
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
            'UK': 'Ukrainian'
        }
        return language_mapping.get(language_code.upper(), language_code)

    def update_event_embedded_emails(self, event_code: str, sub_event: str, stage: str, language: str, s3_url: str) -> bool:
        """Update the embeddedEmails field in the events table."""
        try:
            events_table = self.dynamodb.Table(EVENTS_TABLE)
            
            # Get the current event record
            response = events_table.get_item(Key={'aid': event_code})
            if 'Item' not in response:
                print(f"Event {event_code} not found")
                return False
            
            event = response['Item']
            
            # Initialize embeddedEmails if it doesn't exist
            if 'embeddedEmails' not in event:
                event['embeddedEmails'] = {}
            
            # Initialize sub-event if it doesn't exist
            if sub_event not in event['embeddedEmails']:
                event['embeddedEmails'][sub_event] = {}
            
            # Initialize stage if it doesn't exist
            if stage not in event['embeddedEmails'][sub_event]:
                event['embeddedEmails'][sub_event][stage] = {}
            
            # Update the language entry
            event['embeddedEmails'][sub_event][stage][language] = s3_url
            
            # Update the event record
            events_table.put_item(Item=event)
            
            return True
        except Exception as e:
            print(f"Error updating event embedded emails: {e}")
            return False

    def check_for_stop_messages(self, work_order_id: str) -> bool:
        """Check for stop messages in SQS for a specific work order."""
        try:
            # Receive messages without deleting them
            response = self.sqs.receive_message(
                QueueUrl=SQS_QUEUE_URL,
                MaxNumberOfMessages=10,
                WaitTimeSeconds=0  # Non-blocking
            )
            
            messages = response.get('Messages', [])
            for message in messages:
                try:
                    body = json.loads(message['Body'])
                    if (body.get('workOrderId') == work_order_id and 
                        body.get('action') == 'stop'):
                        return True
                except (json.JSONDecodeError, KeyError):
                    continue
            
            return False
        except Exception as e:
            print(f"Error checking for stop messages: {e}")
            return False

    def get_table_name(self, table_key: str) -> str:
        """Get the actual table name from the table key."""
        table_mapping = {
            'stages': STAGES_TABLE,
            'students': STUDENT_TABLE,
            'pools': POOLS_TABLE,
            'prompts': PROMPTS_TABLE,
            'events': EVENTS_TABLE
        }
        return table_mapping.get(table_key, table_key)

    def get_item(self, table_name: str, key: Dict) -> Optional[Dict]:
        """Get a single item from a DynamoDB table."""
        try:
            table = self.dynamodb.Table(table_name)
            response = table.get_item(Key=key)
            if 'Item' in response:
                return response['Item']
            return None
        except ClientError as e:
            print(f"Error getting item from {table_name}: {e}")
            return None

    def delete_dryrun_recipients(self, campaign_string: str):
        """Delete existing dry run recipient records for a campaign string before beginning a new dry run."""
        try:
            table = self.dynamodb.Table(DRYRUN_RECIPIENTS_TABLE)
            
            # Check if record exists
            response = table.get_item(Key={'campaignString': campaign_string})
            if 'Item' in response:
                # Record exists, delete it
                table.delete_item(Key={'campaignString': campaign_string})
                print(f"Deleted existing dry run recipient record for campaign: {campaign_string}")
            else:
                # No existing record to delete
                print(f"No existing dry run recipient record found for campaign: {campaign_string}")
        except Exception as e:
            print(f"Error deleting dry run recipient records for campaign {campaign_string}: {e}")

    def append_dryrun_recipient(self, campaign_string: str, entry: dict):
        """Append a recipient to the dryrun_recipients table."""
        try:
            table = self.dynamodb.Table(DRYRUN_RECIPIENTS_TABLE)
            
            # Try to get existing record
            try:
                response = table.get_item(Key={'campaignString': campaign_string})
                if 'Item' in response:
                    # Record exists, append to entries array
                    existing_item = response['Item']
                    entries = existing_item.get('entries', [])
                    entries.append(entry)
                    table.update_item(
                        Key={'campaignString': campaign_string},
                        UpdateExpression='SET entries = :entries',
                        ExpressionAttributeValues={':entries': entries}
                    )
                else:
                    # Record doesn't exist, create new record with entries array
                    table.put_item(Item={
                        'campaignString': campaign_string,
                        'entries': [entry]
                    })
            except ClientError as e:
                if e.response['Error']['Code'] == 'ValidationException':
                    # Table might not exist or have different schema, fall back to old format
                    table.put_item(Item={
                        'campaignString': campaign_string,
                        'recipient': entry,
                        'timestamp': datetime.utcnow().isoformat()
                    })
                else:
                    raise
        except Exception as e:
            print(f"Error appending dryrun recipient: {e}")

    def append_send_recipient(self, campaign_string: str, entry: dict, account: str = None):
        """Append a recipient to the send_recipients table."""
        try:
            table = self.dynamodb.Table(SEND_RECIPIENTS_TABLE)
            
            # Add account to entry if provided
            if account:
                entry['account'] = account
            
            # Try to get existing record
            try:
                response = table.get_item(Key={'campaignString': campaign_string})
                if 'Item' in response:
                    # Record exists, append to entries array
                    existing_item = response['Item']
                    entries = existing_item.get('entries', [])
                    entries.append(entry)
                    table.update_item(
                        Key={'campaignString': campaign_string},
                        UpdateExpression='SET entries = :entries',
                        ExpressionAttributeValues={':entries': entries}
                    )
                else:
                    # Record doesn't exist, create new record with entries array
                    table.put_item(Item={
                        'campaignString': campaign_string,
                        'entries': [entry]
                    })
            except ClientError as e:
                if e.response['Error']['Code'] == 'ValidationException':
                    # Table might not exist or have different schema, fall back to old format
                    table.put_item(Item={
                        'campaignString': campaign_string,
                        'recipient': entry,
                        'timestamp': datetime.utcnow().isoformat()
                    })
                else:
                    raise
        except Exception as e:
            print(f"Error appending send recipient: {e}")
    
    def count_emails_sent_by_account_in_last_24_hours(self, account: str) -> int:
        """
        Count the number of emails sent by a specific account in the last 24 hours.
        
        Args:
            account: The account name (e.g., 'connect', 'vajrayana')
            
        Returns:
            int: Number of emails sent by this account in the last 24 hours
        """
        try:
            table = self.dynamodb.Table(SEND_RECIPIENTS_TABLE)
            
            # Calculate the timestamp 24 hours ago
            twenty_four_hours_ago = datetime.now(timezone.utc) - timedelta(hours=24)
            twenty_four_hours_ago_iso = twenty_four_hours_ago.isoformat()
            
            # Scan the table for all campaign strings
            count = 0
            last_evaluated_key = None
            
            while True:
                if last_evaluated_key:
                    response = table.scan(ExclusiveStartKey=last_evaluated_key)
                else:
                    response = table.scan()
                
                items = response.get('Items', [])
                
                # For each campaign string, check entries for matching account and timestamp
                for item in items:
                    entries = item.get('entries', [])
                    for entry in entries:
                        # Check if this entry is for the target account
                        entry_account = entry.get('account')
                        if entry_account != account:
                            continue
                        
                        # Check if the sendtime is within the last 24 hours
                        sendtime_str = entry.get('sendtime')
                        if sendtime_str:
                            try:
                                sendtime = datetime.fromisoformat(sendtime_str.replace('Z', '+00:00'))
                                if sendtime >= twenty_four_hours_ago:
                                    count += 1
                            except Exception as e:
                                print(f"[WARNING] Failed to parse sendtime '{sendtime_str}': {e}")
                
                last_evaluated_key = response.get('LastEvaluatedKey')
                if not last_evaluated_key:
                    break
            
            return count
            
        except Exception as e:
            print(f"[ERROR] Failed to count emails for account '{account}': {e}")
            # Return 0 to be safe - don't block sends if we can't check the limit
            return 0 