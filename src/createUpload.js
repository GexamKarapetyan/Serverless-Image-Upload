const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb");
const { v4: uuidv4 } = require("uuid");

const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});

const BUCKET = process.env.BUCKET_NAME;
const TABLE = process.env.TABLE_NAME;
const URL_EXPIRY_SECONDS = 300; // 5 minutes to complete the upload

/**
 * POST /uploads
 * 
 * Body (optional): { "contentType": "image/jpeg" }
 * 
 * Returns:
 *   { uploadId, uploadUrl }
 */
exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const contentType = body.contentType || "application/octet-stream";

    const uploadId = uuidv4();
    const s3Key = `uploads/${uploadId}`;
    const now = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days

    // Generate a pre-signed PUT URL
    // The client will PUT the file directly to this URL — no Lambda middleman.
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
        ContentType: contentType,
      }),
      { expiresIn: URL_EXPIRY_SECONDS }
    );

    await dynamo.send(
      new PutItemCommand({
        TableName: TABLE,
        Item: {
          uploadId: { S: uploadId },
          status: { S: "PENDING" },
          createdAt: { S: now },
          contentType: { S: contentType },
          ttl: { N: String(ttl) },
        },
      })
    );

    return {
      statusCode: 201,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId, uploadUrl }),
    };
  } catch (err) {
    console.error("createUpload error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to create upload" }),
    };
  }
};