const { mockClient } = require("aws-sdk-client-mock");
const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn().mockResolvedValue("https://s3.example.com/presigned"),
}));

jest.mock("uuid", () => ({ v4: () => "mock-upload-id" }));

const s3Mock     = mockClient(S3Client);
const dynamoMock = mockClient(DynamoDBClient);

process.env.BUCKET_NAME = "test-bucket";
process.env.TABLE_NAME  = "test-table";

const { handler: createUpload }    = require("../src/createUpload");
const { handler: getUploadStatus } = require("../src/getUploadStatus");
const { handler: processUpload }   = require("../src/processUpload");

beforeEach(() => {
  s3Mock.reset();
  dynamoMock.reset();
});

// createUpload

describe("createUpload", () => {
  test("returns 201 with uploadId and uploadUrl", async () => {
    dynamoMock.on(PutItemCommand).resolves({});

    const res = await createUpload({ body: JSON.stringify({ contentType: "image/jpeg" }) });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.uploadId).toBe("mock-upload-id");
    expect(body.uploadUrl).toBe("https://s3.example.com/presigned");
  });

  test("returns 500 when DynamoDB fails", async () => {
    dynamoMock.on(PutItemCommand).rejects(new Error("DB error"));

    const res = await createUpload({ body: null });

    expect(res.statusCode).toBe(500);
  });
});

// getUploadStatus

describe("getUploadStatus", () => {
  test("returns 200 with record when found", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        uploadId:  { S: "mock-upload-id" },
        status:    { S: "DONE" },
        createdAt: { S: "2024-01-01T00:00:00.000Z" },
      },
    });

    const res = await getUploadStatus({ pathParameters: { uploadId: "mock-upload-id" } });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe("DONE");
  });

  test("returns 404 when not found", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: null });

    const res = await getUploadStatus({ pathParameters: { uploadId: "no-such-id" } });

    expect(res.statusCode).toBe(404);
  });

  test("returns 400 when uploadId is missing", async () => {
    const res = await getUploadStatus({ pathParameters: {} });

    expect(res.statusCode).toBe(400);
  });
});

// processUpload

describe("processUpload", () => {
  const makeEvent = (key, size) => ({
    Records: [{
      messageId: "msg-1",
      body: JSON.stringify({
        Records: [{ s3: { bucket: { name: "test-bucket" }, object: { key, size } } }],
      }),
    }],
  });

  test("marks upload as DONE in DynamoDB", async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentType: "image/jpeg" });
    dynamoMock.on(UpdateItemCommand).resolves({});

    await processUpload(makeEvent("uploads/mock-upload-id", 1024));

    const calls = dynamoMock.commandCalls(UpdateItemCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.ExpressionAttributeValues[":s"].S).toBe("DONE");
  });

  test("skips S3 test events", async () => {
    const event = { Records: [{ messageId: "msg-1", body: JSON.stringify({ Event: "s3:TestEvent" }) }] };

    await processUpload(event);

    expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(0);
  });

  test("throws on error so SQS retries", async () => {
    s3Mock.on(HeadObjectCommand).rejects(new Error("S3 down"));

    await expect(processUpload(makeEvent("uploads/mock-upload-id", 100))).rejects.toThrow("S3 down");
  });
});