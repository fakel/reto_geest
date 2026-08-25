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
 * NAMING (collision-safe):
 * Each stack gets an explicit CloudFormation name derived from an environment
 * label: `reto-geest-<env>-<StackType>`. `STACK_ENV` selects the label (default
 * `dev`). This guarantees deployments in different environments/accounts do
 * not collide, and keeps names stable and predictable. Stack *construct* ids
 * stay the simple type names; only the CFN `stackName` carries the suffix.
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

// Environment label embedded in each CloudFormation stack name.
const stackEnv = process.env.STACK_ENV ?? 'dev';

/** Build the explicit CloudFormation stack name for a stack type. */
const stackName = (type: string): string => `reto-geest-${stackEnv}-${type}`;

const network = new NetworkStack(app, 'NetworkStack', {
  env,
  stackName: stackName('network'),
});
const database = new DatabaseStack(app, 'DatabaseStack', {
  env,
  stackName: stackName('database'),
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
});
const queue = new QueueStack(app, 'QueueStack', {
  env,
  stackName: stackName('queue'),
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
  databaseUrl: database.databaseUrl,
  notifyUrl,
});
new ApiStack(app, 'ApiStack', {
  env,
  stackName: stackName('api'),
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
  databaseUrl: database.databaseUrl,
  notificationQueueUrl: queue.notificationQueueUrl,
  dlqUrl: queue.dlqQueueUrl,
});

app.synth();