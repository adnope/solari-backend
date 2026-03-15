# Solari Backend

## Prerequisites

Ensure you have the following installed on your system:

- [Bun](https://bun.com/)
- [Docker & Docker Compose](https://www.docker.com/)
- [FFmpeg](https://www.ffmpeg.org/) (included in PATH)

---

## 1. Environment Variables

Create a `.env` file in the root directory of the project and define the following variables.

---

### PostgreSQL Database

| Variable            | Description                                                                                                             | Default |
| :------------------ | :---------------------------------------------------------------------------------------------------------------------- | :------ |
| `POSTGRES_HOST`     | Hostname of the PostgreSQL server. When using Docker Compose this should be the service name of the database container. | `db`    |
| `POSTGRES_PORT`     | PostgreSQL port.                                                                                                        | `5432`  |
| `POSTGRES_DB`       | Name of the PostgreSQL database.                                                                                        | -       |
| `POSTGRES_USER`     | PostgreSQL username.                                                                                                    | -       |
| `POSTGRES_PASSWORD` | PostgreSQL password.                                                                                                    | -       |
| `PG_POOL_SIZE`      | Maximum number of database connections in the pool.                                                                     | `10`    |

### S3 Object Storage

The backend stores uploaded media using an S3-compatible storage service.

| Variable               | Description                                                                                                                   | Default          |
| :--------------------- | :---------------------------------------------------------------------------------------------------------------------------- | :--------------- |
| `S3_API_PORT`          | API port of the S3 service.                                                                                                   | `9000`           |
| `S3_ENDPOINT`          | Internal endpoint used by the backend container to communicate with the storage service. Should use the compose service name. | `http://s3:9000` |
| `S3_PUBLIC_ENDPOINT`   | Public endpoint used to serve media externally (usually the domain of your VPS).                                              | -                |
| `S3_REGION`            | S3 region identifier.                                                                                                         | `auto`           |
| `S3_BUCKET_NAME`       | Bucket used to store all media uploads.                                                                                       | -                |
| `S3_ACCESS_KEY_ID`     | S3 access key ID.                                                                                                             | -                |
| `S3_SECRET_ACCESS_KEY` | S3 secret access key.                                                                                                         | -                |

### Backend Server

| Variable      | Description                             | Default |
| :------------ | :-------------------------------------- | :------ |
| `SERVER_PORT` | Port the backend server will listen on. | `5050`  |
| `SERVER_ENV`  | Running mode of the backend server.     | `dev`   |

### Authentication

| Variable                  | Description                                                        | Default |
| :------------------------ | :----------------------------------------------------------------- | :------ |
| `JWT_SECRET`              | Secret used to sign access tokens. Must be a strong random string. | -       |
| `ACCESS_TOKEN_EXPIRES_IN` | Access token lifetime (example: 15m, 1h, 7d).                      | `30m`   |

### SMTP Transporter

| Variable    | Description                                                               | Default |
| :---------- | :------------------------------------------------------------------------ | :------ |
| `SMTP_HOST` | Hostname of the SMTP server (example: smtp.gmail.com, smtp.sendgrid.net). | -       |
| `SMTP_PORT` | Port for the SMTP connection (typically 587 for TLS or 465 for SSL).      | `587`   |
| `SMTP_USER` | Username or email address used to authenticate with the SMTP server.      | -       |
| `SMTP_PASS` | Password or app-specific password for the SMTP user.                      | -       |
| `SMTP_FROM` | The default "From" email address for outgoing emails (e.g., noreply@...). | -       |

### Google Sign-In (OAuth)

| Variable           | Description                                          | Default |
| :----------------- | :--------------------------------------------------- | :------ |
| `GOOGLE_CLIENT_ID` | The OAuth 2.0 Web Client ID used for Google sign in. | -       |

### Push Notifications (Firebase Cloud Messaging)

| Variable         | Description                                              |
| :--------------- | :------------------------------------------------------- |
| `FCM_PROJECT_ID` | Firebase project ID used for sending push notifications. |

Create a `firebase-service-account.json` file in the root directory. This file can be obtained by:

- Going to Firebase **Project settings**
- Open the tab **Service accounts**
- Choose **Generate new private key** with **Node.js** selected
- A json file will be downloaded, rename it to `firebase-service-account.json`

---

## 2. Start Docker Containers

Start the PostgreSQL database, S3 storage service and the API Server with docker compose. Default database is local Postgresql, and default s3 storage is minio.

```bash
docker compose up -d
```
