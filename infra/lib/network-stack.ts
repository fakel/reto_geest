import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

/**
 * NetworkStack (design §8.1).
 *
 * Creates the shared VPC plus a shared security group used by all application
 * Lambdas. Configured for a cost-efficient, free-tier-friendly deploy:
 *   - Single Availability Zone (single-AZ footprint).
 *   - A single NAT gateway (network egress for the Lambdas to reach SQS and
 *     the external webhook).
 * Private subnets (network egress via the NAT gateway) and one public subnet.
 * The VPC and the Lambda security group are exposed so downstream stacks
 * (database, queue, api) can place their resources inside the same network and
 * open RDS ingress to the Lambdas.
 */
export class NetworkStack extends cdk.Stack {
  /** The shared VPC used by every other stack. */
  public readonly vpc: ec2.Vpc;
  /** Security group applied to all application Lambdas (API + Worker). */
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      // Single AZ to stay on the free tier and keep costs minimal.
      maxAzs: 1,
      // One NAT gateway is the minimum needed for Lambda egress.
      natGateways: 1,
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      subnetConfiguration: [
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    // Shared SG for application lambdas. The RDS stack opens port 5432 to this
    // group; lambdas need unrestricted egress to reach SQS and the webhook.
    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: this.vpc,
      description: 'Shared security group for the application Lambdas',
      allowAllOutbound: true,
    });

    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, 'LambdaSecurityGroupId', {
      value: this.lambdaSecurityGroup.securityGroupId,
    });
  }
}
