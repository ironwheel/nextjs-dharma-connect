#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EmailAgentStack } from '../lib/email-agent-stack';

const app = new cdk.App();
new EmailAgentStack(app, 'EmailAgentStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
    }
}); 