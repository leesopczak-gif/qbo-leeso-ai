const express = require('express');
const dotenv = require('dotenv');
const OAuthClient = require('intuit-oauth');
const { Client } = require('pg');

// Load environment variables from .env file
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// --- 1. QBO OAUTH CLIENT SETUP (FIXED) ---
app.set('trust proxy', true);
var oauthClient = new OAuthClient({
    clientId: process.env.QBO_CLIENT_ID,
    clientSecret: process.env.QBO_CLIENT_SECRET,
    environment: 'sandbox', // FIXED: Explicitly set to 'sandbox'
    redirectUri: process.env.QBO_REDIRECT_URI,
});

// --- 2. POSTGRESQL CLIENT SETUP (FIXED FOR RENDER) ---
// Configured to use the single DATABASE_URL variable from Render
const dbClient = new Client({
    connectionString: process.env.DATABASE_URL, // Uses the URL copied from Render
});

// Connect to the database
dbClient.connect()
    .then(() => console.log('Database connected successfully!'))
    .catch(err => console.error('Database connection error', err.stack));

// --- 3. ROOT ROUTE (FIXED) ---
// Basic test route confirms QBO client is loaded
app.get('/', (req, res) => {
    res.send(`QBO Client Initialized. Environment: <strong>sandbox</strong>
        <p><a href="/connect">Click here to Connect to QuickBooks</a></p>`);
});

// --- 4. CONNECT ROUTE ---
app.get('/connect', (req, res) => {
    // Generate the URL to redirect the user to Intuit for authorization
    const authUri = oauthClient.authorizeUri({
        scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
        state: 'security_state_token',
    });
    res.redirect(authUri);
});

// --- 5. CALLBACK ROUTE (SAVES TO DB) ---
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
                    res.status(500).send('Error saving tokens to database. Check DB table structure/credentials.');
                });
        })
        .catch((e) => {
            console.error('Token Exchange Error:', e.originalMessage);
            res.status(500).send('Error connecting to QuickBooks. Check Client/Secret/URI.');
        });
});

// --- 6. API CALL HELPER FUNCTION (FIXED TIMEOUT) ---
function makeApiCall(req, res) {
    const realmId = oauthClient.token.realmId;
    // URL to get CompanyInfo for the authorized QuickBooks company
    const url = `${oauthClient.baseUrl}v3/company/${realmId}/companyinfo/${realmId}`;

    // Make the secure API call using the current access token
    oauthClient.makeApiCall({
        url: url,
        timeout: 60000 // FIX: Increased timeout to 60 seconds (60000 ms)
    })
        .then((response) => {
            const data = JSON.parse(response.body);
            const companyName = data.CompanyInfo.CompanyName;
            res.send(`<h1>API Call Success!</h1><p>Tokens saved to cloud database and API connection verified.</p><p>Connected to QBO Company: <strong>${companyName}</strong></p>`);
        })
        .catch((e) => {
            console.error('API Call Error:', e.originalMessage);
            res.status(500).send('Error retrieving data after refresh attempt. Check QBO scope permissions.');
        });
}

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});