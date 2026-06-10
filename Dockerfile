FROM node:22-bookworm

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      git \
      ca-certificates \
      openssh-client \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @alibaba-group/open-code-review

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN mkdir -p /data/repos /data/reviews /data/logs

EXPOSE 8080

CMD ["npm", "start"]