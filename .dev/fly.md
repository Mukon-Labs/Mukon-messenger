# Fly.io Deployment Guide

## Current Setup

**App**: `backend-rough-bird-7310`
**URL**: https://backend-rough-bird-7310.fly.dev
**Region**: Singapore (sin)
**Machines**: 2 instances (high availability)
**Memory**: 1GB per machine
**Storage**: In-memory (Maps) - **NOT PERSISTENT**

## Zero-Downtime Deployments

Good news - **Fly.io already does rolling deployments** (just like Cloud Run)!

When you run `fly deploy`:
1. Builds new Docker image
2. Starts new machine with updated code
3. Health checks pass (`/health` endpoint)
4. Routes traffic to new machine
5. Drains old machine gracefully
6. Shuts down old machine

**Result**: Zero downtime, seamless updates! ✅

### The Problem: In-Memory Storage

Current backend uses JavaScript Maps for storage:
```javascript
const messages = new Map();           // DM messages
const groupMessages = new Map();      // Group messages
const readReceipts = new Map();       // Read status
const groupAvatars = new Map();       // Group avatars
const onlineUsers = new Map();        // Who's connected
```

**What happens on deployment:**
- ✅ No service outage (rolling deploy)
- ❌ All data is lost (new process = empty Maps)
- ❌ Messages disappear
- ❌ Read receipts reset
- ❌ Group avatars gone

**Why**: Each machine has its own memory. When you deploy, new machines start with fresh memory.

## The Solution: Add a Database

### Option 1: Fly.io Postgres (Recommended)

**Pros:**
- Fully managed (automatic backups)
- Same region as app (low latency)
- Persistent storage
- Scales with your app
- Free tier: 3GB storage, shared CPU

**Setup:**
```bash
# Create Postgres cluster
fly postgres create --name mukon-db --region sin

# Attach to app (sets DATABASE_URL env var)
fly postgres attach mukon-db -a backend-rough-bird-7310

# Check connection
fly postgres connect -a mukon-db
```

**Cost**: Free tier (3GB) → ~$2/month (10GB) → ~$10/month (50GB)

### Option 2: Fly.io Redis (For Caching + Real-time)

**Use case**: Fast ephemeral data (online users, typing indicators)

**Setup:**
```bash
fly redis create --name mukon-redis --region sin
fly redis attach mukon-redis -a backend-rough-bird-7310
```

**Cost**: ~$1/month (100MB) → ~$5/month (1GB)

### Option 3: Hybrid (Best for Production)

- **Postgres**: Messages, read receipts, group data (persistent)
- **Redis**: Online users, typing indicators, rate limiting (ephemeral)

## Migration Plan

### Phase 1: Hackathon (Current)
- In-memory storage (acceptable for demo)
- Data loss on redeploy (not critical)
- Fast, simple, free

### Phase 2: Production Launch
```bash
# 1. Create database
fly postgres create --name mukon-db --region sin
fly postgres attach mukon-db -a backend-rough-bird-7310

# 2. Update backend code
# - Replace Map() with Postgres queries
# - Add connection pooling (pg library)
# - Add migrations (schema management)

# 3. Deploy with database
fly deploy  # Zero downtime!
```

### Code Changes Needed

**Install dependencies:**
```bash
cd backend
npm install pg  # Postgres client
```

**Add database connection:**
```javascript
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Example: Store message
await pool.query(
  'INSERT INTO messages (id, conversation_id, sender, encrypted, nonce, timestamp) VALUES ($1, $2, $3, $4, $5, $6)',
  [messageId, conversationId, sender, encrypted, nonce, timestamp]
);

// Example: Get messages
const result = await pool.query(
  'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC',
  [conversationId]
);
```

**Create schema:**
```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  encrypted TEXT NOT NULL,
  nonce TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  type TEXT DEFAULT 'message',
  reply_to TEXT,
  reactions JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE group_messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  encrypted TEXT NOT NULL,
  nonce TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  reactions JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE read_receipts (
  conversation_id TEXT NOT NULL,
  reader_pubkey TEXT NOT NULL,
  latest_timestamp BIGINT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (conversation_id, reader_pubkey)
);

CREATE TABLE group_avatars (
  group_id TEXT PRIMARY KEY,
  avatar TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_group_messages_group ON group_messages(group_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
```

## Common Commands

```bash
# Deploy (zero downtime)
fly deploy

# View logs
fly logs

# Live tail logs
fly logs -f

# Check status
fly status

# Check machine health
fly machine list

# SSH into machine
fly ssh console

# Restart app
fly apps restart backend-rough-bird-7310

# Scale memory
fly scale memory 512  # or 1024, 2048

# Scale machines (for more traffic)
fly scale count 3  # Add more machines

# Check secrets
fly secrets list

# Set secret
fly secrets set DATABASE_URL=postgresql://...

# Database commands (after Postgres setup)
fly postgres connect -a mukon-db
fly postgres db list -a mukon-db
```

## Monitoring

### Health Checks
- Endpoint: `GET /health`
- Interval: 15s
- Timeout: 2s
- Configured in `fly.toml`

### Logs
```bash
# Real-time logs
fly logs -f

# Filter by level
fly logs | grep ERROR

# Export logs
fly logs > logs.txt
```

### Metrics (Free Dashboard)
```bash
fly dashboard  # Opens web dashboard
```

Shows:
- Request rate
- Response time
- Error rate
- Memory usage
- CPU usage

## Deployment Workflow

### Dev → Production
```bash
# 1. Test locally
cd backend
npm start

# 2. Deploy to Fly.io
fly deploy

# 3. Verify
curl https://backend-rough-bird-7310.fly.dev/health

# 4. Watch logs
fly logs -f

# 5. Update client (if needed)
# app/src/config.ts already points to Fly.io in prod mode
```

## Cost Estimate

### Current (Hackathon)
- **2 machines** (256MB each): FREE
- **Bandwidth**: FREE (up to 160GB/month)
- **Total**: $0/month ✅

### Production (Small Scale)
- **2 machines** (1GB each): FREE (within allowance)
- **Postgres** (10GB): ~$2/month
- **Redis** (1GB): ~$5/month
- **Bandwidth**: FREE (up to 160GB)
- **Total**: ~$7/month

### Production (Medium Scale - 10k users)
- **4 machines** (2GB each): ~$20/month
- **Postgres** (50GB): ~$10/month
- **Redis** (5GB): ~$15/month
- **Total**: ~$45/month

Still way cheaper than AWS/GCP! 🎉

## Troubleshooting

### Deployment fails
```bash
# Check logs
fly logs

# Check build logs
fly deploy --verbose

# SSH and debug
fly ssh console
```

### WebSocket disconnections
- Check health endpoint: `curl https://backend-rough-bird-7310.fly.dev/health`
- Verify `auto_stop_machines = false` in fly.toml
- Check logs: `fly logs -f`

### High memory usage
```bash
# Scale up memory
fly scale memory 2048

# Or optimize code (add database to reduce in-memory storage)
```

### Database connection errors (after Postgres setup)
```bash
# Check DATABASE_URL is set
fly secrets list

# Test connection
fly postgres connect -a mukon-db

# Check connection pool
# Add to backend: console.log(pool.totalCount, pool.idleCount)
```

## Security

### Secrets Management
```bash
# Never commit secrets to git
# Use Fly.io secrets instead

fly secrets set JWT_SECRET=xxx
fly secrets set ADMIN_KEY=xxx
fly secrets set DATABASE_URL=postgresql://...

# Secrets are encrypted and injected as env vars
```

### HTTPS/WSS
- Automatic TLS certificates
- Force HTTPS enabled in fly.toml
- WebSocket automatically upgraded to WSS

## Backup & Disaster Recovery

### Database Backups (Postgres)
```bash
# Automatic daily backups (retained 7 days)
fly postgres backup list -a mukon-db

# Manual backup
fly postgres backup create -a mukon-db

# Restore from backup
fly postgres backup restore <backup-id> -a mukon-db
```

### Code Rollback
```bash
# List releases
fly releases

# Rollback to previous
fly releases rollback <release-id>
```

## Future Enhancements

### Separate Dev/Prod Instances
```bash
# Deploy dev instance
fly launch --name backend-rough-bird-7310-dev --region sin

# Update config.ts
export const BACKEND_URL = __DEV__
  ? 'https://backend-rough-bird-7310-dev.fly.dev'
  : 'https://backend-rough-bird-7310.fly.dev';
```

### Custom Domain
```bash
# Add custom domain
fly certs add messenger.mukon.app

# Update DNS (A/AAAA records)
# Point to Fly.io IPs shown in output
```

### Multi-Region Deployment
```bash
# Add Tokyo region for lower latency
fly regions add nrt

# Fly.io automatically routes users to nearest region
```

## Reference

- Docs: https://fly.io/docs
- Postgres: https://fly.io/docs/postgres
- Redis: https://fly.io/docs/reference/redis
- Pricing: https://fly.io/docs/about/pricing
- Status: https://status.fly.io
