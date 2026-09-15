import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true });

app.get('/api/hello', async () => {
  return { message: 'Hello from Fastify', time: new Date().toISOString() };
});

app.register(fastifyStatic, {
  root: path.join(__dirname, 'client', 'dist'),
  index: 'index.html',
});

app.setNotFoundHandler((req, reply) => {
  if (req.raw.url && req.raw.url.startsWith('/api')) {
    reply.code(404).send({ error: 'Not found' });
    return;
  }
  reply.sendFile('index.html');
});

const port = process.env.PORT || 3000;
app.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
