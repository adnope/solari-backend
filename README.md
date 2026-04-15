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

| Variable             | Description                                                                                              | Example/default |
| :------------------- | :------------------------------------------------------------------------------------------------------- | :-------------- |
| `POSTGRES_HOST`      | PostgreSQL hostname used by the API, worker, and migration container. Use `db` with Docker Compose.      | `db`            |
| `POSTGRES_DB`        | Database name created by the PostgreSQL container.                                                       | Required        |
| `PG_POOL_SIZE`       | Maximum PostgreSQL connections used by the application pool.                                             | `30`            |
| `POSTGRES_USER`      | PostgreSQL username.                                                                                     | Required        |
| `POSTGRES_PASSWORD`  | PostgreSQL password.                                                                                     | Required        |
| `POSTGRES_HOST_PORT` | Host port published by Docker Compose for local access to PostgreSQL.                                    | `5432`          |
| `POSTGRES_PORT`      | PostgreSQL port inside the Docker network. Keep this aligned with the database container listener.       | `5432`          |

### S3 Object Storage

The backend uses an S3-compatible object store for media uploads. Docker Compose runs MinIO as the local S3 service.

| Variable               | Description                                                                                         | Example/default         |
| :--------------------- | :-------------------------------------------------------------------------------------------------- | :---------------------- |
| `S3_HOST_PORT`         | Host port published by Docker Compose for local access to MinIO's S3 API.                           | `9000`                  |
| `S3_API_PORT`          | MinIO S3 API port inside the Docker network.                                                        | `9000`                  |
| `S3_ENDPOINT`          | Internal endpoint used by the API and worker. Use the Compose service name when running in Docker.  | `http://s3:9000`        |
| `S3_PUBLIC_ENDPOINT`   | Public endpoint embedded in presigned upload/download URLs returned to clients.                     | `https://example.com`   |
| `S3_REGION`            | S3 region identifier. MinIO accepts arbitrary region names; `auto` is fine for local development.   | `auto`                  |
| `S3_BUCKET_NAME`       | Bucket used for all uploaded media.                                                                 | Required                |
| `S3_ACCESS_KEY_ID`     | MinIO root user / S3 access key ID.                                                                 | Required                |
| `S3_SECRET_ACCESS_KEY` | MinIO root password / S3 secret access key.                                                         | Required                |

For Docker Compose, `S3_ENDPOINT` should usually stay internal, for example `http://s3:9000`. `S3_PUBLIC_ENDPOINT` must be reachable by the actual client consuming presigned URLs. On a server, prefer an HTTPS reverse-proxy domain such as `https://storage.example.com` routed to the MinIO S3 API host port.

### API Server

| Variable        | Description                                                                                              | Example/default |
| :-------------- | :------------------------------------------------------------------------------------------------------- | :-------------- |
| `API_HOST_PORT` | Host port published by Docker Compose for the API container. The container listens on port `5050`.       | `5050`          |
| `SERVER_ENV`    | Docker build target used by Compose. Use `dev` for local development and `prod` for production runtime.  | `dev`           |

The current Compose file maps `127.0.0.1:${API_HOST_PORT:-5050}` to container port `5050`.

### Authentication

| Variable                  | Description                                                        | Example/default |
| :------------------------ | :----------------------------------------------------------------- | :-------------- |
| `JWT_SECRET`              | Secret used to sign access tokens. Use a strong random value.      | Required        |
| `ACCESS_TOKEN_EXPIRES_IN` | Access token lifetime, such as `15m`, `30m`, `1h`, or `7d`.        | `30m`           |

### Firebase Cloud Messaging

| Variable         | Description                                                | Example/default |
| :--------------- | :--------------------------------------------------------- | :-------------- |
| `FCM_PROJECT_ID` | Firebase project ID used for push notifications.           | Required        |

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

| Variable           | Description                                          | Example/default |
| :----------------- | :--------------------------------------------------- | :-------------- |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID used for Google sign-in.         | Required        |

### Redis Cache and Queue

| Variable          | Description                                                                                         | Example/default |
| :---------------- | :-------------------------------------------------------------------------------------------------- | :-------------- |
| `REDIS_HOST_PORT` | Host port published by Docker Compose for local access to Redis.                                    | `6379`          |
| `REDIS_HOST`      | Redis hostname used by the API and worker. Use `redis` with Docker Compose.                         | `redis`         |
| `REDIS_PORT`      | Redis port inside the Docker network. Keep this aligned with the Redis container listener.          | `6379`          |

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
S3_PUBLIC_ENDPOINT=https://storage.example.com
```