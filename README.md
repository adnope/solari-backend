# Solari Backend

## Prerequisites

- [Bun](https://bun.com/)
- [Docker and Docker Compose](https://www.docker.com/)

## 1. Environment Variables

Create the .env file from the example:

```bash
cp .env.example .env
```

Fill all empty values before starting the stack.

### PostgreSQL Database

The application first tries `POSTGRES_DATABASE_URL`. If it is empty or the connection fails, it builds a connection URL from the individual `POSTGRES_*` parameters.

| Variable                | Description                                                                                                                                  | Example/default |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- | :-------------- |
| `POSTGRES_DATABASE_URL` | PostgreSQL connection URL. If this is empty or the connection fails, it builds a connection URL from the individual `POSTGRES_*` parameters. | Null            |
| `POSTGRES_HOST`         | PostgreSQL hostname used by the API, worker, and migration container. Use `db` with Docker Compose.                                          | `db`            |
| `POSTGRES_DB`           | Database name created by the PostgreSQL container.                                                                                           | Required        |
| `PG_POOL_SIZE`          | Maximum PostgreSQL connections used by the application pool.                                                                                 | `30`            |
| `POSTGRES_USER`         | PostgreSQL username.                                                                                                                         | Required        |
| `POSTGRES_PASSWORD`     | PostgreSQL password.                                                                                                                         | Required        |
| `POSTGRES_HOST_PORT`    | Host port published by Docker Compose for local access to PostgreSQL.                                                                        | `5432`          |
| `POSTGRES_PORT`         | PostgreSQL port inside the Docker network. Keep this aligned with the database container listener.                                           | `5432`          |

### S3 Object Storage

The backend uses an S3-compatible object store for media uploads. Docker Compose runs MinIO locally, but the same client can connect to any S3-compatible provider.

The S3 client checks bucket access on startup. If `S3_CREATE_BUCKET_IF_MISSING=true`, it tries to create the bucket when the check fails. Otherwise, startup fails when the bucket is inaccessible. Keep auto-creation disabled for external or production providers unless the credentials are allowed to create buckets.

| Variable                      | Description                                                                                                                                   | Example/default               |
| :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------- |
| `S3_BUCKET_NAME`              | Bucket used for uploaded media. This is required.                                                                                             | `solari-media`                |
| `S3_REGION`                   | S3 region used for request signing and AWS endpoint resolution.                                                                               | `us-east-1`                   |
| `S3_ENDPOINT`                 | Optional S3 API endpoint. Leave empty for AWS S3 so the SDK derives the endpoint from `S3_REGION`. Required for most S3-compatible providers. | `https://example.com`         |
| `S3_PRESIGN_ENDPOINT`         | Optional S3 API endpoint used when generating presigned upload/download URLs. Falls back to `S3_ENDPOINT` when empty.                         | `https://storage.example.com` |
| `S3_PUBLIC_ASSET_URL`         | Optional public CDN or asset base URL for future public object URLs. It is not used for presigned URLs.                                       | `https://cdn.example.com`     |
| `S3_ACCESS_KEY_ID`            | S3 access key ID.                                                                                                                             | Required                      |
| `S3_SECRET_ACCESS_KEY`        | S3 secret access key.                                                                                                                         | Required                      |
| `S3_FORCE_PATH_STYLE`         | Uses path-style bucket URLs when `true`. Use `true` for MinIO and many local/S3-compatible providers; use `false` for AWS S3.                 | `false`                       |
| `S3_CREATE_BUCKET_IF_MISSING` | Creates the bucket on startup if the access check fails. Use `true` for local MinIO, and usually `false` for external providers.              | `false`                       |

Examples:

For local Docker Compose with MinIO, use:

```env
S3_BUCKET_NAME=solari-media
S3_REGION=us-east-1
S3_ENDPOINT=http://s3:9000
S3_PRESIGN_ENDPOINT=http://127.0.0.1:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
S3_CREATE_BUCKET_IF_MISSING=true
```

For AWS S3, leave `S3_ENDPOINT` and `S3_PRESIGN_ENDPOINT` empty unless you intentionally use a custom S3-compatible endpoint:

```env
S3_BUCKET_NAME=solari-media-prod
S3_REGION=ap-southeast-1
S3_ENDPOINT=
S3_PRESIGN_ENDPOINT=
S3_FORCE_PATH_STYLE=false
S3_CREATE_BUCKET_IF_MISSING=false
```

### API Server

| Variable        | Description                                                                                             | Example/default |
| :-------------- | :------------------------------------------------------------------------------------------------------ | :-------------- |
| `API_HOST_PORT` | Host port published by Docker Compose for the API container. The container listens on port `5050`.      | `5050`          |
| `SERVER_ENV`    | Docker build target used by Compose. Use `dev` for local development and `prod` for production runtime. | `dev`           |

The current Compose file maps `127.0.0.1:${API_HOST_PORT:-5050}` to container port `5050`.

### Authentication

| Variable                  | Description                                                   | Example/default        |
| :------------------------ | :------------------------------------------------------------ | :--------------------- |
| `JWT_SECRET`              | Secret used to sign access tokens. Use a strong random value. | Required               |
| `ACCESS_TOKEN_EXPIRES_IN` | Access token lifetime, such as `15m`, `30m`, `1h`, or `7d`.   | `30m`                  |
| `REFRESH_TOKEN_TTL_MS`    | Refresh token/session lifetime in milliseconds.               | `1209600000` (14 days) |

### Firebase Cloud Messaging

| Variable         | Description                                      | Example/default |
| :--------------- | :----------------------------------------------- | :-------------- |
| `FCM_PROJECT_ID` | Firebase project ID used for push notifications. | Required        |

Create `firebase-service-account.json` in the project root:

1. Open Firebase Project settings.
2. Open Service accounts.
3. Generate a new private key with Node.js selected.
4. Rename the downloaded JSON file to `firebase-service-account.json`.

### SMTP Transport

| Variable    | Description                                                               | Example/default |
| :---------- | :------------------------------------------------------------------------ | :-------------- |
| `SMTP_HOST` | SMTP server hostname, such as `smtp.gmail.com` or `smtp.sendgrid.net`.    | Required        |
| `SMTP_PORT` | SMTP server port. Common values are `587` for STARTTLS and `465` for SSL. | Required        |
| `SMTP_USER` | SMTP username.                                                            | Required        |
| `SMTP_PASS` | SMTP password or provider-specific app password.                          | Required        |
| `SMTP_FROM` | Default sender address for outgoing emails.                               | Required        |

### Google Sign-In

| Variable           | Description                                  | Example/default |
| :----------------- | :------------------------------------------- | :-------------- |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID used for Google sign-in. | Required        |

### Redis Cache and Queue

| Variable          | Description                                                                                | Example/default |
| :---------------- | :----------------------------------------------------------------------------------------- | :-------------- |
| `REDIS_HOST_PORT` | Host port published by Docker Compose for local access to Redis.                           | `6379`          |
| `REDIS_HOST`      | Redis hostname used by the API and worker. Use `redis` with Docker Compose.                | `redis`         |
| `REDIS_PORT`      | Redis port inside the Docker network. Keep this aligned with the Redis container listener. | `6379`          |

## 2. Start Services

Start the stack:

```bash
docker compose up -d
```

The API health endpoint is available on the host at:

```text
http://127.0.0.1:${API_HOST_PORT}/health
```

## 3. Production Reverse Proxy

In production, expose HTTPS through a reverse proxy:

```text
api.example.com:443     -> 127.0.0.1:5050
storage.example.com:443 -> 127.0.0.1:9000
```

Set:

```env
S3_PRESIGN_ENDPOINT=https://storage.example.com
```
