import os
import boto3
import logging
from dotenv import load_dotenv
from pathlib import Path
from typing import Optional
from pydantic import BaseModel

# Load environment variables from .env files
env_path = Path('.') / '.env'
if env_path.is_file():
    print(f"Loading environment variables from {env_path.resolve()}")
    load_dotenv(dotenv_path=env_path, override=True)
else:
    print("No .env file found, relying on system environment variables.")

# Configure logging
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Email configuration
EMAIL_HOST = os.getenv('EMAIL_HOST', 'smtp.gmail.com')
EMAIL_PORT = int(os.getenv('EMAIL_PORT', '587'))
# TODO: These will be fetched from DynamoDB based on work order's email account
EMAIL_USERNAME = os.getenv('EMAIL_USERNAME', 'stub-email@gmail.com')
EMAIL_PASSWORD = os.getenv('EMAIL_PASSWORD', 'stub-password')
EMAIL_FROM = os.getenv('EMAIL_FROM', 'noreply@example.com')

# AWS configuration
AWS_REGION = os.getenv('AWS_REGION', 'us-east-1')
AWS_PROFILE = os.getenv('AWS_PROFILE', 'default')

# Get AWS credentials - try profile first, then fall back to IAM role
try:
    session = boto3.Session(profile_name=AWS_PROFILE)
    credentials = session.get_credentials()
    if credentials:
        AWS_ACCESS_KEY_ID = credentials.access_key
        AWS_SECRET_ACCESS_KEY = credentials.secret_key
    else:
        # No credentials in profile, will use IAM role or environment variables
        AWS_ACCESS_KEY_ID = os.getenv('AWS_ACCESS_KEY_ID')
        AWS_SECRET_ACCESS_KEY = os.getenv('AWS_SECRET_ACCESS_KEY')
except Exception as e:
    print(f"Warning: Could not load AWS credentials from profile '{AWS_PROFILE}': {e}")
    print("Falling back to IAM role or environment variables")
    AWS_ACCESS_KEY_ID = os.getenv('AWS_ACCESS_KEY_ID')
    AWS_SECRET_ACCESS_KEY = os.getenv('AWS_SECRET_ACCESS_KEY')

# DynamoDB configuration
DYNAMODB_TABLE = os.getenv('DYNAMODB_TABLE', 'email-work-orders')
WORK_ORDERS_TABLE = os.getenv('WORK_ORDERS_TABLE')
CONNECTIONS_TABLE = os.getenv('CONNECTIONS_TABLE')
EVENTS_TABLE = os.getenv('EVENTS_TABLE', 'events')
STUDENT_TABLE = os.getenv('STUDENT_TABLE', 'students')
POOLS_TABLE = os.getenv('POOLS_TABLE', 'pools')
PROMPTS_TABLE = os.getenv('PROMPTS_TABLE', 'prompts')
EMAIL_ACCOUNT_CREDENTIALS_TABLE = os.getenv('EMAIL_ACCOUNT_CREDENTIALS_TABLE', 'email-account-credentials')

# SQS configuration
SQS_QUEUE_URL = os.getenv('SQS_QUEUE_URL')

# WebSocket configuration
WEBSOCKET_API_URL = os.getenv('WEBSOCKET_API_URL')

# S3 configuration
S3_BUCKET = os.getenv('S3_BUCKET')

# Mailchimp configuration
MAILCHIMP_API_KEY = os.getenv('MAILCHIMP_API_KEY')
MAILCHIMP_AUDIENCE = os.getenv('MAILCHIMP_AUDIENCE')
MAILCHIMP_REPLY_TO = os.getenv('MAILCHIMP_REPLY_TO')
MAILCHIMP_SERVER_PREFIX = os.getenv('MAILCHIMP_SERVER_PREFIX')

# SMTP configuration
SMTP_SERVER = os.getenv('SMTP_SERVER')
SMTP_PORT = int(os.getenv('SMTP_PORT', '587'))
DEFAULT_PREVIEW = os.getenv('DEFAULT_PREVIEW')
DEFAULT_FROM_NAME = os.getenv('DEFAULT_FROM_NAME')

# Email sending configuration
EMAIL_BURST_SIZE = int(os.getenv('EMAIL_BURST_SIZE', '10'))
EMAIL_RECOVERY_SLEEP_SECS = int(os.getenv('EMAIL_RECOVERY_SLEEP_SECS', '60'))
EMAIL_CONTINUOUS_SLEEP_SECS = int(os.getenv('EMAIL_CONTINUOUS_SLEEP_SECS', '3600'))

# Email templates configuration
TEMPLATES_DIR = os.getenv('TEMPLATES_DIR', str(Path(__file__).parent / 'templates'))

# Required environment variables
REQUIRED_ENV_VARS = [
    'AWS_PROFILE',
    'SQS_QUEUE_URL',
    'WEBSOCKET_API_URL',
    'WORK_ORDERS_TABLE',
    'CONNECTIONS_TABLE',
    'S3_BUCKET',
    'MAILCHIMP_API_KEY',
    'MAILCHIMP_AUDIENCE',
    'MAILCHIMP_REPLY_TO',
    'MAILCHIMP_SERVER_PREFIX',
    'SMTP_SERVER',
    'SMTP_PORT',
    'DEFAULT_PREVIEW',
    'DEFAULT_FROM_NAME',
    'EMAIL_ACCOUNT_CREDENTIALS_TABLE',
    'PROMPTS_TABLE'
]

def validate_config():
    """Validate that all required environment variables are set"""
    missing_vars = [var for var in REQUIRED_ENV_VARS if not os.getenv(var)]
    if missing_vars:
        raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")
    
    # Validate AWS credentials - be more flexible for IAM roles
    if not AWS_ACCESS_KEY_ID or not AWS_SECRET_ACCESS_KEY:
        print(f"Warning: AWS credentials not found in profile '{AWS_PROFILE}' or environment variables.")
        print("This is expected when using IAM roles on EC2 instances.")
        print("AWS SDK will automatically use instance metadata service for credentials.")
        # Don't raise an error here - let boto3 handle credential resolution

# Validate configuration on import
validate_config()

# Agent Configuration
POLL_INTERVAL = int(os.getenv('POLL_INTERVAL', '5'))  # seconds
STOP_CHECK_INTERVAL = int(os.getenv('STOP_CHECK_INTERVAL', '1'))  # seconds

# Mailchimp Configuration
MAILCHIMP_API_KEY = os.getenv('MAILCHIMP_API_KEY')
MAILCHIMP_AUDIENCE = os.getenv('MAILCHIMP_AUDIENCE')
MAILCHIMP_REPLY_TO = os.getenv('MAILCHIMP_REPLY_TO')
MAILCHIMP_SERVER_PREFIX = os.getenv('MAILCHIMP_SERVER_PREFIX')

# Validate required environment variables
required_vars = [
    # AWS Configuration
    'WORK_ORDERS_TABLE',
    'CONNECTIONS_TABLE',
    'SQS_QUEUE_URL',
    'WEBSOCKET_API_URL',
    'S3_BUCKET',
    # Mailchimp Configuration
    'MAILCHIMP_API_KEY',
    'MAILCHIMP_AUDIENCE',
    'MAILCHIMP_REPLY_TO',
    'MAILCHIMP_SERVER_PREFIX'
]

missing_vars = [var for var in required_vars if not os.getenv(var)]
if missing_vars:
    raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")

class AppConfig(BaseModel):
    """
    Pydantic model for application configuration.
    Loads settings from environment variables.
    """
    aws_region: str = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    work_orders_table: str = os.environ.get("WORK_ORDERS_TABLE")
    sqs_queue_url: str = os.environ.get("SQS_QUEUE_URL")
    websocket_api_url: Optional[str] = os.environ.get("WEBSOCKET_API_URL")
    connections_table: str = os.environ.get("CONNECTIONS_TABLE")
    events_table: str = os.environ.get("EVENTS_TABLE", "events")
    openai_api_key: Optional[str] = os.environ.get("OPENAI_API_KEY")

    class Config:
        # Pydantic will treat these as case-insensitive
        case_sensitive = False

# Create a single config instance to be used throughout the application.
config = AppConfig()

# Validate that required variables are loaded.
required_attributes = ['work_orders_table', 'sqs_queue_url', 'connections_table']
missing_vars = [attr for attr in required_attributes if not getattr(config, attr)]

if missing_vars:
    # We report the uppercase version of the attribute name to match the .env file convention.
    missing_env_vars = [v.upper() for v in missing_vars]
    raise ValueError(f"Missing required environment variables: {', '.join(missing_env_vars)}")

print("Configuration loaded successfully:")
print(f"  - SQS Queue URL: {'*' * 10 if config.sqs_queue_url else 'Not set'}")
print(f"  - Work Orders Table: {config.work_orders_table}")
print(f"  - Connections Table: {config.connections_table}")

# You can now import 'config' from this module in other parts of the application.
# from src.config import config
#
# DYNAMODB_TABLE = config.dynamodb_table_name
# SQS_QUEUE_URL = config.sqs_queue_url

# ... existing code ... 