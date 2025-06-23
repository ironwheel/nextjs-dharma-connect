# Email Agent

A Python-based email processing agent that handles work orders through email communication.

## Setup

1. Create a `.env` file in the `apps/email-agent` directory with the following variables:

```env
# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
# Note: Email credentials are currently stubbed and will be fetched from DynamoDB
# based on the work order's email account in a future update
EMAIL_FROM=noreply@example.com

# AWS Configuration
AWS_REGION=us-east-1
AWS_PROFILE=your-aws-profile-name  # e.g., 'default' or 'production'

# DynamoDB Configuration
DYNAMODB_TABLE=email-work-orders
WORK_ORDERS_TABLE=your-work-orders-table-name
CONNECTIONS_TABLE=your-connections-table-name

# SQS Configuration
SQS_QUEUE_URL=your-sqs-queue-url

# WebSocket Configuration
WEBSOCKET_API_URL=your-websocket-api-url  # e.g., wss://api-id.execute-api.region.amazonaws.com/stage

# S3 Configuration
S3_BUCKET=your-s3-bucket-name  # e.g., your-email-templates-bucket

# Mailchimp Configuration
MAILCHIMP_API_KEY=your-mailchimp-api-key  # e.g., d795281f186c40dc4b876a99d45122fe-us18
MAILCHIMP_AUDIENCE=your-audience-name     # The name of your Mailchimp audience/list
MAILCHIMP_REPLY_TO=connect@sakyonglineage.org  # Reply-to email address for Mailchimp templates
MAILCHIMP_SERVER_PREFIX=us18  # The server prefix for your Mailchimp account (e.g., us18)

# Logging Configuration
LOG_LEVEL=INFO

# Email Templates Configuration
TEMPLATES_DIR=src/templates
```

2. Configure AWS credentials:
   - Ensure you have AWS credentials configured in `~/.aws/credentials`
   - The profile specified in `AWS_PROFILE` must exist and have valid credentials
   - Example AWS credentials file:
     ```ini
     [default]
     aws_access_key_id = YOUR_ACCESS_KEY
     aws_secret_access_key = YOUR_SECRET_KEY
     ```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Run the agent:
```bash
python src/main.py
```

## Required Environment Variables

The following environment variables are required:

- `AWS_PROFILE`: Name of the AWS profile to use for credentials
- `SQS_QUEUE_URL`: URL of the SQS queue for work orders
- `WEBSOCKET_API_URL`: URL of the WebSocket API for real-time updates
- `WORK_ORDERS_TABLE`: Name of the DynamoDB table for work orders
- `CONNECTIONS_TABLE`: Name of the DynamoDB table for WebSocket connections
- `S3_BUCKET`: Name of the S3 bucket for storing email templates
- `MAILCHIMP_API_KEY`: Your Mailchimp API key
- `MAILCHIMP_AUDIENCE`: The name of your Mailchimp audience/list
- `MAILCHIMP_REPLY_TO`: Reply-to email address for Mailchimp templates
- `MAILCHIMP_SERVER_PREFIX`: The server prefix for your Mailchimp account

Optional environment variables with defaults:

- `EMAIL_HOST`: SMTP host (default: smtp.gmail.com)
- `EMAIL_PORT`: SMTP port (default: 587)
- `EMAIL_FROM`: From email address (default: noreply@example.com)
- `AWS_REGION`: AWS region (default: us-east-1)
- `DYNAMODB_TABLE`: DynamoDB table name (default: email-work-orders)
- `LOG_LEVEL`: Logging level (default: INFO)
- `TEMPLATES_DIR`: Directory containing email templates (default: src/templates)

Note: Email credentials (username and password) are currently stubbed with default values. In a future update, these will be fetched from DynamoDB based on the work order's email account.

## Features

- Email-based work order processing
- Integration with AWS DynamoDB for work order storage
- Integration with AWS SQS for work order queue management
- Real-time updates via WebSocket API
- Support for multiple email templates
- Configurable logging
- Support for both in-person and virtual events
- Optimistic UI updates for immediate user feedback

## Architecture

The email agent is part of a real-time communication system using WebSockets and SQS for work order processing:

```mermaid
graph TD
    EM["Email Manager<br/>(Next.js Frontend)"]
    EA["Email Agent<br/>(Python Service)"]
    WS["API Gateway<br/>WebSocket API"]
    SQS["SQS FIFO Queue<br/>work-order-queue.fifo"]
    DDB["DynamoDB Tables<br/>- Work Orders<br/>- WebSocket Connections"]
    L1["Connect Lambda"]
    L2["Disconnect Lambda"]

    %% WebSocket Connections
    EM -->|"1. WebSocket Connect"| WS
    WS -->|"2. Route $connect"| L1
    L1 -->|"3. Store Connection ID"| DDB

    %% Real-time Updates (Direct from Email Agent)
    EA -->|"4. Direct WebSocket Updates"| WS
    WS -->|"5. Broadcast to Connections"| EM

    %% Work Order Processing
    EM -->|"6. Create Work Order"| DDB
    DDB -->|"7. Stream Changes"| SQS
    EA -->|"8. Poll Queue"| SQS
    EA -->|"9. Process & Update"| DDB

    %% Cleanup
    EM -->|"10. WebSocket Disconnect"| WS
    WS -->|"11. Route $disconnect"| L2
    L2 -->|"12. Remove Connection ID"| DDB

    style EM fill:#d4eaff,stroke:#333
    style EA fill:#ffe7d4,stroke:#333
    style WS fill:#d4ffd4,stroke:#333
    style SQS fill:#ffd4d4,stroke:#333
    style DDB fill:#f0d4ff,stroke:#333
    style L1 fill:#fff3d4,stroke:#333
    style L2 fill:#fff3d4,stroke:#333
```

### Communication Flow:

1. **WebSocket Setup**:
   - Email Manager connects to WebSocket API
   - Connection ID is stored in DynamoDB

2. **Real-time Updates**:
   - Email Agent sends updates directly through API Gateway Management API
   - Updates are broadcast to all active connections
   - No intermediate Lambda function required for updates

3. **Work Order Processing**:
   - Work orders are created in DynamoDB
   - Changes stream to SQS queue
   - Email Agent processes work orders
   - Real-time updates sent via WebSocket

4. **Connection Cleanup**:
   - Disconnections are handled automatically
   - Connection IDs are removed from DynamoDB

### Event Types Support

The system supports both virtual and in-person events:

- **Virtual Events**: Require Zoom ID for registration confirmation
- **In-Person Events**: Skip Zoom ID validation and show "In-Person" indicator
- **Event Configuration**: Each work order includes an `inPerson` boolean flag
- **UI Adaptation**: Frontend automatically adjusts fields based on event type

### Optimistic Updates

The frontend provides immediate user feedback through optimistic updates:

- **Start/Restart Actions**: UI immediately shows "working" status
- **Status Preservation**: Optimistic updates are preserved against older WebSocket messages
- **Real-time Sync**: Email agent updates overwrite optimistic states with actual progress

## Development

To add new features or modify existing ones:

1. Create or modify step implementations in the `steps/` directory
2. Add or update email templates in the `templates/` directory
3. Update the configuration in `config.py` if needed
4. Test your changes locally using the `.env` file

## Infrastructure

The AWS infrastructure is defined using CDK. To deploy:

```bash
cd infrastructure
npm install
cdk deploy
```

This will create:
- DynamoDB table with stream enabled
- SQS FIFO queue
- Lambda function
- API Gateway WebSocket API
- Required IAM roles and policies

## Development

### Adding New Steps

1. Add the step type to the `StepProcessor` class
2. Implement the processing logic
3. Update the work order model if needed

### Testing

```bash
pytest
```

## Monitoring

The agent logs to CloudWatch Logs in production. Key metrics to monitor:
- SQS queue depth
- Lambda invocation errors
- WebSocket connection count
- Work order processing time 