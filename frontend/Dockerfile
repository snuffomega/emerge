FROM node:20-alpine AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --ignore-engines
COPY . .
RUN rm -f .env
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN yarn vite build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
