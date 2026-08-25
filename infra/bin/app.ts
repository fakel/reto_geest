#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { QueueStack } from '../lib/queue-stack';
import { ApiStack } from '../lib/api-stack';

/**
 * CDK entry point (T-17).
 *
 * Instantiates the stacks in dependency order:
 *   Network → Database → Queue → API
 *
 * Stacks reference each other's outputs by passing stack props, which CDK
 * resolves as cross-stack references (CloudFormation exports/imports).
 *
 * NOTIFY_URL is read from the environment (required for the Worker to know
 * where to deliver notifications). AWS account/region default to the CDK
 * CLI's configured environment when CDK_DEFAULT_* are unset.
 */

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const notifyUrl = process.env.NOTIFY_URL ?? 'https://example.com/webhook';

const network = new NetworkStack(app, 'NetworkStack', { env });
const database = new DatabaseStack(app, 'DatabaseStack', {
  env,
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
});
const queue = new QueueStack(app, 'QueueStack', {
  env,
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
  databaseUrl: database.databaseUrl,
  notifyUrl,
});
new ApiStack(app, 'ApiStack', {
  env,
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
  databaseUrl: database.databaseUrl,
  notificationQueueUrl: queue.notificationQueueUrl,
  dlqUrl: queue.dlqQueueUrl,
});

app.synth();
