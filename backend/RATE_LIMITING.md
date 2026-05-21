# Rate Limiting Implementation

## Overview

This backend implements two-tier rate limiting to protect against DoS attacks and abuse:
1. **REST API rate limiting** (via `express-rate-limit`)
2. **WebSocket event rate limiting** (custom `SocketRateLimiter`)

## REST API Rate Limits

### General Limiter
- **Window:** 1 minute
- **Limit:** 100 requests per IP
- **Applies to:** All endpoints except `/messages` POST

### Message Limiter
- **Window:** 1 minute
- **Limit:** 60 messages per IP (1 message/second sustained)
- **Applies to:** `POST /messages`

### Headers
Rate limit information is returned in response headers:
```
RateLimit-Limit: 100
RateLimit-Remaining: 87
RateLimit-Reset: 1716300120
```

## WebSocket Rate Limits

### Per-Event Limits (events per minute)

| Event | Limit | Rationale |
|-------|-------|-----------|
| `send_message` | 60 | 1 message/second (DM spam protection) |
| `send_group_message` | 60 | 1 message/second (group spam protection) |
| `share_group_key` | 10 | Key sharing is infrequent |
| `request_group_key` | 5 | Recovery operation, not frequent |
| `add_reaction` | 30 | Reactions happen in bursts |
| `typing` | 20 | Typing indicators fire frequently |
| `messages_read` | 10 | Read receipts batch well |
| `group_messages_read` | 10 | Group read receipts |
| `join_conversation` | 100 | Room joins are safe |
| `leave_conversation` | 100 | Room leaves are safe |
| `join_group_room` | 100 | Group room joins |
| `leave_group_room` | 100 | Group room leaves |
| **All other events** | 100 | Default fallback |

### Implementation Details

**File:** `src/socketRateLimit.js`

**How it works:**
1. Each socket.id gets its own rate limit windows (Map of event -> count)
2. Windows reset every 60 seconds
3. When an event is emitted:
   - Check if `count < max` for this event
   - If yes: increment and allow
   - If no: reject and emit `error` event back to client
4. On disconnect: cleanup rate limit data for that socket

**Memory management:**
- Automatic cleanup on socket disconnect
- Periodic stale data cleanup every 5 minutes (prevents leaks from ungraceful disconnects)

## Client-Side Handling

When a rate limit is exceeded, the client receives an error event:

```javascript
socket.on('error', ({ message }) => {
  // message: "Rate limit exceeded for send_message"
  // Show user-friendly error
});
```

**Recommended client behavior:**
- Show toast: "You're sending messages too quickly. Please slow down."
- Disable send button for 5 seconds
- Queue messages and send with exponential backoff

## Testing Rate Limits

### Manual Testing

**REST API:**
```bash
# Trigger general limiter (101+ requests in 1 minute)
for i in {1..105}; do
  curl http://localhost:3001/health &
done

# Should see HTTP 429 after request 101
```

**WebSocket:**
```javascript
// In browser console (connected to backend)
for (let i = 0; i < 65; i++) {
  socket.emit('send_message', {
    conversationId: 'test',
    encrypted: 'spam',
    nonce: 'spam',
    sender: 'test',
    timestamp: Date.now()
  });
}
// Should see error event after message 61
```

### Load Testing

Use `artillery` for load testing:

```yaml
# rate-limit-test.yml
config:
  target: "http://localhost:3001"
  phases:
    - duration: 60
      arrivalRate: 5  # 5 users/second
scenarios:
  - name: "Spam messages"
    engine: socketio
    flow:
      - emit:
          channel: "send_message"
          data:
            conversationId: "test"
            encrypted: "test"
            nonce: "test"
            sender: "test"
            timestamp: "{{ $timestamp }}"
```

```bash
npm install -g artillery
artillery run rate-limit-test.yml
```

## Tuning Recommendations

### For Development
Current limits are reasonable for testing. No changes needed.

### For Production
Based on real usage patterns, consider:

1. **Lower message limits during onboarding:**
   - New users (< 24 hours old): 30 messages/min
   - Established users: 60 messages/min

2. **Adjust for scale:**
   - Monitor `socketRateLimiter.limits.size` (memory usage)
   - If > 10K concurrent sockets, reduce window size to 30s

3. **Add per-user limits (not just per-socket):**
   - Track by `socket.publicKey` instead of `socket.id`
   - Prevents multi-socket abuse

## Metrics to Monitor

1. **Rate limit hits:**
   - Log: `⚠️ Rate limit exceeded: <pubkey> (<event>)`
   - Metric: Count by event type, by user
   - Alert if > 100 hits/hour (indicates attack or bug)

2. **Memory usage:**
   - `socketRateLimiter.limits.size` (number of tracked sockets)
   - `process.memoryUsage().heapUsed`
   - Alert if > 500MB (leak or scale issue)

3. **Response times:**
   - Rate limiter adds ~0.1ms per request (negligible)
   - Monitor `/health` latency as baseline

## Security Considerations

### What This Protects Against
- ✅ Message spam (DM and group)
- ✅ DoS via WebSocket event flooding
- ✅ Resource exhaustion (CPU, memory, DB connections)
- ✅ REST endpoint abuse

### What This Does NOT Protect Against
- ❌ Distributed attacks (multiple IPs) — need WAF/Cloudflare
- ❌ Slow-rate attacks (59 messages/min forever) — need account-level quotas
- ❌ Amplification attacks (1 msg → N recipients) — need group size limits
- ❌ Large payload attacks — need input validation (separate fix)

### Next Steps for Hardening
1. Add input validation (max payload sizes)
2. Implement account-level daily quotas
3. Add WAF in front of backend (Cloudflare, AWS WAF)
4. Rate limit by wallet address, not just IP/socket

## Configuration

Rate limits are hardcoded in `src/index.js` and `src/socketRateLimit.js`.

To make configurable, add environment variables:

```javascript
const MESSAGE_RATE_LIMIT = parseInt(process.env.MESSAGE_RATE_LIMIT || '60');
const GENERAL_RATE_LIMIT = parseInt(process.env.GENERAL_RATE_LIMIT || '100');
```

Then update Docker/Fly.io config:
```toml
# fly.toml
[env]
  MESSAGE_RATE_LIMIT = "60"
  GENERAL_RATE_LIMIT = "100"
```

## Acknowledgments

- REST rate limiting: [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit)
- WebSocket rate limiting: Custom implementation (MIT license)
