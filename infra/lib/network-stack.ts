import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

/**
 * NetworkStack (design §8.1).
 *
 * Creates the shared VPC plus a shared security group used by all application
 * Lambdas. Configured for a cost-efficient, free-tier-friendly deploy:
 *   - Single Availability Zone (single-AZ footprint).
 *   - A NAT *instance* on `t3.micro` (Amazon Linux, Prebuilt NAT AMI) instead
 *     of a managed NAT gateway — cheaper per hour (~1/4 the cost) and
 *     free-tier-eligible for new accounts. CDK configures routing + user-data
 *     automatically via `NatInstanceProvider`.
 * Private subnets (network egress via the NAT instance) and one public subnet.
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

    // NAT instance provider (replaces the managed NAT gateway). An explicit
    // Amazon Linux 2023 image is passed so CDK does not perform a special NAT
    // AMI context lookup at synth time; the provider injects the NAT user-data.
    const natProvider = new ec2.NatInstanceProviderV2({
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      defaultAllowedTraffic: ec2.NatTrafficDirection.OUTBOUND_ONLY,
    });

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      // Single AZ to stay on the free tier and keep costs minimal.
      maxAzs: 1,
      // One NAT instance provides egress for the private subnets.
      natGateways: 1,
      // NAT instance (EC2) instead of a managed NAT gateway.
      natGatewayProvider: natProvider,
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
