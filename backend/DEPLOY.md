# Fly.io Deployment Guide

## Prerequisites

1. Install flyctl:
```bash
brew install flyctl
```

2. Login to Fly.io:
```bash
fly auth login
```

## Initial Deployment

1. Navigate to backend directory:
```bash
cd backend
```

2. Launch the app (creates app but doesn't deploy):
```bash
fly launch --no-deploy
```

When prompted:
- App name: `mukon-backend` (or choose another)
- Region: `sin` (Singapore - closest to SE Asia)
- Postgres: No (using in-memory for MVP)
- Redis: No (not needed yet)

3. Deploy the app:
```bash
fly deploy
```

This will:
- Build the Docker image
- Push to Fly.io registry
- Deploy to Singapore region
- Start the app on port 3001

## Verify Deployment

1. Check app status:
```bash
fly status
```

2. Test health endpoint:
```bash
curl https://mukon-backend.fly.dev/health
```

Expected response:
```json
{"status":"ok","timestamp":1738368000000}
```

3. Check logs:
```bash
fly logs
```

## Client Configuration

The app is already configured to use Fly.io in production mode.

In `app/src/config.ts`:
```typescript
export const BACKEND_URL = __DEV__
  ? 'http://192.168.68.61:3001'  // Dev: Local IP
  : 'https://mukon-backend.fly.dev';  // Prod: Fly.io
```

## Testing with Multiple Devices

For hackathon testing, you can point dev mode to Fly.io too:

```typescript
// Temporary change for multi-device testing
export const BACKEND_URL = 'https://mukon-backend.fly.dev';
```

This allows both devices to connect to the same backend without needing local network access.

## Common Commands

```bash
# View logs in real-time
fly logs

# SSH into the machine
fly ssh console

# Scale up/down
fly scale count 1

# Restart the app
fly apps restart mukon-backend

# Check machine status
fly machine list

# Destroy the app (warning: permanent)
fly apps destroy mukon-backend
```

## Troubleshooting

### WebSocket connection issues

If WebSocket connections fail, check:

1. Fly.io supports WebSockets natively (no special config needed)
2. Client is using `https://` not `http://`
3. Socket.IO transports include both websocket and polling:
   ```javascript
   transports: ['websocket', 'polling']
   ```

### App won't stay running

The `auto_stop_machines = false` setting in `fly.toml` keeps machines running. WebSocket apps need persistent connections.

### Memory issues

If the app crashes due to memory:
```bash
fly scale memory 512  # Increase to 512MB
```

## Future Enhancements

1. **Database persistence**: Add Fly.io Postgres for message storage
   ```bash
   fly postgres create
   fly postgres attach
   ```

2. **Separate dev instance**: Deploy `mukon-backend-dev` for testing
   ```bash
   fly launch --name mukon-backend-dev
   ```

3. **Environment variables**: Add secrets
   ```bash
   fly secrets set JWT_SECRET=xxx
   ```

4. **Monitoring**: Set up health checks and alerts
   ```bash
   fly dashboard
   ```

## Cost Estimate

- **Free tier**: 3 shared-cpu-1x VMs with 256MB RAM (enough for MVP)
- **Hackathon**: Should be completely free
- **Production**: ~$5-10/month for small scale

## Notes

- The app uses in-memory storage (messages, read receipts, etc.)
- Data will be lost on restarts/deploys
- For hackathon submission, this is acceptable
- Add Postgres for production persistence
