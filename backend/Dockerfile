FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --production

# Copy source code
COPY src/ ./src/

# Expose port
EXPOSE 3001

# Start server
CMD ["node", "src/index.js"]
