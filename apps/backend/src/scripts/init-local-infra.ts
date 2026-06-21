import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  TimeToLiveStatus,
  UpdateTimeToLiveCommand,
  waitUntilTableExists
} from "@aws-sdk/client-dynamodb";
import {
  CreateEventBusCommand,
  EventBridgeClient,
  ListEventBusesCommand,
  PutRuleCommand,
  PutTargetsCommand,
  ResourceAlreadyExistsException
} from "@aws-sdk/client-eventbridge";
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  QueueAttributeName,
  SetQueueAttributesCommand,
  SQSClient
} from "@aws-sdk/client-sqs";

const config = {
  region: process.env.AWS_REGION ?? "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test"
  },
  dynamodbEndpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
  localstackEndpoint: process.env.LOCALSTACK_ENDPOINT ?? "http://localhost:4566",
  eventBusName: "payments-event-bus"
};

type ResourceStatus = "created" | "exists" | "updated";

interface ResourceResult {
  type: string;
  name: string;
  status: ResourceStatus;
}

const dynamodb = new DynamoDBClient({
  region: config.region,
  credentials: config.credentials,
  endpoint: config.dynamodbEndpoint
});

const sqs = new SQSClient({
  region: config.region,
  credentials: config.credentials,
  endpoint: config.localstackEndpoint
});

const eventBridge = new EventBridgeClient({
  region: config.region,
  credentials: config.credentials,
  endpoint: config.localstackEndpoint
});

const results: ResourceResult[] = [];

function record(type: string, name: string, status: ResourceStatus) {
  results.push({ type, name, status });
}

async function ensureTable(name: string, options: Parameters<typeof createTableInput>[1] = {}) {
  try {
    await dynamodb.send(new DescribeTableCommand({ TableName: name }));
    record("DynamoDB table", name, "exists");
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }

    try {
      await dynamodb.send(new CreateTableCommand(createTableInput(name, options)));
      record("DynamoDB table", name, "created");
    } catch (createError) {
      if (!(createError instanceof ResourceInUseException)) {
        throw createError;
      }
      record("DynamoDB table", name, "exists");
    }
  }

  await waitUntilTableExists({ client: dynamodb, maxWaitTime: 30 }, { TableName: name });
  await ensureTtl(name);
}

function createTableInput(
  tableName: string,
  options: {
    includePaymentIndexes?: boolean;
  } = {}
) {
  const input = {
    TableName: tableName,
    BillingMode: "PAY_PER_REQUEST" as const,
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" as const },
      { AttributeName: "SK", AttributeType: "S" as const }
    ],
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" as const },
      { AttributeName: "SK", KeyType: "RANGE" as const }
    ],
    GlobalSecondaryIndexes: undefined as
      | {
          IndexName: string;
          KeySchema: { AttributeName: string; KeyType: "HASH" | "RANGE" }[];
          Projection: { ProjectionType: "ALL" };
        }[]
      | undefined
  };

  if (options.includePaymentIndexes) {
    input.AttributeDefinitions.push(
      { AttributeName: "GSI1PK", AttributeType: "S" },
      { AttributeName: "GSI1SK", AttributeType: "S" },
      { AttributeName: "GSI2PK", AttributeType: "S" },
      { AttributeName: "GSI2SK", AttributeType: "S" },
      { AttributeName: "GSI3PK", AttributeType: "S" },
      { AttributeName: "GSI3SK", AttributeType: "S" }
    );
    input.GlobalSecondaryIndexes = [
      {
        IndexName: "byPaymentId",
        KeySchema: [
          { AttributeName: "GSI1PK", KeyType: "HASH" },
          { AttributeName: "GSI1SK", KeyType: "RANGE" }
        ],
        Projection: { ProjectionType: "ALL" }
      },
      {
        IndexName: "byStatusDate",
        KeySchema: [
          { AttributeName: "GSI2PK", KeyType: "HASH" },
          { AttributeName: "GSI2SK", KeyType: "RANGE" }
        ],
        Projection: { ProjectionType: "ALL" }
      },
      {
        IndexName: "byReference",
        KeySchema: [
          { AttributeName: "GSI3PK", KeyType: "HASH" },
          { AttributeName: "GSI3SK", KeyType: "RANGE" }
        ],
        Projection: { ProjectionType: "ALL" }
      }
    ];
  }

  return input;
}

async function ensureTtl(tableName: string) {
  try {
    await dynamodb.send(
      new UpdateTimeToLiveCommand({
        TableName: tableName,
        TimeToLiveSpecification: {
          AttributeName: "ttl",
          Enabled: true
        }
      })
    );
    record("DynamoDB TTL", `${tableName}.ttl`, "updated");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes(TimeToLiveStatus.ENABLED.toLowerCase())) {
      throw error;
    }
    record("DynamoDB TTL", `${tableName}.ttl`, "exists");
  }
}

async function ensureQueue(name: string, dlqArn?: string) {
  const attributes =
    dlqArn === undefined
      ? undefined
      : {
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: dlqArn,
            maxReceiveCount: "3"
          })
        };

  let queueUrl: string | undefined;
  let status: ResourceStatus = "exists";
  try {
    const existing = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
    queueUrl = existing.QueueUrl;
  } catch (error) {
    if (
      !isNotFound(error) &&
      !(error instanceof Error && error.name === "AWS.SimpleQueueService.NonExistentQueue")
    ) {
      throw error;
    }

    const created = await sqs.send(
      new CreateQueueCommand({
        QueueName: name,
        Attributes: attributes
      })
    );
    queueUrl = created.QueueUrl;
    status = "created";
  }

  if (!queueUrl) {
    throw new Error(`SQS did not return QueueUrl for ${name}`);
  }

  if (status === "exists" && attributes) {
    await sqs.send(
      new SetQueueAttributesCommand({
        QueueUrl: queueUrl,
        Attributes: attributes
      })
    );
    status = "updated";
  }

  record("SQS queue", name, status);
  const queueAttributes = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: [QueueAttributeName.QueueArn]
    })
  );
  const arn = queueAttributes.Attributes?.QueueArn;
  if (!arn) {
    throw new Error(`SQS did not return QueueArn for ${name}`);
  }

  return { name, url: queueUrl, arn };
}

async function ensureEventBus(name: string) {
  const buses = await eventBridge.send(new ListEventBusesCommand({ NamePrefix: name }));
  if (buses.EventBuses?.some((bus) => bus.Name === name)) {
    record("EventBridge bus", name, "exists");
    return;
  }

  try {
    await eventBridge.send(new CreateEventBusCommand({ Name: name }));
    record("EventBridge bus", name, "created");
  } catch (error) {
    if (!(error instanceof ResourceAlreadyExistsException)) {
      throw error;
    }
    record("EventBridge bus", name, "exists");
  }
}

async function ensureRule(args: {
  name: string;
  description: string;
  eventPattern: Record<string, unknown>;
  targetArn: string;
  targetId: string;
}) {
  const rule = await eventBridge.send(
    new PutRuleCommand({
      Name: args.name,
      EventBusName: config.eventBusName,
      Description: args.description,
      EventPattern: JSON.stringify(args.eventPattern),
      State: "ENABLED"
    })
  );

  await eventBridge.send(
    new PutTargetsCommand({
      Rule: args.name,
      EventBusName: config.eventBusName,
      Targets: [
        {
          Id: args.targetId,
          Arn: args.targetArn
        }
      ]
    })
  );

  record("EventBridge rule", args.name, "updated");
  return rule.RuleArn;
}

async function allowEventBridgeToSendMessages(args: {
  queueUrl: string;
  queueArn: string;
  ruleArn: string;
}) {
  await sqs.send(
    new SetQueueAttributesCommand({
      QueueUrl: args.queueUrl,
      Attributes: {
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "AllowEventBridgeSendMessage",
              Effect: "Allow",
              Principal: {
                Service: "events.amazonaws.com"
              },
              Action: "sqs:SendMessage",
              Resource: args.queueArn,
              Condition: {
                ArnEquals: {
                  "aws:SourceArn": args.ruleArn
                }
              }
            }
          ]
        })
      }
    })
  );
  record("SQS policy", args.queueArn.split(":").at(-1) ?? args.queueArn, "updated");
}

async function main() {
  console.log("Initializing local infrastructure...");
  console.log(`DynamoDB endpoint: ${config.dynamodbEndpoint}`);
  console.log(`LocalStack endpoint: ${config.localstackEndpoint}`);

  await ensureTable("Payments", { includePaymentIndexes: true });
  await ensureTable("IdempotencyKeys");
  await ensureTable("AuditEvents");

  const dlq = await ensureQueue("payment-dlq");
  const processingQueue = await ensureQueue("payment-processing-queue", dlq.arn);
  const notificationQueue = await ensureQueue("notification-queue", dlq.arn);
  const reconciliationQueue = await ensureQueue("reconciliation-queue", dlq.arn);
  const auditQueue = await ensureQueue("audit-queue", dlq.arn);

  await ensureEventBus(config.eventBusName);

  const paymentCreatedRuleArn = await ensureRule({
    name: "payment-created-to-processing",
    description: "Routes PaymentCreated events to the simulated payment processor queue.",
    eventPattern: { "detail-type": ["PaymentCreated"] },
    targetArn: processingQueue.arn,
    targetId: "payment-processing-queue"
  });
  await allowEventBridgeToSendMessages({
    queueUrl: processingQueue.url,
    queueArn: processingQueue.arn,
    ruleArn: paymentCreatedRuleArn ?? ""
  });

  const finalEventsPattern = {
    "detail-type": ["PaymentApproved", "PaymentRejected", "PaymentExpired", "PaymentCancelled"]
  };

  for (const target of [
    {
      queue: notificationQueue,
      ruleName: "payment-final-events-to-notification",
      description: "Routes final payment events to notification queue."
    },
    {
      queue: reconciliationQueue,
      ruleName: "payment-final-events-to-reconciliation",
      description: "Routes final payment events to reconciliation queue."
    },
    {
      queue: auditQueue,
      ruleName: "payment-events-to-audit",
      description: "Routes auditable payment events to audit queue.",
      pattern: {
        "detail-type": [
          "PaymentProcessingStarted",
          "PaymentApproved",
          "PaymentRejected",
          "PaymentExpired",
          "PaymentCancelled",
          "PaymentNotificationFailed",
          "PaymentReconciliationFailed"
        ]
      }
    }
  ]) {
    const ruleArn = await ensureRule({
      name: target.ruleName,
      description: target.description,
      eventPattern: target.pattern ?? finalEventsPattern,
      targetArn: target.queue.arn,
      targetId: target.queue.name
    });
    await allowEventBridgeToSendMessages({
      queueUrl: target.queue.url,
      queueArn: target.queue.arn,
      ruleArn: ruleArn ?? ""
    });
  }

  printSummary();
}

function isNotFound(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "ResourceNotFoundException" || error.name === "ResourceNotFound")
  );
}

function printSummary() {
  console.log("\nLocal infrastructure summary:");
  for (const result of results) {
    console.log(`- ${result.type}: ${result.name} (${result.status})`);
  }
  console.log("\nDone.");
}

main().catch((error: unknown) => {
  console.error("\nFailed to initialize local infrastructure.");
  console.error(
    "Make sure Docker Compose is running DynamoDB Local and LocalStack before executing this command."
  );
  console.error(error);
  process.exitCode = 1;
});
