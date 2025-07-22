#!/bin/bash

# Script to enable streaming on the existing foundations.participants table
# This script is designed to be safe and won't delete any data

set -e

echo "🔍 Checking current streaming status of foundations.participants table..."

# Require AWS_PROFILE to be set in the environment
if [ -z "$AWS_PROFILE" ]; then
  echo "❌ AWS_PROFILE environment variable is not set. Please set it before running this script."
  exit 1
fi

# Set AWS profile from environment variable, default to 'slsupport' if not set
# AWS_PROFILE="${AWS_PROFILE:-slsupport}" # This line is removed as per the edit hint

# Check current streaming status
CURRENT_STREAM_STATUS=$(aws dynamodb describe-table \
    --table-name foundations.participants \
    --profile "$AWS_PROFILE" \
    --query 'Table.StreamSpecification.StreamEnabled' \
    --output text 2>/dev/null || echo "false")

echo "Current streaming status: $CURRENT_STREAM_STATUS"

if [ "$CURRENT_STREAM_STATUS" = "true" ]; then
    echo "✅ Streaming is already enabled on foundations.participants table"
    echo "Stream ARN: $(aws dynamodb describe-table --table-name foundations.participants --profile "$AWS_PROFILE" --query 'Table.LatestStreamArn' --output text)"
else
    echo "🔄 Enabling streaming on foundations.participants table..."
    
    # Enable streaming with NEW_AND_OLD_IMAGES view type
    aws dynamodb update-table \
        --table-name foundations.participants \
        --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES \
        --profile "$AWS_PROFILE"
    
    echo "⏳ Waiting for table update to complete..."
    
    # Wait for the table to be active
    aws dynamodb wait table-exists \
        --table-name foundations.participants \
        --profile "$AWS_PROFILE"
    
    echo "✅ Streaming enabled successfully!"
    echo "Stream ARN: $(aws dynamodb describe-table --table-name foundations.participants --profile "$AWS_PROFILE" --query 'Table.LatestStreamArn' --output text)"
fi

echo ""
echo "📋 Next steps:"
echo "1. Deploy the Dharma Connect CDK stack to create the WebSocket API and Lambda function"
echo "2. The Lambda function will automatically be configured to listen to the stream"
echo "3. Test the WebSocket connection from the admin-dashboard" 