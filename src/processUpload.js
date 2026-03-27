const { S3Client, GetObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");

const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});

const TABLE = process.env.TABLE_NAME;

/**
 * Triggered by SQS, which receives S3 event notifications.
 * 
 * Flow:
 *   S3 upload → S3 event notification → SQS message → this Lambda
 */
exports.handler = async (event) => {
  // SQS can batch records — we handle each independently
  for (const sqsRecord of event.Records) {
    try {
      const s3Event = JSON.parse(sqsRecord.body);

      // S3 sends a test event when the notification is first configured
      if (s3Event.Event === "s3:TestEvent") {
        console.log("Skipping S3 test event");
        continue;
      }

      for (const s3Record of s3Event.Records) {
        const bucket = s3Record.s3.bucket.name;
        const key = decodeURIComponent(s3Record.s3.object.key.replace(/\+/g, " "));
        const fileSize = s3Record.s3.object.size; // bytes

        const uploadId = key.split("/")[1];
        if (!uploadId) {
          console.warn("Cannot parse uploadId from key:", key);
          continue;
        }

        console.log(`Processing upload ${uploadId}, key=${key}, size=${fileSize}`);

        const head = await s3.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key })
        );
        const contentType = head.ContentType || "application/octet-stream";

        // Here we do a simple line count for text files, otherwise report byte size.
        let processingResult = {};
        if (contentType.startsWith("text/")) {
          const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          const text = await streamToString(obj.Body);
          processingResult = {
            lineCount: text.split("\n").length,
            charCount: text.length,
          };
        } else {
          processingResult = { byteCount: fileSize };
        }

        const processedAt = new Date().toISOString();

        // Update DynamoDB — mark DONE with file metadata
        await dynamo.send(
          new UpdateItemCommand({
            TableName: TABLE,
            Key: { uploadId: { S: uploadId } },
            UpdateExpression:
              "SET #s = :s, fileKey = :fk, fileSize = :fs, contentType = :ct, processedAt = :pa, processingResult = :pr",
            ExpressionAttributeNames: { "#s": "status" }, // "status" is a reserved word
            ExpressionAttributeValues: {
              ":s": { S: "DONE" },
              ":fk": { S: key },
              ":fs": { N: String(fileSize) },
              ":ct": { S: contentType },
              ":pa": { S: processedAt },
              ":pr": { S: JSON.stringify(processingResult) },
            },
          })
        );

        console.log(`Upload ${uploadId} marked DONE`);
      }
    } catch (err) {
      console.error("processUpload error for record:", sqsRecord.messageId, err);
      // Re-throw so SQS marks the message as failed (triggers retry / DLQ)
      throw err;
    }
  }
};

// Helper: convert a Node.js Readable stream to a string
function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}