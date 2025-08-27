/**
 * @swagger
 * /auth:
 *   post:
 *     summary: Authenticate a api user and return an access token.
 *     description: >
 *       Authenticates a user using their username and password, and returns a session token
 *       if the credentials are valid.
 *       The credentials must be provided in the body header as JSON.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 example: johndoe
 *               password:
 *                 type: string
 *                 format: password
 *                 example: mySecret123
 *     responses:
 *       200:
 *         description: Successfully authenticated the user.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Successfully Logged In
 *                 token:
 *                   type: string
 *                   example: d41d8cd98f00b204e9800998ecf8427e
 *       403:
 *         description: Invalid username or password.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Couldn't log in
 */

/**
 * @swagger
 * /google-signin:
 *   post:
 *     summary: Authenticate a user via Google Sign-In and return an access token.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               credential:
 *                 type: string
 *                 description: Google ID token.
 *                 example: eyJhbGciOiJSUzI1NiIsImtpZCI6IjA...
 *               email:
 *                 type: string
 *                 example: johndoe@example.com
 *               name:
 *                 type: string
 *                 example: John Doe
 *     responses:
 *       200:
 *         description: Successfully logged in.
 *       403:
 *         description: Invalid Google login.
 */

/**
 * @swagger
 * /newuser:
 *   post:
 *     summary: Create a new user account.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 example: johndoe
 *               password:
 *                 type: string
 *                 format: password
 *                 example: mySecret123
 *               priv:
 *                 type: integer
 *                 example: 0
 *     responses:
 *       200:
 *         description: User created successfully.
 *       400:
 *         description: Missing username or password.
 *       403:
 *         description: Not authorized to create a user.
 */
