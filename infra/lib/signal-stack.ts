/**
 * The whole spike as one CloudFormation stack (FR7.1).
 *
 * L1 constructs are used deliberately: the deployed resources are exactly the
 * `AWS::*` types the requirement names, and the synthesised template is readable
 * without knowing CDK's higher-level sugar.
 *
 * Lambda code is referenced as an explicit S3 bucket/key instead of a CDK asset.
 * `cdk-assets` publishing needs a bootstrapped AWS account, which the spike
 * cannot have; `scripts/deploy.ts` uploads the zips produced by
 * `scripts/build-lambda.ts` to the emulator's S3 and the stack points at them.
 */

import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as ses from 'aws-cdk-lib/aws-ses';
import type { Construct } from 'constructs';

import {
  GSI_DEFINITIONS,
  TABLE_ATTRIBUTE_DEFINITIONS,
  TABLE_PARTITION_KEY,
  TABLE_SORT_KEY,
} from '../../src/persistence/dynamo-keys';
import type { StackConfig } from '../config';

export interface SignalStackProps extends StackProps {
  readonly stackConfig: StackConfig;
}

export const API_FUNCTION_NAME = 'signal-api';
export const CLUSTERING_FUNCTION_NAME = 'signal-clustering';
export const SES_CONFIGURATION_SET_NAME = 'signal-notifications';

export class SignalStack extends Stack {
  constructor(scope: Construct, id: string, props: SignalStackProps) {
    super(scope, id, props);
    const { stackConfig } = props;
    const account = props.env?.account ?? this.account;
    const region = props.env?.region ?? this.region;

    const table = new dynamodb.CfnTable(this, 'FeedbackTable', {
      tableName: stackConfig.config.feedbackTable,
      billingMode: 'PAY_PER_REQUEST',
      keySchema: [
        { attributeName: TABLE_PARTITION_KEY, keyType: 'HASH' },
        { attributeName: TABLE_SORT_KEY, keyType: 'RANGE' },
      ],
      attributeDefinitions: TABLE_ATTRIBUTE_DEFINITIONS.map((definition) => ({
        attributeName: definition.name,
        attributeType: definition.type,
      })),
      globalSecondaryIndexes: GSI_DEFINITIONS.map((definition) => ({
        indexName: definition.name,
        keySchema: [
          { attributeName: definition.partitionKey, keyType: 'HASH' },
          { attributeName: definition.sortKey, keyType: 'RANGE' },
        ],
        projection: { projectionType: 'ALL' },
      })),
    });

    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    const apiFunction = new lambda.CfnFunction(this, 'ApiFunction', {
      functionName: API_FUNCTION_NAME,
      runtime: stackConfig.lambdaRuntime,
      handler: 'index.handler',
      role: lambdaRole.roleArn,
      timeout: 30,
      memorySize: 512,
      architectures: ['x86_64'],
      code: {
        s3Bucket: stackConfig.apiCodeS3Bucket,
        s3Key: stackConfig.apiCodeS3Key,
      },
      environment: { variables: { ...stackConfig.lambdaEnvironment } },
    });

    const clusteringFunction = new lambda.CfnFunction(this, 'ClusteringFunction', {
      functionName: CLUSTERING_FUNCTION_NAME,
      runtime: stackConfig.lambdaRuntime,
      handler: 'index.handler',
      role: lambdaRole.roleArn,
      timeout: 300,
      memorySize: 1024,
      architectures: ['x86_64'],
      code: {
        s3Bucket: stackConfig.clusteringCodeS3Bucket,
        s3Key: stackConfig.clusteringCodeS3Key,
      },
      environment: { variables: { ...stackConfig.lambdaEnvironment } },
    });

    // --- API Gateway REST API with a Lambda proxy integration on every path ---
    const restApi = new apigateway.CfnRestApi(this, 'RestApi', {
      name: 'signal-api',
      description: 'Build Signal ingestion and dashboard API (local stage)',
      endpointConfiguration: { types: ['REGIONAL'] },
    });

    const proxyResource = new apigateway.CfnResource(this, 'ProxyResource', {
      parentId: restApi.attrRootResourceId,
      pathPart: '{proxy+}',
      restApiId: restApi.ref,
    });

    const integration = {
      type: 'AWS_PROXY',
      integrationHttpMethod: 'POST',
      uri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${apiFunction.attrArn}/invocations`,
    };

    const proxyMethod = new apigateway.CfnMethod(this, 'ProxyMethod', {
      httpMethod: 'ANY',
      resourceId: proxyResource.ref,
      restApiId: restApi.ref,
      authorizationType: 'NONE',
      integration,
    });

    // The dashboard is served from the API root, so the root needs the same proxy.
    const rootMethod = new apigateway.CfnMethod(this, 'RootMethod', {
      httpMethod: 'ANY',
      resourceId: restApi.attrRootResourceId,
      restApiId: restApi.ref,
      authorizationType: 'NONE',
      integration,
    });

    const deployment = new apigateway.CfnDeployment(this, 'Deployment', {
      restApiId: restApi.ref,
      description: 'local deployment',
    });
    deployment.addDependency(proxyMethod);
    deployment.addDependency(rootMethod);

    const stage = new apigateway.CfnStage(this, 'Stage', {
      restApiId: restApi.ref,
      stageName: stackConfig.config.apiStageName,
      deploymentId: deployment.ref,
    });
    stage.addResourceDependency(deployment);

    new lambda.CfnPermission(this, 'InvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: apiFunction.ref,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${region}:${account}:${restApi.ref}/*`,
    });

    // --- Weekly EventBridge Scheduler trigger for the clustering job (FR4.1) ---
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [clusteringFunction.attrArn],
      }),
    );

    const schedule = new scheduler.CfnSchedule(this, 'WeeklyClustering', {
      name: stackConfig.scheduleName,
      description: 'Weekly feedback clustering run',
      flexibleTimeWindow: { mode: 'OFF' },
      scheduleExpression: stackConfig.config.scheduleCron,
      state: 'ENABLED',
      target: {
        arn: clusteringFunction.attrArn,
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({ source: 'aidlc.signal.scheduler', 'detail-type': 'WeeklyClustering' }),
      },
    });

    // --- SES identity and configuration set: configured, never sent through ---
    const emailIdentity = new ses.CfnEmailIdentity(this, 'SenderIdentity', {
      emailIdentity: stackConfig.config.sesSender,
    });
    const configurationSet = new ses.CfnConfigurationSet(this, 'SenderConfigurationSet', {
      name: SES_CONFIGURATION_SET_NAME,
    });

    new CfnOutput(this, 'RestApiId', { value: restApi.ref });
    new CfnOutput(this, 'StageName', { value: stackConfig.config.apiStageName });
    new CfnOutput(this, 'ApiFunctionName', { value: apiFunction.ref });
    new CfnOutput(this, 'ClusteringFunctionName', { value: clusteringFunction.ref });
    new CfnOutput(this, 'FeedbackTableName', { value: table.ref });
    new CfnOutput(this, 'ScheduleName', { value: schedule.ref });
    new CfnOutput(this, 'SesSenderIdentity', { value: emailIdentity.ref });
    new CfnOutput(this, 'ConfigurationSetName', { value: configurationSet.ref });
    new CfnOutput(this, 'ArtifactBucket', { value: stackConfig.apiCodeS3Bucket });
  }
}
