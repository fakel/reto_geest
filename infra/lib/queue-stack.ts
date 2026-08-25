import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import * as path from 'path';

export interface QueueStackProps extends cdk.StackProps {
  readonly vpc: ec2.Vpc;
  /** Security group applied to the Worker Lambda. */
  readonly lambdaSecurityGroup: ec2.SecurityGroup;
  /** Postgres connection string (from DatabaseStack). */
  readonly databaseUrl: string;
  /** External webhook target for the Worker. */
  readonly notifyUrl: string;
}

/**
 * QueueStack (design §8.1).
 *
 * Creates the notification SQS queue with its Dead Letter Queue (maxReceiveCount
 * 3, visibility timeout 30s, DLQ retention 14 days) and the Worker Lambda that
 * consumes it. The Worker POSTs each archived-task notification to the external
 * webhook and logs a NotificationAttempt; on repeated failures SQS moves the
 * message to the DLQ.
 */
export class QueueStack extends cdk.Stack {
  /** URL of the main notification queue (consumed by the API to enqueue). */
  public readonly notificationQueueUrl: string;
  /** ARN of the main notification queue (for IAM grants). */
  public readonly notificationQueueArn: string;
  /** URL of the dead letter queue (polled by the API admin endpoint). */
  public readonly dlqQueueUrl: string;
  /** ARN of the dead letter queue (for IAM grants). */
  public readonly dlqQueueArn: string;

  constructor(scope: Construct, id: string, props: QueueStackProps) {
    super(scope, id, props);

    const dlq = new sqs.Queue(this, 'NotificationDLQ', {
      queueName: 'reto-geest-notification-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    const notificationQueue = new sqs.Queue(this, 'NotificationQueue', {
      queueName: 'reto-geest-notification-queue',
      visibilityTimeout: cdk.Duration.seconds(30),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: dlq,
      },
    });

    const worker = new lambdaNodejs.NodejsFunction(this, 'WorkerLambda', {
      functionName: 'reto-geest-worker',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'packages', 'worker', 'src', 'index.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      vpc: props.vpc,
      securityGroups: [props.lambdaSecurityGroup],
      // Pin the Worker to the first AZ so it egresses through the single NAT
      // instance (only Private-Subnet-1 has the NAT route).
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        availabilityZones: [props.vpc.availabilityZones[0]],
      },
      environment: {
        DATABASE_URL: props.databaseUrl,
        NOTIFY_URL: props.notifyUrl,
        NODE_ENV: 'production',
      },
    });

    worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['*'],
      }),
    );

    worker.addEventSource(
      new SqsEventSource(notificationQueue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(10),
      }),
    );

    this.notificationQueueUrl = notificationQueue.queueUrl;
    this.notificationQueueArn = notificationQueue.queueArn;
    this.dlqQueueUrl = dlq.queueUrl;
    this.dlqQueueArn = dlq.queueArn;

    new cdk.CfnOutput(this, 'NotificationQueueUrl', {
      value: this.notificationQueueUrl,
    });
    new cdk.CfnOutput(this, 'DLQUrl', { value: this.dlqQueueUrl });
  }
}
