import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# AWS Configuration
AWS_REGION = os.getenv('AWS_REGION', 'us-east-1')
DYNAMODB_TABLE = os.getenv('DYNAMODB_TABLE', 'WORK_ORDERS')
SQS_QUEUE_URL = os.getenv('WORK_ORDER_QUEUE_URL')
WEBSOCKET_API_URL = os.getenv('WEBSOCKET_API_URL')

# Agent Configuration
POLL_INTERVAL = int(os.getenv('POLL_INTERVAL', '5'))  # seconds
STOP_CHECK_INTERVAL = int(os.getenv('STOP_CHECK_INTERVAL', '1'))  # seconds 