import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

/**
 * NetworkStack (design §8.1).
 *
 * Creates the shared VPC plus a shared security group used by all application
 * Lambdas. Configured for a cost-efficient, free-tier-friendly deploy:
 *   - Two Availability Zones, because RDS DB subnet groups must span ≥2 AZs
 *     (AWS hard requirement — subnets themselves are free).
 *   - A NAT *instance* on `t3.micro` (Amazon Linux, Prebuilt NAT AMI) instead
 *     of a managed NAT gateway — cheaper per hour (~1/4 the cost) and
 *     free-tier-eligible for new accounts. CDK configures routing + user-data
 *     automatically via `NatInstanceProviderV2`.
 *   - `natGateways: 1` keeps a SINGLE NAT instance (first AZ only).
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
      // NAT instances must accept the reply traffic for their forwarded
      // connections. INBOUND_AND_OUTBOUND adds allow-from-anywhere ingress
      // (OUTBOUND_ONLY leaves the SG with NO ingress rules, breaking egress).
      defaultAllowedTraffic: ec2.NatTrafficDirection.INBOUND_AND_OUTBOUND,
    });

    // Configurable VPC CIDR (default 10.0.0.0/16). Make it explicit so each
    // stack/environment on the same AWS account can use a disjoint range and
    // avoid "CIDR conflicts with another subnet" when other stacks already use
    // the default prefix. Empty/unset falls back to the default.
    const vpcCidr = process.env.VPC_CIDR?.trim() || '10.0.0.0/16';

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      // RDS requires a DB subnet group spanning at least 2 AZs, so the network
      // must span 2 AZs. Subnets are free; the cost savings stay in the NAT
      // (single t3.micro instance) and the single-AZ RDS instance below.
      maxAzs: 2,
      // One NAT instance (first AZ) provides egress for the app's private
      // subnets.
      natGateways: 1,
      // NAT instance (EC2) instead of a managed NAT gateway.
      natGatewayProvider: natProvider,
      ipAddresses: ec2.IpAddresses.cidr(vpcCidr),
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
