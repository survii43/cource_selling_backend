# Course selling backend (microservices)

**Product scope and backend plan:** [`docs/PRODUCT_REQUIREMENTS_AND_PLAN.md`](docs/PRODUCT_REQUIREMENTS_AND_PLAN.md) (single source of truth; do not duplicate elsewhere).

**Run locally:** `npm install`, copy each service `env.example` to that service’s `.env` (use the **same** `INTERNAL_API_KEY` value on catalog, orders, and courses), `docker compose up -d mysql`, `npm run dev`.

MySQL from Docker is mapped to host port **3307** (see `docker-compose.yml`) so it does not clash with another database on **3306**. Set `MYSQL_PORT=3307` in each service `.env`.

**Gateway health:** http://localhost:8080/health

**HTTP API:** see section 6 in [`docs/PRODUCT_REQUIREMENTS_AND_PLAN.md`](docs/PRODUCT_REQUIREMENTS_AND_PLAN.md).
