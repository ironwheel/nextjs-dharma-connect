#!/bin/bash

# Script to set up environment variables for the admin-dashboard
echo "🔧 Setting up environment variables for admin-dashboard..."

# WebSocket API URL from the CDK deployment
export AWS_WEBSOCKET_API_URL="wss://3zvne1dk16.execute-api.us-east-1.amazonaws.com/prod"

echo "✅ Environment variables set:"
echo "   AWS_WEBSOCKET_API_URL=$AWS_WEBSOCKET_API_URL"
echo ""
echo "📋 To use these in your admin-dashboard, add to your .env file:"
echo "   AWS_WEBSOCKET_API_URL=$AWS_WEBSOCKET_API_URL"
echo ""
echo "🚀 You can now test the WebSocket connection from the admin-dashboard!"
echo "   The Dharma Connect Lambda function will automatically handle both work-orders and students resources." 