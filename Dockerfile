FROM node:lts-alpine
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY --chown=node:node ["package.json", "package-lock.json*", "npm-shrinkwrap.json*", "./"]
COPY --chown=node:node vendor/npm ./vendor/npm
RUN npm ci --omit=dev
COPY --chown=node:node . .
EXPOSE 3000
USER node
CMD ["npm", "start"]
