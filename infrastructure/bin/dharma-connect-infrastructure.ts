/**
 * @file infrastructure/bin/dharma-connect-infrastructure.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description This file is the entrypoint for the CDK application.
 */

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DharmaConnectStack } from '../lib/dharma-connect-stack';

const app = new cdk.App();
new DharmaConnectStack(app, 'DharmaConnectStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
    }
});