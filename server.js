const express = require('express');
const dotenv = require('dotenv');
const OAuthClient = require('intuit-oauth'); // New: Import the QBO Library
const { Client } = require('pg'); // New: Import the PostgreSQL Client

// Load environment variables from .env file
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Initialize the Intuit OAuth Client using secure environment variables
const oauthClient = new OAuthClient({
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    environment: process.env.ENVIRONMENT,
    redirectUri: process.env.REDIRECT_URI,
});

// Configure PostgreSQL Client using .env variables
const dbClient = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// Connect to the database
dbClient.connect()
    .then(() => console.log('Database connected successfully!'))
    .catch(err => console.error('Database connection error', err.stack));

// Basic test route remains, but now confirms config is loaded
app.get('/', (req, res) => {
    // We read the environment variable to confirm the keys are loaded
    res.send(`QBO Client Initialized. Environment: ${process.env.ENVIRONMENT}`);
});

// --- 1. CONNECT ROUTE ---
// The user clicks a button that directs them to this route.
app.get('/connect', (req, res) => {
    // Generate the URL to redirect the user to Intuit for authorization
    const authUri = oauthClient.authorizeUri({
        scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
        state: 'security_state_token', // Required security token
    });
    res.redirect(authUri);
});

// --- 2. CALLBACK ROUTE (Saves to Database) ---
app.get('/callback', (req, res) => {
    oauthClient.createToken(req.url)
        .then((authResponse) => {
            const tokens = authResponse.getJson();
            const { access_token, refresh_token, realmId } = tokens;

            // Define the SQL INSERT command
            const query = {
                text: `INSERT INTO tokens(access_token, refresh_token, realm_id) VALUES($1, $2, $3)`,
                values: [access_token, refresh_token, realmId],
            };

            // Execute the INSERT command
            dbClient.query(query)
                .then(() => {
                    console.log('QBO Tokens saved to database successfully.');

                    // Immediately run the API call (using the fresh tokens in memory)
                    makeApiCall(req, res);
                })
                .catch((err) => {
                    console.error('Database INSERT Error:', err.stack);
                    res.status(500).send('Error saving tokens to database.');
                });
        })
        .catch((e) => {
            console.error('Token Exchange Error:', e.originalMessage);
            res.status(500).send('Error connecting to QuickBooks.');
        });
});

// --- 3. (DELETED) The separate /test route is no longer needed.
// Helper function to make the actual QBO API call
function makeApiCall(req, res) {
    const realmId = oauthClient.token.realmId;
    const url = `${oauthClient.baseUrl}v3/company/${realmId}/companyinfo/${realmId}`;

    // Make the secure API call using the current access token
    oauthClient.makeApiCall({ url })
        .then((response) => {
            const data = JSON.parse(response.body);
            const companyName = data.CompanyInfo.CompanyName;
            res.send(`<h1>API Call Success!</h1><p>Connected to QBO Company: <strong>${companyName}</strong></p>`);
        })
        .catch((e) => {
            console.error('API Call Error:', e.originalMessage);
            res.status(500).send('Error retrieving data after refresh attempt.');
        });
}

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});