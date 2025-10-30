import { loadDoc } from './crdt.js';
import { createHttpServer } from './http.js';
import { createWSServer } from './ws.js';

const PORT = Number(process.env.PORT ?? 8080);

async function main() {
  const doc = await loadDoc();
  const docRef = { doc };
  const httpServer = createHttpServer({
    getDoc: () => docRef.doc,
  });

  createWSServer(httpServer, docRef);

  httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

void main();
