import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import * as path from 'path';

export interface DatabaseStackProps extends cdk.StackProps {
  readonly vpc: ec2.Vpc;
  /** Security group applied to the Lambdas that must reach the database. */
  readonly lambdaSecurityGroup: ec2.SecurityGroup;
}

/**
 * DatabaseStack (design §8.1).
 *
 * RDS PostgreSQL 16 instance (db.t3.micro — AWS free-tier eligible), not
 * publicly accessible, in the private subnets, single AZ. Credentials are
 * auto-generated and stored in AWS Secrets Manager. The database security
 * group allows TCP 5432 ingress only from the application Lambdas' shared
 * security group.
 *
 * Exposes a `postgres://` connection string (DATABASE_URL) whose username,
 * password, host and database name are resolved at deploy time from the
 * generated secret, plus the Secret ARN for reference.
 */
export class DatabaseStack extends cdk.Stack {
  /** Deploy-time-resolved `postgresql://...` connection string. */
  public readonly databaseUrl: string;
  /** ARN of the RDS-generated secret in Secrets Manager. */
  public readonly databaseSecretArn: string;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: props.vpc,
      description: 'Allows PostgreSQL access from the application Lambdas only',
    });
    databaseSecurityGroup.addIngressRule(
      props.lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Lambda to RDS PostgreSQL ingress',
    );

    const instance = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [databaseSecurityGroup],
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ), // db.t3.micro — free-tier eligible
      databaseName: 'reto_geest',
      credentials: rds.Credentials.fromGeneratedSecret('reto_geest', {
        secretName: 'reto-geest/db',
      }),
      multiAz: false, // single AZ to stay within free tier
      publiclyAccessible: false,
      storageEncrypted: true,
      allocatedStorage: 20,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    const secret = instance.secret;
    if (!secret) {
      throw new Error('RDS credentials secret was not generated');
    }

    this.databaseSecretArn = secret.secretArn;

    // Compose the connection string from the generated secret + endpoint so it
    // can be wired into the Lambda environment as DATABASE_URL.
    this.databaseUrl = cdk.Fn.join('', [
      'postgresql://',
      secret.secretValueFromJson('username').unsafeUnwrap(),
      ':',
      secret.secretValueFromJson('password').unsafeUnwrap(),
      '@',
      instance.dbInstanceEndpointAddress,
      ':',
      instance.instanceEndpoint.port.toString(),
      '/',
      secret.secretValueFromJson('dbname').unsafeUnwrap(),
    ]);

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: instance.dbInstanceEndpointAddress,
    });
    new cdk.CfnOutput(this, 'DatabaseSecretArn', { value: this.databaseSecretArn });
    new cdk.CfnOutput(this, 'DatabaseUrl', { value: this.databaseUrl });

    // One-shot schema migration: applies packages/api/prisma/schema.sql to the
    // fresh RDS instance. Without this, a newly deployed database has no tables
    // and every DB-backed endpoint returns INTERNAL_ERROR.
    this.addSchemaMigration(props, instance);
  }

  private addSchemaMigration(
    props: DatabaseStackProps,
    instance: rds.DatabaseInstance,
  ): void {
    const migration = new lambdaNodejs.NodejsFunction(this, 'SchemaMigration', {
      functionName: 'reto-geest-db-schema-migration',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, 'migration-runner.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.minutes(3),
      vpc: props.vpc,
      securityGroups: [props.lambdaSecurityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        availabilityZones: [props.vpc.availabilityZones[0]],
      },
      environment: { DATABASE_URL: this.databaseUrl },
      bundling: {
        loader: { '.sql': 'text' },
      },
    });
    migration.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [this.databaseSecretArn],
      }),
    );
    migration.node.addDependency(instance);

    const provider = new cr.Provider(this, 'SchemaMigrationProvider', {
      onEventHandler: migration,
    });

    new cdk.CustomResource(this, 'SchemaMigrated', {
      serviceToken: provider.serviceToken,
      properties: { version: '1' },
    });
  }
}
