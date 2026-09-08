/**
 * @file infrastructure/bin/dharma-connect-infrastructure.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description This file is the entrypoint for the CDK application.
 */

import 'source-map-support/register';
import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { DharmaConnectStack } from '../lib/dharma-connect-stack';
import { AudioStack } from '../lib/audio-stack';

const app = new cdk.App();

const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
};

new DharmaConnectStack(app, 'DharmaConnectStack', { env });

// AudioStack is only synthesized when the signing public key is present, so that
// `cdk deploy DharmaConnectStack` keeps working on machines that have never generated
// one. Run ./generate-audio-keypair.sh to create it.
const signingPublicKeyPath = path.join(__dirname, '..', 'audio-signing-public.pem');
if (fs.existsSync(signingPublicKeyPath)) {
    new AudioStack(app, 'DharmaConnectAudioStack', {
        env,
        bucketName: app.node.tryGetContext('audioBucketName') || 'sl-teaching-audio',
        audioDomainName: app.node.tryGetContext('audioDomainName') || 'audio.slsupport.link',
        hostedZoneName: app.node.tryGetContext('audioHostedZoneName') || 'slsupport.link',
        signingPublicKeyPem: fs.readFileSync(signingPublicKeyPath, 'utf8'),
    });
} else {
    cdk.Annotations.of(app).addInfo(
        `Skipping DharmaConnectAudioStack: ${signingPublicKeyPath} not found. ` +
        'Run ./generate-audio-keypair.sh to create the playback URL signing key pair.'
    );
}
