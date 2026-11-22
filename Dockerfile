# שרת המשחק (Node + WebSocket) כקונטיינר - מתאים ל-Render / Fly.io / Railway / כל שרת עם Docker.
# השרת מגיש גם את האתר עצמו, ולכן אפשר להיכנס ישירות לכתובת שלו ולשחק.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.html vercel.json config.js ./
COPY css ./css
COPY js ./js
COPY server ./server
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server/server.mjs"]
