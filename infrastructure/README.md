# Dharma Connect Infrastructure

This directory contains the AWS CDK infrastructure for the Dharma Connect platform, providing real-time WebSocket connectivity for multiple resources.

## Overview

The Dharma Connect infrastructure provides:
- **WebSocket API Gateway** - Real-time communication for clients
- **Lambda Function** - Monolithic handler for multiple resources (work-orders, students)
- **DynamoDB Tables** - Data storage with streaming enabled
- **Connection Management** - Separate tables for WebSocket connections per resource

## Architecture

### Single WebSocket API
- **URL**: `wss://3zvne1dk16.execute-api.us-east-1.amazonaws.com/prod`
- **Purpose**: Handles both work-orders and students resources
- **Routing**: Uses query parameters (`tableType`) to route to appropriate handlers

### Monolithic Lambda Handler
- **Function**: `DharmaConnectStack-WebSocketHandler47C0AA1A-vRTubbtfIusz`
- **Resources**: 
  - Work Orders (`EmailAgentStack-WorkOrdersTable515B4C61`)
  - Students (`foundations.participants` - existing table)
- **Streams**: DynamoDB streams for real-time updates

### Connection Tables
- **Work Orders**: `EmailAgentStack-WorkOrderConnections28044DC8`
- **Students**: `EmailAgentStack-StudentConnections70A0C6AD`

## Deployment

### Prerequisites
- AWS CLI configured with `slsupport` profile
- Node.js 18+ installed
- CDK CLI installed

### Setup
```bash
# Install dependencies
npm install

# Enable streaming on existing tables (if needed)
./enable-streaming.sh

# Deploy the stack
npx cdk deploy --profile slsupport --require-approval never
```

### Environment Variables
After deployment, set the WebSocket API URL in your applications:
```bash
AWS_WEBSOCKET_API_URL=wss://3zvne1dk16.execute-api.us-east-1.amazonaws.com/prod
```

## Usage

### Connecting to WebSocket
```javascript
// For students
const wsUrl = `${websocketUrl}?tableType=students&token=${token}`;

// For work-orders
const wsUrl = `${websocketUrl}?tableType=work-orders&token=${token}`;
```

### Real-time Updates
The Lambda function automatically:
1. Listens to DynamoDB streams
2. Routes updates to appropriate connection tables
3. Broadcasts changes to connected WebSocket clients

## Files

- `lib/dharma-connect-stack.ts` - Main CDK stack definition
- `bin/dharma-connect-infrastructure.ts` - CDK app entry point
- `enable-streaming.sh` - Script to enable DynamoDB streaming
- `setup-env.sh` - Environment variable setup script

## Benefits

✅ **Cost Efficient** - Single API Gateway and Lambda function  
✅ **Simplified Management** - Centralized infrastructure  
✅ **Scalable** - Easy to add new resources  
✅ **Real-time** - DynamoDB streams for instant updates  
✅ **Secure** - JWT-based authentication  

## Maintenance

### Updating the Stack
```bash
# Make changes to the stack
# Deploy updates
npx cdk deploy --profile slsupport --require-approval never
```

### Monitoring
- CloudWatch logs: `/aws/lambda/DharmaConnectStack-WebSocketHandler47C0AA1A-vRTubbtfIusz`
- API Gateway metrics in AWS Console
- DynamoDB stream monitoring 