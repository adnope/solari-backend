# Solari Backend

## Prerequisites
Ensure you have the following installed on your system:
* [Bun](https://bun.com/)
* [Docker & Docker Compose](https://www.docker.com/)
* [FFmpeg](https://www.ffmpeg.org/) (included in PATH)

---

## 1. Environment variables
Create a `.env` file in the root directory of the project and define the following variables:

### Database configuration (PostgreSQL)
| Variable | Description | Default |
| :--- | :--- | :--- |
| `POSTGRES_HOST` | The host of the PostgreSQL database. | `localhost` |
| `POSTGRES_PORT` | The port to connect to the database. | `5432` |
| `POSTGRES_DB` | The name of the database. | - |
| `POSTGRES_USER` | The database user. | - |
| `POSTGRES_PASSWORD` | The database password. | - |
| `PG_POOL_SIZE` | Connection pool size for the Postgres client. | `10` |

### Storage configuration (MinIO)
| Variable | Description | Default |
| :--- | :--- | :--- |
| `MINIO_HOST` | The host of the MinIO instance. | `localhost` |
| `MINIO_PORT` | The API port for MinIO. | `9000` |
| `MINIO_WEBCONSOLE_PORT` | The port for the MinIO web dashboard. | `9001` |
| `MINIO_BUCKET_NAME` | The default storage bucket name. | `solari-media` |
| `MINIO_ROOT_USER` | The root username for MinIO. | - |
| `MINIO_ROOT_PASSWORD` | The root password for MinIO. | - |

### Application configuration
| Variable | Description | Default |
| :--- | :--- | :--- |
| `SERVER_PORT` | The port the Deno API server will listen on. | `5050` |
| `JWT_SECRET` | Secret key used to sign JSON Web Tokens. | - |
| `ACCESS_TOKEN_EXPIRES_IN`| Expiration time for JWTs (e.g., `15m`, `7d`). | - |

---

## 2. Start docker containers
Initialize the PostgreSQL database and MinIO storage containers in the background:
```bash
docker compose up -d
```

## 3. Initialize database & storage
Run the migration script to set up the necessary database tables and create the MinIO storage bucket:
```bash
bun run migrate
```

## 4. Run the server
Start the development server. The backend will listen on the SERVER_PORT specified in your .env file:
```bash
bun run dev
```