import { Hono } from "hono";
import type { Session } from "./tools/auth.ts";
import { exposePrismaCRUD } from "./tools/prisma.ts";
import { handleFileUpload } from "./tools/fileUpload.ts";

export function publicRoutes(app: Hono): void {
  app.get("/hello", (c) => c.json({ message: "Hello World" }));

  app.post("/file-upload", async (c) => {
    const result = await handleFileUpload(c);
    console.log("File upload result:", result);
    return "error" in result ? c.json(result, 400) : c.json(result, 201);
  });

  app.post("/json", async (c) => {
    const data = await c.req.json();
    console.log("Received JSON:", data);
    return c.json({ received: data });
  });
}

export function privateRoutes(app: Hono): void {
  app.get("/user", (c) => {
    const session = (c as any).get("session") as Session;
    return c.json(
      session.cas_data || session.google_data || session.microsoft_data || {},
    );
  });

  exposePrismaCRUD("api", app);
}

export function onLogin(session: Session): void {
  console.log(
    "User logged in:",
    session.cas_data || session.google_data || session.microsoft_data,
  );
}

/* session.google_data

{
  iss: 'https://accounts.google.com',
  azp: '...',
  aud: '...',
  sub: '103589682456946370010',
  email: 'southwickmatthias@gmail.com',
  email_verified: true,
  name: 'Matthias Southwick',
  picture: 'https://lh3.googleusercontent.com/...',
  given_name: 'Matthias',
  family_name: 'Southwick',
  iat: 1723081204,
  exp: 1723084804,
}

*/
/* session.microsoft_data: {
  '@odata.context': 'https://graph.microsoft.com/v1.0/$metadata#users/$entity',
  userPrincipalName: 'Southwickmatthias@gmail.com',
  id: '4a1639e4ad5f1ca5',
  displayName: 'Matthias Southwick',
  surname: 'Southwick',
  givenName: 'Matthias',
  preferredLanguage: 'en-US',
  mail: null,
  mobilePhone: null,
  jobTitle: null,
  officeLocation: null,
  businessPhones: []
}

*/
