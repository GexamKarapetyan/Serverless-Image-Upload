# Image Upload API

Upload files to S3 and process them in the background using Lambda + SQS.

---

## How it works

1. Call `POST /uploads` → get back a pre-signed S3 URL and an `uploadId`
2. PUT your file directly to that URL (goes straight to S3, not through the API)
3. A background Lambda picks it up, reads the metadata, and saves the result
4. Call `GET /uploads/{uploadId}` to check if it's done

---

## Prerequisites

- Node.js 18+
- An AWS account
- AWS CLI installed and configured (`aws configure`)
- Serverless Framework (`npm install -g serverless`)

---

## Deploy

```bash
npm install
sls deploy
```

After deploy you'll see something like:

```
ApiEndpoint: https://abc123.execute-api.us-east-1.amazonaws.com
BucketName:  image-upload-api-uploads-dev
```

Save that URL — you'll need it for the curl commands below.

---

## Test it

Replace `$API` with your `ApiEndpoint` from above.

**1. Request an upload URL**

```bash
curl -s -X POST $API/uploads \
  -H "Content-Type: application/json" \
  -d '{"contentType":"text/plain"}' | tee /tmp/upload.json
```

You'll get back:

```json
{
  "uploadId": "abc-123",
  "uploadUrl": "https://s3.amazonaws.com/..."
}
```

**2. Upload a file to S3**

```bash
UPLOAD_URL=$(cat /tmp/upload.json | jq -r .uploadUrl)
UPLOAD_ID=$(cat /tmp/upload.json  | jq -r .uploadId)

curl -X PUT "$UPLOAD_URL" \
  -H "Content-Type: text/plain" \
  --data-binary "hello world"
```

**3. Check the status**

Wait a few seconds, then:

```bash
curl -s $API/uploads/$UPLOAD_ID | jq
```

While processing:
```json
{ "status": "PENDING" }
```

When done:
```json
{
  "status": "DONE",
  "fileSize": 11,
  "contentType": "text/plain",
  "processedAt": "2024-01-01T00:00:05.000Z",
  "processingResult": { "lineCount": 1, "charCount": 11 }
}
```

---

## Tear down

```bash
sls remove
```

Deletes everything from AWS so you don't get charged.