const { DynamoDBClient, GetItemCommand } = require("@aws-sdk/client-dynamodb");

const dynamo = new DynamoDBClient({});
const TABLE = process.env.TABLE_NAME;

/**
 * GET /uploads/{uploadId}
 *
 * Returns the DynamoDB record for the given uploadId.
 * Poll this endpoint after uploading to know when processing is DONE.
 *
 * Possible status values:
 *   PENDING  — upload record created, file not yet received
 *   DONE     — file processed, metadata available
 *   (future) ERROR — processing failed
 */
exports.handler = async (event) => {
  const { uploadId } = event.pathParameters;

  if (!uploadId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing uploadId" }),
    };
  }

  try {
    const result = await dynamo.send(
      new GetItemCommand({
        TableName: TABLE,
        Key: { uploadId: { S: uploadId } },
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Upload not found" }),
      };
    }

    // Flatten DynamoDB's typed format { S: "value" } → plain strings
    const item = result.Item;
    const record = {
      uploadId: item.uploadId?.S,
      status: item.status?.S,
      createdAt: item.createdAt?.S,
      contentType: item.contentType?.S,
      // Fields only present after processing is DONE:
      fileKey: item.fileKey?.S,
      fileSize: item.fileSize?.N ? Number(item.fileSize.N) : undefined,
      processedAt: item.processedAt?.S,
      processingResult: item.processingResult?.S
        ? JSON.parse(item.processingResult.S)
        : undefined,
    };

    // Strip undefined fields for a cleaner response
    Object.keys(record).forEach((k) => record[k] === undefined && delete record[k]);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    };
  } catch (err) {
    console.error("getUploadStatus error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to get upload status" }),
    };
  }
};