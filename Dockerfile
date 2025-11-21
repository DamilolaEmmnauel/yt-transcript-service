# Use official Node image
FROM node:20-bullseye

# Install yt-dlp (Python package)
RUN apt-get update && \
    apt-get install -y python3-pip && \
    pip3 install yt-dlp && \
    rm -rf /var/lib/apt/lists/*

# Set work directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of the app
COPY . .

# Railway will pass PORT, but default to 4000 for local consistency
ENV PORT=4000

# Start the server
CMD ["npm", "start"]
