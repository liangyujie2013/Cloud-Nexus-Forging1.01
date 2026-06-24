# Cloud Nexus Forging (CNF)

Cloud Nexus Forging is an enterprise-grade distributed virtualization management platform that provides unified control over compute, storage, network, and availability resources through a single, coherent web console.

## Overview

CNF delivers a complete operations workflow for private-cloud and virtualization environments — from datacenter and cluster topology down to individual virtual machines, storage pools, virtual networks, and GPU resources. The interface follows a clean, consistent design language and is fully bilingual (English / 简体中文).

## Key Capabilities

- **Infrastructure** — Datacenter, cluster, and host management with a four-tier topology model.
- **Compute** — Virtual machine lifecycle, templates, images, and live migration.
- **Storage** — Storage pool provisioning (local / NFS / iSCSI / FC / distributed), volume allocation, and snapshot management with cascade-safety constraints.
- **Networking** — Virtual switches, VLANs, NIC bonding, and interactive network topology.
- **Availability** — High-availability policies, migration, and recovery workflows.
- **Monitoring** — Cluster KPI overview, system health scoring, real-time host/GPU metrics, time-series trend charts, and configurable alert rules.
- **Access Control** — Users, roles, and operation auditing.
- **System** — Platform configuration, licensing, and system information.

## Technology

- **Frontend** — Vue 3 (component-driven views), Chart.js for metrics visualization.
- **Backend** — Hono on the edge runtime, exposing a versioned REST API (`/api/v1`).
- **Real-time** — Server-Sent Events for live metric streaming.
- **Build & Deploy** — Vite SSR build, deployable to Cloudflare Pages.

## Getting Started

```bash
npm install      # install dependencies
npm run build    # produce the production bundle
npm run dev      # start the local development server (http://localhost:3000)
```

The REST API is served under `/api/v1`. Real-time metrics are available via the
SSE endpoint `/api/v1/monitoring/metrics/stream`.

## License

Proprietary. All product, brand, and trademark names referenced for hardware
remain the property of their respective owners.
