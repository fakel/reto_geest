import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ApiStackProps extends cdk.StackProps {
  readonly vpc: ec2.Vpc;
  /** Security group applied to the API Lambda. */
  readonly lambdaSecurityGroup: ec2.SecurityGroup;
  readonly databaseUrl: string;
  /** ARN of the notification queue (for IAM grants). */
  readonly notificationQueueArn: string;
  readonly notificationQueueUrl: string;
  /** ARN of the dead letter queue (for IAM grants). */
  readonly dlqArn: string;
  readonly dlqUrl: string;
  readonly rateLimitMax?: string;
  readonly rateLimitWindowMs?: string;
}

/**
 * ApiStack (design §8.1).
 *
 * The REST API Lambda (512 MB, 29s timeout) exposed through an API Gateway
 * HTTP API that proxies every request (`$default`) to the Lambda. The Lambda
 * runs inside the VPC so it can reach RDS, and has the queue/DLQ URLs and rate
 * limiter settings wired into its environment.
 */
export class ApiStack extends cdk.Stack {
  /** The HTTP API endpoint (e.g. https://<id>.execute-api.<region>.amazonaws.com). */
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const apiLambda = new lambdaNodejs.NodejsFunction(this, 'ApiLambda', {
      functionName: 'reto-geest-api',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'packages', 'api', 'src', 'lambda.ts'),
      handler: 'handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(29),
      vpc: props.vpc,
      securityGroups: [props.lambdaSecurityGroup],
      // Pin the API to the first AZ so it egresses through the single NAT
      // instance (only Private-Subnet-1 has the NAT route).
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        availabilityZones: [props.vpc.availabilityZones[0]],
      },
      environment: {
        DATABASE_URL: props.databaseUrl,
        NOTIFICATION_QUEUE_URL: props.notificationQueueUrl,
        DLQ_URL: props.dlqUrl,
        RATE_LIMIT_MAX: props.rateLimitMax ?? '100',
        RATE_LIMIT_WINDOW_MS: props.rateLimitWindowMs ?? '60000',
        NODE_ENV: 'production',
      },
    });

    apiLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['*'],
      }),
    );
    // Allow the API to publish to the notification queue and poll the DLQ.
    // Grant on the QUEUE ARNs (not URLs) — IAM requires ARNs here.
    apiLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sqs:SendMessage', 'sqs:ReceiveMessage', 'sqs:DeleteMessage'],
        resources: [props.notificationQueueArn, props.dlqArn],
      }),
    );

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'reto-geest-api',
    });

    const integration = new HttpLambdaIntegration('ApiIntegration', apiLambda);
    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration,
    });

    this.apiUrl = httpApi.apiEndpoint;
    new cdk.CfnOutput(this, 'ApiUrl', { value: this.apiUrl });
  }
}
