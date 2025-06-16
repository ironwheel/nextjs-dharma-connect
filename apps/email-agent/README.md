# Email Agent

A Python-based email processing agent that handles work orders for email campaigns.

## Architecture

The system consists of several components:

1. **DynamoDB Table**
   - Stores work orders with their steps and status
   - Has a stream enabled to capture all changes

2. **Lambda Function**
   - Processes DynamoDB stream events
   - Routes step status changes to SQS
   - Broadcasts all changes to WebSocket clients

3. **SQS FIFO Queue**
   - Receives step status change events
   - Ensures ordered processing of work orders

4. **Python Email Agent**
   - Runs on EC2 (production) or locally (development)
   - Polls SQS for new work orders
   - Processes steps and updates work order status
   - Locks work orders during processing

5. **API Gateway WebSocket API**
   - Provides real-time updates to web clients
   - Broadcasts work order changes to all connected clients

## Setup

### Prerequisites

- Python 3.9+
- AWS CLI configured with appropriate permissions
- AWS CDK installed (for infrastructure deployment)

### Environment Variables

Create a `.env` file with:

```env
AWS_REGION=us-east-1
DYNAMODB_TABLE=WORK_ORDERS
SQS_QUEUE_URL=https://sqs.{region}.amazonaws.com/{account}/{queue-name}
WEBSOCKET_API_URL=wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}
```

### Installation

1. Create a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # or `venv\Scripts\activate` on Windows
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### Running the Agent

Development:
```bash
python -m src.main
```

Production (EC2):
```bash
# Install as a systemd service
sudo cp email-agent.service /etc/systemd/system/
sudo systemctl enable email-agent
sudo systemctl start email-agent
```

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