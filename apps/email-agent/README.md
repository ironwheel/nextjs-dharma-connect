# Email Agent

A Node.js service that processes email campaign work orders by polling DynamoDB and executing steps in sequence.

## Features

- Polls DynamoDB for pending work orders
- Processes work orders one at a time
- Executes steps in sequence (copy from Mailchimp, send test emails, send campaign emails)
- Supports continuous operation for long-running campaigns
- Maintains audit logs of all operations
- Graceful shutdown handling

## Prerequisites

- Node.js 18 or later
- AWS credentials with access to:
  - DynamoDB (WorkOrders and WorkOrderAuditLogs tables)
  - S3 (for email templates)
  - SES (for sending emails)
  - Cognito Identity Pool

## Environment Variables

Required environment variables:

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_COGNITO_IDENTITY_POOL_ID=your-identity-pool-id

# DynamoDB Table Names
DYNAMODB_TABLE_WORK_ORDERS=WorkOrders
DYNAMODB_TABLE_WORK_ORDER_AUDIT_LOGS=WorkOrderAuditLogs

# Logging
LOG_LEVEL=info

# Python Module Path (for future integration)
PYTHON_MODULE_PATH=/path/to/python/modules
```

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file with the required environment variables.

## Usage

Start the agent:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## Work Order Structure

A work order consists of:
- `workOrderId`: Unique identifier
- `campaignString`: Campaign identifier
- `status`: Current status (pending, running, completed, error, stopped)
- `steps`: Array of step objects
- `createdBy`: User PID who created the work order
- `createdAt`: Creation timestamp
- `updatedAt`: Last update timestamp

Each step has:
- `stepNumber`: Sequential number
- `type`: Step type (copyFromMailchimp, sendTestEmails, sendCampaignEmails)
- `status`: Current status
- `parameters`: Step-specific parameters
- `continuous`: Whether the step should run continuously
- `startTime`: When the step started
- `endTime`: When the step completed/errored

## Integration with Python Modules

The agent is designed to integrate with existing Python modules for:
- Copying HTML from Mailchimp to S3
- Sending test emails
- Sending campaign emails

The integration points are in `src/step-processor.js`.

## Logging

Logs are written to:
- Console (all levels)
- `error.log` (error level only)
- `combined.log` (all levels)

## Development

1. Run tests:
   ```bash
   npm test
   ```

2. The agent uses the shared `@dharma/backend-core` package for DynamoDB operations.

## License

MIT 