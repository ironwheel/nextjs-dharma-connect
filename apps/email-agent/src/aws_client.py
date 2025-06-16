import boto3
from botocore.exceptions import ClientError
from datetime import datetime
from typing import Dict, List, Optional
import os

from .config import AWS_REGION, DYNAMODB_TABLE, SQS_QUEUE_URL, WEBSOCKET_API_URL
from .models import WorkOrder, WorkOrderUpdate

SQS_QUEUE_URL = os.getenv('WORK_ORDER_QUEUE_URL')

class AWSClient:
    def __init__(self):
        self.dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
        self.sqs = boto3.client('sqs', region_name=AWS_REGION)
        self.apigateway = boto3.client('apigateway', region_name=AWS_REGION)
        self.table = self.dynamodb.Table(DYNAMODB_TABLE)

    def get_work_order(self, id: str) -> Optional[WorkOrder]:
        try:
            response = self.table.get_item(Key={'id': id})
            if 'Item' in response:
                return WorkOrder(**response['Item'])
            return None
        except ClientError as e:
            print(f"Error getting work order: {e}")
            return None

    def update_work_order(self, update: dict) -> bool:
        try:
            expr_attr_values = {}
            expr_attr_names = {}
            update_expression = []
            for key, value in update['updates'].items():
                if key == 'id':
                    continue
                # Convert steps to dicts if needed
                if key == 'steps' and isinstance(value, list):
                    value = [step.dict() if hasattr(step, 'dict') else step for step in value]
                expr_attr_names[f'#{key}'] = key
                expr_attr_values[f':{key}'] = value
                update_expression.append(f'#{key} = :{key}')
            expr_attr_names['#updatedAt'] = 'updatedAt'
            expr_attr_values[':updatedAt'] = datetime.utcnow().isoformat()
            update_expression.append('#updatedAt = :updatedAt')
            self.table.update_item(
                Key={'id': update['id']},
                UpdateExpression='SET ' + ', '.join(update_expression),
                ExpressionAttributeValues=expr_attr_values,
                ExpressionAttributeNames=expr_attr_names,
                ConditionExpression="attribute_exists(id)"
            )
            return True
        except Exception as e:
            print(f"Error updating work order: {e}")
            return False

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
                    ":locked": False,
                    ":lockedBy": None,
                    ":updatedAt": datetime.utcnow().isoformat()
                }
            )
            return True
        except ClientError as e:
            print(f"Error unlocking work order: {e}")
            return False

    def send_websocket_message(self, connection_id: str, message: Dict) -> bool:
        try:
            self.apigateway.post_to_connection(
                Data=json.dumps(message),
                ConnectionId=connection_id
            )
            return True
        except ClientError as e:
            print(f"Error sending websocket message: {e}")
            return False

    def receive_sqs_messages(self, max_messages: int = 1) -> List[Dict]:
        try:
            response = self.sqs.receive_message(
                QueueUrl=SQS_QUEUE_URL,
                MaxNumberOfMessages=max_messages,
                WaitTimeSeconds=20  # Long polling
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