/**
 * Socket.IO Rate Limiting
 * Prevents abuse of WebSocket events (message spam, DoS attacks)
 */

class SocketRateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000; // 1 minute default
    this.limits = new Map(); // socketId -> { windows: Map<eventName, { count, resetAt }> }
    
    // Per-event rate limits (events per minute)
    this.maxPerEvent = {
      send_message: 60,              // 1 message/second sustained
      send_group_message: 60,
      share_group_key: 10,           // Key sharing is less frequent
      request_group_key: 5,
      add_reaction: 30,
      typing: 20,
      messages_read: 10,
      group_messages_read: 10,
      // More permissive for non-spam events
      join_conversation: 100,
      leave_conversation: 100,
      join_group_room: 100,
      leave_group_room: 100,
    };
    
    // Global defaults for unlisted events
    this.defaultMaxPerMin = options.defaultMaxPerMin || 100;
  }

  /**
   * Check if a socket can emit this event (rate limit check)
   * @param {string} socketId - Socket.IO socket.id
   * @param {string} eventName - Event name (e.g., 'send_message')
   * @returns {boolean} - true if allowed, false if rate limited
   */
  check(socketId, eventName) {
    const now = Date.now();
    const maxAllowed = this.maxPerEvent[eventName] || this.defaultMaxPerMin;

    // Get or create socket's rate limit windows
    if (!this.limits.has(socketId)) {
      this.limits.set(socketId, { windows: new Map() });
    }

    const socketData = this.limits.get(socketId);
    const window = socketData.windows.get(eventName) || { count: 0, resetAt: now + this.windowMs };

    // Reset window if expired
    if (now > window.resetAt) {
      window.count = 0;
      window.resetAt = now + this.windowMs;
    }

    // Check limit
    if (window.count >= maxAllowed) {
      return false; // Rate limited
    }

    // Increment and update
    window.count++;
    socketData.windows.set(eventName, window);
    return true;
  }

  /**
   * Clean up rate limit data for a disconnected socket
   * @param {string} socketId
   */
  cleanup(socketId) {
    this.limits.delete(socketId);
  }

  /**
   * Periodic cleanup of stale socket data (optional, prevents memory leaks)
   */
  cleanupStale() {
    const now = Date.now();
    for (const [socketId, data] of this.limits.entries()) {
      // If all windows for this socket have expired, remove the socket
      const hasActiveWindows = Array.from(data.windows.values()).some(
        w => w.resetAt > now
      );
      if (!hasActiveWindows) {
        this.limits.delete(socketId);
      }
    }
  }
}

module.exports = SocketRateLimiter;
